#!/usr/bin/env python3
"""
Serveur RAG minimaliste pour la recherche sémantique de citations.
Expose une API /search qui prend une query et retourne le top-N citations.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from sentence_transformers import SentenceTransformer, CrossEncoder
import chromadb
import json
from pathlib import Path
from typing import List, Dict, Tuple
import sys

app = Flask(__name__)
CORS(app)  # Permet les requêtes cross-origin depuis le front

# Configuration
EMBEDDER_MODEL = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
RERANKER_MODEL = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
COLLECTION_NAME = "citations_mvp"
TOP_K_RETRIEVAL = 20
TOP_K_FINAL = 5

# Chargement global (au démarrage du serveur)
print("🔄 Chargement des modèles...", file=sys.stderr)
embedder = SentenceTransformer(EMBEDDER_MODEL)
reranker = CrossEncoder(RERANKER_MODEL)
print("✅ Modèles chargés", file=sys.stderr)

# Initialisation ChromaDB + indexation
print("🔄 Indexation des citations...", file=sys.stderr)
citations_path = Path(__file__).resolve().parents[1] / "citations.json"
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

# Fonction d'enrichissement (identique à test_rag.py)
def create_enriched_text(quote: Dict) -> str:
    text = (quote.get("text") or "").strip()
    author = (quote.get("author") or "").strip()
    need = (quote.get("need") or "").strip()
    mood = (quote.get("mood") or "").strip()
    tone = (quote.get("tone") or "").strip()
    length = (quote.get("length") or "").strip()
    language = (quote.get("language") or "").strip()
    
    energy = quote.get("energy", "")
    if energy is None:
        energy = ""
    energy = str(energy).strip()
    
    parts = []
    if text:
        parts.append(text)
    if author:
        parts.append(f"Auteur: {author}")
    if need:
        parts.append(f"Besoin: {need}")
    if mood:
        parts.append(f"Humeur: {mood}")
    if tone:
        parts.append(f"Ton: {tone}")
    if energy:
        parts.append(f"Énergie: {energy}")
    if length:
        parts.append(f"Longueur: {length}")
    if language:
        parts.append(f"Langue: {language}")
    
    is_injunctive = quote.get("is_injunctive")
    if is_injunctive is True:
        parts.append("Style: injonctif")
    elif is_injunctive is False:
        parts.append("Style: non-injonctif")
    
    if quote.get("is_guilt_inducing") is True:
        parts.append("Évite: culpabilisant")
    if quote.get("is_toxic_positive") is True:
        parts.append("Évite: positivité toxique")
    
    return " | ".join(parts)

# Indexation
client = chromadb.Client()
try:
    client.delete_collection(name=COLLECTION_NAME)
except:
    pass

collection = client.create_collection(
    name=COLLECTION_NAME,
    metadata={"description": "Citations MVP avec recherche sémantique"}
)

ids = []
documents = []
metadatas = []
enriched_texts = []

for quote in citations:
    ids.append(quote['id'])
    documents.append(quote.get('text', ''))
    
    energy = quote.get("energy")
    try:
        energy = -1 if energy is None else int(energy)
    except:
        energy = -1
    
    tags = quote.get("tags") or []
    if isinstance(tags, list):
        tags = ", ".join([str(t).strip() for t in tags if str(t).strip()])
    elif tags is None:
        tags = ""
    else:
        tags = str(tags)
    
    metadatas.append({
        "author": (quote.get("author") or ""),
        "need": (quote.get("need") or ""),
        "mood": (quote.get("mood") or ""),
        "tone": (quote.get("tone") or ""),
        "length": (quote.get("length") or ""),
        "energy": energy,
        "is_injunctive": bool(quote.get("is_injunctive", False)),
        "is_guilt_inducing": bool(quote.get("is_guilt_inducing", False)),
        "is_toxic_positive": bool(quote.get("is_toxic_positive", False)),
        "language": (quote.get("language") or ""),
        "tags": tags,
    })
    
    enriched_texts.append(create_enriched_text(quote))

embeddings = embedder.encode(enriched_texts, show_progress_bar=False)
collection.add(
    ids=ids,
    embeddings=embeddings.tolist(),
    documents=documents,
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
        
        # Filtrer les IDs exclus
        filtered = []
        for quote_id, doc, meta in zip(ids_list, documents_list, metadatas_list):
            if quote_id not in exclude_ids_set:
                filtered.append((quote_id, doc, meta))
        
        # Phase 2: Reranking (uniquement sur les résultats filtrés)
        if not filtered:
            return jsonify({"results": []}), 200
        
        ids_filtered, docs_filtered, metas_filtered = zip(*filtered)
        pairs = [[query, doc] for doc in docs_filtered]
        rerank_scores = reranker.predict(pairs)
        
        combined = list(zip(ids_filtered, docs_filtered, metas_filtered, rerank_scores))
        combined.sort(key=lambda x: x[3], reverse=True)
        
        # Formatter la réponse
        results_out = []
        for quote_id, text, metadata, score in combined[:top_k]:
            results_out.append({
                "id": quote_id,
                "text": text,
                "score": float(score),
                "metadata": metadata
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
