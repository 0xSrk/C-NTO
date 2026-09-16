# CΛNTO

**Desk de trading local — Nasdaq (NQ / MNQ, CME Globex)**  
Forgé par **SIΞRRΛSKΛ Lab** · version **1.0**

CΛNTO s’installe sur le poste du trader. Écran de chargement (logotype tracé au trait, marque gravée), puis sept modules. Données 100 % locales (IndexedDB). Conçu pour travailler aux côtés de NinjaTrader 8 et des comptes prop firm.

---

## Modules

| # | Module | Rôle |
| --- | --- | --- |
| 01 | **Métrique** | Journal (≤ 1 000 séances). Pont NinjaTrader (dossier surveillé, CSV Trades / Executions, AddOn temps réel). Appariement FIFO. Moteur quantitatif (profit factor, espérance, Sharpe / Sortino / Calmar, SQN, Kelly, z-score, MAE / MFE, drawdown, régularité). Rejeu prop firm. Monte Carlo borné. |
| 02 | **Visual** | Bougies (lightweight-charts), volume, indicateurs (EMA, SMA, VWAP ± bandes, Opening Range, niveaux séance précédente, ATR, RVOL), projection de trades, import OHLCV. |
| 03 | **Calendrier** | Grille mensuelle + flux. Catalyseurs Nasdaq (FOMC 2024–2026, NFP, CPI / PPI / PCE, ISM, PIB, résultats, expirations CME, fériés, DST). Heures locales + ET, notes du jour, PnL journal. |
| 04 | **Note** | Coffre Markdown type Obsidian : `[[wiki]]`, backlinks, `#tags`, recherche, note du jour, graphe. |
| 05 | **Agent IA** | Fournisseur OpenAI-compatible ou Anthropic, streaming, outils desk (lecture + écritures confirmées). Shell Electron : JSON-RPC 2.0 WebSocket `127.0.0.1` (jeton, origines navigateur refusées). Clé API via trousseau OS. |
| 06 | **Bot** | Atelier d’automates : gabarits, conditions / actions / garde-fous, cycle brouillon → backtest → papier → réel. Phase conception. |
| 07 | **Copieur** | Topologie maître → suiveurs, sizing, NQ ↔ MNQ, filtres. Réplication effective : AddOn décrit dans `docs/PONT-NINJATRADER.md`. |

---

## Prérequis

- Node.js ≥ 22.12 et npm  
- Windows 10 / 11 recommandé (NinjaTrader) — shell aussi sous macOS et Linux

## Installation

```bash
npm install
```

## Lancer

```bash
npm run desk:dev   # Electron + Vite
npm run dist:win   # Installeur NSIS + portable → release/
```

Navigateur seul (sans passerelle orchestrateur) : `npm run dev`

## Vérifier

```bash
npm run typecheck
npm test
npm run build
```

---

## Pont NinjaTrader 8

**Automatique** — Métrique › Pont NinjaTrader › dossier (défaut `Documents\NinjaTrader 8\export\CANTO`). Tout CSV déposé / modifié est importé à écriture terminée. AddOn temps réel : `ninjatrader/CantoBridge.cs` → `Documents\NinjaTrader 8\bin\Custom\AddOns\` puis Compile. Voir `docs/PONT-NINJATRADER.md`.

**Manuel** — Trade Performance › Trades (ou Executions) › Export CSV › Métrique › Importer. Cultures en-US / fr-FR détectées ; PnL recalculé depuis prix × point ; doublons écartés.

Barres Visual : Tools › Historical Data › Export (CSV OHLCV).

---

## Architecture

```
electron/       shell, dialogues, pont dossier, WebSocket JSON-RPC, secrets
ninjatrader/    AddOn CΛNTO Bridge
src/app/        boot, coque, onglets
src/design/     jetons, primitives, logotype, graphiques
src/engine/     métriques, Monte Carlo, import NT, prop firm, indicateurs, calendrier, agent
src/store/      Dexie + Zustand
src/modules/    un dossier par onglet
tests/          Vitest (moteur)
docs/           DESIGN.md · PONT-NINJATRADER.md · AUDIT.md
```

Le moteur (`src/engine`) est indépendant de l’UI. Grammaire visuelle : `docs/DESIGN.md`.

---

## Suite

- Copieur actif + exécution papier des automates (transport WebSocket)  
- Backtest automates sur barres importées  
- Agent : mémoire longue, profils d’évolution du desk  

## Avertissement

Le registre prop firm est indicatif. Validez les règles auprès de chaque firme. CΛNTO n’émet aucun conseil d’investissement.
