import * as THREE from 'three';

const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const status = (t) => { overlay.textContent = t; };

let renderer, scene, camera, session, refSpace, viewerSpace, hitSource = null;
let marker = null, collected = false, startTime = 0, fallbackUsed = false, frameCount = 0;

startBtn.addEventListener('click', startAR);

async function startAR() {
  if (!navigator.xr) { status('WebXR not available'); return; }

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
  } catch (e) { status('Could not start AR: ' + e.message); return; }

  renderer.xr.setSession(session);
  refSpace = await session.requestReferenceSpace('local-floor');

  try {
    viewerSpace = await session.requestReferenceSpace('viewer');
    hitSource = await session.requestHitTestSource({ space: viewerSpace });
  } catch (e) { status('hit-test unavailable, fallback mode'); }

  buildMarker();
  startBtn.style.display = 'none';
  startTime = performance.now();
  status('Scanning… look at your table');
  renderer.setAnimationLoop(onFrame);
}

function buildMarker() {
  const g = new THREE.Group();
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.07),
    new THREE.MeshStandardMaterial({ color: 0xf5c518, emissive: 0x8a6d00, roughness: 0.3 })
  );
  gem.position.y = 0.06;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.01, 12, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  ring.rotation.x = -Math.PI / 2;
  g.add(gem, ring);
  g.visible = false;
  marker = g;
  scene.add(g);
}

function onFrame(time, frame) {
  if (!frame) return;
  renderer.render(scene, camera);
  frameCount++;

  // A) planes
  const planes = frame.detectedPlanes || new Set();
  let tablePos = null, best = Infinity;
  for (const plane of planes) {
    if (plane.orientation !== 'horizontal') continue;
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose) continue;
    const y = pose.transform.position.y;
    if (y < 0.45 || y > 1.25) continue;
    const d = Math.hypot(pose.transform.position.x, pose.transform.position.z);
    if (d < best) { best = d; tablePos = pose.transform.position; }
  }

  // B) hit-test
  let hitPos = null;
  if (hitSource) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length > 0) {
      const p = hits[0].getPose(refSpace);
      if (p && p.transform.position.y > 0.3 && p.transform.position.y < 1.4) hitPos = p.transform.position;
    }
  }

  // C) fallback
  let mode = '', target = null;
  if (tablePos) { target = tablePos; mode = 'PLANE'; }
  else if (hitPos) { target = hitPos; mode = 'HIT-TEST'; }
  else if (performance.now() - startTime > 6000 && !fallbackUsed) {
    fallbackUsed = true;
    const cp = new THREE.Vector3(), dir = new THREE.Vector3();
    camera.getWorldPosition(cp);
    camera.getWorldDirection(dir);
    target = new THREE.Vector3(cp.x + dir.x * 0.8, Math.max(0.6, cp.y - 0.3), cp.z + dir.z * 0.8);
    mode = 'FALLBACK';
  }

  if (target && !collected) {
    marker.visible = true;
    marker.position.set(target.x, target.y + 0.02 + Math.sin(time / 400) * 0.01, target.z);
    marker.rotation.y += 0.02;
  }

  // D) hands — live debug numbers
  let inputs = 0, hands = 0, pinchTxt = '-', nearTxt = '-';
  for (const src of session.inputSources) {
    inputs++;
    if (!src.hand) continue;
    hands++;
    const thumb = frame.getJointPose(src.hand.get('thumb-tip'), refSpace);
    const index = frame.getJointPose(src.hand.get('index-finger-tip'), refSpace);
    if (!thumb || !index) continue;
    const pinch = Math.hypot(
      thumb.transform.position.x - index.transform.position.x,
      thumb.transform.position.y - index.transform.position.y,
      thumb.transform.position.z - index.transform.position.z);
    pinchTxt = pinch.toFixed(3);
    if (marker.visible && !collected) {
      const near = Math.hypot(
        index.transform.position.x - marker.position.x,
        index.transform.position.y - marker.position.y,
        index.transform.position.z - marker.position.z);
      nearTxt = near.toFixed(2);
      if (pinch < 0.05 && near < 0.35) {
        collected = true;
        marker.children[0].material.color.set(0xffffff);
      }
    }
  }

  // status (updated 5x per second)
  if (frameCount % 12 === 0) {
    const ht = (session.enabledFeatures && Array.from(session.enabledFeatures).includes('hand-tracking')) ? 'on' : 'OFF';
    if (collected) {
      status('EVIDENCE COLLECTED ✅ — Day 1 COMPLETE! mode was ' + mode);
    } else {
      status('ht:' + ht + ' inputs:' + inputs + ' hands:' + hands +
        ' pinch:' + pinchTxt + ' near:' + nearTxt +
        (marker.visible ? ' [' + mode + ' placed — pinch!]' : ' [scanning]'));
    }
  }
}