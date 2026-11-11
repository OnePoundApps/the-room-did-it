import * as THREE from 'three';

// PULSE TRACE · Competition vertical slice PT-0.1 · One Pound Apps Ltd.
// Original 2026 London mystery. No personal health data is collected.
// This replaces the old story; Git history preserves The Room Did It versions.
const BUILD = 'PT-0.1 · 10 NOV 2026';
const $ = id => document.getElementById(id);
const landing = $('landing'), desktop = $('desktop'), startBtn = $('startBtn'), statusEl = $('status');
const caseCanvas = $('caseCanvas'), ctx = caseCanvas.getContext('2d');
const W=1280,H=900;
const T = {
  bg:'#091823', panel:'#112632', panel2:'#17323f', edge:'#335969', ink:'#eff8fa', muted:'#acc3cc',
  cyan:'#6ce4ec', gold:'#e6bd76', red:'#e68881', green:'#86dbbb'
};
const frames = [
  {time:'22:08',bpm:76,steps:0,detail:'Ordinary household activity. No anomaly.',source:'Watch / activity log'},
  {time:'22:12',bpm:82,steps:8,detail:'The time Callum claims the home invasion occurred.',source:'999 statement / call transcript'},
  {time:'22:18',bpm:98,steps:36,detail:'Leila’s phone sends a message about confronting Callum.',source:'Recovered messaging record'},
  {time:'22:21',bpm:124,steps:87,detail:'Movement burst and rising pulse; neither alone proves an assault.',source:'Watch / movement and optical sensor'},
  {time:'22:24',bpm:138,steps:104,detail:'Abrupt motion. Watch near study hub, with LIMITED zone confidence.',source:'Watch + nearby device proximity'},
  {time:'22:27',bpm:73,steps:105,detail:'A second phone logs an authenticated unlock. Who used it?',source:'Second phone / biometric unlock log'},
  {time:'22:36',bpm:null,steps:105,detail:'Smart lock records activity late in the timeline.',source:'House / smart lock record'},
  {time:'22:41',bpm:null,steps:105,detail:'Callum calls 999 after a claimed 22:12 attack.',source:'Emergency-call transcript'}
];
const records = [
  {name:'CALLUM’S STATEMENT',type:'AUDIO TRANSCRIPT / 999',text:'“Two men came in just after ten. I tried to stop them. I was struck and blacked out. I came to and called for help.”',note:'Claims the attack happened at 22:12 and he was unconscious until the call.'},
  {name:'SECOND PHONE',type:'DIGITAL EXTRACTION / 22:27',text:'Successful local biometric unlock followed by an active screen session at 22:27. Device registered to Callum Mercer.',note:'Strong contradiction to unconsciousness; device ownership alone cannot prove who touched it.'},
  {name:'DOOR & GLASS',type:'SCENE EXAMINATION',text:'No exterior opening recorded near 22:12. Broken glass was predominantly scattered inside the hallway. A door event appears at 22:36.',note:'Favors a staged scene, but neither a missed lock event nor glass pattern is conclusive by itself.'},
  {name:'FORENSIC PHOTOGRAPH',type:'RECOVERED STUDY TRACE',text:'A metal bookend is absent from a dusty shelf. A non-graphic forensic report associates a heavy impact with the study.',note:'Physical findings corroborate an assault near the study; further testing is required.'},
  {name:'LEILA’S MESSAGE',type:'RECOVERED TEXT / 22:18',text:'“I found the transfers. We need to talk tonight. I’m going into the study.”',note:'Establishes conflict and intention, not direct proof that Callum killed her.'},
  {name:'LAPTOP SESSION',type:'BROWSER ARTEFACTS',text:'A recovered query about clearing domestic security event history was made during the late evening. The user cannot be attributed from this record alone.',note:'Potential concealment motive. Must be paired with device and scene findings.'}
];
const questions = [
  {q:'What does the smartwatch record at 22:24 actually establish?',opts:['The exact time of death','A movement event and uncertain nearby-device zone','That Callum struck Leila'],right:1,why:'Sensors report motion and proximity. They cannot independently identify a killer or certify the time of death.'},
  {q:'Which evidence most directly challenges Callum’s “unconscious until 999” claim?',opts:['The missing bookend','Leila’s elevated pulse','The second phone’s authenticated unlock at 22:27'],right:2,why:'The second phone recorded active authenticated use during the claimed period of unconsciousness. Who used it must still be considered.'},
  {q:'What is the strongest interpretation of the alleged break-in?',opts:['The door and glass patterns suggest staging, but need corroboration','Glass on the floor proves two intruders entered','The smartwatch proves the door never opened'],right:0,why:'Door and glass evidence support possible staging. They do not alone prove that no intruder entered.'},
  {q:'Which reconstruction best fits the independent records?',opts:['Burglars killed Leila at 22:12; Callum awoke at 22:41','A confrontation continued after 22:12, followed by probable staging and a later call','Leila died of an overdose in another room'],right:1,why:'The activity sequence, messages, forensic findings, device unlock and door log are collectively most consistent with the later confrontation and staging hypothesis.'}
];
const PAGE_NAMES=['BRIEF','WATCH','RECORDS','SCENE','DEDUCE','VERDICT'];
let state, caseTexture=null, actions=[];
function reset(){
  state={page:0,record:0,frame:4,seen:new Set(),answers:{},q:0,score:100,feedback:'',verdict:null,
    watchFound:false,phoneFound:false,sceneObserved:false,voiceOn:false,
    notebookOpen:false,intro:false,introStart:0,introText:0,vr:false, roomMessage:'Detecting nearby surfaces…',
    speaker:''};
  drawCase();
}
reset();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const fmt=n=>Math.round(n);
function rounded(x,y,w,h,r=14,fill=T.panel,stroke=T.edge){
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
}
function txt(s,x,y,size=29,color=T.ink,bold=false,align='left'){
  ctx.fillStyle=color;ctx.font=`${bold?'750':'450'} ${size}px Segoe UI, Arial, sans-serif`;
  ctx.textAlign=align;ctx.textBaseline='top';ctx.fillText(String(s),x,y);
}
function para(s,x,y,maxWidth,size=28,line=39,color=T.ink,maxLines=10){
  ctx.font=`450 ${size}px Segoe UI, Arial, sans-serif`;
  const words=String(s).split(/\s+/), lines=[];let out='';
  for(const word of words){const next=out?out+' '+word:word;
    if(ctx.measureText(next).width>maxWidth&&out){lines.push(out);out=word;}else out=next;}
  if(out)lines.push(out);
  lines.slice(0,maxLines).forEach((q,i)=>txt(q,x,y+i*line,size,color));
  return y+Math.min(maxLines,lines.length)*line;
}
function button(id,label,x,y,w,h,kind='normal',font=29){
  const fill=kind==='active'?'#2d6975':kind==='danger'?'#4b303a':kind==='primary'?'#255969':T.panel2;
  rounded(x,y,w,h,11,fill,kind==='active'?T.cyan:'#446675');
  // labels may be multi-line, with an explicit | separator
  const parts=label.split('|');const step=font+6;
  parts.forEach((part,i)=>txt(part,x+w/2,y+(h-parts.length*step)/2+i*step+2,font,kind==='active'?T.cyan:T.ink,true,'center'));
  actions.push({id,x,y,w,h});
}
function base(title,kicker){
  actions=[];ctx.clearRect(0,0,W,H);ctx.fillStyle=T.bg;ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#12313e';ctx.fillRect(0,0,W,17);ctx.fillStyle=T.cyan;ctx.fillRect(0,0,Math.max(8,(state.page+1)/6*W),8);
  txt('PULSE TRACE   /   CASE 001',42,39,24,T.cyan,true);txt(BUILD,1236,44,19,T.muted,false,'right');
  txt(title,43,91,54,T.ink,true);txt(kicker,44,162,22,T.muted);
  ctx.strokeStyle=T.edge;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(43,205);ctx.lineTo(1237,205);ctx.stroke();
}
function nav(){
  const labels=['BRIEF','WATCH','RECORDS','SCENE','DEDUCE','VERDICT'];
  const width=187;
  labels.forEach((n,i)=>button('page:'+i,n,42+i*199,790,width,75,i===state.page?'active':'normal',24));
}
function topInfo(label,val,x,y,w){rounded(x,y,w,105,12,T.panel);txt(label,x+20,y+15,20,T.muted,true);txt(val,x+20,y+46,31,T.cyan,true);}
function paintBrief(){
  base('THE MERCER RESIDENCE','BERMONDSEY, LONDON · NOVEMBER 2026 · ACTIVE INVESTIGATION');
  rounded(43,233,762,502);txt('INCIDENT SUMMARY',69,263,26,T.gold,true);
  para('Leila Mercer is dead. Her husband Callum says two men entered their home at 22:12, attacked her and knocked him unconscious.',70,323,694,32,47,T.ink);
  para('The original scene has already been secured. You have access to the remaining physical clues and digital records.',70,472,694,29,43,T.muted);
  txt('YOUR OBJECTIVE',69,595,25,T.gold,true);
  para('Find the contradiction. Reconstruct what happened. Recommend the action the evidence actually supports.',69,637,694,27,38);
  rounded(829,233,405,502);txt('INVESTIGATION',855,263,27,T.cyan,true);
  topInfo('TIME OF 999 CALL','22:41',855,319,352);
  topInfo('ALLEGED ATTACK','22:12',855,443,352);
  button('page:1','EXAMINE THE WATCH',855,594,352,87,'primary',25);
  txt('Touch or point and pinch to select.',858,698,21,T.muted);
}
function paintWatch(){
  base('WHAT DID THE WATCH RECORD?','SCRUB THE TIMELINE · A SENSOR READING IS NOT A VERDICT');
  rounded(43,233,1193,315);
  const l=95,r=1150,t=285,b=494;
  for(let k=0;k<=3;k++){const y=t+k*(b-t)/3;ctx.strokeStyle='#2b4653';ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(r,y);ctx.stroke();}
  const xFor=i=>l+i*(r-l)/(frames.length-1);
  const yFor=v=>b-(clamp(v??60,60,150)-60)/90*(b-t);
  ctx.beginPath();frames.forEach((o,i)=>{const x=xFor(i),y=yFor(o.bpm);if(!i)ctx.moveTo(x,y);else if(o.bpm!=null&&frames[i-1].bpm!=null)ctx.lineTo(x,y);else ctx.moveTo(x,y);});
  ctx.strokeStyle=T.cyan;ctx.lineWidth=5;ctx.stroke();
  frames.forEach((o,i)=>{
    if(o.bpm==null)return;ctx.beginPath();ctx.arc(xFor(i),yFor(o.bpm),i===state.frame?12:6,0,Math.PI*2);ctx.fillStyle=i===state.frame?T.gold:T.cyan;ctx.fill();
  });
  ctx.strokeStyle=T.gold;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(xFor(state.frame),t-4);ctx.lineTo(xFor(state.frame),b+7);ctx.stroke();
  frames.forEach((o,i)=>txt(o.time,xFor(i),512,18,i===state.frame?T.gold:T.muted,true,'center'));
  actions.push({id:'timeline-scrub',x:l-16,y:260,w:r-l+32,h:292});
  rounded(43,575,1193,160);txt(frames[state.frame].time+'  /  '+(frames[state.frame].bpm??'NO SIGNAL')+(frames[state.frame].bpm==null?'':' BPM'),67,598,35,T.cyan,true);
  para(frames[state.frame].detail,67,650,1130,27,34,T.ink,2);
  txt('SOURCE: '+frames[state.frame].source.toUpperCase(),67,708,17,T.muted);
  button('timeline:prev','◀ PREVIOUS',43,745,235,35,'normal',20);
  button('timeline:next','NEXT ▶',1001,745,235,35,'normal',20);
  state.seen.add('watch');
}
function paintRecords(){
  base('DIGITAL EVIDENCE','RECORDS SHOULD BE CROSS-CHECKED · THEY ARE NOT SELF-INTERPRETING');
  const cols=[0,1,2,3,4,5];
  cols.forEach((i)=>button('record:'+i,(i+1)+'. '+['STATEMENT','2ND PHONE','DOOR / GLASS','FORENSIC','MESSAGE','LAPTOP'][i],43+(i%3)*401,235+Math.floor(i/3)*72,385,62,state.record===i?'active':'normal',22));
  rounded(43,410,1193,335);txt(records[state.record].name,72,439,35,T.cyan,true);
  txt(records[state.record].type,72,494,22,T.gold,true);
  const low=para(records[state.record].text,72,550,1126,30,43,T.ink,3);
  para(records[state.record].note,72,Math.min(670,low+23),1114,24,35,T.muted,2);
  state.seen.add('records');
}
function paintScene(){
  base('RECONSTRUCT THE ROOM','THE SCENE MAY BE STAGED · FIND INDEPENDENT CORROBORATION');
  rounded(43,238,575,492);rounded(642,238,594,492);
  txt('WHAT WAS FOUND',66,266,27,T.gold,true);
  const a=[['WATCH','Movement after 22:12'],['SMART LOCK','No logged exterior entry at 22:12'],['GLASS','Mostly inside the hallway'],['STUDY','Heavy bookend missing'],['PHONE','Authenticated activity at 22:27']];
  a.forEach((o,i)=>{txt(o[0],67,325+i*69,23,T.cyan,true);txt(o[1],195,325+i*69,22,T.ink);});
  txt('WHAT IT DOESN’T PROVE',665,266,27,T.gold,true);
  para('GPS cannot reliably pinpoint a room indoors. Optical pulse can be noisy. A device can move without its owner. A failed door log does not exclude every kind of entry.',668,325,531,28,41);
  txt('RECONSTRUCTION NOTE',668,522,26,T.cyan,true);
  para('Look for convergence: activity, access records, messages, forensic examination and accounts from people.',668,573,521,27,39);
  state.seen.add('scene');
}
function paintDeduce(){
  base('TEST YOUR REASONING','FOUR QUESTIONS · WRONG INFERENCES REDUCE THE CASE SCORE');
  const q=questions[state.q], answered=state.answers[state.q];
  rounded(43,237,1193,117);txt('QUESTION '+(state.q+1)+' / '+questions.length,69,254,23,T.cyan,true);
  para(q.q,70,291,1120,31,38,T.ink,2);
  q.opts.forEach((o,i)=>button('answer:'+i,String.fromCharCode(65+i)+'. '+o,43,373+i*105,1193,86,answered?.choice===i?'active':'normal',25));
  if(answered){
    txt(answered.choice===q.right?'REASONING SUPPORTED':'WEAK / INCORRECT INFERENCE',55,699,23,answered.choice===q.right?T.green:T.red,true);
    para(q.why,55,733,1165,21,26,T.muted,2);
  }else txt('Choose the best-supported conclusion. You cannot revise a submitted answer.',53,714,21,T.muted);
  button('question:prev','◀',1040,230,86,67,'normal',30);
  button('question:next','▶',1141,230,86,67,'normal',30);
}
function paintVerdict(){
  base('YOUR RECOMMENDATION','A CONVICTION REQUIRES A COURT. YOU MUST JUSTIFY AN INVESTIGATIVE DECISION.');
  const correct=questions.filter((q,i)=>state.answers[i]?.choice===q.right).length;
  if(state.verdict){
    rounded(43,238,1193,465);
    const v=state.verdict;
    const success=v==='arrest'&&correct>=3;
    const heading=success?'CASE RECONSTRUCTED':v==='wrong'?'WRONGFUL ACCUSATION':v==='hold'?'CASE REMAINS OPEN':'UNSUPPORTED ALLEGATION';
    txt(heading,72,270,52,success?T.green:v==='hold'?T.gold:T.red,true);
    txt('EVIDENCE SCORE: '+state.score+'/100',72,357,34,T.cyan,true);
    const description=success?'Records, witness account and physical findings collectively support recommending Callum’s arrest while further forensic work continues.':
      v==='wrong'?'You accused an uninvolved former colleague while overlooking authenticated device activity and the staging evidence. The principal suspect remains unchallenged.':
      v==='hold'?'You withheld an arrest recommendation. More testing is justified, though the available contradictions deserve focused follow-up.':
      'You reached the likely suspect, but key inferences were insufficiently supported. The investigation needs corroboration, not certainty from one sensor.';
    para(description,72,450,1080,30,45,T.ink,4);
    button('restart','REPLAY INVESTIGATION',75,594,515,81,'primary',26);
  }else{
    rounded(43,236,1193,125);
    txt('YOUR READINESS',67,254,23,T.gold,true);
    para(`${Object.keys(state.answers).length}/4 deductions submitted. Review the notebook before choosing your final recommendation.`,67,296,1100,29,38);
    button('verdict:arrest','RECOMMEND ARREST OF CALLUM|EVIDENCE MUST BE CORROBORATED',43,385,1193,105,'primary',27);
    button('verdict:wrong','ACCUSE LEILA’S FORMER COLLEAGUE|THREATENING MESSAGES ARE ENOUGH',43,508,1193,105,'normal',27);
    button('verdict:hold','WITHHOLD RECOMMENDATION|REQUEST FURTHER INVESTIGATION',43,631,1193,105,'normal',27);
  }
}
function drawCase(){
  if(!ctx || !state)return;
  [paintBrief,paintWatch,paintRecords,paintScene,paintDeduce,paintVerdict][state.page]();nav();
  // Notebook controls are intentionally inside the panel, never open on empty-space pinch.
  if(state.vr){button('close','CLOSE CASEFILE',974,27,260,53,'normal',20);}
  if(caseTexture)caseTexture.needsUpdate=true;
}
function activate(id,x=null){
  if(!id)return;
  if(id.startsWith('page:'))state.page=clamp(Number(id.split(':')[1]),0,5);
  else if(id.startsWith('record:'))state.record=clamp(Number(id.split(':')[1]),0,records.length-1);
  else if(id==='timeline:prev')state.frame=clamp(state.frame-1,0,frames.length-1);
  else if(id==='timeline:next')state.frame=clamp(state.frame+1,0,frames.length-1);
  else if(id==='timeline-scrub')state.frame=clamp(Math.round((x-95)/(1150-95)*(frames.length-1)),0,frames.length-1);
  else if(id==='question:prev')state.q=clamp(state.q-1,0,questions.length-1);
  else if(id==='question:next')state.q=clamp(state.q+1,0,questions.length-1);
  else if(id.startsWith('answer:')){
    if(state.answers[state.q]===undefined){
      const choice=Number(id.split(':')[1]);state.answers[state.q]={choice};
      if(choice!==questions[state.q].right)state.score=Math.max(0,state.score-15);
    }
  }
  else if(id.startsWith('verdict:')){
    if(state.verdict===null){
      state.verdict=id.split(':')[1];
      const n=questions.filter((q,i)=>state.answers[i]?.choice===q.right).length;
      if(state.verdict==='wrong')state.score=Math.max(0,state.score-30);
      else if(state.verdict==='arrest'&&n<3)state.score=Math.max(0,state.score-20);
      else if(state.verdict==='arrest')state.score=Math.min(100,state.score+10);
    }
  }
  else if(id==='restart'){const wasVr=state.vr;reset();state.vr=wasVr;if(wasVr)state.notebookOpen=true;drawCase();return;}
  else if(id==='close'){setCasefile(false);return;}
  state.seen.add(id);drawCase();
}
function hitAction(x,y){return [...actions].reverse().find(b=>x>=b.x && y>=b.y && x<=b.x+b.w && y<=b.y+b.h)??null;}
const pointerPos=e=>{const r=caseCanvas.getBoundingClientRect();return [(e.clientX-r.left)/r.width*W,(e.clientY-r.top)/r.height*H];};
caseCanvas.addEventListener('pointerdown',e=>{const [x,y]=pointerPos(e);const a=hitAction(x,y);if(a){activate(a.id,x);caseCanvas.setPointerCapture(e.pointerId);}});
caseCanvas.addEventListener('pointermove',e=>{if(!(e.buttons&1)||state.page!==1)return;const [x,y]=pointerPos(e);if(y>260&&y<553)activate('timeline-scrub',x);});
window.PulseTraceQA={getState:()=>({page:state.page,score:state.score,q:state.q,answers:structuredClone(state.answers),verdict:state.verdict}),activate,reset};

// ------------------------- SPATIAL SCENE --------------------------
let renderer=null,scene=null,camera=null,session=null,refSpace=null,hitSource=null;
let sceneRunning=false,mode='landing',viewerPosition=new THREE.Vector3(),viewerQuat=new THREE.Quaternion();
let watch=null,phone=null,laptop=null,sceneDressing=null,worldWatch=null,worldPhone=null;
let floorEvidence=null,wallEvidence=null,watchPosition=new THREE.Vector3();
let roomItems=[],roomPlanes={table:false,floor:false,wall:false},validSurfaces=0;
let tabletopPosition=null,floorPosition=null,wallPose=null,hitSamples=[];
let notebookMesh=null,launcher=null,introMesh=null,introTex=null,introCtx=null,launcherCtx=null,launcherTex=null,handCursor=null;
let lastHud=0,lastPaint=0,activeGrab=null,handMemory=new WeakMap();
let ray=new THREE.Raycaster(),_p=new THREE.Vector3(),_q=new THREE.Quaternion();
const mat=(hex,metal=0,rough=.5)=>new THREE.MeshStandardMaterial({color:hex,metalness:metal,roughness:rough});
const basic=hex=>new THREE.MeshBasicMaterial({color:hex});
const mesh=(geo,material,x=0,y=0,z=0)=>{const o=new THREE.Mesh(geo,material);o.position.set(x,y,z);return o;};
function cube(w,h,d,color,x=0,y=0,z=0,metal=0,rough=.6){return mesh(new THREE.BoxGeometry(w,h,d),mat(color,metal,rough),x,y,z);}
function planeContact(w=.21,h=.21){const cv=document.createElement('canvas');cv.width=cv.height=128;const c=cv.getContext('2d');
  const grad=c.createRadialGradient(64,64,0,64,64,63);grad.addColorStop(0,'#00000066');grad.addColorStop(1,'#00000000');c.fillStyle=grad;c.fillRect(0,0,128,128);
  const tex=new THREE.CanvasTexture(cv);const m=mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}),0,.001,0);m.rotation.x=-Math.PI/2;return m;}
function labelSprite(str,accent='#78dbe8'){
  const cv=document.createElement('canvas');cv.width=512;cv.height=128;let c=cv.getContext('2d');
  c.fillStyle='#061620d9';c.fillRect(0,0,512,128);c.strokeStyle=accent;c.lineWidth=8;c.strokeRect(3,3,506,122);
  c.font='bold 40px Segoe UI, Arial';c.fillStyle=accent;c.textAlign='center';c.textBaseline='middle';c.fillText(str,256,63,490);
  const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;
  return mesh(new THREE.PlaneGeometry(.29,.075),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide}),0,.14,0);
}
function proceduralWatch(){
  const g=new THREE.Group(),strap=mat(0x1a2b35,0,.9),caseMat=mat(0x697b84,.68,.3);
  g.userData.kind='watch';
  g.add(planeContact(.26,.34));
  g.add(cube(.087,.009,.35,0x24333c,0,.018,0));
  for(const z of [-.115,.115])g.add(cube(.087,.013,.115,0x283741,0,.018,z));
  const body=cube(.135,.036,.158,0x2b3e49,0,.046,0,.62,.24);g.add(body);
  const bezel=cube(.126,.006,.150,0x79949c,0,.068,0,.76,.17);g.add(bezel);
  const screen=cube(.112,.004,.137,0x06141d,0,.074,0,0,.09);g.add(screen);
  const crown=mesh(new THREE.CylinderGeometry(.010,.010,.018,12),caseMat,.072,.054,.0);crown.rotation.z=Math.PI/2;g.add(crown);
  const cv=document.createElement('canvas');cv.width=480;cv.height=640;const c=cv.getContext('2d');
  c.fillStyle='#030e15';c.fillRect(0,0,480,640);c.fillStyle='#79deea';c.font='bold 42px Arial';c.fillText('22:24',35,70);
  c.font='bold 82px Arial';c.fillText('138',36,180);c.font='26px Arial';c.fillText('BPM',264,179);
  c.strokeStyle='#74e1ea';c.lineWidth=9;c.beginPath();[[15,395],[95,395],[150,350],[170,436],[205,260],[235,477],[300,357],[380,350],[465,360]].forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();
  c.fillStyle='#819fae';c.font='27px Arial';c.fillText('TRACE RECORD / 001',32,587);
  const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;
  const face=mesh(new THREE.PlaneGeometry(.11,.133),new THREE.MeshBasicMaterial({map:tex,transparent:false}),0,.078,0);face.rotation.x=-Math.PI/2;g.add(face);
  g.add(labelSprite('01 · WATCH'));return g;
}
function proceduralPhone(){
  const g=new THREE.Group();g.userData.kind='phone';g.add(planeContact(.21,.26));
  g.add(cube(.09,.013,.165,0x1b2026,0,.014,0,.48,.24));
  const screen=cube(.083,.002,.152,0x060e17,0,.022,0);g.add(screen);
  const cv=document.createElement('canvas');cv.width=300;cv.height=560;const c=cv.getContext('2d');
  c.fillStyle='#081722';c.fillRect(0,0,300,560);c.fillStyle='#73deeb';c.font='bold 46px Arial';c.fillText('22:27',26,78);
  c.font='26px Arial';c.fillStyle='#aec9d1';c.fillText('UNLOCK SUCCESS',20,191);
  c.fillText('LOCAL BIOMETRIC',20,236);c.fillStyle='#e1b980';c.fillText('CASE TRACE / 02',20,482);
  const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;
  const face=mesh(new THREE.PlaneGeometry(.077,.145),new THREE.MeshBasicMaterial({map:tex}),0,.024,0);face.rotation.x=-Math.PI/2;g.add(face);
  g.add(labelSprite('02 · PHONE'));return g;
}
function proceduralLaptop(){
  const g=new THREE.Group();g.add(planeContact(.42,.39));
  g.add(cube(.29,.012,.20,0x566775,0,.015,.03,.5,.35));
  const screen=new THREE.Group();screen.position.set(0,.02,-.075);screen.rotation.x=-.21;
  screen.add(cube(.29,.194,.011,0x3c525e,0,.095,0,.5,.35));
  screen.add(cube(.271,.174,.002,0x0a202b,0,.096,.007));g.add(screen);
  for(let k=0;k<7;k++)g.add(cube(.21,.001,.002,0x283844,0,.022,-.017+k*.02));
  return g;
}
function mug(){const g=new THREE.Group();g.add(planeContact(.14,.14));
  g.add(mesh(new THREE.CylinderGeometry(.037,.031,.090,24),mat(0xd0c5b5,.12,.4),0,.046,0));
  const handle=mesh(new THREE.TorusGeometry(.024,.007,10,24,Math.PI*1.5),mat(0xc0b9ac),.041,.053,0);handle.rotation.y=Math.PI/2;g.add(handle);return g;}
function book(){const g=new THREE.Group();g.add(planeContact(.25,.24));g.add(cube(.14,.024,.20,0x2d4758,0,.019,0));
  g.add(cube(.14,.008,.2,0xdfdcd1,0,.009,0));return g;}
function keys(){const g=new THREE.Group();const ring=mesh(new THREE.TorusGeometry(.018,.003,8,20),mat(0xb8b0a1,.8,.24),0,.010,0);ring.rotation.x=-Math.PI/2;g.add(ring);
  for(let i=0;i<2;i++)g.add(cube(.007,.004,.075,0xb1a18a,(i-.5)*.02,.011,.045,.9,.3));return g;}
function fragments(){const g=new THREE.Group();const m=new THREE.MeshStandardMaterial({color:0x91d7e6,metalness:.3,roughness:.18,transparent:true,opacity:.55,side:THREE.DoubleSide});
  for(let i=0;i<9;i++){const a=(i*2.4);const frag=mesh(new THREE.TetrahedronGeometry(.012+(i%3)*.005),m,Math.sin(a)*(.07+i*.009),.008,Math.cos(a)*(.04+i*.01));frag.rotation.set(.3*i,i,.7*i);g.add(frag);}return g;}
function evidenceMarker(id){const g=new THREE.Group();
  const ring=mesh(new THREE.TorusGeometry(.075,.003,8,40),new THREE.MeshBasicMaterial({color:0x6bdfea,transparent:true,opacity:.5}),0,.004,0);
  ring.rotation.x=-Math.PI/2;g.add(ring);return g;}
function wallPhoto(){
  const g=new THREE.Group();const c=document.createElement('canvas');c.width=640;c.height=430;const z=c.getContext('2d');
  z.fillStyle='#c7c9c4';z.fillRect(0,0,640,430);z.fillStyle='#425461';z.fillRect(20,20,600,43);
  z.font='bold 27px Arial';z.fillStyle='#e4edf1';z.fillText('FORENSIC IMAGE / STUDY',36,50);
  z.fillStyle='#9c9794';z.fillRect(38,82,564,272);z.strokeStyle='#646767';z.lineWidth=9;z.strokeRect(153,124,292,175);
  z.fillStyle='#e2bf78';z.fillRect(33,362,570,48);z.fillStyle='#102029';z.font='23px Arial';z.fillText('MISSING BOOKEND · TRACE ANALYSIS',47,393);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  g.add(mesh(new THREE.PlaneGeometry(.39,.26),new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}),0,0,.005));return g;
}
function setupScene(){
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(72,1,.03,40);
  scene.add(camera);scene.add(new THREE.HemisphereLight(0xddefff,0x394555,2.0));
  const sun=new THREE.DirectionalLight(0xf8e5d2,2.3);sun.position.set(1,3,2);scene.add(sun);
  roomItems=[];roomPlanes={table:false,floor:false,wall:false};hitSamples=[];
  watch=null;phone=null;laptop=null;worldWatch=null;worldPhone=null;floorEvidence=null;wallEvidence=null;
  tabletopPosition=null;floorPosition=null;wallPose=null;activeGrab=null;
}
function makeTabletopGroup(p,wide=false){
  const world=new THREE.Group();world.position.copy(p);world.name='tableEvidence';
  world.add(planeContact(.52,.40));
  watch=proceduralWatch();watch.position.set(-.13,0,-.02);world.add(watch);
  phone=proceduralPhone();phone.position.set(.13,0,.04);phone.rotation.y=-.20;world.add(phone);
  const cup=mug();cup.position.set(.23,0,-.15);world.add(cup);
  const bk=book();bk.position.set(-.24,0,.17);bk.rotation.y=.18;world.add(bk);
  const k=keys();k.position.set(.02,0,-.15);world.add(k);
  if(wide){const pc=proceduralLaptop();pc.position.set(.41,0,-.10);pc.rotation.y=.12;world.add(pc);}
  scene.add(world);worldWatch=world;roomItems.push(world);
  watch.updateMatrixWorld(true);phone.updateMatrixWorld(true);
  state.roomMessage='Watch and phone positioned on a recognised table';
}
function addFloor(p){const g=new THREE.Group();g.position.copy(p);g.add(fragments());g.add(evidenceMarker('floor'));
  scene.add(g);floorEvidence=g;roomItems.push(g);}
function addWall(p,quat){const g=wallPhoto();g.position.copy(p);g.quaternion.copy(quat);
  // The photograph is a wall-mounted archival overlay, not blood that can be picked up.
  g.position.add(new THREE.Vector3(0,0,.008).applyQuaternion(quat));scene.add(g);wallEvidence=g;roomItems.push(g);}
function choosePlane(frame,plane,goal){
  const pose=frame.getPose(plane.planeSpace,refSpace);if(!pose)return null;
  const v=pose.transform.position,q=pose.transform.orientation;
  const y=v.y,orientation=plane.orientation;
  if(goal==='wall' && orientation!=='vertical')return null;
  if(goal!=='wall' && orientation!=='horizontal')return null;
  if(goal==='table' && (y<.48||y>1.23))return null;
  if(goal==='floor' && (y<-.25||y>.25))return null;
  const points=plane.polygon?Array.from(plane.polygon):[];
  if(points.length<3)return null;const xs=points.map(p=>p.x),zs=points.map(p=>p.z??p.y??0);
  const wd=Math.max(...xs)-Math.min(...xs),dp=Math.max(...zs)-Math.min(...zs);
  // Require an actual broad surface; small shelves/stereos do not qualify for tabletop evidence.
  if(goal==='table'&&(wd<.55||dp<.42))return null;
  if(goal==='floor'&&(wd<1.0||dp<.8))return null;
  if(goal==='wall'&&Math.max(wd,dp)<.65)return null;
  const cq=new THREE.Quaternion(q.x,q.y,q.z,q.w),p=new THREE.Vector3(v.x,v.y,v.z);
  const center=new THREE.Vector3((Math.min(...xs)+Math.max(...xs))/2,0,(Math.min(...zs)+Math.max(...zs))/2);
  const worldCenter=center.applyQuaternion(cq).add(p);
  const dist=worldCenter.distanceTo(viewerPosition);
  if(dist>3.5)return null;
  const score=(goal==='table'?3:2)-Math.abs(dist-1)*.7+(plane.semanticLabel==='TABLE'?3:0);
  return {position:worldCenter,quat:cq,score,width:wd,depth:dp};
}
function ingestHitSamples(frame){
  if(!hitSource||!frame.getHitTestResults)return;
  try{const hits=frame.getHitTestResults(hitSource);if(!hits?.length)return;
    const pose=hits[0].getPose(refSpace);if(!pose)return;
    const p=pose.transform.position;const sample={x:p.x,y:p.y,z:p.z,time:performance.now()};
    hitSamples.push(sample);if(hitSamples.length>150)hitSamples.shift();
  }catch(e){/* Hit testing is optional. */}
}
function hitTableGuess(){
  // No blind one-point hit placement. Require a set of observations spanning tabletop width and depth.
  const samples=hitSamples.filter(p=>p.y>.50&&p.y<1.2);
  if(samples.length<35)return null;
  const bins=new Map();for(const p of samples){const key=Math.round(p.y/.055);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(p);}
  let best=null;for(const arr of bins.values()){
    if(arr.length<30)continue;
    const xs=arr.map(v=>v.x),zs=arr.map(v=>v.z),dx=Math.max(...xs)-Math.min(...xs),dz=Math.max(...zs)-Math.min(...zs);
    if(dx<.36||dz<.27)continue;
    const center=new THREE.Vector3((Math.max(...xs)+Math.min(...xs))/2,arr.reduce((s,p)=>s+p.y,0)/arr.length,(Math.max(...zs)+Math.min(...zs))/2);
    if(center.distanceTo(viewerPosition)>2.4)continue;
    const score=arr.length+dx*10+dz*10;
    if(!best||score>best.score)best={position:center,score};
  }return best;
}
function updateRoom(frame){
  if(!sceneRunning||!refSpace)return;
  ingestHitSamples(frame);
  const planes=frame.detectedPlanes;
  if(planes){
    validSurfaces=planes.size;let choices={table:null,floor:null,wall:null};
    for(const plane of planes){
      for(const goal of ['table','floor','wall']){
        if((goal==='table'&&roomPlanes.table)||(goal==='floor'&&roomPlanes.floor)||(goal==='wall'&&roomPlanes.wall))continue;
        const p=choosePlane(frame,plane,goal);if(p&&(!choices[goal]||p.score>choices[goal].score))choices[goal]=p;
      }
    }
    if(!roomPlanes.table&&choices.table){makeTabletopGroup(choices.table.position,choices.table.width>1.20&&choices.table.depth>.75);roomPlanes.table=true;}
    if(!roomPlanes.floor&&choices.floor){addFloor(choices.floor.position);roomPlanes.floor=true;}
    if(!roomPlanes.wall&&choices.wall){addWall(choices.wall.position,choices.wall.quat);roomPlanes.wall=true;}
  }
  if(!roomPlanes.table&&hitSamples.length>=50){const hit=hitTableGuess();if(hit){makeTabletopGroup(hit.position);roomPlanes.table=true;}}
  if(!roomPlanes.table)state.roomMessage=`Scanning table (planes: ${validSurfaces}, samples: ${hitSamples.length})`;
}
function makeDemoScene(){
  setupScene();const roomMat=mat(0x263844,0,.96);
  const floor=cube(4,.08,4,0x3a4a50,0,-.80,-1);scene.add(floor);
  const wall=cube(4,2.8,.08,0x233039,0,.63,-2.9);scene.add(wall);
  const legMat=mat(0x5c473c,0,.68);
  const top=cube(1.65,.075,.95,0x776558,0,.74,-1.05);scene.add(top);
  for(const x of [-.69,.69])for(const z of [-1.42,-.68])scene.add(cube(.06,.72,.06,0x423733,x,.34,z));
  scene.add(cube(1.45,.52,.48,0x3f5761,-.9,-.32,-2.26));
  makeTabletopGroup(new THREE.Vector3(0,.785,-1.05));
  const l=proceduralLaptop();l.position.set(.38,.001,-.06);worldWatch.add(l);
  addFloor(new THREE.Vector3(-.15,-.74,-.58));
  addWall(new THREE.Vector3(.78,.66,-2.835),new THREE.Quaternion());
  roomPlanes={table:true,floor:true,wall:true};state.watchFound=true;state.phoneFound=true;
}

// ------------------------- HANDS AND CASEFILE ---------------------
function uiTex(canvas){const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}
function buildPanel(){
  caseTexture=uiTex(caseCanvas);
  notebookMesh=mesh(new THREE.PlaneGeometry(.94,.663),new THREE.MeshBasicMaterial({map:caseTexture,transparent:false,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));
  notebookMesh.renderOrder=2000;notebookMesh.visible=false;notebookMesh.frustumCulled=false;scene.add(notebookMesh);
  // An actual tracked fingertip cursor rather than the old headset-gaze highlight.
  handCursor=mesh(new THREE.SphereGeometry(.011,12,10),new THREE.MeshBasicMaterial({color:0x78f0f3,depthTest:false,depthWrite:false}));
  handCursor.renderOrder=2200;handCursor.visible=false;scene.add(handCursor);
  const c=document.createElement('canvas');c.width=700;c.height=195;const p=c.getContext('2d');
  launcherCtx=p;launcherTex=uiTex(c);paintLauncher();
  launcher=mesh(new THREE.PlaneGeometry(.30,.083),new THREE.MeshBasicMaterial({map:launcherTex,transparent:true,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));
  launcher.renderOrder=1999;launcher.frustumCulled=false;scene.add(launcher);
  const ic=document.createElement('canvas');ic.width=900;ic.height=600;introCtx=ic.getContext('2d');introTex=uiTex(ic);
  introMesh=mesh(new THREE.PlaneGeometry(.92,.613),new THREE.MeshBasicMaterial({map:introTex,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));
  introMesh.renderOrder=2001;introMesh.frustumCulled=false;introMesh.visible=false;scene.add(introMesh);
  drawCase();
}
function paintLauncher(){
  if(!launcherCtx)return;
  const p=launcherCtx;p.clearRect(0,0,700,195);p.fillStyle='#0b2534ee';p.fillRect(0,0,700,195);
  p.strokeStyle='#67dce8';p.lineWidth=9;p.strokeRect(5,5,690,185);
  p.fillStyle='#86eff0';p.textAlign='center';p.font='bold 69px Arial';p.fillText('OPEN CASEFILE',350,84);
  p.fillStyle='#d5e5e9';p.font='bold 29px Arial';p.fillText(roomPlanes.table?'SCENE EVIDENCE READY':'SCANNING REAL SURFACES',350,147);
  launcherTex.needsUpdate=true;
}
function faceViewer(obj,offset){
  obj.position.copy(viewerPosition).add(offset.clone().applyQuaternion(viewerQuat));
  obj.quaternion.copy(viewerQuat);obj.updateMatrixWorld(true);
}
function setCasefile(open){
  if(!state.vr)return;
  if(open && state.intro)return;
  state.notebookOpen=!!open;
  if(notebookMesh){
    notebookMesh.visible=state.notebookOpen;
    if(open)faceViewer(notebookMesh,new THREE.Vector3(0,-.035,-.79));
  }
  if(launcher)launcher.visible=!state.notebookOpen&&!state.intro;
  drawCase();
}
function startCinematic(){
  state.intro=true;state.introStart=performance.now();introMesh.visible=true;launcher.visible=false;
}
function drawIntro(seconds){
  if(!introCtx)return;
  const c=introCtx;c.fillStyle='#091721';c.fillRect(0,0,900,600);
  const slices=[
    {t:0,cap:'999 EMERGENCY CALL',say:'“Please. I need someone. My wife is not moving.”'},
    {t:5,cap:'CALLER: CALLUM MERCER',say:'“Two men broke in. I tried to stop them.”'},
    {t:10,cap:'THE MERCER HOME · BERMONDSEY',say:'“One hit me. I blacked out.”'},
    {t:15,cap:'VICTIM WEARABLE · LAST ACTIVITY',say:'22:24 · HEART RATE 138 BPM'},
    {t:21,cap:'PULSE TRACE',say:'The statement and the data cannot both be true.'}
  ];
  let frame=slices[0];for(const s of slices)if(seconds>=s.t)frame=s;
  c.fillStyle='#63dce8';c.font='bold 26px Arial';c.fillText('PULSE TRACE  /  CASE 001',55,73);
  c.strokeStyle='#315969';c.lineWidth=2;c.beginPath();c.moveTo(55,115);c.lineTo(845,115);c.stroke();
  c.fillStyle='#bcd6df';c.font='24px Arial';c.fillText(frame.cap,55,170);
  c.fillStyle='#e9f8fa';c.font='bold 47px Arial';
  const words=frame.say.split(' ');let line='',y=247;
  for(const w of words){let test=line?line+' '+w:w;if(c.measureText(test).width>770){c.fillText(line,55,y);y+=66;line=w;}else line=test;}if(line)c.fillText(line,55,y);
  c.fillStyle='#64d7e1';c.fillRect(55,463,790*Math.min(1,seconds/27),7);
  c.fillStyle='#9fb9c3';c.font='24px Arial';c.fillText('An original fictional investigation',55,510);
  c.strokeStyle='#6cdfe8';c.strokeRect(555,530,290,51);c.fillStyle='#d8edf4';c.font='bold 26px Arial';c.fillText('PINCH HERE TO SKIP',566,566);
  introTex.needsUpdate=true;
}
function endIntro(){state.intro=false;if(introMesh)introMesh.visible=false;if(launcher)launcher.visible=true;}
function poseOf(frame,joint){try{return joint&&frame.getJointPose(joint,refSpace)||null;}catch{return null;}}
function handInfo(frame,source){
  if(!source.hand)return null;
  const h=source.hand;
  const tip=poseOf(frame,h.get('index-finger-tip'));
  const thumb=poseOf(frame,h.get('thumb-tip'));
  const near=poseOf(frame,h.get('index-finger-phalanx-proximal'))||poseOf(frame,h.get('index-finger-metacarpal'));
  const wrist=poseOf(frame,h.get('wrist'));
  if(!tip||!thumb)return null;
  const idx=new THREE.Vector3(tip.transform.position.x,tip.transform.position.y,tip.transform.position.z),
        th=new THREE.Vector3(thumb.transform.position.x,thumb.transform.position.y,thumb.transform.position.z);
  const proximal=near?new THREE.Vector3(near.transform.position.x,near.transform.position.y,near.transform.position.z):
    wrist?new THREE.Vector3(wrist.transform.position.x,wrist.transform.position.y,wrist.transform.position.z):idx.clone().sub(new THREE.Vector3(0,0,-.09));
  const forward=idx.clone().sub(proximal).normalize();
  return {src:source,index:idx,thumb:th,mid:idx.clone().add(th).multiplyScalar(.5),forward,pinch:idx.distanceTo(th)};
}
function castToPanel(hand,obj){
  if(!obj||!obj.visible)return null;
  obj.updateMatrixWorld(true);
  // Direct touch (finger within 11 cm of the actual panel), no gaze targeting.
  const local=obj.worldToLocal(hand.index.clone());
  const halfW=(obj.geometry.parameters.width||.94)/2,halfH=(obj.geometry.parameters.height||.663)/2;
  if(Math.abs(local.z)<.12&&Math.abs(local.x)<halfW&&Math.abs(local.y)<halfH)
    return {u:clamp(local.x/(halfW*2)+.5,0,1),v:clamp(local.y/(halfH*2)+.5,0,1),method:'touch'};
  // Pointing from the tracked finger. This is NOT a headset-gaze ray.
  obj.updateMatrixWorld(true);
  if(hand.forward.lengthSq()>.1){
    ray.set(hand.index,hand.forward);ray.far=1.85;
    const hits=ray.intersectObject(obj,false);
    if(hits.length)return {u:hits[0].uv.x,v:hits[0].uv.y,method:'point'};
  }
  return null;
}
function updateCursor(obj,uv){
  if(!handCursor||!obj||!uv)return;
  const w=obj.geometry.parameters.width,h=obj.geometry.parameters.height;
  const local=new THREE.Vector3((uv.u-.5)*w,(uv.v-.5)*h,.012);
  handCursor.position.copy(obj.localToWorld(local));handCursor.visible=true;
}
function clickPanel(uv){
  const x=uv.u*W,y=(1-uv.v)*H;
  const target=hitAction(x,y);
  if(target){activate(target.id,x);return true;}
  return false;
}
function intersectEvidence(hand){
  const pick=[];
  for(const o of [watch,phone]){
    if(!o||!o.visible)continue;
    const centre=new THREE.Vector3();o.getWorldPosition(centre);centre.y+=.055;
    const dist=hand.mid.distanceTo(centre);
    if(dist<.21)pick.push({object:o,dist});
    else if(hand.forward.lengthSq()>.1){
      ray.set(hand.index,hand.forward);ray.far=1.6;
      const hits=ray.intersectObjects(o.children,true);
      if(hits.length)pick.push({object:o,dist:hits[0].distance+.2});
    }
  }
  pick.sort((a,b)=>a.dist-b.dist);return pick[0]?.object??null;
}
function startGrab(hand,obj){
  if(activeGrab)return;
  activeGrab={source:hand.src,obj,original:obj.position.clone(),rot:obj.rotation.clone()};
  if(obj===watch)state.watchFound=true;else if(obj===phone)state.phoneFound=true;
  // Avoid moving the tabletop, surface or other evidence: only the held object moves.
  state.roomMessage=obj===watch?'Watch examined — open casefile to scrub telemetry':'Second phone examined — see the digital extraction';
}
function updateGrab(hand){
  if(!activeGrab||activeGrab.source!==hand.src)return;
  const g=activeGrab.obj;
  const ahead=hand.mid.clone().add(hand.forward.clone().multiplyScalar(.035));
  g.position.copy(g.parent.worldToLocal(ahead));g.rotation.set(0,0,0);
}
function releaseGrab(){
  if(!activeGrab)return;
  const g=activeGrab.obj;g.position.copy(activeGrab.original);g.rotation.copy(activeGrab.rot);
  activeGrab=null;
}
function updateHands(frame,time){
  if(handCursor)handCursor.visible=false;
  let tracked=0;
  for(const source of session.inputSources){
    if(!source.hand)continue;
    const hand=handInfo(frame,source);if(!hand)continue;tracked++;
    let memo=handMemory.get(source);if(!memo){memo={pinching:false,last:0};handMemory.set(source,memo);}
    const down=hand.pinch<.047,up=hand.pinch>.071;
    if(activeGrab?.source===source){
      if(memo.pinching&&!up)updateGrab(hand);
      if(up){releaseGrab();memo.pinching=false;}
      continue;
    }
    if(state.notebookOpen&&memo.pinching&&!up&&state.page===1){
      const uv=castToPanel(hand,notebookMesh);
      if(uv){const x=uv.u*W,y=(1-uv.v)*H;
        if(x>=72&&x<=1180&&y>=245&&y<=553)activate('timeline-scrub',x);}
    }
    if(up)memo.pinching=false;
    // Show a precise cyan cursor at the hand pointer even before pinching.
    if(!state.intro){
      const targetPanel=state.notebookOpen?notebookMesh:launcher;
      const hovered=castToPanel(hand,targetPanel);
      if(hovered)updateCursor(targetPanel,hovered);
    }
    if(!down||memo.pinching||time-memo.last<340)continue;
    memo.pinching=true;memo.last=time;
    if(state.intro){
      const uv=castToPanel(hand,introMesh);
      if(uv && uv.u>.59&&uv.v<.19){endIntro();}continue;
    }
    if(state.notebookOpen){
      const uv=castToPanel(hand,notebookMesh);if(uv)clickPanel(uv);continue;
    }
    const openHit=castToPanel(hand,launcher);
    if(openHit){setCasefile(true);continue;}
    const obj=intersectEvidence(hand);
    if(obj){startGrab(hand,obj);continue;}
  }
  if(tracked===0&&time-lastHud>900){state.roomMessage='Tracking hands — put controllers down and show both hands';lastHud=time;}
}

// ------------------------- SESSION + DESKTOP ---------------------
function updateViewer(frame){
  const pose=frame.getViewerPose(refSpace);if(!pose)return false;
  const v=pose.transform.position,q=pose.transform.orientation;
  viewerPosition.set(v.x,v.y,v.z);viewerQuat.set(q.x,q.y,q.z,q.w);
  if(launcher&&!state.notebookOpen&&!state.intro)faceViewer(launcher,new THREE.Vector3(0,-.25,-.67));
  if(introMesh&&state.intro)faceViewer(introMesh,new THREE.Vector3(0,0,-1.05));
  return true;
}
function onXRFrame(time,frame){
  if(!frame||!session)return;
  updateViewer(frame);
  if(time-lastPaint>500){updateRoom(frame);paintLauncher();lastPaint=time;}
  if(state.intro){const seconds=(performance.now()-state.introStart)/1000;drawIntro(seconds);if(seconds>=27)endIntro();}
  updateHands(frame,time);
  if(watch&&!activeGrab)watch.rotation.y=Math.sin(time*.0004)*.008;
  if(renderer)renderer.render(scene,camera);
}
async function enterQuest(){
  if(!navigator.xr){statusEl.textContent='Immersive WebXR unavailable. Open this page in your Quest 3S browser, or use PC Preview.';return;}
  try{
    // Request the XR session while the button click still has user activation.
    startBtn.disabled=true;statusEl.textContent='Opening the Quest passthrough session…';
    setupScene();
    renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
    renderer.setSize(window.innerWidth,window.innerHeight);
    renderer.setClearColor(0x000000,0);renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local-floor');
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);
    session=await navigator.xr.requestSession('immersive-ar',{
      requiredFeatures:['local-floor','hand-tracking'],
      optionalFeatures:['plane-detection','hit-test']
    });
    session.addEventListener('end',()=>{sceneRunning=false;mode='landing';state.vr=false;state.notebookOpen=false;
      landing.style.display='grid';if(renderer){renderer.setAnimationLoop(null);renderer.domElement.remove();renderer.dispose();}renderer=null;session=null;startBtn.disabled=false;statusEl.textContent='Session finished.';});
    await renderer.xr.setSession(session);
    refSpace=await session.requestReferenceSpace('local-floor');
    if(session.enabledFeatures?.has?.('hit-test')||session.requestHitTestSource){
      try{const vs=await session.requestReferenceSpace('viewer');hitSource=await session.requestHitTestSource({space:vs});}catch{hitSource=null;}
    }
    buildPanel();state.vr=true;landing.style.display='none';mode='xr';sceneRunning=true;startCinematic();
    renderer.setAnimationLoop(onXRFrame);
  }catch(e){
    const message=(e&&e.message)||String(e);
    statusEl.textContent='Quest session could not start: '+message+'. Check hand tracking and try again.';
    startBtn.disabled=false;
    if(session){try{await session.end();}catch{}}
    if(renderer){renderer.domElement.remove();renderer.dispose();renderer=null;}
    sceneRunning=false;mode='landing';
  }
}
function openDesktop(){
  if(renderer&&mode==='desktop'){return;}
  reset();state.vr=false;landing.style.display='none';desktop.style.display='block';mode='desktop';
  setupScene();makeDemoScene();
  renderer=new THREE.WebGLRenderer({alpha:false,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.8));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setClearColor(0x101e27,1);
  renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';
  $('desktopScene').prepend(renderer.domElement);
  function resize(){if(mode!=='desktop')return;const host=$('desktopScene');renderer.setSize(host.clientWidth,host.clientHeight,false);
    camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();}
  window.addEventListener('resize',resize);resize();sceneRunning=true;
  camera.position.set(1.2,1.55,1.75);camera.lookAt(0,.40,-1.15);
  renderer.setAnimationLoop(t=>{
    if(mode!=='desktop')return;
    camera.position.x=1.06+Math.sin(t*.00013)*.13;camera.lookAt(0,.44,-1.05);
    renderer.render(scene,camera);
  });
  state.watchFound=true;state.phoneFound=true;drawCase();
}
function backToLanding(){
  if(mode==='desktop'){
    mode='landing';sceneRunning=false;desktop.style.display='none';landing.style.display='grid';
    if(renderer){renderer.setAnimationLoop(null);renderer.dispose();renderer.domElement.remove();renderer=null;}
    reset();
  }
}
$('startBtn').addEventListener('click',enterQuest);
$('previewBtn').addEventListener('click',openDesktop);
$('backBtn').addEventListener('click',backToLanding);
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&mode==='desktop')backToLanding();
  else if(e.key==='ArrowRight'&&mode==='desktop'){state.page=clamp(state.page+1,0,5);drawCase();}
  else if(e.key==='ArrowLeft'&&mode==='desktop'){state.page=clamp(state.page-1,0,5);drawCase();}
});
