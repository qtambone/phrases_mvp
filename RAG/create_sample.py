#!/usr/bin/env python3
"""
Crée un échantillon de 5000 citations aléatoires depuis citations.json
"""
import json
import random
from pathlib import Path

# Chemins
citations_path = Path(__file__).resolve().parents[1] / "citations.json"
sample_path = Path(__file__).resolve().parents[1] / "citations_sample.json"

print(f"📖 Lecture de {citations_path}...")
with open(citations_path, 'r', encoding='utf-8') as f:
    data = json.load(f)
    citations = data if isinstance(data, list) else data.get("quotes", [])

print(f"✅ {len(citations)} citations chargées")

# Échantillonner 5000 citations aléatoires
sample_size = min(5000, len(citations))
sample = random.sample(citations, sample_size)

print(f"📝 Création de l'échantillon de {sample_size} citations...")
with open(sample_path, 'w', encoding='utf-8') as f:
    json.dump(sample, f, ensure_ascii=False, indent=2)

print(f"✅ Échantillon créé: {sample_path}")
print(f"   Taille du fichier: {sample_path.stat().st_size / 1024 / 1024:.2f} MB")
