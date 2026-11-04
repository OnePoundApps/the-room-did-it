import * as THREE from 'three';

// THE ROOM DID IT — v8 / After the Party: interactive London 2026 case.
// No automatic near-face fallback. Keeps the working v6 hand-pinch and gaze grab.
// Preserve proven v7 surface placement and grip; add a gaze+pinch case notebook.
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
let notebookMesh, notebookCanvas, notebookCtx, notebookTexture;
let notebookOpen = false, notebookPage = 'brief', notebookHover = null;
let notebookButtons = [], notebookSelectedClue = 'table';
let deductionStep = 0, points = 100, gameResult = null, caseFeedback = '';
let accusationConfirm = null, noteMode = false;
const noteRaycaster = new THREE.Raycaster();
const NOTE_W = 1400, NOTE_H = 1024;
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
    buildNotebook();
    startBtn.style.display = 'none';
    if (instructions) instructions.style.display = 'none';
    startedAt = performance.now();
    lastNotice = 'Look at your REAL table, floor and wall to place evidence.';

    session.addEventListener('selectstart', event => {
      if (event.inputSource?.hand) handlePinch(event.inputSource, 'XR SELECT');
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
  paintHUD(['CASE 01  |  AFTER THE PARTY  |  LONDON 2026',
    'Look at real surfaces to reveal 3 pieces of evidence.',
    'Pinch EMPTY space to open your case notebook.']);
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
  hud.position.copy(headPosition).add(temp.set(0, -0.37, -1.05).applyQuaternion(headRotation));
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
  item.surfacePosition = item.group.position.clone();
  item.surfaceQuaternion = item.group.quaternion.clone();
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

// WebXR selectstart and thumb/index joint thresholds may both fire for the same pinch.
// Debounce them together to avoid selecting two notebook choices at once.
function handlePinch(src, method) {
  const state = getHandState(src);
  const now = performance.now();
  if (now - (state.lastPinchAt ?? -10000) < 330) return;
  state.lastPinchAt = now;
  pinchCount++;

  if (notebookOpen) {
    if (notebookHover) activateNotebookButton(notebookHover);
    else { caseFeedback = 'LOOK AT A NOTEBOOK BUTTON, THEN PINCH'; paintNotebook(); }
    return;
  }
  if (gameResult) { openNotebook(); return; }
  if (grabbedBy) return;
  const direct = state.hasPose && state.near <= GRAB_DISTANCE ? state.nearItem : null;
  const item = direct || gazeTarget;
  if (!item || item.collected) { openNotebook(); return; }

  grabbedBy = src;
  grabbedEvidence = item;
  grabMethod = direct ? 'DIRECT PINCH' : 'GAZE + PINCH';
  if (item.ring) item.ring.visible = false;
  if (state.hasPose) item.group.position.copy(state.midpoint);
  lastNotice = 'Holding ' + item.name + ': RELEASE to file evidence';
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
  lastNotice = item.name + ' filed in your notebook';
  noticeUntil = performance.now() + 2800;
  if (evidence.every(e => e.collected)) {
    lastNotice = 'ALL EVIDENCE COLLECTED: investigate in your notebook';
    openNotebook();
  }
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
      handlePinch(src, 'JOINT DISTANCE');
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
  hud.visible = !notebookOpen;
  if (notebookOpen) return;
  if (grabbedEvidence) {
    paintHUD(['AFTER THE PARTY  |  HOLDING ' + grabbedEvidence.name,
      'Move hand to inspect. RELEASE to file in notebook.',
      'Evidence ' + collected + '/3 | Hands ' + poseHands]);
  } else if (now < noticeUntil) {
    paintHUD(['AFTER THE PARTY  |  ' + collected + '/3 CLUES COLLECTED',
      lastNotice,
      'Pinch EMPTY space to open the notebook.']);
  } else if (placed === 0 && now - startedAt > 9000 && visiblePlanes === 0 && visibleHits === 0) {
    paintHUD(['NO REAL SURFACES REPORTED',
      'Look at your real table, floor or wall.',
      'Planes 0 | Hits 0 | No floating evidence fallback.']);
  } else {
    paintHUD(['CASE 01  |  AFTER THE PARTY  |  ' + collected + '/3 CLUES',
      'Planes ' + visiblePlanes + ' | Hits ' + visibleHits +
        ' | Hands ' + poseHands + ' | Pinches ' + pinchCount,
      gazeTarget ? 'LOOKING AT ' + gazeTarget.name + ' — PINCH TO PICK UP'
        : (awaiting ? 'SCAN: ' + awaiting + ' | PINCH EMPTY SPACE FOR NOTEBOOK'
          : 'All clues placed. PINCH EMPTY space for notebook.')]);
  }
  for (const item of evidence) {
    if (item.ring && item.placed && !item.collected && item !== grabbedEvidence) {
      item.ring.material.color.set(item === gazeTarget ? 0x56edff : 0xf5c518);
    }
  }
}

// ---------------- CASE 01: AFTER THE PARTY ----------------
// All scene surfaces and hand-grab mechanics above are inherited from v7.
// The notebook is a world-locked WebGL canvas. It needs no DOM overlay/controllers.
const CASE_EVIDENCE = {
  table: {
    title: 'PRESCRIPTION BOTTLE',
    text: 'Loose tablets were found by the drinks. Their presence suggests drug use but cannot establish a fatal overdose.',
    report: 'Toxicology: traces found, below the level expected to have caused the death.'
  },
  floor: {
    title: 'KITCHEN KNIFE',
    text: 'A knife lies near the victim. It has no visible blood transfer and no matching wound has been identified.',
    report: 'Pathology: no penetrating stab injury. The knife may be unrelated.'
  },
  wall: {
    title: 'WALL BLOOD TRACE',
    text: 'A small blood pattern appears near head height. It suggests contact or impact, but the stain alone cannot identify the assailant.',
    report: 'Pathology: severe blunt-force head injury. Compare it against the wall trace and witness timing.'
  }
};
const SUSPECTS = ['MIA SHAH (FLATMATE)', 'LEWIS WARD (FRIEND)', 'BEN CARTER (DJ)'];
const QUESTIONS = [
  {
    title: '01 / CAUSE OF DEATH',
    question: 'What best explains Aaron Malik\'s death?',
    answers: ['Drug overdose', 'Stab wound', 'Blunt-force head trauma'],
    correct: 2, cost: 20,
    proof: 'The pathology note identifies head trauma. Drugs and the knife are distractions.'
  },
  {
    title: '02 / EVIDENCE TEST',
    question: 'Which finding most clearly weakens the overdose theory?',
    answers: ['A knife was on the floor', 'Toxicology was nonfatal', 'There was blood on the wall'],
    correct: 1, cost: 15,
    proof: 'The preliminary toxicology report does not support a fatal overdose.'
  },
  {
    title: '03 / FINAL ACCUSATION',
    question: 'Who should face the final accusation?',
    answers: SUSPECTS,
    correct: 1, cost: 50,
    proof: 'Lewis returned at 02:09, lied about his alibi and was heard arguing just before the impact.'
  }
];
const wrongDeductions = new Set();
let cursorMesh = null;

function buildNotebook() {
  notebookCanvas = document.createElement('canvas');
  notebookCanvas.width = NOTE_W;
  notebookCanvas.height = NOTE_H;
  notebookCtx = notebookCanvas.getContext('2d');
  notebookTexture = new THREE.CanvasTexture(notebookCanvas);
  notebookTexture.colorSpace = THREE.SRGBColorSpace;
  notebookMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.14, 0.833),
    new THREE.MeshBasicMaterial({ map: notebookTexture, side: THREE.DoubleSide,
      transparent: true, depthTest: false, depthWrite: false })
  );
  notebookMesh.renderOrder = 1900;
  notebookMesh.frustumCulled = false;
  notebookMesh.visible = false;
  scene.add(notebookMesh);

  cursorMesh = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.015, 20),
    new THREE.MeshBasicMaterial({ color: 0x42eaff, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide }));
  cursorMesh.renderOrder = 2000;
  cursorMesh.visible = false;
  scene.add(cursorMesh);
  paintNotebook();
}

function openNotebook() {
  if (notebookOpen || !notebookMesh) return;
  notebookOpen = true;
  notebookPage = gameResult ? 'outcome' : (evidence.every(e => e.collected) ? 'deduce' : 'brief');
  notebookHover = null;
  notebookMesh.position.copy(headPosition)
    .add(new THREE.Vector3(0, -0.04, -1.12).applyQuaternion(headRotation));
  notebookMesh.quaternion.copy(headRotation);
  notebookMesh.visible = true;
  if (hud) hud.visible = false;
  paintNotebook();
}

function closeNotebook() {
  notebookOpen = false;
  notebookHover = null;
  if (notebookMesh) notebookMesh.visible = false;
  if (cursorMesh) cursorMesh.visible = false;
  if (hud) hud.visible = true;
  lastNotice = 'Notebook closed. Pinch empty space to reopen it.';
  noticeUntil = performance.now() + 2200;
}

function noteBox(x, y, w, h, color = '#111f2a', border = '#375368') {
  const c = notebookCtx;
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
  c.strokeStyle = border;
  c.lineWidth = 3;
  c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}

function noteText(text, x, y, width = 1150, size = 43, color = '#ecf5f8', lineHeight = 60, weight = 'normal') {
  const c = notebookCtx;
  c.font = weight + ' ' + size + 'px Arial';
  c.fillStyle = color;
  c.textAlign = 'left';
  c.textBaseline = 'top';
  const words = String(text).split(/\s+/);
  let line = '', cursorY = y;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (line && c.measureText(test).width > width) {
      c.fillText(line, x, cursorY);
      cursorY += lineHeight;
      line = word;
    } else line = test;
  }
  if (line) { c.fillText(line, x, cursorY); cursorY += lineHeight; }
  return cursorY;
}

function noteButton(id, label, x, y, w, h, tone = 'default') {
  const isHover = notebookHover === id;
  let bg = tone === 'danger' ? '#65242a' : (tone === 'action' ? '#164753' : '#1c2b3b');
  if (isHover) bg = '#22798a';
  noteBox(x, y, w, h, bg, isHover ? '#57f2fc' : '#7194a9');
  noteText(label, x + 19, y + (h - 42) / 2, w - 38, 38,
    isHover ? '#ffffff' : '#e8f4fc', 46, 'bold');
  notebookButtons.push({ id, x, y, w, h });
}

function paintNotebook() {
  if (!notebookCtx) return;
  const c = notebookCtx;
  notebookButtons = [];
  c.fillStyle = '#08131e';
  c.fillRect(0, 0, NOTE_W, NOTE_H);
  c.fillStyle = '#102c3a';
  c.fillRect(0, 0, NOTE_W, 135);
  c.fillStyle = '#fa4d58';
  c.fillRect(0, 0, 18, NOTE_H);
  noteText('CASEFILE  /  INVESTIGATION 01', 65, 23, 1100, 53, '#ecf7ff', 56, 'bold');
  noteText('AFTER THE PARTY  |  DALSTON, LONDON  |  NOV 2026', 68, 86, 1280, 29, '#8cd6e2', 32);
  const total = evidence.filter(e => e.collected).length;
  noteText('SCORE: ' + points + '   |   EVIDENCE: ' + total + '/3', 975, 33, 375, 34, '#f9d77d', 45, 'bold');

  noteButton('tab:brief', 'BRIEF', 68, 152, 240, 78);
  noteButton('tab:evidence', 'EVIDENCE', 327, 152, 315, 78);
  noteButton('tab:deduce', 'DEDUCTIONS', 660, 152, 348, 78);
  noteButton('tab:outcome', 'VERDICT', 1025, 152, 207, 78);
  noteButton('close', 'X', 1247, 152, 93, 78, 'danger');

  if (notebookPage === 'brief') paintBriefPage();
  else if (notebookPage === 'evidence') paintEvidencePage();
  else if (notebookPage === 'deduce') paintDeductionPage();
  else paintOutcomePage();

  noteBox(58, 936, 1282, 63, '#102333', '#456879');
  const footer = caseFeedback || 'LOOK at a notebook button, then PINCH. Select X to return to the crime scene.';
  noteText(footer, 77, 950, 1245, 31, '#f9d77d', 34, 'bold');
  notebookTexture.needsUpdate = true;
}

function paintBriefPage() {
  noteText('INCIDENT REPORT // 02:20', 75, 270, 1120, 53, '#ffdc89', 62, 'bold');
  noteText('Aaron Malik, 27, found dead after a house party in a Dalston flat. A knife, tablets and blood on a wall suggest competing explanations.',
    78, 348, 1230, 40, '#edf5f8', 55);
  noteBox(75, 515, 1230, 374);
  noteText('POLICE FILE / INITIAL LEADS', 100, 538, 1110, 43, '#62dae6', 54, 'bold');
  noteText('Mia Shah, flatmate: on a work call at 02:10. Ben Carter, DJ: left at 01:55. Lewis Ward, friend: says he left at 01:40, but the entry log records his return at 02:09.',
    100, 602, 1160, 39, '#e5eef5', 52);
  noteText('Neighbour heard two men arguing and a crash around 02:11. The first pathology note reports blunt-force head trauma, no stab wounds, and nonfatal drug traces.',
    100, 752, 1160, 36, '#dbeaf4', 49);
}

function paintEvidencePage() {
  noteText('BAGGED EVIDENCE // SELECT TO INSPECT', 75, 273, 1220, 51, '#ffdc89', 59, 'bold');
  const labels = [
    ['table', '01  /  PILL BOTTLE'],
    ['floor', '02  /  KITCHEN KNIFE'],
    ['wall', '03  /  WALL BLOOD']
  ];
  for (let i = 0; i < labels.length; i++) {
    const [id, title] = labels[i];
    const found = evidence.find(e => e.id === id)?.collected;
    noteButton('clue:' + id, (found ? 'FILED  ' : 'MISSING  ') + title, 76, 371 + i * 114, 575, 94);
  }
  noteBox(685, 369, 624, 476);
  const item = CASE_EVIDENCE[notebookSelectedClue];
  const collected = evidence.find(e => e.id === notebookSelectedClue)?.collected;
  noteText(item.title, 707, 391, 565, 40, '#6eeafa', 50, 'bold');
  noteText(collected ? item.text : 'Not yet collected. Look for it on the matching real-world surface and pinch to pick it up.',
    710, 475, 550, 31, '#eaf4f8', 43);
  if (collected) noteText(item.report, 710, 652, 550, 29, '#ffd18b', 41);
  noteBox(75, 856, 1234, 63, '#102a36');
  noteText('TIP: Pills do not prove an overdose. A knife does not prove stabbing. Compare all three findings with the police file.',
    96, 866, 1170, 30, '#edfbff', 34);
}

function paintDeductionPage() {
  if (gameResult) {
    noteText('CASE COMPLETE', 75, 299, 1140, 58, '#ffdc89', 65, 'bold');
    noteText('Your verdict is already recorded. Open the VERDICT tab to review the result or replay the case.',
      80, 405, 1190, 43, '#eaf5f8', 58);
    return;
  }
  if (evidence.some(e => !e.collected)) {
    noteText('INVESTIGATION NOT COMPLETE', 77, 300, 1240, 55, '#ffdc89', 65, 'bold');
    noteText('Collect all three physical clues before making deductions. The police briefing and notebook are already available for review.',
      80, 412, 1210, 45, '#eef7fa', 63);
    noteText('Collected: ' + evidence.filter(e => e.collected).map(e => e.name).join(', '),
      80, 610, 1190, 39, '#7ae3ee', 53);
    return;
  }
  const q = QUESTIONS[deductionStep];
  if (accusationConfirm !== null) {
    noteText('FINAL ACCUSATION — CONFIRM', 76, 286, 1230, 51, '#ffdc89', 60, 'bold');
    noteText('You are about to accuse ' + SUSPECTS[accusationConfirm] + '. A wrong accusation FAILS the investigation.',
      80, 392, 1210, 42, '#eff7fa', 59);
    noteButton('confirm:accuse', 'CONFIRM ACCUSATION', 82, 595, 760, 100, 'danger');
    noteButton('confirm:back', 'GO BACK', 880, 595, 425, 100);
    return;
  }
  noteText(q.title, 74, 271, 1210, 55, '#ffdc89', 62, 'bold');
  noteText(q.question, 79, 353, 1180, 44, '#eaf7fb', 59);
  for (let i = 0; i < 3; i++) {
    noteButton('answer:' + i, String.fromCharCode(65 + i) + ' / ' + q.answers[i],
      78, 478 + i * 123, 1220, 101, i === 2 ? 'action' : 'default');
  }
  if (deductionStep === 2) noteText('Warning: an incorrect suspect ends this attempt.', 79, 880, 1150, 36, '#ff9b9b', 43);
}

function paintOutcomePage() {
  if (!gameResult) {
    noteText('VERDICT SEALED', 80, 292, 1190, 61, '#ffdc89', 65, 'bold');
    noteText('Gather the three clues, then complete the questions in DEDUCTIONS to file your verdict.',
      81, 420, 1170, 46, '#e8f2f8', 63);
    return;
  }
  const succeeded = gameResult === 'solved';
  noteText(succeeded ? 'CASE CLOSED / CORRECT VERDICT' : 'INVESTIGATION FAILED',
    74, 277, 1230, 56, succeeded ? '#84f0bd' : '#ff9297', 65, 'bold');
  noteText(succeeded ? 'Lewis Ward attacked Aaron after returning to the flat. The head injury was fatal; the pills and knife were misleading clues.'
    : 'The wrong person was accused. The real killer remains free. Review the entry log, the neighbour account and the pathology note.',
    80, 389, 1210, 46, '#eef6f8', 65);
  noteText('FINAL SCORE: ' + points + '/100  |  ' + (succeeded ? (points >= 85 ? 'THREE STARS' : points >= 65 ? 'TWO STARS' : 'ONE STAR') : 'FAILED'),
    79, 644, 1185, 46, '#ffdc89', 58, 'bold');
  noteButton('replay', 'REPLAY CASE', 78, 754, 620, 116, 'action');
  noteButton('tab:evidence', 'REVIEW EVIDENCE', 728, 754, 574, 116);
}

function updateNotebookGaze() {
  if (!notebookOpen || !notebookMesh) return;
  noteRaycaster.set(headPosition, gazeDirection);
  noteRaycaster.near = 0.1;
  noteRaycaster.far = 2.0;
  const hit = noteRaycaster.intersectObject(notebookMesh, false)[0];
  let hover = null;
  if (hit && hit.uv) {
    const px = hit.uv.x * NOTE_W;
    const py = (1 - hit.uv.y) * NOTE_H;
    const match = notebookButtons.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
    hover = match ? match.id : null;
    cursorMesh.visible = true;
    cursorMesh.position.copy(hit.point).addScaledVector(gazeDirection, -0.015);
    cursorMesh.quaternion.copy(notebookMesh.quaternion);
  } else cursorMesh.visible = false;
  if (hover !== notebookHover) { notebookHover = hover; paintNotebook(); }
}

function activateNotebookButton(id) {
  caseFeedback = '';
  if (id === 'close') { closeNotebook(); return; }
  if (id.startsWith('tab:')) {
    notebookPage = id.slice(4);
    accusationConfirm = null;
    paintNotebook();
    return;
  }
  if (id.startsWith('clue:')) {
    notebookSelectedClue = id.slice(5);
    paintNotebook();
    return;
  }
  if (id === 'confirm:back') {
    accusationConfirm = null;
    paintNotebook();
    return;
  }
  if (id === 'confirm:accuse') {
    const suspected = accusationConfirm;
    accusationConfirm = null;
    if (suspected === QUESTIONS[2].correct) {
      gameResult = 'solved';
      caseFeedback = 'Correct suspect identified. Case solved.';
    } else {
      points = Math.max(0, points - 50);
      gameResult = 'failed';
      caseFeedback = 'Wrong person accused. Investigation failed.';
    }
    notebookPage = 'outcome';
    paintNotebook();
    return;
  }
  if (id.startsWith('answer:') && !gameResult && evidence.every(e => e.collected)) {
    const choice = Number(id.slice(7));
    const q = QUESTIONS[deductionStep];
    if (deductionStep === 2) {
      accusationConfirm = choice;
    } else if (choice === q.correct) {
      deductionStep++;
      caseFeedback = 'Correct. ' + q.proof;
    } else {
      const key = deductionStep + ':' + choice;
      if (!wrongDeductions.has(key)) {
        wrongDeductions.add(key);
        points = Math.max(0, points - q.cost);
      }
      caseFeedback = 'Incorrect (-' + q.cost + ' first time). Recheck the police file.';
    }
    paintNotebook();
    return;
  }
  if (id === 'replay') {
    points = 100;
    deductionStep = 0;
    gameResult = null;
    caseFeedback = 'Case reset. Collect the evidence again.';
    wrongDeductions.clear();
    accusationConfirm = null;
    for (const item of evidence) {
      item.collected = false;
      item.group.visible = item.placed;
      if (item.ring) item.ring.visible = true;
      if (item.surfacePosition) item.group.position.copy(item.surfacePosition);
      if (item.surfaceQuaternion) item.group.quaternion.copy(item.surfaceQuaternion);
    }
    notebookPage = 'brief';
    paintNotebook();
  }
}

function onFrame(now, frame) {
  if (!frame) return;
  frameNumber++;
  const viewerPose = frame.getViewerPose(refSpace);
  if (viewerPose) {
    updateHeadAndHUD(viewerPose);
    considerPlacement(frame, now);
    gazeTarget = notebookOpen ? null : getGazeTarget();
    if (notebookOpen) updateNotebookGaze();
  }
  processHands(frame);
  if (frameNumber % 8 === 0) updateFeedback(now);
  renderer.render(scene, camera);
}
