import * as THREE from 'three';

// THE ROOM DID IT — v10 / After the Party: complete investigative vertical slice.
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
let pointerMethod = 'GAZE', firstNotebookOpen = true;
let notebookButtons = [], notebookSelectedClue = 'table';
let deductionStep = 0, points = 100, gameResult = null, caseFeedback = '';
let accusationConfirm = null, noteMode = false;
const noteRaycaster = new THREE.Raycaster();
const NOTE_W = 1536, NOTE_H = 1080;
const NOTE_WORLD_W = 1.48, NOTE_WORLD_H = 1.04;
const notebookPages = ['brief', 'timeline', 'evidence', 'suspects', 'deduce', 'outcome'];
const gloveMeshes = new WeakMap();
const gloveEntries = [];
const jointBallGeometry = new THREE.SphereGeometry(1, 10, 8);
const jointTubeGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
const gloveMaterial = new THREE.MeshStandardMaterial({ color: 0x84c9dc, roughness: 0.83, metalness: 0, transparent: true, opacity: 0.88, depthWrite: false });
const boneUp = new THREE.Vector3(0, 1, 0);
const handStates = new WeakMap();
let glovesEnabled = true;
const stableCandidates = new Map();
const evidence = [];
let audioCtx = null;
let gameplayTime = 0;
let lastCelebration = 0;
const uiRay = new THREE.Raycaster();
const handPointerStates = new WeakMap();
const maxPage = 6;
const MAX_SURFACE_PROPS = 8;


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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    initializeAudio();
    renderer.xr.setReferenceSpaceType('local-floor');
    document.body.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 50);
    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x76818d, 1.46));
    const softKey = new THREE.DirectionalLight(0xffedda, 1.15);
    softKey.position.set(-1.5, 3, 1.4); scene.add(softKey);
    const coolFill = new THREE.DirectionalLight(0x93bede, 0.42);
    coolFill.position.set(2, 1.5, -1.2); scene.add(coolFill);

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
    lastNotice = 'Scan your table, floor and wall to reconstruct the party scene.';

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

function initializeAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx && Ctx) audioCtx = new Ctx();
    audioCtx?.resume?.().catch(() => {});
  } catch (_) { audioCtx = null; }
}

function playSound(kind = 'select') {
  if (!audioCtx || audioCtx.state !== 'running') return;
  try {
    const t = audioCtx.currentTime;
    const notes = {
      select: [[480, .045, .025]], hover: [[550,.026,.007]],
      found: [[510, .08, .045], [710, .12, .026]],
      correct: [[440,.10,.039],[660,.16,.048],[880,.20,.034]],
      wrong: [[180,.13,.05],[130,.17,.045]],
      end: [[520,.16,.035],[690,.18,.045],[880,.25,.03]]
    }[kind] || [[450,.05,.02]];
    notes.forEach(([freq,seconds,level],i) => {
      const osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
      const at=t+i*.095;
      osc.type=kind==='wrong'?'triangle':'sine';osc.frequency.setValueAtTime(freq,at);
      gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(level,at+.012);
      gain.gain.exponentialRampToValueAtTime(.0001,at+seconds);
      osc.connect(gain);gain.connect(audioCtx.destination);
      osc.start(at);osc.stop(at+seconds+.01);
    });
  } catch (_) { /* audio is optional in XR */ }
}

function makeMaterial(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.12, ...opts });
}

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
    c.fillText('Lewis is here again.',65,426);c.fillText('He wants the money back.',65,482);
    c.fillStyle='#abb4be';c.font='25px Arial';c.fillText('02:10 - Message from AARON',65,572);
  });
  const screen=new THREE.Mesh(new THREE.PlaneGeometry(.068,.135),
    new THREE.MeshBasicMaterial({map:screenTex,depthWrite:false}));
  screen.rotation.x=-Math.PI/2;screen.position.y=.013;g.add(screen);
  const cam=new THREE.Mesh(new THREE.CircleGeometry(.003,12),makeMaterial(0x252d36));
  cam.rotation.x=-Math.PI/2;cam.position.set(0,.014,-.065);g.add(cam);
  return g;
}

// Detail props are recognisable *context*, not collectible evidence.
// All dressing is rooted at an already confirmed real surface; never free-floating.
function tabletopCup(kind=0) {
  const g=new THREE.Group();
  const mat=makeMaterial(kind?0xe4d2a4:0xf3efec,{roughness:.83,transparent:true,opacity:.86,side:THREE.DoubleSide});
  const shell=new THREE.Mesh(new THREE.CylinderGeometry(.030,.023,.083,20,1,true),mat);
  shell.position.y=.044;g.add(shell);
  const lip=new THREE.Mesh(new THREE.TorusGeometry(.029,.003,7,24),makeMaterial(0xf6ece9,{roughness:.75}));
  lip.rotation.x=-Math.PI/2;lip.position.y=.086;g.add(lip);
  const drink=new THREE.Mesh(new THREE.CircleGeometry(.027,24),new THREE.MeshPhysicalMaterial({color:kind?0x65342b:0x8c401c,roughness:.24,metalness:.02,transparent:true,opacity:.72}));
  drink.rotation.x=-Math.PI/2;drink.position.y=.079;g.add(drink);
  return g;
}
function partyCan() {
  const g=new THREE.Group();
  const seed=rngFactory(531);
  const label=makeTexture(512,512,(c,w,h)=>{
    const grd=c.createLinearGradient(0,0,w,0);
    grd.addColorStop(0,'#141f2c');grd.addColorStop(.3,'#314b62');grd.addColorStop(.7,'#1b3248');grd.addColorStop(1,'#101a27');
    c.fillStyle=grd;c.fillRect(0,0,w,h);
    for(let i=0;i<36;i++){c.strokeStyle=`rgba(174,208,229,${seed()*.09})`;c.beginPath();c.moveTo(seed()*w,0);c.lineTo(seed()*w,h);c.stroke();}
    c.fillStyle='#d3eef7';c.textAlign='center';c.font='bold 93px Arial';c.fillText('PULSE',256,220);
    c.font='bold 30px Arial';c.fillText('SPARKLING   •   330 ml',256,292);
    c.strokeStyle='#6fd4e2';c.lineWidth=13;c.beginPath();c.moveTo(50,337);c.lineTo(460,337);c.stroke();
  });
  const sides=new THREE.Mesh(new THREE.CylinderGeometry(.031,.031,.119,30),makeMaterial(0xdde3e7,{map:label,metalness:.55,roughness:.29}));
  sides.position.y=.061;g.add(sides);
  for(const y of [.001,.12]){const rim=new THREE.Mesh(new THREE.TorusGeometry(.0285,.003,7,30),makeMaterial(0xb5c3cb,{metalness:.9,roughness:.24}));rim.rotation.x=-Math.PI/2;rim.position.y=y;g.add(rim);}
  const tab=new THREE.Mesh(new THREE.CapsuleGeometry(.007,.010,3,8),makeMaterial(0xa3afb7,{metalness:.89}));tab.rotation.x=Math.PI/2;tab.position.set(0,.123,0);g.add(tab);
  return g;
}
function partyVape() {
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(.026,.014,.089),makeMaterial(0x44394f,{metalness:.28,roughness:.28}));
  body.position.y=.01;g.add(body);
  const cap=new THREE.Mesh(new THREE.BoxGeometry(.024,.016,.011),makeMaterial(0x121a20,{roughness:.24}));cap.position.set(0,.012,-.046);g.add(cap);
  const led=new THREE.Mesh(new THREE.BoxGeometry(.010,.001,.003),new THREE.MeshBasicMaterial({color:0x57d6c8}));led.position.set(0,.018,.026);g.add(led);
  return g;
}
function takeawayBox() {
  const g=new THREE.Group();
  const cardboard=makeMaterial(0xc5aa7c,{roughness:.93,metalness:0});
  const box=new THREE.Mesh(new THREE.BoxGeometry(.17,.036,.115),cardboard);box.position.y=.02;g.add(box);
  const lid=new THREE.Mesh(new THREE.BoxGeometry(.17,.006,.112),cardboard);
  lid.position.set(0,.052,-.027);lid.rotation.x=-.24;g.add(lid);
  const print=makeTexture(512,256,(c,w,h)=>{c.fillStyle='#cdb38a';c.fillRect(0,0,w,h);
    c.fillStyle='#394544';c.textAlign='center';c.font='bold 49px Arial';c.fillText('NIGHT BITE',256,125);
    c.font='25px Arial';c.fillText('TAKEAWAY  •  LONDON',256,170);});
  const label=new THREE.Mesh(new THREE.PlaneGeometry(.136,.074),new THREE.MeshBasicMaterial({map:print}));
  label.rotation.x=-Math.PI/2+.24;label.position.set(0,.056,-.030);g.add(label);
  return g;
}
function crumpledNapkin() {
  const g=new THREE.Group();
  const seed=rngFactory(2382),verts=[];
  const n=8;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++) {
    const x=(i/(n-1)-.5)*.091,z=(j/(n-1)-.5)*.087;
    const height=.003+seed()*.006 + Math.sin((i+j)*2.1)*.004;
    verts.push(x,height,z);
  }
  const ind=[];for(let i=0;i<n-1;i++)for(let j=0;j<n-1;j++){
    const a=i*n+j,b=a+n;ind.push(a,a+1,b,a+1,b+1,b);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(ind);geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo,makeMaterial(0xd8d4cf,{roughness:1,side:THREE.DoubleSide})));return g;
}
function brokenGlass() {
  const g=new THREE.Group(),seed=rngFactory(117);
  const mat=new THREE.MeshPhysicalMaterial({color:0xc7e4ee,transparent:true,opacity:.41,metalness:.05,roughness:.13,side:THREE.DoubleSide,depthWrite:false});
  for(let i=0;i<9;i++){
    const a=seed()*Math.PI*2,r=.025+seed()*.083,size=.008+seed()*.020;
    const geo=new THREE.BufferGeometry();const pos=new Float32Array([0,0,0,size,0,0,size*.35,0,size]);
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.computeVertexNormals();
    const shard=new THREE.Mesh(geo,mat);shard.position.set(Math.cos(a)*r,.003,Math.sin(a)*r);shard.rotation.y=a;g.add(shard);
  }return g;
}
function brokenWatch() {
  const g=new THREE.Group();
  const strap=makeMaterial(0x25313c,{roughness:.72,metalness:.18});
  const band=new THREE.Mesh(new THREE.BoxGeometry(.034,.005,.14),strap);band.position.y=.007;g.add(band);
  const metal=makeMaterial(0xadb9c4,{roughness:.32,metalness:.82});
  const bezel=new THREE.Mesh(new THREE.CylinderGeometry(.031,.031,.009,28),metal);bezel.position.y=.013;g.add(bezel);
  const faceTex=makeTexture(384,384,(c,w,h)=>{
    c.fillStyle='#16222d';c.fillRect(0,0,w,h);
    c.beginPath();c.arc(192,192,150,0,Math.PI*2);c.strokeStyle='#ccd7de';c.lineWidth=7;c.stroke();
    c.fillStyle='#ecf3f8';c.textAlign='center';c.font='bold 48px Arial';c.fillText('02:12',192,197);
    c.font='20px Arial';c.fillText('GLASS CRACKED',192,235);
    c.strokeStyle='#a3c5cb';c.lineWidth=5;c.beginPath();c.moveTo(85,64);c.lineTo(222,188);c.lineTo(286,265);c.stroke();
  });
  const glass=new THREE.Mesh(new THREE.CircleGeometry(.028,30),new THREE.MeshBasicMaterial({map:faceTex}));glass.rotation.x=-Math.PI/2;glass.position.y=.019;g.add(glass);
  return g;
}
function canvasSceneNote(title, subtitle, tint='#f5c36a') {
  const tex=makeTexture(640,280,(c,w,h)=>{
    c.fillStyle='#13212c';c.fillRect(0,0,w,h);c.strokeStyle=tint;c.lineWidth=16;c.strokeRect(8,8,w-16,h-16);
    c.fillStyle=tint;c.textAlign='center';c.font='bold 108px Arial';c.fillText(title,320,135);
    c.font='bold 30px Arial';c.fillText(subtitle,320,218);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(.145,.064),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide,depthWrite:false}));
}
function makeTableDressing(phone) {
  const g=new THREE.Group();
  const add=(obj,x,y,z,rotation=0)=>{obj.position.set(x,y,z);obj.rotation.y+=rotation;g.add(obj);};
  add(phone,.20,.007,-.022,-.20);
  add(tabletopCup(),-.15,.003,-.115,.20);
  add(tabletopCup(1),-.065,.003,-.19,-.40);
  add(partyCan(),.15,.005,-.16,.32);
  add(takeawayBox(),.275,.006,.15,-.12);
  add(partyVape(),-.205,.005,.098,.42);
  add(crumpledNapkin(),.05,.003,.18,-.30);
  return g;
}
function makeFloorDressing() {
  const g=new THREE.Group();
  const add=(obj,x,y,z,r=0)=>{obj.position.set(x,y,z);obj.rotation.y=r;g.add(obj);};
  add(brokenWatch(),.20,.002,.06,-.35);
  add(brokenGlass(),-.12,.003,-.10);
  const paper=crumpledNapkin();add(paper,.25,.002,-.19,.30);
  const cup=tabletopCup();add(cup,-.27,.033,.16,.35);cup.rotation.z=.95;
  return g;
}
function makeWallDressing() {
  const g=new THREE.Group();
  const label=canvasSceneNote('03','WALL TRACE  /  DOCUMENT','#f6c76e');
  label.rotation.x=-Math.PI/2;label.position.set(.15,.015,.005);g.add(label);
  return g;
}

function buildEvidence() {
  const definitions = [
    { id:'table', name:'DRUG WRAP', surface:'TABLE / SOFA', group:makeDrugBag(), action:'collect' },
    { id:'floor', name:'KITCHEN KNIFE', surface:'FLOOR', group:makeKnife(), action:'collect' },
    { id:'wall', name:'BLOOD TRANSFER', surface:'WALL', group:makeBloodTrace(), action:'document' }
  ];
  for (const d of definitions) {
    d.group.visible=false;d.group.userData.evidenceId=d.id;
    d.placed=false;d.collected=false;d.placedBy='';d.ring=d.group.userData.ring;
    scene.add(d.group);evidence.push(d);
  }
  const phone=makePhone();
  const dressings={table:makeTableDressing(phone),floor:makeFloorDressing(),wall:makeWallDressing()};
  for(const d of Object.values(dressings)){d.visible=false;scene.add(d);}
  scene.userData.dressings=dressings;
}

function addBaseRing(group, color, radius) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.003, 9, 36),
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
  if (!hudCtx) return;
  const c=hudCtx;
  c.clearRect(0,0,1536,432);
  c.fillStyle='rgba(5,14,24,.80)';c.fillRect(0,0,1536,432);
  c.strokeStyle='#d2ac66';c.lineWidth=5;c.strokeRect(3,3,1530,426);
  c.fillStyle='#68c6d1';c.fillRect(0,0,21,432);
  c.textAlign='left';c.textBaseline='middle';
  lines.forEach((line,i)=>{
    c.font=i===0?'bold 59px Arial':'bold 44px Arial';
    c.fillStyle=i===0?'#f5d59b':i===1?'#ffffff':'#b6dae5';
    c.fillText(line,57,77+i*133,1415);
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
  const dressing=scene.userData.dressings?.[item.id];
  if (dressing) {
    dressing.position.copy(item.group.position);
    dressing.quaternion.copy(item.group.quaternion);
    dressing.visible = true;
  }
  stableCandidates.delete(item.id);
  lastNotice = item.name + ' on real ' + item.surface + ' surface';
  noticeUntil = performance.now() + 2100;
  playSound('found');
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
    lastNotice = 'BLOOD: PHOTO + FORENSIC SWAB ADDED TO CASEFILE';
    playSound('found');
    noticeUntil = performance.now() + 3500;
    if (evidence.every(e => e.collected)) openNotebook();
    return;
  }
  grabbedBy = src;
  grabbedEvidence = item;
  grabMethod = direct ? 'DIRECT PINCH' : 'GAZE + PINCH';
  if (item.ring) item.ring.visible = false;
  if (state.hasPose) item.group.position.copy(state.midpoint);
  lastNotice = 'Holding ' + item.name + ': RELEASE to bag it';
  playSound('select');
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
  lastNotice = item.name + ' secured as evidence';
  playSound('found');
  noticeUntil = performance.now() + 2800;
  if (evidence.every(e => e.collected)) {
    lastNotice = 'THREE PHYSICAL CLUES COMPLETE: open the casefile';
    openNotebook();
  }
  console.info('Collected', item.name);
}

function processHands(frame) {
  // Hide stale glove meshes when the headset temporarily loses a tracked hand.
  for (const model of gloveEntries) {
    model.palm.visible=false;model.cuff.visible=false;
    for(const segment of model.pieces) segment.mesh.visible=false;
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
    if (glovesEnabled) updateGlove(frame,src);
    // Index ray permits pointing at a large notebook card without head-aim precision.
    const baseJoint = src.hand.get('index-finger-phalanx-proximal');
    const basePose = baseJoint ? frame.getJointPose(baseJoint, refSpace) : null;
    if (basePose) {
      const p=basePose.transform.position;
      state.indexBase=new THREE.Vector3(p.x,p.y,p.z);
      state.indexTip=new THREE.Vector3(index.transform.position.x,index.transform.position.y,index.transform.position.z);
    } else {state.indexBase=null;state.indexTip=null;}
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
  const placed=evidence.filter(e=>e.placed).length;
  const collected=evidence.filter(e=>e.collected).length;
  const awaiting=evidence.filter(e=>!e.placed).map(e=>e.surface).join(' / ');
  if (hud) hud.visible=!notebookOpen;
  if (notebookOpen) return;
  if (grabbedEvidence) {
    paintHUD(['CASE 01  /  EVIDENCE RECOVERY',
      'Move your hand to inspect '+grabbedEvidence.name+'.',
      'Release fingers to bag it   |   '+collected+'/3 documented']);
  } else if(now<noticeUntil) {
    paintHUD(['AFTER THE PARTY   /   LONDON 2026',lastNotice,
      'Evidence '+collected+'/3   •   Pinch empty space for casefile']);
  } else if(placed===0 && now-startedAt>9000 && visiblePlanes===0 && visibleHits===0){
    paintHUD(['SCANNING REAL SURFACES', 'Look at your table, floor, then wall.',
      'No surfaces detected  •  no floating fallback']);
  } else {
    paintHUD(['CASE 01  /  AFTER THE PARTY    '+collected+'/3',
      gazeTarget?'FOCUSED: '+gazeTarget.name+'  —  PINCH TO '+(gazeTarget.action==='document'?'DOCUMENT':'BAG'):
        awaiting?'Scan the real '+awaiting+' to reveal clues':'All clues located. Look at an item and pinch.',
      'Hands '+poseHands+'   •   Surfaces '+placed+'/3   •   Pinch empty space for notebook']);
  }
  for(const item of evidence){
    if(item.ring && item.placed && !item.collected && item!==grabbedEvidence){
      item.ring.material.color.set(item===gazeTarget?0x57e9ef:0xd1aa5e);
    }
  }
}

// Anatomically-tracked continuous fingertip sleeves + palm volume.
// Three.js cannot recolour the *real* passthrough hand pixels in ordinary WebXR;
// this is a stylised 3D virtual glove. We therefore include a toggle in the casefile.
const GLOVE_COLOR = new THREE.MeshStandardMaterial({color:0x397dad,metalness:0.03,
  roughness:0.86,transparent:true,opacity:.96,depthWrite:false,depthTest:false,
  side:THREE.DoubleSide});
const GLOVE_SEAM = new THREE.MeshBasicMaterial({color:0x9ecfdf,transparent:true,opacity:.86,
  depthTest:false,depthWrite:false,side:THREE.DoubleSide});
const fingerDefinitions = [
  {name:'thumb',points:['thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip'],r:[.012,.011,.008,.003]},
  {name:'index',points:['index-finger-metacarpal','index-finger-phalanx-proximal','index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip'],r:[.0115,.0105,.0085,.0065,.002]},
  {name:'middle',points:['middle-finger-metacarpal','middle-finger-phalanx-proximal','middle-finger-phalanx-intermediate','middle-finger-phalanx-distal','middle-finger-tip'],r:[.012,.011,.009,.0065,.002]},
  {name:'ring',points:['ring-finger-metacarpal','ring-finger-phalanx-proximal','ring-finger-phalanx-intermediate','ring-finger-phalanx-distal','ring-finger-tip'],r:[.011,.010,.008,.006,.002]},
  {name:'pinky',points:['pinky-finger-metacarpal','pinky-finger-phalanx-proximal','pinky-finger-phalanx-intermediate','pinky-finger-phalanx-distal','pinky-finger-tip'],r:[.0095,.0085,.007,.0048,.0018]}
];
function gloveShell(rings, sides=9) {
  const positions=new Float32Array(rings*sides*3);
  const geom=new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  const idx=[];
  for(let i=0;i<rings-1;i++)for(let j=0;j<sides;j++){
    const a=i*sides+j,b=i*sides+(j+1)%sides,c=(i+1)*sides+j,d=(i+1)*sides+(j+1)%sides;
    idx.push(a,c,b,b,c,d);
  }
  geom.setIndex(idx);geom.userData={rings,sides};return geom;
}
function setShell(mesh,pts,radX,radY=null,sideAxis=null,depthAxis=null) {
  const geometry=mesh.geometry, a=geometry.attributes.position;
  const sides=geometry.userData.sides;
  const up=new THREE.Vector3(0,1,0);
  for(let i=0;i<pts.length;i++){
    const before=pts[Math.max(0,i-1)],after=pts[Math.min(pts.length-1,i+1)];
    const tangent=after.clone().sub(before).normalize();
    let side=sideAxis?sideAxis.clone():new THREE.Vector3().crossVectors(tangent,up);
    if(side.lengthSq()<.01)side.set(1,0,0);
    side.normalize();
    const depth=depthAxis?depthAxis.clone().normalize():new THREE.Vector3().crossVectors(tangent,side).normalize();
    for(let j=0;j<sides;j++){
      const ang=j/sides*Math.PI*2;
      const point=pts[i].clone().addScaledVector(side,Math.cos(ang)*radX[i]).addScaledVector(depth,Math.sin(ang)*(radY?radY[i]:radX[i]));
      a.setXYZ(i*sides+j,point.x,point.y,point.z);
    }
  }
  a.needsUpdate=true;
  geometry.computeVertexNormals();
  mesh.visible=true;
}
function buildGlove(src) {
  const pieces=[];
  for(const def of fingerDefinitions){
    const mesh=new THREE.Mesh(gloveShell(def.points.length),GLOVE_COLOR);
    mesh.frustumCulled=false;mesh.renderOrder=2200;scene.add(mesh);
    pieces.push({def,mesh});
  }
  const palm=new THREE.Mesh(gloveShell(4,12),GLOVE_COLOR);
  palm.frustumCulled=false;palm.renderOrder=2199;scene.add(palm);
  const cuff=new THREE.Mesh(new THREE.TorusGeometry(.029,.0032,6,22),GLOVE_SEAM);
  cuff.renderOrder=2202;cuff.frustumCulled=false;scene.add(cuff);
  const obj={pieces,palm,cuff};gloveMeshes.set(src,obj);gloveEntries.push(obj);return obj;
}
function updateGlove(frame,src) {
  const obj=gloveMeshes.get(src)||buildGlove(src);
  const cached=new Map();
  function point(name){
    if(cached.has(name))return cached.get(name);
    const joint=src.hand.get(name);let v=null;
    if(joint){try{const pose=frame.getJointPose(joint,refSpace);
      if(pose){const p=pose.transform.position;v=new THREE.Vector3(p.x,p.y,p.z);}}catch(_){}}
    cached.set(name,v);return v;
  }
  for(const seg of obj.pieces){
    const ps=seg.def.points.map(point);
    if(ps.some(p=>!p)){seg.mesh.visible=false;continue;}
    setShell(seg.mesh,ps,seg.def.r);
  }
  const wrist=point('wrist'),index=point('index-finger-metacarpal'),
        middle=point('middle-finger-metacarpal'),pinky=point('pinky-finger-metacarpal');
  if(wrist&&index&&middle&&pinky){
    const knuckle=index.clone().add(pinky).multiplyScalar(.5);
    const axis=index.clone().sub(pinky).normalize();
    const forward=knuckle.clone().sub(wrist).normalize();
    const perpendicular=new THREE.Vector3().crossVectors(forward,axis).normalize();
    const palmPoints=[wrist.clone(),wrist.clone().lerp(knuckle,.38),
      wrist.clone().lerp(knuckle,.77),knuckle.clone()];
    setShell(obj.palm,palmPoints,[.028,.037,.042,.039],[.012,.014,.014,.012],axis,perpendicular);
    obj.cuff.visible=true;obj.cuff.position.copy(wrist);
    obj.cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),forward);
  }else{obj.palm.visible=false;obj.cuff.visible=false;}
}

// ---------------- CASE 01: AFTER THE PARTY ----------------
// All scene surfaces and hand-grab mechanics above are inherited from v7.
// The notebook is a world-locked WebGL canvas. It needs no DOM overlay/controllers.
const CASE_EVIDENCE = {
  table:{title:'01 / UNIDENTIFIED POWDER',
    text:'A clear plastic wrap found beside drinks. It may be relevant to the party; appearance does not establish what anyone took.',
    report:'LAB: trace cocaine identified. Toxicology shows no fatal drug concentration. The presence of drugs is not a cause-of-death finding.'},
  floor:{title:'02 / KITCHEN KNIFE',
    text:'A kitchen knife lies on the floor, close to broken glass. It is an obvious suspect weapon, but context matters.',
    report:'FORENSICS: food grease, no identified blood on blade. Pathology found no penetrating wound. The knife did not cause the death.'},
  wall:{title:'03 / WALL BLOOD TRANSFER',
    text:'Documented in place: impact/contact stain on the wall near the floor. Photographs and swab taken; the stain remains on the wall.',
    report:'PATHOLOGY: severe blunt-force head injury. Blood pattern alone cannot establish who was responsible. Context and injury corroborate impact.'},
  phone:{title:'04 / VICTIM PHONE EXTRACTION',
    text:'A cracked phone beside the wrap. A recovered unsent draft suggests Aaron was worried about a money dispute.',
    report:'02:10 local: "Lewis is here again. He wants the money back." Device time confirmed by network records. Digital evidence alone is not proof of assault.'},
  watch:{title:'05 / BROKEN WATCH',
    text:'Damaged watch near the body; face reads 02:12. It might have stopped at impact — or the time may be coincidental.',
    report:'Time not independently reliable. Neighbour heard an argument and a crash around 02:12. Door log and camera footage provide firmer timing.'}
};
const CASE_FILE_UNLOCK={table:'table',floor:'floor',wall:'wall',phone:'table',watch:'floor'};
function fileKnown(id){return evidence.find(e=>e.id===CASE_FILE_UNLOCK[id])?.collected||false;}
const SUSPECTS=[
  {name:'MIA SHAH',role:'FLATMATE',claim:'On live video call at 02:12.',check:'Her sister confirms a live call from the bathroom. Motive: row over tenancy.'},
  {name:'BEN CARTER',role:'DJ',claim:'Left the party before 02:00.',check:'CCTV shows exit at 01:55; ride receipt 02:02. Drugs belonged to guests.'},
  {name:'LEWIS WARD',role:'FRIEND',claim:'Says he left for good at 01:40.',check:'Entry log 02:09 and exit footage 02:15. Navy sleeve torn; debt dispute.'}
];
const QUESTIONS=[
  {title:'01 / CAUSE OF DEATH',question:'Which explanation fits the medical findings?',
    answers:['Fatal drug overdose','Knife stabbing','Blunt-force head injury'],correct:2,cost:12,
    proof:'Pathology identifies a head injury. A drug bag or nearby knife cannot override the injuries.',
    hint:'Read the pathology finding, not just the scene appearance.'},
  {title:'02 / FORENSIC REASONING',question:'What can the blood trace actually establish?',
    answers:['The attacker was holding a knife','Contact/impact is consistent with the injury','The attacker must be the flatmate'],correct:1,cost:12,
    proof:'Blood pattern supports a reconstruction, but cannot identify the attacker by itself.',
    hint:'Do not treat one stain as a fingerprint of a person.'},
  {title:'03 / THE TIMELINE',question:'Whose claimed alibi is contradicted by timed records?',
    answers:['Ben Carter','Lewis Ward','Mia Shah'],correct:1,cost:15,
    proof:'Lewis says he left at 01:40; the entry system records him at 02:09.',
    hint:'Compare statements with door timestamps, not hearsay.'},
  {title:'04 / EVIDENCE CHAIN',question:'Which combination is strongest, taken together?',
    answers:['Drug wrap + takeaway cup','Knife on floor + party argument','Entry log + victim text + torn sleeve'],correct:2,cost:18,
    proof:'Independent timings, the text and supporting physical evidence converge on Lewis.',
    hint:'Look for independent evidence about one person at the critical time.'},
  {title:'05 / DECIDE THE CASE',question:'Who would you formally accuse on the available evidence?',
    answers:['Mia Shah','Ben Carter','Lewis Ward','Withhold accusation'],correct:2,cost:50,
    proof:'Lewis is the strongest supported suspect. Whether charges succeed would be decided through the justice system.',
    hint:'An accusation must rely on the total evidence, not one red herring.'}
];
const wrongDeductions=new Set();
let cursorMesh=null;
let verdictReason='';
function caseGrade() {
  if(gameResult==='failed')return 'CASE FAILED';
  if(gameResult==='open')return 'FILE LEFT OPEN';
  if(!gameResult)return 'UNRESOLVED';
  if(points>=88)return '★★★  EXEMPLARY';
  if(points>=68)return '★★  SOLID CASE';
  return '★  CASE CLOSED';
}

function buildNotebook() {
  notebookCanvas=document.createElement('canvas');
  notebookCanvas.width=NOTE_W;notebookCanvas.height=NOTE_H;
  notebookCtx=notebookCanvas.getContext('2d');
  notebookTexture=new THREE.CanvasTexture(notebookCanvas);
  notebookTexture.colorSpace=THREE.SRGBColorSpace;
  notebookMesh=new THREE.Mesh(new THREE.PlaneGeometry(NOTE_WORLD_W,NOTE_WORLD_H),
    new THREE.MeshBasicMaterial({map:notebookTexture,side:THREE.DoubleSide,
      transparent:true,depthTest:false,depthWrite:false}));
  notebookMesh.renderOrder=1900;notebookMesh.frustumCulled=false;
  notebookMesh.visible=false;scene.add(notebookMesh);
  cursorMesh=new THREE.Mesh(new THREE.RingGeometry(.016,.025,28),
    new THREE.MeshBasicMaterial({color:0x70f2ff,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
  cursorMesh.renderOrder=2350;cursorMesh.frustumCulled=false;cursorMesh.visible=false;scene.add(cursorMesh);
  paintNotebook();
}

function openNotebook() {
  if (notebookOpen || !notebookMesh) return;
  notebookOpen = true;
  if (gameResult) notebookPage='outcome';
  else if (firstNotebookOpen) notebookPage='brief';
  else if (evidence.every(e=>e.collected) && notebookPage==='brief') notebookPage='timeline';
  firstNotebookOpen=false;
  notebookHover = null;
  notebookMesh.position.copy(headPosition)
    .add(new THREE.Vector3(0, -0.03, -1.24).applyQuaternion(headRotation));
  notebookMesh.quaternion.copy(headRotation);
  notebookMesh.visible = true;
  if (hud) hud.visible = false;
  paintNotebook();
  playSound('select');
}

function closeNotebook() {
  notebookOpen = false;
  notebookHover = null;
  if (notebookMesh) notebookMesh.visible = false;
  if (cursorMesh) cursorMesh.visible = false;
  if (hud) hud.visible = true;
  lastNotice = 'Notebook closed. Pinch empty space to reopen it.';
  playSound('select');
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

function noteButton(id,label,x,y,w,h,tone='default') {
  const hover=notebookHover===id;
  const bg=hover?'#237d86':tone==='danger'?'#64282f':tone==='action'?'#1b5461':'#203746';
  noteBox(x,y,w,h,bg,hover?'#9bf9ff':'#517184');
  const fontSize=Math.min(h*.41,42,w<320?34:42);
  const ty=y+(h-fontSize)/2-3;
  noteText(label,x+24,ty,w-48,fontSize,hover?'#ffffff':'#e8f4f7',51,'bold');
  notebookButtons.push({id,x,y,w,h});
}
function paintNotebook() {
  if(!notebookCtx)return;
  const c=notebookCtx;notebookButtons=[];
  c.clearRect(0,0,NOTE_W,NOTE_H);
  c.fillStyle='#071621';c.fillRect(0,0,NOTE_W,NOTE_H);
  c.fillStyle='#122e3e';c.fillRect(0,0,NOTE_W,160);
  c.fillStyle='#d4ae69';c.fillRect(0,0,17,NOTE_H);
  noteText('THE ROOM DID IT   /   CASE 01',61,24,1100,58,'#f5f7f9',65,'bold');
  noteText('AFTER THE PARTY  /  DALSTON, LONDON 2026',65,99,1020,33,'#8bcbd5',44,'bold');
  noteText('SCORE '+points,1047,115,228,33,'#f4cd80',38,'bold');
  noteButton('close','CLOSE  X',1274,21,217,116,'danger');
  const title={brief:'01  ARRIVAL / BRIEF',timeline:'02  TIMELINE',
    evidence:'03  EVIDENCE ROOM',suspects:'04  PERSONS OF INTEREST',
    deduce:'05  RECONSTRUCT',outcome:'06  VERDICT'}[notebookPage]||'CASEFILE';
  noteText(title,74,193,1260,60,'#ffdd9f',65,'bold');
  noteText((notebookPages.indexOf(notebookPage)+1)+' / 6',1320,214,160,38,'#c8d9df',42,'bold');
  noteBox(68,284,1400,546,'#0c1c28','#47657a');
  if(notebookPage==='brief')paintBriefPage();
  else if(notebookPage==='timeline')paintTimelinePage();
  else if(notebookPage==='evidence')paintEvidencePage();
  else if(notebookPage==='suspects')paintSuspectsPage();
  else if(notebookPage==='deduce')paintDeductionPage();
  else paintOutcomePage();
  if(caseFeedback){
    c.fillStyle='rgba(10,34,44,.95)';c.fillRect(75,835,1385,48);
    noteText(caseFeedback,100,839,1320,27,'#f4d08a',35,'bold');
  }
  noteButton('nav:prev','<  PREVIOUS',72,908,438,117,'action');
  noteButton('gloves:toggle','GLOVES '+(glovesEnabled?'ON':'OFF'),554,908,427,117);
  noteButton('nav:next','NEXT  >',1025,908,442,117,'action');
  notebookTexture.needsUpdate=true;
}
function paintBriefPage(){
  noteText('INCIDENT  /  SUNDAY 08 NOVEMBER',101,309,1250,48,'#f6d18a',61,'bold');
  noteText('Aaron Malik, 27, has been found dead in a Dalston flat following a house party. It is 02:20. The room is messy, with three competing explanations: overdose, knife attack, or a violent fall.',
    104,386,1270,43,'#ecf4f8',59);
  noteText('You have three suspects and a short timeline. Nothing on its own proves guilt.',
    104,560,1250,41,'#87d3d9',56,'bold');
  noteText('Investigate the clues, test their explanations and decide whether to accuse someone. False accusations have consequences.',
    104,703,1260,34,'#e3ecf1',47);
}
function paintTimelinePage(){
  const rows=[
    ['01:55','BEN LEAVES','Building CCTV records Ben exiting.'],
    ['02:02','BEN CONFIRMED','Rideshare pickup away from the flat.'],
    ['02:09','LEWIS RETURNS','Door entry log contradicts his statement.'],
    ['02:10','AARON TEXTS','"Lewis is here. Wants his money back."'],
    ['02:12','CRASH HEARD','Neighbour reports a shout and a thud.'],
    ['02:15','LEWIS EXITS','Camera shows torn sleeve; no injury proof.']
  ];
  rows.forEach((e,i)=>{
    const col=i%2,row=Math.floor(i/2),x=102+col*682,y=304+row*166;
    noteBox(x,y,642,150,'#17303f','#315566');
    noteText(e[0],x+19,y+15,135,43,'#f5d391',53,'bold');
    noteText(e[1],x+165,y+20,454,40,'#a5e8ed',51,'bold');
    noteText(e[2],x+23,y+85,601,28,'#e2eef3',37);
  });
}
function paintEvidencePage(){
  const names=[['table','01  DRUG WRAP'],['floor','02  KNIFE'],['wall','03  WALL TRACE'],
    ['phone','04  PHONE LOG'],['watch','05  WATCH']];
  names.forEach(([id,title],i)=>{
    noteButton('clue:'+id,(fileKnown(id)?'✓  ':'○  ')+title,98,303+i*102,485,88);
  });
  noteBox(620,307,794,495,'#112d3a','#4c7584');
  const report=CASE_EVIDENCE[notebookSelectedClue]||CASE_EVIDENCE.table;
  const found=fileKnown(notebookSelectedClue);
  noteText(report.title,648,333,744,43,'#9be7ec',55,'bold');
  const explanation=found?report.text:'NOT YET DOCUMENTED. Return to your scene, inspect the matching real surface and secure the evidence.';
  noteText(explanation,648,409,716,31,'#e7f2f8',45);
  if(found) {
    noteText('REPORT / ANALYSIS',650,597,720,34,'#f4d28a',43,'bold');
    noteText(report.report,650,651,714,29,'#d6e9ee',41);
  }
}
function paintSuspectsPage(){
  SUSPECTS.forEach((person,i)=>{
    const y=305+i*171;
    noteBox(103,y,1328,155,'#16303e','#376174');
    noteText(person.name+'   /   '+person.role,124,y+13,1260,43,i===2?'#ffe0a0':'#9ee3e9',52,'bold');
    noteText('CLAIM: '+person.claim,125,y+69,1254,33,'#f1f6f8',43);
    noteText('CHECK: '+person.check,125,y+110,1234,28,'#b8d0db',36);
  });
}
function paintDeductionPage(){
  if(gameResult){
    noteText('INVESTIGATION COMPLETE',108,343,1250,57,'#f4d18b',67,'bold');
    noteText('Use NEXT PAGE to review the outcome.',108,447,1220,43,'#e8f4f8',55);
    return;
  }
  if(evidence.some(e=>!e.collected)) {
    noteText('SECURE ALL THREE PHYSICAL CLUES',105,340,1270,50,'#ffd38a',62,'bold');
    noteText('Bag the drug wrap and knife; photograph and sample the wall trace in place. Close the casefile to continue scanning.',
      107,463,1260,42,'#e7f2f6',59);
    return;
  }
  const q=QUESTIONS[deductionStep];
  if(!q) {
    noteText('YOUR FINDINGS ARE READY',105,338,1250,58,'#f8d896',66,'bold');
    return;
  }
  if(accusationConfirm!==null) {
    const label=accusationConfirm===3?'WITHHOLD ACCUSATION':('ACCUSE '+SUSPECTS[accusationConfirm].name);
    noteText('FINAL DECISION',104,313,1200,51,'#ffdc9e',64,'bold');
    noteText(label+'?',105,420,1210,44,'#eaf3f8',61,'bold');
    noteText('Wrong accusation = failed case. You may decline to accuse, but the investigation remains unresolved.',
      105,511,1260,38,'#adcdd7',55);
    noteButton('confirm:accuse','FILE THE DECISION',104,654,779,127,'danger');
    noteButton('confirm:back','RECONSIDER',911,654,480,127,'action');
    return;
  }
  noteText('QUESTION '+(deductionStep+1)+' / '+QUESTIONS.length+'   •   '+q.title,103,300,1248,42,'#f4d19a',55,'bold');
  noteText(q.question,105,365,1240,37,'#e9f5f7',49,'bold');
  q.answers.forEach((answer,i)=>{
    noteButton('answer:'+i,String.fromCharCode(65+i)+'   '+answer,
      102,426+i*103,1296,93,i===2?'action':'default');
  });
}
function paintOutcomePage(){
  if(!gameResult){
    noteText('NO VERDICT FILED',107,341,1220,58,'#f6d28a',67,'bold');
    noteText('Gather all the scene evidence and finish your notebook reconstruction before accusing anyone.',
      106,471,1255,44,'#e9f4f6',61);
    return;
  }
  const solved=gameResult==='solved',open=gameResult==='open';
  noteText(solved?'CASE CLOSED  /  LEWIS WARD':open?'CASE STILL OPEN':'WRONGFUL ACCUSATION',
    102,308,1270,54,solved?'#93f0c1':open?'#ffd18d':'#ff9898',63,'bold');
  const conclusion=solved?
    'Lewis returned over a money dispute. The medical findings, door records, Aaron’s text and torn clothing together support a fatal assault. The knife and drug wrap misled the first impression.':
    open?'You chose not to accuse. No innocent person is charged, but Aaron’s case is unresolved. Reconstruct the evidence to reach a supported conclusion.':
    'You accused the wrong person. The suspect is cleared, while the evidence against Lewis is left unresolved. Your case has failed.';
  noteText(conclusion,107,395,1235,41,'#e8f4f7',59);
  noteText('FINAL SCORE   '+points+'/100',107,641,1220,49,'#f7d391',60,'bold');
  noteText(caseGrade(),107,708,1210,42,solved?'#9bf4d0':'#f4ca91',52,'bold');
  noteButton('replay','REPLAY CASE 01',102,763,1300,59,'action');
}

function updateNotebookGaze() {
  if(!notebookOpen||!notebookMesh)return;
  // Hand-pointing is tried first. The head gaze is an accessible fallback.
  let hit=null,source='GAZE';
  const planeNormal=new THREE.Vector3(0,0,1).applyQuaternion(notebookMesh.quaternion);
  for(const src of session.inputSources){
    if(!src.hand)continue;
    const state=getHandState(src);
    if(!state.hasPose||!state.indexTip||!state.indexBase)continue;
    const direction=state.indexTip.clone().sub(state.indexBase).normalize();
    const denominator=planeNormal.dot(direction);
    if(Math.abs(denominator)<.12)continue;
    const t=planeNormal.dot(notebookMesh.position.clone().sub(state.indexTip))/denominator;
    if(t<0||t>1.15)continue;
    const point=state.indexTip.clone().addScaledVector(direction,t);
    const local=notebookMesh.worldToLocal(point.clone());
    if(Math.abs(local.x)>NOTE_WORLD_W*.49||Math.abs(local.y)>NOTE_WORLD_H*.49)continue;
    hit={point,uv:{x:local.x/NOTE_WORLD_W+.5,y:local.y/NOTE_WORLD_H+.5}};
    source='FINGER';break;
  }
  if(!hit) {
    noteRaycaster.set(headPosition,gazeDirection);noteRaycaster.near=.1;noteRaycaster.far=2.0;
    hit=noteRaycaster.intersectObject(notebookMesh,false)[0];
  }
  let hover=null;
  if(hit?.uv){
    const px=hit.uv.x*NOTE_W,py=(1-hit.uv.y)*NOTE_H;
    const matched=notebookButtons.find(b=>px>=b.x-24&&px<=b.x+b.w+24&&py>=b.y-20&&py<=b.y+b.h+20);
    hover=matched?.id||null;
    cursorMesh.visible=true;
    cursorMesh.position.copy(hit.point).addScaledVector(gazeDirection,-.012);
    cursorMesh.quaternion.copy(notebookMesh.quaternion);
    cursorMesh.material.color.set(source==='FINGER'?0x89efaf:0x64dfff);
  } else cursorMesh.visible=false;
  pointerMethod=source;
  if(hover!==notebookHover){notebookHover=hover;paintNotebook();}
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
  if(!id)return;
  caseFeedback='';playSound('select');
  if(id==='close'){closeNotebook();return;}
  if(id==='gloves:toggle'){
    glovesEnabled=!glovesEnabled;
    caseFeedback=glovesEnabled?'VIRTUAL GLOVE OVERLAY ON':'VIRTUAL GLOVE OVERLAY OFF';
    paintNotebook();return;
  }
  if(id==='nav:prev'||id==='nav:next') {
    const pos=notebookPages.indexOf(notebookPage),delta=id==='nav:next'?1:-1;
    notebookPage=notebookPages[(pos+delta+notebookPages.length)%notebookPages.length];
    accusationConfirm=null;paintNotebook();return;
  }
  if(id.startsWith('clue:')){
    notebookSelectedClue=id.slice(5);paintNotebook();return;
  }
  if(id==='confirm:back'){
    accusationConfirm=null;paintNotebook();return;
  }
  if(id==='confirm:accuse'){
    const suspected=accusationConfirm;accusationConfirm=null;
    if(suspected===2){gameResult='solved';verdictReason='Supported finding';playSound('end');}
    else if(suspected===3){gameResult='open';points=Math.max(0,points-15);verdictReason='Investigation left open';playSound('wrong');}
    else {gameResult='failed';points=Math.max(0,points-50);verdictReason='Wrong person accused';playSound('wrong');}
    notebookPage='outcome';paintNotebook();return;
  }
  if(id.startsWith('answer:')&&!gameResult&&evidence.every(e=>e.collected)){
    const choice=Number(id.slice(7)),q=QUESTIONS[deductionStep];
    if(!q||!Number.isInteger(choice)||choice<0||choice>=q.answers.length)return;
    if(deductionStep===QUESTIONS.length-1){accusationConfirm=choice;paintNotebook();return;}
    if(choice===q.correct){deductionStep++;caseFeedback='INSIGHT RECORDED: '+q.proof;playSound('correct');}
    else {
      const key=deductionStep+':'+choice;
      if(!wrongDeductions.has(key)){wrongDeductions.add(key);points=Math.max(0,points-q.cost);}
      caseFeedback='CHECK THE FILE: '+q.hint;playSound('wrong');
    }
    paintNotebook();return;
  }
  if(id==='replay'){
    points=100;deductionStep=0;gameResult=null;caseFeedback='CASE REOPENED. CHECK THE CLUES AGAIN.';
    wrongDeductions.clear();accusationConfirm=null;
    for(const item of evidence){
      item.collected=false;item.group.visible=item.placed;
      if(item.ring)item.ring.visible=true;
      if(item.surfacePosition)item.group.position.copy(item.surfacePosition);
      if(item.surfaceQuaternion)item.group.quaternion.copy(item.surfaceQuaternion);
    }
    notebookSelectedClue='table';notebookPage='brief';playSound('correct');paintNotebook();
  }
}

function onFrame(now, frame) {
  if(!frame)return;
  frameNumber++;
  const viewerPose=frame.getViewerPose(refSpace);
  if(viewerPose){
    updateHeadAndHUD(viewerPose);
    considerPlacement(frame,now);
    gazeTarget=notebookOpen?null:getGazeTarget();
  }
  processHands(frame);
  if(viewerPose&&notebookOpen)updateNotebookGaze();
  if(frameNumber%8===0)updateFeedback(now);
  renderer.render(scene,camera);
}
