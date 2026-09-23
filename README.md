<div align="center">

<br/>

**`SIΞRRΛSKΛ—LAB · CΛNTO · ARTEFACT 002 · REV. V1.1.2 · DESK OUTPUT`**

# CΛNTO

### Desk de trading local pour le Nasdaq-100 futures (NQ / MNQ, CME Globex)

Un artefact de **SIΞRRΛSKΛ Lab** — journal quantitatif, pont NinjaTrader 8, calendrier catalyseurs, notes, agent IA, automates et copieur, dans une seule application locale. Données 100 % sur le poste.

> Licence : `UNLICENSED`. Source visible. Pas de concession de droits. Pas de réutilisation sans accord SIΞRRΛSKΛ.

[![Node](https://img.shields.io/badge/Node-22.12%2B-000000?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Shell-Electron-000000?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/UI-React%2019-000000?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/Engine-TypeScript-000000?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![NinjaTrader](https://img.shields.io/badge/NinjaTrader-8-000000?style=flat-square)](https://ninjatrader.com)
[![Tests](https://img.shields.io/badge/tests-115%20passed-000000?style=flat-square)](tests)
[![Design](https://img.shields.io/badge/design-SIΞRRΛSKΛ%20system-c41e3a?style=flat-square)](docs/DESIGN.md)
[![Version](https://img.shields.io/badge/version-1.1.2-c41e3a?style=flat-square)](package.json)

<br/>

<img src="docs/media/metrique.png" alt="CΛNTO — Métrique : tableau de bord, courbe d'équité, heatmap annuelle, 140 séances" width="920"/>

<br/>

**`01 MTR` · `02 VIS` · `03 CAL` · `04 NTE` · `05 AGT` · `06 BOT` · `07 CPY`**

<br/><br/>

</div>

---

## Sommaire

0. [En bref](#en-bref) · [Démarrer](#démarrer) · [Mettre à jour](#mettre-à-jour)
1. [`01 · MTR` Métrique](#01-mtr)
2. [`02 · VIS` Visual](#02-vis)
3. [`03 · CAL` Calendrier](#03-cal)
4. [`04 · NTE` Note](#04-nte)
5. [`05 · AGT` Agent IA](#05-agt)
6. [`06 · BOT` Bot](#06-bot)
7. [`07 · CPY` Copieur](#07-cpy)
8. [Pont NinjaTrader 8](#pont)
9. [Architecture](#architecture) · [Développement](#développement) · [Système visuel](#système-visuel)
10. [Suite](#suite) · [Avertissement](#avertissement)

---

## En bref

CΛNTO est le **desk local** du Lab pour travailler le **Nasdaq-100 futures** aux côtés de NinjaTrader 8 et des comptes prop firm. Une fenêtre Electron, sept modules, un coffre IndexedDB — rien ne quitte le poste.

| | |
|---|---|
| **Mesurer** | Journal jusqu’à 1 000 séances · profit factor, espérance, Sharpe / Sortino / Calmar, SQN, Kelly, z-score, MAE / MFE, drawdown, régularité glissante |
| **Importer** | Pont NT (dossier surveillé + AddOn exécutions) · CSV Trades / Executions / CΛNTO · cultures en-US / fr-FR · appariement FIFO · idempotence par ID d’exécution |
| **Rejouer** | Plans prop firm versionnés (trailing EOD / intraday / statique, perte journalière, consistance) · Monte Carlo bootstrap borné |
| **Voir** | Bougies NQ / MNQ, catalogue d’indicateurs, projection des trades d’une séance |
| **Contextualiser** | Calendrier FOMC, NFP, CPI, ISM, expirations CME, fériés, DST — heures locales + ET |
| **Noter** | Coffre Markdown `[[wiki]]`, tags, graphe de force |
| **Orchestrer** | Agent IA (outils desk + confirmation d’écriture, LLM via le process main) · WebSocket JSON-RPC authentifié |
| **Concevoir** | Bot et Copieur en phase **CONCEPTION** — aucun ordre n’est envoyé |

---

## Démarrer

**Prérequis** : [Node.js](https://nodejs.org) ≥ 22.12 (LTS) et npm. Windows 10 / 11 recommandé pour NinjaTrader — le shell tourne aussi sous macOS et Linux.

### Voie simple (recommandée)

```bash
git clone https://github.com/0xSrk/C-NTO.git
cd C-NTO
npm install
```

Puis **double-cliquez `CANTO.cmd`** (Windows) — ou lancez :

```bash
npm run launch
```

Le **lanceur** s’ouvre : logotype CΛNTO, bouton **Lancer le desk**, contrôle de version. Un clic ouvre le desk complet.

Premier lancement Windows : le binaire Electron est téléchargé puis extrait **sans** le module natif `extract-zip` (souvent bloqué par le Contrôle d’applications intelligentes). Comptez 1–2 min. Si le lanceur affiche `Cannot find native binding`, mettez à jour le dépôt (`git pull`) et relancez `CANTO.cmd`.

Astuce Windows : clic droit sur `CANTO.cmd` › *Envoyer vers › Bureau (créer un raccourci)*.

### Autres commandes

| Commande | Effet |
|---|---|
| `npm run launch` / `CANTO.cmd` | **Lanceur** → desk (voie principale) |
| `npm run desk:dev` | Desk Electron + Vite (sans écran lanceur) |
| `npm run dev` | Navigateur seul (hors passerelle orchestrateur, hors chiffrement `safeStorage`) |
| `npm run dist:win` | Installeur NSIS + portable → `release/` |
| `npm run check` | `typecheck` + `test` + `build` |

Au premier lancement : écran lanceur, puis boot lithographique, puis le desk. Un **jeu de démonstration** (140 séances) se charge depuis Métrique › *Charger un jeu de démonstration*.

---

## Mettre à jour

CΛNTO **contrôle le dépôt GitHub au démarrage** (lanceur et barre de titre du desk).

| Installation | Clic sur **Mettre à jour et relancer** |
|---|---|
| **Clone git** (voie recommandée, `git clone` … `CANTO.cmd`) | `git fetch` + `git pull --ff-only origin main`, puis `npm install --legacy-peer-deps`, puis **relance** le lanceur. Un working tree sale demande confirmation (stash). |
| **Installeur** (pas de dossier `.git`) | Ouvre [GitHub Releases](https://github.com/0xSrk/C-NTO/releases) (`https` seulement). |

| État | Comportement |
|---|---|
| À jour | Le bouton affiche `v1.1.2` (discret) |
| Mise à jour dispo | Le bouton passe **ambre / jaune** — un clic installe et relance (clone git) |

---

<a id="01-mtr"></a>

<div align="center">

**`01 · MTR · MÉTRIQUE · JOURNAL ULTIME · MOTEUR QUANTITATIF`**

## Métrique

### 1 000 séances · moteur TypeScript pur · rejeu prop firm · Monte Carlo

<img src="docs/media/metrique.png" alt="CΛNTO — Métrique : tableau de bord, courbe d'équité, heatmap annuelle" width="920"/>

<sub>Tableau de bord — PnL net, ratios, courbe d’équité, drawdown depuis le plus haut, année glissante. 140 séances de démonstration.</sub>

</div>

Cinq vues dans le même module : **Tableau de bord** · **Séances** · **Analyse** · **Prop firm** · **Monte Carlo**. Capacité **1 000 séances** (avertissement + proposition d’export au-delà, pas de drop silencieux). Chaque séance porte un compte, une date de trading (clé Globex **18:00 America/New_York**), des tags et une liste de trades.

Le moteur (`src/engine`) est TypeScript pur, indépendant de l’UI.

| Famille | Ce qui est calculé |
|---|---|
| Trade | profit factor, payoff, espérance ($ et R), win rate, SQN (Van Tharp : sur R si chaque trade a un risque, sinon sur le PnL $), Kelly, z-score des séries, MAE / MFE (unité déduite de la colonne Profit), edge ratio, capture ratio |
| Journée | Sharpe **rf = 0**, annualisation **√252**, Sortino, Calmar (rendement **linéaire** annualisé / drawdown %, pas un CAGR), drawdown max / actuel / durée jusqu’à récupération, % de séances gagnantes, consistance = part du **meilleur jour dans le profit net** |
| Direction | long / short séparés, carte horaire (heure d’entrée **ET**), jour de semaine, instrument |
| Prop firm | trailing EOD / intraday / statique, lock, perte journalière, consistance, jours minimums — validation le jour où les conditions sont réunies (`passedOn`), agrégation **par date** (deux comptes le même jour = une journée), filtre par compte |
| Monte Carlo | bootstrap **i.i.d.** (ignore l’autocorrélation), `runs × horizon ≤ 5 M` tirages, enveloppe P5 / P50 / P95, worker + Annuler |

### Import

Trois formats reconnus automatiquement : **NinjaTrader · Trades**, **NinjaTrader · Exécutions**, **CΛNTO CSV**. Cultures en-US et fr-FR ; séparateur décimal déduit des colonnes de prix. Le PnL est **recalculé** depuis prix × valeur du point (NQ 20 $ · MNQ 2 $), commissions déduites ; la colonne Profit sert de contrôle.

- Trades : dédupliqués par empreinte `instrument \| direction \| qty \| heures \| prix`.
- Exécutions : appariement **FIFO** par compte et contrat, IDs d’exécution persistés, commissions au prorata. Un second import du même fichier ne recrée ni trade ni séance (`date \| account` fusionne).
- Fichiers **> 5 000 lignes** : parse dans un Worker, barre de progression, **Annuler** (`AbortSignal`) — pas de repli synchrone si on annule.

### Coffre

Export JSON `canto-vault-v2` (lecture v1 conservée). Toujours : séances, trades, notes, calendrier, réglages (clé API **et** blob chiffré exclus), comptes copieur, automates, `macroReleases`. Option **coffre lourd** (`backupIncludeHeavy`, défaut off) : barres + messages agent. Sauvegarde quotidienne dans un dossier choisi si `backupDaily` est coché. Sous Electron, une clé restaurée depuis un coffre navigateur est re-chiffrée tout de suite.

<div align="center">

**`01.3 · ANALYSE · CHAMPS · CARTES · EXCURSIONS`**

### Analyse

<img src="docs/media/analyse.png" alt="CΛNTO — Analyse : stratégies, tags, carte horaire, MAE/MFE" width="920"/>

<sub>Analyse — ranking par stratégie et par tag, carte horaire (jour × heure d’entrée), durée en position, nuage MAE × MFE, multiples de R.</sub>

</div>

<br/>

<div align="center">

**`01.4 · PROP FIRM · REGISTRE INDICATIF · REJEU`**

### Prop firm

<img src="docs/media/propfirm.png" alt="CΛNTO — Prop firm : registre de plans, rejeu Apex Full 50K" width="920"/>

<sub>Prop firm — registre Topstep, Apex, MyFundedFutures, Take Profit Trader, Tradeify, Earn2Trade. Ici : Apex Full 50K, trailing intra-journalier, objectif atteint.</sub>

</div>

Les chiffres des plans sont **indicatifs** (`version: 1`, `effectiveFrom` optionnel). Validez toujours auprès de la firme. Le libellé « Indicatif » est affiché dans le rail.

<br/>

<div align="center">

**`01.5 · MONTE CARLO · BOOTSTRAP I.I.D.`**

### Monte Carlo

<img src="docs/media/montecarlo.png" alt="CΛNTO — Monte Carlo : éventail de trajectoires, percentiles, ruine" width="920"/>

<sub>Monte Carlo — 2 000 simulations × 140 périodes, médiane / ruine / objectif, éventail de trajectoires, table de percentiles. Graine reproductible.</sub>

</div>

---

<a id="02-vis"></a>

<div align="center">

**`02 · VIS · VISUAL · GRAPHIQUE AVANCÉ · INDICATEURS`**

## Visual

### Bougies NQ / MNQ · catalogue extensible · projection de séance

<img src="docs/media/visual.png" alt="CΛNTO — Visual : bougies NQ 5 min, VWAP, EMA 21, Opening Range" width="920"/>

<sub>NQ · 5 min · démo synthétique — VWAP ±σ, EMA 21, Opening Range 15 min RTH, volume, rail d’indicateurs et séance projetée.</sub>

</div>

Graphique **lightweight-charts** : OHLCV, volume, croisement, marqueurs de trades (sorties gagnantes en LED Lab). Import CSV NinjaTrader Historical Data (en-tête Time/Open/High/Low/Close/Volume, ou `yyyyMMdd HHmmss;O;H;L;C;V`). Même règle Worker / Annuler au-delà de 5 000 lignes. Démo synthétique sans import.

**Catalogue** (`src/engine/indicators.ts`) — registre, pas un menu figé : un nouvel indicateur s’ajoute par définition.

| Indicateur | Rôle | Paramètres typiques |
|---|---|---|
| EMA / SMA | tendance court / moyen terme | période (21 / 50) |
| VWAP de séance | prix moyen pondéré volume, reset 18:00 ET | bandes ±1σ / ±2σ |
| Opening Range (RTH) | haut / bas des premières minutes cash | 5 / 15 / 30 min |
| Niveaux séance précédente | PDH / PDL / PDC | — |
| ATR | volatilité, panneau séparé | période 14 |
| Volume relatif (RVOL) | volume vs moyenne | période 20 |

Depuis Métrique › Séances › *Voir dans Visual*, les trades d’une journée se projettent sur le graphique.

---

<a id="03-cal"></a>

<div align="center">

**`03 · CAL · CALENDRIER · CATALYSEURS NASDAQ · REPÈRES`**

## Calendrier

### Grille + flux · FOMC / NFP / CPI · notes du jour · PnL superposé

<img src="docs/media/calendrier.png" alt="CΛNTO — Calendrier : grille septembre, FOMC, conseils débutant" width="920"/>

<sub>Grille septembre 2026 — familles colorées, PnL du journal dans les cellules, panneau du jour (FOMC + vente au détail) avec repères débutant.</sub>

</div>

Deux vues : **grille mensuelle** et **flux chronologique**. Filtres notable / majeur / dates estimées. Heures **locales et ET**, repères de séance Globex.

| Famille | Exemples |
|---|---|
| Fed | FOMC (dates officielles 2024–2026), conférences de presse |
| Emploi | NFP, rapport emploi |
| Inflation | CPI, PPI, PCE |
| Croissance | PIB, ventes au détail, ISM / PMI |
| Résultats | Mégacaps Nasdaq-100 |
| CME | Expirations, rollovers NQ / MNQ |
| Horaires | Fériés US, séances écourtées, bascules DST US / EU |

Chaque événement majeur porte un **repère débutant** (fenêtre à éviter, heure de publication). Le panneau droit accueille la **note du jour** et les rappels. Les catalyseurs officiels se fusionnent de façon additive (cache 24 h côté shell).

---

<a id="04-nte"></a>

<div align="center">

**`04 · NTE · NOTE · COFFRE DE NOTES · LIENS`**

## Note

### Markdown local · `[[wiki]]` · tags · graphe de force

<img src="docs/media/note.png" alt="CΛNTO — Note : éditeur Markdown, aperçu, backlinks, tags" width="920"/>

<sub>Vue scindée — source à gauche, aperçu assaini à droite, liens entrants / sortants, tags, propriétés. Note du jour en un clic.</sub>

</div>

Façon Obsidian, 100 % dans le coffre Dexie :

- Éditeur + aperçu (DOMPurify : pas de `style` / formulaires / SVG, URL `https?` / `mailto` / `#`)
- Liens `[[wiki]]`, backlinks, `#tags`, recherche plein texte
- **Note du jour** préremplie
- Graphe de force (nœuds = notes, arêtes = liens) — endormi au repos
- Modes : épinglée, `.md` brut, scindée, aperçu

---

<a id="05-agt"></a>

<div align="center">

**`05 · AGT · AGENT IA · PASSERELLE NATIVE · ORCHESTRATEUR`**

## Agent IA

### LLM local ou cloud via le process main · outils desk · JSON-RPC

<img src="docs/media/agent.png" alt="CΛNTO — Agent IA : suggestions, fournisseur, orchestrateur" width="920"/>

<sub>Passerelle — presets Ollama / LM Studio / OpenAI / OpenRouter / Anthropic, consigne système, outils du desk, orchestrateur `127.0.0.1:47117`.</sub>

</div>

Le renderer **ne fetch pas** le fournisseur : `streamChat` / `probe` passent par le shell Electron (`desk.llm`). La clé API est chiffrée par le trousseau OS (`safeStorage`) ; en clair elle n’est plus détenue sous Electron après enregistrement. Hosts autorisés : `127.0.0.1`, `localhost`, `api.openai.com`, `api.anthropic.com`, `openrouter.ai`, `api.moonshot.ai` (+ liste courte réglable). CSP sans `connect-src *`.

**Outils** — lecture libre ; écritures uniquement après **confirmation** (LLM) ou flag orch (défaut **off**) :

| Outil | Kind | Rôle |
|---|---|---|
| `desk_overview` | lecture | snapshot métriques + plan |
| `list_sessions` / `get_session` | lecture | journal |
| `search_notes` / `read_note` | lecture | coffre |
| `calendar_events` | lecture | catalyseurs |
| `propfirm_status` | lecture | rejeu du plan courant |
| `create_note` | écriture | nouvelle note (confirmée) |
| `annotate_session` | écriture | annotation de séance (confirmée) |

Plafonds : 6 tours, 8 appels / tour, 2 écritures / tour, `body` / `note` ≤ 20 000 caractères. Préambule « données non fiables » sur les retours d’outils. `copy.order` n’existe pas.

**Orchestrateur** (shell uniquement) : JSON-RPC 2.0 sur `ws://127.0.0.1:<port>`, jeton de session (comparaison à temps constant, **jamais** dans le status périodique — bouton *Copier le jeton*), origines navigateur refusées, 8 clients, 1 Mo / trame, 40 req/s.

---

<a id="06-bot"></a>

<div align="center">

**`06 · BOT · ATELIER D’AUTOMATES · CONCEPTION`**

## Bot

### Gabarits · grammaire · garde-fous prop firm — aucun ordre

<img src="docs/media/bot.png" alt="CΛNTO — Bot : atelier d'automates, gabarits ORB et VWAP" width="920"/>

<sub>Atelier — badge CONCEPTION, gabarits ORB 15 min et VWAP reclaim, garde-fous dérivés du plan Apex Full 50K et du calendrier (FOMC, expiration).</sub>

</div>

Phase **CONCEPTION** uniquement. Cycle de vie atelier : `brouillon → backtest → papier`. Le statut *papier* est un étiquetage — **aucun ordre n’est envoyé**.

| Gabarit | Idée |
|---|---|
| **ORB 15 min** | cassure de l’opening range RTH dans le sens du VWAP, 1 MNQ, max 2 tentatives |
| **VWAP reclaim** | reprise après −1σ en tendance EMA, sortie partielle +1σ |

Les garde-fous sont **imposés** à tout automate : coupe-circuit 30 % du DD max, perte journalière (80 % de la limite firme ou 40 % du DD), plafond de consistance, flat 16:59 ET, blackout ±15 min autour des catalyseurs majeurs des 10 prochains jours.

---

<a id="07-cpy"></a>

<div align="center">

**`07 · CPY · COPIEUR · RÉPLICATION DE COMPTES · CONCEPTION`**

## Copieur

### Topologie maître → suiveurs · sizing · filtres — transport WS à venir

<img src="docs/media/copieur.png" alt="CΛNTO — Copieur : topologie, filtres, kill switch DÉSARMÉ" width="920"/>

<sub>Copieur — DÉSARMÉ par défaut, pont WebSocket hors ligne, sizing fixe / ratio / risque, fenêtre horaire, blackout catalyseurs. Kill switch **Couper** = `enabled: false`.</sub>

</div>

Prototype persisté (comptes, règles, filtres). La **réplication d’ordres** attend le transport WebSocket de l’AddOn, spécifié dans [`docs/PONT-NINJATRADER.md`](docs/PONT-NINJATRADER.md) — **non écrit**. Sans ce transport, aucun ordre ne part.

| | |
|---|---|
| Sizing | fixe · ratio · risque, plafond de contrats, carte NQ ↔ MNQ |
| Filtres | fenêtre locale, budget latence, marge plancher (fraction du DD), stops / objectifs, blackout catalyseurs |
| Armement | défaut **off** ; bouton **Couper** désarme tout de suite |

---

<a id="pont"></a>

<div align="center">

**`PONT · NINJATRADER 8 · TRANSPORT FICHIER · ADDON`**

## Pont NinjaTrader 8

### CSV local · AddOn exécutions · idempotence — aucune télémétrie

</div>

Transport **fichier CSV** implémenté. Local uniquement.

| Mode | Comment |
|---|---|
| **Automatique** | Métrique › Pont NinjaTrader › dossier (défaut `Documents\NinjaTrader 8\export\CANTO`). Tout `.csv` / `.txt` déposé ou modifié est importé à écriture terminée (hash SHA-256 après stabilité : même contenu → skip). Les `.tmp` et `.seen.txt` sont ignorés. |
| **Temps réel** | Copier `ninjatrader/CantoBridge.cs` dans `Documents\NinjaTrader 8\bin\Custom\AddOns\` → NinjaScript Editor › Compile (F5). Chaque exécution → `executions-AAAA-MM-JJ.csv` (écriture atomique `.tmp` puis replace). IDs déjà écrits dans `executions-AAAA-MM-JJ.seen.txt` (survivent au restart NT). Buy / Sell uniquement — le reste est logué, pas d’écriture. |
| **Manuel** | Trade Performance › Trades ou Executions › Export CSV › Importer. |

L’export **Executions** ne contient pas de MAE/MFE (affiché dans l’UI d’import). Positions encore ouvertes : signalées, pas importées tant qu’elles ne sont pas clôturées.

Guide : **[docs/PONT-NINJATRADER.md](docs/PONT-NINJATRADER.md)**. L’étage WebSocket (copieur, automates live) est **spécifié, pas implémenté**.

---

<div align="center">

**`ARCH · COQUE · MOTEUR · COFFRE`**

## Architecture

</div>

```
electron/         shell (fenêtre sans cadre, lanceur, mise à jour,
                  dialogues, pont dossier, WebSocket JSON-RPC, secrets, proxy LLM)
ninjatrader/      AddOn CΛNTO Bridge (exécutions → CSV atomique + .seen)
scripts/          launch.mjs · copy-electron-assets · hash-release.mjs
CANTO.cmd         double-clic Windows → lanceur
build/            icône Lab (LED)
src/app/          boot, coque (titlebar 56 · rail 232 · status 28), onglets
src/design/       jetons, primitives, logotype CΛNTO, graphiques SVG
src/engine/       métriques, Monte Carlo, import NT, prop firm,
                  indicateurs, calendrier Nasdaq, outils agent, politique LLM / update
src/store/        Dexie (IndexedDB) + Zustand
src/modules/      un dossier par onglet (01…07)
tests/            Vitest — 115 tests (moteur, import, coffre, agent, updater)
vectors/          vecteurs JSON partagés (métriques / prop firm)
docs/             DESIGN.md · PONT-NINJATRADER.md · AUDIT.md · media/
```

Le moteur (`src/engine`) ne touche pas l’UI : indicateurs, outils agent et plans prop firm sont des registres. Les outils desk reçoivent des **ports** injectés — plus d’écriture directe dans les stores.

---

<div align="center">

**`DEV · NODE 22 · VITEST · ELECTRON`**

## Développement

</div>

```bash
npm install
npm run launch         # voie utilisateur (lanceur + desk)
npm run desk:dev       # Electron + Vite sans lanceur
npm run typecheck      # tsc app + electron
npm test               # Vitest (115)
npm run build          # bundle production
npm run check          # typecheck + test + build
npm run dist:win       # NSIS + portable
```

CI : GitHub Actions, `windows-latest`, Node 22, `npm ci` puis `typecheck` / `test` / `build`.

---

<div align="center">

**`SYS · SIΞRRΛSKΛ · LITHOGRAPHIE · LED #c41e3a`**

## Système visuel

</div>

Grammaire lithographique — **[docs/DESIGN.md](docs/DESIGN.md)** :

- Noir absolu, hairlines 1 px, grille **4 px** stricte, aucun arrondi
- Inter 700 (titres / valeurs, jamais &lt; 12 px) · JetBrains Mono capitales (libellés, jamais &lt; 11 px)
- Une seule LED Lab `#c41e3a` — point, filet, mot-clé ; jamais en aplat
- Wordmark CΛNTO tracé au trait (`square` / `miter`), un seul onglet inversé `CΛNTO · ARTEFACT 002`
- Vert / rouge : **sens uniquement** (direction, PnL, statut)
- Chrome : titlebar 56 · rail 232 · status 28 · lignes de table 36

---

## Suite

- Copieur actif + exécution papier des automates (transport WebSocket du pont)
- Backtest des automates sur les barres importées
- Agent : mémoire longue par trader, profils d’évolution du desk

---

## Avertissement

Le registre des prop firms est **indicatif** : les règles changent fréquemment et doivent être validées auprès de chaque firme. CΛNTO n’émet aucun conseil d’investissement. Les données restent sur le poste ; aucun serveur tiers n’est requis pour le journal. Bot et Copieur ne sont pas armables.

Licence : `UNLICENSED`. Tous droits réservés, SIΞRRΛSKΛ. Dépôt consultable. Réutilisation, fork publié ou usage commercial non autorisés sans accord.

<div align="center">
<br/>

**`SIΞRRΛSKΛ—LAB · CΛNTO · ARTEFACT 002 · REV. A · DESK OUTPUT · v1.1.2`**

</div>
