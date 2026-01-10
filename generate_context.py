#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Lit 2000_citations_hasard.json et génère le contexte/explication de chaque citation.
Les contextes sont ajoutés directement dans le fichier source au fur et à mesure.

Le contexte explique le SENS de la citation sans inventer d'infos (source, date, anecdote).

Prérequis:
  pip install openai
  export OPENAI_API_KEY="..."
"""

import os
import json
import time
from typing import List, Dict, Any

from openai import OpenAI

INPUT_PATH = "2000_citations_hasard.json"
MODEL = "gpt-4o-mini"
SLEEP_SEC = 0.05
MAX_RETRIES = 3
key = "sk-PLACEHOLDER"

client = OpenAI(api_key=key)

JSON_SCHEMA = {
    "name": "citation_context",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "context": {
                "type": "string",
                "minLength": 50,
                "maxLength": 500
            }
        },
        "required": ["context"]
    }
}

def build_prompt(citation: str, auteur: str) -> str:
    return f"""
Ta tâche est de générer une EXPLICATION COURTE et NEUTRE du sens de la citation,
optimisée pour la recherche sémantique (RAG).

RÈGLES STRICTES :
- Longueur : 1 phrase courte (maximum 2 phrases si nécessaire)
- Explique UNIQUEMENT le SENS et l’IDÉE PRINCIPALE de la citation
- Reformule clairement avec des mots simples et concrets
- Inclure naturellement 3 à 6 termes ou expressions clés proches de ce que
  quelqu’un pourrait réellement rechercher (synonymes, reformulations, situations)
- Style neutre, factuel, explicatif (pas moral, pas littéraire, pas philosophique abstrait)

INTERDICTIONS ABSOLUES :
- NE JAMAIS inventer de source, de date, d’œuvre, de contexte historique
- NE PAS mentionner l’auteur, une époque, un livre, un événement réel
- NE PAS utiliser de formules génériques comme :
  "Cette citation souligne", "Cette phrase montre", "L’auteur explique que"
- NE PAS interpréter au-delà du sens évident (pas de suranalyse)

SI INCERTITUDE :
- Rester volontairement général sur le sens
- Ne rien affirmer de factuel si ce n’est pas explicitement contenu dans la citation

EXEMPLE CORRECT :
Citation : "Être ou ne pas être, telle est la question"
Contexte :
"Dilemme existentiel entre continuer à vivre ou renoncer, exprimant le doute,
le choix fondamental et la réflexion sur le sens de l’existence."

EXEMPLE INCORRECT :
"Cette citation célèbre écrite par Shakespeare dans Hamlet en 1603..."

Citation: {citation}
Auteur: {auteur}

""".strip()

def call_llm_for_context(citation: str, auteur: str) -> str:
    prompt = build_prompt(citation, auteur)

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": JSON_SCHEMA
        }
    )

    output_text = resp.choices[0].message.content
    data = json.loads(output_text)
    context = data["context"]
    return context.strip()

def main():
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    # Traiter TOUTES les citations du fichier test
    first_2000_indices = list(range(len(items)))

    for idx in first_2000_indices:
        row = items[idx]
        cid = row.get("id")
        citation = row.get("Citation", "")
        auteur = row.get("Auteur", "")

        # Skip si déjà a un contexte
        if "context" in row and row["context"]:
            print(f"[{idx+1:04d}] id={cid} ⏭️  contexte déjà présent")
            continue

        if not citation:
            row["context"] = ""
            row["context_error"] = "missing_citation"
            print(f"[{idx+1:04d}] id={cid} ⚠️  citation vide")
        else:
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    context = call_llm_for_context(citation, auteur)
                    row["context"] = context
                    if "context_error" in row:
                        del row["context_error"]
                    print(f"[{idx+1:04d}] id={cid} ✓ contexte généré")
                    break
                except Exception as e:
                    if attempt == MAX_RETRIES:
                        row["context"] = ""
                        row["context_error"] = str(e)
                        print(f"[{idx+1:04d}] id={cid} ❌ error={e}")
                    else:
                        time.sleep(0.8 * attempt)

        # Sauvegarde après chaque citation
        with open(INPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        
        time.sleep(SLEEP_SEC)

    print(f"\n✅ Fini. Contextes ajoutés dans {INPUT_PATH}")

if __name__ == "__main__":
    main()