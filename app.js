const STORAGE={prefs:"mvp_prefs_v1",history:"mvp_history_v1",daily:"mvp_daily_v1"};

function todayKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function loadJSON(u){return fetch(u).then(r=>r.json());}
function getJ(k){try{return JSON.parse(localStorage.getItem(k)||"{}")}catch{return {}}}
function setJ(k,v){localStorage.setItem(k,JSON.stringify(v));}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function hourBucket(){const h=new Date().getHours(); if(h<11)return "matin"; if(h<18)return "jour"; return "soir";}

function safetyFilter(c,mood,cap){
  if(c.is_injunctive||c.is_guilt_inducing||c.is_toxic_positive) return false;
  if((mood==="fatigué"||mood==="triste") && c.energy>=3) return false;
  if(c.energy>cap) return false;
  return true;
}

function score(c,ctx,hist){
  let s=0;
  if(ctx.mood && c.mood && c.mood===ctx.mood) s+=0.30;
  if(ctx.mood && !c.mood) s+=0.06;
  if(ctx.tonePref && c.tone===ctx.tonePref) s+=0.15;

  if(ctx.dayLoad==="dense"){ if(c.length==="courte") s+=0.06; if(c.length==="longue") s-=0.04; }
  else if(ctx.dayLoad==="light"){ if(c.length==="moyenne"||c.length==="longue") s+=0.03; }

  if(ctx.weather==="gris"){ if(c.tone==="accompagnant"||c.tone==="poétique") s+=0.04; if(c.tone==="direct") s-=0.02; }
  else if(ctx.weather==="soleil"){ if(c.tone==="neutre"||c.tone==="direct") s+=0.02; }

  const hb=hourBucket();
  if(hb==="soir"){ if(c.energy===1) s+=0.02; if(c.tone==="poétique"||c.tone==="stoïque") s+=0.01; }
  else if(hb==="matin"){ if(c.energy>=2 && c.tone!=="accompagnant") s+=0.01; }

  const seen=hist.seen||[];
  const i=seen.lastIndexOf(c.id);
  if(i!==-1){
    const dist=(seen.length-1)-i;
    if(dist<14) s-=(0.20-dist*0.01);
  }

  const likes=hist.likes||{};
  if(likes[`need:${c.need}`]) s+=clamp(likes[`need:${c.need}`]*0.02,0,0.08);
  if(likes[`tone:${c.tone}`]) s+=clamp(likes[`tone:${c.tone}`]*0.015,0,0.06);

  return s;
}

function pick(all,ctx){
  const prefs=getJ(STORAGE.prefs);
  const hist=getJ(STORAGE.history);
  const cap=parseInt(ctx.energyCap || prefs.energyCap || "3",10);

  let pool=all.slice();
  if(ctx.need) pool=pool.filter(x=>x.need===ctx.need);
  pool=pool.filter(x=>safetyFilter(x,ctx.mood||null,cap));
  if(pool.length===0){
    pool=all.filter(x=>!x.is_injunctive&&!x.is_guilt_inducing&&!x.is_toxic_positive).filter(x=>x.energy<=cap);
  }
  const scored=pool.map(c=>({c,s:score(c,ctx,hist)})).sort((a,b)=>b.s-a.s);
  const top=scored.slice(0,Math.min(8,scored.length));
  if(!top.length) return null;
  const minS=top[top.length-1].s;
  const w=top.map(x=>Math.max(0.001,x.s-minS+0.05));
  const sum=w.reduce((a,b)=>a+b,0);
  let r=Math.random()*sum;
  for(let i=0;i<top.length;i++){ r-=w[i]; if(r<=0) return top[i].c; }
  return top[0].c;
}

function render(c){
  document.getElementById("quoteBox").style.display="block";
  document.getElementById("metaBox").style.display="flex";
  document.getElementById("feedbackRow").style.display="flex";
  document.getElementById("quoteBox").textContent=c.text;
  const pills=[`besoin: ${c.need}`, c.mood?`humeur: ${c.mood}`:"humeur: —",`ton: ${c.tone}`,`énergie: ${c.energy}`,`longueur: ${c.length}`,`id: ${c.id}`];
  document.getElementById("metaBox").innerHTML=pills.map(p=>`<span class="pill">${p}</span>`).join("");
}

function updateToday(){
  const d=new Date();
  document.getElementById("today").textContent=d.toLocaleDateString('fr-FR',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+" — "+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}

function ctxFromUI(){
  const ctx={
    need: document.getElementById("need").value||null,
    mood: document.getElementById("mood").value||null,
    tonePref: document.getElementById("tonePref").value||null,
    energyCap: document.getElementById("energyCap").value||"3",
    dayLoad: document.getElementById("dayLoad").value||null,
    weather: document.getElementById("weather").value||null
  };
  const prefs=getJ(STORAGE.prefs);
  if(ctx.tonePref) prefs.tonePref=ctx.tonePref;
  prefs.energyCap=parseInt(ctx.energyCap,10);
  setJ(STORAGE.prefs,prefs);
  return ctx;
}

function syncPrefs(){
  const p=getJ(STORAGE.prefs);
  if(p.tonePref) document.getElementById("tonePref").value=p.tonePref;
  if(p.energyCap) document.getElementById("energyCap").value=String(p.energyCap);
}

function pushSeen(id){
  const h=getJ(STORAGE.history);
  h.seen=h.seen||[];
  h.seen.push(id);
  if(h.seen.length>60) h.seen=h.seen.slice(-60);
  setJ(STORAGE.history,h);
}

function feedback(c,kind){
  const h=getJ(STORAGE.history);
  h.likes=h.likes||{};
  const delta=kind==="up"?1:kind==="down"?-1:0;
  if(delta!==0){
    const kn=`need:${c.need}`, kt=`tone:${c.tone}`;
    h.likes[kn]=clamp((h.likes[kn]||0)+delta,-3,8);
    h.likes[kt]=clamp((h.likes[kt]||0)+delta,-3,8);
  }
  h.lastFeedback={id:c.id,kind,at:new Date().toISOString()};
  setJ(STORAGE.history,h);
}

let ALL=[], CURRENT=null;

(async function init(){
  updateToday(); setInterval(updateToday,30000);
  syncPrefs();
  ALL=await loadJSON("citations.json");

  document.getElementById("btnDaily").addEventListener("click",()=>{
    const ctx=ctxFromUI();
    const daily=getJ(STORAGE.daily);
    const key=todayKey();
    if(daily.key===key && daily.citationId){
      const c=ALL.find(x=>x.id===daily.citationId);
      if(c){ CURRENT=c; render(c); return; }
    }
    const c=pick(ALL,ctx); if(!c) return;
    CURRENT=c; render(c); pushSeen(c.id);
    setJ(STORAGE.daily,{key,citationId:c.id,ctx,at:new Date().toISOString()});
  });

  document.getElementById("btnNew").addEventListener("click",()=>{
    const ctx=ctxFromUI();
    const c=pick(ALL,ctx); if(!c) return;
    CURRENT=c; render(c); pushSeen(c.id);
  });

  document.getElementById("btnReset").addEventListener("click",()=>{
    localStorage.removeItem(STORAGE.history);
    localStorage.removeItem(STORAGE.daily);
    alert("Réinitialisé.");
  });

  document.getElementById("btnUp").addEventListener("click",()=>{ if(CURRENT){feedback(CURRENT,"up"); alert("👍 Noté.");}});
  document.getElementById("btnMid").addEventListener("click",()=>{ if(CURRENT){feedback(CURRENT,"mid"); alert("😐 Noté.");}});
  document.getElementById("btnDown").addEventListener("click",()=>{ if(CURRENT){feedback(CURRENT,"down"); alert("👎 Noté.");}});
  document.getElementById("btnCopy").addEventListener("click",async()=>{
    if(!CURRENT) return;
    await navigator.clipboard.writeText(CURRENT.text);
    alert("Copié ✅");
  });
})();