import * as THREE from 'three';

// ---------- SETUP ----------
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const status = (t) => { overlay.textContent = t; };

let renderer, scene, camera, session, refSpace, viewerSpace, hitSource;
let marker = null, evidenceCollected = false, lastHitPos = null, frameCount = 0;

startBtn.addEventListener('click', startAR);

async function startAR() {
  if (!navigator.xr) { status('WebXR not available in this browser'); return; }

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));

  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor', 'hit-test'],
      optionalFeatures: ['plane-detection', 'hand-tracking', 'dom-overlay'],
      domOverlay: { root: document.getElementById('overlay') }
    });
  } catch (e) {
    status('Could not start AR: ' + e.message); return;
  }

  renderer.xr.setSession(session);
  refSpace = await session.requestReferenceSpace('local-floor');

  try {
    viewerSpace = await session.requestReferenceSpace('viewer');
    hitSource = await session.requestHitTestSource({
      space: viewerSpace,
      offsetRay: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: -0.5734, z: -0.8192 } }
    });
  } catch (e) {
    status('hit-test failed: ' + e.message); return;
  }

  buildMarker();
  startBtn.style.display = 'none';
  status('Scanning your room… point your head at the table');
  renderer.setAnimationLoop(onFrame);
}

// ---------- THE EVIDENCE MARKER ----------
function buildMarker() {
  const g = new THREE.Group();
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.045),
    new THREE.MeshStandardMaterial({ color: 0xf5c518, emissive: 0x8a6d00, roughness: 0.3 })
  );
  gem.position.y = 0.06;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.09, 0.008, 12, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  ring.rotation.x = -Math.PI / 2;
  g.add(gem, ring);
  g.visible = false;
  marker = g;
  scene.add(g);
}

// ---------- PER-FRAME ----------
function onFrame(time, frame) {
  if (!frame) return;
  frameCount++;

  // 1. PLANE DETECTION — preferred: a real table-height plane
  const planes = frame.detectedPlanes || new Set();
  let tablePos = null, bestDist = Infinity;

  for (const plane of planes) {
    if (plane.orientation !== 'horizontal') continue;
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose) continue;
    const y = pose.transform.position.y;
    if (y < 0.45 || y > 1.25) continue; // table height only
    const d = Math.hypot(pose.transform.position.x, pose.transform.position.z);
    if (d < bestDist) { bestDist = d; tablePos = pose.transform.position; }
  }

  // 2. HIT-TEST FALLBACK — invisible ray from your head, forward and down
  let hitYes = false;
  if (hitSource) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length > 0) {
      const pose = hits[0].getPose(refSpace);
      if (pose) {
        const p = pose.transform.position;
        if (p.y > 0.05 && p.y < 2.0) { lastHitPos = p; hitYes = true; }
      }
    }
  }

  // 3. Decide where the marker goes: real table plane beats hit-test
  let target = tablePos || (lastHitPos && lastHitPos.y > 0.35 ? lastHitPos : null);

  if (target && !evidenceCollected) {
    marker.visible = true;
    marker.position.set(target.x, target.y + 0.02 + Math.sin(time / 400) * 0.01, target.z);
    marker.rotation.y += 0.02;
    if (tablePos) {
      status('Evidence found via PLANE DETECTION — pinch near it to collect! | planes:' + planes.size + ' hit:yes');
    } else {
      status('Evidence found via HIT-TEST — pinch near it to collect! | planes:' + planes.size + ' hit:yes');
    }
  } else if (!evidenceCollected) {
    if (frameCount % 30 === 0) {
      status('Scanning… point at your table | planes:' + planes.size + ' hit:' + (hitYes ? 'yes' : 'no'));
    }
  }

  // 4. HAND PINCH — thumb tip + index tip close together = grab
  for (const src of session.inputSources) {
    if (src.hand) {
      const thumb = frame.getJointPose(src.hand.get('thumb-tip'), refSpace);
      const index = frame.getJointPose(src.hand.get('index-finger-tip'), refSpace);
      if (thumb && index && marker.visible && !evidenceCollected) {
        const pinchDist = Math.hypot(
          thumb.transform.position.x - index.transform.position.x,
          thumb.transform.position.y - index.transform.position.y,
          thumb.transform.position.z - index.transform.position.z
        );
        const handDist = Math.hypot(
          thumb.transform.position.x - marker.position.x,
          thumb.transform.position.y - marker.position.y,
          thumb.transform.position.z - marker.position.z
        );
        if (pinchDist < 0.03 && handDist < 0.25) {
          evidenceCollected = true;
          marker.children[0].material.color.set(0xffffff);
          status('EVIDENCE COLLECTED ✅ tell your AI partner which method found it (plane or hit-test)!');
        }
      }
    }
  }
}