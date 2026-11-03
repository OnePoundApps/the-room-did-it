import * as THREE from 'three';

// THE ROOM DID IT — v7 / confirmed real-surface placement.
// No automatic near-face fallback. Keeps the working v6 hand-pinch and gaze grab.
// Test clues: bottle -> table/sofa, knife -> floor, blood pattern -> wall.
const startBtn = document.getElementById('startBtn');
const overlay = document.getElementById('overlay');
const instructions = document.getElementById('instructions');

let renderer, scene, camera, session, refSpace, viewerSpace, hitSource;
let hud, hudCtx, hudTexture;
let startedAt = 0, frameNumber = 0, pinchCount = 0;
let inputCount = 0, trackedHands = 0, poseHands = 0;
let leftPinch = '-', rightPinch = '-';
let visiblePlanes = 0, visibleHits = 0;
let gazeTarget = null, grabbedBy = null, grabbedEvidence = null, grabMethod = '';
let lastNotice = '', noticeUntil = 0;
const handStates = new WeakMap();
const stableCandidates = new Map();
const evidence = [];

const GRAB_DISTANCE = 0.26;
const PINCH_DOWN = 0.047;
const PINCH_UP = 0.070;
const STABLE_MS = 450; // dwell on a recognised surface before committing a clue
const MAX_PLACE_DISTANCE = 2.4;
const headPosition = new THREE.Vector3();
const headRotation = new THREE.Quaternion();
const gazeDirection = new THREE.Vector3(0, 0, -1);
const temp = new THREE.Vector3();
const normal = new THREE.Vector3();
const SURFACE_UP = new THREE.Vector3(0, 1, 0);

startBtn.addEventListener('click', startAR);

async function startAR() {
  startBtn.disabled = true;
  if (!navigator.xr) {
    startBtn.textContent = 'WebXR not available';
    startBtn.disabled = false;
    return;
  }
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    document.body.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));

    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor', 'hand-tracking'],
      optionalFeatures: ['hit-test', 'plane-detection']
    });
    await renderer.xr.setSession(session); // must await Three.js XR initialization
    refSpace = renderer.xr.getReferenceSpace() || await session.requestReferenceSpace('local-floor');

    try {
      viewerSpace = await session.requestReferenceSpace('viewer');
      hitSource = await session.requestHitTestSource({ space: viewerSpace });
    } catch (err) {
      hitSource = null;
      console.warn('Hit test unavailable:', err);
    }

    buildEvidence();
    buildHUD();
    startBtn.style.display = 'none';
    if (instructions) instructions.style.display = 'none';
    startedAt = performance.now();
    lastNotice = 'Look at your REAL table, floor and wall to place evidence.';

    session.addEventListener('selectstart', event => {
      if (event.inputSource?.hand) attemptGrab(event.inputSource, 'XR SELECT');
    });
    session.addEventListener('selectend', event => {
      if (event.inputSource === grabbedBy) finishGrab();
    });
    session.addEventListener('end', () => {
      renderer.setAnimationLoop(null);
      hitSource?.cancel?.();
      startBtn.disabled = false;
      startBtn.style.display = '';
      startBtn.textContent = 'ENTER THE CRIME SCENE';
      if (instructions) instructions.style.display = '';
    });
    renderer.setAnimationLoop(onFrame);
  } catch (err) {
    console.error('XR startup failed:', err);
    startBtn.textContent = 'AR / hands failed: ' + (err?.message || err);
    if (overlay) overlay.textContent = startBtn.textContent;
    startBtn.disabled = false;
    if (session && !renderer?.xr?.isPresenting) {
      try { await session.end(); } catch (_) { /* no-op */ }
    }
  }
}

function makeMaterial(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.12, ...opts });
}

function buildEvidence() {
  // The group's local +Y axis is the real surface normal for all three evidence types.
  // Their geometry is designed in that coordinate system; the group orientation
  // is copied from the real hit-test / XRPlane pose when placement is confirmed.
  const bottle = new THREE.Group();
  const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.085, 16),
    makeMaterial(0xcbd4df, { transparent: true, opacity: 0.88 }));
  vial.position.y = 0.05;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.02, 16), makeMaterial(0x161a23));
  cap.position.y = 0.10;
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.025, 0.003),
    new THREE.MeshBasicMaterial({ color: 0xf5c518 }));
  label.position.set(0, 0.046, 0.027);
  bottle.add(vial, cap, label);
  addBaseRing(bottle, 0xf5c518, 0.085);

  const knife = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.013, 0.025), makeMaterial(0x191c26));
  handle.position.set(-0.058, 0.018, 0);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.006, 0.022),
    makeMaterial(0xbec9d4, { metalness: 0.85, roughness: 0.22 }));
  blade.position.set(0.045, 0.017, 0);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.033, 3),
    makeMaterial(0xd9e1e7, { metalness: 0.8 }));
  tip.rotation.z = -Math.PI / 2;
  tip.position.set(0.12, 0.018, 0);
  knife.add(handle, blade, tip);
  addBaseRing(knife, 0xf5c518, 0.13);

  // Blood decal is flat ON the wall plane. Its local normal is +Y; not a floating blob.
  const blood = new THREE.Group();
  const blobs = [
    [0, 0, 0.046], [-0.046, 0.034, 0.018], [0.059, 0.024, 0.021],
    [-0.022, -0.061, 0.012], [0.040, -0.064, 0.011], [0.092, -0.023, 0.009]
  ];
  for (const [x, z, radius] of blobs) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(radius, 18),
      new THREE.MeshBasicMaterial({ color: 0xa21729, side: THREE.DoubleSide, depthWrite: false }));
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, 0.004, z);
    blood.add(patch);
  }
  addBaseRing(blood, 0xf5c518, 0.12);

  const definitions = [
    { id: 'table', name: 'PILL BOTTLE', surface: 'TABLE / SOFA', group: bottle },
    { id: 'floor', name: 'KNIFE', surface: 'FLOOR', group: knife },
    { id: 'wall', name: 'BLOOD TRACE', surface: 'WALL', group: blood }
  ];
  for (const d of definitions) {
    d.group.visible = false;
    d.group.userData.evidenceId = d.id;
    d.placed = false;
    d.collected = false;
    d.placedBy = '';
    d.ring = d.group.userData.ring;
    scene.add(d.group);
    evidence.push(d);
  }
}

function addBaseRing(group, color, radius) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.006, 9, 36),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.008;
  group.add(ring);
  group.userData.ring = ring;
}

function buildHUD() {
  const canvas = document.createElement('canvas');
  canvas.width = 1536; canvas.height = 432;
  hudCtx = canvas.getContext('2d');
  hudTexture = new THREE.CanvasTexture(canvas);
  hud = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.321),
    new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, depthTest: false,
      depthWrite: false, side: THREE.DoubleSide }));
  hud.renderOrder = 1000;
  hud.frustumCulled = false;
  scene.add(hud);
  paintHUD(['THE ROOM DID IT  |  REAL SURFACE TEST',
    'Look at a table, floor or wall. No floating fallback.',
    'Put controllers aside. Use hands to grab clues.']);
}

function paintHUD(lines) {
  hudCtx.clearRect(0, 0, 1536, 432);
  hudCtx.fillStyle = 'rgba(9, 15, 24, 0.85)';
  hudCtx.fillRect(0, 0, 1536, 432);
  hudCtx.strokeStyle = '#f5c518';
  hudCtx.lineWidth = 7;
  hudCtx.strokeRect(4, 4, 1528, 424);
  hudCtx.textAlign = 'center';
  hudCtx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    hudCtx.fillStyle = i === 0 ? '#f5c518' : '#ffffff';
    hudCtx.font = i === 0 ? 'bold 56px Arial' : 'bold 49px Arial';
    hudCtx.fillText(line, 768, 78 + i * 133, 1480);
  });
  hudTexture.needsUpdate = true;
  if (overlay) overlay.textContent = lines.join(' | ');
}

function updateHeadAndHUD(viewerPose) {
  const p = viewerPose.transform.position;
  const q = viewerPose.transform.orientation;
  headPosition.set(p.x, p.y, p.z);
  headRotation.set(q.x, q.y, q.z, q.w);
  gazeDirection.set(0, 0, -1).applyQuaternion(headRotation).normalize();
  hud.position.copy(headPosition).add(temp.set(0, -0.27, -0.99).applyQuaternion(headRotation));
  hud.quaternion.copy(headRotation);
}

function isInsidePolygon(x, z, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const crosses = ((a.z > z) !== (b.z > z)) &&
      (x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x);
    if (crosses) inside = !inside;
  }
  return inside;
}

// Find the actual gaze-ray intersection with a bounded tracked XRPlane polygon.
// Unlike using its origin, this is guaranteed to lie within the recognised geometry.
function findPlaneCandidate(frame, plane) {
  if (plane.orientation !== 'horizontal' && plane.orientation !== 'vertical') return null;
  const pose = frame.getPose(plane.planeSpace, refSpace);
  if (!pose) return null;
  const p = pose.transform.position, q = pose.transform.orientation;
  const origin = new THREE.Vector3(p.x, p.y, p.z);
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const up = SURFACE_UP.clone().applyQuaternion(quat).normalize();
  const divisor = up.dot(gazeDirection);
  if (Math.abs(divisor) < 0.035) return null;
  const t = up.dot(origin.clone().sub(headPosition)) / divisor;
  if (t < 0.30 || t > MAX_PLACE_DISTANCE) return null;
  const point = headPosition.clone().addScaledVector(gazeDirection, t);
  const local = point.clone().sub(origin).applyQuaternion(quat.clone().invert());
  if (!isInsidePolygon(local.x, local.z, plane.polygon)) return null;
  return makeCandidate(point, quat, up, 'PLANE', plane.orientation, plane.semanticLabel);
}

function makeCandidate(point, quat, up, method, orientation, semanticLabel = '') {
  let type = null;
  const label = (semanticLabel || '').toLowerCase();
  const horizontal = orientation === 'horizontal' || (orientation == null && up.y > 0.7);
  const vertical = orientation === 'vertical' || (orientation == null && Math.abs(up.y) < 0.40);

  if (horizontal && up.y > 0.67) {
    // local-floor measures metres from physical floor; never misclassify a floor as table.
    if (point.y >= -0.18 && point.y <= 0.25 && label !== 'ceiling') type = 'floor';
    else if (point.y >= 0.35 && point.y <= 1.3 && label !== 'ceiling') type = 'table';
  } else if (vertical && Math.abs(up.y) < 0.45 && point.y >= 0.45 && point.y <= 1.75) {
    type = 'wall';
  }
  if (label.includes('ceiling')) type = null;
  const distance = headPosition.distanceTo(point);
  if (!type || distance < 0.28 || distance > MAX_PLACE_DISTANCE) return null;
  return { type, position: point, quaternion: quat, normal: up, method, distance };
}

function findHitCandidate(frame) {
  if (!hitSource) return null;
  try {
    const hits = frame.getHitTestResults(hitSource);
    visibleHits = hits.length;
    for (const hit of hits) {
      const pose = hit.getPose(refSpace);
      if (!pose) continue;
      const p = pose.transform.position, q = pose.transform.orientation;
      const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
      const point = new THREE.Vector3(p.x, p.y, p.z);
      const up = SURFACE_UP.clone().applyQuaternion(quat).normalize();
      const candidate = makeCandidate(point, quat, up, 'HIT-TEST', null);
      if (candidate) return candidate;
    }
  } catch (err) {
    console.warn('Hit test frame error:', err);
  }
  return null;
}

function detectSurface(frame) {
  let planeCandidate = null;
  let closest = Infinity;
  visiblePlanes = frame.detectedPlanes?.size ?? 0;
  visibleHits = 0;

  if (frame.detectedPlanes) {
    for (const plane of frame.detectedPlanes) {
      try {
        const candidate = findPlaneCandidate(frame, plane);
        if (candidate && candidate.distance < closest) {
          planeCandidate = candidate;
          closest = candidate.distance;
        }
      } catch (err) {
        console.warn('Invalid plane:', err);
      }
    }
  }
  // Read BOTH sources so the diagnostics are truthful and a plane we've already
  // used cannot hide a new hit-test candidate for a different clue.
  const hitCandidate = findHitCandidate(frame);
  const notYetPlaced = candidate => candidate && evidence.some(
    item => item.id === candidate.type && !item.placed);
  if (notYetPlaced(planeCandidate)) return planeCandidate;
  if (notYetPlaced(hitCandidate)) return hitCandidate;
  return null;
}

function placeAtSurface(candidate) {
  const item = evidence.find(e => e.id === candidate.type && !e.placed);
  if (!item) return;
  const quat = candidate.quaternion.clone();
  const facing = headPosition.clone().sub(candidate.position).normalize();
  // For wall decals, face out from the wall toward the viewer.
  if (item.id === 'wall' && candidate.normal.dot(facing) < 0) {
    quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
  }
  const surfaceNormal = SURFACE_UP.clone().applyQuaternion(quat).normalize();
  item.group.position.copy(candidate.position).addScaledVector(surfaceNormal, 0.012);
  item.group.quaternion.copy(quat);
  item.group.visible = true;
  item.placed = true;
  item.placedBy = candidate.method;
  stableCandidates.delete(item.id);
  lastNotice = item.name + ' locked onto REAL ' + item.surface;
  noticeUntil = performance.now() + 2200;
  console.info('Placed:', item.name, item.surface, candidate.method, candidate.position.toArray());
}

function considerPlacement(frame, now) {
  if (evidence.every(e => e.placed)) return;
  const candidate = detectSurface(frame);
  if (!candidate) return;
  const item = evidence.find(e => e.id === candidate.type && !e.placed);
  if (!item) return;
  const previous = stableCandidates.get(item.id);
  if (!previous || previous.position.distanceTo(candidate.position) > 0.16 ||
      now - previous.seenAt > 300) {
    stableCandidates.set(item.id, { position: candidate.position.clone(), since: now, seenAt: now,
      last: candidate });
    return;
  }
  previous.position.lerp(candidate.position, 0.12);
  previous.seenAt = now;
  previous.last = candidate;
  if (now - previous.since >= STABLE_MS) placeAtSurface(candidate);
}

function getWorldCenter(item) {
  return item.group.getWorldPosition(new THREE.Vector3());
}

function getGazeTarget() {
  let result = null;
  let best = Infinity;
  for (const item of evidence) {
    if (!item.placed || item.collected || item === grabbedEvidence) continue;
    const to = getWorldCenter(item).sub(headPosition);
    const forward = to.dot(gazeDirection);
    if (forward < 0.20 || forward > 2.65) continue;
    const offset = to.addScaledVector(gazeDirection, -forward).length();
    const tolerance = Math.max(0.16, forward * 0.17);
    if (offset < tolerance && offset < best) {
      result = item; best = offset;
    }
  }
  return result;
}

function getHandState(src) {
  let state = handStates.get(src);
  if (!state) {
    state = { closed: false, near: Infinity, midpoint: new THREE.Vector3(),
      hasPose: false, distance: Infinity, nearItem: null };
    handStates.set(src, state);
  }
  return state;
}

function attemptGrab(src, method) {
  if (grabbedBy) return;
  pinchCount++;
  const state = getHandState(src);
  const direct = state.hasPose && state.near <= GRAB_DISTANCE ? state.nearItem : null;
  const item = direct || gazeTarget;
  if (!item || item.collected) {
    lastNotice = 'PINCH detected! Look at an evidence item first.';
    noticeUntil = performance.now() + 1800;
    return;
  }
  grabbedBy = src;
  grabbedEvidence = item;
  grabMethod = direct ? 'DIRECT PINCH' : 'GAZE + PINCH';
  if (item.ring) item.ring.visible = false;
  if (state.hasPose) item.group.position.copy(state.midpoint);
  lastNotice = 'Holding ' + item.name + ': move your hand and RELEASE';
  noticeUntil = 0;
  console.info('Grabbed', item.name, method, grabMethod);
}

function finishGrab() {
  if (!grabbedBy || !grabbedEvidence) return;
  const item = grabbedEvidence;
  grabbedBy = null;
  grabbedEvidence = null;
  item.collected = true;
  item.group.visible = false; // notebook pickup, not floating evidence left behind
  lastNotice = item.name + ' added to case notebook';
  noticeUntil = performance.now() + 2800;
  console.info('Collected', item.name);
}

function processHands(frame) {
  inputCount = 0; trackedHands = 0; poseHands = 0;
  leftPinch = '-'; rightPinch = '-';
  for (const src of session.inputSources) {
    inputCount++;
    if (!src.hand) continue;
    trackedHands++;
    const state = getHandState(src);
    state.hasPose = false;
    const thumbJoint = src.hand.get('thumb-tip');
    const indexJoint = src.hand.get('index-finger-tip');
    if (!thumbJoint || !indexJoint || typeof frame.getJointPose !== 'function') continue;
    let thumb, index;
    try {
      thumb = frame.getJointPose(thumbJoint, refSpace);
      index = frame.getJointPose(indexJoint, refSpace);
    } catch (err) {
      console.warn('Joint pose error:', err);
      continue;
    }
    if (!thumb || !index) continue;
    state.hasPose = true; poseHands++;
    const a = thumb.transform.position, b = index.transform.position;
    const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    state.distance = dist;
    state.midpoint.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    state.near = Infinity; state.nearItem = null;
    for (const item of evidence) {
      if (!item.placed || item.collected || grabbedBy) continue;
      const d = state.midpoint.distanceTo(getWorldCenter(item));
      if (d < state.near) { state.near = d; state.nearItem = item; }
    }
    if (src.handedness === 'left') leftPinch = dist.toFixed(3) + 'm';
    if (src.handedness === 'right') rightPinch = dist.toFixed(3) + 'm';
    if (!state.closed && dist <= PINCH_DOWN) {
      state.closed = true;
      attemptGrab(src, 'JOINT DISTANCE');
    } else if (state.closed && dist >= PINCH_UP) {
      state.closed = false;
      if (grabbedBy === src) finishGrab();
    }
    if (grabbedBy === src && grabbedEvidence) {
      grabbedEvidence.group.position.lerp(state.midpoint, 0.5);
      grabbedEvidence.group.quaternion.slerp(headRotation, 0.22);
    }
  }
}

function updateFeedback(now) {
  const placed = evidence.filter(e => e.placed).length;
  const collected = evidence.filter(e => e.collected).length;
  const awaiting = evidence.filter(e => !e.placed).map(e => e.surface).join(' / ');
  if (collected === evidence.length) {
    paintHUD(['CASE 01 | SURFACE TEST COMPLETE',
      'All 3 clues collected: bottle, knife and blood trace.',
      'Hands + real surface placement + pickup validated.']);
  } else if (grabbedEvidence) {
    paintHUD(['HOLDING: ' + grabbedEvidence.name,
      'Move your hand to inspect the evidence.',
      'RELEASE pinch to add it to the notebook.']);
  } else if (now < noticeUntil) {
    paintHUD(['THE ROOM DID IT | ' + collected + '/3 COLLECTED',
      lastNotice,
      'Planes: ' + visiblePlanes + ' | Hits: ' + visibleHits + ' | Hands: ' + poseHands]);
  } else if (placed === 0 && now - startedAt > 9000 && visiblePlanes === 0 && visibleHits === 0) {
    paintHUD(['NO REAL SURFACES REPORTED',
      'Quest room scan may not be available to WebXR.',
      'Planes: 0 | Hits: 0 | Look at surfaces. No fake placement.']);
  } else {
    paintHUD(['THE ROOM DID IT | PLACED ' + placed + '/3 | COLLECTED ' + collected + '/3',
      'Planes ' + visiblePlanes + ' | Hits ' + visibleHits +
        ' | Hands ' + poseHands + ' | Pinches ' + pinchCount,
      gazeTarget ? 'TARGET: ' + gazeTarget.name + ' - PINCH TO GRAB'
        : (awaiting ? 'LOOK AT: ' + awaiting : 'Look at a clue, then PINCH')]);
  }
  for (const item of evidence) {
    if (item.ring && item.placed && !item.collected && item !== grabbedEvidence) {
      item.ring.material.color.set(item === gazeTarget ? 0x56edff : 0xf5c518);
    }
  }
}

function onFrame(now, frame) {
  if (!frame) return;
  frameNumber++;
  const viewerPose = frame.getViewerPose(refSpace);
  if (viewerPose) {
    updateHeadAndHUD(viewerPose);
    considerPlacement(frame, now);
    gazeTarget = getGazeTarget();
  }
  processHands(frame);
  if (frameNumber % 8 === 0) updateFeedback(now);
  renderer.render(scene, camera);
}
