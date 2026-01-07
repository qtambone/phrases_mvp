/**
 * Module OpenAI - Génération de citations personnalisées via API OpenAI.
 * Génère des citations uniques basées sur le contexte utilisateur.
 */

import { buildSearchQuery } from './rag.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Option 1: clé injectée via build/bundler (.env, import.meta.env, process.env, ou variable globale)
const ENV_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.OPENAI_API_KEY) ||
  (typeof process !== 'undefined' && process.env && process.env.OPENAI_API_KEY) ||
  (typeof window !== 'undefined' && window.__OPENAI_API_KEY);

/**
 * Génère une citation personnalisée via OpenAI.
 * @param {Object} context - Contexte utilisateur (need, mood, ton, energy, freeText)
 * @param {Array} seenQuotes - Liste des citations déjà vues (pour éviter les répétitions)
 * @returns {Promise<Object>} - { text: string, metadata: object }
 */
export async function generateQuote(context, seenQuotes = []) {
  // Préférence à la clé injectée par l'environnement; fallback sur localStorage configuré via l'UI
  const apiKey = (ENV_API_KEY && ENV_API_KEY.trim()) || localStorage.getItem('openai_api_key');
  
  if (!apiKey) {
    throw new Error('Clé API OpenAI manquante. Configure-la dans les paramètres.');
  }

  // Construire le prompt
  const prompt = buildPrompt(context, seenQuotes);

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Erreur API: ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    
    if (!text) {
      throw new Error('Aucune réponse générée par OpenAI');
    }

    return {
      text,
      promptSent: prompt,
      metadata: {
        source: 'openai',
        model: 'gpt-4o-mini',
        generatedAt: new Date().toISOString(),
        context: {
          tone: context.tonePref,
          energy: context.energyCap
        }
      }
    };
  } catch (error) {
    console.error('[OpenAI] Erreur de génération:', error);
    throw error;
  }
}

/**
 * Construit le prompt système pour OpenAI.
 */
function getSystemPrompt() {
  return `Tu es un expert en phrases/citations. Ta mission est de créer ou d'adapter une citation courte (maximum 2 phrases) qui répond au besoin de l'utilisateur.

RÈGLES IMPORTANTES:
- Elle doit résonner avec l'état émotionnel et le besoin exprimé
- Pas de ton moralisateur ou culpabilisant
- Pas d'injonctions ("tu dois", "il faut")
- Si possible, cite l'auteur de la citation (ou indique "Anonyme" si c'est une création originale)

FORMAT DE RÉPONSE:
Renvoie UNIQUEMENT la citation, suivie d'un tiret et de l'auteur sur une nouvelle ligne:
"[Citation]"
— [Auteur ou Anonyme]`;
}

/**
 * Construit le prompt utilisateur basé sur le contexte.
 */
function buildPrompt(context, seenQuotes) {
  let prompt = '';

  // Mode texte libre (plus direct)
  if (context.freeText) {
    prompt = `L'utilisateur a écrit:\n"${context.freeText}"\n\n`;
    prompt += `Trouve ou crée une citation courte qui lui parlerait en ce moment.`;
  } 
  // Mode classique (besoin + humeur)
  else {
    // Reutiliser la même fabrication de requête que le mode RAG
    const query = buildSearchQuery({
      needLabel: context.needLabel,
      moodLabel: context.moodLabel,
      needQuestion: context.needQuestion,
      moodQuestion: context.moodQuestion,
    });

    prompt = `Indications données par l'utilisateur :\n${query}\n\n`;
  }

  // Ajouter le ton préféré si spécifié
  const toneDescriptions = {
    accompagnant: 'doux et accompagnant',
    neutre: 'neutre et simple',
    direct: 'direct et franc',
    stoïque: 'stoïque et posé',
    poétique: 'poétique et imagé'
  };

  if (context.tonePref && toneDescriptions[context.tonePref]) {
    prompt += `\n\nTon souhaité: ${toneDescriptions[context.tonePref]}.`;
  }

  // Ajouter les citations déjà vues (pour éviter les répétitions)
  if (seenQuotes && seenQuotes.length > 0) {
    const recentQuotes = seenQuotes.slice(-10); // Dernières 10 seulement
    if (recentQuotes.length > 0) {
      prompt += `\n\nÉvite de proposer des citations similaires à celles-ci (déjà vues):\n`;
      recentQuotes.forEach((q, i) => {
        prompt += `${i + 1}. "${q}"\n`;
      });
    }
  }

  return prompt;
}

/**
 * Vérifie si la clé API est configurée.
 */
export function hasApiKey() {
  const key = localStorage.getItem('openai_api_key');
  return Boolean(key && key.trim().length > 0);
}

/**
 * Configure la clé API OpenAI.
 */
export function setApiKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Clé API invalide');
  }
  localStorage.setItem('openai_api_key', key.trim());
}

/**
 * Récupère la clé API (masquée pour affichage).
 */
export function getApiKeyMasked() {
  const key = localStorage.getItem('openai_api_key');
  if (!key) return '';
  return key.slice(0, 7) + '...' + key.slice(-4);
}
