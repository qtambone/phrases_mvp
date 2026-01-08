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

// Utilitaires de gestion de la clé API exposés au module
export function hasApiKey() {
  try {
    const key = (ENV_API_KEY && ENV_API_KEY.trim()) || localStorage.getItem('openai_api_key');
    return Boolean(key && key.trim());
  } catch {
    return Boolean(ENV_API_KEY && ENV_API_KEY.trim());
  }
}

export function setApiKey(apiKey) {
  const k = (apiKey || '').trim();
  if (!k) throw new Error('Clé API vide.');
  // Optionnel: légère validation de format
  if (!/^sk-[A-Za-z0-9]/.test(k)) {
    // On accepte tout de même, mais on informe
    console.warn('[OpenAI] Format de clé inhabituel. Assure-toi qu’elle est valide.');
  }
  try {
    localStorage.setItem('openai_api_key', k);
  } catch (e) {
    console.error('[OpenAI] Impossible de stocker la clé API dans localStorage:', e);
    throw new Error('Stockage local impossible.');
  }
}

export function getApiKeyMasked() {
  try {
    const stored = (localStorage.getItem('openai_api_key') || '').trim();
    const effective = stored || (ENV_API_KEY && ENV_API_KEY.trim()) || '';
    if (!effective) return '';
    // Masque: garder le préfixe éventuel (sk-) et les 4 derniers caractères
    const prefix = effective.startsWith('sk-') ? 'sk-' : '';
    const tail = effective.slice(-4);
    return `${prefix}••••••••••••••••${tail}`;
  } catch {
    const effective = (ENV_API_KEY && ENV_API_KEY.trim()) || '';
    if (!effective) return '';
    const tail = effective.slice(-4);
    return `••••••••••••••••${tail}`;
  }
}

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
  return `Tu es un expert en phrases/citations. Ta mission est de créer ou d'adapter une citation courte (maximum 2 phrases) qui répond finement au contexte utilisateur.

PRIORITÉ:
- Si un texte libre est fourni, il PRIME sur les autres indices. Utilise-le pour personnaliser la citation.

RÈGLES IMPORTANTES:
- La citation doit résonner avec l'état émotionnel et le besoin exprimé
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
  const label = (context.questionLabel || '').trim();
  const question = (context.questionText || '').trim();
  const freeText = (context.freeText || '').trim();
  const synthesized = buildSearchQuery({ questionLabel: label, questionText: question });

  const toneDescriptions = {
    accompagnant: 'doux et accompagnant',
    neutre: 'neutre et simple',
    direct: 'direct et franc',
    stoïque: 'stoïque et posé',
    poétique: 'poétique et imagé'
  };

  let prompt = '';

  // Contexte
  prompt += `Contexte utilisateur:\n`;
  if (question) prompt += `- Question: ${question}\n`;
  if (label) prompt += `- Sélection: ${label}\n`;
  if (synthesized) prompt += `- Intention: ${synthesized}\n`;
  if (freeText) prompt += `- Texte libre: "${freeText}"\n`;

  // Objectif
  prompt += `\nObjectif:\n- Composer une citation courte (≤ 2 phrases) qui répond à ce contexte, en PRIORISANT le texte libre s'il est présent.\n`;

  // Contraintes
  const constraints = [];
  if (context.tonePref && toneDescriptions[context.tonePref]) {
    constraints.push(`Ton souhaité: ${toneDescriptions[context.tonePref]}`);
  }
  if (context.energyCap) {
    constraints.push(`Énergie max: ${context.energyCap} (respecter ce garde-fou)`);
  }
  constraints.push('Sans injonctions ni culpabilisation');
  if (constraints.length > 0) {
    prompt += `\nContraintes:\n- ${constraints.join('\n- ')}\n`;
  }

  // Format
  prompt += `\nFormat attendu:\n"[Citation]"\n— [Auteur ou Anonyme]\n`;

  // Éviter redites
  if (seenQuotes && seenQuotes.length > 0) {
    const recentQuotes = seenQuotes.slice(-10);
    if (recentQuotes.length > 0) {
      prompt += `\nÉvite des citations trop proches de celles déjà vues:\n`;
      recentQuotes.forEach((q, i) => {
        prompt += `${i + 1}. "${q}"\n`;
      });
    }
  }

  return prompt.trim();
}
