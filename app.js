// Import du module RAG (recherche sémantique)
import * as RAG from './rag.js';
// Import du module OpenAI (génération de citations)
import * as OpenAI from './openai.js';

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

function getMode(prefs){
  return prefs.mode || 'regles';
}

function qs(id){return document.getElementById(id);}

function on(id, eventName, handler){
  const el = qs(id);
  if(!el) return;
  el.addEventListener(eventName, handler);
}

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

function setQuestionFlowVisible(yes){
  const el = qs("questionFlow");
  if(!el) return;
  el.classList.toggle("hidden", !yes);
}

function showRAGFreeTextFlow(yes){
  const el = qs("ragFreeTextFlow");
  if(!el) return;
  el.classList.toggle("active", yes);
}

function showClassicQuestionFlow(yes){
  // Cache/affiche les variantes de besoin et humeur
  document.querySelectorAll(".need-variant, .mood-variant, #moodStep, #quoteActionRow").forEach(el => {
    el.style.display = yes ? "block" : "none";
  });
}

function resetQuoteUI(){
  if(qs("quoteBox")) qs("quoteBox").style.display="none";
  if(qs("feedbackRow")) qs("feedbackRow").style.display="none";
  if(qs("detailsRow")) qs("detailsRow").style.display="none";
  if(qs("detailsBox")) qs("detailsBox").style.display="none";
  if(qs("btnToggleDetails")) qs("btnToggleDetails").textContent="Détails";
  setQuestionFlowVisible(true);
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
  setQuestionFlowVisible(false);
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
    questionLabel: qs("questionLabel")?.value||null,
    questionText: qs("questionText")?.value||null,
    freeText: qs("optionalUserText")?.value?.trim() || null,
    tonePref: prefs.tonePref||null,
    energyCap: String(prefs.energyCap||3)
  };
}

function setSelectedByDataAttr(attrName, attrValue){
  document.querySelectorAll(`[${attrName}]`).forEach((el)=>{
    if(!(el instanceof HTMLElement)) return;
    const isSelected = el.getAttribute(attrName) === attrValue;
    el.classList.toggle("selected", Boolean(attrValue) && isSelected);
  });
}

function clearSelectedByDataAttr(attrName){
  document.querySelectorAll(`[${attrName}]`).forEach((el)=>{
    if(!(el instanceof HTMLElement)) return;
    el.classList.remove("selected");
  });
}

function syncPrefsIntoSettings(){
  const p=getJ(STORAGE.prefs);
  qs("setTone").value=p.tonePref||"";
  qs("setEnergy").value=String(p.energyCap||2);
  const mode = getMode(p);
  qs("setMode").value=mode;
  
  // Afficher la clé API masquée si elle existe
  const apiKeyInput = qs("setApiKey");
  if(apiKeyInput && OpenAI.hasApiKey()){
    apiKeyInput.placeholder = OpenAI.getApiKeyMasked();
  }
  
  // Afficher/masquer la config OpenAI selon le mode
  const openaiConfig = qs("openaiConfig");
  if(openaiConfig){
    openaiConfig.style.display = mode === "openai" ? "block" : "none";
  }
}

function pushSeen(id, text = null){
  const h=getJ(STORAGE.history);
  h.seen=h.seen||[];
  h.seen.push(id);
  if(h.seen.length>60) h.seen=h.seen.slice(-60);
  
  // Stocker aussi le texte pour les citations générées par OpenAI
  if(text){
    h.seenTexts = h.seenTexts || [];
    h.seenTexts.push(text);
    if(h.seenTexts.length > 30) h.seenTexts = h.seenTexts.slice(-30);
  }
  
  setJ(STORAGE.history,h);
}

function getSeenTexts(){
  const h=getJ(STORAGE.history);
  return h.seenTexts || [];
}

function getSeenIds(){
  const h=getJ(STORAGE.history);
  return h.seen || [];
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
let ALL_LOADED=false;
let ALL_LOAD_ERROR=null;

function ensureCitationsReady(){
  if(ALL_LOADED && Array.isArray(ALL) && ALL.length) return true;
  if(ALL_LOAD_ERROR){
    alert("Impossible de charger les citations. Vérifie que tu ouvres via un serveur (ex: http://localhost:8000) et recharge la page.");
    return false;
  }
  alert("Chargement des citations… réessaie dans une seconde.");
  return false;
}

// ===== MODE RAG =====
async function handleRAGMode(ctx, freeTextQuery = null){
  // Vérifier la disponibilité du serveur RAG
  const isHealthy = await RAG.checkHealth();
  if(!isHealthy){
    alert("⚠️ Le serveur RAG n'est pas disponible.\n\nLance le serveur avec:\ncd RAG && python rag_server.py");
    return;
  }

  // Construire la requête sémantique et y ajouter le texte libre s'il existe
  const baseQuery = RAG.buildSearchQuery({
    questionLabel: ctx.questionLabel,
    questionText: ctx.questionText,
    tonePref: ctx.tonePref,
    energyCap: ctx.energyCap
  }) || '';
  const extra = (freeTextQuery && freeTextQuery.trim()) || '';
  const query = [baseQuery, extra].filter(Boolean).join("\n");
  
  // Récupérer les IDs des citations déjà vues (30 derniers)
  const seenIds = getSeenIds().slice(-30);
  
  // Lancer la recherche sémantique (top 3) en excluant les déjà vues
  const results = await RAG.search(query, 3, seenIds);
  
  if(!results || results.length === 0){
    alert("Aucun résultat trouvé pour cette recherche.");
    return;
  }

  // Afficher les résultats
  renderRAGResults(results, ctx, query);
}

// ===== MODE OPENAI =====
async function handleOpenAIMode(ctx, freeTextQuery = null){
  // Vérifier que la clé API est configurée
  if(!OpenAI.hasApiKey()){
    alert("⚠️ Clé API OpenAI manquante.\n\nVa dans les paramètres pour la configurer.");
    return;
  }

  // Fallback: si questionLabel/questionText manquent, tenter de les déduire de l'UI
  if(!(ctx.questionLabel && ctx.questionLabel.trim()) || !(ctx.questionText && ctx.questionText.trim())){
    const visibleVariant = document.querySelector('.question-variant:not(.hidden), .need-variant:not(.hidden), .mood-variant:not(.hidden)');
    if(visibleVariant){
      const selectedLabelEl = visibleVariant.querySelector('.selected .label') || visibleVariant.querySelector('.label');
      const h1 = visibleVariant.querySelector('h1');
      if(!ctx.questionLabel && selectedLabelEl){
        ctx.questionLabel = selectedLabelEl.textContent.trim();
      }
      if(!ctx.questionText && h1){
        ctx.questionText = h1.textContent.trim();
      }
      const ql = qs('questionLabel');
      const qt = qs('questionText');
      if(ql) ql.value = ctx.questionLabel || '';
      if(qt) qt.value = ctx.questionText || '';
    }
  }

  // Préparer le contexte pour OpenAI
  const openAIContext = {
    need: ctx.need,
    mood: ctx.mood,
    questionLabel: ctx.questionLabel,
    questionText: ctx.questionText,
    tonePref: ctx.tonePref,
    energyCap: ctx.energyCap,
    freeText: freeTextQuery
  };

  // Récupérer les citations déjà vues
  const seenTexts = getSeenTexts();

  try {
    // Générer la citation via OpenAI
    const result = await OpenAI.generateQuote(openAIContext, seenTexts);
    
    if(!result || !result.text){
      alert("Aucune citation générée.");
      return;
    }

    // Afficher le résultat
    renderOpenAIResult(result, ctx);
    
    // Sauvegarder dans l'historique
    const generatedId = `openai_${Date.now()}`;
    pushSeen(generatedId, result.text);
    
  } catch (error) {
    console.error('[OpenAI] Erreur:', error);
    alert(`Erreur lors de la génération:\n${error.message}`);
  }
}

function renderOpenAIResult(result, ctx){
  setQuestionFlowVisible(false);
  
  const quoteBox = qs("quoteBox");
  const feedbackRow = qs("feedbackRow");
  const detailsRow = qs("detailsRow");
  const detailsBox = qs("detailsBox");
  
  quoteBox.style.display="block";
  feedbackRow.style.display="none"; // Pas de feedback pour OpenAI (pour l'instant)
  detailsRow.style.display="flex";
  detailsBox.style.display="none";
  
  // Afficher la citation générée
  const lines = result.text.split('\n').filter(l => l.trim());
  const quoteParts = result.text.match(/^"(.+?)"\s*—\s*(.+)$/s) || 
                     result.text.match(/^(.+?)\s*—\s*(.+)$/s);
  
  let displayText = result.text;
  let author = 'OpenAI';
  
  if (quoteParts && quoteParts.length >= 3) {
    displayText = quoteParts[1].replace(/^"|"$/g, '').trim();
    author = quoteParts[2].trim();
  } else if (lines.length >= 2 && lines[lines.length-1].startsWith('—')) {
    author = lines[lines.length-1].replace('—', '').trim();
    displayText = lines.slice(0, -1).join('\n').replace(/^"|"$/g, '').trim();
  }
  
  let html = `
    <div class="muted" style="margin-bottom:12px;">✨ <b>Généré par OpenAI</b> — Citation unique pour toi</div>
    <div style="font-size:1.3em; line-height:1.5; margin-bottom:12px;">${displayText}</div>
    <div class="muted">— ${author}</div>
  `;
  
  quoteBox.innerHTML = html;
  
  // Préparer le contenu des détails
  let detailsHtml = `
    <div style="margin-bottom:16px;">
      <div class="muted" style="margin-bottom:8px;"><b>🤖 Génération IA :</b></div>
      <div style="padding:12px; background:#0c0e14; border-radius:8px; border:1px solid #2a3145;">
        <div style="margin-bottom:8px;"><span class="pill" style="font-size:11px;">Modèle: ${result.metadata.model}</span></div>
        <div class="muted" style="font-size:11px;">Cette citation a été générée spécifiquement pour ton contexte actuel.</div>
      </div>
    </div>
  `;

  // Afficher le prompt exact envoyé à OpenAI
  if (result.promptSent) {
    detailsHtml += `
      <div style="margin-bottom:16px;">
        <div class="muted" style="margin-bottom:8px;"><b>📝 Prompt envoyé à OpenAI :</b></div>
        <div style="padding:12px; background:#0c0e14; border-radius:8px; border:1px solid #2a3145; font-family:monospace; white-space:pre-wrap; line-height:1.4;">
          ${escapeHtml(result.promptSent)}
        </div>
      </div>
    `;
  }
  
  if(ctx.freeText){
    detailsHtml += `
      <div style="margin-bottom:16px;">
        <div class="muted" style="margin-bottom:8px;"><b>📝 Ta demande :</b></div>
        <div style="padding:12px; background:#0c0e14; border-radius:8px; border:1px solid #2a3145; font-style:italic;">
          "${ctx.freeText}"
        </div>
      </div>
    `;
  } else {
    detailsHtml += `
      <div>
        <div class="muted" style="margin-bottom:8px;"><b>🎯 Contexte :</b></div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${ctx.tonePref ? `<span class="pill" style="font-size:11px;">ton: ${ctx.tonePref}</span>` : ''}
          ${ctx.energyCap ? `<span class="pill" style="font-size:11px;">énergie max: ${ctx.energyCap}</span>` : ''}
        </div>
      </div>
    `;
  }
  
  detailsBox.innerHTML = detailsHtml;
  
  // Stocker le contexte
  LAST_CTX = ctx;
}

// Protège l'affichage du prompt dans le HTML
function escapeHtml(str){
  if(!str) return '';
  return str
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
function renderRAGResults(results, ctx, query){
  setQuestionFlowVisible(false);
  
  const quoteBox = qs("quoteBox");
  const feedbackRow = qs("feedbackRow");
  const detailsRow = qs("detailsRow");
  const detailsBox = qs("detailsBox");
  
  quoteBox.style.display="block";
  feedbackRow.style.display="none"; // Pas de feedback en mode RAG
  detailsRow.style.display="flex"; // Afficher le bouton détails
  detailsBox.style.display="none"; // Cacher les détails par défaut
  
  // Afficher seulement la top 1 citation
  const top = results[0];
  const author = top.metadata?.author || 'Anonyme';
  
  let html = `
    <div class="muted" style="margin-bottom:12px;">🔍 <b>Mode RAG</b> — Recherche sémantique</div>
    <div style="font-size:1.3em; line-height:1.5; margin-bottom:12px;">${top.text}</div>
    <div class="muted">— ${author}</div>
  `;
  
  quoteBox.innerHTML = html;
  
  // Préparer le contenu des détails (query + top 3)
  let detailsHtml = `
    <div style="margin-bottom:16px;">
      <div class="muted" style="margin-bottom:8px;"><b>📝 Requête envoyée au RAG :</b></div>
      <div style="padding:12px; background:#0c0e14; border-radius:8px; border:1px solid #2a3145; font-style:italic;">
        "${query}"
      </div>
    </div>
    <div>
      <div class="muted" style="margin-bottom:8px;"><b>🎯 Top 3 des résultats :</b></div>
  `;
  
  results.slice(0, 3).forEach((r, idx) => {
    const rank = idx + 1;
    const score = r.score ? r.score.toFixed(3) : 'N/A';
    const m = r.metadata || {};
    const author = m.author || 'Anonyme';
    
    // Construire les pills de métadonnées
    const metaPills = [];
    if (m.need) metaPills.push(`need: ${m.need}`);
    if (m.mood) metaPills.push(`mood: ${m.mood}`);
    if (m.tone) metaPills.push(`tone: ${m.tone}`);
    if (m.energy) metaPills.push(`energy: ${m.energy}`);
    if (m.length) metaPills.push(`length: ${m.length}`);
    if (m.language) metaPills.push(`lang: ${m.language}`);
    
    // Flags booléens
    const flags = [];
    if (m.is_injunctive) flags.push('injonctif');
    if (m.is_guilt_inducing) flags.push('culpabilisant');
    if (m.is_toxic_positive) flags.push('toxic+');
    
    detailsHtml += `
      <div style="padding:14px; margin-bottom:12px; border:1px solid #2a3145; border-radius:8px; background:#0c0e14;">
        <div style="margin-bottom:8px;">
          <span style="font-weight:bold;">#${rank}</span>
          <span class="pill" style="margin-left:8px; font-size:11px;">score: ${score}</span>
        </div>
        <div style="line-height:1.5; margin-bottom:10px; font-size:1.05em;">${r.text}</div>
        <div class="muted" style="font-size:11px; margin-bottom:8px;">— ${author}</div>
        ${metaPills.length > 0 ? `
          <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;">
            ${metaPills.map(pill => `<span class="pill" style="font-size:10px; padding:3px 8px;">${pill}</span>`).join('')}
          </div>
        ` : ''}
        ${flags.length > 0 ? `
          <div style="display:flex; flex-wrap:wrap; gap:4px;">
            ${flags.map(flag => `<span class="pill" style="font-size:10px; padding:3px 8px; background:#2a1a1a; border-color:#5a3145;">⚠️ ${flag}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  });
  
  detailsHtml += '</div>';
  detailsBox.innerHTML = detailsHtml;
  
  // Stocker le contexte pour référence
  LAST_CTX = ctx;
  
  // Sauvegarder l'ID de la citation affichée dans l'historique
  if(results && results.length > 0 && results[0].id){
    pushSeen(results[0].id);
  }
}

(async function init(){
  // Init prefs defaults (sans déclencher l'onboarding comme "fait")
  const prefs=getJ(STORAGE.prefs);
  if(typeof prefs.energyCap!=="number") prefs.energyCap=2;
  if(typeof prefs.tonePref!=="string") prefs.tonePref="";
  setJ(STORAGE.prefs,prefs);
  updateSubtitle();

  // Charger les citations sans bloquer le branchement des interactions UI
  ALL=[];
  ALL_LOADED=false;
  ALL_LOAD_ERROR=null;
  loadJSON("citations.json")
    .then((data)=>{
      ALL=Array.isArray(data)?data:[];
      ALL_LOADED=true;
    })
    .catch((err)=>{
      ALL_LOAD_ERROR=String(err && err.message ? err.message : err);
      console.error("Erreur chargement citations.json:", err);
    });

  // UI: onboarding vs main
  const completed=hasCompletedOnboarding(getJ(STORAGE.prefs));
  show(qs("onboardingScreen"),!completed);
  show(qs("mainScreen"),completed);
  qs("btnOpenSettings").style.visibility = completed ? "visible" : "hidden";

  // Flow séquentiel: besoin -> humeur -> bouton
  if(qs("need")) qs("need").value="";
  if(qs("mood")) qs("mood").value="";
  resetQuoteUI();
  if(qs("moodStep")) qs("moodStep").style.display="none";
  if(qs("quoteActionRow")) qs("quoteActionRow").style.display="none";
  setQuestionFlowVisible(true);

  // Settings open/close
  on("btnOpenSettings","click",()=>{
    syncPrefsIntoSettings();
    openSettings();
  });
  on("btnCloseSettings","click",closeSettings);
  on("settingsOverlay","click",closeSettings);

  // Onboarding
  on("btnFinishOnboarding","click",()=>{
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
  on("btnSaveSettings","click",()=>{
    const tone=qs("setTone").value||"";
    const energy=parseInt(qs("setEnergy").value||"2",10);
    const mode=qs("setMode").value||"regles";
    const apiKey=qs("setApiKey")?.value?.trim();
    
    if(!tone){
      alert("Choisis un ton.");
      return;
    }
    
    // Sauvegarder la clé API si elle est fournie
    if(apiKey && apiKey.length > 0){
      try {
        OpenAI.setApiKey(apiKey);
      } catch(err) {
        alert(`Erreur clé API: ${err.message}`);
        return;
      }
    }
    
    const p=getJ(STORAGE.prefs);
    p.tonePref=tone;
    p.energyCap=clamp(energy,1,3);
    p.mode=mode;
    setJ(STORAGE.prefs,p);
    updateSubtitle();
    closeSettings();
  });
  
  // Afficher/masquer la config OpenAI selon le mode sélectionné
  on("setMode","change",()=>{
    const mode = qs("setMode").value;
    const openaiConfig = qs("openaiConfig");
    if(openaiConfig){
      openaiConfig.style.display = mode === "openai" ? "block" : "none";
    }
  });

  // Main flow
  // Sélection du besoin (chips + cards + quiz)
  document.querySelectorAll("[data-need]").forEach((btn)=>{
    btn.addEventListener("click",()=>{
      const need = btn.getAttribute("data-need") || "";
      if(!need) return;

      if(qs("need")) qs("need").value = need;
      setSelectedByDataAttr("data-need", need);

      // On passe à l'étape humeur
      if(qs("moodStep")) qs("moodStep").style.display = "block";

      // Reset humeur + action tant que l'humeur n'est pas choisie
      if(qs("mood")) qs("mood").value = "";
      clearSelectedByDataAttr("data-mood");
      if(qs("quoteActionRow")) qs("quoteActionRow").style.display = "none";

      // Si on change de besoin après avoir vu une citation, on cache l'ancienne
      resetQuoteUI();
    });
  });

  // Sélection de l'humeur
  document.querySelectorAll("[data-mood]").forEach((btn)=>{
    btn.addEventListener("click",()=>{
      const mood = btn.getAttribute("data-mood") || "";
      if(!mood) return;
      if(qs("mood")) qs("mood").value = mood;
      setSelectedByDataAttr("data-mood", mood);
      if(qs("quoteActionRow")) qs("quoteActionRow").style.display = "flex";
      resetQuoteUI();
    });
  });

  on("btnGetQuote","click", async ()=>{
    const p=getJ(STORAGE.prefs);
    if(!hasCompletedOnboarding(p)){
      show(qs("onboardingScreen"),true);
      show(qs("mainScreen"),false);
      qs("btnOpenSettings").style.visibility="hidden";
      return;
    }
    const ctx=ctxFromUI();
    // Fallback: si les champs unifiés sont vides, essayer de les récupérer depuis le DOM (élément visible sélectionné)
    if(!(ctx.questionLabel && ctx.questionLabel.trim()) || !(ctx.questionText && ctx.questionText.trim())){
      const visibleVariant = document.querySelector('.question-variant:not(.hidden), .need-variant:not(.hidden), .mood-variant:not(.hidden)');
      if(visibleVariant){
        const selectedLabelEl = visibleVariant.querySelector('.selected .label') || visibleVariant.querySelector('.label');
        const h1 = visibleVariant.querySelector('h1');
        if(!ctx.questionLabel && selectedLabelEl){
          ctx.questionLabel = selectedLabelEl.textContent.trim();
        }
        if(!ctx.questionText && h1){
          ctx.questionText = h1.textContent.trim();
        }
        // Miroir: pousser dans les inputs cachés
        const ql = qs('questionLabel');
        const qt = qs('questionText');
        if(ql) ql.value = ctx.questionLabel || '';
        if(qt) qt.value = ctx.questionText || '';
      }
    }
    const mode = getMode(p);
    const hasUnifiedQuestion = Boolean((ctx.questionLabel && ctx.questionLabel.trim()) || (ctx.questionText && ctx.questionText.trim()));
    
    // Mode OpenAI: génération IA (ajouter texte libre optionnel)
    if(mode === 'openai'){
      await handleOpenAIMode(ctx, ctx.freeText || null);
      return;
    }
    
    // Mode RAG: recherche sémantique
    if(mode === 'rag'){
      await handleRAGMode(ctx, ctx.freeText || null);
      return;
    }

    // Mode règles: si on a la nouvelle question unifiée, on bascule vers RAG.
    if(mode === 'regles' && hasUnifiedQuestion){
      await handleRAGMode(ctx, ctx.freeText || null);
      return;
    }

    // Mode règles: moteur classique (fallback legacy)
    if(!ctx.need || !ctx.mood){
      alert("Choisis une option ci-dessus pour continuer.");
      return;
    }
    if(!ensureCitationsReady()) return;

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

  // Mode RAG: texte libre
  on("btnGetQuoteRAG", "click", async ()=>{
    const p=getJ(STORAGE.prefs);
    if(!hasCompletedOnboarding(p)){
      show(qs("onboardingScreen"),true);
      show(qs("mainScreen"),false);
      qs("btnOpenSettings").style.visibility="hidden";
      return;
    }
    
    const freeText = qs("ragFreeTextInput")?.value?.trim();
    if(!freeText){
      alert("Écris quelque chose pour que je puisse t'aider.");
      return;
    }

    const ctx = ctxFromUI();
    ctx.tonePref = p.tonePref || "";
    ctx.energyCap = String(p.energyCap || 3);

    const mode = getMode(p);

    // Mode OpenAI: génération IA avec texte libre
    if(mode === 'openai'){
      await handleOpenAIMode(ctx, freeText);
      return;
    }

    // Mode RAG avec texte libre
    await handleRAGMode(ctx, freeText);
  });

  // Suggestion chips: remplir le texte libre
  document.querySelectorAll(".suggestion-chip").forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      const suggestion = btn.getAttribute("data-suggestion");
      const textarea = qs("ragFreeTextInput");
      if(textarea){
        textarea.value = suggestion;
        textarea.focus();
      }
    });
  });

  // Toggle détails
  on("btnToggleDetails","click",()=>{
    const box=qs("detailsBox");
    const open=box.style.display!=="none";
    box.style.display=open?"none":"block";
    qs("btnToggleDetails").textContent=open?"Détails":"Masquer";
  });

  // Feedback
  on("btnUp","click",()=>{
    if(!CURRENT) return;
    feedback(CURRENT,"up");
    alert("👍 Noté.");
  });

  on("btnMid","click",()=>{
    if(!CURRENT) return;
    feedback(CURRENT,"mid");
    alert("😐 Noté.");
  });

  on("btnDown","click",()=>{
    if(!CURRENT) return;
    feedback(CURRENT,"down");

    const wantsAnother=confirm("Ok — tu en veux une autre ?");
    if(!wantsAnother) return;

    if(!ensureCitationsReady()) return;

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