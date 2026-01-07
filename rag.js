/**
 * Module RAG - Recherche sémantique de citations via API Python.
 * Expose une fonction search() qui prend une query et retourne les résultats.
 */

const RAG_API_URL = 'http://localhost:5001/search';

/**
 * Recherche sémantique de citations via le serveur RAG.
 * @param {string} query - Phrase de recherche (ex: "j'ai besoin de calme, je me sens stressé")
 * @param {number} topK - Nombre de résultats à retourner (défaut: 5)
 * @param {Array<string>} excludeIds - IDs des citations à exclure (déjà vues)
 * @returns {Promise<Array>} - Liste de citations avec scores
 */
export async function search(query, topK = 5, excludeIds = []) {
  if (!query || typeof query !== 'string') {
    throw new Error('Query invalide');
  }

  try {
    const body = { 
      query, 
      top_k: topK 
    };
    
    // Ajouter les IDs à exclure si fournis
    if (excludeIds && Array.isArray(excludeIds) && excludeIds.length > 0) {
      body.exclude_ids = excludeIds;
    }
    
    const response = await fetch(RAG_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Erreur serveur: ${response.status}`);
    }

    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('[RAG] Erreur de recherche:', error);
    throw error;
  }
}

/**
 * Construit une phrase de recherche à partir des filtres utilisateur.
 * @param {Object} filters - { needLabel, moodLabel, needQuestion, moodQuestion }
 * @returns {string} - Phrase optimisée pour la recherche sémantique
 */
export function buildSearchQuery(filters) {
  const {
    needLabel,
    moodLabel,
    needQuestion,
    moodQuestion
  } = filters || {};

  function norm(str) {
    return (str || "").trim();
  }

  const need = norm(needLabel);
  const mood = norm(moodLabel);
  const qNeed = norm(needQuestion);
  const qMood = norm(moodQuestion);

  let needLine = "";
  let moodLine = "";

  // BESOIN - adapter selon la variante
  if (need) {
    // Variante "scenarios" : question contient "situations"
    if (qNeed.toLowerCase().includes("situations")) {
      needLine = need;
    }
    // Variante "quick" : commence par infinitif (Me, Être, Y voir, Retrouver, Relâcher, Prendre)
    else if (need.match(/^(Me |Être |Y voir|Retrouver|Relâcher|Prendre)/i)) {
      needLine = need.toLowerCase();
    }
    // Variante "quiz" : commence par "m'" ou "me " (effet conjugué)
    else if (need.match(/^(m'|me )/i)) {
      needLine = `Une citation qui ${need}.`;
    }
    // Fallback : garder tel quel
    else {
      needLine = need;
    }
  }

  // HUMEUR - adapter selon la variante
  if (mood) {
    // Variante "weather" : question contient "météo"
    if (qMood.toLowerCase().includes("météo")) {
      moodLine = `Mon humeur: ${mood.toLowerCase()}.`;
    }
    // Variante "phrase" : question contient "complète"
    else if (qMood.toLowerCase().includes("complète")) {
      moodLine = `Je me sens ${mood.toLowerCase()}.`;
    }
    // Variante "quick" : par défaut
    else {
      moodLine = `Je me sens ${mood.toLowerCase()}.`;
    }
  }

  const lines = [needLine, moodLine].filter(Boolean);

  return lines.join("\n");
}

/**
 * Vérifie si le serveur RAG est disponible.
 * @returns {Promise<boolean>}
 */
export async function checkHealth() {
  try {
    const response = await fetch('http://localhost:5001/health', {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}
