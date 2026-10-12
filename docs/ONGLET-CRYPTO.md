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
| Design | Celui du desk 3.5.0, comme chaque onglet : composition de 02 · VIS, primitives du Système 3.4 (§ 7) |
| Git | Commits locaux sur `main`, jamais de push |

**Hypothèses retenues sans question.** Bybit pour ZIG (absent de Coinbase et de Binance) ; une seule watchlist ; registre de marchés fixé dans le code en v1 ; aucune exécution d'ordre.

**Succès.** Desk lancé, interrupteur allumé : l'onglet 09 montre les quatre marchés en direct avec leurs voyants, la température, le CVD ; l'agent du desk et les clients de la passerelle MCP lisent le chart ; l'agent du desk le modifie après la confirmation de l'opérateur, un client de la passerelle ou de l'orchestrateur derrière `orchestratorAllowWrite` (éteint par défaut), sans dialogue (`CLAUDE.md` § 5) ; une alerte prix et une alerte température se déclenchent en toast ; les bougies BTC-USD 1h du desk égalent celles d'OpenMarket (§ 11) ; l'onglet ne se distingue pas des autres onglets du desk. Interrupteur éteint : le desk est celui de la 3.5.0, plus l'onglet 09 en état vide, sans flux ni outil.

## 2. Décisions de l'ADMIN à consigner

À ajouter à `docs/THESE-AGENTIQUE.md` § 7 avant toute ligne de code (lot CRY0), avec le renvoi à cette spec. Elles lèvent, pour ce seul module, « Hors périmètre définitif. Crypto » (`docs/AUDIT.md:13`) et la consigne « aucun nouveau module UI » de `docs/AGENT-HARDENING.md` § 0.

8. **Module crypto personnel : oui, éteint par défaut.** La crypto entre dans le desk par l'onglet 09 · CRY, derrière un interrupteur que seul un dialogue du process principal allume. Portefeuille, discipline, Copieur, exécution, pont NinjaTrader et registre `instruments.ts` restent sans crypto.
9. **Hôtes des exchanges : liste à part.** Les hôtes Coinbase, Binance et Bybit forment `CRYPTO_HOSTS`, consultée seulement interrupteur allumé. Ils n'entrent pas dans `allowedHosts()` : leurs conditions n'ont pas été revues pour un logiciel distribué (`sources.ts` › `redistributable`).
10. **Geste du trader.** Une écriture de chart crypto que l'opérateur confirme vaut geste du trader : elle peut ouvrir un flux dans l'onglet Crypto. L'agent n'ouvre jamais de flux par une lecture. La décision 3 reste entière pour tout le reste du desk.

## 3. Périmètre

**v1.** Interrupteur ; onglet 09 au design du desk (composition de 02 · VIS) ; quatre marchés, six timeframes (1m, 5m, 15m, 1h, 4h, 1d) ; indicateurs CVD, CVD Binance, VWAP ancré 00:00 UTC, EMA, SMA, moyenne de volume, ATR, niveaux du jour UTC précédent ; température globale Binance ; alertes prix et température ; tracés (niveau, zone) ; dix outils d'agent exposés aussi par la passerelle MCP.

**Hors v1.** Ordres, comptes, positions ; marchés hors registre ; bougies sous la minute ; screener multi-venues ; dominance BTC (autre hôte) ; score composite de température ; notification système ; crypto dans les routines `pre_session_brief` et `session_debrief` ; mise à jour du README, des captures et du changelog (rien n'est publié).

## 4. Architecture

```
Renderer (CSP inchangée)                       Process principal
src/modules/crypto/   onglet 09 · CRY           electron/crypto-switch.ts       interrupteur (userData/crypto.json, dialogue)
src/store/crypto*.ts  état + réglages crypto.*  electron/crypto-net.ts          fetch gardé (https, hôte, 3xx, 429, 418)
        │  window.canto.crypto.*                electron/crypto-feeds.ts        sockets par venue, ping, reconnexion
        └──────── IPC crypto:* ────────────────►electron/crypto-temperature.ts  relevés Binance
                                                electron/crypto-electron.ts     branchement net.fetch + ws, IPC
src/engine/crypto/  (pur)                       electron/crypto/*.d.ts          typage des modules partagés
  partagés avec le main, sans import : markets.ts  venues.ts  tradeBars.ts  temperature.ts
  renderer seulement : indicators.ts  cvd.ts  alerts.ts  persist.ts  port.ts  views.ts
```

- **Moteur pur** `src/engine/crypto/` : n'importe ni store, ni modules, ni Electron (CLAUDE.md § 4). Réutilise les définitions d'`indicators.ts` qui ne dépendent pas d'une séance (EMA, SMA, ATR, moyenne de volume) ; réécrit celles qui en dépendent (VWAP, niveaux) avec une ancre UTC. Les modules partagés avec le main n'ont aucun import (pas même `@/…` ni `../bars`, qui tirent `@/i18n`) : listés dans `electron/tsconfig.sources.json`, typés par `electron/crypto/<nom>.d.ts`, reliés dans la carte `engineSource` de `vitest.config.mts`. Le réseau vit dans `electron/crypto-*.ts` ; `electron/main.ts` ne contient jamais `net.fetch` (`tests/sources.test.ts`).
- **Interrupteur** : état tenu par le main dans `userData/crypto.json` (`{ "enabled": false }` par défaut). `crypto:enable` ouvre un dialogue du main (Annuler par défaut) ; `crypto:disable` éteint sans dialogue, ferme tous les flux et vide les caches. Le renderer lit l'état, il ne l'écrit pas.
- **IPC** : méthodes nommées dans `electron/preload.ts` sous `window.canto.crypto`, chaque `ipcMain` derrière `trusted(e)` et une validation de forme ; tout refusé interrupteur éteint.
- **Flux** : comme pour NinjaTrader (`src/engine/marketdata/adapters/nt8.ts`), un adaptateur du moteur, `src/engine/crypto/port.ts`, implémente `MarketDataPort` (`src/engine/marketdata/port.ts:56-64`, `sourceId: 'crypto'`) avec un transport injecté qui appelle `window.canto.crypto` ; le réseau reste dans le main. Seul `src/store/crypto.ts` le consomme : `store/bars.ts`, `applyNtBar`, `QuoteBook` et `createPort` n'en voient rien.
- **Identifiants de marché** : `venue:symbole` (`coinbase:BTC-USD`, `coinbase:ONDO-USD`, `binance:ONEUSDT`, `bybit:ZIGUSDT`), propres aux tables crypto ; `isInstrumentId` (`src/store/db.ts:340`) n'est ni utilisé ni élargi.
- **Onglet** : `'crypto'` dans `TabId` (`src/store/ui.ts:5`), entrée `09 · CRY` dans `src/app/tabs.ts`, `lazy` dans `src/app/App.tsx`, raccourci `Digit([1-9])` (`src/app/Shell.tsx:92`). Interrupteur éteint : l'onglet reste sur le rail et Ctrl+9 l'ouvre, en état vide (§ 7), sans flux ni outil.
- **Intouchés** : `src/engine/instruments.ts`, `src/engine/portfolio/*`, `discipline`, `copier`, `execution`, `electron/nt-bridge/*`, `allowedHosts()`.

## 5. Marchés et données

| Marché | Historique (REST) | Live (WebSocket) | Volume acheteur dans les bougies |
|---|---|---|---|
| `coinbase:BTC-USD`, `coinbase:ONDO-USD` | `api.exchange.coinbase.com/products/{id}/candles` (300 par appel ; granularités 60, 300, 900, 3600, 21600, 86400 ; 4h agrégé depuis 1h) | `ws-feed.exchange.coinbase.com` : `ticker`, `matches`, `heartbeat` | Non |
| `binance:ONEUSDT` | `api.binance.com/api/v3/klines` (1 000 par appel) | `stream.binance.com:9443/ws` : `@miniTicker`, `@kline_<tf>` | Oui (taker buy base volume) |
| `bybit:ZIGUSDT` | `api.bybit.com/v5/market/kline?category=spot` (1 000 par appel) | `stream.bybit.com/v5/public/spot` : `tickers`, `publicTrade` | Non |

**Bougies live.** Binance : le flux `@kline_<tf>` porte la bougie entière et son volume acheteur. Coinbase et Bybit : le main construit les bougies à partir des trades (`TradeBarBuilder`, `src/engine/crypto/tradeBars.ts`), avec le volume acheteur de l'agresseur. La bougie entamée au moment de l'abonnement reste celle de l'historique REST (plus haut, plus bas et clôture mis à jour par les trades, volume inchangé, sans volume acheteur) : le CVD commence à la première bougie observée en entier.

**Registre v1** : les quatre marchés affichables ci-dessus, fixés dans `src/engine/crypto/markets.ts`. `binance:BTCUSDT` et `binance:ONDOUSDT` n'y figurent que comme sources du CVD Binance : ils ne s'affichent pas, n'entrent pas dans la watchlist et ne portent pas d'alerte.

**`CRYPTO_HOSTS`** : `api.exchange.coinbase.com`, `ws-feed.exchange.coinbase.com`, `api.binance.com`, `stream.binance.com`, `fapi.binance.com`, `fstream.binance.com`, `api.bybit.com`, `stream.bybit.com`. REST en `https:` seulement, flux en `wss:` seulement, redirections refusées, contrôle d'hôte avant chaque connexion.

**Deux niveaux de flux.**
1. *Léger, permanent* (interrupteur allumé, desk ouvert, quel que soit l'onglet) : tickers de la watchlist et relevés de température. Nécessaire aux alertes.
2. *Lourd, à la vue* (onglet 09 affiché) : bougies et trades du chart actif ; ouverts au changement de marché ou de timeframe, fermés en quittant l'onglet.

**Historique.** À l'ouverture du chart, le main charge 500 bougies, ou davantage en 1m et 5m pour remonter au moins à 00:00 UTC de la veille (VWAP et niveaux du jour UTC) : jusqu'à 2 880 bougies en 1m et 576 en 5m. Coinbase 4h : 300 bougies (environ 50 jours). Elles restent en mémoire (aucune bougie crypto dans Dexie). Le pas de prix de chaque marché a été relevé dans les métadonnées des exchanges le 9 octobre 2026 (`quote_increment`, `PRICE_FILTER.tickSize`, `priceFilter.tickSize`) et fixé dans le registre, où il pilote le `priceFormat` du chart : `coinbase:BTC-USD` 0,01 ; `coinbase:ONDO-USD` 0,00001 ; `binance:ONEUSDT` 0,000001 ; `bybit:ZIGUSDT` 0,00001 ; sources du CVD Binance `binance:BTCUSDT` 0,01 et `binance:ONDOUSDT` 0,0001.

**CVD.**
- Binance : complet, historique compris : delta = 2 × volume acheteur − volume.
- Coinbase et Bybit : live depuis les trades, ancré à l'ouverture du flux, affiché « depuis HH:MM ». Coinbase `matches.side` désigne le côté du **maker** : l'agresseur est l'autre côté. Bybit `publicTrade.S` désigne le côté du **taker**.
- Option « CVD Binance » pour BTC et ONDO (`BTCUSDT`, `ONDOUSDT`), étiquetée comme telle. ZIG n'en a pas.

**Débit.** Lectures très en dessous des limites publiées. 429 : attente de `Retry-After` puis backoff exponentiel plafonné à 60 s. 418 Binance (IP bannie) : venue coupée jusqu'au redémarrage, voyant « bloqué ».

**Voyants.** `connecting`, `live`, `reconnecting`, `stale`, `blocked`, `off`. La vie d'une connexion se juge à son activité, pas à l'arrivée de trades : un marché peu liquide comme ZIG peut rester sans trade plusieurs minutes sans être mort. Le main envoie un ping de protocole toutes les 15 s ; tout message ou pong compte comme activité ; Coinbase pousse son canal `heartbeat` chaque seconde ; Bybit reçoit en plus `{"op":"ping"}` toutes les 20 s, comme le demande sa documentation. `stale` après 30 s sans activité, puis reconnexion. L'âge du dernier prix est affiché à part.

## 6. Température globale (Binance)

| Lecture | Source | Cadence |
|---|---|---|
| Funding médian des perps USDT, funding BTC | `fapi.binance.com/fapi/v1/premiumIndex` (tous les symboles, un appel) | 60 s |
| Largeur : part des paires spot USDT en hausse sur 24 h | `api.binance.com/api/v3/ticker/24hr` (tous les symboles) | 5 min |
| Liquidations sur 1 h glissante, longues et courtes | `fstream.binance.com/market/ws/!forceOrder@arr` | continu |
| Open interest BTC et ETH, variation 24 h | `fapi.binance.com/futures/data/openInterestHist` (`period=1h`) | 5 min |

Le flux des liquidations est servi sur la route `/market` de `fstream.binance.com` ; le chemin sans route (`/ws/`) accepte la connexion mais n'en envoie plus.

Les liquidations sont un **minorant** : Binance ne pousse qu'une liquidation par symbole et par seconde ; la fenêtre repart de zéro à chaque lancement du desk. Ces deux faits sont écrits à l'écran et dans `crypto_temperature`. Chaque lecture porte son horodatage. Pas de score composite en v1.

## 7. Interface — design du desk 3.5.0

Décision de l'ADMIN (9 octobre 2026) : l'onglet reprend le **design final de la 3.5.0**, comme chaque onglet. Mêmes primitives (`src/design/primitives.tsx`), même châssis (`ModuleHeader`, `ModuleContent`, `src/app/Shell.tsx:358-381`), même composition que 02 · VIS (`src/modules/visual/Visual.tsx`). Aucune mise en page, aucun composant visuel et aucun jeton nouveaux. Références : `docs/DESIGN.md` (Système 3.4) et les planches `docs/media/visual.png`, `copieur.png`, `portefeuille.png`, `agent.png`.

**En-tête.** `ModuleHeader tab="crypto"` : plaque `CRY │ Crypto · CHART · TEMPÉRATURE · ALERTES` (libellé et tagline en trois langues dans `src/app/tabs.ts`), `meta` `4 MARCHÉS · 3 VENUES`. Actions, dans l'ordre de Visual (`Visual.tsx:273-298`) :
- `Tag` d'état du flux du chart : `mint` « direct », `ember` « données périmées », rien sinon ;
- `<select>` du marché (`BTC-USD · Coinbase`, `ONDO-USD · Coinbase`, `ONEUSDT · Binance`, `ZIGUSDT · Bybit`) à la place du sélecteur de série ;
- `Segmented` des six timeframes.

**Corps.** `ModuleContent noPad`, puis la grille `layout` de Visual : `chartWrap` à gauche, colonne `side` à droite.

*Chart.*
- Ligne `legend` de Visual : `BTC-USD · 1h`, date et heure de la bougie, O H L C colorés par `signClass`, Vol ; au survol, la valeur de chaque indicateur ; l'ancrage du CVD (« CVD depuis 11:43 » ou « CVD Binance »).
- Puce `stamp` : `Tag tone="mint"` « Coinbase · direct », `Tag tone="ember"` « Coinbase · figé », `Tag tone="ice"` « Historique » avant le premier tick.
- `Chart.tsx` réutilisé, avec deux props optionnelles, sans effet sur Visual quand elles sont absentes : `priceFormat` (précision et pas du marché, au lieu de `precision: 2, minMove: 0.25`, `Chart.tsx:145`) et `priceLines` (tracés en `--violet`, titre `AGENT` quand l'agent les a posés). `fmtPrice` (`src/lib/format.ts:75`) gagne un nombre de décimales optionnel, 2 par défaut.
- Le CVD est une `IndicatorLine` `pane: 'pane'` : panneau propre, déjà géré par `Chart.tsx:222-239`.

*Colonne* (`sideSection`, `sideTitle`, `desc` de Visual), dans cet ordre :
1. **Marchés · 4** — une ligne par marché au format `tradeRow` : `Led` et symbole, `Etiquette` de la venue, dernier prix, variation 24 h en `signClass`. Un clic change le marché du chart.
2. **Indicateurs · n** — les cartes de Visual à l'identique (`Toggle`, nom, ×, paramètres, description) et le bouton `+ Ajouter` ; catalogue crypto : CVD, CVD Binance, VWAP 00:00 UTC, EMA, SMA, volume relatif, ATR, niveaux du jour UTC précédent. Le VWAP 00:00 UTC et les niveaux du jour UTC précédent ne se calculent que pour une journée dont la fenêtre chargée couvre le début (`bars[0].time <= début du jour`) : sinon la ligne s'interrompt, plutôt que d'afficher une valeur fausse.
3. **Température · Binance** — une `Regle` par lecture, six en tout (`Funding médian ···· +0,0030 %`, `Largeur 24 h ···· 38 %`, `Liq. 1 h · long ···· 4,1 M$`, `Liq. 1 h · short ···· 1,2 M$`, `OI 24 h · BTC ···· +2,4 %`, `OI 24 h · ETH ···· +1,1 %` ; libellés courts, les longs ne tiennent pas dans la colonne : CRY4.4), puis une `desc` avec l'heure de chaque lecture et « liquidations : minorant ».
4. **Alertes · n** — une ligne par alerte : cible, condition, niveau, état, `Etiquette` `[ AGENT ]` si l'agent l'a posée. `+ Ajouter` ouvre une `Modal` du desk (`Field`, `<select>`, `input`, boutons `ghost` et `gold`), sur le modèle de l'import de barres (`Visual.tsx:517-599`).
5. **Source** — `desc` à la manière de Visual : venue, nombre de bougies, période ; un voyant par venue (`connecting` … `blocked`) ; « Données publiques des exchanges, usage personnel. » ; bouton `ghost` « Éteindre le module ».
6. **Agent** — dernières écritures de l'agent sur l'onglet (heure, outil, effet) au format `tradeRow`. La confirmation passe par le `ConfirmDialog` du desk (`Shell.tsx:332`), comme toute écriture de l'agent.

**Interrupteur éteint.** L'onglet garde sa place sur le rail. `ModuleContent` montre `Empty` : titre, texte, et `Button variant="chamfer"` « Activer le module crypto », seule action principale de l'écran, qui demande le dialogue du process principal.

**Styles.** `src/modules/crypto/Crypto.tsx` importe `src/modules/visual/visual.module.css` pour tout ce qu'il partage avec Visual : rendu identique, aucune copie. `crypto.module.css` ne porte que les lignes de marché et d'alerte, en jetons de `tokens.css`, et la marge droite de la colonne (`.side`), qui laisse libre la plaque verticale du châssis (CRY4.4). `--gold` ne marque que le vivant ; tracés et séries d'indicateurs en couleurs catégorielles (`--violet`, `--ice`, `--amber`) ; aucun `--lab`. Chaînes par `tr(fr, en, es)`. `tests/design-guard.test.ts` reste vert.

**Preuve visuelle.** Au lot CRY4, capture de l'onglet par le chemin des planches du README, à poser à côté de `docs/media/visual.png`.

## 8. Alertes

**Persistance.** Comme les indicateurs de Visual (`chart.indicators`, `src/store/bars.ts:179`), l'état crypto vit dans quatre lignes de la table `settings` : `crypto.chart` (marché, timeframe, indicateurs), `crypto.watchlist`, `crypto.alerts` (50 au plus), `crypto.drawings` (100 au plus). Chaque clé a son assainisseur dans `SETTING_ROW_SANITIZERS` (`src/store/db.ts:601`), le même que celui qu'applique le store à la lecture. Pas de nouvelle version Dexie : rien à migrer.

**Modèle.** `{ id, target, kind, level, mode, author, state, createdAt, lastTriggeredAt? }`, plus un état d'évaluation calculé, jamais enregistré : `evaluable` et sa raison.
- `target` : un marché **de la watchlist**, ou `temperature`.
- `kind` prix : `price_above`, `price_below`.
- `kind` température : `funding_median_above`, `funding_median_below`, `liquidations_long_1h_above`, `liquidations_short_1h_above`, `breadth_above`, `breadth_below`.
- `level`, dans l'unité affichée : prix dans la devise de cotation du marché ; funding en pourcentage par intervalle de financement (`0.01` = 0,01 %) ; liquidations en dollars US ; largeur en pourcentage de paires (`40` = 40 %).
- `mode` : `once` ou `rearm`. `author` : `trader` ou `agent`.
- `state` enregistré : `armed`, `triggered`, `paused`. À l'écran et dans `crypto_alert_list`, une alerte dont la donnée est `stale` ou `blocked` s'affiche « non évaluée », avec sa raison.

**Évaluation.** Le prix est évalué à chaque ticker, la température à chaque relevé, par un évaluateur de croisement (`CrossWatch`, `src/engine/crypto/alerts.ts`) qui reprend la sémantique de `ThresholdWatch` (`src/engine/agent/events.ts:123`) : la première lecture pose le côté sans alerter ; un franchissement alerte une seule fois ; une alerte `rearm` ne se réarme qu'après un retour au-delà de la bande d'hystérésis (prix : 0,1 % du niveau ; funding : 0,0005 point ; liquidations : 5 % du niveau ; largeur : 1 point). Aucune évaluation sur une donnée `stale` ou `blocked`.

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
- **Lectures** : rien qu'à partir de l'état ouvert. Onglet fermé → `crypto_chart_read` répond « onglet fermé » ; jamais d'ouverture de flux. Les « bougies visibles » sont les 160 dernières, la fenêtre que `Chart.tsx:215` montre à l'ouverture.
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
- **Interface** (jsdom, `Chart` et `window.canto` simulés, sur le modèle de `tests/visual-follow-reset.test.ts`) : en-tête et actions, légende et puce de source, six sections de la colonne dans l'ordre, ancrage du CVD affiché, état vide interrupteur éteint ; Visual inchangé sans les nouvelles props de `Chart.tsx`.
- **Réglages** : assainisseurs des lignes `crypto.*` (valeur valide gardée, invalide écartée, marché hors registre retiré, plafonds tenus), à la lecture du store comme à la restauration d'un coffre v1.
- **Listes figées** mises à jour : `tabs.test.ts`, catalogues de l'agent et de la passerelle, `agent-events`.

**Recette (lot CRY7)**, desk lancé par l'ADMIN (`npm run desk:dev`) :
1. Interrupteur éteint : desk de la 3.5.0, onglet 09 en état vide, aucune connexion vers `CRYPTO_HOSTS`.
2. Allumé : les quatre voyants passent à `live`, la température se remplit, le CVD affiche son ancrage.
3. Oracle BTC-USD Coinbase 1h : les 50 dernières bougies closes du desk égalent `chart_read bars:50` d'OpenMarket (O, H, L, C au pas de prix ; volume à ±1 %).
4. Oracle ONE Binance : le CVD du desk suit celui d'OpenMarket en direction, bougie par bougie, sur 50 bougies (chart temporaire OpenMarket, avec l'accord de l'ADMIN au moment de la recette).
5. Une alerte prix et une alerte funding se déclenchent en toast et apparaissent dans `desk_events`.
6. Par Claude Code sur la passerelle : `crypto_chart_read` égale l'écran ; `crypto_indicator_set` ajoute EMA 200 après confirmation.

## 12. Organisation

- **Prérequis** : Node 22.12 ou plus (absent de ce poste), puis `npm install` dans `c-nto`. Aucune autre dépendance : `ws`, `lightweight-charts` et `dexie` sont déjà là.
- **Lots** : CRY0 décisions, interrupteur et coquille de l'onglet · CRY1 moteur · CRY2 réseau · CRY3 store et réglages · CRY4 interface au design du desk · CRY5 alertes · CRY6 outils de l'agent et passerelle · CRY7 recette.
- **Git** : commits locaux sur `main`, messages courts en français préfixés `CRY<lot>.<n>`, aucune attribution (CLAUDE.md § 1), aucun push. Constats et preuves dans `docs/AUDIT.md`, section « Onglet 09 · CRY ».

## 13. Risques et points ouverts

- **Conditions des exchanges.** Usage personnel de données publiques : admis en pratique, non revu juridiquement. Toute distribution du module exige une revue des conditions et une nouvelle décision (D9).
- **Interrupteur allumé dans une Release.** L'état vit dans `userData` du poste, jamais dans le dépôt ; un test vérifie le défaut `false`.
- **Onglet visible à la réouverture du dépôt.** Éteint, l'onglet 09 reste sur le rail, en état vide. Avant toute Release, l'ADMIN tranche : le garder, le retirer du rail, ou le réserver à un build personnel.
- **ONE** : écart de 10 à 18 % entre Binance, Gate et KuCoin relevé le 9 octobre 2026. La venue de référence est Binance, et elle est affichée.
- **ZIG** : peu liquide, d'où la vie jugée au heartbeat (§ 5) et l'âge du dernier prix affiché.
- **Bannissement Binance (418)** : une seule IP, celle du poste. Le backoff et la coupure de venue l'évitent ; si elle survient, la température et ONE s'arrêtent jusqu'au redémarrage.
- **CVD Coinbase/Bybit** : sans passé avant l'ouverture du flux, par construction (§ 5).
- **Sauvegarde du coffre** : les lignes `crypto.*` ne sont pas dans l'export v2, comme les indicateurs de Visual ; une restauration ne les efface pas.
