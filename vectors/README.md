# Vecteurs de métriques

Fichiers d’entrée / sortie figés à partir des fonctions actuelles de CΛNTO (`computeTradeStats`, `computeDailyStats`, `evaluatePlan`). Les `*.expected.json` ne sont pas des valeurs académiques : ils reproduisent le moteur tel qu’il tourne.

Conventions du moteur (et du jumeau Python, qui doit lire les **mêmes** fichiers) :

- Sharpe : taux sans risque `rf = 0`, annualisation `sqrt(252)`.
- Séances agrégées par date Globex (`YYYY-MM-DD` déjà calculée, fuseau `America/New_York` à l’import).
- Kelly : les breakevens (`pnl === 0`) sont exclus (ni gain ni perte).
- Monte Carlo : bootstrap i.i.d. (tirage avec remise), budget `runs * horizon <= 5_000_000`.

Le dépôt Python n’est pas dans ce repo.
