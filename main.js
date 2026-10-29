import * as THREE from 'three';

// ---------- SETUP ----------
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const status = (t) => { overlay.textContent = t; };

let renderer, scene, camera, session, refSpace;
let marker = null;          // the evidence marker mesh
let evidenceCollected = false;

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

  session.updateTargetFrameRate?.(72);
  renderer.xr.setSession(session);
  refSpace = await session.requestReferenceSpace('local-floor');

  buildMarker();
  startBtn.style.display = 'none';
  status('Scanning your room for a table…');
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

  // 1. PLANE DETECTION — find a "table" (horizontal plane at table height)
  const planes = frame.detectedPlanes || new Set();
  let bestPlane = null, bestDist = Infinity;

  for (const plane of planes) {
    if (plane.orientation !== 'horizontal') continue;
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose) continue;
    const y = pose.transform.position.y;
    if (y < 0.45 || y > 1.25) continue;           // table-height only, ignores floor
    const d = Math.hypot(pose.transform.position.x, pose.transform.position.z);
    if (d < bestDist) { bestDist = d; bestPlane = { pose, plane }; }
  }

  if (bestPlane) {
    const p = bestPlane.pose.transform.position;
    marker.visible = true;
    // gentle float + spin so it feels alive
    marker.position.set(p.x, p.y + 0.02 + Math.sin(time / 400) * 0.01, p.z);
    marker.rotation.y += 0.02;
    if (!evidenceCollected) status('Evidence found on your ' + (p.y < 0.9 ? 'low surface' : 'table') + ' — pinch near it to collect!');
  }

  // 2. HAND PINCH — thumb tip + index tip close together = grab
  for (const src of session.inputSources) {
    if (src.hand) {
      const thumb = frame.getJointPose(src.hand.get('thumb-tip'), refSpace);
      const index = frame.getJointPose(src.hand.get('index-finger-tip'), refSpace);
      if (thumb && index && marker.visible && !evidenceCollected) {
        const dx = thumb.transform.position.x - index.transform.position.x;
        const dy = thumb.transform.position.y - index.transform.position.y;
        const dz = thumb.transform.position.z - index.transform.position.z;
        const pinchDist = Math.hypot(dx, dy, dz);
        const mx = thumb.transform.position.x - marker.position.x;
        const my = thumb.transform.position.y - marker.position.y;
        const mz = thumb.transform.position.z - marker.position.z;
        const handDist = Math.hypot(mx, my, mz);
        if (pinchDist < 0.03 && handDist < 0.25) {
          evidenceCollected = true;
          marker.children[0].material.color.set(0xffffff); // flash white
          status('EVIDENCE COLLECTED ✅ Day 1 complete — tell your AI partner what happened!');
        }
      }
    }
  }
}
