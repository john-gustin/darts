import * as THREE from '../lib/three.module.min.js';
import {hitAt,targetPoint,checkout,compute,CRICKET,ORDER,R,fmtMarks} from './engine.js';
import {Net} from './net.js';

const APP_VERSION=2;
const COL=['#4fa3ff','#ff8f3d','#43d17a','#d36bff'];
const CPU_SIGMA={easy:30,medium:17,pro:9};
const $=s=>document.querySelector(s);
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rid=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return Array.from(a,b=>'abcdefghijkmnpqrstuvwxyz23456789'[b%32]).join('');};
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const gauss=()=>Math.sqrt(-2*Math.log(Math.max(1e-9,Math.random())))*Math.cos(2*Math.PI*Math.random());
let PID=store.get('darts-pid');if(!PID){PID=rid(12);store.set('darts-pid',PID);}
let myName=store.get('darts-name')||'';
let toastT;function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),2600);}

/* ================= state ================= */
let gid=null,cfg=null,net=null;
let recs={},online={},chat=[];
let G=null;            // displayed game state
const shown={};        // pid -> darts already shown (animated) for current round
let flyQ=[];           // darts waiting to be animated
let flying=null;
const isOnline=pid=>pid===PID||(Date.now()-(online[pid]||0)<16000);
const roundKey=()=>String(cfg.round||1);
const pidAt=i=>cfg.order[i];
const nameOf=pid=>(recs[pid]&&recs[pid].name)||'Player';
const slotOf=pid=>(recs[pid]&&recs[pid].slot)||0;
const isHost=()=>cfg&&cfg.host===PID;
const isCpu=pid=>!!(recs[pid]&&recs[pid].cpu);
function dartsOf(pid,limit){const g=recs[pid]&&recs[pid].games&&recs[pid].games[roundKey()]||[];const n=limit==null?g.length:Math.min(limit,g.length);const out=[];for(let i=0;i<n;i++)out.push([g[i][0]/10,g[i][1]/10]);return out;}
function displayState(){const by={};for(const pid of cfg.order)by[pid]=dartsOf(pid,shown[pid]||0);return compute(cfg,by);}
function fullState(){const by={};for(const pid of cfg.order)by[pid]=dartsOf(pid);return compute(cfg,by);}

/* ================= sound ================= */
let soundOn=store.get('darts-sound')!=='0',actx=null;
function snd(type){
  if(!soundOn)return;
  try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const t=actx.currentTime;
    const noise=(len,freq,q,vol,decay)=>{const b=actx.createBuffer(1,actx.sampleRate*len,actx.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,decay);const s=actx.createBufferSource();s.buffer=b;const f=actx.createBiquadFilter();f.type='bandpass';f.frequency.value=freq;f.Q.value=q;const g=actx.createGain();g.gain.value=vol;s.connect(f).connect(g).connect(actx.destination);s.start(t);};
    if(type==='thud')noise(0.12,420,1.2,1.4,5);
    else if(type==='clank')noise(0.15,2600,6,0.8,6);
    else if(type==='whoosh')noise(0.25,1200,0.7,0.12,1.5);
    else if(type==='cheer'){for(let i=0;i<3;i++)noise(1.2,500+i*400,0.5,0.25,1.2);}
    else if(type==='chat'){const o=actx.createOscillator(),g=actx.createGain();o.frequency.value=880;g.gain.setValueAtTime(.08,t);g.gain.exponentialRampToValueAtTime(.0001,t+.2);o.connect(g).connect(actx.destination);o.start(t);o.stop(t+.25);}
  }catch(e){}
}
$('#soundBtn').textContent=soundOn?'🔊':'🔇';
$('#soundBtn').onclick=()=>{soundOn=!soundOn;store.set('darts-sound',soundOn?'1':'0');$('#soundBtn').textContent=soundOn?'🔊':'🔇';};

/* ================= 3D scene ================= */
const canvas=$('#view');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
renderer.setSize(window.innerWidth,window.innerHeight,false);
renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();scene.background=new THREE.Color('#120d09');
const camera=new THREE.PerspectiveCamera(17,window.innerWidth/window.innerHeight,0.05,20);
camera.position.set(0,-0.02,2.37);camera.lookAt(0,0,0);
window.addEventListener('resize',()=>{renderer.setSize(window.innerWidth,window.innerHeight,false);camera.aspect=window.innerWidth/window.innerHeight;fitCamera();});
function fitCamera(){const a=camera.aspect;camera.fov=a<1.2?24:17;camera.updateProjectionMatrix();}
fitCamera();
scene.add(new THREE.AmbientLight('#ffe6c8',0.55));
const spot=new THREE.SpotLight('#fff1d6',22,6,0.45,0.6,1.2);spot.position.set(0,0.9,1.3);spot.target.position.set(0,0,0);scene.add(spot,spot.target);
const fill=new THREE.DirectionalLight('#ffd9a8',0.6);fill.position.set(-1,0.5,2);scene.add(fill);

function boardTexture(){
  const S=2048,c=document.createElement('canvas');c.width=c.height=S;const x=c.getContext('2d');
  const k=S/2/225,cx=S/2,cy=S/2;
  x.fillStyle='#141414';x.beginPath();x.arc(cx,cy,S/2,0,Math.PI*2);x.fill();
  const sector=(r1,r2,i,col)=>{const a0=(i*18-9-90)*Math.PI/180,a1=(i*18+9-90)*Math.PI/180;x.beginPath();x.arc(cx,cy,r2*k,a0,a1);x.arc(cx,cy,r1*k,a1,a0,true);x.closePath();x.fillStyle=col;x.fill();};
  for(let i=0;i<20;i++){
    const dark=i%2===0;
    sector(R.bullOut,R.trebIn,i,dark?'#1b1b1b':'#efe0bd');
    sector(R.trebOut,R.dblIn,i,dark?'#1b1b1b':'#efe0bd');
    sector(R.trebIn,R.trebOut,i,dark?'#c8102e':'#0b8a3c');
    sector(R.dblIn,R.dblOut,i,dark?'#c8102e':'#0b8a3c');
  }
  x.fillStyle='#0b8a3c';x.beginPath();x.arc(cx,cy,R.bullOut*k,0,Math.PI*2);x.fill();
  x.fillStyle='#c8102e';x.beginPath();x.arc(cx,cy,R.bullIn*k,0,Math.PI*2);x.fill();
  // sisal texture
  const img=x.getImageData(0,0,S,S),d=img.data;
  for(let i=0;i<d.length;i+=4){const n=(Math.random()-.5)*16;d[i]=clamp(d[i]+n,0,255);d[i+1]=clamp(d[i+1]+n,0,255);d[i+2]=clamp(d[i+2]+n,0,255);}
  x.putImageData(img,0,0);
  // wires
  x.strokeStyle='#d8d8d8';x.lineWidth=3;
  for(const r of [R.bullIn,R.bullOut,R.trebIn,R.trebOut,R.dblIn,R.dblOut]){x.beginPath();x.arc(cx,cy,r*k,0,Math.PI*2);x.stroke();}
  for(let i=0;i<20;i++){const a=(i*18+9-90)*Math.PI/180;x.beginPath();x.moveTo(cx+Math.cos(a)*R.bullOut*k,cy+Math.sin(a)*R.bullOut*k);x.lineTo(cx+Math.cos(a)*R.dblOut*k,cy+Math.sin(a)*R.dblOut*k);x.stroke();}
  // numbers
  x.fillStyle='#f5f5f5';x.font=`bold ${Math.round(26*k)}px Arial`;x.textAlign='center';x.textBaseline='middle';
  for(let i=0;i<20;i++){const a=(i*18-90)*Math.PI/180;const r=197*k;x.save();x.translate(cx+Math.cos(a)*r,cy+Math.sin(a)*r);x.rotate(a+Math.PI/2);if(i>5&&i<15)x.rotate(Math.PI);x.fillText(String(ORDER[i]),0,0);x.restore();}
  // number ring wire
  x.lineWidth=4;x.beginPath();x.arc(cx,cy,180*k,0,Math.PI*2);x.stroke();
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
}
function woodTexture(){
  const c=document.createElement('canvas');c.width=1024;c.height=1024;const x=c.getContext('2d');
  for(let i=0;i<8;i++){const base=[60+Math.random()*20,36+Math.random()*12,20+Math.random()*8];x.fillStyle=`rgb(${base[0]},${base[1]},${base[2]})`;x.fillRect(i*128,0,128,1024);
    for(let g=0;g<40;g++){x.strokeStyle=`rgba(0,0,0,${0.08+Math.random()*0.12})`;x.lineWidth=1+Math.random()*2;x.beginPath();const sx=i*128+Math.random()*128;x.moveTo(sx,0);x.bezierCurveTo(sx+Math.random()*20-10,300,sx+Math.random()*20-10,700,sx+Math.random()*16-8,1024);x.stroke();}
    x.fillStyle='rgba(0,0,0,.55)';x.fillRect(i*128,0,3,1024);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3,2);return t;
}
{
  const wall=new THREE.Mesh(new THREE.PlaneGeometry(8,5),new THREE.MeshStandardMaterial({map:woodTexture(),roughness:0.85}));wall.position.z=-0.06;scene.add(wall);
  const cab=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.34,0.03,64),new THREE.MeshStandardMaterial({color:'#0d0d0d',roughness:0.95}));cab.rotation.x=Math.PI/2;cab.position.z=-0.045;scene.add(cab);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(0.34,0.012,8,80),new THREE.MeshStandardMaterial({color:'#2a1a0e',roughness:0.6}));rim.position.z=-0.03;scene.add(rim);
  const side=new THREE.Mesh(new THREE.CylinderGeometry(0.226,0.226,0.038,96),new THREE.MeshStandardMaterial({color:'#101010',roughness:0.9}));side.rotation.x=Math.PI/2;side.position.z=-0.0215;scene.add(side);
  const face=new THREE.Mesh(new THREE.CircleGeometry(0.226,128),new THREE.MeshStandardMaterial({map:boardTexture(),roughness:0.92}));scene.add(face);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.2265,0.004,8,96),new THREE.MeshStandardMaterial({color:'#bfbfbf',metalness:0.8,roughness:0.3}));scene.add(ring);
}
function dartMesh(color){
  const g=new THREE.Group();
  const steel=new THREE.MeshStandardMaterial({color:'#d9d9d9',metalness:0.9,roughness:0.25});
  const tung=new THREE.MeshStandardMaterial({color:'#5d6168',metalness:0.85,roughness:0.35});
  const col=new THREE.MeshStandardMaterial({color,roughness:0.5,side:THREE.DoubleSide});
  const cyl=(r1,r2,len,mat,z)=>{const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,len,10),mat);m.rotation.x=Math.PI/2;m.position.z=z+len/2;g.add(m);};
  cyl(0.0012,0.0003,0.028,steel,0);
  cyl(0.0034,0.0036,0.045,tung,0.028);
  for(let i=0;i<5;i++){const rr=new THREE.Mesh(new THREE.TorusGeometry(0.0036,0.0006,4,12),new THREE.MeshStandardMaterial({color:'#2a2c30'}));rr.position.z=0.034+i*0.008;g.add(rr);}
  cyl(0.0018,0.0018,0.035,new THREE.MeshStandardMaterial({color:'#222',roughness:0.4}),0.073);
  const sh=new THREE.Shape();sh.moveTo(0,0);sh.lineTo(0.016,0.012);sh.lineTo(0.016,0.034);sh.lineTo(0,0.03);sh.closePath();
  for(let i=0;i<4;i++){const f=new THREE.Mesh(new THREE.ShapeGeometry(sh),col);f.rotation.z=i*Math.PI/2;f.rotation.order='ZXY';const h=new THREE.Group();f.rotation.set(Math.PI/2,0,0);f.position.set(0,0,0.104);h.add(f);h.rotation.z=i*Math.PI/2;g.add(h);}
  return g;
}
let boardDarts=[];
function setBoardDarts(hits,turnPid){
  for(const d of boardDarts){scene.remove(d);}boardDarts=[];
  if(!hits)return;
  hits.forEach((h,i)=>{
    if(h.x==null)return;const r=Math.hypot(h.x,h.y);
    const m=dartMesh(COL[slotOf(h.p!=null?cfg.order[h.p]:turnPid)]);
    if(r>R.board+60){return;}
    const seed=Math.sin(h.x*12.9+h.y*78.2)*43758.5;const rnd=seed-Math.floor(seed);
    m.position.set(h.x/1000,h.y/1000,r>R.board?-0.018:0.004);
    m.rotation.set(-(0.1+rnd*0.14),(rnd-0.5)*0.16,0);
    scene.add(m);boardDarts.push(m);
  });
}

/* ================= aiming & throwing ================= */
let mode=store.get('darts-throw')==='meter'?'meter':'flick';
$('#modeBtn').textContent='Throw: '+(mode==='flick'?'Flick':'Meter');
$('#modeBtn').onclick=()=>{mode=mode==='flick'?'meter':'flick';store.set('darts-throw',mode);$('#modeBtn').textContent='Throw: '+(mode==='flick'?'Flick':'Meter');thr={s:'idle'};$('#meterBox').hidden=true;toast(mode==='flick'?'Flick: press, then flick the mouse up and let go':'Meter: click to lock aim, click again in the middle');};
let mouseNdc=new THREE.Vector2(0,0),mouseIn=false,aimMM=[0,60];
let thr={s:'idle'};
const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,0,1),0),tmpV=new THREE.Vector3();
const phase=[Math.random()*10,Math.random()*10,Math.random()*10,Math.random()*10];
function wobble(t,amp){
  return [amp*(Math.sin(t*1.1+phase[0])*0.55+Math.sin(t*2.3+phase[1])*0.3+Math.sin(t*6.1+phase[2])*0.15),
          amp*(Math.sin(t*0.9+phase[3])*0.55+Math.sin(t*2.7+phase[0])*0.3+Math.sin(t*5.3+phase[1])*0.15)];
}
function mouseToMM(){ray.setFromCamera(mouseNdc,camera);if(!ray.ray.intersectPlane(plane,tmpV))return aimMM;return [tmpV.x*1000,tmpV.y*1000];}
function canThrow(){return G&&cfg.started&&G.winner==null&&pidAt(G.turn)===PID&&!flying&&!flyQ.length&&!visitPause;}
canvas.addEventListener('pointermove',e=>{
  mouseNdc.set(e.clientX/window.innerWidth*2-1,-(e.clientY/window.innerHeight)*2+1);mouseIn=true;
  if(thr.s==='grip'){thr.samples.push([performance.now(),e.clientX,e.clientY]);if(thr.samples.length>40)thr.samples.shift();}
});
canvas.addEventListener('pointerleave',()=>{mouseIn=false;});
canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0||!canThrow())return;
  canvas.setPointerCapture(e.pointerId);
  if(mode==='flick'){thr={s:'grip',aim:mouseToMM(),samples:[[performance.now(),e.clientX,e.clientY]]};}
  else{
    if(thr.s==='idle'){thr={s:'meter',aim:mouseToMM(),t0:performance.now()};$('#meterBox').hidden=false;}
    else if(thr.s==='meter'){const m=meterPos();const err=Math.abs(m)*40;const a=Math.random()*Math.PI*2;const w=wobble(performance.now()/1000,2.5);
      const p=[thr.aim[0]+w[0]+Math.cos(a)*err+gauss()*2.5,thr.aim[1]+w[1]+Math.sin(a)*err+gauss()*2.5];
      flash(Math.abs(m)<0.12?'Perfect release!':Math.abs(m)<0.4?'Good':'Snatched it…');
      thr={s:'idle'};$('#meterBox').hidden=true;throwDart(p);}
  }
});
canvas.addEventListener('pointerup',e=>{
  if(thr.s!=='grip')return;
  const now=performance.now(),S=thr.samples;S.push([now,e.clientX,e.clientY]);
  // the flick = from the lowest point of the backswing up to the release
  let lo=0;for(let i=1;i<S.length;i++)if(S[i][2]>=S[lo][2])lo=i;
  let f=lo+1;while(f<S.length-1&&S[f][2]>=S[lo][2]-2)f++;
  const a=S[lo],b=S[S.length-1];
  const span=f<S.length?(b[0]-S[f][0]):0,cnt=Math.max(1,S.length-1-f);
  const dt=Math.max(0.03,(span+(cnt>0?span/cnt:16)||16)/1000);
  const vy=(a[2]-b[2])/dt/window.innerHeight,vx=(b[1]-a[1])/dt/window.innerHeight;
  const aim=thr.aim;thr={s:'idle'};
  if(vy<0.35){flash('Flick the mouse UP and let go to throw');return;}
  const w=wobble(now/1000,7);
  const ideal=1.6,ey=clamp((vy-ideal)*32,-140,140),ex=clamp(vx/vy*75,-140,140);
  const p=[aim[0]+w[0]+ex+gauss()*2,aim[1]+w[1]+ey+gauss()*2];
  flash(Math.abs(vy-ideal)<0.25&&Math.abs(vx/vy)<0.12?'Perfect flick!':vy<ideal-0.25?'Soft flick – dart dropped':vy>ideal+0.25?'Too hard – dart rose':'Flick drifted sideways');
  throwDart(p);
});
const meterPos=()=>Math.sin((performance.now()-thr.t0)/1000*Math.PI*2/1.15);
function drawMeter(){
  const c=$('#meter'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);
  const g=x.createLinearGradient(0,0,c.width,0);g.addColorStop(0,'#ff6b5e');g.addColorStop(0.4,'#f0bf4c');g.addColorStop(0.5,'#3ccf7a');g.addColorStop(0.6,'#f0bf4c');g.addColorStop(1,'#ff6b5e');
  x.fillStyle=g;x.fillRect(0,4,c.width,c.height-8);
  x.fillStyle='#fff';x.fillRect(c.width/2-1,0,2,c.height);
  const m=meterPos();x.fillStyle='#111';x.fillRect(c.width/2+m*c.width/2-3,0,6,c.height);
}
let flashT;function flash(t){const el=$('#flickMsg');el.textContent=t;el.classList.add('show');clearTimeout(flashT);flashT=setTimeout(()=>el.classList.remove('show'),1400);}

function throwDart(p){
  const r=recs[PID];if(!r||!canThrow())return;
  const k=roundKey();r.games=r.games||{};r.games[k]=r.games[k]||[];
  r.games[k].push([Math.round(p[0]*10),Math.round(p[1]*10)]);
  publishRec(r);
  pumpQueue();
}

/* ================= flight animation & visit flow ================= */
let visitPause=false;
function pumpQueue(){
  if(!cfg||!cfg.started)return;
  // enqueue any darts not yet shown, in game order: only the player whose turn it is (in the displayed state) can have the next dart
  if(flying||visitPause)return;
  const st=displayState();G=st;
  if(st.winner!=null){render();return;}
  const pid=pidAt(st.turn);const have=dartsOf(pid).length;const sh=shown[pid]||0;
  if(have>sh){
    const d=dartsOf(pid)[sh];
    startFlight(pid,d);
  } else render();
}
function startFlight(pid,d){
  const before=G;
  const m=dartMesh(COL[slotOf(pid)]);scene.add(m);
  flying={pid,d,m,t:0,from:new THREE.Vector3(0.05+(Math.random()-.5)*0.04,-0.32,1.85),to:new THREE.Vector3(d[0]/1000,d[1]/1000,0.004),before};
  snd('whoosh');
}
function stepFlight(dt){
  if(!flying)return;
  const f=flying;f.t+=dt/0.36;const u=Math.min(1,f.t);
  const p=new THREE.Vector3().lerpVectors(f.from,f.to,u);p.y+=Math.sin(Math.PI*u)*0.09;
  const u2=Math.min(1,u+0.02);const q=new THREE.Vector3().lerpVectors(f.from,f.to,u2);q.y+=Math.sin(Math.PI*u2)*0.09;
  f.m.position.copy(p);const back=p.clone().sub(q).add(p);f.m.lookAt(back);
  if(u>=1){
    scene.remove(f.m);flying=null;
    shown[f.pid]=(shown[f.pid]||0)+1;
    const h=hitAt(f.d[0],f.d[1]);
    snd(Math.hypot(f.d[0],f.d[1])>R.dblOut?'clank':'thud');
    const prev=f.before;G=displayState();
    afterDart(f.pid,prev,G,h);
  }
}
function afterDart(pid,prev,st,h){
  render();
  const p=cfg.order.indexOf(pid);
  const ended=st.winner!=null||st.leg!==prev.leg||st.turn!==prev.turn;
  if(!ended){pumpQueue();return;}
  const lv=st.lastVisit[p];
  visitPause=true;
  let big='',small='';
  if(st.winner!=null){big=`${nameOf(pid)} wins!`;small=cfg.mode==='cricket'?'Game, set and match':'Game shot, and the match';snd('cheer');}
  else if(st.leg!==prev.leg){big='Game shot!';small=`Leg to ${nameOf(pid)}`;snd('cheer');}
  else if(cfg.mode!=='cricket'){
    if(lv.bust){big='BUST';small=`${nameOf(pid)} stays on ${prev.scores?prev.visitStart:''}`;}
    else if(lv.total===180){big='ONE HUNDRED AND EIGHTY!';snd('cheer');}
    else {big=String(lv.total);small=nameOf(pid);}
  } else {big=lv.total?`${lv.total} mark${lv.total>1?'s':''}`:'No score';small=nameOf(pid);}
  banner(big,small);
  sysChat(`${nameOf(pid)}: ${lv.hits.map(x=>x.label).join(', ')}${cfg.mode!=='cricket'?` = ${lv.bust?'bust':lv.total}`:''}`);
  setTimeout(()=>{visitPause=false;render();pumpQueue();if(st.winner!=null)setTimeout(showMatchEnd,900);},st.winner!=null?2200:1500);
}
function banner(t,s){const b=$('#banner');b.innerHTML=esc(t)+(s?`<small>${esc(s)}</small>`:'');b.style.fontSize=t.length>14?'42px':'64px';b.classList.add('show');clearTimeout(banner.t);banner.t=setTimeout(()=>b.classList.remove('show'),1400);}

/* ================= CPU ================= */
let cpuTimer=null;
function cpuRunner(){const humans=cfg.order.filter(p=>!isCpu(p)&&isOnline(p)).sort();return humans[0];}
function cpuTick(){
  if(!G||!cfg.started||G.winner!=null||flying||flyQ.length||visitPause||cpuTimer)return;
  const pid=pidAt(G.turn);if(!isCpu(pid)||cpuRunner()!==PID)return;
  if(dartsOf(pid).length>(shown[pid]||0))return; // still animating its darts
  cpuTimer=setTimeout(()=>{cpuTimer=null;
    if(!G||pidAt(G.turn)!==pid||flying||visitPause)return;
    const r=recs[pid];const label=cpuTarget(G,G.turn);const [tx,ty]=targetPoint(label);const s=CPU_SIGMA[r.cpu.level]||17;
    const k=roundKey();r.games=r.games||{};r.games[k]=r.games[k]||[];r.games[k].push([Math.round((tx+gauss()*s)*10),Math.round((ty+gauss()*s)*10)]);
    publishRec(r);pumpQueue();
  },850+Math.random()*500);
}
function cpuTarget(st,p){
  if(cfg.mode!=='cricket'){
    const s=st.scores[p],left=3-st.visit.length;
    if(!st.isIn[p])return 'D20';
    const co=checkout(s,left,cfg.dout);if(co)return co[0];
    if(s>60)return s>=170?'T20':(s-60>1?'T20':'T19');
    if(!cfg.dout)return s>=20?'20':String(s);
    const want=[32,40,16,24,8];for(const w of want){const v=s-w;if(v>=1&&v<=20)return String(v);}
    return s>20?'20':String(Math.max(1,s-2));
  }
  const me=st.marks[p],others=st.marks.filter((_,i)=>i!==p);
  const open=t=>others.some(o=>o[t]<3);
  const lab=t=>t===25?'BULL':'T'+t;
  const behind=st.points.some((q,i)=>i!==p&&q>st.points[p]);
  if(behind){const t=CRICKET.find(t=>me[t]>=3&&open(t));if(t)return lab(t);}
  const t=CRICKET.find(t=>me[t]<3&&(open(t)||others.length===0));if(t)return lab(t);
  const t2=CRICKET.find(t=>open(t));return t2?lab(t2):'T20';
}

/* ================= HUD ================= */
function render(){
  if(!cfg||!G)return;
  const st=G;
  $('#gTitle').textContent=cfg.mode==='cricket'?'Cricket':`${cfg.mode}${cfg.dout?' · Double out':''}${cfg.din?' · Double in':''}`;
  $('#gSub').textContent=(cfg.legs>1?`Best of ${cfg.legs} legs · Leg ${st.leg+1}`:'Single leg')+(cfg.round>1?` · Game ${cfg.round}`:'');
  // scoreboard
  const sc=$('#score');
  const legsDots=i=>cfg.legs>1?`<span class="legs">${Array.from({length:Math.ceil(cfg.legs/2)},(_,k)=>`<i class="${k<st.legsWon[i]?'w':''}"></i>`).join('')}</span>`:'';
  if(cfg.mode!=='cricket'){
    sc.innerHTML=cfg.order.map((pid,i)=>{const s=st.stats[i];const avg=s.darts?(s.pts/s.darts*3).toFixed(1):'–';const lv=st.lastVisit[i];
      const co=st.scores&&st.winner==null&&st.isIn[i]?checkout(st.scores[i],3,cfg.dout):null;
      return `<div class="pl ${st.turn===i&&st.winner==null?'up':''}"><span class="dot" style="background:${COL[slotOf(pid)]}"></span><span class="nm">${esc(nameOf(pid))}${pid===PID?' <span style="color:var(--muted);font-weight:400">(you)</span>':''}${legsDots(i)}</span><span class="big">${st.scores?st.scores[i]:''}</span>
      <div class="sub"><span>avg ${avg}${lv?` · last ${lv.bust?'bust':lv.total}`:''}${cfg.din&&st.isIn&&!st.isIn[i]?' · needs a double':''}</span><span>${isCpu(pid)?'🤖':isOnline(pid)?'● online':'○ away'}</span></div>${co&&st.turn!==i?`<div class="sub"><span style="color:var(--gold)">out: ${co.join(' ')}</span></div>`:''}</div>`;}).join('');
  } else {
    const dead=t=>st.marks&&st.marks.every(m=>m[t]>=3);
    let h=`<table class="cr"><tr><th></th>${cfg.order.map((pid,i)=>`<th class="${st.turn===i&&st.winner==null?'up':''}"><span style="color:${COL[slotOf(pid)]}">●</span> ${esc(nameOf(pid).slice(0,9))}${legsDots(i)}</th>`).join('')}</tr>`;
    for(const t of CRICKET)h+=`<tr><td class="tg ${dead(t)?'dead':''}">${t===25?'B':t}</td>${cfg.order.map((_,i)=>`<td class="mk">${st.marks?fmtMarks(st.marks[i][t]):''}</td>`).join('')}</tr>`;
    h+=`<tr><td class="tg">Pts</td>${cfg.order.map((_,i)=>`<td><b>${st.points?st.points[i]:0}</b></td>`).join('')}</tr>`;
    h+=`<tr><td class="tg" style="font-size:11px">MPR</td>${cfg.order.map((_,i)=>{const s=st.stats[i];return `<td style="font-size:12px;color:var(--muted)">${s.visits?(s.marks/s.visits).toFixed(2):'–'}</td>`;}).join('')}</tr></table>`;
    h+=`<div style="font-size:11px;color:var(--muted);margin-top:6px">${cfg.order.map(pid=>`${esc(nameOf(pid))}: ${isCpu(pid)?'🤖':isOnline(pid)?'● online':'○ away'}`).join(' · ')}</div>`;
    sc.innerHTML=h;
  }
  // visit slots
  const cur=pidAt(st.turn);
  const vh=st.visit.length?st.visit:[];
  for(let i=0;i<3;i++){const el=$('#s'+i),h=vh[i];el.classList.toggle('miss',!!h&&h.v===0);el.querySelector('b').textContent=h?h.label:'–';el.querySelector('span').textContent=h?(cfg.mode==='cricket'?(CRICKET.includes(h.n)?`${h.m} mark${h.m>1?'s':''}`:'no mark'):h.v+' pts'):`Dart ${i+1}`;}
  let a='',b='';
  if(st.winner!=null){a=`🏆 ${nameOf(pidAt(st.winner))} wins!`;b='';}
  else{
    a=cur===PID?`Your throw – dart ${st.visit.length+1} of 3`:`${nameOf(cur)} to throw`;
    if(cfg.mode!=='cricket'&&st.scores){
      const left=st.scores[st.turn]-0;
      const co=st.isIn[st.turn]?checkout(left,3-st.visit.length,cfg.dout):null;
      b=`Needs ${left}`+(co?` · <span id="co">${co.join(' · ')}</span>`:'');
      if(cfg.din&&!st.isIn[st.turn])b='Needs a double to start scoring';
    } else if(st.marks){const tot=st.visit.reduce((a2,h)=>a2+(CRICKET.includes(h.n)?h.m:0),0);b=`${tot} mark${tot===1?'':'s'} this turn`;}
  }
  $('#vA').innerHTML=esc(a);$('#vB').innerHTML=b;
  // wait bar
  const wb=$('#waitBar');
  if(st.winner==null&&cur!==PID&&!isCpu(cur)){wb.hidden=false;wb.innerHTML=isOnline(cur)?`Waiting for <b>${esc(nameOf(cur))}</b> to throw…`:`<b>${esc(nameOf(cur))}</b> is away – they can throw from the link whenever they're back`;}
  else if(st.winner==null&&isCpu(cur)){wb.hidden=false;wb.innerHTML=`🤖 ${esc(nameOf(cur))} is throwing…`+(cpuRunner()?'':' (waiting for a player to be online)');}
  else wb.hidden=true;
  // board darts
  setBoardDarts(st.onBoard.map(h=>({...h})),pidAt(st.turn));
  $('#cross').style.display='none';
  cpuTick();
}

/* ================= loop ================= */
let last=performance.now();
function frame(now){
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  stepFlight(dt);
  // crosshair
  const cross=$('#cross');
  if(canThrow()&&(mouseIn||thr.s!=='idle')){
    let p=thr.s==='idle'?mouseToMM():thr.aim;
    const w=wobble(now/1000,mode==='flick'?7:2.5);p=[p[0]+w[0],p[1]+w[1]];aimMM=p;
    tmpV.set(p[0]/1000,p[1]/1000,0.005).project(camera);
    cross.style.display='block';cross.style.left=((tmpV.x+1)/2*window.innerWidth)+'px';cross.style.top=((1-tmpV.y)/2*window.innerHeight)+'px';
    canvas.style.cursor='crosshair';
  } else {cross.style.display='none';canvas.style.cursor='default';}
  if(thr.s==='meter')drawMeter();
  renderer.render(scene,camera);
  requestAnimationFrame(frame);
}

/* ================= networking ================= */
const cacheKey=()=>'darts-g-'+gid;
let saveT;function saveCache(){clearTimeout(saveT);saveT=setTimeout(()=>store.set(cacheKey(),JSON.stringify({cfg,recs,chat:chat.slice(-80)})),300);}
function publishRec(r){r.ver=(r.ver||0)+1;r.ts=Date.now();net&&net.publish('p/'+r.pid,JSON.parse(JSON.stringify(r)),true);saveCache();}
function publishCfg(){cfg.ver=(cfg.ver||0)+1;net&&net.publish('cfg',JSON.parse(JSON.stringify(cfg)),true);saveCache();}
function onMessage(sub,d){
  delete d.m;
  if(sub==='cfg'){if(!cfg||(d.ver||0)>(cfg.ver||0)){const oldRound=cfg&&cfg.round,wasStarted=cfg&&cfg.started;cfg=d;saveCache();onCfg(oldRound,wasStarted);}return;}
  if(sub.startsWith('p/')){
    const pid=sub.slice(2);if(d.pid!==pid)return;
    const cur=recs[pid];if(cur&&(cur.ver||0)>=(d.ver||0))return;
    recs[pid]=d;saveCache();
    if(cfg&&isHost()&&!cfg.started&&!cfg.order.includes(pid)&&!d.cpu&&cfg.order.length<4){cfg.order.push(pid);publishCfg();onCfg();}
    if(cfg&&cfg.started)pumpQueue();else renderRoom();
    return;
  }
  if(sub==='hb'){if(d.pid&&d.pid!==PID){const was=isOnline(d.pid);online[d.pid]=Date.now();if(!was){render();renderRoom();}}return;}
  if(sub==='chat'&&d.text){online[d.pid]=Date.now();chat.push({pid:d.pid,name:String(d.name||'').slice(0,16),slot:d.slot||0,text:String(d.text).slice(0,300),ts:Date.now()});saveCache();renderChat();
    if(d.pid!==PID){snd('chat');if($('#chat').classList.contains('closed')){unread++;$('#unread').textContent=unread;$('#unread').style.display='inline';}}}
}
function netStatus(){if(!net)return;const n=net.live(),t=net.total();$('#netBadge').textContent=n?`● connected · ${n}/${t} servers`:'○ connecting to game servers…';$('#netBadge').style.color=n?'var(--green)':'var(--red)';}
setInterval(()=>{if(net&&gid){net.publish('hb',{pid:PID,name:myName});if(isHost()&&cfg)net.publish('cfg',JSON.parse(JSON.stringify(cfg)),true);}if(G)render();},5000);

/* ================= rooms / flow ================= */
function onCfg(oldRound,wasStarted){
  if(!cfg)return;
  if(oldRound&&cfg.round!==oldRound){for(const k in shown)delete shown[k];visitPause=false;hideModal();}
  if(cfg.started){$('#room').hidden=true;$('#hud').hidden=false;
    if(!wasStarted&&!G){for(const pid of cfg.order){shown[pid]=0;}}
    pumpQueue();}
  else renderRoom();
}
function renderRoom(){
  if(!cfg||cfg.started)return;
  $('#room').hidden=false;$('#hud').hidden=true;
  const modeTxt=cfg.mode==='cricket'?'Cricket':`${cfg.mode}${cfg.dout?', double out':''}${cfg.din?', double in':''}`;
  $('#wrTitle').textContent='🎯 '+(cfg.mode==='cricket'?'Cricket':cfg.mode);
  $('#wrSub').textContent=`${modeTxt} · ${cfg.legs>1?'best of '+cfg.legs+' legs':'single leg'}. Up to 4 players.`;
  $('#wrPlayers').innerHTML=cfg.order.map((pid,i)=>`<div><span style="width:12px;height:12px;border-radius:50%;background:${COL[slotOf(pid)]};display:inline-block"></span><b>${esc(nameOf(pid))}</b>${pid===cfg.host?' <span style="color:var(--muted)">(host)</span>':''}${pid===PID?' <span style="color:var(--muted)">(you)</span>':''}<span style="margin-left:auto;color:var(--muted);font-size:12px">${isCpu(pid)?'🤖 computer':isOnline(pid)?'● here':'○ away'}</span></div>`).join('');
  $('#wrStart').hidden=!isHost();
  $('#wrNote').textContent=isHost()?'Send the invite link, then press Start when everyone is in. Friends can also join later and throw on their turn. Once started, nobody new can join.':`Waiting for ${nameOf(cfg.host)} to start the game…`;
}
$('#wrStart').onclick=()=>{if(!isHost())return;cfg.started=true;publishCfg();onCfg(null,false);};
$('#wrInvite').onclick=async()=>{await copyText(inviteMsg());$('#wrCopied').textContent='Copied! Paste it into Google Chat.';};
const inviteLink=()=>location.href.split('?')[0].split('#')[0]+'#d='+gid+(location.search.includes('mq=')?'':'');
function inviteMsg(){const base=location.href.split('#')[0];return `🎯 Darts? ${cfg.mode==='cricket'?'Cricket':cfg.mode} – join my game (live, or throw whenever you're free, no sign-in): ${base}#d=${gid}`;}
async function copyText(t){try{await navigator.clipboard.writeText(t);return true;}catch(e){const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy');}catch(_){}ta.remove();return ok;}}
$('#inviteBtn').onclick=()=>{const base=location.href.split('#')[0];const link=`${base}#d=${gid}`;
  showModal(`<h2>Invite link</h2><p>${cfg.started?'This game has started, so new people can watch but not join. Players already in the game can use this link to come back and throw.':'Paste this into Google Chat. Up to 4 players.'}</p><input type="text" readonly id="lb" value="${esc(link)}"><div class="row2"><button class="primary" id="cm">Copy message + link</button><span class="copied"></span><span style="flex:1"></span><button id="closeM">Close</button></div>`);
  $('#cm').onclick=async e=>{const ok=await copyText(inviteMsg());e.target.parentElement.querySelector('.copied').textContent=ok?'Copied!':'Select the link and copy it';};$('#closeM').onclick=hideModal;$('#lb').onclick=e=>e.target.select();};
function showModal(h){$('#mbox').innerHTML=h;$('#modal').hidden=false;}
function hideModal(){$('#modal').hidden=true;}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')hideModal();});
function statsTable(){
  const st=G;if(!st)return '';
  if(cfg.mode!=='cricket')return `<table class="st"><tr><th>Player</th><th>Legs</th><th>3-dart avg</th><th>Best visit</th><th>100+</th><th>180s</th><th>Darts</th></tr>${cfg.order.map((pid,i)=>{const s=st.stats[i];return `<tr><td><span style="color:${COL[slotOf(pid)]}">●</span> ${esc(nameOf(pid))}</td><td>${st.legsWon[i]}</td><td>${s.darts?(s.pts/s.darts*3).toFixed(1):'–'}</td><td>${s.best}</td><td>${s.tons}</td><td>${s.c180}</td><td>${s.darts}</td></tr>`;}).join('')}</table>`;
  return `<table class="st"><tr><th>Player</th><th>Legs</th><th>Marks/round</th><th>Points</th><th>Darts</th></tr>${cfg.order.map((pid,i)=>{const s=st.stats[i];return `<tr><td><span style="color:${COL[slotOf(pid)]}">●</span> ${esc(nameOf(pid))}</td><td>${st.legsWon[i]}</td><td>${s.visits?(s.marks/s.visits).toFixed(2):'–'}</td><td>${st.points?st.points[i]:0}</td><td>${s.darts}</td></tr>`;}).join('')}</table>`;
}
$('#statsBtn').onclick=()=>{showModal(`<h2>Match stats</h2>${statsTable()}<div class="row2" style="justify-content:flex-end"><button class="primary" id="closeM">Close</button></div>`);$('#closeM').onclick=hideModal;};
function showMatchEnd(){
  if(!G||G.winner==null)return;
  showModal(`<h2>🏆 ${esc(nameOf(pidAt(G.winner)))} wins!</h2>${statsTable()}<div class="row2" style="justify-content:flex-end">${isHost()?'<button class="primary" id="rematch">Rematch (same players)</button>':`<span style="color:var(--muted);font-size:13px">${esc(nameOf(cfg.host))} can start a rematch.</span>`}<button id="newG">New game</button><button id="closeM">Close</button></div>`);
  const rm=$('#rematch');if(rm)rm.onclick=()=>{cfg.round=(cfg.round||1)+1;const w=cfg.order.indexOf(pidAt(G.winner));cfg.order=[...cfg.order.slice(w+1),...cfg.order.slice(0,w+1)];publishCfg();onCfg(cfg.round-1,true);};
  $('#newG').onclick=()=>{location.href=location.href.split('#')[0];};$('#closeM').onclick=hideModal;
}
$('#helpBtn').onclick=()=>{showModal(`<h2>How to play</h2><ul>
<li><b>Flick throw:</b> point at your target (the crosshair sways like a real hand). Press the mouse button, flick the mouse <i>upward</i> and let go in one quick motion. A firm, straight flick hits where the crosshair was. Too soft drops low, too hard flies high, and a sideways flick pulls the dart left or right.</li>
<li><b>Meter throw:</b> click to lock your aim, then click again when the marker is in the green middle.</li>
<li><b>501 / 301:</b> count down to exactly zero. With <i>double out</i> your last dart must be a double (the bullseye counts). Going below zero, or leaving 1, is a <b>bust</b>: your score goes back to where it was at the start of the turn. <i>Double in</i> means nothing counts until you hit a double. The gold text shows a suggested checkout.</li>
<li><b>Cricket:</b> close 15–20 and the bull by hitting each 3 times (doubles count 2, trebles 3, the outer bull 1, the bullseye 2). Extra hits on a number you've closed score points while an opponent still has it open. Close everything with the most points to win.</li>
<li>Each turn is 3 darts. If a friend is away, the game waits for their turn and they can throw from the same link later.</li>
</ul><div class="row2" style="justify-content:flex-end"><button class="primary" id="closeM">Got it</button></div>`);$('#closeM').onclick=hideModal;};

/* ================= chat ================= */
let unread=0;
function openChat(open){$('#chat').classList.toggle('closed',!open);$('#chatToggle').textContent=open?'▾':'▴';if(open){unread=0;$('#unread').style.display='none';const l=$('#chatLog');l.scrollTop=l.scrollHeight;}}
$('#chatHead').onclick=()=>openChat($('#chat').classList.contains('closed'));
function sysChat(text){chat.push({sys:1,text,ts:Date.now()});renderChat();}
function renderChat(){const l=$('#chatLog');const atB=l.scrollHeight-l.scrollTop-l.clientHeight<30;l.innerHTML=chat.slice(-80).map(m=>m.sys?`<div class="sys">${esc(m.text)}</div>`:`<div><b style="color:${COL[m.slot||0]}">${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');if(atB)l.scrollTop=l.scrollHeight;}
$('#chatForm').onsubmit=e=>{e.preventDefault();const v=$('#chatIn').value.trim();if(!v)return;const r=recs[PID];if(!net||!net.publish('chat',{pid:PID,name:myName,slot:r?r.slot:0,text:v}))toast('Not connected right now');$('#chatIn').value='';$('#chatIn').blur();};
window.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'){if(e.key==='Escape')e.target.blur();return;}if(e.key==='Enter'){openChat(true);$('#chatIn').focus();}if(e.key==='Escape'&&thr.s!=='idle'){thr={s:'idle'};$('#meterBox').hidden=true;}});

/* ================= lobby & boot ================= */
async function checkForUpdate(){
  try{const r=await fetch('version.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)return false;const j=await r.json();
    if(j.v>APP_VERSION){const k='darts-upd-'+j.v;if(sessionStorage.getItem(k))return false;sessionStorage.setItem(k,'1');const u=new URL(location.href);u.searchParams.set('r',Date.now().toString(36));location.replace(u.toString());return true;}}catch(e){}
  return false;
}
function showLobby(){
  $('#lobby').hidden=false;$('#nameIn').value=myName;
  const opt={mode:'501',legs:1,cpus:[]};
  const seg=(id,key,cb)=>document.querySelectorAll(`#${id} button`).forEach(b=>b.onclick=()=>{opt[key]=b.dataset.v;document.querySelectorAll(`#${id} button`).forEach(x=>x.classList.toggle('on',x===b));cb&&cb();});
  seg('modeSeg','mode',()=>{$('#x01Opts').hidden=opt.mode==='cricket';});
  seg('legSeg','legs');
  const drawCpus=()=>{$('#cpuList').innerHTML=opt.cpus.map((c,i)=>`<div><span>🤖 CPU (${c})</span><button data-i="${i}" style="font-size:12px;padding:2px 8px">remove</button></div>`).join('');document.querySelectorAll('#cpuList button').forEach(b=>b.onclick=()=>{opt.cpus.splice(+b.dataset.i,1);drawCpus();});};
  document.querySelectorAll('#cpuAdd button').forEach(b=>b.onclick=()=>{if(opt.cpus.length>=3){toast('Max 4 players');return;}opt.cpus.push(b.dataset.v);drawCpus();});
  let list=[];try{list=JSON.parse(store.get('darts-recent')||'[]');}catch(e){}
  if(list.length)$('#recent').innerHTML='<div style="color:var(--muted);font-size:13px;margin-bottom:4px">Your recent games</div>'+list.map(x=>`<div><a style="color:var(--gold)" href="${esc(x.link)}">${esc(x.title)}</a> <span style="color:var(--muted);font-size:12px">${new Date(x.ts).toLocaleString()}</span></div>`).join('');
  $('#createBtn').onclick=()=>{
    const v=$('#nameIn').value.trim().slice(0,16);if(!v){toast('Enter your name first');$('#nameIn').focus();return;}
    myName=v;store.set('darts-name',v);
    const id=rid(8);
    const c={v:1,ver:1,host:PID,mode:opt.mode,dout:opt.mode!=='cricket'&&$('#dout').checked,din:opt.mode!=='cricket'&&$('#din').checked,legs:+opt.legs,order:[PID],started:false,round:1,created:Date.now()};
    const rs={};rs[PID]={pid:PID,name:v,slot:0,ver:1,games:{}};
    opt.cpus.forEach((lvl,i)=>{const cp='cpu-'+rid(6);c.order.push(cp);rs[cp]={pid:cp,name:`CPU ${lvl[0].toUpperCase()+lvl.slice(1)}`,slot:i+1,ver:1,cpu:{level:lvl},games:{}};});
    store.set('darts-g-'+id,JSON.stringify({cfg:c,recs:rs,chat:[],fresh:true}));
    location.hash='#d='+id;
  };
}
function askName(){
  return new Promise(res=>{
    showModal(`<h2>🎯 You're invited to darts!</h2><p>${esc(nameOf(cfg.host))} wants a game of ${cfg.mode==='cricket'?'Cricket':cfg.mode}. What's your name?</p><input type="text" id="nm" maxlength="16" value="${esc(myName)}" placeholder="Your name"><div class="row2" style="justify-content:flex-end"><button class="primary" id="ok">Join game</button></div>`);
    const done=()=>{const v=$('#nm').value.trim().slice(0,16);if(!v){$('#nm').focus();return;}myName=v;store.set('darts-name',v);hideModal();res();};
    $('#ok').onclick=done;$('#nm').onkeydown=e=>{if(e.key==='Enter')done();};setTimeout(()=>$('#nm').focus(),50);
  });
}
async function boot(){
  requestAnimationFrame(frame);
  if(await checkForUpdate())return;
  const m=location.hash.match(/^#d=([a-z0-9]+)$/i);
  if(!m){showLobby();return;}
  if(typeof mqtt==='undefined'){document.body.innerHTML='<p style="padding:30px">Could not load the networking library. Please refresh.</p>';return;}
  gid=m[1];
  let cached=null;try{cached=JSON.parse(store.get(cacheKey())||'null');}catch(e){}
  if(cached){cfg=cached.cfg||null;recs=cached.recs||{};chat=cached.chat||[];}
  net=new Net(gid,{onMessage,onStatus:netStatus,onConnect:cl=>{
    for(const pid in recs)if(pid===PID||(isHost()&&isCpu(pid)))net.publish('p/'+pid,JSON.parse(JSON.stringify(recs[pid])),true,cl);
    if(isHost())net.publish('cfg',JSON.parse(JSON.stringify(cfg)),true,cl);
    net.publish('hb',{pid:PID,name:myName},false,cl);}});
  net.start();netStatus();
  $('#room').hidden=false;$('#wrTitle').textContent='Finding the game…';$('#wrSub').textContent='Connecting to the game servers';$('#wrStart').hidden=true;
  const t0=Date.now();
  while(Date.now()-t0<8000){await new Promise(r=>setTimeout(r,250));if(cfg&&net.live()&&Date.now()-t0>2000)break;}
  if(!cfg){$('#wrTitle').textContent='Game not found yet';$('#wrSub').textContent='The host may be offline. This page will keep trying – leave it open.';
    while(!cfg)await new Promise(r=>setTimeout(r,500));}
  // join
  if(!cfg.order.includes(PID)){
    if(cfg.started||cfg.order.length>=4){toast('This game has already started – you are watching');}
    else{
      await askName();
      const used=new Set(Object.values(recs).map(r=>r.slot));let slot=0;while(used.has(slot))slot++;
      recs[PID]={pid:PID,name:myName,slot,ver:0,games:{}};publishRec(recs[PID]);
      net.publish('chat',{pid:PID,name:myName,slot,text:'joined the game 👋'});
    }
  }
  let list=[];try{list=JSON.parse(store.get('darts-recent')||'[]');}catch(e){}
  list=list.filter(x=>x.gid!==gid);list.unshift({gid,title:`${cfg.mode==='cricket'?'Cricket':cfg.mode} with ${cfg.order.map(nameOf).join(', ')}`,ts:Date.now(),link:location.href.split('?')[0]});store.set('darts-recent',JSON.stringify(list.slice(0,8)));
  renderChat();
  // returning players see existing darts immediately (no replay of the whole game)
  if(cfg.started){for(const pid of cfg.order)shown[pid]=dartsOf(pid).length;G=displayState();}
  onCfg(null,cfg.started);
  if(cached&&cached.fresh&&isHost()){cached.fresh=false;}
}
window.addEventListener('hashchange',()=>location.reload());
boot();
window.__darts={get G(){return G},get cfg(){return cfg},get recs(){return recs},throwAt:(x,y)=>throwDart([x,y]),canThrow,get flying(){return !!flying},get pause(){return visitPause}};
