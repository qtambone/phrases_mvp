#!/usr/bin/env python3
"""
QuoteKG French Quotes Extractor
Extrait 500 citations françaises avec métadonnées complètes du SPARQL endpoint QuoteKG.

Endpoint: https://quotekg.l3s.uni-hannover.de/sparql
Documentation: https://quotekg.l3s.uni-hannover.de/
"""

import json
import time
import logging
from typing import Optional
from dataclasses import dataclass, asdict
from SPARQLWrapper import SPARQLWrapper, JSON, POST
from SPARQLWrapper.SPARQLExceptions import QueryBadFormed, EndPointNotFound

# Configuration du logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration du endpoint
QUOTEKG_ENDPOINT = "https://quotekg.l3s.uni-hannover.de/sparql"
DEFAULT_TIMEOUT = 60
MAX_RETRIES = 3
RETRY_DELAY = 5


@dataclass
class FrenchQuote:
    """Structure de données pour une citation française avec métadonnées."""
    uri: str
    text: str
    author: str
    date: Optional[str] = None
    year: Optional[str] = None
    is_misattributed: bool = False
    emotion_category: Optional[str] = None
    emotion_intensity: Optional[float] = None
    context: Optional[str] = None
    source: Optional[str] = None


def build_sparql_query(limit: int = 500, offset: int = 0) -> str:
    """Construit la requête SPARQL pour extraire des citations françaises."""
    return f"""
    PREFIX qkg: <https://quotekg.l3s.uni-hannover.de/resource/>
    PREFIX so: <https://schema.org/>
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX onyx: <http://www.gsi.upm.es/ontologies/onyx/ns#>
    PREFIX dbo: <http://dbpedia.org/ontology/>
    PREFIX dcterms: <http://purl.org/dc/terms/>

    SELECT DISTINCT ?quotation ?text ?authorLabel ?date ?year 
           ?isMisattributed ?emotionCategory ?emotionIntensity 
           ?contextText ?source
    WHERE {{
      ?quotation a so:Quotation ;
                 so:spokenByCharacter ?author ;
                 qkg:hasMention ?mention .
      
      ?author skos:prefLabel ?authorLabel .
      ?mention so:text ?text .
      
      FILTER(LANG(?text) = "fr")
      
      OPTIONAL {{ ?quotation so:dateCreated ?date }}
      OPTIONAL {{ ?quotation dbo:year ?year }}
      OPTIONAL {{ ?quotation qkg:isMisattributed ?isMisattributed }}
      
      OPTIONAL {{ 
        ?quotation onyx:hasEmotionSet ?emotionSet .
        ?emotionSet onyx:hasEmotion ?emotion .
        ?emotion onyx:hasEmotionCategory ?emotionCategory ;
                 onyx:hasEmotionIntensity ?emotionIntensity .
      }}
      
      OPTIONAL {{
        ?mention qkg:hasContext ?context .
        ?context qkg:contextText ?contextText .
        OPTIONAL {{ ?context dcterms:source ?source }}
      }}
    }}
    LIMIT {limit}
    OFFSET {offset}
    """


def parse_emotion_category(uri: Optional[str]) -> Optional[str]:
    """Extrait le nom de la catégorie d'émotion depuis l'URI."""
    if not uri:
        return None
    if "PositiveEmotion" in uri:
        return "positive"
    elif "NegativeEmotion" in uri:
        return "negative"
    elif "NeutralEmotion" in uri:
        return "neutral"
    return uri.split("/")[-1] if "/" in uri else uri


def parse_binding(binding: dict) -> FrenchQuote:
    """Convertit un binding SPARQL JSON en objet FrenchQuote."""
    def get_value(key: str) -> Optional[str]:
        return binding.get(key, {}).get("value")
    
    misattributed_raw = get_value("isMisattributed")
    is_misattributed = misattributed_raw == "true" if misattributed_raw else False
    
    intensity_raw = get_value("emotionIntensity")
    emotion_intensity = float(intensity_raw) if intensity_raw else None
    
    return FrenchQuote(
        uri=get_value("quotation") or "",
        text=get_value("text") or "",
        author=get_value("authorLabel") or "Inconnu",
        date=get_value("date"),
        year=get_value("year"),
        is_misattributed=is_misattributed,
        emotion_category=parse_emotion_category(get_value("emotionCategory")),
        emotion_intensity=emotion_intensity,
        context=get_value("contextText"),
        source=get_value("source")
    )


def fetch_french_quotes(
    limit: int = 500,
    batch_size: int = 100,
    timeout: int = DEFAULT_TIMEOUT
) -> list:
    """Récupère des citations françaises depuis QuoteKG avec pagination automatique."""
    sparql = SPARQLWrapper(QUOTEKG_ENDPOINT)
    sparql.setReturnFormat(JSON)
    sparql.setMethod(POST)
    sparql.setTimeout(timeout)
    
    all_quotes = []
    offset = 0
    
    logger.info(f"🔍 Début de l'extraction de {limit} citations françaises...")
    logger.info(f"📡 Endpoint: {QUOTEKG_ENDPOINT}\n")
    
    while len(all_quotes) < limit:
        current_limit = min(batch_size, limit - len(all_quotes))
        query = build_sparql_query(limit=current_limit, offset=offset)
        
        for attempt in range(MAX_RETRIES):
            try:
                sparql.setQuery(query)
                logger.info(f"⏳ Requête batch: offset={offset}, limit={current_limit} (tentative {attempt + 1})")
                
                results = sparql.query().convert()
                bindings = results.get("results", {}).get("bindings", [])
                
                if not bindings:
                    logger.info("✓ Plus de résultats disponibles")
                    return all_quotes
                
                batch_quotes = [parse_binding(b) for b in bindings]
                all_quotes.extend(batch_quotes)
                
                logger.info(f"✓ Récupéré {len(batch_quotes)} citations (total: {len(all_quotes)})\n")
                offset += current_limit
                
                time.sleep(0.5)
                break
                
            except QueryBadFormed as e:
                logger.error(f"❌ Erreur de syntaxe SPARQL: {e}")
                raise
            except EndPointNotFound as e:
                logger.error(f"❌ Endpoint non disponible: {e}")
                raise
            except Exception as e:
                logger.warning(f"⚠️  Erreur tentative {attempt + 1}: {e}")
                if attempt < MAX_RETRIES - 1:
                    logger.info(f"   Nouvelle tentative dans {RETRY_DELAY}s...")
                    time.sleep(RETRY_DELAY)
                else:
                    raise RuntimeError(f"Échec après {MAX_RETRIES} tentatives: {e}")
    
    return all_quotes[:limit]


def export_to_json(quotes: list, filepath: str = "quotekg_citations.json"):
    """Exporte les citations en JSON."""
    data = {
        "metadata": {
            "source": "QuoteKG SPARQL Endpoint",
            "endpoint": QUOTEKG_ENDPOINT,
            "total_quotes": len(quotes),
            "language": "fr",
            "extraction_date": time.strftime("%Y-%m-%d %H:%M:%S")
        },
        "quotes": [asdict(q) for q in quotes]
    }
    
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    logger.info(f"💾 Exporté {len(quotes)} citations vers {filepath}")


def print_statistics(quotes: list):
    """Affiche des statistiques sur les citations extraites."""
    total = len(quotes)
    with_sentiment = sum(1 for q in quotes if q.emotion_category)
    with_context = sum(1 for q in quotes if q.context)
    misattributed = sum(1 for q in quotes if q.is_misattributed)
    with_date = sum(1 for q in quotes if q.date or q.year)
    
    emotions = {}
    for q in quotes:
        if q.emotion_category:
            emotions[q.emotion_category] = emotions.get(q.emotion_category, 0) + 1
    
    print("\n" + "="*60)
    print("📊 STATISTIQUES DES CITATIONS FRANÇAISES QUOTEKG")
    print("="*60)
    print(f"Total citations extraites:    {total}")
    print(f"Avec sentiment analysé:       {with_sentiment} ({100*with_sentiment/total:.1f}%)")
    print(f"Avec contexte:                {with_context} ({100*with_context/total:.1f}%)")
    print(f"Avec date/année:              {with_date} ({100*with_date/total:.1f}%)")
    print(f"Marquées misattribuées:       {misattributed} ({100*misattributed/total:.1f}%)")
    
    if emotions:
        print("\nRépartition des sentiments:")
        for emotion, count in sorted(emotions.items()):
            print(f"  - {emotion}: {count}")
    print("="*60 + "\n")


def main():
    """Point d'entrée principal."""
    try:
        # Extraction des citations
        quotes = fetch_french_quotes(limit=500, batch_size=100)
        
        if not quotes:
            logger.error("❌ Aucune citation récupérée!")
            return
        
        # Affichage des statistiques
        print_statistics(quotes)
        
        # Export JSON
        export_to_json(quotes, "quotekg_citations.json")
        
        # Aperçu des premières citations
        print("\n📋 APERÇU DES 5 PREMIÈRES CITATIONS\n")
        for i, quote in enumerate(quotes[:5], 1):
            text_preview = quote.text[:100] + "..." if len(quote.text) > 100 else quote.text
            print(f"{i}. \"{text_preview}\"")
            print(f"   — {quote.author}")
            if quote.emotion_category:
                intensity_str = f"{quote.emotion_intensity:.2f}" if quote.emotion_intensity else "N/A"
                print(f"   Sentiment: {quote.emotion_category} (intensité: {intensity_str})")
            if quote.is_misattributed:
                print("   ⚠️  CITATION MISATTRIBUÉE")
            print()
        
        print("\n✅ Extraction terminée!")
        print(f"➡️  Prochaine étape: python test_rag.py\n")
        
    except Exception as e:
        logger.error(f"❌ Erreur fatale: {e}")
        raise


if __name__ == "__main__":
    main()
