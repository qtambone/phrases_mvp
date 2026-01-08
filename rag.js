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
 * @param {Object} filters - { questionLabel, questionText }
 * @returns {string} - Phrase optimisée pour la recherche sémantique
 */
export function buildSearchQuery(filters) {
  const {
    questionLabel,
    questionText
  } = filters || {};

  function norm(str) {
    return (str || "").trim();
  }

  const label = norm(questionLabel);
  const question = norm(questionText);

  // Si on a un label, on l'utilise tel quel ou on l'adapte légèrement
  if (label) {
    // Si le label commence par "me " ou "m'" (forme verbale)
    if (label.match(/^(m'|me )/i)) {
      return `Une citation qui ${label}.`;
    }
    // Sinon retourner le label tel quel
    return label;
  }

  // Fallback : si aucun label, retourner une phrase générique
  return "Une citation qui pourrait m'aider.";
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
