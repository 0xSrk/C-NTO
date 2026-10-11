/**
 * Les dix outils `crypto_*` de l'agent du desk (`docs/ONGLET-CRYPTO.md` § 9) : cinq lectures et cinq écritures du module
 * crypto, par le port `CryptoDeskPort` (`./ports.ts`). Ils reprennent le sens des outils de chart d'OpenMarket et citent leur
 * équivalent dans leur description (§ 10) : un agent qui pilote l'un pilote l'autre.
 *
 * - Interrupteur : sans port, port éteint ou port qui lève, chaque outil rend `crypto_disabled`. `executeDeskTool` (`./tools.ts`)
 *   le vérifie avant la confirmation de l'opérateur ; `run` le revérifie (les dix définitions existent toujours, port ou non).
 * - Lectures : ce que le trader a ouvert, jamais un flux de plus. Onglet fermé, `crypto_chart_read` le dit (`tab_closed`).
 * - Écritures : chaque argument est contrôlé avant le port (marché du registre, énumérations, label ≤ 40, id ≤ 64, prix finis et
 *   strictement positifs, zone dans l'ordre) et refusé en code stable sans l'appeler. Le port écrit avec `by: 'agent'` et rend
 *   le refus du store tel quel ; un port qui rejette (la base refuse d'enregistrer) rend `persist_failed`. Aucune exception ne
 *   sort d'un `run`.
 * - Nombres : une bougie sans prix fini est écartée ; toute autre valeur non finie devient `null`. Les prix sont arrondis à la
 *   précision du marché, les pourcentages à 2 à 4 décimales, les volumes à 6.
 */
import { tr } from '@/i18n';
import { CRYPTO_ALERT_KINDS, FUNDING_STALE_MS, SLOW_STALE_MS, validateAlert, type CryptoAlertKind } from '@/engine/crypto/alerts';
import { CRYPTO_INDICATORS, cryptoIndicatorById } from '@/engine/crypto/indicators';
import { CHARTABLE_MARKETS, CRYPTO_TIMEFRAMES, cryptoMarket, isChartableMarket, isCryptoTimeframe, type CryptoBar, type CryptoMarketId, type CryptoTimeframe } from '@/engine/crypto/markets';
import { LABEL_MAX } from '@/engine/crypto/persist';
import type { CryptoChartView, CryptoLineView, CryptoWriteResult } from '@/engine/crypto/views';
import type { IndicatorDefinition } from '@/engine/indicators';
import type { DeskToolName } from './catalog';
import { SHORT_ARG_MAX, type CryptoDeskPort, type DeskPorts } from './ports';
import type { DeskTool } from './tools';

const NAMES = [
  'crypto_status',
  'crypto_chart_read',
  'crypto_watchlist_get',
  'crypto_temperature',
  'crypto_alert_list',
  'crypto_chart_set',
  'crypto_indicator_set',
  'crypto_drawing_set',
  'crypto_alert_set',
  'crypto_watchlist_set',
] as const satisfies readonly DeskToolName[];

/** Les dix outils du module crypto, dans l'ordre du catalogue : les lectures, puis les écritures. */
export const CRYPTO_TOOL_NAMES: readonly string[] = NAMES;

export function isCryptoTool(name: string): boolean {
  return CRYPTO_TOOL_NAMES.includes(name);
}

/** La fenêtre que le chart montre à l'ouverture (`src/modules/visual/Chart.tsx:281`) : les bougies « visibles ». */
const VISIBLE_BARS = 160;
/** Lignes de bougies qu'une lecture rend au plus. */
const BARS_MAX = 300;
/** Décimales d'une variation en pourcent et d'un volume (volume, CVD, volume relatif). */
const PCT_DECIMALS = 2;
const QTY_DECIMALS = 6;
/** Clés d'une ligne de bougie : une ligne d'indicateur ne les remplace pas. */
const ROW_KEYS = new Set(['t', 'o', 'h', 'l', 'c', 'v', 'buy', '__proto__', 'constructor', 'prototype']);

type Refusal = { ok: false; reason: string };
type Checked<P> = { ok: true; plan: P } | Refusal;

const DISABLED: Refusal = { ok: false, reason: 'crypto_disabled' };
const refuse = (reason: string): Refusal => ({ ok: false, reason });
const accept = <P>(plan: P): Checked<P> => ({ ok: true, plan });

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Un prix de marché : fini et strictement positif, comme l'exigent les assainisseurs (`persist.ts`). */
const isPrice = (v: unknown): v is number => isNum(v) && v > 0;
/** Un identifiant non vide de 64 caractères au plus (`SHORT_ARG_MAX`). */
const readId = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= SHORT_ARG_MAX ? v : null);

/** Un nombre fini arrondi à `decimals`, ou `null` ; jamais `-0`. */
function fixed(v: unknown, decimals: number): number | null {
  if (!isNum(v)) return null;
  const factor = 10 ** decimals;
  const rounded = Math.round(v * factor) / factor;
  return Number.isFinite(rounded) ? rounded + 0 : null;
}

/** Une heure en millisecondes, en ISO ; `null` si elle n'est pas finie ou sort du calendrier. */
function iso(ms: unknown): string | null {
  return isNum(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}

/** Une copie où tout nombre non fini devient `null` : la dernière barrière avant l'agent. */
function scrub(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(scrub);
  // `fromEntries` définit les clés : une clé `__proto__` reste une donnée, jamais un prototype.
  if (isRec(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  return v;
}

const clock = (ports: DeskPorts): number => {
  const now = ports.now?.();
  return isNum(now) ? now : Date.now();
};

/** Le port du module s'il est branché et allumé ; sinon `null`. Un port qui lève compte pour éteint. */
export function cryptoPortOn(ports: DeskPorts): CryptoDeskPort | null {
  try {
    const port = ports.crypto?.() ?? null;
    return port && port.enabled() === true ? port : null;
  } catch {
    return null;
  }
}

/** Une lecture : le port allumé, puis la sortie sans nombre non fini. Un port qui lève rend `read_failed`. */
function read(ports: DeskPorts, body: (port: CryptoDeskPort) => Record<string, unknown>): Promise<unknown> {
  const port = cryptoPortOn(ports);
  if (!port) return Promise.resolve(DISABLED);
  try {
    return Promise.resolve(scrub(body(port)));
  } catch {
    return Promise.resolve(refuse('read_failed'));
  }
}

/**
 * Une écriture : le port allumé, les arguments contrôlés (refus sans appel), puis le port. Son refus passe tel quel ; un rejet
 * rend `persist_failed` ; `done` dit ce qui a changé, avec l'`id` de ce qui a été créé.
 */
async function write<P>(ports: DeskPorts, checked: Checked<P>, send: (port: CryptoDeskPort, plan: P) => Promise<CryptoWriteResult>, done: (plan: P, id: string | null) => Record<string, unknown>): Promise<unknown> {
  const port = cryptoPortOn(ports);
  if (!port) return DISABLED;
  if (!checked.ok) return checked;
  let result: unknown;
  try {
    result = await send(port, checked.plan);
  } catch {
    return refuse('persist_failed');
  }
  if (isRec(result) && result.ok === true) return scrub({ ok: true, ...done(checked.plan, typeof result.id === 'string' ? result.id : null) });
  return refuse(isRec(result) && typeof result.reason === 'string' ? result.reason : 'write_failed');
}

// --- Contrôle des arguments ----------------------------------------------------------------------------------------------

type ChartPlan = { market?: CryptoMarketId; timeframe?: CryptoTimeframe };

function chartPlan(args: Record<string, unknown>): Checked<ChartPlan> {
  const { market, timeframe } = args;
  if (market === undefined && timeframe === undefined) return refuse('nothing_to_change');
  const plan: ChartPlan = {};
  if (market !== undefined) {
    if (!isChartableMarket(market)) return refuse('unknown_market');
    plan.market = market;
  }
  if (timeframe !== undefined) {
    if (!isCryptoTimeframe(timeframe)) return refuse('bad_timeframe');
    plan.timeframe = timeframe;
  }
  return accept(plan);
}

/**
 * Les paramètres d'un indicateur, contrôlés en forme : un objet dont chaque clé est un paramètre de l'indicateur, un nombre fini
 * dans ses bornes, ou l'une de ses options. Le pas de la grille est vérifié par le store (`readParams`), qui refuse `bad_params`.
 */
function readParamsShape(def: IndicatorDefinition, raw: unknown): Record<string, number | string> | null {
  if (!isRec(raw)) return null;
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const spec = def.params.find((p) => p.key === key);
    if (!spec) return null;
    if (spec.type === 'number') {
      if (!isNum(value)) return null;
      if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) return null;
    } else if (typeof value !== 'string' || !spec.options?.some((option) => option.value === value)) {
      return null;
    }
    out[key] = value;
  }
  return out;
}

type IndicatorPlan = { action: 'add'; indicator: string; params?: Record<string, number | string> } | { action: 'remove'; id: string };

function indicatorPlan(args: Record<string, unknown>): Checked<IndicatorPlan> {
  if (args.action === 'add') {
    const def = typeof args.indicator === 'string' ? cryptoIndicatorById(args.indicator) : undefined;
    if (!def) return refuse('unknown_indicator');
    if (args.params === undefined) return accept({ action: 'add', indicator: def.id });
    const params = readParamsShape(def, args.params);
    return params ? accept({ action: 'add', indicator: def.id, params }) : refuse('bad_params');
  }
  if (args.action === 'remove') {
    const id = readId(args.id);
    return id ? accept({ action: 'remove', id }) : refuse('bad_id');
  }
  return refuse('bad_action');
}

type DrawingPlan =
  | { action: 'add'; kind: 'level'; market: CryptoMarketId; price: number; label?: string }
  | { action: 'add'; kind: 'zone'; market: CryptoMarketId; from: number; to: number; label?: string }
  | { action: 'remove'; id: string };

/** Mêmes refus et même ordre que `addDrawing` du store ; seuls les champs du genre sont repris. */
function drawingPlan(args: Record<string, unknown>): Checked<DrawingPlan> {
  if (args.action === 'remove') {
    const id = readId(args.id);
    return id ? accept({ action: 'remove', id }) : refuse('bad_id');
  }
  if (args.action !== 'add') return refuse('bad_action');
  const { market, kind, price, from, to, label } = args;
  if (!isChartableMarket(market)) return refuse('unknown_market');
  if (kind !== 'level' && kind !== 'zone') return refuse('bad_kind');
  if (kind === 'level' && !isPrice(price)) return refuse('bad_price');
  if (kind === 'zone' && !(isPrice(from) && isPrice(to) && from < to)) return refuse('bad_price');
  if (label !== undefined) {
    if (typeof label !== 'string') return refuse('bad_label');
    if (label.length > LABEL_MAX) return refuse('label_too_long');
  }
  const named = typeof label === 'string' ? { label } : {};
  return kind === 'level' ? accept({ action: 'add', kind, market, price: price as number, ...named }) : accept({ action: 'add', kind, market, from: from as number, to: to as number, ...named });
}

type AlertPlan =
  | { action: 'create'; target: CryptoMarketId | 'temperature'; kind: CryptoAlertKind; level: number; mode: 'once' | 'rearm' }
  | { action: 'delete'; id: string };

/** Un marché hors registre d'abord, puis le mode, puis `validateAlert` (genre, cible, niveau) : les refus du store. */
function alertPlan(args: Record<string, unknown>): Checked<AlertPlan> {
  if (args.action === 'delete') {
    const id = readId(args.id);
    return id ? accept({ action: 'delete', id }) : refuse('bad_id');
  }
  if (args.action !== 'create') return refuse('bad_action');
  const { target, kind, level, mode } = args;
  if (typeof target === 'string' && target !== 'temperature' && !isChartableMarket(target)) return refuse('unknown_market');
  if (mode !== 'once' && mode !== 'rearm') return refuse('bad_mode');
  const valid = validateAlert({ target, kind, level, mode, author: 'agent' } as Parameters<typeof validateAlert>[0]);
  if (!valid.ok) return refuse(valid.reason);
  return accept({ action: 'create', target: target as CryptoMarketId | 'temperature', kind: kind as CryptoAlertKind, level: level as number, mode });
}

type WatchPlan = { action: 'add' | 'remove'; market: CryptoMarketId };

function watchPlan(args: Record<string, unknown>): Checked<WatchPlan> {
  const { action, market } = args;
  if (action !== 'add' && action !== 'remove') return refuse('bad_action');
  if (!isChartableMarket(market)) return refuse('unknown_market');
  return accept({ action, market });
}

// --- Lectures ------------------------------------------------------------------------------------------------------------

/** La précision de la vue si elle est un entier plausible, sinon celle du registre. */
function precisionOf(view: CryptoChartView): number {
  const p = view.precision;
  return Number.isInteger(p) && p >= 0 && p <= 12 ? p : (cryptoMarket(view.market)?.precision ?? 2);
}

const decimalsOf = (line: CryptoLineView, precision: number): number => (line.unit === 'price' ? precision : QTY_DECIMALS);

function lastFinite(data: CryptoLineView['data']): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const value = data[i]?.value;
    if (isNum(value)) return value;
  }
  return null;
}

/** Les bougies en lignes compactes, avec la valeur de chaque ligne d'indicateur à leur heure (`null` sans valeur finie). */
function barRows(bars: readonly CryptoBar[], lines: readonly CryptoLineView[], precision: number): Record<string, number | null>[] {
  const series = lines
    .filter((line) => !ROW_KEYS.has(line.id))
    .map((line) => {
      const at = new Map<number, number>();
      for (const point of line.data) if (isNum(point.value)) at.set(point.time, point.value);
      return { id: line.id, at, decimals: decimalsOf(line, precision) };
    });
  return bars.map((bar) => {
    const row: Record<string, number | null> = {
      t: bar.time,
      o: fixed(bar.open, precision),
      h: fixed(bar.high, precision),
      l: fixed(bar.low, precision),
      c: fixed(bar.close, precision),
      v: fixed(bar.volume, QTY_DECIMALS),
    };
    if (isNum(bar.buyVolume)) row.buy = fixed(bar.buyVolume, QTY_DECIMALS);
    for (const line of series) row[line.id] = fixed(line.at.get(bar.time), line.decimals);
    return row;
  });
}

function chartRead(port: CryptoDeskPort, args: Record<string, unknown>): Record<string, unknown> {
  // Onglet fermé : rien à lire, et rien ne s'ouvre pour lire.
  if (port.tabOpen() !== true) return { available: false, reason: 'tab_closed' };
  const view = port.chart();
  const bars = (view?.bars ?? []).filter((b) => isNum(b.time) && isNum(b.open) && isNum(b.high) && isNum(b.low) && isNum(b.close));
  if (!view || bars.length === 0) return { available: false, reason: 'no_bars' };
  const precision = precisionOf(view);
  const visible = bars.slice(-VISIBLE_BARS);
  const first = visible[0]!;
  const last = visible[visible.length - 1]!;
  let high = first.high;
  let low = first.low;
  for (const bar of visible) {
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
  }
  const spec = cryptoMarket(view.market);
  const venue = spec?.venue ?? view.venue;
  const wanted = isNum(args.bars) ? Math.min(BARS_MAX, Math.max(0, Math.floor(args.bars))) : 0;
  return {
    available: true,
    market: view.market,
    label: spec?.label ?? null,
    venue,
    timeframe: view.timeframe,
    precision,
    visibleBars: visible.length,
    from: iso(first.time * 1000),
    to: iso(last.time * 1000),
    last: fixed(last.close, precision),
    high: fixed(high, precision),
    low: fixed(low, precision),
    changePct: first.open > 0 ? fixed(((last.close - first.open) / first.open) * 100, PCT_DECIMALS) : null,
    indicators: view.indicators.map((line) => ({ id: line.id, label: line.label, value: fixed(lastFinite(line.data), decimalsOf(line, precision)) })),
    // Binance : le volume acheteur est dans chaque bougie, historique compris. Coinbase et Bybit : depuis les trades reçus.
    cvd: {
      source: venue === 'binance' ? 'history' : 'live_trades',
      anchoredAt: isNum(view.cvdAnchoredAt) ? iso(view.cvdAnchoredAt * 1000) : null,
      binanceProxy: spec?.cvdProxy ?? null,
    },
    ...(wanted > 0 ? { bars: barRows(bars.slice(-wanted), view.indicators, precision) } : {}),
  };
}

function statusRead(port: CryptoDeskPort, now: number): Record<string, unknown> {
  const status = port.status();
  const spec = cryptoMarket(status.market);
  return {
    tabOpen: port.tabOpen() === true,
    market: status.market,
    label: spec?.label ?? null,
    venue: spec?.venue ?? null,
    timeframe: status.timeframe,
    venues: { ...status.venues },
    indicators: status.indicators.map((i) => ({ id: i.id, indicator: i.definitionId, visible: i.visible, params: { ...i.params } })),
    drawings: status.drawings.map((d) => {
      const precision = cryptoMarket(d.market)?.precision ?? 2;
      const shape = d.kind === 'level' ? { price: fixed(d.price, precision) } : { from: fixed(d.from, precision), to: fixed(d.to, precision) };
      return { id: d.id, market: d.market, kind: d.kind, ...shape, ...(d.label !== undefined ? { label: d.label } : {}), author: d.author, createdAt: iso(d.createdAt) };
    }),
    chartError: status.chartError ?? null,
    asOf: iso(now),
  };
}

function watchlistRead(port: CryptoDeskPort, now: number): Record<string, unknown> {
  const rows = port.watchlist();
  return {
    count: rows.length,
    markets: rows.map((row) => {
      const spec = cryptoMarket(row.market);
      const at = isNum(row.at) ? row.at : null;
      return {
        market: row.market,
        label: spec?.label ?? null,
        venue: spec?.venue ?? row.venue,
        venueState: row.venueState,
        last: fixed(row.last, spec?.precision ?? 2),
        change24hPct: fixed(row.change24hPct, PCT_DECIMALS),
        at: iso(at),
        ageMs: at === null ? null : Math.max(0, now - at),
      };
    }),
    registry: [...CHARTABLE_MARKETS],
    asOf: iso(now),
  };
}

/** Une fraction en pourcent, ou `null`. */
const pct = (v: unknown): number | null => (isNum(v) ? v * 100 : null);

function temperatureRead(port: CryptoDeskPort, now: number): Record<string, unknown> {
  const reading = port.temperature();
  if (!reading) return { available: false, reason: 'no_reading' };
  const stale = (at: unknown, maxAge: number): boolean | null => (isNum(at) ? now - at > maxAge : null);
  const count = (v: unknown): number | null => (isNum(v) ? v : null);
  const { funding, breadth, liquidations, openInterest } = reading;
  return {
    available: true,
    // Unités du `level` d'une alerte de température : funding en % par intervalle, largeur en %, liquidations en dollars US.
    funding: funding ? { medianPct: fixed(pct(funding.median), 4), btcPct: fixed(pct(funding.btc), 4), symbols: count(funding.symbols), at: iso(funding.at), stale: stale(funding.at, FUNDING_STALE_MS) } : null,
    breadth: breadth ? { upPct: fixed(pct(breadth.upShare), 1), pairs: count(breadth.pairs), at: iso(breadth.at), stale: stale(breadth.at, SLOW_STALE_MS) } : null,
    liquidations: liquidations
      ? {
          longUsd: fixed(liquidations.long, 0),
          shortUsd: fixed(liquidations.short, 0),
          since: iso(liquidations.since),
          at: iso(liquidations.at),
          stale: stale(liquidations.at, FUNDING_STALE_MS),
          lowerBound: true,
          note: tr(
            'Un minorant : Binance ne pousse qu’une liquidation par symbole et par seconde, et la fenêtre repart de zéro à chaque lancement du desk.',
            'A lower bound: Binance pushes at most one liquidation per symbol per second, and the window restarts from zero at each desk launch.',
            'Una cota inferior: Binance solo envía una liquidación por símbolo y por segundo, y la ventana vuelve a cero en cada arranque del desk.',
          ),
        }
      : null,
    openInterest: openInterest ? { btcPct: fixed(pct(openInterest.btc), 2), ethPct: fixed(pct(openInterest.eth), 2), at: iso(openInterest.at), stale: stale(openInterest.at, SLOW_STALE_MS) } : null,
    asOf: iso(now),
  };
}

function alertListRead(port: CryptoDeskPort, now: number): Record<string, unknown> {
  const alerts = port.alerts();
  return {
    count: alerts.length,
    alerts: alerts.map((a) => ({
      id: a.id,
      target: a.target,
      kind: a.kind,
      level: isNum(a.level) ? a.level : null,
      mode: a.mode,
      author: a.author,
      state: a.state,
      createdAt: iso(a.createdAt),
      ...(a.lastTriggeredAt !== undefined ? { lastTriggeredAt: iso(a.lastTriggeredAt) } : {}),
      evaluable: a.evaluable === true,
      ...(a.evaluable !== true && a.reason ? { reason: a.reason } : {}),
    })),
    asOf: iso(now),
  };
}

// --- Schémas ---------------------------------------------------------------------------------------------------------------

const MARKET = { type: 'string', enum: [...CHARTABLE_MARKETS], description: 'Marché du registre crypto (coinbase:BTC-USD, coinbase:ONDO-USD, binance:ONEUSDT, bybit:ZIGUSDT)' };
const ID = (what: string) => ({ type: 'string', minLength: 1, maxLength: SHORT_ARG_MAX, description: what });
const PRICE = (what: string) => ({ type: 'number', exclusiveMinimum: 0, description: what });
const ADD_REMOVE = { type: 'string', enum: ['add', 'remove'] };

const OFF_FR = ' Module crypto éteint : `crypto_disabled`.';
const OFF_EN = ' Crypto module off: `crypto_disabled`.';
const OFF_ES = ' Módulo cripto apagado: `crypto_disabled`.';
const CONFIRM_FR = ' Le trader confirme chaque écriture ; un argument hors registre ou hors bornes est refusé avant (code stable), un enregistrement refusé par la base rend `persist_failed`.';
const CONFIRM_EN = ' The trader confirms every write; an argument outside the registry or bounds is refused first (stable code), a save refused by the database returns `persist_failed`.';
const CONFIRM_ES = ' El trader confirma cada escritura; un argumento fuera del registro o de los límites se rechaza antes (código estable), un guardado rechazado por la base devuelve `persist_failed`.';

/** Les dix définitions, toujours : sans port crypto, leur `run` refuse (`crypto_disabled`), et `DESK_TOOLS` égale le catalogue. */
export function createCryptoTools(ports: DeskPorts): DeskTool[] {
  return [
    {
      name: 'crypto_status',
      kind: 'read',
      description:
        'État du module crypto (onglet 09 · CRY), comme `chart_status` d’OpenMarket : onglet ouvert ou non (`tabOpen`), marché et unité de temps du chart (minutes), voyant de chaque venue (off, connecting, live, reconnecting, stale, blocked), indicateurs posés (`id`, `indicator`, visible, paramètres) et tracés de tous les marchés (`id`, marché, niveau ou zone dans la devise de cotation, label, auteur), dernier refus du flux du chart (`chartError`). Lecture seule : rien ne s’ouvre.' +
        OFF_FR,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: () => read(ports, (port) => statusRead(port, clock(ports))),
    },
    {
      name: 'crypto_chart_read',
      kind: 'read',
      description:
        'Lit le chart crypto que le trader a ouvert, comme `chart_read` d’OpenMarket. N’ouvre aucun flux : onglet fermé, `available: false` et `tab_closed` ; aucune bougie, `no_bars`. Sur les 160 dernières bougies, la fenêtre que le chart montre à l’ouverture (`visibleBars`, `from`, `to`) : dernier prix, plus haut, plus bas, variation en % de la première ouverture à la dernière clôture (`changePct`), prix à la précision du marché. `indicators` : dernière valeur de chaque ligne affichée (`id` = `<indicateur>:<ligne>`). `cvd` : `source` (`history` : Binance, volume acheteur dans chaque bougie, historique compris ; `live_trades` : Coinbase et Bybit, depuis les trades reçus à partir de `anchoredAt`) et `binanceProxy`, la série Binance du CVD Binance. `bars` (0 à 300) : les n dernières bougies, `{ t (ouverture, secondes UTC), o, h, l, c, v, buy (volume acheteur, s’il est connu), valeur de chaque ligne }`.' +
        OFF_FR,
      parameters: {
        type: 'object',
        properties: { bars: { type: 'integer', minimum: 0, maximum: BARS_MAX, description: 'Nombre de dernières bougies rendues en lignes (0 à 300, défaut 0)' } },
        additionalProperties: false,
      },
      run: (args) => read(ports, (port) => chartRead(port, args)),
    },
    {
      name: 'crypto_watchlist_get',
      kind: 'read',
      description:
        'Marchés crypto suivis par le trader, comme `watchlist_get` d’OpenMarket : pour chacun, la venue et son voyant, le dernier prix reçu (précision du marché), la variation sur 24 h en %, l’heure du prix et son âge (`ageMs`). `registry` : les quatre marchés du registre, les seuls que les outils crypto acceptent. Lecture seule : rien ne s’abonne.' +
        OFF_FR,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: () => read(ports, (port) => watchlistRead(port, clock(ports))),
    },
    {
      name: 'crypto_temperature',
      kind: 'read',
      description:
        'Température du marché crypto lue chez Binance (OpenMarket n’a pas d’équivalent) : funding médian des perps USDT et funding de BTC en % par intervalle de financement, largeur du spot (part des paires USDT en hausse sur 24 h, en %), liquidations longues et courtes de l’heure glissante en dollars US, variation de l’open interest de BTC et d’ETH sur 24 h en %. Chaque relevé porte son heure (`at`) et `stale` au-delà de deux cadences. Les liquidations sont un minorant (Binance ne pousse qu’une liquidation par symbole et par seconde) et leur fenêtre repart de zéro à chaque lancement du desk. Unités du `level` d’une alerte de température. Sans relevé : `available: false`, `no_reading`.' +
        OFF_FR,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: () => read(ports, (port) => temperatureRead(port, clock(ports))),
    },
    {
      name: 'crypto_alert_list',
      kind: 'read',
      description:
        'Alertes crypto, comme `alert_list` d’OpenMarket : cible (marché ou `temperature`), genre, niveau dans son unité, mode (`once`, `rearm`), auteur (`trader`, `agent`), état (`armed`, `triggered`, `paused`), dates. Une alerte armée qui n’est pas évaluée en ce moment porte `evaluable: false` et `reason`, la règle « non évaluée » de l’onglet : `venue` (venue pas en direct, ou Binance bloquée ou périmée pour la température), `no_price`, `no_temperature`, `no_reading`, `stale_reading`. Lecture seule.' +
        OFF_FR,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: () => read(ports, (port) => alertListRead(port, clock(ports))),
    },
    {
      name: 'crypto_chart_set',
      kind: 'write',
      description:
        'Change le marché et/ou l’unité de temps du chart crypto, comme `chart_symbol` et `chart_interval` d’OpenMarket. `market` : l’un des quatre marchés du registre ; `timeframe` : 1, 5, 15, 60, 240 ou 1440 minutes ; au moins l’un des deux (`nothing_to_change`). Onglet ouvert, le chart recharge ses bougies. Rend ce qui a changé.' +
        CONFIRM_FR +
        OFF_FR,
      parameters: {
        type: 'object',
        properties: { market: MARKET, timeframe: { type: 'integer', enum: [...CRYPTO_TIMEFRAMES], minimum: 1, maximum: 1440, description: 'Unité de temps du chart, en minutes' } },
        additionalProperties: false,
      },
      run: (args) =>
        write(
          ports,
          chartPlan(args),
          (port, plan) => port.setChart(plan),
          (plan) => ({ changed: plan }),
        ),
    },
    {
      name: 'crypto_indicator_set',
      kind: 'write',
      description:
        'Ajoute ou retire un indicateur du chart crypto, comme `chart_indicator_add` et `chart_indicator_remove` d’OpenMarket. `add` : `indicator` du catalogue crypto (ema, sma, volume-ma, atr, vwap-utc, levels-utc, cvd, cvd-binance) et `params` facultatifs dans les bornes de l’indicateur ; rend l’`id` créé. `remove` : `id` d’un indicateur posé (lu par crypto_status).' +
        CONFIRM_FR +
        OFF_FR,
      parameters: {
        type: 'object',
        properties: {
          action: ADD_REMOVE,
          indicator: { type: 'string', enum: CRYPTO_INDICATORS.map((def) => def.id), description: 'Indicateur à ajouter' },
          params: { type: 'object', description: 'Paramètres de l’indicateur ajouté (période, bandes…), dans ses bornes', additionalProperties: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
          id: ID('Indicateur à retirer'),
        },
        additionalProperties: false,
      },
      run: (args) =>
        write(
          ports,
          indicatorPlan(args),
          (port, plan) => port.setIndicator(plan),
          (plan, id) => (plan.action === 'add' ? { added: { id, indicator: plan.indicator, ...(plan.params ? { params: plan.params } : {}) } } : { removed: plan.id }),
        ),
    },
    {
      name: 'crypto_drawing_set',
      kind: 'write',
      description:
        `Pose ou retire un tracé sur le chart crypto, comme \`chart_drawing_add\` et \`chart_drawing_remove\` d’OpenMarket. \`add\` : \`market\`, \`kind\` \`level\` (un \`price\`) ou \`zone\` (\`from\` < \`to\`), dans la devise de cotation du marché, \`label\` de ${LABEL_MAX} caractères au plus ; le tracé est marqué AGENT ; rend l’\`id\` créé. \`remove\` : \`id\` d’un tracé (lu par crypto_status).` +
        CONFIRM_FR +
        OFF_FR,
      parameters: {
        type: 'object',
        properties: {
          action: ADD_REMOVE,
          kind: { type: 'string', enum: ['level', 'zone'] },
          market: MARKET,
          price: PRICE('Prix du niveau'),
          from: PRICE('Borne basse de la zone'),
          to: PRICE('Borne haute de la zone'),
          label: { type: 'string', maxLength: LABEL_MAX, description: `Libellé du tracé, ${LABEL_MAX} caractères au plus` },
          id: ID('Tracé à retirer'),
        },
        additionalProperties: false,
      },
      run: (args) =>
        write(
          ports,
          drawingPlan(args),
          (port, plan) => port.setDrawing(plan),
          (plan, id) => {
            if (plan.action === 'remove') return { removed: plan.id };
            const shape = plan.kind === 'level' ? { price: plan.price } : { from: plan.from, to: plan.to };
            return { added: { id, market: plan.market, kind: plan.kind, ...shape, ...(plan.label !== undefined ? { label: plan.label } : {}) } };
          },
        ),
    },
    {
      name: 'crypto_alert_set',
      kind: 'write',
      description:
        'Pose ou supprime une alerte crypto, comme `alert_create` et `alert_delete` d’OpenMarket. `create` : `kind` (price_above, price_below sur un marché de la watchlist ; funding_median_above, funding_median_below, liquidations_long_1h_above, liquidations_short_1h_above, breadth_above, breadth_below sur `temperature`), `level` dans l’unité de crypto_temperature (prix dans la devise de cotation, funding en %, liquidations en dollars US, largeur en %), `mode` `once` ou `rearm` ; l’alerte porte l’auteur agent ; rend l’`id` créé. `delete` : `id` d’une alerte (lu par crypto_alert_list).' +
        CONFIRM_FR +
        OFF_FR,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'delete'] },
          target: { type: 'string', enum: [...CHARTABLE_MARKETS, 'temperature'], description: 'Marché du registre (alerte de prix) ou temperature' },
          kind: { type: 'string', enum: [...CRYPTO_ALERT_KINDS] },
          level: { type: 'number', description: 'Niveau dans l’unité du genre' },
          mode: { type: 'string', enum: ['once', 'rearm'] },
          id: ID('Alerte à supprimer'),
        },
        additionalProperties: false,
      },
      run: (args) =>
        write(
          ports,
          alertPlan(args),
          (port, plan) => port.setAlert(plan),
          (plan, id) => (plan.action === 'create' ? { created: { id, target: plan.target, kind: plan.kind, level: plan.level, mode: plan.mode } } : { deleted: plan.id }),
        ),
    },
    {
      name: 'crypto_watchlist_set',
      kind: 'write',
      description:
        'Ajoute ou retire un marché de la watchlist crypto, comme `watchlist_add_symbols` et `watchlist_remove_symbols` d’OpenMarket. `market` : l’un des quatre marchés du registre. Un marché qui porte une alerte ne se retire pas (`market_has_alerts`).' +
        CONFIRM_FR +
        OFF_FR,
      parameters: { type: 'object', properties: { action: ADD_REMOVE, market: MARKET }, additionalProperties: false },
      run: (args) =>
        write(
          ports,
          watchPlan(args),
          (port, plan) => port.setWatchlist(plan),
          (plan) => (plan.action === 'add' ? { added: plan.market } : { removed: plan.market }),
        ),
    },
  ];
}

/** Description d'un outil crypto dans la langue active (la définition porte le français) ; `null` pour un autre outil. */
export function cryptoToolBlurb(name: string, fallback: string): string | null {
  switch (name) {
    case 'crypto_status':
      return tr(
        fallback,
        'Crypto module status (tab 09 · CRY), like OpenMarket’s `chart_status`: tab open or not (`tabOpen`), chart market and timeframe (minutes), state of each venue (off, connecting, live, reconnecting, stale, blocked), indicators set (`id`, `indicator`, visible, parameters) and drawings on every market (`id`, market, level or zone in the quote currency, label, author), last refusal of the chart feed (`chartError`). Read only: nothing opens.' +
          OFF_EN,
        'Estado del módulo cripto (pestaña 09 · CRY), como `chart_status` de OpenMarket: pestaña abierta o no (`tabOpen`), mercado y marco temporal del gráfico (minutos), estado de cada venue (off, connecting, live, reconnecting, stale, blocked), indicadores puestos (`id`, `indicator`, visible, parámetros) y trazados de todos los mercados (`id`, mercado, nivel o zona en la divisa de cotización, etiqueta, autor), último rechazo del flujo del gráfico (`chartError`). Solo lectura: nada se abre.' +
          OFF_ES,
      );
    case 'crypto_chart_read':
      return tr(
        fallback,
        'Reads the crypto chart the trader has open, like OpenMarket’s `chart_read`. Opens no feed: tab closed, `available: false` and `tab_closed`; no bar, `no_bars`. Over the last 160 bars, the window the chart shows when it opens (`visibleBars`, `from`, `to`): last price, high, low, change in % from the first open to the last close (`changePct`), prices at the market’s precision. `indicators`: last value of each line shown (`id` = `<indicator>:<line>`). `cvd`: `source` (`history`: Binance, buy volume in every bar, history included; `live_trades`: Coinbase and Bybit, from the trades received since `anchoredAt`) and `binanceProxy`, the Binance series of the Binance CVD. `bars` (0 to 300): the last n bars, `{ t (open, UTC seconds), o, h, l, c, v, buy (buy volume, when known), value of each line }`.' +
          OFF_EN,
        'Lee el gráfico cripto que el trader tiene abierto, como `chart_read` de OpenMarket. No abre ningún flujo: pestaña cerrada, `available: false` y `tab_closed`; sin velas, `no_bars`. Sobre las 160 últimas velas, la ventana que el gráfico muestra al abrirse (`visibleBars`, `from`, `to`): último precio, máximo, mínimo, variación en % de la primera apertura al último cierre (`changePct`), precios a la precisión del mercado. `indicators`: último valor de cada línea mostrada (`id` = `<indicador>:<línea>`). `cvd`: `source` (`history`: Binance, volumen comprador en cada vela, historial incluido; `live_trades`: Coinbase y Bybit, desde los trades recibidos a partir de `anchoredAt`) y `binanceProxy`, la serie Binance del CVD Binance. `bars` (0 a 300): las n últimas velas, `{ t (apertura, segundos UTC), o, h, l, c, v, buy (volumen comprador, si se conoce), valor de cada línea }`.' +
          OFF_ES,
      );
    case 'crypto_watchlist_get':
      return tr(
        fallback,
        'Crypto markets the trader watches, like OpenMarket’s `watchlist_get`: for each, the venue and its state, the last price received (market precision), the 24 h change in %, the time of the price and its age (`ageMs`). `registry`: the four markets of the registry, the only ones the crypto tools accept. Read only: nothing subscribes.' +
          OFF_EN,
        'Mercados cripto que sigue el trader, como `watchlist_get` de OpenMarket: para cada uno, el venue y su estado, el último precio recibido (precisión del mercado), la variación en 24 h en %, la hora del precio y su antigüedad (`ageMs`). `registry`: los cuatro mercados del registro, los únicos que aceptan las herramientas cripto. Solo lectura: nada se suscribe.' +
          OFF_ES,
      );
    case 'crypto_temperature':
      return tr(
        fallback,
        'Crypto market temperature read from Binance (OpenMarket has no equivalent): median funding of the USDT perps and BTC funding in % per funding interval, spot breadth (share of USDT pairs up over 24 h, in %), long and short liquidations of the rolling hour in US dollars, 24 h change of BTC and ETH open interest in %. Each reading carries its time (`at`) and `stale` beyond two cadences. Liquidations are a lower bound (Binance pushes at most one liquidation per symbol per second) and their window restarts from zero at each desk launch. Units of a temperature alert’s `level`. Without a reading: `available: false`, `no_reading`.' +
          OFF_EN,
        'Temperatura del mercado cripto leída en Binance (OpenMarket no tiene equivalente): funding mediano de los perps USDT y funding de BTC en % por intervalo de financiación, amplitud del spot (parte de los pares USDT al alza en 24 h, en %), liquidaciones largas y cortas de la hora móvil en dólares estadounidenses, variación del open interest de BTC y ETH en 24 h en %. Cada lectura lleva su hora (`at`) y `stale` pasadas dos cadencias. Las liquidaciones son una cota inferior (Binance solo envía una liquidación por símbolo y por segundo) y su ventana vuelve a cero en cada arranque del desk. Unidades del `level` de una alerta de temperatura. Sin lectura: `available: false`, `no_reading`.' +
          OFF_ES,
      );
    case 'crypto_alert_list':
      return tr(
        fallback,
        'Crypto alerts, like OpenMarket’s `alert_list`: target (market or `temperature`), kind, level in its unit, mode (`once`, `rearm`), author (`trader`, `agent`), state (`armed`, `triggered`, `paused`), dates. An armed alert that is not evaluated right now carries `evaluable: false` and `reason`, the tab’s “not evaluated” rule: `venue` (venue not live, or Binance blocked or stale for the temperature), `no_price`, `no_temperature`, `no_reading`, `stale_reading`. Read only.' +
          OFF_EN,
        'Alertas cripto, como `alert_list` de OpenMarket: objetivo (mercado o `temperature`), tipo, nivel en su unidad, modo (`once`, `rearm`), autor (`trader`, `agent`), estado (`armed`, `triggered`, `paused`), fechas. Una alerta armada que no se evalúa en este momento lleva `evaluable: false` y `reason`, la regla «no evaluada» de la pestaña: `venue` (venue no en directo, o Binance bloqueada o caducada para la temperatura), `no_price`, `no_temperature`, `no_reading`, `stale_reading`. Solo lectura.' +
          OFF_ES,
      );
    case 'crypto_chart_set':
      return tr(
        fallback,
        'Changes the market and/or timeframe of the crypto chart, like OpenMarket’s `chart_symbol` and `chart_interval`. `market`: one of the four markets of the registry; `timeframe`: 1, 5, 15, 60, 240 or 1440 minutes; at least one of the two (`nothing_to_change`). With the tab open, the chart reloads its bars. Returns what changed.' +
          CONFIRM_EN +
          OFF_EN,
        'Cambia el mercado y/o el marco temporal del gráfico cripto, como `chart_symbol` y `chart_interval` de OpenMarket. `market`: uno de los cuatro mercados del registro; `timeframe`: 1, 5, 15, 60, 240 o 1440 minutos; al menos uno de los dos (`nothing_to_change`). Con la pestaña abierta, el gráfico recarga sus velas. Devuelve lo que cambió.' +
          CONFIRM_ES +
          OFF_ES,
      );
    case 'crypto_indicator_set':
      return tr(
        fallback,
        'Adds or removes an indicator on the crypto chart, like OpenMarket’s `chart_indicator_add` and `chart_indicator_remove`. `add`: `indicator` from the crypto catalog (ema, sma, volume-ma, atr, vwap-utc, levels-utc, cvd, cvd-binance) and optional `params` within the indicator’s bounds; returns the `id` created. `remove`: `id` of an indicator set (read by crypto_status).' +
          CONFIRM_EN +
          OFF_EN,
        'Añade o quita un indicador del gráfico cripto, como `chart_indicator_add` y `chart_indicator_remove` de OpenMarket. `add`: `indicator` del catálogo cripto (ema, sma, volume-ma, atr, vwap-utc, levels-utc, cvd, cvd-binance) y `params` opcionales dentro de los límites del indicador; devuelve el `id` creado. `remove`: `id` de un indicador puesto (leído por crypto_status).' +
          CONFIRM_ES +
          OFF_ES,
      );
    case 'crypto_drawing_set':
      return tr(
        fallback,
        `Sets or removes a drawing on the crypto chart, like OpenMarket’s \`chart_drawing_add\` and \`chart_drawing_remove\`. \`add\`: \`market\`, \`kind\` \`level\` (one \`price\`) or \`zone\` (\`from\` < \`to\`), in the market’s quote currency, \`label\` of at most ${LABEL_MAX} characters; the drawing is marked AGENT; returns the \`id\` created. \`remove\`: \`id\` of a drawing (read by crypto_status).` +
          CONFIRM_EN +
          OFF_EN,
        `Pone o quita un trazado en el gráfico cripto, como \`chart_drawing_add\` y \`chart_drawing_remove\` de OpenMarket. \`add\`: \`market\`, \`kind\` \`level\` (un \`price\`) o \`zone\` (\`from\` < \`to\`), en la divisa de cotización del mercado, \`label\` de ${LABEL_MAX} caracteres como máximo; el trazado se marca AGENTE; devuelve el \`id\` creado. \`remove\`: \`id\` de un trazado (leído por crypto_status).` +
          CONFIRM_ES +
          OFF_ES,
      );
    case 'crypto_alert_set':
      return tr(
        fallback,
        'Sets or deletes a crypto alert, like OpenMarket’s `alert_create` and `alert_delete`. `create`: `kind` (price_above, price_below on a watched market; funding_median_above, funding_median_below, liquidations_long_1h_above, liquidations_short_1h_above, breadth_above, breadth_below on `temperature`), `level` in crypto_temperature’s unit (price in the quote currency, funding in %, liquidations in US dollars, breadth in %), `mode` `once` or `rearm`; the alert carries the agent as author; returns the `id` created. `delete`: `id` of an alert (read by crypto_alert_list).' +
          CONFIRM_EN +
          OFF_EN,
        'Pone o elimina una alerta cripto, como `alert_create` y `alert_delete` de OpenMarket. `create`: `kind` (price_above, price_below en un mercado de la watchlist; funding_median_above, funding_median_below, liquidations_long_1h_above, liquidations_short_1h_above, breadth_above, breadth_below en `temperature`), `level` en la unidad de crypto_temperature (precio en la divisa de cotización, funding en %, liquidaciones en dólares estadounidenses, amplitud en %), `mode` `once` o `rearm`; la alerta lleva al agente como autor; devuelve el `id` creado. `delete`: `id` de una alerta (leído por crypto_alert_list).' +
          CONFIRM_ES +
          OFF_ES,
      );
    case 'crypto_watchlist_set':
      return tr(
        fallback,
        'Adds or removes a market from the crypto watchlist, like OpenMarket’s `watchlist_add_symbols` and `watchlist_remove_symbols`. `market`: one of the four markets of the registry. A market that carries an alert is not removed (`market_has_alerts`).' +
          CONFIRM_EN +
          OFF_EN,
        'Añade o quita un mercado de la watchlist cripto, como `watchlist_add_symbols` y `watchlist_remove_symbols` de OpenMarket. `market`: uno de los cuatro mercados del registro. Un mercado que lleva una alerta no se quita (`market_has_alerts`).' +
          CONFIRM_ES +
          OFF_ES,
      );
    default:
      return null;
  }
}
