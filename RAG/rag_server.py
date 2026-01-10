#!/usr/bin/env python3
"""
Serveur RAG minimaliste pour la recherche sémantique de citations.
Expose une API /search qui prend une query et retourne le top-N citations.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from sentence_transformers import SentenceTransformer
import chromadb
import json
from pathlib import Path
from typing import List, Dict, Tuple
import sys

app = Flask(__name__)
CORS(app)  # Permet les requêtes cross-origin depuis le front

# Configuration
EMBEDDER_MODEL = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
COLLECTION_NAME = "citations_mvp"
TOP_K_RETRIEVAL = 5  # Simplifié: pas de reranking
TOP_K_FINAL = 5

# Chargement global (au démarrage du serveur)
print("🔄 Chargement des modèles...", file=sys.stderr)
embedder = SentenceTransformer(EMBEDDER_MODEL)
print("✅ Modèles chargés", file=sys.stderr)

# Initialisation ChromaDB + indexation
print("🔄 Indexation des citations...", file=sys.stderr)
# Utiliser le dataset demandé par l'utilisateur
citations_path = Path(__file__).resolve().parents[1] / "2000_citations_hasard.json"
print(f"📂 Fichier: {citations_path}", file=sys.stderr)
with open(citations_path, 'r', encoding='utf-8') as f:
    data = json.load(f)
    citations = data if isinstance(data, list) else data.get("quotes", [])

# Garantir IDs uniques
seen_ids = {}
for idx, quote in enumerate(citations):
    base_id = quote.get("id")
    if base_id in (None, ""):
        base_id = f"cit_{idx}"
    
    dup_index = seen_ids.get(base_id, 0)
    seen_ids[base_id] = dup_index + 1
    
    quote_id = base_id if dup_index == 0 else f"{base_id}__dup{dup_index}"
    quote["id"] = quote_id

# Fonction d'enrichissement avec tags + contexte pour optimiser la similitude
def create_enriched_text(quote: Dict) -> str:
    """Enrichit le texte avec priorité: contexte > tags > text > author pour matching émotionnel."""
    text = (quote.get("Citation") or quote.get("text") or "").strip()
    author = (quote.get("Auteur") or quote.get("author") or "").strip()
    context = (quote.get("context") or quote.get("contexte") or "").strip()

    tags = quote.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    if not isinstance(tags, list):
        tags = []
    tags_norm = [str(t).strip().lower() for t in tags if str(t).strip()]

    # Ordre optimisé pour requêtes émotionnelles/narratives
    parts = []
    if context:
        parts.append(f"Contexte: {context}")
    if tags_norm:
        parts.append(f"Tags: {', '.join(tags_norm)}")
    if text:
        parts.append(text)
    if author:
        parts.append(f"Auteur: {author}")

    return "\n".join(parts)

# Indexation
client = chromadb.Client()
try:
    client.delete_collection(name=COLLECTION_NAME)
except:
    pass

collection = client.create_collection(
    name=COLLECTION_NAME,
    metadata={"description": "Citations MVP avec recherche sémantique (tags + contexte)"}
)

ids = []
documents = []
metadatas = []
enriched_texts = []

for quote in citations:
    # ID robuste
    qid = quote.get('id')
    if not qid:
        qid = f"cit_{len(ids)}"
    ids.append(str(qid))

    original_text = (quote.get('Citation') or quote.get('text') or '')
    documents.append(original_text)

    # Métadonnées avec texte original + attributs utiles
    author = (quote.get("Auteur") or quote.get("author") or "")
    context = (quote.get("context") or quote.get("contexte") or "")
    tags = quote.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    if not isinstance(tags, list):
        tags = []
    # Convertir tags en string (ChromaDB ne supporte pas les listes en métadonnées)
    tags_str = ", ".join([str(t).strip() for t in tags if str(t).strip()])

    metadatas.append({
        "author": author,
        "tags": tags_str,
        "context": context,
        "original_text": original_text
    })

    enriched_texts.append(create_enriched_text(quote))

# Encoder les textes ENRICHIS
embeddings = embedder.encode(enriched_texts, show_progress_bar=False)
# Stocker les textes enrichis pour maintenir la cohérence avec les embeddings
collection.add(
    ids=ids,
    embeddings=embeddings.tolist(),
    documents=enriched_texts,  # ✅ Textes enrichis pour cohérence sémantique
    metadatas=metadatas
)

print(f"✅ {len(citations)} citations indexées", file=sys.stderr)

@app.route('/search', methods=['POST'])
def search():
    """
    API de recherche sémantique.
    Body JSON: { 
        "query": "phrase de recherche", 
        "top_k": 5,
        "exclude_ids": ["id1", "id2", ...]  # IDs à exclure (citations déjà vues)
    }
    Retourne: { "results": [{ "id", "text", "score", "metadata" }, ...] }
    """
    try:
        data = request.get_json()
        query = data.get("query", "").strip()
        top_k = data.get("top_k", TOP_K_FINAL)
        exclude_ids = data.get("exclude_ids", [])
        
        if not query:
            return jsonify({"error": "Query manquante"}), 400
        
        # Valider exclude_ids
        if not isinstance(exclude_ids, list):
            exclude_ids = []
        exclude_ids_set = set(str(x) for x in exclude_ids if x)
        
        # Phase 1: Retrieval vectoriel
        # On récupère plus de résultats pour compenser les exclusions
        retrieval_count = min(TOP_K_RETRIEVAL + len(exclude_ids_set), len(citations))
        
        query_embedding = embedder.encode([query])[0]
        results = collection.query(
            query_embeddings=[query_embedding.tolist()],
            n_results=retrieval_count
        )
        
        ids_list = results['ids'][0]
        documents_list = results['documents'][0]
        metadatas_list = results['metadatas'][0]
        distances_list = results.get('distances', [[]])[0]  # Récupérer les distances
        
        # Filtrer les IDs exclus
        filtered = []
        for i, (quote_id, doc, meta) in enumerate(zip(ids_list, documents_list, metadatas_list)):
            if quote_id not in exclude_ids_set:
                # Calculer le score de similarité depuis la distance L2 au carré
                # ChromaDB retourne des distances L2 squared (au carré)
                # Conversion en similarité : similarity ≈ 1 / (1 + distance)
                distance = distances_list[i] if i < len(distances_list) else float('inf')
                similarity_score = 1.0 / (1.0 + distance) if distance < float('inf') else 0.0
                filtered.append((quote_id, doc, meta, similarity_score))
        
        # Pas de reranking pour le MVP: utiliser directement les top-k résultats chromadb
        if not filtered:
            return jsonify({"results": []}), 200
        
        # Formatter la réponse
        results_out = []
        for quote_id, text, metadata, score in filtered[:top_k]:
            # Utiliser le texte original pour l'affichage, pas le texte enrichi
            display_text = metadata.get('original_text', text)
            results_out.append({
                "id": quote_id,
                "text": display_text,
                "score": round(score, 4),
                "metadata": {
                    "author": metadata.get('author', ''),
                    "tags": metadata.get('tags', ''),  # String séparé par des virgules
                    "context": metadata.get('context', '')
                }
            })
        
        return jsonify({"results": results_out})
    
    except Exception as e:
        print(f"❌ Erreur: {e}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({"status": "ok", "citations_count": len(citations)})

if __name__ == '__main__':
    print("\n🚀 Serveur RAG démarré sur http://localhost:5001", file=sys.stderr)
    print("📍 Endpoint: POST /search avec { \"query\": \"...\" }\n", file=sys.stderr)
    app.run(host='127.0.0.1', port=5001, debug=False)
