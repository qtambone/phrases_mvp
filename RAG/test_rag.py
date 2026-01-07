#!/usr/bin/env python3
"""
Test RAG pour citations françaises avec ChromaDB.
Évalue la qualité de la recherche sémantique sur les requêtes utilisateur.
"""

import json
import chromadb
from sentence_transformers import SentenceTransformer, CrossEncoder
from typing import List, Dict, Tuple
import time
from pathlib import Path

# Configuration
COLLECTION_NAME = "citations_mvp"
TOP_K_RETRIEVAL = 20  # Nombre de candidats pour le retrieval
TOP_K_FINAL = 5       # Nombre de résultats finaux après reranking

# Modèles (priorité: qualité sémantique FR/multilingue)
# Note: le modèle CamemBERT utilisé précédemment peut être chargé en "MEAN pooling" (moins optimal).
EMBEDDER_MODEL = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
RERANKER_MODEL = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"

# Dataset principal (le fichier est à la racine du repo)
DATASET_FILE = (Path(__file__).resolve().parents[1] / "citations.json")

def load_quotes(filename: str = str(DATASET_FILE)) -> List[Dict]:
    """Charge les citations depuis le fichier JSON."""
    with open(filename, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Formats supportés:
    # 1) Liste directe de citations
    # 2) Objet avec clé "quotes" (format QuoteKG extrait par extract_quotekg_final.py)
    if isinstance(data, list):
        quotes = data
    elif isinstance(data, dict):
        quotes = data.get("quotes") or data.get("citations") or []
    else:
        raise TypeError(f"Format JSON inattendu: {type(data)}")

    if not isinstance(quotes, list):
        raise TypeError(f"La clé 'quotes' doit être une liste, reçu: {type(quotes)}")

    # Garantir un champ id stable ET unique (ChromaDB exige l'unicité)
    normalized: List[Dict] = []
    seen_ids: Dict[str, int] = {}
    for idx, quote in enumerate(quotes):
        if not isinstance(quote, dict):
            raise TypeError(f"Citation invalide à l'index {idx}: {type(quote)}")

        base_id = quote.get("id")
        if base_id in (None, ""):
            base_id = quote.get("uri") or f"quote_{idx}"

        dup_index = seen_ids.get(base_id, 0)
        seen_ids[base_id] = dup_index + 1

        quote_id = base_id if dup_index == 0 else f"{base_id}__dup{dup_index}"
        quote = {**quote, "id": quote_id}

        normalized.append(quote)

    return normalized

def load_test_queries(filename: str = "test_queries.json") -> List[Dict]:
    """Charge les requêtes de test."""
    with open(filename, 'r', encoding='utf-8') as f:
        return json.load(f)

def create_enriched_text(quote: Dict) -> str:
    """
    Crée un texte enrichi pour l'indexation en ajoutant les métadonnées utiles.
    Objectif: maximiser la qualité sémantique (texte + attributs).
    """
    # Supporte plusieurs schémas (citations.json / gpt_quotes_rag.json / quotekg_citations.json)
    text = (quote.get("text") or quote.get("citation") or "").strip()

    author = (quote.get("author") or quote.get("auteur") or "").strip()

    year = quote.get("year")
    if year in (None, ""):
        year = quote.get("annee")
    year = "" if year is None else str(year).strip()

    emotion_category = (quote.get("emotion_category") or "").strip()

    # emotion_intensity peut être str/float/int selon le dataset
    emotion_intensity = quote.get("emotion_intensity", "")
    if emotion_intensity is None:
        emotion_intensity = ""
    emotion_intensity = str(emotion_intensity).strip()

    source = (quote.get("source") or "").strip()
    context = (quote.get("context") or quote.get("contexte") or "").strip()
    tags = quote.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    if not isinstance(tags, list):
        tags = []
    tags = [str(t).strip() for t in tags if str(t).strip()]

    # Format "champ: valeur" (facile à apprendre pour l'embedding)
    # On répète légèrement certains champs importants pour augmenter leur poids sémantique.
    parts = []
    if text:
        parts.append(text)

    if author:
        parts.append(f"Auteur: {author}")
    if year:
        parts.append(f"Année: {year}")

    # Champs spécifiques à citations.json (très utiles pour le matching sémantique)
    need = (quote.get("need") or "").strip()
    mood = (quote.get("mood") or "").strip()
    tone = (quote.get("tone") or "").strip()
    length = (quote.get("length") or "").strip()
    language = (quote.get("language") or "").strip()

    energy = quote.get("energy", "")
    if energy is None:
        energy = ""
    energy = str(energy).strip()

    is_injunctive = quote.get("is_injunctive")
    is_guilt_inducing = quote.get("is_guilt_inducing")
    is_toxic_positive = quote.get("is_toxic_positive")

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

    # Flags: gardés courts (catégories utiles sans trop polluer le texte)
    if is_injunctive is True:
        parts.append("Style: injonctif")
    elif is_injunctive is False:
        parts.append("Style: non-injonctif")

    if is_guilt_inducing is True:
        parts.append("Évite: culpabilisant")
    if is_toxic_positive is True:
        parts.append("Évite: positivité toxique")

    if emotion_category:
        parts.append(f"Émotion: {emotion_category}")
        parts.append(f"Catégorie émotion: {emotion_category}")  # léger boost

    if emotion_intensity:
        parts.append(f"Intensité émotion: {emotion_intensity}")

    # Champs optionnels (très utiles pour le dataset GPT; parfois bruités sur QuoteKG)
    if tags:
        parts.append(f"Tags: {', '.join(tags)}")
    if source:
        parts.append(f"Source: {source}")
    if context:
        # Évite des contextes gigantesques qui peuvent noyer l'embedding
        ctx = context if len(context) <= 600 else (context[:600].rstrip() + "…")
        parts.append(f"Contexte: {ctx}")

    return " | ".join(parts)

def initialize_rag_system() -> Tuple[chromadb.Collection, SentenceTransformer, CrossEncoder]:
    """
    Initialise le système RAG avec:
    - ChromaDB pour le stockage vectoriel
    - SentenceTransformer pour les embeddings français
    - CrossEncoder pour le reranking
    """
    print("Initialisation du système RAG...\n")

    # 1. Charger le modèle d'embedding (optimisé pour le français)
    print(f"Chargement du modèle d'embedding ({EMBEDDER_MODEL})...")
    embedder = SentenceTransformer(EMBEDDER_MODEL)
    print("   OK: Modèle d'embedding chargé\n")

    # 2. Charger le reranker
    print(f"Chargement du reranker ({RERANKER_MODEL})...")
    reranker = CrossEncoder(RERANKER_MODEL)
    print("   OK: Reranker chargé\n")

    # 3. Initialiser ChromaDB
    print("Initialisation de ChromaDB...")
    client = chromadb.Client()

    # Supprimer la collection si elle existe déjà
    try:
        client.delete_collection(name=COLLECTION_NAME)
    except:
        pass

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"description": "Citations (citations.json) avec métadonnées pour recherche sémantique"}
    )
    print("   OK: Collection ChromaDB créée\n")

    return collection, embedder, reranker

def index_quotes(
    quotes: List[Dict],
    collection: chromadb.Collection,
    embedder: SentenceTransformer
):
    """
    Indexe les citations dans ChromaDB avec leurs embeddings.
    N'indexe/stocke que: text, author, year, emotion_category, emotion_intensity
    (exclut context/source).
    """
    print(f"Indexation de {len(quotes)} citations...\n")

    # Préparer les données pour l'indexation
    ids = []
    documents = []
    metadatas = []
    enriched_texts = []

    for quote in quotes:
        ids.append(quote['id'])
        documents.append((quote.get('text') or quote.get('citation') or ''))  # Texte original pour l'affichage

        tags = quote.get("tags")
        if isinstance(tags, list):
            tags = ", ".join([str(t).strip() for t in tags if str(t).strip()])
        elif tags is None:
            tags = ""
        else:
            tags = str(tags)

        # ChromaDB: metadata doit être un dict plat de scalaires (str/int/float/bool)
        energy = quote.get("energy")
        try:
            energy = -1 if energy is None else int(energy)
        except Exception:
            energy = -1

        metadatas.append({
            "author": (quote.get("author") or quote.get("auteur") or ""),
            "year": "" if quote.get("year") is None else str(quote.get("year")),
            "need": (quote.get("need") or ""),
            "mood": (quote.get("mood") or ""),
            "tone": (quote.get("tone") or ""),
            "length": (quote.get("length") or ""),
            "energy": energy,
            "is_injunctive": bool(quote.get("is_injunctive", False)),
            "is_guilt_inducing": bool(quote.get("is_guilt_inducing", False)),
            "is_toxic_positive": bool(quote.get("is_toxic_positive", False)),
            "language": (quote.get("language") or ""),
            "emotion_category": (quote.get("emotion_category") or ""),
            "emotion_intensity": quote.get("emotion_intensity", ""),
            "source": (quote.get("source") or ""),
            "tags": tags,
        })

        # Texte enrichi pour l'embedding (sans context/source)
        enriched_texts.append(create_enriched_text(quote))

    # Générer les embeddings
    print("Génération des embeddings...")
    start_time = time.time()
    embeddings = embedder.encode(enriched_texts, show_progress_bar=True)
    elapsed = time.time() - start_time
    print(f"   OK: Embeddings générés en {elapsed:.2f}s\n")

    # Indexer dans ChromaDB
    print("Indexation dans ChromaDB...")
    collection.add(
        ids=ids,
        embeddings=embeddings.tolist(),
        documents=documents,
        metadatas=metadatas
    )
    print(f"   OK: {len(quotes)} citations indexées\n")

def search_quotes(
    query: str,
    collection: chromadb.Collection,
    embedder: SentenceTransformer,
    reranker: CrossEncoder,
    use_reranking: bool = True
) -> List[Tuple[str, str, Dict, float]]:
    """
    Recherche les citations les plus pertinentes pour une requête.

    Returns:
        Liste de tuples (id, texte, métadonnées, score)
    """
    # Phase 1: Retrieval vectoriel
    query_embedding = embedder.encode([query])[0]

    results = collection.query(
        query_embeddings=[query_embedding.tolist()],
        n_results=TOP_K_RETRIEVAL
    )

    # Extraire les résultats
    ids = results['ids'][0]
    documents = results['documents'][0]
    metadatas = results['metadatas'][0]
    distances = results['distances'][0]

    # Convertir distances en scores de similarité (approx)
    similarity_scores = [1 - d for d in distances]

    if not use_reranking:
        return list(zip(ids, documents, metadatas, similarity_scores))[:TOP_K_FINAL]

    # Phase 2: Reranking avec CrossEncoder
    pairs = [[query, doc] for doc in documents]
    rerank_scores = reranker.predict(pairs)

    combined = list(zip(ids, documents, metadatas, rerank_scores))
    combined.sort(key=lambda x: x[3], reverse=True)

    return combined[:TOP_K_FINAL]

def evaluate_query(
    query_obj: Dict,
    collection: chromadb.Collection,
    embedder: SentenceTransformer,
    reranker: CrossEncoder
):
    """
    Évalue une requête test et affiche les résultats.
    """
    query_text = query_obj['query']
    print(f"\n{'='*80}")
    print(f"REQUÊTE: {query_text}")
    print(f"{'='*80}\n")

    # Recherche
    results = search_quotes(query_text, collection, embedder, reranker)

    # Afficher les résultats
    print("RÉSULTATS (Top 5):\n")
    for i, (quote_id, text, metadata, score) in enumerate(results, 1):
        print(f"{i}. [Score: {score:.3f}]")
        print(f"   Citation: {text}")

        author = metadata.get("author")
        if author:
            print(f"   Auteur: {author}")

        year = metadata.get("year")
        if year:
            print(f"   Année: {year}")

        emotion_category = metadata.get("emotion_category")
        if emotion_category:
            print(f"   Émotion: {emotion_category}")

        emotion_intensity = metadata.get("emotion_intensity")
        if emotion_intensity not in (None, ""):
            print(f"   Intensité: {emotion_intensity}")

        need = metadata.get("need")
        if need:
            print(f"   Besoin: {need}")

        mood = metadata.get("mood")
        if mood:
            print(f"   Humeur: {mood}")

        tone = metadata.get("tone")
        if tone:
            print(f"   Ton: {tone}")

        print()

    # Demander l'évaluation manuelle
    print("ÉVALUATION MANUELLE:")
    print("   Excellent (5/5) : Lien sémantique fort, citation parfaitement adaptée")
    print("   Bon (4/5)       : Pertinent mais pas optimal")
    print("   Moyen (3/5)     : Lien thématique mais pas le bon ton/contexte")
    print("   Faible (2/5)    : Hors-sujet partiel")
    print("   Hors-sujet (1/5): Aucun rapport\n")

def run_evaluation():
    """
    Lance l'évaluation complète du système RAG.
    """
    print("\nÉVALUATION DU SYSTÈME RAG POUR CITATIONS FRANÇAISES")
    print("=" * 80)
    print()

    # 1. Charger les données
    print("Chargement des données...\n")
    # On force citations.json (objectif: qualité sémantique sur le corpus MVP)
    quotes_file = str(DATASET_FILE)
    if not Path(quotes_file).exists():
        raise FileNotFoundError(
            f"Fichier introuvable: {quotes_file}. "
            "Vérifie que citations.json est bien à la racine du projet."
        )
    quotes = load_quotes(quotes_file)
    test_queries = load_test_queries()
    print(f"   OK: {len(quotes)} citations chargées")
    print(f"   OK: {len(test_queries)} requêtes de test chargées\n")

    # 2. Initialiser le système RAG
    collection, embedder, reranker = initialize_rag_system()

    # 3. Indexer les citations
    index_quotes(quotes, collection, embedder)

    # 4. Tester les requêtes
    print("\nTEST DES REQUÊTES UTILISATEUR")
    print("=" * 80)

    for i, query_obj in enumerate(test_queries, 1):
        print(f"\n[Test {i}/{len(test_queries)}]")
        evaluate_query(query_obj, collection, embedder, reranker)

        if i < len(test_queries):
            input("\nAppuyez sur Entrée pour la requête suivante...")

    print("\n" + "=" * 80)
    print("Évaluation terminée!")
    print("\nProchaines étapes:")
    print("   1. Noter la qualité des résultats pour chaque requête")
    print("   2. Identifier les patterns de réussite et d'échec")
    print("   3. Ajuster l'enrichissement des données si nécessaire")

if __name__ == "__main__":
    run_evaluation()
