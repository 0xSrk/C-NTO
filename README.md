# CΛNTO

Desk de trading local dédié au **Nasdaq (NQ / MNQ, CME Globex)**, pensé pour travailler aux côtés de NinjaTrader 8 et des comptes de prop firms. Prototype forgé par **SIΞRRΛSKΛ**.

CΛNTO s'installe sur le poste du trader, s'ouvre sur un écran de chargement (logotype en traits fins, marque gravée), puis déploie sept modules :

| # | Module | Contenu |
| --- | --- | --- |
| 01 | **Métrique** | Journal jusqu'à 1 000 séances. Import des exports NinjaTrader (« Trade Performance › Trades »), moteur quantitatif (profit factor, espérance, Sharpe/Sortino/Calmar, SQN, Kelly, z-score des séries, MAE/MFE, drawdown, régularité glissante), rejeu des règles prop firm (trailing EOD / intraday / statique, perte journalière, consistance), Monte Carlo bootstrap, visuels interactifs. |
| 02 | **Visual** | Graphique en bougies (lightweight-charts) avec volume, catalogue d'indicateurs extensible (EMA, SMA, VWAP + bandes, Opening Range, niveaux de séance précédente, ATR, volume relatif), projection des trades d'une séance, import de barres OHLCV. |
| 03 | **Calendrier** | Deux vues (grille mensuelle, flux chronologique). Catalyseurs Nasdaq : FOMC (dates officielles 2024–2026), NFP, CPI/PPI/PCE, ISM, PIB, résultats mégacaps, expirations/rollovers CME, fériés et séances écourtées, bascules horaires US/EU. Heures locales + ET, repères de séance, conseils débutant, notes et rappels personnels, PnL du journal par jour. |
| 04 | **Note** | Coffre de notes façon Obsidian : Markdown, liens `[[wiki]]`, liens entrants, `#tags`, recherche, note du jour, graphe de force. |
| 05 | **Agent IA** | Passerelle native : fournisseur OpenAI-compatible (Ollama, LM Studio, OpenAI, OpenRouter…) ou Anthropic, streaming, appels d'outils sur le desk (métriques, séances, notes, calendrier, plan prop firm). Dans le shell Electron : serveur JSON-RPC 2.0 sur WebSocket (`127.0.0.1`) pour un orchestrateur externe. |
| 06 | **Bot** | Atelier d'automates : gabarits, grammaire conditions / actions / garde-fous, cycle de vie (brouillon → backtest → papier → réel verrouillé), garde-fous dérivés du plan prop firm et du calendrier. Phase 1 (conception). |
| 07 | **Copieur** | Topologie maître → suiveurs, dimensionnement (fixe, ratio, risque), correspondance NQ ↔ MNQ, filtres (fenêtre horaire, blackout catalyseurs, marge plancher, latence), journal des versions. La réplication effective attend l'AddOn NinjaTrader spécifié dans `docs/PONT-NINJATRADER.md`. |

Toutes les données restent sur le poste (IndexedDB) ; export/restauration complète du coffre en JSON, export CSV réimportable.

## Prérequis

- Node.js ≥ 22.12 et npm
- Windows 10/11 recommandé (NinjaTrader) — le shell fonctionne aussi sous macOS et Linux

## Installation

```bash
npm install
```

## Lancer

```bash
# Desk complet dans sa fenêtre (Electron + serveur Vite)
npm run desk:dev

# Ou uniquement dans le navigateur (toutes les fonctions sauf la passerelle orchestrateur)
npm run dev
```

## Construire un installeur

```bash
npm run dist:win     # NSIS + portable dans release/
npm run dist         # cible de la plateforme courante
```

## Vérifier

```bash
npm run typecheck
npm test
npm run build
```

## Importer depuis NinjaTrader 8

1. Control Center › **Trade Performance** › onglet **Trades**.
2. Filtrer la période, clic droit › **Export** › CSV.
3. Dans CΛNTO › Métrique › **Importer NinjaTrader** (glisser-déposer accepté). Les cultures en-US et fr-FR sont détectées ; le PnL est recalculé depuis les prix et la valeur du point puis contrôlé avec la colonne Profit ; les doublons sont écartés et les exports successifs s'empilent par séance.

Pour les barres du module Visual : Tools › **Historical Data** › Export (ou tout CSV OHLCV).

## Architecture

```
electron/            shell (fenêtre sans cadre, dialogues fichiers, passerelle WebSocket JSON-RPC)
src/app/             boot, coque (barre de titre, rail, barre d'état), onglets
src/design/          jetons de style, primitives, logotype, graphiques SVG
src/engine/          moteur pur TypeScript : métriques, Monte Carlo, import NinjaTrader,
                     règles prop firm, indicateurs, calendrier Nasdaq, outils agent, clients LLM
src/store/           persistance Dexie (IndexedDB) et états Zustand
src/modules/         un dossier par onglet
tests/               tests Vitest du moteur
docs/                spécification du pont NinjaTrader
```

Le moteur (`src/engine`) est indépendant de l'interface : les indicateurs, les outils exposés à l'agent et les plans prop firm sont des registres que le Lab enrichit sans toucher aux modules.

## Feuille de route

- Pont NinjaTrader (AddOn NinjaScript) : import temps réel des exécutions, copieur actif, exécution papier des automates.
- Backtest des automates sur les barres importées.
- Agent : mémoire longue par trader, profils d'évolution du desk.

## Avertissement

Le registre des prop firms est indicatif : les règles changent fréquemment et doivent être validées auprès de chaque firme. CΛNTO n'émet aucun conseil d'investissement.
