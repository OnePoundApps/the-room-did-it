import * as THREE from 'three';

// THE ROOM DID IT — Day 1, v6 (hands-first pickup test)
// Works with the existing index.html and its Three.js import map.
const startBtn = document.getElementById('startBtn');
const overlay = document.getElementById('overlay');

let renderer, scene, camera, session, refSpace, viewerSpace, hitSource;
let marker, gem, ring, hud, hudCtx, hudTexture;
let startedAt = 0, placedBy = 'SCANNING', collected = false;
let grabbedBy = null, grabMethod = '', frameNumber = 0, pinchCount = 0;
let lastNotice = 'Look at your table. A yellow diamond will appear.';
let noticeUntil = 0, gazeOnMarker = false;
let inputCount = 0, trackedHands = 0, poseHands = 0;
let leftPinch = '-', rightPinch = '-', closestHand = '-';
const handStates = new WeakMap();

const GRAB_DISTANCE = 0.26;  // 26 cm: a comfortable direct-grab zone
const PINCH_DOWN = 0.047;    // 4.7 cm between thumb and index tips
const PINCH_UP = 0.070;      // release threshold: prevents flickering

const headPosition = new THREE.Vector3();
const headRotation = new THREE.Quaternion();
const gazeDirection = new THREE.Vector3();
const diamondPosition = new THREE.Vector3();
const temp = new THREE.Vector3();

startBtn.addEventListener('click', startAR);

async function startAR() {
  startBtn.disabled = true;
  if (!navigator.xr) {
    startBtn.textContent = 'WebXR is not available';
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
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.5));

    // Hand tracking is REQUIRED, so the app never silently starts without it.
    // Plane detection and hit-test can fail independently without losing hands.
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor', 'hand-tracking'],
      optionalFeatures: ['hit-test', 'plane-detection']
    });

    // setSession() is ASYNCHRONOUS in Three.js. Await the XR setup.
    await renderer.xr.setSession(session);
    refSpace = renderer.xr.getReferenceSpace() || await session.requestReferenceSpace('local-floor');

    try {
      viewerSpace = await session.requestReferenceSpace('viewer');
      hitSource = await session.requestHitTestSource({ space: viewerSpace });
    } catch (err) {
      hitSource = null; // A timed near-head fallback keeps the test usable.
      console.warn('Hit-test unavailable; using planes or fallback:', err);
    }

    buildMarker();
    buildHUD();
    startedAt = performance.now();
    startBtn.style.display = 'none';

    // Native WebXR select events act as a backup to fingertip-distance pinch.
    session.addEventListener('selectstart', event => {
      if (!event.inputSource?.hand) return; // no controller dependency
      attemptGrab(event.inputSource, 'XR SELECT');
    });
    session.addEventListener('selectend', event => {
      if (event.inputSource === grabbedBy) finishGrab();
    });
    session.addEventListener('end', () => {
      renderer.setAnimationLoop(null);
      hitSource?.cancel?.();
      startBtn.style.display = '';
      startBtn.disabled = false;
      startBtn.textContent = 'ENTER THE CRIME SCENE';
    });

    renderer.setAnimationLoop(onFrame);
  } catch (err) {
    console.error('WebXR startup failed:', err);
    startBtn.style.display = '';
    startBtn.textContent = 'AR / hands failed: ' + (err?.message || err);
    if (overlay) overlay.textContent = 'Hand-tracking session failed: ' + (err?.message || err);
    startBtn.disabled = false;
    if (session && !renderer?.xr?.isPresenting) {
      try { await session.end(); } catch (_) { /* nothing to close */ }
    }
  }
}

function buildMarker() {
  marker = new THREE.Group();
  gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.075),
    new THREE.MeshStandardMaterial({
      color: 0xf5c518, emissive: 0x715200, emissiveIntensity: 0.7,
      metalness: 0.12, roughness: 0.25
    })
  );
  gem.position.y = 0.085;
  ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.145, 0.009, 12, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  ring.rotation.x = -Math.PI / 2;
  marker.add(gem, ring);
  marker.visible = false;
  scene.add(marker);
}

function buildHUD() {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 432;
  hudCtx = canvas.getContext('2d');
  hudTexture = new THREE.CanvasTexture(canvas);
  hud = new THREE.Mesh(
    new THREE.PlaneGeometry(1.09, 0.306),
    new THREE.MeshBasicMaterial({
      map: hudTexture, transparent: true, depthTest: false,
      depthWrite: false, side: THREE.DoubleSide
    })
  );
  hud.renderOrder = 1000;
  hud.frustumCulled = false;
  scene.add(hud);
  paintHUD(['THE ROOM DID IT  |  PINCH TEST', 'Scanning your room for a table...', 'Hold your hands up with controllers put aside']);
}

function paintHUD(lines) {
  hudCtx.clearRect(0, 0, 1536, 432);
  hudCtx.fillStyle = 'rgba(9, 15, 24, 0.84)';
  hudCtx.fillRect(0, 0, 1536, 432);
  hudCtx.strokeStyle = '#f5c518';
  hudCtx.lineWidth = 8;
  hudCtx.strokeRect(4, 4, 1528, 424);
  hudCtx.textAlign = 'center';
  hudCtx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    hudCtx.fillStyle = i === 0 ? '#f5c518' : '#ffffff';
    hudCtx.font = i === 0 ? 'bold 58px Arial' : 'bold 52px Arial';
    hudCtx.fillText(line, 768, 76 + i * 136, 1460);
  });
  hudTexture.needsUpdate = true;
  if (overlay) overlay.textContent = lines.join(' | ');
}

function updateHeadAndHUD(viewerPose) {
  if (!viewerPose) return;
  const p = viewerPose.transform.position;
  const q = viewerPose.transform.orientation;
  headPosition.set(p.x, p.y, p.z);
  headRotation.set(q.x, q.y, q.z, q.w);
  gazeDirection.set(0, 0, -1).applyQuaternion(headRotation).normalize();
  // A genuine in-world 3D panel, following the actual XR viewer pose.
  hud.position.copy(headPosition).add(
    temp.set(0, -0.25, -0.98).applyQuaternion(headRotation)
  );
  hud.quaternion.copy(headRotation);
}

function placeEvidence(frame, now) {
  if (marker.visible) return; // FREEZE the evidence: no jumping around each frame.

  let spot = null;
  let method = '';

  // Hit-test works when looking at a real table.
  if (hitSource) {
    try {
      for (const hit of frame.getHitTestResults(hitSource)) {
        const pose = hit.getPose(refSpace);
        if (!pose) continue;
        const p = pose.transform.position;
        temp.set(p.x, p.y, p.z);
        const range = temp.distanceTo(headPosition);
        if (p.y >= 0.4 && p.y <= 1.3 && range > 0.28 && range < 1.40) {
          spot = temp.clone(); method = 'TABLE HIT'; break;
        }
      }
    } catch (err) {
      console.warn('Hit-test frame error:', err);
    }
  }

  // Use horizontal planes if hit-testing did not find a close surface.
  if (!spot && frame.detectedPlanes) {
    let nearest = Infinity;
    for (const plane of frame.detectedPlanes) {
      if (plane.orientation !== 'horizontal') continue;
      const pose = frame.getPose(plane.planeSpace, refSpace);
      if (!pose) continue;
      const p = pose.transform.position;
      temp.set(p.x, p.y, p.z);
      const range = temp.distanceTo(headPosition);
      if (p.y >= 0.4 && p.y <= 1.3 && range > 0.28 && range < 1.30 && range < nearest) {
        spot = temp.clone(); nearest = range; method = 'TABLE PLANE';
      }
    }
  }

  // Guaranteed visible, comfortable test target even if room APIs find nothing.
  if (!spot && now - startedAt > 3500 && frame.getViewerPose(refSpace)) {
    spot = headPosition.clone().add(
      new THREE.Vector3(0, -0.23, -0.70).applyQuaternion(headRotation)
    );
    spot.y = Math.max(0.48, spot.y);
    method = 'SEATED FALLBACK';
  }

  if (spot) {
    marker.position.copy(spot);
    marker.visible = true;
    placedBy = method;
    lastNotice = 'Look at the diamond, then pinch your fingers together';
  }
}

function getDiamondPosition() {
  return diamondPosition.copy(marker.position).add(new THREE.Vector3(0, gem.position.y, 0));
}

function isLookingAtMarker() {
  if (!marker?.visible || collected || grabbedBy) return false;
  const toGem = getDiamondPosition().clone().sub(headPosition);
  const alongRay = toGem.dot(gazeDirection);
  if (alongRay < 0.16 || alongRay > 1.80) return false;
  const sideways = toGem.addScaledVector(gazeDirection, -alongRay).length();
  return sideways < Math.max(0.17, alongRay * 0.22);
}

function getHandState(src) {
  let state = handStates.get(src);
  if (!state) {
    state = { closed: false, near: Infinity, midpoint: new THREE.Vector3(),
      hasPose: false, distance: Infinity };
    handStates.set(src, state);
  }
  return state;
}

function attemptGrab(src, method) {
  if (!marker?.visible || collected || grabbedBy) return;
  pinchCount++;
  const state = getHandState(src);
  const nearby = state.hasPose && state.near <= GRAB_DISTANCE;
  if (!nearby && !gazeOnMarker) {
    lastNotice = 'PINCH DETECTED! Now LOOK at the diamond and pinch again';
    noticeUntil = performance.now() + 2600;
    return;
  }

  grabbedBy = src;
  grabMethod = nearby ? 'DIRECT HAND GRAB' : 'GAZE + HAND PINCH';
  gem.material.color.set(0x48dcff);
  gem.material.emissive.set(0x004f69);
  ring.visible = false;
  gem.position.y = 0;
  if (state.hasPose) marker.position.copy(state.midpoint);
  lastNotice = 'GRABBED! Move your hand, then RELEASE your pinch';
  noticeUntil = 0;
  console.info('Evidence grabbed via', grabMethod, method);
}

function finishGrab() {
  if (!grabbedBy || collected) return;
  grabbedBy = null;
  collected = true;
  gem.material.color.set(0x45f29a);
  gem.material.emissive.set(0x0a7438);
  gem.scale.setScalar(1.3);
  lastNotice = 'SUCCESS: You grabbed, moved and released the evidence!';
  console.info('Evidence collected! Method:', grabMethod);
}

function processHands(frame) {
  inputCount = 0;
  trackedHands = 0;
  poseHands = 0;
  leftPinch = '-';
  rightPinch = '-';
  let bestNear = Infinity;

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
      console.warn('Joint pose unavailable:', err);
      continue;
    }
    if (!thumb || !index) continue;
    state.hasPose = true;
    poseHands++;

    const a = thumb.transform.position;
    const b = index.transform.position;
    const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    state.distance = dist;
    state.midpoint.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    state.near = marker.visible && !collected && !grabbedBy
      ? state.midpoint.distanceTo(getDiamondPosition())
      : Infinity;
    bestNear = Math.min(bestNear, state.near);
    if (src.handedness === 'left') leftPinch = dist.toFixed(3) + 'm';
    if (src.handedness === 'right') rightPinch = dist.toFixed(3) + 'm';

    // Two thresholds (hysteresis) prevent repeated triggers from hand jitter.
    if (!state.closed && dist <= PINCH_DOWN) {
      state.closed = true;
      attemptGrab(src, 'JOINT DISTANCE');
    } else if (state.closed && dist >= PINCH_UP) {
      state.closed = false;
      if (grabbedBy === src) finishGrab();
    }

    if (grabbedBy === src && !collected) {
      // This is an actual 3D pick-up: the diamond FOLLOWS the pinched fingers.
      marker.position.lerp(state.midpoint, 0.5);
    }
  }
  closestHand = bestNear < Infinity ? bestNear.toFixed(2) + 'm' : '-';
}

function updateFeedback(now) {
  if (!marker.visible) {
    paintHUD([
      'THE ROOM DID IT  |  PINCH TEST',
      'Hands: ' + trackedHands + '   Joint poses: ' + poseHands + '   Sources: ' + inputCount,
      'Look toward the table. Marker appears in a few seconds.'
    ]);
    return;
  }

  if (collected) {
    paintHUD([
      'EVIDENCE COLLECTED!',
      'You grabbed and released the diamond successfully.',
      'Method: ' + grabMethod + '  |  Day 1 hand test PASSED'
    ]);
    return;
  }

  if (grabbedBy) {
    paintHUD([
      'YOU ARE HOLDING THE EVIDENCE!',
      'The diamond follows your pinching fingers.',
      'Release your thumb and index finger to collect it.'
    ]);
    return;
  }

  gem.material.color.set(gazeOnMarker ? 0x56edff : 0xf5c518);
  gem.material.emissive.set(gazeOnMarker ? 0x064755 : 0x715200);

  const reminder = trackedHands === 0
    ? 'NO HANDS: put controllers down and raise your hands'
    : poseHands === 0
      ? 'HAND SOURCES SEEN, BUT NO JOINT POSES. Report this.'
      : now < noticeUntil ? lastNotice
        : (gazeOnMarker ? 'TARGET READY: pinch with either hand!'
          : 'LOOK at the yellow diamond, then PINCH to pick it up');

  paintHUD([
    'HANDS ' + trackedHands + '  |  JOINTS ' + poseHands + '  |  PINCHES ' + pinchCount,
    'L ' + leftPinch + '  R ' + rightPinch + '  Near ' + closestHand + '  Gaze ' + (gazeOnMarker ? 'YES' : 'no'),
    reminder
  ]);
}

function onFrame(now, frame) {
  if (!frame) return;
  frameNumber++;

  // Use the SAME XR reference space for hands, head, marker, and geometry.
  const viewerPose = frame.getViewerPose(refSpace);
  if (viewerPose) updateHeadAndHUD(viewerPose);
  if (viewerPose && !marker.visible) placeEvidence(frame, now);

  if (marker.visible && !collected && !grabbedBy) {
    marker.rotation.y += 0.007;
  }
  gazeOnMarker = viewerPose ? isLookingAtMarker() : false;
  processHands(frame);

  if (frameNumber % 8 === 0) updateFeedback(now);
  renderer.render(scene, camera);
}
