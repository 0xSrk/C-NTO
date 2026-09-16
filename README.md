<div align="center">

<br/>

**`SIΞRRΛSKΛ—LAB · CΛNTO · ARTEFACT 002 · REV. V1.0 · DESK OUTPUT`**

# CΛNTO

### Desk de trading local pour le Nasdaq-100 futures (NQ / MNQ, CME Globex)

Un artefact de **SIΞRRΛSKΛ Lab** — journal quantitatif, pont NinjaTrader 8, calendrier catalyseurs, notes, agent IA, automates et copieur, dans une seule application locale. Données 100 % sur le poste.

[![Node](https://img.shields.io/badge/Node-22.12%2B-000000?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Shell-Electron-000000?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/UI-React%2019-000000?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/Engine-TypeScript-000000?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![NinjaTrader](https://img.shields.io/badge/NinjaTrader-8-000000?style=flat-square)](https://ninjatrader.com)
[![Tests](https://img.shields.io/badge/tests-49%20passed-000000?style=flat-square)](tests)
[![Design](https://img.shields.io/badge/design-SIΞRRΛSKΛ%20system-c41e3a?style=flat-square)](docs/DESIGN.md)
[![Version](https://img.shields.io/badge/version-1.0.0-c41e3a?style=flat-square)](package.json)

<br/>

<img src="docs/media/metrique.png" alt="CΛNTO — Métrique : tableau de bord, courbe d'équité, heatmap annuelle, 140 séances" width="920"/>

<br/><br/>

</div>

---

## Sommaire

1. [En bref](#en-bref)
2. [Démarrer](#démarrer)
3. [Les sept modules](#les-sept-modules)
4. [Métrique — journal & moteur](#métrique--journal--moteur)
5. [Visual — bougies & indicateurs](#visual--bougies--indicateurs)
6. [Calendrier — catalyseurs Nasdaq](#calendrier--catalyseurs-nasdaq)
7. [Note — coffre Markdown](#note--coffre-markdown)
8. [Agent IA & orchestrateur](#agent-ia--orchestrateur)
9. [Bot & Copieur](#bot--copieur)
10. [Pont NinjaTrader 8](#pont-ninjatrader-8)
11. [Architecture](#architecture)
12. [Développement](#développement)
13. [Système visuel](#système-visuel)
14. [Suite](#suite)
15. [Avertissement](#avertissement)

---

## En bref

CΛNTO est le **desk local** du Lab pour travailler le **Nasdaq-100 futures** aux côtés de NinjaTrader 8 et des comptes prop firm. Une fenêtre Electron, sept modules, un coffre IndexedDB — rien ne quitte le poste.

| | |
|---|---|
| **Mesurer** | Journal jusqu'à 1 000 séances · profit factor, espérance, Sharpe / Sortino / Calmar, SQN, Kelly, z-score, MAE / MFE, drawdown, régularité glissante |
| **Importer** | Pont NinjaTrader (dossier surveillé + AddOn exécutions) · CSV Trades / Executions · cultures en-US / fr-FR · appariement FIFO |
| **Rejouer** | Règles prop firm (trailing EOD / intraday / statique, perte journalière, consistance) · Monte Carlo bootstrap borné |
| **Voir** | Bougies NQ, indicateurs extensibles, projection des trades d'une séance |
| **Contextualiser** | Calendrier FOMC, NFP, CPI, ISM, expirations CME, fériés, DST — heures locales + ET |
| **Noter** | Coffre Markdown `[[wiki]]`, tags, graphe de force |
| **Orchestrer** | Agent IA (outils desk + confirmation d'écriture) · WebSocket JSON-RPC authentifié pour un orchestrateur externe |

---

## Démarrer

**Prérequis** : Node.js ≥ 22.12 et npm. Windows 10 / 11 recommandé pour NinjaTrader — le shell tourne aussi sous macOS et Linux.

```bash
git clone https://github.com/0xSrk/C-NTO.git
cd C-NTO
npm install
```

| Commande | Effet |
|---|---|
| `npm run desk:dev` | Fenêtre Electron + serveur Vite (desk complet) |
| `npm run dev` | Navigateur seul (toutes les fonctions sauf la passerelle orchestrateur) |
| `npm run dist:win` | Installeur NSIS + portable → `release/` |
| `npm run typecheck && npm test && npm run build` | Vérification moteur + UI |

Au premier lancement : écran de chargement (logotype tracé au trait, marque gravée `SIΞRRΛSKΛ—LAB`), puis le desk. Un **jeu de démonstration** (140 séances) se charge depuis Métrique › *Charger un jeu de démonstration*.

---

## Les sept modules

| # | Module | Rôle |
|---|---|---|
| 01 | **Métrique** | Journal, pont NT, moteur quantitatif, prop firm, Monte Carlo |
| 02 | **Visual** | Graphique bougies, indicateurs, projection de trades, import OHLCV |
| 03 | **Calendrier** | Grille + flux, catalyseurs Nasdaq, notes du jour, PnL journal |
| 04 | **Note** | Coffre Markdown type Obsidian, backlinks, graphe |
| 05 | **Agent IA** | LLM local ou cloud, outils desk, orchestrateur WebSocket |
| 06 | **Bot** | Atelier d'automates (conception) |
| 07 | **Copieur** | Topologie maître → suiveurs (réplication via AddOn à venir) |

<div align="center">
<img src="docs/media/visual.png" alt="CΛNTO — Visual : bougies NQ 5 min, VWAP, EMA 21, Opening Range" width="920"/>
<br/><sub>02 · Visual — bougies, volume, catalogue d'indicateurs.</sub>
</div>

---

## Métrique — journal & moteur

Capacité : **1 000 séances**. Chaque séance porte un compte, une date de trading (clé Globex 18:00 America/New_York), des tags et une liste de trades.

**Moteur** (`src/engine`) — TypeScript pur, indépendant de l'UI :

- Ratios : profit factor, payoff, espérance ($ et R), win rate, SQN (Van Tharp), Kelly
- Séries journalières : Sharpe, Sortino, Calmar, drawdown max / actuel / durée, % de séances gagnantes, consistance (part du meilleur jour dans le profit net)
- MAE / MFE (unité déduite de la colonne Profit), z-score des séries, régularité glissante
- Monte Carlo bootstrap borné (`runs × horizon ≤ 5 M` tirages), enveloppe P5 / P50 / P95
- Rejeu prop firm : validation le jour où les conditions sont réunies (`passedOn`), agrégation par date, filtre par compte

**Vues** : Tableau de bord · Séances · Analyse (carte horaire, MAE/MFE, distribution) · Prop firm · Monte Carlo.

<div align="center">
<img src="docs/media/analyse.png" alt="CΛNTO — Analyse : distribution, carte horaire, nuage MAE/MFE" width="920"/>
<br/><br/>
<img src="docs/media/propfirm.png" alt="CΛNTO — Prop firm : rejeu de plan, trailing, consistance" width="920"/>
<br/><br/>
<img src="docs/media/montecarlo.png" alt="CΛNTO — Monte Carlo : enveloppe bootstrap, risque de ruine" width="920"/>
</div>

Export / restauration complète du coffre en JSON ; export CSV réimportable. La clé API de l'agent n'est **jamais** exportée.

---

## Visual — bougies & indicateurs

Graphique **lightweight-charts** : OHLCV, volume, croisement, marqueurs de trades (sorties gagnantes en LED Lab).

**Catalogue** (`src/engine/indicators.ts`) — registre extensible :

| Indicateur | Paramètres typiques |
|---|---|
| EMA / SMA | période |
| VWAP de séance | bandes ±1σ / ±2σ |
| Opening Range (RTH) | 5 / 15 / 30 min |
| Niveaux séance précédente | PDH / PDL / PDC |
| ATR | période |
| Volume relatif (RVOL) | période |

Import de barres : CSV OHLCV (export NinjaTrader Historical Data ou tout format compatible). Données démo synthétiques disponibles sans import.

---

## Calendrier — catalyseurs Nasdaq

Deux vues : **grille mensuelle** et **flux chronologique**.

| Famille | Exemples |
|---|---|
| Fed | FOMC (dates officielles 2024–2026), conférences |
| Emploi | NFP, rapport emploi |
| Inflation | CPI, PPI, PCE |
| Croissance | PIB, ventes au détail, ISM / PMI |
| Résultats | Mégacaps Nasdaq-100 |
| CME | Expirations, rollovers |
| Horaires | Fériés US, séances écourtées, bascules DST US / EU |

Heures locales + ET, repères de séance, conseils débutant, notes et rappels personnels, PnL du journal superposé par jour.

<div align="center">
<img src="docs/media/calendrier.png" alt="CΛNTO — Calendrier : grille septembre, FOMC, tip débutant" width="920"/>
</div>

---

## Note — coffre Markdown

Façon Obsidian, 100 % local :

- Éditeur Markdown + aperçu assaini (DOMPurify)
- Liens `[[wiki]]`, backlinks, `#tags`, recherche
- Note du jour
- Graphe de force (nœuds = notes, arêtes = liens)

<div align="center">
<img src="docs/media/note.png" alt="CΛNTO — Note : éditeur Markdown, tags, graphe" width="920"/>
</div>

---

## Agent IA & orchestrateur

**Passerelle native** : fournisseur OpenAI-compatible (Ollama, LM Studio, OpenAI, OpenRouter…) ou Anthropic. Streaming. Clé API chiffrée par le trousseau OS (`safeStorage`) sous Electron.

**Outils desk** (lecture libre ; écritures `create_note` / `annotate_session` avec confirmation opérateur) : métriques, séances, notes, calendrier, plan prop firm. Préambule « données non fiables », plafond d'appels par tour.

**Orchestrateur externe** (shell Electron uniquement) : serveur JSON-RPC 2.0 sur WebSocket `127.0.0.1`, jeton de session (comparaison à temps constant), origines navigateur refusées, 8 clients max, 1 Mo / trame, 40 req/s.

<div align="center">
<img src="docs/media/agent.png" alt="CΛNTO — Agent IA : conversation, outils, orchestrateur" width="920"/>
</div>

---

## Bot & Copieur

**Bot** (phase conception) — gabarits, grammaire conditions / actions / garde-fous, cycle de vie `brouillon → backtest → papier → réel verrouillé`. Garde-fous dérivés du plan prop firm et du calendrier.

**Copieur** — topologie maître → suiveurs, dimensionnement (fixe, ratio, risque), correspondance NQ ↔ MNQ, filtres (fenêtre horaire, blackout catalyseurs, marge plancher, latence), journal des versions. La **réplication d'ordres** attend le transport WebSocket du pont (spécifié dans `docs/PONT-NINJATRADER.md`).

<div align="center">
<img src="docs/media/bot.png" alt="CΛNTO — Bot : atelier d'automates, gabarits ORB" width="920"/>
<br/><br/>
<img src="docs/media/copieur.png" alt="CΛNTO — Copieur : comptes, sizing, filtres" width="920"/>
</div>

---

## Pont NinjaTrader 8

Transport **fichier CSV** implémenté — local uniquement, aucune télémétrie.

| Mode | Comment |
|---|---|
| **Automatique** | Métrique › Pont NinjaTrader › dossier (défaut `Documents\NinjaTrader 8\export\CANTO`). Tout CSV déposé / modifié est importé à écriture terminée. |
| **Temps réel** | Installer `ninjatrader/CantoBridge.cs` dans `Documents\NinjaTrader 8\bin\Custom\AddOns\` → NinjaScript Editor › Compile (F5). Chaque exécution → `executions-AAAA-MM-JJ.csv`, appariée FIFO par CΛNTO. |
| **Manuel** | Trade Performance › Trades (ou Executions) › Export CSV › Importer. Cultures en-US / fr-FR. PnL recalculé depuis prix × point. |

Guide complet : **[docs/PONT-NINJATRADER.md](docs/PONT-NINJATRADER.md)**.

---

## Architecture

```
electron/         shell (fenêtre sans cadre, dialogues, pont dossier,
                  WebSocket JSON-RPC authentifié, secrets chiffrés)
ninjatrader/      AddOn CΛNTO Bridge (exécutions → CSV)
src/app/          boot, coque (titlebar 56 · rail 232 · status 28), onglets
src/design/       jetons, primitives, logotype CΛNTO, graphiques SVG
src/engine/       métriques, Monte Carlo, import NT, prop firm,
                  indicateurs, calendrier Nasdaq, outils agent, clients LLM
src/store/        Dexie (IndexedDB) + Zustand
src/modules/      un dossier par onglet (01…07)
tests/            Vitest — 49 tests moteur
docs/             DESIGN.md · PONT-NINJATRADER.md · AUDIT.md · media/
```

Le moteur (`src/engine`) est indépendant de l'interface : indicateurs, outils agent et plans prop firm sont des registres enrichissables sans toucher aux modules.

---

## Développement

```bash
npm install
npm run desk:dev      # Electron + Vite
npm run typecheck     # tsc app + electron
npm test              # 49 tests Vitest
npm run build         # bundle production
npm run dist:win      # NSIS + portable
```

---

## Système visuel

Grammaire lithographique décrite dans **[docs/DESIGN.md](docs/DESIGN.md)** :

- Noir absolu, hairlines 1 px, grille **4 px** stricte, aucun arrondi
- Inter 700 (titres / valeurs) · JetBrains Mono capitales (libellés, jamais &lt; 11 px)
- Une seule LED Lab `#c41e3a` — point, filet, mot-clé ; jamais en aplat
- Wordmark CΛNTO tracé au trait (square / miter), onglet inversé `CΛNTO · ARTEFACT 002`
- Vert / rouge : sens uniquement (direction, PnL, statut)

---

## Suite

- Copieur actif + exécution papier des automates (transport WebSocket du pont)
- Backtest des automates sur les barres importées
- Agent : mémoire longue par trader, profils d'évolution du desk

---

## Avertissement

Le registre des prop firms est **indicatif** : les règles changent fréquemment et doivent être validées auprès de chaque firme. CΛNTO n'émet aucun conseil d'investissement. Les données restent sur le poste ; aucun serveur tiers n'est requis pour le journal.

<div align="center">
<br/>
<sub>DESIGN UNIT · SIΞRRΛSKΛ LAB · ARTEFACT 002 · REV. A · v1.0.0</sub>
</div>
