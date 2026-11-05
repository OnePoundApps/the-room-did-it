import * as THREE from 'three';

// THE ROOM DID IT — v9 / After the Party: realistic procedural props + accessible notebook.
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
const NOTE_W = 1536, NOTE_H = 1080;
const NOTE_WORLD_W = 1.48, NOTE_WORLD_H = 1.04;
const notebookPages = ['brief', 'evidence', 'suspects', 'deduce', 'outcome'];
const gloveMeshes = new WeakMap();
const gloveEntries = [];
const jointBallGeometry = new THREE.SphereGeometry(1, 10, 8);
const jointTubeGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
const gloveMaterial = new THREE.MeshStandardMaterial({ color: 0x84c9dc, roughness: 0.83, metalness: 0, transparent: true, opacity: 0.88, depthWrite: false });
const boneUp = new THREE.Vector3(0, 1, 0);
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

// Reusable canvas textures are bundled into main.js — no extra assets or network requests.
function makeTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  return tex;
}

function rngFactory(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeDrugBag() {
  const g = new THREE.Group();
  const clearFilm = new THREE.MeshPhysicalMaterial({ color: 0xe2edf3, roughness: .24,
    metalness: 0, transparent: true, opacity: .37, side: THREE.DoubleSide,
    depthWrite: false, clearcoat: .78, clearcoatRoughness: .17 });
  const seed = rngFactory(44226);
  const powderMap = makeTexture(768, 768, (c,w,h) => {
    c.clearRect(0,0,w,h);
    for (let i=0;i<5900;i++) {
      const a=seed()*Math.PI*2, r=Math.sqrt(seed());
      const x=w*.5+Math.cos(a)*r*w*.34, y=h*.68+Math.sin(a)*r*h*.22;
      const q=seed(); c.fillStyle=q>.6?'rgba(241,244,237,.82)':'rgba(199,203,201,.75)';
      c.beginPath(); c.arc(x,y,0.7+seed()*2.5,0,Math.PI*2); c.fill();
    }
    c.fillStyle='rgba(248,250,244,.42)';
    for(let i=0;i<350;i++) { const x=seed()*w,y=seed()*h;
      c.fillRect(x,y,1.5,1.5); }
  });
  const powder = new THREE.Mesh(new THREE.PlaneGeometry(.14,.135),
    new THREE.MeshBasicMaterial({ map:powderMap,transparent:true,depthWrite:false,side:THREE.DoubleSide }));
  powder.rotation.x=-Math.PI/2; powder.position.y=.005; g.add(powder);
  const bagShape = new THREE.Shape();
  bagShape.moveTo(-.081,-.079); bagShape.lineTo(.081,-.079);
  bagShape.lineTo(.080,.084); bagShape.lineTo(-.078,.089);bagShape.closePath();
  const filmGeom = new THREE.ShapeGeometry(bagShape,12);
  const film = new THREE.Mesh(filmGeom,clearFilm);
  film.rotation.x=-Math.PI/2; film.position.y=.008;
  g.add(film);
  const seamMat = makeMaterial(0xcadce1,{roughness:.25,transparent:true,opacity:.56});
  function wire(points, rad, mat){ const path=new THREE.CatmullRomCurve3(points.map(x=>new THREE.Vector3(...x)));
    return new THREE.Mesh(new THREE.TubeGeometry(path,16,rad,5,false),mat); }
  g.add(wire([[-.080,.011,-.080],[.0,.012,-.078],[.079,.011,-.080]],.0017,seamMat));
  g.add(wire([[-.080,.012,.078],[.0,.012,.081],[.080,.012,.080]],.0022,seamMat));
  g.add(wire([[-.076,.014,.062],[0,.015,.061],[.076,.014,.060]],.0026,
    new THREE.MeshStandardMaterial({color:0x266ab4,transparent:true,opacity:.75,roughness:.34})));
  // Small soft reflections emphasise that this is a clear plastic wrap, not a medicine bottle.
  for (let i=0;i<5;i++) {
    const crease = wire([[-.07+seed()*.11,.014,-.045+seed()*.11],[-.06+seed()*.1,.014,-.03+seed()*.1]],.00065,
      new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.45}));
    g.add(crease);
  }
  g.rotation.y=-.25;
  addBaseRing(g,0xf5c518,.14);
  return g;
}

function makeKnife() {
  const g = new THREE.Group();
  // Bevelled stainless-steel profile with a pointed chef's knife tip.
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-.005,-.019);bladeShape.lineTo(.092,-.021);
  bladeShape.quadraticCurveTo(.146,-.017,.185,-.002);
  bladeShape.lineTo(.111,.020);bladeShape.lineTo(-.005,.011);bladeShape.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bladeShape,{
    depth:.003, bevelEnabled:true, bevelSegments:2,steps:1,bevelThickness:.0013,bevelSize:.0018}),
    new THREE.MeshPhysicalMaterial({color:0xb8c2c8,metalness:.97,roughness:.23,
      clearcoat:.35,clearcoatRoughness:.19}));
  blade.rotation.x=-Math.PI/2;blade.position.set(-.002,.013,0);
  g.add(blade);
  const handleShape=new THREE.Shape();
  handleShape.moveTo(-.125,-.019);handleShape.quadraticCurveTo(-.14,-.018,-.14,0);
  handleShape.quadraticCurveTo(-.14,.019,-.120,.021);
  handleShape.lineTo(-.004,.016);handleShape.lineTo(-.004,-.016);handleShape.closePath();
  const handle = new THREE.Mesh(new THREE.ExtrudeGeometry(handleShape,{
    depth:.012,bevelEnabled:true,bevelThickness:.004,bevelSize:.003,bevelSegments:3}),
    makeMaterial(0x11171b,{roughness:.48,metalness:.12}));
  handle.rotation.x=-Math.PI/2;handle.position.set(0,.022,0);g.add(handle);
  const rivetMat = makeMaterial(0xb6b9b7,{metalness:.78,roughness:.31});
  for (const x of [-.105,-.049]){
    const rivet=new THREE.Mesh(new THREE.SphereGeometry(.0045,10,8),rivetMat);
    rivet.scale.set(1,.3,1);rivet.position.set(x,.034,0);g.add(rivet);
  }
  g.rotation.y=.25;
  addBaseRing(g,0xf5c518,.18); return g;
}

function makeBloodTrace() {
  const g=new THREE.Group();
  const seed=rngFactory(14062);
  const tex=makeTexture(1024,1024,(c,w,h)=>{
    c.clearRect(0,0,w,h);
    // Contact pattern and dispersed trace, not oversized cartoon circles.
    c.save();c.translate(490,490);c.rotate(-.32);
    for(let i=0;i<620;i++){
      const a=seed()*Math.PI*2,r=Math.sqrt(seed());
      const x=Math.cos(a)*r*(110+seed()*65),y=Math.sin(a)*r*(75+seed()*48);
      const rad=(seed()<.06?5:1)+seed()*7;
      c.fillStyle=`rgba(${85+Math.floor(seed()*35)},${9+Math.floor(seed()*13)},${18+Math.floor(seed()*12)},${.16+seed()*.64})`;
      c.beginPath();c.ellipse(x,y,rad*(1+seed()),rad*(.35+seed()),-0.4,0,Math.PI*2);c.fill();
    }
    for(let i=0;i<180;i++){
      const a=seed()*Math.PI*2, r=120+seed()*315;
      c.fillStyle=`rgba(101,14,24,${.2+seed()*.45})`;
      c.beginPath();c.ellipse(Math.cos(a)*r,Math.sin(a)*r*.7,1+seed()*3,1+seed()*4,a,0,Math.PI*2);c.fill();
    }
    c.restore();
  });
  const decal=new THREE.Mesh(new THREE.PlaneGeometry(.37,.37),
    new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide,
      alphaTest:.045,depthWrite:false}));
  decal.rotation.x=-Math.PI/2;decal.position.y=.003;
  g.add(decal);addBaseRing(g,0xf5c518,.215);return g;
}

function makePhone() {
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(.077,.009,.145),
    new THREE.MeshPhysicalMaterial({color:0x10141a,metalness:.63,roughness:.32,clearcoat:.7}));
  body.position.y=.008;g.add(body);
  const screenTex=makeTexture(512,1024,(c,w,h)=>{
    c.fillStyle='#0c101b';c.fillRect(0,0,w,h);
    c.textAlign='center';c.fillStyle='#f0f4fa';c.font='bold 62px Arial';c.fillText('02:12',256,125);
    c.font='30px Arial';c.fillText('SUN 08 NOV',256,168);
    c.fillStyle='#23475a';c.fillRect(38,315,430,315);
    c.textAlign='left';c.fillStyle='#b8e7ed';c.font='bold 33px Arial';c.fillText('LEWIS',65,365);
    c.font='30px Arial';c.fillStyle='#ffffff';
    c.fillText('I came back.',65,426);c.fillText('Please don\'t tell Mia.',65,482);
    c.fillStyle='#abb4be';c.font='25px Arial';c.fillText('02:09',65,572);
  });
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(.068,.135),
    new THREE.MeshBasicMaterial({map:screenTex,depthWrite:false}));
  screen.rotation.x=-Math.PI/2;screen.position.y=.013;g.add(screen);
  const cam=new THREE.Mesh(new THREE.CircleGeometry(.003,12),makeMaterial(0x252d36));
  cam.rotation.x=-Math.PI/2;cam.position.set(0,.014,-.065);g.add(cam);
  return g;
}

function buildEvidence() {
  const definitions = [
    { id:'table', name:'PARTY DRUG WRAP', surface:'TABLE / SOFA', group:makeDrugBag(), action:'collect' },
    { id:'floor', name:'KITCHEN KNIFE', surface:'FLOOR', group:makeKnife(), action:'collect' },
    { id:'wall', name:'BLOOD PATTERN', surface:'WALL', group:makeBloodTrace(), action:'document' }
  ];
  for(const d of definitions){
    d.group.visible=false;d.group.userData.evidenceId=d.id;
    d.placed=false;d.collected=false;d.placedBy='';d.ring=d.group.userData.ring;
    scene.add(d.group);evidence.push(d);
  }
  // Phone is a contextual prop, not an extra required clue. It is placed beside
  // the drug wrap on the same detected furniture surface and read in the notebook.
  const phone=makePhone();phone.visible=false;scene.add(phone);
  scene.userData.partyPhone=phone;
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
    'Look + pinch objects. Blood = photograph, do not pick up.']);
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
  if (item.id === 'table' && scene.userData.partyPhone) {
    const phone = scene.userData.partyPhone;
    phone.position.copy(item.group.position).add(new THREE.Vector3(.20, .005, 0).applyQuaternion(quat));
    phone.quaternion.copy(quat);
    phone.visible = true;
  }
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
    const hit = notebookTouchTarget(state) || notebookHover;
    if (hit) activateNotebookButton(hit);
    else { caseFeedback = 'LOOK AT A NOTEBOOK BUTTON, THEN PINCH'; paintNotebook(); }
    return;
  }
  if (gameResult) { openNotebook(); return; }
  if (grabbedBy) return;
  const direct = state.hasPose && state.near <= GRAB_DISTANCE ? state.nearItem : null;
  const item = direct || gazeTarget;
  if (!item || item.collected) { openNotebook(); return; }

  if (item.action === 'document') {
    item.collected = true;
    if (item.ring) item.ring.visible = false;
    // Leave the blood on the actual wall: a forensic trace isn't a handheld object.
    lastNotice = 'BLOOD PHOTOGRAPHED + SWAB RECORDED IN CASEFILE';
    noticeUntil = performance.now() + 3500;
    if (evidence.every(e => e.collected)) openNotebook();
    return;
  }
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
  // Hide stale glove meshes when the headset temporarily loses a tracked hand.
  for (const model of gloveEntries) {
    model.palm.visible = false;
    for (const seg of model.pieces) seg.mesh.visible = false;
  }
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
    updateGlove(frame,src);
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
      'Gloves on. Move hand to inspect. RELEASE to bag evidence.',
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
      gazeTarget ? 'LOOKING AT ' + gazeTarget.name + (gazeTarget.action === 'document' ? ' — PINCH TO DOCUMENT' : ' — PINCH TO BAG')
        : (awaiting ? 'SCAN: ' + awaiting + ' | PINCH EMPTY SPACE FOR NOTEBOOK'
          : 'All clues placed. PINCH EMPTY space for notebook.')]);
  }
  for (const item of evidence) {
    if (item.ring && item.placed && !item.collected && item !== grabbedEvidence) {
      item.ring.material.color.set(item === gazeTarget ? 0x56edff : 0xf5c518);
    }
  }
}

// Lightweight procedural nitrile-glove overlay. Optical passthrough hands remain
// visible underneath on browsers without hand/environment occlusion support.
const gloveChains = [
  ['wrist','thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip'],
  ['wrist','index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip'],
  ['wrist','middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip'],
  ['wrist','ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip'],
  ['wrist','pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip']
];
function buildGlove(src) {
  const pieces=[];
  for(const chain of gloveChains){
    for(let j=0;j<chain.length-1;j++){
      const tube=new THREE.Mesh(jointTubeGeometry,gloveMaterial);
      tube.visible=false;tube.renderOrder=60;scene.add(tube);
      pieces.push({from:chain[j],to:chain[j+1],mesh:tube,
        radius:j===0?.011:(j>=chain.length-3?.006:.0085)});
    }
  }
  const palm=new THREE.Mesh(jointBallGeometry,gloveMaterial);
  palm.visible=false;palm.renderOrder=60;scene.add(palm);
  const obj={pieces,palm};gloveMeshes.set(src,obj);gloveEntries.push(obj);return obj;
}
function updateGlove(frame,src){
  const obj=gloveMeshes.get(src)||buildGlove(src);
  const cached=new Map();
  function poseOf(name){
    if(cached.has(name))return cached.get(name);
    const joint=src.hand.get(name);let v=null;
    if(joint){ try {const pose=frame.getJointPose(joint,refSpace);
      if(pose) {const p=pose.transform.position;v=new THREE.Vector3(p.x,p.y,p.z);} } catch(_){} }
    cached.set(name,v);return v;
  }
  for(const seg of obj.pieces){
    const a=poseOf(seg.from),b=poseOf(seg.to);
    seg.mesh.visible=!!(a&&b);
    if(!a||!b)continue;
    const diff=b.clone().sub(a),length=diff.length();
    if(length<.001){seg.mesh.visible=false;continue;}
    seg.mesh.position.copy(a).addScaledVector(diff,.5);
    seg.mesh.quaternion.setFromUnitVectors(boneUp,diff.multiplyScalar(1/length));
    seg.mesh.scale.set(seg.radius,length,seg.radius);
  }
  const wrist=poseOf('wrist'),index=poseOf('index-finger-metacarpal'),
    middle=poseOf('middle-finger-metacarpal'),pinky=poseOf('pinky-finger-metacarpal');
  obj.palm.visible=!!(wrist&&index&&middle&&pinky);
  if(obj.palm.visible){
    obj.palm.position.copy(wrist).lerp(middle,.60);
    obj.palm.scale.set(.045,.013,.056);
    const right=index.clone().sub(pinky).normalize(),forward=middle.clone().sub(wrist).normalize();
    const n=new THREE.Vector3().crossVectors(right,forward).normalize();
    const m=new THREE.Matrix4().makeBasis(right,n,forward);
    obj.palm.quaternion.setFromRotationMatrix(m);
  }
}

// ---------------- CASE 01: AFTER THE PARTY ----------------
// All scene surfaces and hand-grab mechanics above are inherited from v7.
// The notebook is a world-locked WebGL canvas. It needs no DOM overlay/controllers.
const CASE_EVIDENCE = {
  table: {
    title: 'DRUG WRAP / POWDER',
    text: 'A transparent wrap containing an unidentified powder was found among drinks. Appearance alone does not identify the substance or prove overdose.',
    report: 'Lab report: trace substances present; toxicology does not establish a fatal overdose. The bag is a red herring.'
  },
  floor: {
    title: 'KITCHEN KNIFE',
    text: 'A knife lies near the victim. It has no visible blood transfer and no matching wound has been identified.',
    report: 'Pathology: no penetrating stab injury. The knife may be unrelated.'
  },
  wall: {
    title: 'WALL TRACE / SWAB',
    text: 'Wall stain photographed and sampled in place. Its pattern is consistent with impact or contact, but cannot by itself identify the attacker.',
    report: 'Pathology: severe blunt-force head injury. Combined with the timeline and scene, it supports assault.'
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
    answers: ['A knife was on the floor', 'Toxicology did not indicate fatal overdose', 'There was blood on the wall'],
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
  notebookCanvas=document.createElement('canvas');
  notebookCanvas.width=NOTE_W;notebookCanvas.height=NOTE_H;
  notebookCtx=notebookCanvas.getContext('2d');
  notebookTexture=new THREE.CanvasTexture(notebookCanvas);
  notebookTexture.colorSpace=THREE.SRGBColorSpace;
  notebookMesh=new THREE.Mesh(new THREE.PlaneGeometry(NOTE_WORLD_W,NOTE_WORLD_H),
    new THREE.MeshBasicMaterial({map:notebookTexture,side:THREE.DoubleSide,transparent:true,
      depthTest:false,depthWrite:false}));
  notebookMesh.renderOrder=1900;notebookMesh.frustumCulled=false;
  notebookMesh.visible=false;scene.add(notebookMesh);
  cursorMesh=new THREE.Mesh(new THREE.RingGeometry(.014,.021,20),
    new THREE.MeshBasicMaterial({color:0x42eaff,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
  cursorMesh.renderOrder=2000;cursorMesh.visible=false;scene.add(cursorMesh);
  paintNotebook();
}

function openNotebook() {
  if (notebookOpen || !notebookMesh) return;
  notebookOpen = true;
  notebookPage = gameResult ? 'outcome' : (evidence.every(e => e.collected) ? 'deduce' : 'brief');
  notebookHover = null;
  notebookMesh.position.copy(headPosition)
    .add(new THREE.Vector3(0, -0.02, -1.16).applyQuaternion(headRotation));
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
  const fontSize = Math.min(48, h * .40, w < 270 ? 37 : 48);
  noteText(label, x + 25, y + (h - fontSize) / 2 - 4, w - 50, fontSize,
    isHover ? '#ffffff' : '#e8f4fc', 51, 'bold');
  notebookButtons.push({ id, x, y, w, h });
}

function paintNotebook(){
  if(!notebookCtx)return;
  const c=notebookCtx;
  notebookButtons=[];
  c.fillStyle='#07121d';c.fillRect(0,0,NOTE_W,NOTE_H);
  // Modern London Met-style electronic casefile: dark graphite + restrained amber.
  c.fillStyle='#142838';c.fillRect(0,0,NOTE_W,170);
  c.fillStyle='#f6bd55';c.fillRect(0,0,16,NOTE_H);
  noteText('THE ROOM DID IT   /   CASE 01',68,25,1150,58,'#f2f6fa',64,'bold');
  noteText('DALSTON  •  LONDON 2026   /   AFTER THE PARTY',72,99,1090,34,'#98d2de',39,'bold');
  const total=evidence.filter(e=>e.collected).length;
  noteText(`SCORE ${points}   |   CLUES ${total}/3`,885,105,410,32,'#ffcf6b',38,'bold');
  noteButton('close','CLOSE ✕',1260,26,225,113,'danger');
  const pageIndex=notebookPages.indexOf(notebookPage);
  const names={brief:'01  BRIEFING',evidence:'02  EVIDENCE',suspects:'03  SUSPECTS',deduce:'04  DEDUCTIONS',outcome:'05  VERDICT'};
  noteText(names[notebookPage]||'CASEFILE',73,198,1330,61,'#ffe0a0',67,'bold');
  noteBox(69,278,1390,565,'#0d1c28','#426378');
  if(notebookPage==='brief')paintBriefPage();
  else if(notebookPage==='evidence')paintEvidencePage();
  else if(notebookPage==='suspects')paintSuspectsPage();
  else if(notebookPage==='deduce')paintDeductionPage();
  else paintOutcomePage();
  noteButton('nav:prev','◀  PREVIOUS',70,877,448,132,'action');
  noteButton('nav:next','NEXT PAGE  ▶',1053,877,407,132,'action');
  // Bottom centre is a persistent one-step instruction, not a tiny tab.
  noteText((pageIndex+1)+' / 5  •  LOOK + PINCH',562,922,460,35,'#bad7df',42,'bold');
  if(caseFeedback)noteText(caseFeedback,82,831,1370,25,'#f6c96c',31,'bold');
  notebookTexture.needsUpdate=true;
}

function paintBriefPage(){
  noteText('INCIDENT / 02:20',101,307,1120,48,'#ffcf74',59,'bold');
  noteText('Aaron Malik, 27, was found dead after a party in a Dalston flat. A drug wrap, a knife and a wall stain suggest competing explanations.',
    102,389,1290,43,'#eff6fa',63);
  noteText('Neighbour: argument and crash at 02:11. Entry log: Lewis Ward returned at 02:09, despite claiming to have left at 01:40.',
    102,606,1290,39,'#a9dfeb',59);
  noteText('NEXT → inspect evidence, then compare the suspect statements.',102,786,1270,33,'#ffcf74',40);
}

function paintEvidencePage(){
  const names=[['table','DRUG WRAP'],['floor','KITCHEN KNIFE'],['wall','WALL BLOOD']];
  for(let i=0;i<names.length;i++){
    const [id,name]=names[i];const found=evidence.find(e=>e.id===id)?.collected;
    noteButton('clue:'+id,(found?'✓ ':'○ ')+name,101,311+i*160,600,133);
  }
  noteBox(745,312,660,502,'#102a37','#548093');
  const item=CASE_EVIDENCE[notebookSelectedClue];
  const found=evidence.find(e=>e.id===notebookSelectedClue)?.collected;
  noteText(item.title,774,343,605,41,'#90f0f3',52,'bold');
  noteText(found?item.text:'Not yet documented. Search the correct real-world surface; wall blood is documented, not picked up.',
    774,434,584,33,'#edf5fa',46);
  if(found)noteText(item.report,774,639,592,28,'#ffcf74',39);
}

function paintSuspectsPage(){
  noteText('MIA SHAH  /  FLATMATE',104,315,1195,47,'#78e4ef',53,'bold');
  noteText('Says she was on a work call at 02:10. Police can verify the call log.',104,381,1270,34,'#edf5fb',44);
  noteText('BEN CARTER  /  DJ',104,492,1180,47,'#78e4ef',53,'bold');
  noteText('Claims to have left at 01:55. CCTV supports his departure.',104,558,1270,34,'#edf5fb',44);
  noteText('LEWIS WARD  /  FRIEND',104,669,1200,47,'#ffcf74',53,'bold');
  noteText('Says he left at 01:40. The entry system logged his return at 02:09.',104,732,1270,34,'#edf5fb',44);
}

function paintDeductionPage(){
  if(gameResult){
    noteText('YOUR CASE IS COMPLETE',104,339,1230,55,'#ffcf74',63,'bold');
    noteText('Use NEXT PAGE for verdict and replay.',106,460,1220,43,'#e8f6fa',58);
    return;
  }
  if(evidence.some(e=>!e.collected)){
    noteText('DOCUMENT ALL 3 CLUES FIRST',103,339,1240,52,'#ffcf74',62,'bold');
    noteText('Pinch CLOSE to return to the scene. Bag the drug wrap and knife; photograph and swab the wall stain. Then reopen this page.',
      107,450,1260,43,'#ebf5fa',60);
    return;
  }
  const q=QUESTIONS[deductionStep];
  if(accusationConfirm!==null){
    noteText('FINAL ACCUSATION',102,305,1270,52,'#ffcf74',63,'bold');
    noteText('Accuse '+SUSPECTS[accusationConfirm]+'? An incorrect accusation fails the case.',
      106,397,1250,42,'#eef7fa',61);
    noteButton('confirm:accuse','CONFIRM ACCUSATION',105,581,752,159,'danger');
    noteButton('confirm:back','GO BACK',905,581,472,159);
    return;
  }
  noteText(q.title+'  /  '+q.question,108,295,1240,39,'#ffcf74',55,'bold');
  q.answers.forEach((answer,i)=>{
    noteButton('answer:'+i,String.fromCharCode(65+i)+'    '+answer,
      105,395+i*140,1270,124,i===2?'action':'default');
  });
}

function paintOutcomePage(){
  if(!gameResult){
    noteText('VERDICT PENDING',108,359,1210,58,'#ffcf74',70,'bold');
    noteText('Complete the evidence collection and all three deductions before filing your final verdict.',
      110,476,1240,44,'#f0f7fa',63);
    return;
  }
  const ok=gameResult==='solved';
  noteText(ok?'CASE CLOSED / SOLVED':'INVESTIGATION FAILED',107,322,1270,58,
    ok?'#8debb8':'#fa9191',70,'bold');
  noteText(ok?'Lewis Ward returned to the flat and assaulted Aaron. A blunt-force head injury was fatal. The drug wrap and knife were red herrings.':'The wrong suspect was accused. The case is failed; the guilty person remains free.',
    108,432,1250,41,'#edf5fb',60);
  noteText('FINAL SCORE  '+points+'/100',109,654,1200,49,'#ffcf74',60,'bold');
  noteButton('replay','REPLAY INVESTIGATION',105,712,1250,105,'action');
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
    const match = notebookButtons.find(b => px >= b.x - 12 && px <= b.x + b.w + 12 && py >= b.y - 12 && py <= b.y + b.h + 12);
    hover = match ? match.id : null;
    cursorMesh.visible = true;
    cursorMesh.position.copy(hit.point).addScaledVector(gazeDirection, -0.015);
    cursorMesh.quaternion.copy(notebookMesh.quaternion);
  } else cursorMesh.visible = false;
  if (hover !== notebookHover) { notebookHover = hover; paintNotebook(); }
}

// Touch the large notebook buttons directly with tracked fingertips;
// looking at a button + pinching remains available for seated use.
function notebookTouchTarget(state) {
  if(!notebookOpen || !state.hasPose || !notebookMesh)return null;
  const local=notebookMesh.worldToLocal(state.midpoint.clone());
  if(Math.abs(local.z)>.19 || Math.abs(local.x)>NOTE_WORLD_W*.57 || Math.abs(local.y)>NOTE_WORLD_H*.58) return null;
  const px=NOTE_W*(local.x/NOTE_WORLD_W+.5);
  const py=NOTE_H*(.5-local.y/NOTE_WORLD_H);
  const b=notebookButtons.find(b=>px>=b.x-25 && px<=b.x+b.w+25 && py>=b.y-25 && py<=b.y+b.h+25);
  return b?.id || null;
}

function activateNotebookButton(id) {
  caseFeedback = '';
  if (id === 'close') { closeNotebook(); return; }
  if (id === 'nav:prev' || id === 'nav:next') {
    const position=notebookPages.indexOf(notebookPage);
    const delta=id==='nav:next'?1:-1;
    notebookPage=notebookPages[(position+delta+notebookPages.length)%notebookPages.length];
    accusationConfirm=null;
    paintNotebook();
    return;
  }
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
