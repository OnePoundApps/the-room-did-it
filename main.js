import * as THREE from 'three';

// ================= THE ROOM DID IT — main.js v3 =================
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const status = (t) => { overlay.textContent = t; };

let renderer, scene, camera, session, refSpace, viewerSpace, hitSource = null;
let marker = null, collected = false, startTime = 0, fallbackUsed = false;

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
  } catch (e) {
    status('hit-test unavailable, using fallback mode');
  }

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

  // --- A) plane detection: real table plane ---
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

  // --- B) hit-test: forward ray from your head ---
  let hitPos = null;
  if (hitSource) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length > 0) {
      const p = hits[0].getPose(refSpace);
      if (p && p.transform.position.y > 0.3 && p.transform.position.y < 1.4) hitPos = p.transform.position;
    }
  }

  // --- C) guaranteed fallback: float in front of your face after 6s ---
  let mode = '';
  let target = null;
  if (tablePos) { target = tablePos; mode = 'PLANE'; }
  else if (hitPos) { target = hitPos; mode = 'HIT-TEST'; }
  else if (performance.now() - startTime > 6000 && !fallbackUsed) {
    fallbackUsed = true;
    const camPos = new THREE.Vector3(), dir = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(dir);
    target = new THREE.Vector3(camPos.x + dir.x * 0.8, Math.max(0.6, camPos.y - 0.3), camPos.z + dir.z * 0.8);
    mode = 'FALLBACK';
  }

  if (target && !collected) {
    marker.visible = true;
    marker.position.set(target.x, target.y + 0.02 + Math.sin(time / 400) * 0.01, target.z);
    marker.rotation.y += 0.02;
        let inputs = 0, hands = 0;
    for (const s of session.inputSources) { inputs++; if (s.hand) hands++; }
    status('Evidence (' + mode + ') inputs:' + inputs + ' hands:' + hands + ' — pinch near it!');
  }

  // --- pinch to collect ---
  for (const src of session.inputSources) {
    if (!src.hand) continue;
    const thumb = frame.getJointPose(src.hand.get('thumb-tip'), refSpace);
    const index = frame.getJointPose(src.hand.get('index-finger-tip'), refSpace);
    if (!thumb || !index || !marker.visible || collected) continue;
    const pinch = Math.hypot(
      thumb.transform.position.x - index.transform.position.x,
      thumb.transform.position.y - index.transform.position.y,
      thumb.transform.position.z - index.transform.position.z);
    const near = Math.hypot(
      thumb.transform.position.x - marker.position.x,
      thumb.transform.position.y - marker.position.y,
      thumb.transform.position.z - marker.position.z);
    if (pinch < 0.03 && near < 0.3) {
      collected = true;
      marker.children[0].material.color.set(0xffffff);
      status('EVIDENCE COLLECTED ✅ mode was ' + mode + ' — report this to your AI partner!');
    }
  }
}