# Onglet 09 · CRY — plan d'implémentation

> **Pour les agents :** sous-skill requis : `superpowers:subagent-driven-development` (recommandé) ou `superpowers:executing-plans`, tâche par tâche. Les étapes se cochent (`- [ ]`).

**But.** Ajouter au desk CΛNTO 3.5.0 un onglet 09 · CRY personnel, éteint par défaut, qui affiche BTC et ONDO (Coinbase), ONE (Binance) et ZIG (Bybit) en direct avec le CVD, la température globale Binance et des alertes locales, au design du desk, et que l'agent du desk et les clients de la passerelle MCP lisent et pilotent après confirmation.

**Architecture.** Le réseau vit dans le process principal (`electron/crypto-*.ts`) derrière un interrupteur persistant et une liste d'hôtes à part ; l'analyse des réponses des exchanges, le CVD, la température et les alertes sont des fonctions pures de `src/engine/crypto/`, dont quatre sans import partagées avec le main ; le renderer tient l'état dans `src/store/crypto*.ts` (lignes de réglages `crypto.*`) et l'onglet reprend la composition de 02 · VIS ; dix outils `crypto_*` rejoignent le catalogue de l'agent.

**Pile.** Electron 43, React 19, TypeScript 5.9, zustand 5, lightweight-charts 5, client `ws` 8, Vitest 4 (jsdom par fichier).

**Spec.** `docs/ONGLET-CRYPTO.md` (5030e4d, 03c6685, amendée en CRY0.3). Les décisions 8 à 10 sont dans `docs/THESE-AGENTIQUE.md` § 7.

## Contraintes globales

- Dépôt `C:\Users\sierr\Documents\c-nto`, `main` local. Jamais de push, jamais de branche.
- Chaque shell Bash commence par `export PATH="/c/Users/sierr/AppData/Local/Programs/node-v22.23.3-win-x64:$PATH"`.
- Vert avant chaque commit : `npm run typecheck && npm test`. Seul échec toléré, préexistant : `tests/bridge-symlink.test.ts` (EPERM, mode développeur Windows absent). Tout changement sous `electron/` ou d'un module partagé : `npm run electron:compile` vert aussi. Fin de lot : `npm run check`.
- Commit : `git -c user.name="SIΞRRΛSKΛ" -c user.email="121763669+0xSrk@users.noreply.github.com" commit -m "CRYx.y <impératif court en français>"`. **Aucune** ligne d'attribution, aucun lien de session, aucun nom d'outil ni de modèle, nulle part (`CLAUDE.md` § 1).
- Ne pas toucher `electron/calendar-bundle` ni `electron/changelog` : jonctions locales masquées par `skip-worktree`.
- Aucune nouvelle dépendance npm (`ws`, `lightweight-charts`, `dexie`, `zustand`, `jsdom` sont là).
- Lire avant d'écrire ; un symbole introuvable : s'arrêter et le dire (`CLAUDE.md` § 2).
- Moteur pur : `src/engine/**` n'importe ni `src/store`, ni `src/modules`, ni Electron. Modules **partagés avec le main** (`markets.ts`, `venues.ts`, `tradeBars.ts`, `temperature.ts`) : aucun import hors de `src/engine/crypto/` (ni `@/…`, ni `../bars`) ; chacun listé dans `electron/tsconfig.sources.json`, typé par `electron/crypto/<nom>.d.ts`, relié dans la carte `engineSource` de `vitest.config.mts` (`'crypto/<nom>': 'src/engine/crypto/<nom>.ts'`). Le main les importe par `./crypto/<nom>`.
- Réseau seulement dans `electron/crypto-*.ts` ; `electron/main.ts` ne contient jamais `net.fetch` (`tests/sources.test.ts`). `allowedHosts()` et `tests/sources.test.ts` restent inchangés.
- IPC : méthodes nommées dans `electron/preload.ts`, chaque `ipcMain` derrière `trusted(e)`, interrupteur allumé, validation de forme.
- Interface : jetons de `src/design/tokens.css` seulement ; aucune couleur hex dans les fichiers de `src/modules/crypto/` ; aucun `--lab` ; `tests/design-guard.test.ts` vert ; toute chaîne d'interface par `tr(fr, en, es)`.
- Temps : barres en secondes UTC, trades et tickers en millisecondes.
- Nombres d'exchange : toujours `Number(...)` puis `Number.isFinite` ; une ligne invalide est écartée, jamais propagée.
- Registre v1 (tâche CRY1.1) : quatre marchés affichables, deux sources du CVD Binance, six timeframes `[1, 5, 15, 60, 240, 1440]` minutes.

## Points de revue

1. **Marché peu liquide** (ZIG sans trade pendant des minutes) : la connexion reste `live` tant que pongs et heartbeats arrivent ; seul l'âge du prix grandit. → CRY2.3, test `stays live without trades`.
2. **Réponse d'exchange malformée** (chaînes non numériques, tableau vide, champ manquant, JSON coupé) : la ligne est écartée, rien ne lève, aucun `NaN` n'atteint le chart ni une alerte. → CRY1.2, CRY1.3, CRY1.6.
3. **Changements rapides de marché ou de timeframe** (trader puis agent) : un historique arrivé après un nouveau changement ne remplace pas le chart courant. → CRY3.4, test `ignores a stale history response`.
4. **Interrupteur éteint ou fenêtre fermée avec des flux ouverts** : sockets fermées, timers arrêtés, aucune reconnexion ensuite. → CRY2.3 `closeAll stops everything`, CRY2.5.
5. **Prix minuscules et énormes** (ONE 0,002163 ; BTC 82 528) : affichage à la précision du marché ; hystérésis d'alerte relative au niveau (0,1 %), jamais absolue. → CRY1.7, CRY4.1, CRY4.3.

## Carte des fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `src/engine/crypto/markets.ts` (partagé) | registre, timeframes, hôtes, types communs | CRY1.1 |
| `src/engine/crypto/venues.ts` (partagé) | URLs REST/WS, messages d'abonnement, analyse REST et WS | CRY1.2, CRY1.3 |
| `src/engine/crypto/tradeBars.ts` (partagé) | bougies depuis les trades, fusion d'une bougie live | CRY1.4 |
| `src/engine/crypto/temperature.ts` (partagé) | funding, largeur, liquidations, open interest | CRY1.6 |
| `src/engine/crypto/cvd.ts` | points et ancre du CVD | CRY1.4 |
| `src/engine/crypto/indicators.ts` | catalogue d'indicateurs crypto | CRY1.5 |
| `src/engine/crypto/alerts.ts` | modèle d'alerte, `CrossWatch`, assainisseur | CRY1.7 |
| `src/engine/crypto/persist.ts` | assainisseurs `crypto.chart`, `crypto.watchlist`, `crypto.drawings` | CRY1.7 |
| `src/engine/crypto/port.ts` | `MarketDataPort` sur transport injecté | CRY3.2 |
| `src/engine/crypto/views.ts` | vues lues par les outils de l'agent | CRY6.1 |
| `electron/crypto/{markets,venues,tradeBars,temperature}.d.ts` | typage des modules partagés | CRY1.1–CRY1.6 |
| `electron/crypto-switch.ts` | interrupteur persistant, dialogue | CRY2.1 |
| `electron/crypto-net.ts` | fetch gardé, `VenueGate` | CRY2.2 |
| `electron/crypto-feeds.ts` | `ManagedSocket`, `CryptoFeedHost` | CRY2.3 |
| `electron/crypto-temperature.ts` | `TemperatureHost` | CRY2.4 |
| `electron/crypto-ipc.ts` | validation des requêtes IPC | CRY2.5 |
| `electron/crypto-electron.ts` | branchement `net.fetch`, `ws`, hôtes, statut | CRY2.5 |
| `src/store/crypto.ts` | état, réglages, actions, port de l'agent | CRY0.4, CRY3.3, CRY6.2 |
| `src/store/cryptoLive.ts` | flux légers et lourds, jetons de requête | CRY3.4 |
| `src/store/cryptoAlerts.ts` | `CryptoAlertRunner` | CRY5.1 |
| `src/modules/crypto/Crypto.tsx`, `CryptoSide.tsx`, `AlertModal.tsx`, `indicatorCopy.ts`, `crypto.module.css` | onglet 09 | CRY0.4, CRY4.3 |
| `src/modules/visual/IndicatorCards.tsx` | cartes d'indicateurs partagées avec Visual | CRY4.2 |
| `src/engine/agent/cryptoTools.ts` | dix outils `crypto_*` et leurs textes | CRY6.1 |
| `scripts/harness/crypto.html`, `scripts/harness/crypto-harness.tsx`, `scripts/capture-crypto.mjs` | banc de capture visuelle | CRY4.4 |

---

## Lot CRY0 — coquille

### Tâche CRY0.4 : onglet 09 · CRY sur le rail, état vide

**Fichiers**
- Modifier : `src/store/ui.ts:5` (`TabId` + `'crypto'`), `src/app/tabs.ts` (entrée `TABS`, `TAB_EN`, `TAB_ES`), `src/app/icons.tsx` (`IconCrypto`, sur le modèle des autres icônes), `src/app/App.tsx` (`lazy` et rendu), `src/app/Shell.tsx:92` (`/^Digit([1-9])$/`), `src/lib/desk.ts` (`CryptoMainStatus`, `CryptoApi`, `crypto?: CryptoApi` dans `DeskApi`).
- Créer : `src/store/crypto.ts` (minimal), `src/modules/crypto/Crypto.tsx`.
- Tests : `tests/tabs.test.ts` (mis à jour), `tests/crypto-tab.test.ts` (nouveau, `@vitest-environment jsdom`).

**Interfaces**
- Produit :
  - `TABS[8] = { id: 'crypto', index: '09', label: 'Crypto', code: 'CRY', tagline: 'Chart · température · alertes', icon: IconCrypto }` ; `TAB_EN.crypto = { label: 'Crypto', tagline: 'Chart · temperature · alerts' }` ; `TAB_ES.crypto = { label: 'Cripto', tagline: 'Gráfico · temperatura · alertas' }` ; pas dans `CONCEPTION`.
  - `src/lib/desk.ts` : `type CryptoVenueState = 'off' | 'connecting' | 'live' | 'reconnecting' | 'stale' | 'blocked'` ; `interface CryptoMainStatus { enabled: boolean; venues: Record<'coinbase' | 'binance' | 'bybit', CryptoVenueState> }` ; `interface CryptoApi { status(): Promise<CryptoMainStatus>; enable(): Promise<CryptoMainStatus>; disable(): Promise<CryptoMainStatus>; onStatus(cb: (s: CryptoMainStatus) => void): () => void }` (CRY2.5 l'étend).
  - `src/store/crypto.ts` : `useCrypto` (zustand) avec `ready: boolean`, `enabled: boolean`, `venues: CryptoMainStatus['venues']`, `load(): Promise<void>` (lit `desk?.crypto?.status()`, s'abonne une fois à `onStatus`), `requestEnable(): Promise<void>`, `disable(): Promise<void>`.
  - `src/modules/crypto/Crypto.tsx` : export par défaut ; `ModuleHeader tab="crypto"` ; interrupteur éteint → `ModuleContent` + `Empty` (titre `tr('Module crypto éteint', 'Crypto module off', 'Módulo cripto apagado')`, texte `tr('Données publiques de Coinbase, Binance et Bybit, pour un usage personnel. Le desk ne s’y connecte qu’une fois le module activé.', 'Public data from Coinbase, Binance and Bybit, for personal use. The desk connects only once the module is on.', 'Datos públicos de Coinbase, Binance y Bybit, para uso personal. El desk solo se conecta una vez activado el módulo.')`, action `Button variant="chamfer"` `tr('Activer le module crypto', 'Turn on the crypto module', 'Activar el módulo cripto')` → `requestEnable()`). Allumé : `ModuleContent` vide pour l'instant (rempli en CRY4.3).

- [ ] **Étape 1 : tests rouges**

```ts
// tests/tabs.test.ts — remplace le premier test, ajoute le raccourci 9
expect(TABS.map((t) => t.id)).toEqual(['metrique', 'visual', 'calendrier', 'note', 'portefeuille', 'agent', 'bot', 'copieur', 'crypto']);
expect(TABS.map((t) => t.index)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09']);
expect(TABS.find((t) => t.id === 'crypto')?.code).toBe('CRY');
it('le raccourci 9 mène à Crypto', () => {
  expect(TABS[8]?.id).toBe('crypto');
  expect(readFileSync('src/app/Shell.tsx', 'utf8')).toContain('/^Digit([1-9])$/');
});
```

```ts
// tests/crypto-tab.test.ts — jsdom ; window.canto.crypto simulé dans vi.hoisted (modèle : tests/visual-follow-reset.test.ts)
it('éteint : état vide et bouton chanfrein qui demande l’activation au process principal', async () => {
  // status → { enabled: false, venues: { coinbase: 'off', binance: 'off', bybit: 'off' } }
  // rendu de <Crypto /> par createRoot + act
  expect(container.textContent).toContain('Module crypto éteint');
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Activer le module crypto');
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(fake.enable).toHaveBeenCalledTimes(1);
});
```

- [ ] **Étape 2 : lancer `npx vitest run tests/tabs.test.ts tests/crypto-tab.test.ts`** → échec attendu (liste à 8 onglets, module introuvable).
- [ ] **Étape 3 : implémenter** les fichiers ci-dessus ; `App.tsx` : `const Crypto = lazy(() => import('@/modules/crypto/Crypto'))` et `{tab === 'crypto' && <Crypto />}`.
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert (hors `bridge-symlink`).
- [ ] **Étape 5 : commit** `CRY0.4 ouvrir l’onglet 09 · CRY sur le rail, éteint par défaut`.

---

## Lot CRY1 — moteur pur

### Tâche CRY1.1 : registre des marchés et des hôtes

**Fichiers**
- Créer : `src/engine/crypto/markets.ts` (aucun import), `electron/crypto/markets.d.ts`.
- Modifier : `electron/tsconfig.sources.json` (`"../src/engine/crypto/markets.ts"`), `vitest.config.mts` (`'crypto/markets': 'src/engine/crypto/markets.ts'`).
- Test : `tests/crypto-markets.test.ts`.

**Interfaces — produit**

```ts
export type CryptoVenue = 'coinbase' | 'binance' | 'bybit';
export type CryptoMarketId = 'coinbase:BTC-USD' | 'coinbase:ONDO-USD' | 'binance:ONEUSDT' | 'bybit:ZIGUSDT';
export type CryptoProxyId = 'binance:BTCUSDT' | 'binance:ONDOUSDT';
export type CryptoSeriesId = CryptoMarketId | CryptoProxyId;
export type VenueState = 'off' | 'connecting' | 'live' | 'reconnecting' | 'stale' | 'blocked';
export interface CryptoMarket { id: CryptoSeriesId; venue: CryptoVenue; symbol: string; base: string; quote: string; label: string; tickSize: number; precision: number; chartable: boolean; cvdProxy?: CryptoProxyId }
export interface CryptoBar { time: number; open: number; high: number; low: number; close: number; volume: number; buyVolume?: number }
export interface CryptoTicker { market: CryptoSeriesId; last: number; change24hPct: number | null; time: number }
export interface CryptoTrade { market: CryptoSeriesId; time: number; price: number; size: number; aggressor: 'buy' | 'sell' }
export type CryptoFeedEvent =
  | { kind: 'ticker'; ticker: CryptoTicker }
  | { kind: 'bar'; series: CryptoSeriesId; timeframe: CryptoTimeframe; bar: CryptoBar; final: boolean };
export const CRYPTO_TIMEFRAMES: readonly [1, 5, 15, 60, 240, 1440];
export type CryptoTimeframe = (typeof CRYPTO_TIMEFRAMES)[number];
export const CRYPTO_MARKETS: readonly CryptoMarket[];
export const CHARTABLE_MARKETS: readonly CryptoMarketId[];   // ordre du registre
export const DEFAULT_CRYPTO_MARKET: CryptoMarketId;          // 'coinbase:BTC-USD'
export const DEFAULT_CRYPTO_TIMEFRAME: CryptoTimeframe;      // 60
export const CRYPTO_HOSTS: readonly string[];
export function cryptoMarket(id: string): CryptoMarket | undefined;
export function isChartableMarket(v: unknown): v is CryptoMarketId;
export function isCryptoSeriesId(v: unknown): v is CryptoSeriesId;
export function isCryptoTimeframe(v: unknown): v is CryptoTimeframe;
export function cryptoHostAllowed(url: string, protocol: 'https:' | 'wss:'): boolean;
```

Valeurs du registre (relevées le 9 octobre 2026) :

| id | venue | symbol | base/quote | label | tickSize | precision | chartable | cvdProxy |
|---|---|---|---|---|---|---|---|---|
| `coinbase:BTC-USD` | coinbase | BTC-USD | BTC/USD | `BTC-USD · Coinbase` | 0.01 | 2 | oui | `binance:BTCUSDT` |
| `coinbase:ONDO-USD` | coinbase | ONDO-USD | ONDO/USD | `ONDO-USD · Coinbase` | 0.00001 | 5 | oui | `binance:ONDOUSDT` |
| `binance:ONEUSDT` | binance | ONEUSDT | ONE/USDT | `ONEUSDT · Binance` | 0.000001 | 6 | oui | — |
| `bybit:ZIGUSDT` | bybit | ZIGUSDT | ZIG/USDT | `ZIGUSDT · Bybit` | 0.00001 | 5 | oui | — |
| `binance:BTCUSDT` | binance | BTCUSDT | BTC/USDT | `BTCUSDT · Binance` | 0.01 | 2 | non | — |
| `binance:ONDOUSDT` | binance | ONDOUSDT | ONDO/USDT | `ONDOUSDT · Binance` | 0.0001 | 4 | non | — |

`CRYPTO_HOSTS` (trié) : `api.binance.com`, `api.bybit.com`, `api.exchange.coinbase.com`, `fapi.binance.com`, `fstream.binance.com`, `stream.binance.com`, `stream.bybit.com`, `ws-feed.exchange.coinbase.com`.

`cryptoHostAllowed` : URL analysable, `protocol` égal à celui demandé, ni utilisateur ni mot de passe, `hostname` en minuscules dans `CRYPTO_HOSTS` ; sinon `false`.

- [ ] **Étape 1 : test rouge**

```ts
expect(CRYPTO_MARKETS.map((m) => m.id)).toEqual(['coinbase:BTC-USD', 'coinbase:ONDO-USD', 'binance:ONEUSDT', 'bybit:ZIGUSDT', 'binance:BTCUSDT', 'binance:ONDOUSDT']);
expect(CHARTABLE_MARKETS).toEqual(['coinbase:BTC-USD', 'coinbase:ONDO-USD', 'binance:ONEUSDT', 'bybit:ZIGUSDT']);
for (const m of CRYPTO_MARKETS) expect(m.precision, m.id).toBe(String(m.tickSize).split('.')[1]?.length ?? 0);
expect(cryptoHostAllowed('https://api.binance.com/api/v3/klines?symbol=ONEUSDT', 'https:')).toBe(true);
expect(cryptoHostAllowed('wss://stream.binance.com:9443/ws', 'wss:')).toBe(true);
expect(cryptoHostAllowed('http://api.binance.com/api/v3/klines', 'https:')).toBe(false);
expect(cryptoHostAllowed('wss://api.binance.com/ws', 'https:')).toBe(false);
expect(cryptoHostAllowed('https://user:pw@api.binance.com/', 'https:')).toBe(false);
expect(cryptoHostAllowed('https://api.binance.com.evil.io/', 'https:')).toBe(false);
expect(cryptoHostAllowed('pas une url', 'https:')).toBe(false);
expect(CRYPTO_HOSTS.filter((h) => allowedHosts().includes(h))).toEqual([]); // décision 9
expect(isCryptoTimeframe(240)).toBe(true); expect(isCryptoTimeframe(30)).toBe(false);
expect(isChartableMarket('binance:BTCUSDT')).toBe(false); expect(isCryptoSeriesId('binance:BTCUSDT')).toBe(true);
```

- [ ] **Étape 2 : lancer `npx vitest run tests/crypto-markets.test.ts`** → échec (module introuvable).
- [ ] **Étape 3 : implémenter** `markets.ts` ; `markets.d.ts` déclare les mêmes exports (types compris) ; brancher `tsconfig.sources.json` et `vitest.config.mts`.
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert ; `dist-electron/crypto/markets.js` existe.
- [ ] **Étape 5 : commit** `CRY1.1 fixer le registre des marchés crypto et ses hôtes`.

### Tâche CRY1.2 : historique REST et analyse des bougies

**Fichiers** — Créer `src/engine/crypto/venues.ts` (n'importe que `./markets`), `electron/crypto/venues.d.ts` ; brancher `tsconfig.sources.json` et `vitest.config.mts` (`'crypto/venues'`). Test : `tests/crypto-venues-rest.test.ts`.

**Interfaces — produit**

```ts
export function historyRequests(series: CryptoSeriesId, timeframe: CryptoTimeframe, nowSec: number): { urls: string[]; aggregate: number };
export function parseCandles(venue: CryptoVenue, json: unknown): CryptoBar[];   // trié par time croissant, dédoublonné
export function aggregateBars(bars: CryptoBar[], timeframe: CryptoTimeframe, factor: number): CryptoBar[];
export const HISTORY_BARS = 500;
```

Règles :
- Binance : `https://api.binance.com/api/v3/klines?symbol=<symbol>&interval=<1m|5m|15m|1h|4h|1d>&limit=500`, `aggregate: 1`.
- Bybit : `https://api.bybit.com/v5/market/kline?category=spot&symbol=<symbol>&interval=<1|5|15|60|240|D>&limit=500`, `aggregate: 1`.
- Coinbase : `https://api.exchange.coinbase.com/products/<symbol>/candles?granularity=<g>&start=<ISO>&end=<ISO>`, pages de 300 bougies en remontant depuis `nowSec` ; 2 pages pour `g = timeframe × 60` ; pour 240, 4 pages en `granularity=3600` et `aggregate: 4`.
- `parseCandles` : Coinbase `[time, low, high, open, close, volume]`, plus récentes d'abord ; Binance `[openTime ms, o, h, l, c, v, closeTime, quoteVol, trades, takerBuyBase, …]` en chaînes, `buyVolume = Number(row[9])` ; Bybit `{ retCode, retMsg, result: { list: [[startMs, o, h, l, c, volume, turnover]] } }`, plus récentes d'abord, `retCode !== 0` lève `Error(retMsg)`. Toute ligne courte ou non finie est écartée.
- `aggregateBars` : seaux de `timeframe × factor × 60` secondes alignés sur l'epoch UTC ; open du premier, high max, low min, close du dernier, volume somme, `buyVolume` somme seulement si toutes les bougies du seau en ont un.

- [ ] **Étape 1 : test rouge** (réponses réelles du 9 octobre 2026)

```ts
const cb = [[1791540000, 82374.03, 82655.46, 82587.75, 82404.31, 46.81410505], [1791536400, 82473.97, 82623.57, 82616.1, 82582.34, 54.4319952]];
expect(parseCandles('coinbase', cb)[0]).toEqual({ time: 1791536400, open: 82616.1, high: 82623.57, low: 82473.97, close: 82582.34, volume: 54.4319952 });
const bn = [[1791536400000, '0.00214200', '0.00221700', '0.00213900', '0.00215800', '87072165.80000000', 1791539999999, '190392.81755970', 4407, '46488643.30000000', '101648.64787700', '0']];
expect(parseCandles('binance', bn)).toEqual([{ time: 1791536400, open: 0.002142, high: 0.002217, low: 0.002139, close: 0.002158, volume: 87072165.8, buyVolume: 46488643.3 }]);
const by = { retCode: 0, retMsg: 'OK', result: { list: [['1791540000000', '0.05908', '0.05932', '0.059', '0.05929', '19487.72', '1153.3725962'], ['1791536400000', '0.05929', '0.05944', '0.05905', '0.05908', '70882.67', '4199.972979']] } };
expect(parseCandles('bybit', by).map((b) => b.time)).toEqual([1791536400, 1791540000]);
expect(() => parseCandles('bybit', { retCode: 10001, retMsg: 'Not supported symbols' })).toThrow('Not supported symbols');
expect(parseCandles('binance', [['x', 'y'], [1791536400000, 'NaN', '1', '1', '1', '1', 0, '0', 0, '0']])).toEqual([]);
expect(historyRequests('binance:ONEUSDT', 60, 1791540000)).toEqual({ urls: ['https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=1h&limit=500'], aggregate: 1 });
expect(historyRequests('bybit:ZIGUSDT', 1440, 1791540000).urls[0]).toContain('interval=D');
const four = historyRequests('coinbase:BTC-USD', 240, 1791540000);
expect(four.aggregate).toBe(4); expect(four.urls).toHaveLength(4); expect(four.urls.every((u) => u.includes('granularity=3600'))).toBe(true);
expect([...four.urls, ...historyRequests('coinbase:ONDO-USD', 5, 1791540000).urls].every((u) => cryptoHostAllowed(u, 'https:'))).toBe(true);
// 8 bougies 1h depuis 2026-10-09T00:00Z → 2 bougies 4h : open de la 1re, high max, low min, close de la 4e, volume somme
```

- [ ] **Étape 2 : lancer `npx vitest run tests/crypto-venues-rest.test.ts`** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY1.2 lire l’historique des bougies Coinbase, Binance et Bybit`.

### Tâche CRY1.3 : messages WebSocket

**Fichiers** — Modifier `src/engine/crypto/venues.ts`, `electron/crypto/venues.d.ts`. Test : `tests/crypto-venues-ws.test.ts`.

**Interfaces — produit**

```ts
export function wsUrl(venue: CryptoVenue): string;
// coinbase 'wss://ws-feed.exchange.coinbase.com' · binance 'wss://stream.binance.com:9443/ws' · bybit 'wss://stream.bybit.com/v5/public/spot'
export const FORCE_ORDER_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr';
export const PREMIUM_INDEX_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex';
export const TICKER_24H_URL = 'https://api.binance.com/api/v3/ticker/24hr';
export function openInterestUrl(symbol: 'BTCUSDT' | 'ETHUSDT'): string; // https://fapi.binance.com/futures/data/openInterestHist?symbol=<s>&period=1h&limit=25
export function streamKeys(series: CryptoSeriesId, kind: 'ticker' | 'bars', timeframe?: CryptoTimeframe): string[];
export function subscribeMessage(venue: CryptoVenue, keys: readonly string[], on: boolean, id: number): string;
export type WsParsed =
  | { kind: 'ticker'; ticker: CryptoTicker }
  | { kind: 'trade'; trade: CryptoTrade }
  | { kind: 'kline'; series: CryptoSeriesId; timeframe: CryptoTimeframe; bar: CryptoBar; final: boolean }
  | { kind: 'heartbeat' }
  | { kind: 'error'; detail: string }
  | { kind: 'ignored' };
export function parseWsMessage(venue: CryptoVenue, raw: string): WsParsed[];
```

Règles :
- `streamKeys` : Coinbase ticker `['ticker:BTC-USD', 'heartbeat:BTC-USD']`, bars `['matches:BTC-USD', 'heartbeat:BTC-USD']` ; Binance ticker `['oneusdt@miniTicker']`, bars `['oneusdt@kline_1h']` ; Bybit ticker `['tickers.ZIGUSDT']`, bars `['publicTrade.ZIGUSDT']`.
- `subscribeMessage` : Coinbase `{ type: 'subscribe' | 'unsubscribe', channels: [{ name, product_ids }] }` (canaux regroupés) ; Binance `{ method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: keys, id }` ; Bybit `{ op: 'subscribe' | 'unsubscribe', args: keys }`.
- `parseWsMessage` ne lève jamais (JSON illisible → `[{ kind: 'ignored' }]`) :
  - Coinbase : `ticker` → `{ market: 'coinbase:<product_id>', last: Number(price), change24hPct: (price / open_24h − 1) × 100 ou null, time: Date.parse(time) }` ; `match` / `last_match` → trade, **agresseur = côté opposé à `side`** (Coinbase donne le côté du maker) ; `heartbeat` → heartbeat ; `error` → error ; le reste → ignored.
  - Binance : `e === '24hrMiniTicker'` → ticker (`c`, `o`, `E`) ; `e === 'kline'` → kline (`k.t / 1000`, `o h l c v` en nombres, `buyVolume = Number(k.V)`, `final = k.x`, timeframe depuis `k.i`) ; réponses `{ result, id }` → ignored.
  - Bybit : `topic` `tickers.<s>` → ticker (`lastPrice`, `price24hPcnt × 100`, `ts`) ; `publicTrade.<s>` → un trade par élément (`T`, `p`, `v`, agresseur = `S === 'Buy' ? 'buy' : 'sell'`) ; `op === 'pong'` ou `ret_msg === 'pong'` → heartbeat ; acquittements → ignored.
  - Symbole hors registre ou nombre non fini → ignored.

- [ ] **Étape 1 : test rouge** : par venue, un message de chaque type ; `{"type":"match","product_id":"BTC-USD","side":"sell","price":"82500.10","size":"0.01","time":"2026-10-09T10:00:01.000Z"}` donne `aggressor: 'buy'` ; kline Binance non finale puis finale (`k.x: true`) avec `buyVolume` ; trade Bybit `S: 'Sell'` → `aggressor: 'sell'` ; `'{'` → `[{ kind: 'ignored' }]` ; `price: 'abc'` → ignored ; `FORCE_ORDER_URL`, `PREMIUM_INDEX_URL`, `TICKER_24H_URL`, `openInterestUrl('BTCUSDT')` et `wsUrl` de chaque venue passent `cryptoHostAllowed` avec leur protocole.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY1.3 lire les flux WebSocket des trois venues`.

### Tâche CRY1.4 : bougies depuis les trades, CVD

**Fichiers** — Créer `src/engine/crypto/tradeBars.ts` (partagé ; `electron/crypto/tradeBars.d.ts`, `tsconfig.sources.json`, `vitest.config.mts`), `src/engine/crypto/cvd.ts`. Test : `tests/crypto-trade-bars.test.ts`.

**Interfaces — produit**

```ts
// tradeBars.ts
export class TradeBarBuilder {
  constructor(timeframe: CryptoTimeframe, startedAtMs: number);
  /** Bougie du seau du trade, et la précédente marquée finale quand le seau change. */
  push(trade: CryptoTrade): { bar: CryptoBar; final: boolean }[];
}
export function mergeLiveBar(bars: readonly CryptoBar[], live: CryptoBar, max?: number /* 1000 */): CryptoBar[];
// cvd.ts
export function cvdPoints(bars: readonly CryptoBar[]): { time: number; value?: number }[];
export function cvdAnchor(bars: readonly CryptoBar[]): number | null;
```

Règles :
- Seau = `floor(trade.time / 1000 / (tf × 60)) × tf × 60`. Un seau commencé avant `startedAtMs` est **incomplet** : sa bougie n'a pas de `buyVolume`. Un seau commencé après en a un : somme des `size` dont l'agresseur est `buy`. Un trade d'un seau antérieur au seau courant est ignoré.
- `mergeLiveBar` : même `time` que la dernière bougie → sans `buyVolume`, garder open et volume, `high = max`, `low = min`, `close = live.close` ; avec `buyVolume`, remplacer. `time` plus récent → ajouter (garder les `max` dernières). Plus ancien → ignorer.
- `cvdPoints` : avant la première bougie qui a un `buyVolume`, des blancs `{ time }` ; ensuite la somme cumulée de `2 × buyVolume − volume`. `cvdAnchor` donne le `time` de cette première bougie, ou `null`.

- [ ] **Étape 1 : test rouge** : `tf = 1`, `startedAt = 10:00:30Z` ; trade 10:00:40 → bougie 10:00 sans `buyVolume` ; trades 10:01:05 buy 2 et 10:01:20 sell 1 → bougie 10:01 `volume 3`, `buyVolume 2` ; trade 10:02:00 → la bougie 10:01 revient `final: true` ; un trade à 10:01:59 arrivé ensuite est ignoré ; `cvdPoints` → blanc à 10:00, `1` à 10:01 ; `cvdAnchor` → 10:01 ; avec des bougies Binance qui ont toutes un `buyVolume`, l'ancre est la première bougie ; règles de `mergeLiveBar` (partielle, complète, plus récente, plus ancienne, plafond).
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY1.4 construire les bougies depuis les trades et le CVD`.

### Tâche CRY1.5 : catalogue d'indicateurs crypto

**Fichiers** — Créer `src/engine/crypto/indicators.ts` (renderer ; importe `@/engine/indicators`, `./cvd`). Test : `tests/crypto-indicators.test.ts`.

**Interfaces — produit**

```ts
export const CRYPTO_INDICATORS: IndicatorDefinition[]; // ids : ema, sma, volume-ma, atr, vwap-utc, levels-utc, cvd, cvd-binance
export function cryptoIndicatorById(id: string): IndicatorDefinition | undefined;
export const DEFAULT_CRYPTO_INDICATORS: IndicatorInstance[]; // [{ id: 'i_cvd', definitionId: 'cvd', params: {}, visible: true }, { id: 'i_vwap', definitionId: 'vwap-utc', params: { bands: '1' }, visible: true }]
export function inputBarsFor(definitionId: string, chartBars: readonly CryptoBar[], proxyBars: readonly CryptoBar[]): readonly CryptoBar[]; // 'cvd-binance' → proxyBars
```

Règles :
- `ema`, `sma`, `volume-ma` et `atr` sont les définitions existantes (`indicatorById`), reprises telles quelles.
- `vwap-utc` : prix typique `(h + l + c) / 3` pondéré par le volume, remis à zéro à 00:00 UTC ; paramètre `bands` identique à celui de `vwap` (`indicators.ts:170`).
- `levels-utc` : plus haut, plus bas et clôture du jour UTC précédent, en lignes interrompues à chaque jour.
- `cvd` et `cvd-binance` : une ligne `pane: 'pane'`, clé `cvd`, données `cvdPoints(bars)`.
- `vwap`, `opening-range` et `prev-session` (ancrés à la séance Globex) n'y figurent pas.

- [ ] **Étape 1 : test rouge** : ids exacts et dans cet ordre ; absence des trois indicateurs de séance ; VWAP de la première bougie après minuit UTC égal à son prix typique ; niveaux du jour 2 égaux au plus haut, plus bas et clôture du jour 1 ; `cvd` donne une ligne `pane: 'pane'` ; `inputBarsFor('cvd-binance', a, b) === b`.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert.
- [ ] **Étape 5 : commit** `CRY1.5 ancrer les indicateurs crypto sur la journée UTC`.

### Tâche CRY1.6 : température

**Fichiers** — Créer `src/engine/crypto/temperature.ts` (partagé, aucun import ; `.d.ts`, `tsconfig.sources.json`, `vitest.config.mts`). Test : `tests/crypto-temperature.test.ts`.

**Interfaces — produit**

```ts
export interface TemperatureReading {
  funding: { median: number; btc: number | null; symbols: number; at: number } | null; // fractions : 0.0001 = 0,01 %
  breadth: { upShare: number; pairs: number; at: number } | null;                     // 0..1
  liquidations: { long: number; short: number; since: number; at: number; lowerBound: true }; // dollars US
  openInterest: { btc: number | null; eth: number | null; at: number } | null;        // variation 24 h, fraction
}
export function emptyReading(startedAt: number): TemperatureReading;
export function fundingFromPremiumIndex(json: unknown, at: number): TemperatureReading['funding'];
export function breadthFromTickers(json: unknown, at: number): TemperatureReading['breadth'];
export function oiChange(json: unknown): number | null;
export class LiquidationWindow {
  constructor(startedAt: number, windowMs?: number /* 3_600_000 */);
  push(raw: string): void;
  totals(now: number): { long: number; short: number; since: number };
}
```

Règles :
- Funding : symboles finissant par `USDT` avec un `lastFundingRate` fini ; médiane (moyenne des deux du milieu si le nombre est pair) ; `btc` = `BTCUSDT`.
- Largeur : symboles finissant par `USDT` avec `Number(count) > 0` ; part de ceux dont `priceChangePercent > 0`.
- Open interest : tableau trié par `timestamp`, `sumOpenInterest` du dernier sur celui du premier, moins 1 ; moins de deux points → `null`.
- Liquidations : `{ e: 'forceOrder', o: { S, q, p, ap, z } }` ; montant `ap × z` si les deux sont positifs, sinon `p × q` ; `S === 'SELL'` liquide une position longue, donc `long`, et `BUY` va dans `short`. Fenêtre glissante de 1 h ; `since = max(startedAt, now − windowMs)`.

- [ ] **Étape 1 : test rouge** : médiane paire et impaire ; entrée sans taux ignorée ; largeur 2 sur 3 → `0.6667` à 4 décimales près ; symbole `count: 0` exclu ; OI `+2,4 %` sur deux points ; liquidation `SELL ap 100 z 2` → `long 200` ; une liquidation vieille de 61 min sort de la fenêtre ; JSON invalide → `null`, `0` ou ignoré, sans exception.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY1.6 mesurer la température du marché crypto`.

### Tâche CRY1.7 : alertes, tracés et assainisseurs

**Fichiers** — Créer `src/engine/crypto/alerts.ts`, `src/engine/crypto/persist.ts`. Test : `tests/crypto-alerts.test.ts`.

**Interfaces — produit**

```ts
// alerts.ts
export type PriceAlertKind = 'price_above' | 'price_below';
export type TemperatureAlertKind = 'funding_median_above' | 'funding_median_below' | 'liquidations_long_1h_above' | 'liquidations_short_1h_above' | 'breadth_above' | 'breadth_below';
export type CryptoAlertKind = PriceAlertKind | TemperatureAlertKind;
export interface CryptoAlert { id: string; target: CryptoMarketId | 'temperature'; kind: CryptoAlertKind; level: number; mode: 'once' | 'rearm'; author: 'trader' | 'agent'; state: 'armed' | 'triggered' | 'paused'; createdAt: number; lastTriggeredAt?: number }
export const ALERTS_MAX = 50;
export function alertDirection(kind: CryptoAlertKind): 'above' | 'below';
export function hysteresisBand(kind: CryptoAlertKind, level: number): number;
export function alertValue(alert: CryptoAlert, data: { tickers: Partial<Record<CryptoMarketId, CryptoTicker>>; temperature: TemperatureReading | null }): number | null;
export class CrossWatch { constructor(direction: 'above' | 'below', level: number, band: number); step(value: number): boolean }
export function validateAlert(input: Omit<CryptoAlert, 'id' | 'state' | 'createdAt'>): { ok: true } | { ok: false; reason: 'bad_target' | 'bad_kind' | 'bad_level' };
export function sanitizeAlerts(v: unknown): CryptoAlert[] | undefined;
// persist.ts
export interface CryptoDrawing { id: string; market: CryptoMarketId; kind: 'level' | 'zone'; price?: number; from?: number; to?: number; label?: string; author: 'trader' | 'agent'; createdAt: number }
export const DRAWINGS_MAX = 100;
export const LABEL_MAX = 40;
export interface CryptoChartSetting { market: CryptoMarketId; timeframe: CryptoTimeframe; indicators: IndicatorInstance[] }
export function sanitizeCryptoChart(v: unknown): CryptoChartSetting | undefined;
export function sanitizeWatchlist(v: unknown): CryptoMarketId[] | undefined;
export function sanitizeDrawings(v: unknown): CryptoDrawing[] | undefined;
```

Règles :
- Unités du `level` : prix en devise de cotation ; funding en pourcentage (`0.01` = 0,01 %), comparé à `median × 100` ; liquidations en dollars ; largeur en points de pourcentage (`40` = 40 %), comparée à `upShare × 100`.
- Bandes : prix `|level| × 0.001` ; funding `0.0005` ; liquidations `level × 0.05` ; largeur `1`.
- `CrossWatch.step` : le premier appel pose le côté et rend `false`. En direction `above` : alerte quand le côté était `below` et que `value >= level`, puis le côté passe à `above` ; il ne revient à `below` qu'une fois `value < level − band`. `below` est le miroir.
- Cibles : une alerte de prix vise un marché affichable, une alerte de température vise `'temperature'`.
- Assainisseurs : chaque entrée invalide est écartée, les plafonds sont tenus (50 alertes, 100 tracés), un marché hors registre est retiré, les chaînes sont bornées (id ≤ 64, label ≤ 40) ; une valeur qui n'est pas un tableau (ou un objet pour `sanitizeCryptoChart`) rend `undefined` ; les indicateurs reprennent la forme de `'chart.indicators'` (`db.ts:603`) avec un `definitionId` du catalogue crypto ; une zone a `from < to`.

- [ ] **Étape 1 : test rouge** : `CrossWatch` (pas d'alerte au premier pas, une seule alerte au franchissement, rien tant qu'on reste au-dessus, réarmement seulement sous `level − band`) ; bandes relatives `hysteresisBand('price_above', 0.002) === 0.000002` et `hysteresisBand('price_above', 85000) === 85` ; `alertValue` funding = `median × 100` ; validation (prix sur `'temperature'` refusé, `level` non fini refusé) ; assainisseurs (51 alertes → 50, marché `binance:BTCUSDT` retiré d'une watchlist, zone inversée écartée, label de 41 caractères écarté).
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert.
- [ ] **Étape 5 : commit** `CRY1.7 évaluer les alertes crypto par croisement`.

### Tâche CRY1.8 : historique jusqu'à 00:00 UTC de la veille

Ticket ajouté par le contrôleur le 9 octobre 2026 (registre : CRY1.5, finding I1). Le VWAP 00:00 UTC et les niveaux du jour UTC précédent (CRY1.5) ne calculent une journée que si la fenêtre chargée couvre son début. Avec 500 bougies, en 1m (8 h 20) et parfois en 5m (41 h 40), la fenêtre commence en cours de journée : VWAP et niveaux restent vides la plupart du temps. Ce ticket fait remonter l'historique au moins à 00:00 UTC de la veille.

**Fichiers**
- Modifier : `src/engine/crypto/venues.ts`, `electron/crypto/venues.d.ts`, `tests/crypto-venues-rest.test.ts` (dont la liste d'exports figée), `docs/ONGLET-CRYPTO.md` (§ 5, paragraphe « Historique »), `docs/ONGLET-CRYPTO-PLAN.md` (ajout de cette tâche après CRY1.7 ; dans CRY2.3, « les 500 dernières bougies » devient « les `historyTarget(timeframe, now)` dernières »).
- Test : `tests/crypto-venues-rest.test.ts`.

**Interfaces — produit**

```ts
/** Nombre de bougies à charger : au moins HISTORY_BARS, et assez pour couvrir depuis 00:00 UTC de la veille. */
export function historyTarget(timeframe: CryptoTimeframe, nowSec: number): number;
```

Règles :
- `windowStart = (floor(nowSec / 86400) − 1) × 86400` ; `needed = floor((nowSec − windowStart) / (tf × 60)) + 1` ; `historyTarget = max(HISTORY_BARS, needed)`. En pratique seuls 1m (jusqu'à 2 880) et 5m (jusqu'à 576) dépassent 500.
- `historyRequests(series, timeframe, nowSec)` couvre `historyTarget(timeframe, nowSec)` bougies (sauf Coinbase 240, qui garde 4 pages et `aggregate: 4` : décision du registre, 300 bougies 4h) :
  - **Binance** : `historyTarget ≤ 1000` → une URL, comme aujourd'hui, avec `limit=<historyTarget>`, plus une bougie de marge dès que `needed ≥ 500` (`limit = min(1000, historyTarget + 1)`, le 5m dès 17:35 UTC, `limit=577` à 23:55 : une bascule de seau pendant l'appel ne fait pas perdre 00:00 UTC de la veille, que l'appelant garde en coupant par l'heure ; règle ajoutée en CRY2.3) ; inchangée pour 15m et au-dessus : `limit=500`. Au-delà → pages de 1 000 en avançant, `&startTime=<ms>&limit=1000`, la première à `(seau courant − (historyTarget − 1) × tf × 60) × 1000`, chaque suivante 1 000 bougies plus loin ; la dernière page couvre le seau courant.
  - **Bybit** : même règle, paramètre `start=<ms>` (et `limit=1000`), `interval` inchangé.
  - **Coinbase** : `ceil(historyTarget / 300)` pages de 300 en remontant depuis le seau courant, au moins 2 comme aujourd'hui (1m : 5 à 10 pages).
- Toute URL passe `cryptoHostAllowed(url, 'https:')`. Les URLs des timeframes 15m, 1h, 4h et 1j restent identiques à celles de CRY1.2 (tests existants inchangés).
- Spec § 5, « Historique », nouvelle première phrase : « À l'ouverture du chart, le main charge 500 bougies, ou davantage en 1m et 5m pour remonter au moins à 00:00 UTC de la veille (VWAP et niveaux du jour UTC) : jusqu'à 2 880 bougies en 1m et 576 en 5m. Coinbase 4h : 300 bougies (environ 50 jours). Elles restent en mémoire (aucune bougie crypto dans Dexie). »

- [ ] **Étape 1 : test rouge**

```ts
const t = Date.UTC(2026, 9, 9, 10, 0, 0) / 1000;           // 2026-10-09T10:00:00Z
expect(historyTarget(1, t)).toBe(2041);                     // 34 h × 60 + 1
expect(historyTarget(5, t)).toBe(500);                      // 409 < 500
expect(historyTarget(5, Date.UTC(2026, 9, 9, 23, 55) / 1000)).toBe(576);
expect(historyTarget(15, t)).toBe(500); expect(historyTarget(1440, t)).toBe(500);
expect(historyRequests('coinbase:BTC-USD', 1, t).urls).toHaveLength(7);
const bn = historyRequests('binance:ONEUSDT', 1, t).urls;
expect(bn).toHaveLength(3); expect(bn.every((u) => u.includes('limit=1000') && u.includes('startTime='))).toBe(true);
expect(new URL(bn[0]!).searchParams.get('startTime')).toBe(String((t - 2040 * 60) * 1000));
expect(historyRequests('bybit:ZIGUSDT', 1, t).urls).toHaveLength(3);
expect(historyRequests('binance:ONEUSDT', 5, Date.UTC(2026, 9, 9, 23, 55) / 1000).urls).toEqual(['https://api.binance.com/api/v3/klines?symbol=ONEUSDT&interval=5m&limit=577']); // needed = 576 ≥ 500 : une bougie de marge (CRY2.3)
// les pages Binance/Bybit 1m sont contiguës et sans recouvrement ; leur union couvre de windowStart au seau courant
```

- [ ] **Étape 2 : lancer `npx vitest run tests/crypto-venues-rest.test.ts`** → échec.
- [ ] **Étape 3 : implémenter**, puis mettre à jour spec et plan comme ci-dessus.
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY1.8 charger l’historique crypto jusqu’à 00:00 UTC de la veille`.

Ajout du contrôleur (relecture de CRY1.5) : dans `docs/ONGLET-CRYPTO.md` § 7, après la liste des indicateurs de la section 2 de la colonne, ajouter la phrase : « Le VWAP 00:00 UTC et les niveaux du jour UTC précédent ne se calculent que pour une journée dont la fenêtre chargée couvre le début (`bars[0].time <= début du jour`) : sinon la ligne s'interrompt, plutôt que d'afficher une valeur fausse. »

---

## Lot CRY2 — réseau dans le process principal

### Tâche CRY2.1 : interrupteur persistant

**Fichiers** — Créer `electron/crypto-switch.ts`. Test : `tests/crypto-switch.test.ts`.

**Interfaces**
- Consomme : `AgentDialogOptions` (`electron/agent-orders.ts:40`), `uiText` / `AppLocale` (`electron/locale`).
- Produit :

```ts
export interface CryptoSwitchDeps { userDataDir: string; locale: () => AppLocale; window: () => { isDestroyed(): boolean } | null; showMessageBox: (win: { isDestroyed(): boolean }, options: AgentDialogOptions) => Promise<{ response: number }>; log: (line: string) => void }
export class CryptoSwitchHost {
  constructor(deps: CryptoSwitchDeps);
  get enabled(): boolean;
  requestEnable(): Promise<boolean>;
  disable(): boolean;
  onChange(cb: (enabled: boolean) => void): () => void;
}
```

Fichier `crypto.json` (`{"enabled":true|false}`, `mode: 0o600`) ; illisible ou absent → éteint. Dialogue : `type 'question'`, titre `CΛNTO`, message `Activer le module crypto ?` / `Turn on the crypto module?` / `¿Activar el módulo cripto?`, détail sur les données publiques Coinbase, Binance et Bybit, l'usage personnel et l'arrêt possible à tout moment (trois langues), boutons `[Activer | Turn on | Activar, Annuler | Cancel | Cancelar]`, `defaultId: 1`, `cancelId: 1`, `noLink: true`. Fenêtre absente → reste éteint, sans dialogue.

- [ ] **Étape 1 : test rouge** (dossier temporaire) : éteint par défaut ; réponse 1 → éteint, rien d'écrit à `true` ; réponse 0 → allumé, fichier `{"enabled":true}`, un nouvel hôte relit allumé ; fichier corrompu → éteint ; `disable()` écrit `false` et prévient les abonnés ; fenêtre `null` → `showMessageBox` jamais appelé.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY2.1 garder l’interrupteur crypto dans le process principal`.

### Tâche CRY2.2 : fetch gardé et portes de venue

**Fichiers** — Créer `electron/crypto-net.ts`. Test : `tests/crypto-net.test.ts`.

**Interfaces — produit**

```ts
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export class VenueHttpError extends Error { constructor(readonly status: number, message: string, readonly retryAfterSec?: number) }
export function cryptoFetchJson(url: string, deps: { fetchImpl: FetchLike; hostOk: (url: string) => boolean; timeoutMs?: number }): Promise<unknown>;
export class VenueGate {
  constructor(now: () => number);
  allowed(venue: CryptoVenue): boolean;
  blocked(venue: CryptoVenue): boolean;
  onHttpError(venue: CryptoVenue, err: VenueHttpError): void;
  onSuccess(venue: CryptoVenue): void;
}
```

Règles :
- `hostOk` faux → `Error('Hôte non autorisé')` avant tout appel.
- `redirect: 'manual'` ; un 3xx ou un `opaqueredirect` → `Error('Redirection refusée')`.
- En-têtes `User-Agent: CANTO-Desk (crypto)` et `Accept: application/json` ; délai de 10 s par défaut (`AbortSignal.timeout`).
- 429 → `VenueHttpError(429, …, Retry-After en secondes)` ; 418 → `VenueHttpError(418)` ; autre non-OK → `VenueHttpError(status)` ; corps illisible → `Error('Réponse illisible')`.
- `VenueGate` : un 429 bloque la venue jusqu'à `now + max(retryAfter, backoff)`, le backoff doublant de 1 s à 60 s ; un 418 la bloque jusqu'au redémarrage ; un succès remet le backoff à 1 s.

- [ ] **Étape 1 : test rouge** (faux fetch qui rend des `Response`) : hôte refusé sans appel ; 302 refusé ; 429 avec `Retry-After: 7` → `retryAfterSec 7` puis `allowed` faux pendant 7 s ; deux 429 sans en-tête → 1 s puis 2 s ; 418 → `blocked` vrai, définitivement ; JSON rendu tel quel ; texte non JSON → `Réponse illisible`.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY2.2 garder chaque appel aux exchanges`.

### Tâche CRY2.3 : sockets par venue

**Fichiers** — Créer `electron/crypto-feeds.ts`. Test : `tests/crypto-feeds.test.ts`.

**Interfaces**
- Consomme : `wsUrl`, `streamKeys`, `subscribeMessage`, `parseWsMessage`, `historyRequests`, `parseCandles`, `aggregateBars` (CRY1.2–CRY1.3) ; `TradeBarBuilder` (CRY1.4) ; `VenueGate`, `VenueHttpError` (CRY2.2).
- Produit :

```ts
export interface WsLike {
  send(data: string): void; ping(): void; close(): void;
  on(event: 'open' | 'close' | 'pong', cb: () => void): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'error', cb: (err: unknown) => void): void;
  on(event: 'unexpected-response', cb: (req: unknown, res: { statusCode?: number }) => void): void;
}
export type WsFactory = (url: string) => WsLike;
export interface Timers { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: typeof setInterval; clearInterval: typeof clearInterval }
export class ManagedSocket {
  constructor(opts: { url: string; venue: CryptoVenue; ws: WsFactory; hostOk: (url: string) => boolean; timers: Timers; now: () => number; gate: VenueGate; onMessage: (raw: string) => void; onState: (s: VenueState) => void; onOpen: () => void; appPing?: () => string | null; log: (l: string) => void });
  open(): void; send(data: string): void; close(): void; readonly state: VenueState;
}
export class CryptoFeedHost {
  constructor(deps: { ws: WsFactory; hostOk: (url: string) => boolean; timers: Timers; now: () => number; gate: VenueGate; fetchJson: (url: string) => Promise<unknown>; emit: (e: CryptoFeedEvent) => void; status: (venue: CryptoVenue, state: VenueState) => void; log: (l: string) => void; urlFor?: (venue: CryptoVenue) => string });
  subscribe(req: { series: CryptoSeriesId; kind: 'ticker' | 'bars'; timeframe?: CryptoTimeframe }): { ok: true; subscriptionId: string } | { ok: false; detail: string };
  unsubscribe(id: string): boolean;
  history(req: { series: CryptoSeriesId; timeframe: CryptoTimeframe }): Promise<{ ok: true; bars: CryptoBar[] } | { ok: false; detail: string }>;
  states(): Record<CryptoVenue, VenueState>;
  closeAll(): void;
}
export const PING_EVERY_MS = 15_000, STALE_AFTER_MS = 30_000, BYBIT_PING_EVERY_MS = 20_000, RECONNECT_MAX_MS = 60_000;
```

Règles :
- `ManagedSocket` :
  - contrôle `hostOk(url)` avant d'ouvrir ; refus → `blocked`, journal.
  - `connecting` → `live` à l'ouverture ; ping de protocole toutes les 15 s, plus `appPing()` toutes les 20 s s'il est fourni (Bybit : `{"op":"ping"}`).
  - toute trame ou pong compte comme activité ; 30 s sans activité → `stale`, puis fermeture et reconnexion.
  - fermeture non demandée → `reconnecting`, nouvel essai après 1 s, 2 s, 4 s… plafonné à 60 s, remis à 1 s seulement après 30 s de connexion `live` et active (une venue qui accepte puis ferme aussitôt continue de doubler ; décision du contrôleur, revue de CRY2.3).
  - `unexpected-response` 418 → `gate.onHttpError` et `blocked` sans reconnexion ; 429 → backoff de la porte.
  - `close()` demandé : timers arrêtés, plus aucune reconnexion.
- `CryptoFeedHost` :
  - une socket par venue, ouverte au premier abonnement ;
  - compteur de références par clé de flux : une clé déjà active n'est pas réabonnée, et le dernier désabonnement d'une clé envoie l'`unsubscribe` ;
  - à chaque ouverture, réabonnement de toutes les clés actives ; plus aucun abonnement actif sur la venue → socket fermée (jamais de socket sans flux), état `off`, ou `blocked` s'il ne reste que des abonnements refusés.
  - Événements : ticker → `{ kind: 'ticker' }` ; kline Binance → `{ kind: 'bar', final }` ; trades Coinbase et Bybit → `TradeBarBuilder` de chaque abonnement `bars` du même marché et timeframe (créé à la confirmation de l'abonnement : l'accusé de la demande qui porte ses clés, ou la première trame de son propre flux, jamais celle d'un autre flux ; `startedAtMs` = cet instant + 1 s ; recréé à chaque reconnexion) → `{ kind: 'bar', final }`.
  - `history` : refusé `rate_limited` si la porte est fermée, `blocked` si la venue est bloquée ; pages récupérées en séquence ; agrégation si besoin ; coupe par l'heure, jamais par le nombre : les bougies dont `time >= min(00:00 UTC de la veille, seau courant − (HISTORY_BARS − 1) × tf × 60)` (une bascule de seau pendant la pagination rend une bougie de plus, que la coupe garde).
  - `closeAll()` : toutes les sockets fermées, tous les abonnements oubliés, aucun timer vivant.

- [ ] **Étape 1 : tests rouges** (fausse `WsLike`, `vi.useFakeTimers`) :
  - `opens one socket per venue and subscribes after open` : deux abonnements `ticker` Coinbase → une socket sur `wss://ws-feed.exchange.coinbase.com`, un seul message `subscribe` contenant `ticker` et `heartbeat` pour `BTC-USD`.
  - `stays live without trades` : pong toutes les 15 s pendant 10 min sans aucun trade → état `live`.
  - `goes stale then reconnects with backoff` : 30 s de silence → `stale` puis `reconnecting` ; nouvelle socket après 1 s, puis 2 s ; réabonnement à l'ouverture.
  - `blocks on 418 without reconnecting` : `unexpected-response` 418 → `blocked`, aucune nouvelle socket après 5 min.
  - `closeAll stops everything` : après `closeAll()`, `vi.getTimerCount() === 0` et aucune socket ouverte après un `close` du faux serveur.
  - `builds Coinbase bars from matches` : un abonnement `bars` 1 min et deux `match` du même seau complet → événement `bar` avec `buyVolume`.
  - `history` : fixture Binance → bougies analysées ; Coinbase 240 → 4 appels puis agrégation ; porte fermée → `{ ok: false, detail: 'rate_limited' }`.
  - Intégration : un vrai `WebSocketServer` de `ws` sur `127.0.0.1:0`, `urlFor` vers lui, `hostOk` permissif dans le test ; un message ticker du serveur atteint `emit` ; la fermeture côté serveur déclenche une reconnexion.
- [ ] **Étape 2 : lancer `npx vitest run tests/crypto-feeds.test.ts`** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY2.3 tenir une socket par venue, vivante sans trade`.

### Tâche CRY2.4 : température dans le main

**Fichiers** — Créer `electron/crypto-temperature.ts`. Test : `tests/crypto-temperature-host.test.ts`.

**Interfaces**
- Consomme : `PREMIUM_INDEX_URL`, `TICKER_24H_URL`, `openInterestUrl`, `FORCE_ORDER_URL` (CRY1.3) ; `fundingFromPremiumIndex`, `breadthFromTickers`, `oiChange`, `LiquidationWindow`, `emptyReading` (CRY1.6) ; `ManagedSocket` (CRY2.3) ; `VenueGate` (CRY2.2, clé `binance`).
- Produit : `class TemperatureHost { constructor(deps: { fetchJson; ws; hostOk; timers; now; gate; emit: (r: TemperatureReading) => void; log }); start(): void; stop(): void; current(): TemperatureReading | null }`.

Règles :
- `start()` : `premiumIndex` tout de suite puis toutes les 60 s ; `ticker/24hr` et `openInterestHist` (BTCUSDT, ETHUSDT) tout de suite puis toutes les 5 min ; socket `forceOrder`.
- Chaque relevé fusionne dans la lecture courante puis `emit`.
- Porte `binance` bloquée → aucun appel.
- `stop()` : timers et socket arrêtés, lecture effacée.

- [ ] **Étape 1 : test rouge** (faux fetch à fixtures, fausse socket, faux timers) : après `start()`, `emit` reçoit funding, largeur et OI ; 60 s plus tard, nouvel appel à `premiumIndex` seulement ; un message `forceOrder` met à jour `liquidations.long` ; après `stop()`, `vi.getTimerCount() === 0` et plus aucun fetch ; porte bloquée → aucun fetch.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY2.4 relever la température Binance dans le process principal`.

### Tâche CRY2.5 : branchement Electron et IPC

**Fichiers**
- Créer : `electron/crypto-ipc.ts` (validation pure), `electron/crypto-electron.ts` (seul fichier crypto qui importe `electron` et `ws`).
- Modifier : `electron/main.ts`, `electron/preload.ts`, `src/lib/desk.ts`.
- Tests : `tests/crypto-ipc.test.ts`, `tests/crypto-runtime.test.ts`.

**Interfaces — produit**

```ts
// crypto-ipc.ts
export function parseHistoryRequest(raw: unknown): { series: CryptoSeriesId; timeframe: CryptoTimeframe } | null;
export function parseSubscribeRequest(raw: unknown): { series: CryptoSeriesId; kind: 'ticker' | 'bars'; timeframe?: CryptoTimeframe } | null; // ticker : marché affichable ; bars : affichable ou proxy, timeframe requis
export function isSubscriptionId(raw: unknown): raw is string; // ≤ 64 caractères, [a-z0-9-]
// crypto-electron.ts
export interface CryptoMainStatus { enabled: boolean; venues: Record<CryptoVenue, VenueState> }
export interface CryptoRuntime {
  enabled(): boolean; status(): CryptoMainStatus;
  enable(): Promise<CryptoMainStatus>; disable(): CryptoMainStatus;
  history(raw: unknown): Promise<{ ok: true; bars: CryptoBar[] } | { ok: false; detail: string }>;
  subscribe(raw: unknown): { ok: true; subscriptionId: string } | { ok: false; detail: string };
  unsubscribe(raw: unknown): { ok: boolean };
  temperature(): TemperatureReading | null;
  shutdown(): void; // fenêtre fermée : ferme tout sans changer l'interrupteur
}
export function createCryptoRuntime(deps: { userDataDir: string; locale: () => AppLocale; window: () => BrowserWindow | null; showMessageBox: CryptoSwitchDeps['showMessageBox']; send: (channel: 'crypto:event' | 'crypto:temperature' | 'crypto:status', payload: unknown) => void; log: (l: string) => void; ws?: WsFactory; fetchImpl?: FetchLike }): CryptoRuntime;
```

Règles :
- `createCryptoRuntime` lie `net.fetch` et `new WebSocket(url, { headers: { 'User-Agent': 'CANTO-Desk (crypto)' } })` par défaut (remplaçables dans les tests) ; `hostOk = (u) => cryptoHostAllowed(u, u.startsWith('wss:') ? 'wss:' : 'https:')`.
- Interrupteur éteint → `history`, `subscribe` et `temperature` refusent avec `crypto_disabled`, sans aucun appel.
- Allumage → `TemperatureHost.start()` ; extinction → `feeds.closeAll()` et `temperature.stop()`.
- Chaque changement d'état d'une venue ou de l'interrupteur envoie `crypto:status`.
- `electron/main.ts` : `let cryptoRuntime: CryptoRuntime | null = null` créé dans `app.whenReady` ; sept `ipcMain.handle` (`crypto:status`, `crypto:enable`, `crypto:disable`, `crypto:history`, `crypto:subscribe`, `crypto:unsubscribe`, `crypto:temperature`), chacun `trusted(e) && cryptoRuntime ? … : repli` ; `window-all-closed` → `cryptoRuntime?.shutdown()`. Aucun `net.fetch` dans `main.ts`.
- `preload.ts` : `crypto: { status, enable, disable, history, subscribe, unsubscribe, temperature, onEvent: (cb) => subscribe('crypto:event', cb), onTemperature: (cb) => subscribe('crypto:temperature', cb), onStatus: (cb) => subscribe('crypto:status', cb) }`.
- `src/lib/desk.ts` : `CryptoApi` complète, avec des types importés de `@/engine/crypto/markets` et `@/engine/crypto/temperature`.

- [ ] **Étape 1 : tests rouges** :
  - `crypto-ipc` : formes valides et invalides (série inconnue, ticker sur un proxy refusé, timeframe 30 refusé, `bars` sans timeframe refusé, id de 65 caractères refusé).
  - `crypto-runtime` (fausse socket, faux fetch, faux dialogue) : éteint → `history` répond `crypto_disabled` et le faux fetch n'est jamais appelé ; dialogue accepté → `crypto:status` envoyé avec `enabled: true` et `premiumIndex` demandé ; `disable()` → plus aucune socket ni aucun timer.
  - Texte de `electron/main.ts` : sept `ipcMain.handle('crypto:`, tous suivis de `trusted(e)`, et toujours aucun `net.fetch`.
- [ ] **Étape 2 : lancer les tests** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY2.5 brancher le module crypto au process principal`.

---

## Lot CRY3 — état du renderer

### Tâche CRY3.1 : assainisseurs des réglages crypto

**Fichiers** — Modifier `src/store/db.ts` (`SETTING_ROW_SANITIZERS`). Test : `tests/crypto-settings.test.ts`.

**Interfaces** — Consomme `sanitizeCryptoChart`, `sanitizeWatchlist`, `sanitizeAlerts`, `sanitizeDrawings` (CRY1.7). Produit : les entrées `'crypto.chart'`, `'crypto.watchlist'`, `'crypto.alerts'`, `'crypto.drawings'`.

- [ ] **Étape 1 : test rouge** : un coffre v1 (format de `tests/vault-restore.test.ts`) avec ces quatre lignes, dont une invalide → `prepareVaultRestore(...).otherSettings` garde les valeurs assainies, et `skipped.settings` compte la ligne écartée.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert.
- [ ] **Étape 5 : commit** `CRY3.1 assainir les réglages crypto du coffre`.

### Tâche CRY3.2 : port crypto du moteur

**Fichiers** — Créer `src/engine/crypto/port.ts`. Test : `tests/crypto-port.test.ts`.

**Interfaces — produit**

```ts
export interface CryptoTransport {
  history(req: { series: CryptoSeriesId; timeframe: CryptoTimeframe }): Promise<{ ok: true; bars: CryptoBar[] } | { ok: false; detail: string }>;
  subscribe(req: { series: CryptoSeriesId; kind: 'ticker' | 'bars'; timeframe?: CryptoTimeframe }): Promise<{ ok: true; subscriptionId: string } | { ok: false; detail: string }>;
  unsubscribe(id: string): Promise<{ ok: boolean }>;
  onEvent(cb: (e: CryptoFeedEvent) => void): () => void;
}
export function createCryptoPort(transport: CryptoTransport): MarketDataPort; // sourceId 'crypto'
```

Correspondance avec `MarketDataPort` (`src/engine/marketdata/port.ts:56-64`) :
- `history` : `instrument` est l'id de série, filtré sur `from` et `to`, puis `dedupeBars` ;
- `subscribe` : `kind 'bars'` → abonnement `bars` (événements `{ kind: 'bar', instrument, timeframe, bar, final }`) ; `kind 'quote'` → abonnement `ticker` (événements `{ kind: 'quote', quote: { instrument, time, last } }`) ; `kind 'tick'` → `{ kind: 'status', state: 'error' }` ;
- `dispose()` est idempotent et désabonne tout.

- [ ] **Étape 1 : test rouge** (faux transport) : historique filtré et dédoublonné ; bar et quote routés vers le bon abonné seulement ; `tick` refusé ; `dispose` deux fois → un seul `unsubscribe` par abonnement.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter** (modèle : `src/engine/marketdata/adapters/nt8.ts`).
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert.
- [ ] **Étape 5 : commit** `CRY3.2 exposer le flux crypto comme un port de marché`.

### Tâche CRY3.3 : store crypto, état et actions

**Fichiers** — Modifier `src/store/crypto.ts`. Test : `tests/crypto-store.test.ts` (`vi.mock('@/store/db')` pour `getSetting` et `setSetting`, modèle : `tests/notes-update.test.ts`).

**Interfaces — produit** (en plus de CRY0.4)

```ts
type By = 'trader' | 'agent';
type WriteResult = { ok: true; id?: string } | { ok: false; reason: string };
interface CryptoState {
  market: CryptoMarketId; timeframe: CryptoTimeframe; indicators: IndicatorInstance[];
  watchlist: CryptoMarketId[]; alerts: CryptoAlert[]; drawings: CryptoDrawing[];
  bars: CryptoBar[]; proxyBars: CryptoBar[]; cvdAnchoredAt: number | null;
  tickers: Partial<Record<CryptoMarketId, CryptoTicker>>; temperature: TemperatureReading | null;
  chartOpen: boolean; agentLog: { at: number; tool: string; effect: string }[];
  setMarket(id: string, by?: By): Promise<WriteResult>;
  setTimeframe(tf: number, by?: By): Promise<WriteResult>;
  addIndicator(definitionId: string, params?: Record<string, number | string>, by?: By): Promise<WriteResult>;
  updateIndicator(id: string, patch: Record<string, number | string>): Promise<void>;
  toggleIndicator(id: string): Promise<void>;
  removeIndicator(id: string, by?: By): Promise<WriteResult>;
  addDrawing(d: Omit<CryptoDrawing, 'id' | 'createdAt' | 'author'>, by?: By): Promise<WriteResult>;
  removeDrawing(id: string, by?: By): Promise<WriteResult>;
  createAlert(a: Omit<CryptoAlert, 'id' | 'state' | 'createdAt' | 'author'>, by?: By): Promise<WriteResult>;
  deleteAlert(id: string, by?: By): Promise<WriteResult>;
  setAlertState(id: string, state: CryptoAlert['state'], at?: number): Promise<void>;
  addToWatchlist(id: string, by?: By): Promise<WriteResult>;
  removeFromWatchlist(id: string, by?: By): Promise<WriteResult>;
}
```

Règles :
- `load()` lit `crypto.chart`, `crypto.watchlist`, `crypto.alerts` et `crypto.drawings` par `getSetting` et les assainit (CRY1.7) ; défauts : `DEFAULT_CRYPTO_MARKET`, `DEFAULT_CRYPTO_TIMEFRAME`, `DEFAULT_CRYPTO_INDICATORS`, `CHARTABLE_MARKETS`, `[]`, `[]`.
- Toute écriture valide puis persiste par `setSetting`.
- Refus explicites :
  - `unknown_market`, `bad_timeframe`, `unknown_indicator` ;
  - `alerts_full` à 50 alertes, `drawings_full` à 100 tracés ;
  - `not_in_watchlist` pour une alerte de prix hors de la watchlist ;
  - `market_has_alerts` pour retirer de la watchlist un marché qui porte une alerte ;
  - `label_too_long` au-delà de 40 caractères ;
  - les raisons de `validateAlert` (CRY1.7).
- `by === 'agent'` → l'entrée ajoutée porte `author: 'agent'` (alertes, tracés) et une ligne est inscrite dans `agentLog` (20 au plus, la plus récente d'abord).

- [ ] **Étape 1 : test rouge** : chargement par défaut puis chargement de réglages enregistrés ; chaque refus listé ; une écriture de l'agent marque `author: 'agent'` et alimente `agentLog` ; `setSetting` reçoit la valeur assainie.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert.
- [ ] **Étape 5 : commit** `CRY3.3 tenir l’état et les réglages de l’onglet crypto`.

### Tâche CRY3.4 : flux en direct dans le renderer

**Fichiers** — Créer `src/store/cryptoLive.ts`, modifier `src/store/crypto.ts` (`openChart`, `closeChart`, démarrage à `enabled`). Test : `tests/crypto-live.test.ts`.

**Interfaces**
- Consomme : `createCryptoPort` (CRY3.2), `mergeLiveBar` (CRY1.4), `cvdAnchor` (CRY1.4), `desk.crypto` (CRY2.5).
- Produit : `openChart(): void`, `closeChart(): void` dans le store ; `startLight(): () => void` et `startChart(): () => void` dans `cryptoLive.ts`.

Règles :
- **Léger**, tant que l'interrupteur est allumé : un abonnement `ticker` par marché de la watchlist, mis à jour quand elle change ; `onTemperature` et une lecture initiale `temperature()` ; `onStatus` met à jour `venues`.
- **Lourd**, tant que `chartOpen` :
  - abonnement `bars` du marché et du timeframe, puis `history` ;
  - pour BTC et ONDO avec `cvd-binance` visible, historique et abonnement `bars` de leur `cvdProxy` dans `proxyBars` ;
  - chaque bougie live passe par `mergeLiveBar` ;
  - `cvdAnchoredAt = cvdAnchor(bars)`.
- **Jeton de requête** : chaque changement de marché ou de timeframe incrémente un compteur ; un historique qui revient avec un jeton périmé est ignoré.
- `closeChart()` ou un changement de marché désabonne l'ancien flux lourd. L'extinction arrête tout.

- [ ] **Étape 1 : tests rouges** (faux `window.canto.crypto` à promesses contrôlées) :
  - `ignores a stale history response` : `setMarket(ONE)` puis `setMarket(ZIG)` ; l'historique de ONE revient après celui de ZIG → `bars` reste celui de ZIG.
  - Changer la watchlist ajoute ou retire l'abonnement ticker correspondant.
  - `closeChart()` → `unsubscribe` du flux lourd.
  - Une bougie partielle ne change pas le volume.
  - La température poussée arrive dans l'état.
  - L'extinction désabonne tout.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert.
- [ ] **Étape 5 : commit** `CRY3.4 suivre les flux crypto en direct dans le renderer`.

---

## Lot CRY4 — interface au design du desk

### Tâche CRY4.1 : précision de prix et tracés dans le chart

**Fichiers** — Modifier `src/lib/format.ts:75` (`fmtPrice(v, digits = 2)`), `src/modules/visual/Chart.tsx` (props optionnelles), créer `src/lib/cssToken.ts`. Test : `tests/crypto-chart-format.test.ts` (jsdom ; `vi.mock('lightweight-charts')` qui enregistre les options des séries et les appels `createPriceLine`).

**Interfaces — produit**
- `fmtPrice(v: number | null | undefined, digits?: number): string`, avec 2 par défaut : le comportement actuel ne change pas.
- `Chart` : `priceFormat?: { precision: number; minMove: number }` (défaut `{ precision: 2, minMove: 0.25 }`, comme aujourd'hui) qui s'applique à la série de bougies et au `priceFormatter` (`fmtPrice(p, precision)`) ; `priceLines?: { id: string; price: number; title: string; color: string }[]`, gérées par id (ajout, retrait, mise à jour) en `LineStyle.Dashed`.
- `cssToken(name: string, fallback: string): string` lit `getComputedStyle(document.documentElement)`.

- [ ] **Étape 1 : test rouge** : `fmtPrice(0.002163, 6) === fixedFormatterForTest(6).format(0.002163)` ; `fmtPrice(23429.5) === fixedFormatterForTest(2).format(23429.5)` ; `Chart` sans les nouvelles props → `priceFormat { precision: 2, minMove: 0.25 }` ; avec `{ precision: 6, minMove: 0.000001 }` → appliqué ; deux `priceLines` → deux `createPriceLine`, et une retirée → `removePriceLine`.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert, `visual-*` compris.
- [ ] **Étape 5 : commit** `CRY4.1 afficher chaque prix à la précision de son marché`.

### Tâche CRY4.2 : cartes d'indicateurs partagées avec Visual

**Fichiers** — Créer `src/modules/visual/IndicatorCards.tsx` ; modifier `src/modules/visual/Visual.tsx` ; créer `src/modules/crypto/indicatorCopy.ts`. Test : `tests/indicator-cards.test.ts` (jsdom).

**Interfaces — produit**
- `IndicatorCards({ instances, catalog, nameOf, descOf, onAdd, onToggle, onUpdate, onRemove }: { instances: IndicatorInstance[]; catalog: IndicatorDefinition[]; nameOf: (id: string, fallback: string) => string; descOf: (id: string, fallback: string) => string; onAdd: (definitionId: string) => void; onToggle: (id: string) => void; onUpdate: (id: string, patch: Record<string, number | string>) => void; onRemove: (id: string) => void })`.
- Le composant rend exactement ce que `Visual.tsx:360-421` rend aujourd'hui : titre `Indicateurs · n`, bouton `+ Ajouter`, catalogue, cartes, paragraphe du Lab ; classes de `visual.module.css`.
- `trIndicatorName`, `trIndicatorDesc` et `trParamLabel` sont déplacés et exportés.
- `indicatorCopy.ts` : noms et descriptions de `cvd`, `cvd-binance`, `vwap-utc` et `levels-utc` en trois langues, repli sur `trIndicatorName` et `trIndicatorDesc`.

- [ ] **Étape 1 : test rouge** : deux instances → deux cartes, `Toggle` qui appelle `onToggle`, `×` qui appelle `onRemove`, catalogue ouvert par `+ Ajouter` → `onAdd('ema')`.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter**, puis faire utiliser le composant par Visual sans changer son rendu.
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert, `visual-*` inchangés.
- [ ] **Étape 5 : commit** `CRY4.2 partager les cartes d’indicateurs de Visual`.

### Tâche CRY4.3 : onglet Crypto complet

**Fichiers** — Modifier `src/modules/crypto/Crypto.tsx` ; créer `src/modules/crypto/CryptoSide.tsx`, `src/modules/crypto/AlertModal.tsx`, `src/modules/crypto/crypto.module.css`. Test : `tests/crypto-module.test.ts` (jsdom, `vi.mock('@/modules/visual/Chart')` qui capture ses props, `window.canto.crypto` simulé, état du store posé par `useCrypto.setState`).

**Interfaces** — Consomme le store (CRY3.3, CRY3.4), `IndicatorCards` (CRY4.2), `Chart` (CRY4.1), `CRYPTO_INDICATORS` et `inputBarsFor` (CRY1.5). Composition : spec § 7, à la lettre.
- En-tête : `ModuleHeader tab="crypto"`, `meta` `4 MARCHÉS · 3 VENUES`, puis les actions dans l'ordre de `Visual.tsx:273-298` :
  - `Tag` mint « direct » ou ember « données périmées » selon l'état de la venue du marché ;
  - `<select>` des quatre marchés (`label` du registre) ;
  - `Segmented` des six timeframes (`1m 5m 15m 1h 4h 1j`, avec `1d` en anglais et en espagnol).
- Corps : `ModuleContent noPad`, grille `layout` de Visual. L'onglet importe `../visual/visual.module.css` pour `layout`, `chartWrap`, `legend`, `legendMain`, `legendRow`, `stamp`, `side`, `sideSection`, `sideTitle`, `desc` et `tradeRow`. `crypto.module.css` ne porte que les lignes de marché et d'alerte, en jetons.
- Chart : `priceFormat = { precision, minMove: tickSize }` du marché ; les tracés du marché sont passés en `priceLines`, couleur `cssToken('--violet', …)`, titre `AGENT` pour l'agent, sinon le label.
- Légende : `<symbol> · <tf>`, OHLC par `fmtPrice(v, precision)`, Vol, puis l'ancrage du CVD : `CVD depuis HH:MM` quand `cvdAnchoredAt` existe, `CVD Binance` quand `cvd-binance` est visible.
- Colonne, dans cet ordre de titres : `Marchés · 4`, `Indicateurs · n`, `Température · Binance`, `Alertes · n`, `Source`, `Agent` ; contenu de chaque section selon la spec § 7.
- `AlertModal` : `Modal` du desk, `Field`, `<select>` (cible, type, mode), `input` pour le niveau, boutons `ghost` et `gold` ; erreurs de `createAlert` affichées en clair.
- `useEffect` : `openChart()` au montage, `closeChart()` au démontage.

- [ ] **Étape 1 : test rouge** :
  - Plaque `CRY` et `Crypto` ; `<select>` à 4 options dans l'ordre du registre ; `Segmented` à 6 boutons.
  - Venue `live` → texte `direct`.
  - Légende BTC à 2 décimales ; après `setMarket('binance:ONEUSDT')`, 6 décimales ; props de `Chart` : `priceFormat { precision: 6, minMove: 0.000001 }`.
  - Titres de la colonne dans l'ordre exact ; `CVD depuis` affiché quand l'ancre existe.
  - `Éteindre le module` appelle `disable` ; interrupteur éteint → état vide de CRY0.4.
  - Aucune couleur hex dans `src/modules/crypto/*.css` (contrôle de `design-guard`).
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert, `design-guard` compris.
- [ ] **Étape 5 : commit** `CRY4.3 composer l’onglet crypto au design du desk`.

### Tâche CRY4.4 : banc de capture visuelle

**Fichiers**
- Créer : `scripts/harness/crypto.html`, `scripts/harness/crypto-harness.tsx`, `scripts/harness/fakeCryptoDesk.ts`, `scripts/capture-crypto.mjs`.
- Test : `tests/crypto-harness.test.ts`.

**Interfaces**
- `fakeCryptoDesk(fixtures): CryptoApi & Pick<DeskApi, 'orchestrator'>` : interrupteur allumé, trois venues `live`, historique tiré des réponses réelles du 9 octobre 2026, ticks rejoués, température figée ; les membres obligatoires de `DeskApi` sont des fonctions vides.
- `crypto-harness.tsx` : pose `window.canto`, monte `Shell` sur l'onglet `crypto` sans le verrou d'ouverture. Ce banc n'est jamais chargé par l'application.
- `capture-crypto.mjs` : attend `npx vite` sur `127.0.0.1:5173`, puis lance `msedge --headless=new --disable-gpu --hide-scrollbars --window-size=1600,1000 --screenshot=<sortie> http://127.0.0.1:5173/scripts/harness/crypto.html?lang=en`. Sortie par défaut : `docs/design/crypto/09-cry.png`.

- [ ] **Étape 1 : test rouge** : `fakeCryptoDesk` expose toutes les méthodes de `CryptoApi` (liste tirée de `src/lib/desk.ts`), et `history` rend des bougies qui passent `parseCandles`.
- [ ] **Étape 2 : lancer le test** → échec.
- [ ] **Étape 3 : implémenter**, lancer `npx vite` puis `node scripts/capture-crypto.mjs`, et regarder la capture à côté de `docs/media/visual.png`.
- [ ] **Étape 4 : `npm run typecheck && npm test`** → vert ; la capture existe.
- [ ] **Étape 5 : commit** `CRY4.4 capturer l’onglet crypto sur un banc local` (capture comprise).

---

## Lot CRY5 — alertes

### Tâche CRY5.1 : évaluer et signaler les alertes

**Fichiers**
- Créer : `src/store/cryptoAlerts.ts`.
- Modifier : `src/store/crypto.ts`, `src/engine/agent/catalog.ts:132` (`'crypto_alert'`), `electron/agent/catalog.d.ts:10` (tuple), `src/engine/agent/tools.ts` (description et textes de `desk_events`).
- Tests : `tests/crypto-alert-runner.test.ts`, `tests/agent-events.test.ts` (liste des types).

**Interfaces — produit**

```ts
export class CryptoAlertRunner {
  sync(alerts: readonly CryptoAlert[]): void;            // une CrossWatch par alerte armée, gardée d'un appel à l'autre
  onTicker(t: CryptoTicker, fresh: boolean): CryptoAlert[];             // alertes de prix franchies
  onTemperature(r: TemperatureReading, fresh: boolean): CryptoAlert[];  // alertes de température franchies
}
```

Règles :
- `fresh` vaut faux si la venue n'est pas `live`, ou si la lecture de température est plus vieille que deux cadences (funding 120 s, largeur et OI 10 min). Une alerte non fraîche n'est pas évaluée.
- Quand une alerte se déclenche :
  - `once` → `setAlertState(id, 'triggered', now)` ; `rearm` → reste `armed`, avec `lastTriggeredAt`.
  - `toast(tr(…), 'warn')` ;
  - `recordDeskEvent('crypto_alert', { alertId, target, kind, level, value, author })`.
- Une alerte `paused` ou `triggered` n'est pas évaluée.

- [ ] **Étape 1 : test rouge** :
  - Une seule alerte au franchissement ; aucune sur une donnée non fraîche ; réarmement pour `rearm` ; `once` passe à `triggered`.
  - Une alerte funding à `0.01` se déclenche quand la médiane passe de `0.00009` à `0.00011`.
  - Le store pousse un événement `crypto_alert` dans `deskEventLog` et appelle `toast`.
  - `DESK_EVENT_KINDS` se termine par `'crypto_alert'`.
- [ ] **Étape 2 : lancer les tests** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY5.1 signaler les alertes crypto au desk et à l’agent`.

---

## Lot CRY6 — agent et passerelle

### Tâche CRY6.1 : dix outils `crypto_*`

**Fichiers**
- Créer : `src/engine/crypto/views.ts`, `src/engine/agent/cryptoTools.ts`.
- Modifier : `src/engine/agent/catalog.ts` (`DESK_TOOL_KINDS`, `DESK_TOOL_HINTS`, `DESK_TOOL_TITLES`), `src/engine/agent/ports.ts` (`CryptoDeskPort`, `DeskPorts.crypto?`, `SHORT_ARGS` + `'market'`, `'label'`), `src/engine/agent/tools.ts`.
- Tests : `tests/crypto-tools.test.ts` (nouveau) ; mises à jour de `tests/helpers/demoDesk.ts` (port crypto allumé qui enregistre ses écritures dans `writes`), `tests/agent-injection.test.ts` (entrées `OBEY` pour les cinq écritures), `tests/agent-tool-schemas.test.ts` (`REAL_VALUED` + `crypto_alert_set.level`, `crypto_drawing_set.price`, `crypto_drawing_set.from`, `crypto_drawing_set.to`), `tests/mcp-catalog.test.ts` (indications des écritures crypto).

**Interfaces — produit**

```ts
// ports.ts
export interface CryptoDeskPort {
  enabled(): boolean; tabOpen(): boolean;
  status(): CryptoStatusView; chart(): CryptoChartView | null; watchlist(): CryptoWatchRow[];
  temperature(): TemperatureReading | null; alerts(): CryptoAlertView[];
  setChart(p: { market?: CryptoMarketId; timeframe?: CryptoTimeframe }): Promise<CryptoWriteResult>;
  setIndicator(p: { action: 'add' | 'remove'; indicator?: string; params?: Record<string, number | string>; id?: string }): Promise<CryptoWriteResult>;
  setDrawing(p: { action: 'add' | 'remove'; kind?: 'level' | 'zone'; market?: CryptoMarketId; price?: number; from?: number; to?: number; label?: string; id?: string }): Promise<CryptoWriteResult>;
  setAlert(p: { action: 'create' | 'delete'; target?: CryptoMarketId | 'temperature'; kind?: CryptoAlertKind; level?: number; mode?: 'once' | 'rearm'; id?: string }): Promise<CryptoWriteResult>;
  setWatchlist(p: { action: 'add' | 'remove'; market: CryptoMarketId }): Promise<CryptoWriteResult>;
}
// DeskPorts : crypto?(): CryptoDeskPort | null;
// tools.ts
export function toolSchemas(opts?: { crypto?: boolean }): ToolSchema[];                  // sans crypto par défaut
export function describedDeskTools(opts?: { crypto?: boolean }): (ToolSchema & { kind: 'read' | 'write'; title: string })[];
// cryptoTools.ts
export const CRYPTO_TOOL_NAMES: readonly string[]; // les dix, préfixe 'crypto_'
export function isCryptoTool(name: string): boolean;
export function createCryptoTools(ports: DeskPorts): DeskTool[];
export function cryptoToolBlurb(name: string, fallback: string): string | null;
```

`views.ts` définit `CryptoStatusView`, `CryptoChartView` (marché, venue, timeframe, `precision`, `bars`, lignes d'indicateurs `{ id, label, data }`, `cvdAnchoredAt`), `CryptoWatchRow`, `CryptoAlertView` (avec `evaluable` et `reason?`) et `CryptoWriteResult`.

Catalogue :

| Outil | Genre | Indications | Titres (fr · en · es) |
|---|---|---|---|
| `crypto_status` | read | lecture | État du module crypto · Crypto module status · Estado del módulo cripto |
| `crypto_chart_read` | read | lecture | Lire le chart crypto · Read the crypto chart · Leer el gráfico cripto |
| `crypto_watchlist_get` | read | lecture | Marchés crypto suivis · Watched crypto markets · Mercados cripto seguidos |
| `crypto_temperature` | read | lecture | Température du marché crypto · Crypto market temperature · Temperatura del mercado cripto |
| `crypto_alert_list` | read | lecture | Alertes crypto · Crypto alerts · Alertas cripto |
| `crypto_chart_set` | write | `{ readOnly: false, destructive: false, idempotent: true, openWorld: true }` | Changer le chart crypto · Change the crypto chart · Cambiar el gráfico cripto |
| `crypto_indicator_set` | write | `{ readOnly: false, destructive: true, idempotent: false, openWorld: false }` | Indicateur du chart crypto · Crypto chart indicator · Indicador del gráfico cripto |
| `crypto_drawing_set` | write | idem | Tracé du chart crypto · Crypto chart drawing · Trazado del gráfico cripto |
| `crypto_alert_set` | write | idem | Poser ou retirer une alerte crypto · Set or remove a crypto alert · Poner o quitar una alerta cripto |
| `crypto_watchlist_set` | write | `{ readOnly: false, destructive: true, idempotent: false, openWorld: true }` | Watchlist crypto · Crypto watchlist · Watchlist cripto |

Schémas :
- `market` est un `enum` des quatre marchés affichables ; `timeframe` un `integer` en `enum` ; `bars` un `integer` de 0 à 300 ; `label` une chaîne de 40 caractères au plus ; `level`, `price`, `from` et `to` sont des `number` ; `action`, `kind` et `mode` sont des `enum` ; `additionalProperties: false`.
- Chaque description cite l'équivalent OpenMarket (spec § 9) ; anglais et espagnol par `cryptoToolBlurb`, dont `toolBlurb` est le repli.

Règles d'exécution :
- **Garde d'interrupteur** : dans `executeDeskTool`, après le contrôle des arguments et **avant** la confirmation : `isCryptoTool(name) && !(ports.crypto?.()?.enabled() ?? false)` → `{ ok: false, reason: 'crypto_disabled' }`. `createDeskTools` ajoute `...createCryptoTools(ports)` en fin de liste.
- **`crypto_chart_read`** :
  - onglet fermé → `{ available: false, reason: 'tab_closed' }` ;
  - sinon `last`, `high`, `low`, `changePct` (première ouverture, dernière clôture) et `visibleBars` sur les 160 dernières bougies, `indicators: [{ id, label, value }]` (dernière valeur finie), `cvd: { source, anchoredAt }` ;
  - avec `bars: n`, les `n` dernières bougies `{ t, o, h, l, c, v, buy?, …valeur de chaque indicateur }`.
- **Marché hors registre** → `{ ok: false, reason: 'unknown_market' }` sans appel au port ; label de plus de 40 caractères → `{ ok: false, reason: 'label_too_long' }`.
- **Écritures** : appellent le port, qui écrit avec `by: 'agent'`, et rendent ce qui a changé.

- [ ] **Étape 1 : tests rouges** :
  - Lectures sur un faux port ; `chart_read` sur une fixture de 200 bougies → valeurs exactes calculées sur les 160 dernières.
  - `bars: 3` → 3 lignes avec les valeurs d'indicateurs.
  - Onglet fermé → `tab_closed`.
  - Chaque écriture appelle le port avec les bons arguments.
  - Marché `binance:BTCUSDT` → `unknown_market` sans appel.
  - Interrupteur éteint → `crypto_disabled` pour une lecture comme pour une écriture, et la confirmation n'est jamais demandée.
  - `toolSchemas()` ne contient aucun `crypto_*` ; `toolSchemas({ crypto: true })` en contient dix.
  - Tests existants mis à jour : `mcp-catalog`, `orchestrator-allowlist` (automatique), `agent-tool-schemas`, `agent-injection` (pour chaque écriture crypto : l'opérateur refuse, `operator_denied`, `desk.writes` vide).
- [ ] **Étape 2 : lancer les tests** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile`** → vert.
- [ ] **Étape 5 : commit** `CRY6.1 donner à l’agent dix outils crypto confirmés`.

### Tâche CRY6.2 : agent embarqué et passerelle MCP

**Fichiers**
- Modifier : `src/store/crypto.ts` (`cryptoDeskPort(): CryptoDeskPort`), `src/store/agent.ts` (`livePorts().crypto`, `toolSchemas({ crypto })`, `describedDeskTools({ crypto })`), `electron/mcp-server.ts` (`McpContext.cryptoEnabled`, filtre et refus, `READ_OUTPUT_HEADS` des cinq lectures, sixième paramètre de `McpGateway` `cryptoEnabled: () => boolean = () => false`), `electron/main.ts` (`() => cryptoRuntime?.enabled() ?? false`).
- Tests : `tests/crypto-mcp.test.ts` (nouveau) ; `tests/mcp-server.test.ts:569` (la liste attendue exclut `crypto_*` quand `cryptoEnabled` est absent).

**Interfaces** — Consomme CRY6.1 et CRY2.5. Règles :
- `deskTools(ctx)` retire les `crypto_*` quand `ctx.cryptoEnabled` n'est pas vrai.
- `tools/call` d'un `crypto_*` interrupteur éteint → `toolError(uiText(locale, 'Module crypto éteint dans CΛNTO : le trader l’allume dans l’onglet 09 · CRY.', 'Crypto module off in CΛNTO: the trader turns it on in tab 09 · CRY.', 'Módulo cripto apagado en CΛNTO: el trader lo enciende en la pestaña 09 · CRY.'))`.
- `crypto_status`, `crypto_chart_read`, `crypto_watchlist_get`, `crypto_temperature` et `crypto_alert_list` ont leurs têtes de sortie (`READ_OUTPUT_HEADS`, `mcp-server.ts:204-223`), égales aux clés de premier niveau de leurs résultats.

- [ ] **Étape 1 : tests rouges** :
  - `cryptoEnabled` absent → `tools/list` sans `crypto_*`, et `tools/call crypto_status` → `isError` avec le message.
  - `cryptoEnabled: true` avec un relais `describedDeskTools({ crypto: true })` et un faux bureau → les cinq lectures listées avec leur `outputSchema`, et `crypto_status` répond sans erreur.
  - `allowWrites` faux → aucune écriture crypto listée.
- [ ] **Étape 2 : lancer les tests** → échec.
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm run typecheck && npm test && npm run electron:compile && npm run check`** → vert.
- [ ] **Étape 5 : commit** `CRY6.2 ouvrir les outils crypto à la passerelle quand le module est allumé`.

---

## Lot CRY7 — recette

### Tâche CRY7.1 : recette et oracle

**Fichiers**
- Modifier : `docs/AUDIT.md` (section « Onglet 09 · CRY » : commits, tests, échecs observés sans les correctifs, résultats de l'oracle, liste de recette de l'ADMIN).
- Hors dépôt : script d'oracle dans le dossier temporaire de la session.

Étapes :
- [ ] **Étape 1 : `npm run check && npm run electron:compile`** → vert, hors `bridge-symlink`.
- [ ] **Étape 2 : oracle Coinbase.** Après `electron:compile`, un script Node hors dépôt importe `dist-electron/crypto/venues.js`, lit `historyRequests('coinbase:BTC-USD', 60, now)` par `fetch`, analyse avec `parseCandles`. Il compare les 50 dernières bougies closes à `chart_read bars:50` d'OpenMarket (lecture seule, `claude -p` limité à `mcp__openmarket__chart_workspace_select` et `mcp__openmarket__chart_read`, chart `BbIPo4lC`, BTC-USD Coinbase 1h). Attendu : O, H, L et C égaux au pas de prix, volume à ±1 %. Résultat consigné.
- [ ] **Étape 3 : oracle ONE**, seulement si l'ADMIN accepte un chart temporaire OpenMarket : CVD Binance du desk et CVD d'OpenMarket sur `BINANCE:ONEUSDT` 1h, signe de la variation bougie par bougie égal sur 50 bougies. Sans accord, la ligne reste « non faite ».
- [ ] **Étape 4 : liste de recette de l'ADMIN** (desk lancé, spec § 11, points 1, 2, 5 et 6) copiée dans `docs/AUDIT.md`, chaque point avec la commande ou le geste qui le vérifie.
- [ ] **Étape 5 : commit** `CRY7.1 consigner la recette de l’onglet crypto`.
