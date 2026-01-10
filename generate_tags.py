#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
----------------
Lit 2000_citations_hasard.json (format liste d'objets),
prend les 100 premières citations, et génère des tags via 1 appel LLM par citation.
Les tags sont ajoutés directement dans le fichier source au fur et à mesure.

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

MODEL = "gpt-4o-mini"  # bon rapport qualité/prix pour tagging
SLEEP_SEC = 0.1        # pour éviter de taper trop vite (ajuste si besoin)
MAX_RETRIES = 3
key = "sk-PLACEHOLDER"

client = OpenAI(api_key=key)

JSON_SCHEMA = {
    "name": "citation_tags",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "tags": {
                "type": "array",
                "minItems": 3,
                "maxItems": 8,
                "items": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 32
                }
            }
        },
        "required": ["tags"]
    }
}

def normalize_tags(tags: List[str]) -> List[str]:
    # Normalisation légère (tu pourras renforcer ensuite)
    out = []
    seen = set()
    for t in tags:
        if not isinstance(t, str):
            continue
        t2 = " ".join(t.strip().lower().split())
        if not t2:
            continue
        if t2 in seen:
            continue
        seen.add(t2)
        out.append(t2)
    # sécurité: clamp
    return out[:8]

def build_prompt(citation: str, auteur: str) -> str:
    # Prompt très cadré pour éviter dérives et tags vagues
    return f"""
Tu es un annotateur de citations FR. Génère des TAGS uniquement.

RÈGLES STRICTES:
- Nombre: 3 à 8 tags MAXIMUM, pas obligé d'en mettre 8 si moins suffisent ! (qualité > quantité)
- Langue: français, minuscules uniquement

CRITÈRES QUALITES STRICTS:
- UNIQUEMENT les tags pertinents et distinctifs, un tag doit capturer un concept sémantique CLÉ et SPÉCIFIQUE de la citation
- AUCUN tag redondant ou synonymes proches, exemple "amour" + "affection" → NON
- AUCUN tag vagues ou génériques qui s'appliquent à toute citation comme : "vie", "chose", "pensée", "réflexion", "gens", "monde"

EXEMPLE:
Citation: "Le courage n'est pas l'absence de peur, mais la capacité de la vaincre"
MAUVAIS:
Tags: vie, chose, gens, réflexion, pensée (trop vagues)
BON:
Tags: courage, peur, dépassement de soi

Citation: {citation}
Auteur: {auteur}

Génère UNIQUEMENT les tags vraiment essentiels pour retrouver cette citation.
""".strip()

def call_llm_for_tags(citation: str, auteur: str) -> List[str]:
    prompt = build_prompt(citation, auteur)

    # Chat Completions API avec Structured Outputs (JSON Schema strict)
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

    # Le contenu de la réponse est dans resp.choices[0].message.content
    output_text = resp.choices[0].message.content
    data = json.loads(output_text)
    tags = data["tags"]
    return normalize_tags(tags)

def main():

    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    first_2000_indices = list(range(min(2000, len(items))))

    for idx in first_2000_indices:
        row = items[idx]
        cid = row.get("id")
        citation = row.get("Citation", "")
        auteur = row.get("Auteur", "")

        # Skip si déjà taggé
        if "tags" in row and row["tags"]:
            print(f"[{idx+1:04d}/2000] id={cid} ⏭️  déjà taggé")
            continue

        if not citation:
            row["tags"] = []
            row["tags_error"] = "missing_citation"
            print(f"[{idx+1:04d}/2000] id={cid} ⚠️  citation vide")
        else:
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    tags = call_llm_for_tags(citation, auteur)
                    row["tags"] = tags
                    if "tags_error" in row:
                        del row["tags_error"]
                    print(f"[{idx+1:04d}/2000] id={cid} tags={tags}")
                    break
                except Exception as e:
                    if attempt == MAX_RETRIES:
                        row["tags"] = []
                        row["tags_error"] = str(e)
                        print(f"[{idx+1:04d}/2000] id={cid} ❌ error={e}")
                    else:
                        time.sleep(0.8 * attempt)

        # Sauvegarde après chaque citation
        with open(INPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        
        time.sleep(SLEEP_SEC)

    print(f"\n✅ Fini. Tags ajoutés dans {INPUT_PATH}")

if __name__ == "__main__":
    main()
