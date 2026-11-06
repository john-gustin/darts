// Darts rules engine. The whole game is rebuilt from each player's list of dart landing points (mm),
// so every browser computes exactly the same state.
export const ORDER=[20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
export const R={bullIn:6.35,bullOut:15.9,trebIn:99,trebOut:107,dblIn:162,dblOut:170,board:225};

export function hitAt(x,y){
  const r=Math.hypot(x,y);
  if(r<=R.bullIn)return {n:25,m:2,v:50,label:'BULL'};
  if(r<=R.bullOut)return {n:25,m:1,v:25,label:'25'};
  if(r>R.dblOut)return {n:0,m:0,v:0,label:'MISS'};
  const th=(Math.atan2(x,y)*180/Math.PI+360+9)%360;
  const n=ORDER[Math.floor(th/18)];
  const m=r>=R.dblIn?2:(r>=R.trebIn&&r<=R.trebOut)?3:1;
  return {n,m,v:n*m,label:(m===3?'T':m===2?'D':'')+n};
}
export function targetPoint(label){
  if(label==='BULL'||label==='D25')return [0,0];
  if(label==='25')return [0,11];
  const m=label[0]==='T'?3:label[0]==='D'?2:1;
  const n=parseInt(m===1?label.replace(/^S/,''):label.slice(1),10);
  const i=ORDER.indexOf(n);const a=i*18*Math.PI/180;
  const r=m===3?103:m===2?166:132;
  return [Math.sin(a)*r,Math.cos(a)*r];
}

// ---------- checkouts ----------
const THROWS=[];
for(let n=1;n<=20;n++){THROWS.push({l:'T'+n,v:3*n,d:false,t:true},{l:'D'+n,v:2*n,d:true},{l:''+n,v:n,d:false});}
THROWS.push({l:'25',v:25,d:false},{l:'BULL',v:50,d:true});
const PREF=['D20','D16','D18','D10','D8','D12','D14','D6','D4','D2','D19','D17','D15','D13','D11','D9','D7','D5','D3','D1','BULL'];
const DOUBLES=THROWS.filter(t=>t.d);
const cache=new Map();
export function checkout(score,darts,dout=true){
  if(score<2||score>170||darts<1)return null;
  if(!dout&&score>180)return null;
  const key=score+'|'+darts+'|'+dout;if(cache.has(key))return cache.get(key);
  let best=null,bc=1e9;
  const finals=dout?DOUBLES:THROWS;
  const cost=(seq)=>{let c=seq.length*1000;const last=seq[seq.length-1];c+=dout?PREF.indexOf(last.l)*10:0;for(let i=0;i<seq.length-1;i++){const s=seq[i];c+=s.t?(s.l==='T20'||s.l==='T19'?1:3):s.l==='BULL'||s.l==='25'?6:s.d?8:0;}return c;};
  const consider=seq=>{const c=cost(seq);if(c<bc){bc=c;best=seq.map(s=>s.l);}};
  for(const f of finals)if(f.v===score)consider([f]);
  if(darts>=2)for(const a of THROWS)for(const f of finals)if(a.v+f.v===score)consider([a,f]);
  if(darts>=3&&!best)for(const a of THROWS)for(const b of THROWS)for(const f of finals)if(a.v+b.v+f.v===score)consider([a,b,f]);
  cache.set(key,best);return best;
}

// ---------- game reconstruction ----------
export const CRICKET=[20,19,18,17,16,15,25];
// cfg: {mode:'501'|'301'|'cricket', din, dout, legs, order:[pid]}, darts: {pid: [[x,y],...]}
export function compute(cfg,dartsBy){
  const order=cfg.order,n=order.length;
  const need=Math.ceil((cfg.legs||1)/2);
  const ptr=order.map(()=>0);
  const legsWon=order.map(()=>0);
  const stats=order.map(()=>({pts:0,darts:0,marks:0,visits:0,best:0,tons:0,c180:0}));
  const x01=cfg.mode!=='cricket',start=cfg.mode==='301'?301:501;
  let leg=0,legLog=[];
  const out={mode:cfg.mode,n,legsWon,stats,leg:0,turn:0,visit:[],visitStart:0,winner:null,legEvents:[],lastVisit:order.map(()=>null),onBoard:[]};
  if(!n)return out;
  for(;;){
    // new leg
    const st={scores:order.map(()=>start),isIn:order.map(()=>!cfg.din),marks:order.map(()=>({20:0,19:0,18:0,17:0,16:0,15:0,25:0})),points:order.map(()=>0)};
    let turn=leg%n,legWinner=null,lastBoard=[];
    while(legWinner===null){
      const p=turn,list=dartsBy[order[p]]||[];
      const visit=[];const before=st.scores[p],wasIn=st.isIn[p];let bust=false,done=false;
      for(let d=0;d<3;d++){
        if(ptr[p]>=list.length){
          // visit in progress (or not started)
          Object.assign(out,{leg,turn:p,visit,visitStart:before,scores:st.scores,marks:st.marks,points:st.points,isIn:st.isIn,onBoard:visit.length?visit:lastBoard});
          return out;
        }
        const [x,y]=list[ptr[p]++];const h=hitAt(x,y);h.x=x;h.y=y;h.p=p;visit.push(h);stats[p].darts++;
        if(x01){
          let v=h.v;
          if(!st.isIn[p]){if(h.m===2){st.isIn[p]=true;}else v=0;}
          const ns=st.scores[p]-v;
          if(ns<0||(cfg.dout&&ns===1)||(ns===0&&cfg.dout&&h.m!==2)){bust=true;st.scores[p]=before;st.isIn[p]=wasIn;break;}
          st.scores[p]=ns;
          if(ns===0){done=true;break;}
        } else {
          if(CRICKET.includes(h.n)&&h.m>0){
            const mk=st.marks[p],cur=mk[h.n],add=h.m,tot=cur+add;
            const extra=Math.max(0,tot-Math.max(cur,3));
            mk[h.n]=Math.min(tot,3);
            stats[p].marks+=Math.min(add,Math.max(0,3-cur))+extra;
            if(extra&&st.marks.some((o,i)=>i!==p&&o[h.n]<3))st.points[p]+=extra*(h.n===25?25:h.n);
          }
          const closedAll=CRICKET.every(t=>st.marks[p][t]>=3);
          if(closedAll&&st.points.every((q,i)=>i===p||st.points[p]>=q)){done=true;break;}
        }
      }
      const tot=x01?(bust?0:before-st.scores[p]):visit.reduce((a,h)=>a+(CRICKET.includes(h.n)?h.m:0),0);
      if(x01){stats[p].pts+=tot;if(tot>stats[p].best)stats[p].best=tot;if(tot>=100)stats[p].tons++;if(tot===180)stats[p].c180++;}
      stats[p].visits++;
      out.lastVisit[p]={hits:visit,total:tot,bust,leg};
      lastBoard=visit;
      if(done){legWinner=p;}
      else turn=(turn+1)%n;
    }
    legsWon[legWinner]++;
    out.legEvents.push({leg,winner:legWinner});
    if(legsWon[legWinner]>=need){
      Object.assign(out,{leg,turn:legWinner,visit:[],winner:legWinner,scores:st.scores,marks:st.marks,points:st.points,isIn:st.isIn,onBoard:lastBoard,finalLeg:true});
      return out;
    }
    leg++;
  }
}
export function fmtMarks(m){return m>=3?'ⓧ':m===2?'✕':m===1?'/':'';}
