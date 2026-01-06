const STORAGE={prefs:"mvp_prefs_v1",history:"mvp_history_v1",daily:"mvp_daily_v1"};

function todayKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function loadJSON(u){return fetch(u).then(r=>r.json());}
function getJ(k){try{return JSON.parse(localStorage.getItem(k)||"{}")}catch{return {}}}
function setJ(k,v){localStorage.setItem(k,JSON.stringify(v));}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function hourBucket(){const h=new Date().getHours(); if(h<11)return "matin"; if(h<18)return "jour"; return "soir";}

function hasCompletedOnboarding(prefs){
  return Boolean(prefs && prefs.tonePref && typeof prefs.energyCap==="number");
}

function qs(id){return document.getElementById(id);}

function show(el,yes){ if(!el) return; el.style.display = yes ? "block" : "none"; }

function openSettings(){
  qs("settingsOverlay").classList.remove("hidden");
  qs("settingsPanel").classList.remove("hidden");
}

function closeSettings(){
  qs("settingsOverlay").classList.add("hidden");
  qs("settingsPanel").classList.add("hidden");
}

function labelTone(t){
  if(t==="accompagnant") return "Accompagnant";
  if(t==="neutre") return "Neutre";
  if(t==="direct") return "Direct";
  if(t==="stoïque") return "Stoïque";
  if(t==="poétique") return "Poétique";
  return "—";
}

function updateSubtitle(){
  const p=getJ(STORAGE.prefs);
  const tone=labelTone(p.tonePref);
  const energy=typeof p.energyCap==="number" ? p.energyCap : 2;
  const el=qs("subtitle");
  if(!el) return;
  if(hasCompletedOnboarding(p)) el.textContent=`Ton : ${tone} • Énergie max : ${energy}`;
  else el.textContent="Une citation courte, au bon niveau d’énergie.";
}

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

  const hb=hourBucket();
  if(hb==="soir"){ if(c.energy===1) s+=0.02; if(c.tone==="poétique"||c.tone==="stoïque") s+=0.01; }
  else if(hb==="matin"){ if(c.energy>=2 && c.tone!=="accompagnant") s+=0.01; }

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
  
  // Exclure les citations déjà vues par cet utilisateur
  const seen = hist.seen || [];
  pool = pool.filter(c => !seen.includes(c.id));
  
  // Si toutes les citations ont été vues, réinitialiser l'historique
  if(pool.length === 0) {
    console.log("🔄 Toutes les citations ont été vues, réinitialisation de l'historique");
    hist.seen = [];
    setJ(STORAGE.history, hist);
    pool = all.slice();
  }
  
  if(ctx.need) pool=pool.filter(x=>x.need===ctx.need);
  pool=pool.filter(x=>safetyFilter(x,ctx.mood||null,cap));
  if(pool.length===0){
    // Fallback mais toujours en excluant les citations vues
    pool=all.filter(x=>!seen.includes(x.id) && !x.is_injunctive && !x.is_guilt_inducing && !x.is_toxic_positive && x.energy<=cap);
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
  qs("quoteBox").style.display="block";
  qs("feedbackRow").style.display="flex";
  qs("detailsRow").style.display="flex";
  qs("quoteBox").textContent=c.text;

  // Par défaut: pas de metadata visible, uniquement via “Détails”.
  qs("detailsBox").style.display="none";
  qs("btnToggleDetails").textContent="Détails";

  // Détails: par défaut cachés, mais mis à jour à chaque citation
  const prefs=getJ(STORAGE.prefs);
  const ctx=LAST_CTX || {need:null,mood:null};
  const userKv=[
    ["need", ctx.need ?? "—"],
    ["mood", ctx.mood ?? "—"],
    ["tonePref", prefs.tonePref || "—"],
    ["energyCap", String(typeof prefs.energyCap==="number"?prefs.energyCap:2)]
  ];
  const quoteKv=[
    ["id", c.id ?? "—"],
    ["need", c.need ?? "—"],
    ["mood", c.mood ?? "—"],
    ["tone", c.tone ?? "—"],
    ["energy", String(c.energy ?? "—")],
    ["length", c.length ?? "—"],
    ["author", c.author ?? "—"],
    ["language", c.language ?? "—"],
    ["is_injunctive", String(Boolean(c.is_injunctive))],
    ["is_guilt_inducing", String(Boolean(c.is_guilt_inducing))],
    ["is_toxic_positive", String(Boolean(c.is_toxic_positive))]
  ];
  qs("detailsBox").innerHTML=
    `<h2 style="margin:0 0 8px;">Détails</h2>`+
    `<div class="muted" style="margin-bottom:10px;">Tes paramètres (ce que tu as choisi) vs la citation (ses champs).</div>`+
    `<div class="row">`+
      `<div>`+
        `<div class="muted" style="margin-bottom:6px;"><b>Tes paramètres</b></div>`+
        `<div>${userKv.map(([k,v])=>`<span class="pill">${k}: ${v}</span>`).join(" ")}</div>`+
      `</div>`+
      `<div>`+
        `<div class="muted" style="margin-bottom:6px;"><b>Citation</b></div>`+
        `<div>${quoteKv.map(([k,v])=>`<span class="pill">${k}: ${v}</span>`).join(" ")}</div>`+
      `</div>`+
    `</div>`;
}

function ctxFromUI(){
  const prefs=getJ(STORAGE.prefs);
  return {
    need: qs("need").value||null,
    mood: qs("mood").value||null,
    tonePref: prefs.tonePref||null,
    energyCap: String(prefs.energyCap||3)
  };
}

function syncPrefsIntoSettings(){
  const p=getJ(STORAGE.prefs);
  qs("setTone").value=p.tonePref||"";
  qs("setEnergy").value=String(p.energyCap||2);
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

let ALL=[], CURRENT=null, LAST_CTX=null;

(async function init(){
  // Init prefs defaults (sans déclencher l'onboarding comme "fait")
  const prefs=getJ(STORAGE.prefs);
  if(typeof prefs.energyCap!=="number") prefs.energyCap=2;
  if(typeof prefs.tonePref!=="string") prefs.tonePref="";
  setJ(STORAGE.prefs,prefs);
  updateSubtitle();

  ALL=await loadJSON("citations.json");

  // UI: onboarding vs main
  const completed=hasCompletedOnboarding(getJ(STORAGE.prefs));
  show(qs("onboardingScreen"),!completed);
  show(qs("mainScreen"),completed);
  qs("btnOpenSettings").style.visibility = completed ? "visible" : "hidden";

  // Settings open/close
  qs("btnOpenSettings").addEventListener("click",()=>{
    syncPrefsIntoSettings();
    openSettings();
  });
  qs("btnCloseSettings").addEventListener("click",closeSettings);
  qs("settingsOverlay").addEventListener("click",closeSettings);

  // Onboarding
  qs("btnFinishOnboarding").addEventListener("click",()=>{
    const tone=qs("obTone").value||"";
    const energy=parseInt(qs("obEnergy").value||"2",10);
    if(!tone){
      alert("Choisis un ton pour continuer.");
      return;
    }
    const p=getJ(STORAGE.prefs);
    p.tonePref=tone;
    p.energyCap=clamp(energy,1,3);
    setJ(STORAGE.prefs,p);
    updateSubtitle();

    show(qs("onboardingScreen"),false);
    show(qs("mainScreen"),true);
    qs("btnOpenSettings").style.visibility="visible";
  });

  // Save settings
  qs("btnSaveSettings").addEventListener("click",()=>{
    const tone=qs("setTone").value||"";
    const energy=parseInt(qs("setEnergy").value||"2",10);
    if(!tone){
      alert("Choisis un ton.");
      return;
    }
    const p=getJ(STORAGE.prefs);
    p.tonePref=tone;
    p.energyCap=clamp(energy,1,3);
    setJ(STORAGE.prefs,p);
    updateSubtitle();
    closeSettings();
  });

  // Main flow
  qs("btnGetQuote").addEventListener("click",()=>{
    const p=getJ(STORAGE.prefs);
    if(!hasCompletedOnboarding(p)){
      show(qs("onboardingScreen"),true);
      show(qs("mainScreen"),false);
      qs("btnOpenSettings").style.visibility="hidden";
      return;
    }
    const ctx=ctxFromUI();
    if(!ctx.need || !ctx.mood){
      alert("Choisis un besoin et une humeur.");
      return;
    }
    const c=pick(ALL,ctx);
    if(!c){
      alert("Aucune citation trouvée avec ces paramètres.");
      return;
    }
    CURRENT=c;
    LAST_CTX=ctx;
    render(c);
    pushSeen(c.id);
  });

  // Toggle détails
  qs("btnToggleDetails").addEventListener("click",()=>{
    const box=qs("detailsBox");
    const open=box.style.display!=="none";
    box.style.display=open?"none":"block";
    qs("btnToggleDetails").textContent=open?"Détails":"Masquer";
  });

  // Feedback
  qs("btnUp").addEventListener("click",()=>{
    if(!CURRENT) return;
    feedback(CURRENT,"up");
    alert("👍 Noté.");
  });

  qs("btnMid").addEventListener("click",()=>{
    if(!CURRENT) return;
    feedback(CURRENT,"mid");
    alert("😐 Noté.");
  });

  qs("btnDown").addEventListener("click",()=>{
    if(!CURRENT) return;
    feedback(CURRENT,"down");

    const wantsAnother=confirm("Ok — tu en veux une autre ?");
    if(!wantsAnother) return;

    const ctx=LAST_CTX || ctxFromUI();
    const c=pick(ALL,ctx);
    if(!c){
      alert("Je n’ai pas trouvé d’autre citation adaptée.");
      return;
    }
    CURRENT=c;
    LAST_CTX=ctx;
    render(c);
    pushSeen(c.id);
  });
})();