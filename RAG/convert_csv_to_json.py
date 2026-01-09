#!/usr/bin/env python3
"""
Convertit citations_nettoyee_fr.csv en citations.json
Format simple: id, text, author, category
"""

import csv
import json
from pathlib import Path

# Chemins
csv_path = Path(__file__).resolve().parents[1] / "citations_nettoyee_fr.csv"
json_path = Path(__file__).resolve().parents[1] / "citations.json"

print(f"📖 Lecture du CSV: {csv_path}")
print(f"💾 Destination JSON: {json_path}")

citations = []
row_count = 0

# Lire le CSV
with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for idx, row in enumerate(reader, start=1):
        row_count = idx
        
        citation_text = (row.get('Citation') or '').strip()
        author = (row.get('Auteur') or '').strip()
        category = (row.get('Catégorie') or '').strip()
        
        # Ignorer les lignes vides
        if not citation_text:
            continue
        
        cite = {
            "id": str(idx),
            "text": citation_text,
            "author": author,
            "category": category
        }
        
        citations.append(cite)
        
        # Progress
        if idx % 10000 == 0:
            print(f"  ✓ {idx} citations traitées...")

print(f"✅ {len(citations)} citations chargées (sur {row_count} lignes)")

# Sauvegarder en JSON
with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(citations, f, ensure_ascii=False, indent=2)

print(f"✅ Fichier sauvegardé: {json_path}")
print("\n🚀 Prochaine étape: redémarrer le serveur RAG")
print("   cd RAG && python rag_server.py")
