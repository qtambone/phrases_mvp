# MVP Citations — Prototype web (offline)

## Lancer
Recommandé (évite les restrictions de `fetch` en ouvrant un fichier local) :

1) Ouvre un terminal dans ce dossier
2) Lance un serveur statique :
- Python : `python -m http.server 8000`
- Node : `npx serve .`

3) Ouvre :
http://localhost:8000

## Comment ça marche
- Tu choisis (optionnel) un **besoin** (prioritaire) et/ou une **humeur** (secondaire).
- Tu renseignes un peu de contexte (journée, météo).
- Le moteur applique les règles et propose une citation.
- Le bouton “citation du jour” te redonne la même citation pour la journée.
- “Une autre” reroll en respectant les mêmes règles.
- Le feedback 👍👎 ajuste légèrement les prochaines sélections.
