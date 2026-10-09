# Onglet 09 · CRY — spécification

Statut : validée en conception par l'ADMIN le 9 octobre 2026, à relire avant le plan d'implémentation.
Base : CΛNTO 3.5.0 (`main`, 0796a9d). Usage : **personnel**, rien ne part en Release.

## 1. Intention

**Ce que l'ADMIN a demandé.** Un onglet Crypto dans le desk qui reproduit le processus d'OpenMarket (chart, données de marché, alertes, watchlist, lecture et pilotage par un agent), directement dans le desk, et une façon correcte de se servir d'OpenMarket. Réponses de cadrage :

| Question | Réponse |
|---|---|
| Pour qui | L'ADMIN seulement ; des raccourcis sont admis, rien n'entre dans une Release |
| Le « même process » | Un chart piloté par l'agent : il lit, change marché, timeframe et indicateurs, trace des niveaux, pose des alertes ; l'opérateur confirme chaque écriture |
| Marchés | BTC et ONDO (Coinbase), ONE (Binance), ZIG (Bybit) |
| Binance | Température globale du marché, non liée à un actif |
| Alertes | Locales, desk ouvert seulement ; prix et température ; toast et `desk_events`, sans notification système |
| CVD Coinbase | Live depuis les trades, plus une option « CVD Binance » à historique complet |
| Disposition | Cockpit (§ 7) |
| Git | Commits locaux sur `main`, jamais de push |

**Hypothèses retenues sans question.** Bybit pour ZIG (absent de Coinbase et de Binance) ; une seule watchlist ; registre de marchés fixé dans le code en v1 ; aucune exécution d'ordre.

**Succès.** Desk lancé, interrupteur allumé : l'onglet 09 montre les quatre marchés en direct avec leurs voyants, la température, le CVD ; l'agent du desk et Claude Code (passerelle MCP) lisent le chart et, après confirmation, le modifient ; une alerte prix et une alerte température se déclenchent en toast ; les bougies BTC-USD 1h du desk égalent celles d'OpenMarket (§ 11). Interrupteur éteint : le desk est identique à la 3.5.0.

## 2. Décisions de l'ADMIN à consigner

À ajouter à `docs/THESE-AGENTIQUE.md` § 7 avant toute ligne de code (lot CRY0), avec le renvoi à cette spec. Elles lèvent, pour ce seul module, « Hors périmètre définitif. Crypto » (`docs/AUDIT.md:13`) et la consigne « aucun nouveau module UI » de `docs/AGENT-HARDENING.md` § 0.

8. **Module crypto personnel : oui, éteint par défaut.** La crypto entre dans le desk par l'onglet 09 · CRY, derrière un interrupteur que seul un dialogue du process principal allume. Portefeuille, discipline, Copieur, exécution, pont NinjaTrader et registre `instruments.ts` restent sans crypto.
9. **Hôtes des exchanges : liste à part.** Les hôtes Coinbase, Binance et Bybit forment `CRYPTO_HOSTS`, consultée seulement interrupteur allumé. Ils n'entrent pas dans `allowedHosts()` : leurs conditions n'ont pas été revues pour un logiciel distribué (`sources.ts` › `redistributable`).
10. **Geste du trader.** Une écriture de chart crypto que l'opérateur confirme vaut geste du trader : elle peut ouvrir un flux dans l'onglet Crypto. L'agent n'ouvre jamais de flux par une lecture. La décision 3 reste entière pour tout le reste du desk.

## 3. Périmètre

**v1.** Interrupteur ; onglet 09 en disposition Cockpit ; quatre marchés, six timeframes (1m, 5m, 15m, 1h, 4h, 1d) ; indicateurs CVD, CVD Binance, VWAP ancré 00:00 UTC, EMA, SMA, moyenne de volume, ATR, niveaux du jour UTC précédent ; température globale Binance ; alertes prix et température ; tracés (niveau, zone) ; dix outils d'agent exposés aussi par la passerelle MCP.

**Hors v1.** Ordres, comptes, positions ; marchés hors registre ; bougies sous la minute ; screener multi-venues ; dominance BTC (autre hôte) ; score composite de température ; notification système ; crypto dans les routines `pre_session_brief` et `session_debrief` ; mise à jour du README, des captures et du changelog (rien n'est publié).

## 4. Architecture

```
Renderer (CSP inchangée)                 Process principal
src/modules/crypto/   Cockpit UI          electron/crypto/
src/store/crypto.ts   état + Dexie v10    ├─ switch.ts    interrupteur (userData/crypto.json, dialogue)
        │  window.canto.crypto.*          ├─ hosts.ts     CRYPTO_HOSTS, contrôle https/wss
        └──────── IPC crypto:* ──────────►├─ rest.ts      historique et métadonnées (modèle guardedFetch)
                                          ├─ feeds.ts     clients ws par venue, heartbeat, backoff
src/engine/crypto/  (pur, partagé)        └─ temperature.ts relevés Binance
  markets.ts  bars.ts  indicators.ts  temperature.ts  alerts.ts
```

- **Moteur pur** `src/engine/crypto/` : n'importe ni store, ni modules, ni Electron (CLAUDE.md § 4). Réutilise les calculs d'`indicators.ts` qui ne dépendent pas d'une séance (EMA, SMA, ATR, moyenne de volume) ; réécrit ceux qui en dépendent (VWAP, niveaux) avec une ancre UTC. Partagé avec le main : `electron/tsconfig.sources.json`, `.d.ts` dans `electron/`, `vitest.config.mts`.
- **Interrupteur** : état tenu par le main dans `userData/crypto.json` (`{ "enabled": false }` par défaut). `crypto:requestEnable` ouvre un dialogue du main (Annuler par défaut) ; `crypto:disable` éteint sans dialogue, ferme tous les flux et vide les caches. Le renderer lit l'état, il ne l'écrit pas.
- **IPC** : méthodes nommées dans `electron/preload.ts` sous `window.canto.crypto`, chaque `ipcMain` derrière `trusted(e)` et une validation de forme ; tout refusé interrupteur éteint.
- **Flux** : comme pour NinjaTrader (`src/engine/marketdata/adapters/nt8.ts`), un adaptateur du moteur, `src/engine/crypto/port.ts`, implémente `MarketDataPort` (`src/engine/marketdata/port.ts:56-64`, `sourceId: 'crypto'`) avec un transport injecté qui appelle `window.canto.crypto` ; le réseau reste dans le main. Seul `src/store/crypto.ts` le consomme : `store/bars.ts`, `applyNtBar`, `QuoteBook` et `createPort` n'en voient rien.
- **Identifiants de marché** : `venue:symbole` (`coinbase:BTC-USD`, `coinbase:ONDO-USD`, `binance:ONEUSDT`, `bybit:ZIGUSDT`), propres aux tables crypto ; `isInstrumentId` (`src/store/db.ts:338`) n'est ni utilisé ni élargi.
- **Onglet** : `'crypto'` dans `TabId` (`src/store/ui.ts:5`), entrée `09 · CRY` dans `src/app/tabs.ts`, `lazy` dans `src/app/App.tsx`, raccourci `Digit([1-9])` (`src/app/Shell.tsx:92`). Interrupteur éteint : absent du rail, Ctrl+9 sans effet.
- **Intouchés** : `src/engine/instruments.ts`, `src/engine/portfolio/*`, `discipline`, `copier`, `execution`, `electron/nt-bridge/*`, `allowedHosts()`.

## 5. Marchés et données

| Marché | Historique (REST) | Live (WebSocket) | Volume acheteur dans les bougies |
|---|---|---|---|
| `coinbase:BTC-USD`, `coinbase:ONDO-USD` | `api.exchange.coinbase.com/products/{id}/candles` (300 par appel ; granularités 60, 300, 900, 3600, 21600, 86400 ; 4h agrégé depuis 1h) | `ws-feed.exchange.coinbase.com` : `ticker`, `matches`, `heartbeat` | Non |
| `binance:ONEUSDT` | `api.binance.com/api/v3/klines` (1 000 par appel) | `stream.binance.com:9443` : `@miniTicker`, `@kline_<tf>`, `@aggTrade` | Oui (taker buy base volume) |
| `bybit:ZIGUSDT` | `api.bybit.com/v5/market/kline?category=spot` (1 000 par appel) | `stream.bybit.com/v5/public/spot` : `tickers`, `kline.<tf>`, `publicTrade` | Non |

**Registre v1** : les quatre marchés affichables ci-dessus, fixés dans `src/engine/crypto/markets.ts`. `binance:BTCUSDT` et `binance:ONDOUSDT` n'y figurent que comme sources du CVD Binance : ils ne s'affichent pas, n'entrent pas dans la watchlist et ne portent pas d'alerte.

**`CRYPTO_HOSTS`** : `api.exchange.coinbase.com`, `ws-feed.exchange.coinbase.com`, `api.binance.com`, `stream.binance.com`, `fapi.binance.com`, `fstream.binance.com`, `api.bybit.com`, `stream.bybit.com`. REST en `https:` seulement, flux en `wss:` seulement, redirections refusées, contrôle d'hôte avant chaque connexion.

**Deux niveaux de flux.**
1. *Léger, permanent* (interrupteur allumé, desk ouvert, quel que soit l'onglet) : tickers de la watchlist et relevés de température. Nécessaire aux alertes.
2. *Lourd, à la vue* (onglet 09 affiché) : bougies et trades du chart actif ; ouverts au changement de marché ou de timeframe, fermés en quittant l'onglet.

**Historique.** À l'ouverture du chart, le main charge 500 bougies et les garde en mémoire (aucune bougie crypto dans Dexie). Précision et pas de prix lus une fois dans les métadonnées de chaque exchange (`quote_increment`, `PRICE_FILTER.tickSize`, `priceFilter.tickSize`), qui pilotent le `priceFormat` du chart.

**CVD.**
- Binance : complet, historique compris : delta = 2 × volume acheteur − volume.
- Coinbase et Bybit : live depuis les trades, ancré à l'ouverture du flux, affiché « depuis HH:MM ». Coinbase `matches.side` désigne le côté du **maker** : l'agresseur est l'autre côté. Bybit `publicTrade.S` désigne le côté du **taker**.
- Option « CVD Binance » pour BTC et ONDO (`BTCUSDT`, `ONDOUSDT`), étiquetée comme telle. ZIG n'en a pas.

**Débit.** Lectures très en dessous des limites publiées. 429 : attente de `Retry-After` puis backoff exponentiel plafonné à 60 s. 418 Binance (IP bannie) : venue coupée jusqu'au redémarrage, voyant « bloqué ».

**Voyants.** `connecting`, `live`, `reconnecting`, `stale`, `blocked`, `off`. La vie d'une connexion se juge au heartbeat ou au ping (Coinbase `heartbeat`, ping Binance, `ping` Bybit), pas à l'arrivée de trades : un marché peu liquide comme ZIG peut rester sans trade plus de 10 s sans être mort. `stale` après 30 s sans heartbeat. L'âge du dernier prix est affiché à part.

## 6. Température globale (Binance)

| Lecture | Source | Cadence |
|---|---|---|
| Funding médian des perps USDT, funding BTC | `fapi.binance.com/fapi/v1/premiumIndex` (tous les symboles, un appel) | 60 s |
| Largeur : part des paires spot USDT en hausse sur 24 h | `api.binance.com/api/v3/ticker/24hr` (tous les symboles) | 5 min |
| Liquidations sur 1 h glissante, longues et courtes | `fstream.binance.com/ws/!forceOrder@arr` | continu |
| Open interest BTC et ETH, variation 24 h | `fapi.binance.com/futures/data/openInterestHist` (`period=1h`) | 5 min |

Les liquidations sont un **minorant** : Binance ne pousse qu'une liquidation par symbole et par seconde ; la fenêtre repart de zéro à chaque lancement du desk. Ces deux faits sont écrits à l'écran et dans `crypto_temperature`. Chaque lecture porte son horodatage. Pas de score composite en v1.

## 7. Interface — disposition Cockpit

```
┌ 09 · CRY  [BTC-USD · COINBASE] [1H] [CVD] [CVD BINANCE]            ● CB ● BN ● BY ┐
├ FUNDING MÉDIAN      │ LARGEUR 24 H        │ LIQ. 1 H (MINORANT)  │ OPEN INTEREST 24 H ┤
├──────────────────────────────────────────────────────┬──────────────────────────────┤
│ chart : bougies · volume · CVD (ancrage affiché)     │ WATCHLIST                    │
│ tracés de l'agent en violet, étiquette AGENT         │ BTC · ONDO · ONE · ZIG       │
├───────────────────────────┬──────────────────────────┴──────────────────────────────┤
│ ALERTES (armées, déclenchées, non évaluées)  │ AGENT (en attente · historique)       │
└───────────────────────────┴─────────────────────────────────────────────────────────┘
```

- Jetons de `src/design/tokens.css` seulement ; `tests/design-guard.test.ts` reste vert. Le rouge `--gold` ne marque que le vivant (flux live, écriture en attente) ; gains et pertes en `--mint` / `--ember` ; tracés de l'agent en `--violet` (catégorie).
- Chart : `src/modules/visual/Chart.tsx` réutilisé, `priceFormat` (précision, `minMove`) passé par symbole au lieu de `precision: 2, minMove: 0.25` (`Chart.tsx:145`).
- Toutes les chaînes par `tr(fr, en, es)`.
- Le tiroir Agent liste l'écriture en attente (avec Refuser / Confirmer, mêmes effets que le dialogue du desk) et les écritures passées, lues ou confirmées.
- Maquette de référence : variante B validée le 9 octobre 2026.

## 8. Alertes

**Persistance.** Dexie `version(10)` avec trois tables : `cryptoWatchlist`, `cryptoAlerts`, `cryptoDrawings`. Chacune a son entrée `CHECKS` (`src/store/db.ts`), son export et sa restauration de coffre, et reste lisible par les coffres plus anciens. L'état du chart (marché, timeframe, indicateurs) passe par `setSetting('crypto.chart')` avec son assainisseur.

**Modèle.** `{ id, target, kind, level, mode, author, state, reason?, createdAt, lastTriggeredAt? }`
- `target` : un marché **de la watchlist**, ou `temperature`.
- `kind` prix : `price_above`, `price_below`.
- `kind` température : `funding_median_above`, `funding_median_below`, `liquidations_long_1h_above`, `liquidations_short_1h_above`, `breadth_above`, `breadth_below`.
- `level`, dans l'unité affichée : prix dans la devise de cotation du marché ; funding en pourcentage par intervalle de financement (`0.01` = 0,01 %) ; liquidations en dollars US ; largeur en pourcentage de paires (`40` = 40 %).
- `mode` : `once` ou `rearm`. `author` : `trader` ou `agent`.
- `state` : `armed`, `triggered`, `paused`, `not_evaluated` (avec `reason`).

**Évaluation.** Le prix est évalué à chaque ticker, la température à chaque relevé, avec l'hystérésis de `ThresholdWatch` (`src/engine/agent/events.ts:123`). Aucune évaluation sur une donnée `stale` ou `blocked` : l'état passe à `not_evaluated` avec sa raison, et le dit à l'écran.

**Signal.** Toast du desk (`useUi.toast`) et événement `crypto_alert`, nouveau genre ajouté à `DESK_EVENT_KINDS` (`src/engine/agent/catalog.ts:132`) et au tuple de `electron/agent/catalog.d.ts`. L'agent le lit par `desk_events`, l'orchestrateur le diffuse. Aucune notification système.

## 9. Agent et passerelle MCP

Processus calqué sur OpenMarket : lire ce qui est ouvert, proposer **une** modification visible, attendre la confirmation, appliquer, dire ce qui a changé. Les mêmes outils servent à l'agent du desk et aux clients de la passerelle `127.0.0.1:47118`.

| Outil | Genre | Arguments | Équivalent OpenMarket |
|---|---|---|---|
| `crypto_status` | lecture | — | `chart_status` |
| `crypto_chart_read` | lecture | `bars?` 0–300 | `chart_read` |
| `crypto_watchlist_get` | lecture | — | `watchlist_get` |
| `crypto_temperature` | lecture | — | — |
| `crypto_alert_list` | lecture | — | `alert_list` |
| `crypto_chart_set` | écriture | `market?`, `timeframe?` (au moins un) | `chart_symbol`, `chart_interval` |
| `crypto_indicator_set` | écriture | `action` add/remove, `indicator`, `params?` | `chart_indicator_add/remove` |
| `crypto_drawing_set` | écriture | `action` add/remove, `kind` level/zone, `market`, `price` ou `from`/`to`, `label?`, `id?` | `chart_drawing_add/remove` |
| `crypto_alert_set` | écriture | `action` create/delete, `target`, `kind`, `level`, `mode`, `id?` | `alert_create/delete` |
| `crypto_watchlist_set` | écriture | `action` add/remove, `market` | `watchlist_add/remove_symbols` |

- **Registre seulement** : `market` est une valeur du registre crypto ; aucun argument n'accepte d'URL ni d'hôte (`docs/THESE-AGENTIQUE.md:53`). `label` borné par `SHORT_ARGS`.
- **Lectures** : rien qu'à partir de l'état ouvert. Onglet fermé → réponse « onglet fermé » ; jamais d'ouverture de flux.
- **Écritures** : confirmées par l'opérateur côté LLM (`confirmFn`) ; derrière `allowWrite` côté orchestrateur et `allowWrites` côté passerelle. Limite de 2 écritures par tour inchangée (`src/engine/agent/ports.ts`).
- **Interrupteur éteint** : outils masqués de la liste (`electron/mcp-server.ts:314`) **et** refusés à l'appel (`:328`, même double verrou), y compris pour l'agent du desk.
- **À toucher** : `DESK_TOOL_KINDS`, `DESK_TOOL_HINTS`, `DESK_TOOL_TITLES` (fr/en/es) dans `catalog.ts` ; `createDeskTools`, `toolBlurb`, `EMPTY_PORTS` dans `tools.ts` ; `DeskPorts` ; et les tests à liste figée : `mcp-catalog`, `orchestrator-allowlist`, `agent-tool-schemas`, `agent-injection` (chaque écriture), `mcp-server`, `agent-events`.

## 10. OpenMarket : usage correct

1. **Modèle de grammaire.** Les outils du § 9 en reprennent le sens et citent l'équivalent dans leur description : un agent qui sait piloter l'un sait piloter l'autre.
2. **Oracle de recette.** Par Claude Code, en lecture, sur le plan Free : comparaison des bougies et du CVD du desk avec `chart_read` (§ 11).
3. **Jamais dans le desk.** Le desk ne charge aucun serveur MCP tiers (`docs/THESE-AGENTIQUE.md:53`) ; OpenMarket reste un connecteur de Claude Code, au niveau « Read and control charts », jamais « trade ».
4. Ses données ne couvrent pas CME : il ne sert à rien côté futures.

## 11. Tests et recette

**Par lot**, protocole du `CLAUDE.md` § 2 : un ticket, un commit, un test ; `npm run typecheck && npm test` vert avant le suivant ; `npm run check` et `npm run electron:compile` en fin de lot.

- **Moteur** (Vitest, environnement node, `TZ=UTC`) : registre ; agrégation 4h ; CVD Binance (formule) et CVD trades (inversion maker de Coinbase, taker de Bybit) ; VWAP et niveaux ancrés UTC ; température (médiane, largeur, fenêtre glissante de liquidations) ; alertes (seuils, hystérésis, `once`/`rearm`, refus sur `stale`).
- **Réseau** : faux serveur WebSocket local (`ws`, déjà dépendance) qui rejoue coupure, 429, 418 et silence de heartbeat ; faux `fetch` pour l'historique ; contrôle d'hôte (`https:`/`wss:`, hôte hors liste refusé, redirection refusée).
- **Politique** : `CRYPTO_HOSTS` n'apparaît jamais dans `allowedHosts()` ; interrupteur éteint → IPC refusés, outils masqués et refusés, onglet absent ; `tests/sources.test.ts` inchangé.
- **Interface** (jsdom, `Chart` et `window.canto` simulés) : rendu Cockpit, voyants, ancrage du CVD affiché, tiroir Agent.
- **Coffre** : export puis restauration avec les trois tables ; restauration d'un coffre v9 sans elles.
- **Listes figées** mises à jour : `tabs.test.ts`, catalogues de l'agent et de la passerelle, `agent-events`.

**Recette (lot CRY7)**, desk lancé par l'ADMIN (`npm run desk:dev`) :
1. Interrupteur éteint : desk identique à la 3.5.0.
2. Allumé : les quatre voyants passent à `live`, la température se remplit, le CVD affiche son ancrage.
3. Oracle BTC-USD Coinbase 1h : les 50 dernières bougies closes du desk égalent `chart_read bars:50` d'OpenMarket (O, H, L, C au pas de prix ; volume à ±1 %).
4. Oracle ONE Binance : le CVD du desk suit celui d'OpenMarket en direction, bougie par bougie, sur 50 bougies (chart temporaire OpenMarket, avec l'accord de l'ADMIN au moment de la recette).
5. Une alerte prix et une alerte funding se déclenchent en toast et apparaissent dans `desk_events`.
6. Par Claude Code sur la passerelle : `crypto_chart_read` égale l'écran ; `crypto_indicator_set` ajoute EMA 200 après confirmation.

## 12. Organisation

- **Prérequis** : Node 22.12 ou plus (absent de ce poste), puis `npm install` dans `c-nto`. Aucune autre dépendance : `ws`, `lightweight-charts` et `dexie` sont déjà là.
- **Lots** : CRY0 décisions, interrupteur et coquille de l'onglet · CRY1 moteur · CRY2 réseau · CRY3 store et Dexie v10 · CRY4 interface Cockpit · CRY5 alertes · CRY6 outils de l'agent et passerelle · CRY7 recette.
- **Git** : commits locaux sur `main`, messages courts en français préfixés `CRY<lot>.<n>`, aucune attribution (CLAUDE.md § 1), aucun push. Constats et preuves dans `docs/AUDIT.md`, section « Onglet 09 · CRY ».

## 13. Risques et points ouverts

- **Conditions des exchanges.** Usage personnel de données publiques : admis en pratique, non revu juridiquement. Toute distribution du module exige une revue des conditions et une nouvelle décision (D9).
- **Interrupteur allumé dans une Release.** L'état vit dans `userData` du poste, jamais dans le dépôt ; un test vérifie le défaut `false`.
- **ONE** : écart de 10 à 18 % entre Binance, Gate et KuCoin relevé le 9 octobre 2026. La venue de référence est Binance, et elle est affichée.
- **ZIG** : peu liquide, d'où la vie jugée au heartbeat (§ 5) et l'âge du dernier prix affiché.
- **Bannissement Binance (418)** : une seule IP, celle du poste. Le backoff et la coupure de venue l'évitent ; si elle survient, la température et ONE s'arrêtent jusqu'au redémarrage.
- **CVD Coinbase/Bybit** : sans passé avant l'ouverture du flux, par construction (§ 5).
