import { create } from 'zustand';
import { ALERTS_MAX, sanitizeAlerts, validateAlert, type CryptoAlert, type CryptoAlertKind } from '@/engine/crypto/alerts';
import { cryptoIndicatorById, DEFAULT_CRYPTO_INDICATORS } from '@/engine/crypto/indicators';
import {
  CHARTABLE_MARKETS,
  DEFAULT_CRYPTO_MARKET,
  DEFAULT_CRYPTO_TIMEFRAME,
  cryptoMarket,
  isChartableMarket,
  isCryptoTimeframe,
  type CryptoBar,
  type CryptoMarketId,
  type CryptoTicker,
  type CryptoTimeframe,
} from '@/engine/crypto/markets';
import { DRAWINGS_MAX, INDICATORS_MAX, LABEL_MAX, sanitizeCryptoChart, sanitizeDrawings, sanitizeWatchlist, type CryptoChartSetting, type CryptoDrawing } from '@/engine/crypto/persist';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import { defaultParams, type IndicatorDefinition, type IndicatorInstance, type IndicatorParam } from '@/engine/indicators';
import { tr } from '@/i18n';
import { desk, type CryptoMainStatus } from '@/lib/desk';
import { uid } from '@/lib/id';
import { startChart, startLight } from './cryptoLive';
import { getSetting, setSetting } from './db';

/** Hors desk, avant la première lecture : aucune venue ouverte. */
const OFF_VENUES: CryptoMainStatus['venues'] = { coinbase: 'off', binance: 'off', bybit: 'off' };

/** Qui écrit : le trader au clavier, ou l'agent par un outil de la couche agentique. */
export type By = 'trader' | 'agent';

/**
 * Le résultat d'une écriture. `ok: true` porte l'`id` de l'entrée créée (indicateur, tracé, alerte). `reason` est l'une des
 * raisons de `CryptoRefusal` : une valeur stable, que l'écran et les outils de l'agent traduisent.
 */
export type WriteResult = { ok: true; id?: string } | { ok: false; reason: string };

/**
 * Les refus d'une écriture. `bad_target`, `bad_kind` et `bad_level` sont les raisons de `validateAlert` ; `bad_kind` sert aussi
 * au genre d'un tracé, et `bad_mode` au mode d'une alerte comme à un acteur ou un auteur hors de `trader | agent`. `not_ready` :
 * les réglages enregistrés n'ont pas pu être lus, rien n'a été écrit.
 */
export type CryptoRefusal =
  | 'not_ready'
  | 'bad_mode'
  | 'unknown_market'
  | 'bad_timeframe'
  | 'unknown_indicator'
  | 'bad_params'
  | 'indicators_full'
  | 'bad_price'
  | 'bad_label'
  | 'label_too_long'
  | 'drawings_full'
  | 'unknown_drawing'
  | 'not_in_watchlist'
  | 'alerts_full'
  | 'unknown_alert'
  | 'market_has_alerts'
  | 'bad_target'
  | 'bad_kind'
  | 'bad_level';

/** Une ligne du journal de l'agent : `tool` est le nom de l'outil CRY6.1 de l'écriture, `effect` son résumé dans la langue active. */
export interface AgentLogLine {
  /** Millisecondes. */
  at: number;
  tool: string;
  effect: string;
}

export interface CryptoState {
  /** Vrai une fois la lecture de l'interrupteur et des réglages terminée : lus, illisibles, ou constatés absents hors du desk. */
  ready: boolean;
  /**
   * Vrai une fois les quatre lignes de réglages lues sans erreur (par `load()` ou par la première écriture) ; une lecture
   * réussie n'est pas refaite, sauf par `reloadSettings()`. Faux tant que la base ne se lit pas, même quand `ready` est vrai :
   * toute écriture relit alors d'abord, et refuse (`not_ready`) si la lecture échoue encore.
   */
  settingsRead: boolean;
  /** L'interrupteur appartient au process principal : le renderer le lit, il ne l'écrit pas. */
  enabled: boolean;
  venues: CryptoMainStatus['venues'];

  /** Le chart : marché, timeframe (minutes) et indicateurs, réglages enregistrés dans `crypto.chart`. */
  market: CryptoMarketId;
  timeframe: CryptoTimeframe;
  indicators: IndicatorInstance[];
  /** Réglages enregistrés dans `crypto.watchlist`, `crypto.alerts` et `crypto.drawings`. */
  watchlist: CryptoMarketId[];
  alerts: CryptoAlert[];
  drawings: CryptoDrawing[];

  /**
   * Données vivantes, jamais enregistrées, remplies par les flux (`./cryptoLive`). Les bougies sont en secondes UTC. `bars` et
   * `proxyBars` (la série Binance du CVD Binance) suivent le chart ouvert, interrupteur allumé, et se vident à tout changement de
   * marché ou de timeframe et à l'arrêt du flux ; `cvdAnchoredAt` est `cvdAnchor(bars)`. `tickers` (watchlist) et `temperature`
   * suivent l'interrupteur et se vident à l'extinction.
   */
  bars: CryptoBar[];
  proxyBars: CryptoBar[];
  cvdAnchoredAt: number | null;
  tickers: Partial<Record<CryptoMarketId, CryptoTicker>>;
  temperature: TemperatureReading | null;
  /**
   * Le dernier refus du flux du chart (abonnement ou historique), de celui du CVD Binance, et de l'abonnement ticker de chaque
   * marché : le code du process principal tel quel (`crypto_disabled`, `blocked`, `rate_limited`, `no_history`,
   * `unknown_stream`, `invalid_request`), que l'écran traduit. Effacés avec les données de leur flux.
   */
  chartError: string | null;
  proxyError: string | null;
  tickerErrors: Partial<Record<CryptoMarketId, string>>;
  /** Le chart est à l'écran : posé par `openChart` et `closeChart`. */
  chartOpen: boolean;
  /** Les écritures de l'agent, la plus récente d'abord, `AGENT_LOG_MAX` au plus. Jamais enregistré. */
  agentLog: AgentLogLine[];

  /**
   * Lit l'interrupteur auprès du process principal (à chaque appel) et les quatre lignes de réglages dans la base du renderer
   * (avec ou sans `desk.crypto`) : la lecture des réglages est l'étape que partagent toutes les écritures, faite une seule
   * fois tant qu'elle réussit. Ne rejette jamais, même si la base ne se lit pas (l'état connu reste, `settingsRead` reste faux).
   * À attendre avant d'ouvrir un flux : `ready` ne passe à vrai qu'ensuite. Les écritures n'ont pas besoin de l'attendre.
   */
  load: () => Promise<void>;
  /**
   * Relit les quatre lignes de réglages même si elles ont déjà été lues : à appeler quand la base a changé sous le store (la
   * restauration d'un coffre, `restoreVault`), sans quoi la prochaine écriture poserait l'état d'avant par-dessus les lignes
   * restaurées. Efface le mémo de `settingsRead` puis passe par la même étape de lecture que `load()` (mêmes assainisseurs, même
   * réparation de la watchlist) et applique les lignes à l'état. Les écritures lancées pendant la relecture l'attendent ; une
   * lecture déjà en vol, qui peut dater d'avant, n'est pas appliquée : ceux qui l'attendaient reçoivent la relecture. Si la base
   * ne se lit pas, le mémo reste effacé : l'écriture suivante relit, et refuse `not_ready` en attendant. Ne rejette jamais,
   * n'écrit jamais.
   */
  reloadSettings: () => Promise<void>;
  /** Demande l'allumage : le process principal ouvre son dialogue et rend le statut, allumé ou non. */
  requestEnable: () => Promise<void>;
  disable: () => Promise<void>;

  /**
   * Le chart entre à l'écran (montage de l'onglet) : tant que l'interrupteur est allumé et le store prêt, le flux lourd suit son
   * marché, son timeframe et le CVD Binance. L'agent ne l'appelle pas : il lit ce que le trader a ouvert.
   */
  openChart: () => void;
  /** Le chart quitte l'écran : le flux lourd est lâché, ses bougies vidées. Le flux léger continue. */
  closeChart: () => void;

  /**
   * Les écritures. Chacune s'assure d'abord que les réglages enregistrés sont lus (la même étape que `load()`, partagée par les
   * appels concurrents, jamais refaite une fois réussie), même si l'onglet n'a jamais été ouvert : sans quoi elle partirait
   * des défauts et écraserait les lignes. Si la base ne se lit pas, les écritures qui rendent un résultat refusent `not_ready`,
   * les autres ne font rien, et rien n'est écrit. Puis elle valide, change l'état tout de suite (avant le premier `await` une
   * fois les réglages lus : deux appels qui se suivent se composent), et enregistre la valeur assainie par `setSetting`. Une
   * entrée refusée ne change rien et n'écrit rien. Si la base refuse l'écriture, l'état est déjà changé et la promesse
   * rejette, comme celle des indicateurs de Visual (`src/store/bars.ts`) : l'appelant l'attrape.
   * `by` vaut `'trader'` par défaut ; `'agent'` marque les alertes et les tracés créés et inscrit une ligne dans `agentLog`
   * (écritures réussies seulement). Tout autre acteur est refusé (`bad_mode`).
   */
  setMarket: (id: string, by?: By) => Promise<WriteResult>;
  setTimeframe: (tf: number, by?: By) => Promise<WriteResult>;
  addIndicator: (definitionId: string, params?: Record<string, number | string>, by?: By) => Promise<WriteResult>;
  /** Un patch invalide (clé inconnue du catalogue, valeur hors des bornes ou des options) ou un id inconnu ne change rien. */
  updateIndicator: (id: string, patch: Record<string, number | string>) => Promise<void>;
  toggleIndicator: (id: string) => Promise<void>;
  removeIndicator: (id: string, by?: By) => Promise<WriteResult>;
  addDrawing: (d: Omit<CryptoDrawing, 'id' | 'createdAt' | 'author'>, by?: By) => Promise<WriteResult>;
  removeDrawing: (id: string, by?: By) => Promise<WriteResult>;
  createAlert: (a: Omit<CryptoAlert, 'id' | 'state' | 'createdAt' | 'author'>, by?: By) => Promise<WriteResult>;
  deleteAlert: (id: string, by?: By) => Promise<WriteResult>;
  /**
   * Pose l'état d'une alerte. `at` (millisecondes) est l'instant du franchissement et devient `lastTriggeredAt` ; sans `at`,
   * un passage à `triggered` prend l'horloge, les autres états gardent la dernière date. Un état inconnu, une date non
   * finie ou un id inconnu ne changent rien.
   */
  setAlertState: (id: string, state: CryptoAlert['state'], at?: number) => Promise<void>;
  /** Déjà présent : rien ne change. */
  addToWatchlist: (id: string, by?: By) => Promise<WriteResult>;
  /** Refuse un marché absent (`not_in_watchlist`) et un marché qui porte une alerte (`market_has_alerts`). */
  removeFromWatchlist: (id: string, by?: By) => Promise<WriteResult>;
}

/** Les quatre lignes de la table `settings`. Ces clés-là, et pas une autre : la restauration d'un coffre écarte les lignes qu'elle ne connaît pas. */
const KEY = { chart: 'crypto.chart', watchlist: 'crypto.watchlist', alerts: 'crypto.alerts', drawings: 'crypto.drawings' } as const;
type SettingKey = (typeof KEY)[keyof typeof KEY];

/** Les outils CRY6.1 dont chaque écriture est le geste : le nom que le journal de l'agent porte. */
const TOOL = {
  chart: 'crypto_chart_set',
  indicator: 'crypto_indicator_set',
  drawing: 'crypto_drawing_set',
  alert: 'crypto_alert_set',
  watchlist: 'crypto_watchlist_set',
} as const;

export const AGENT_LOG_MAX = 20;

/** Une copie neuve des indicateurs par défaut : `DEFAULT_CRYPTO_INDICATORS` est partagé, il n'est jamais mis en état ni muté. */
const defaultIndicators = (): IndicatorInstance[] => DEFAULT_CRYPTO_INDICATORS.map((indicator) => ({ ...indicator, params: { ...indicator.params } }));
const defaultChart = (): CryptoChartSetting => ({ market: DEFAULT_CRYPTO_MARKET, timeframe: DEFAULT_CRYPTO_TIMEFRAME, indicators: defaultIndicators() });
const defaultWatchlist = (): CryptoMarketId[] => [...CHARTABLE_MARKETS];

const refuse = (reason: CryptoRefusal): WriteResult => ({ ok: false, reason });
const readBy = (by: unknown): By | null => (by === 'trader' || by === 'agent' ? by : null);
/** Vrai si l'objet porte un `author` qui n'est ni `trader` ni `agent` : l'auteur vient de `by`, un autre est refusé, jamais ignoré. */
const claimsBadAuthor = (input: object): boolean => {
  const author = (input as { author?: unknown }).author;
  return author !== undefined && readBy(author) === null;
};
/** Un prix de marché : fini et strictement positif. */
const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const marketLabel = (id: string): string => cryptoMarket(id)?.label ?? id;

/** Un id neuf, absent de la liste : l'assainisseur écarterait un doublon. Quelques essais, la collision étant de l'ordre de 2^-40. */
function freshId(prefix: string, taken: readonly { id: string }[]): string {
  let id = uid(prefix);
  for (let tries = 0; tries < 5 && taken.some((entry) => entry.id === id); tries++) id = uid(prefix);
  return id;
}

/**
 * Un nombre est sur la grille d'un paramètre quand `(valeur - min) / pas` est entier, `min` valant 0 s'il manque. Un pas
 * absent, nul, négatif ou non fini n'est pas une grille. L'écart toléré (relatif au nombre de pas) absorbe le bruit des
 * flottants : 0,3 / 0,1 vaut 2,9999999999999996.
 */
function onStepGrid(value: number, spec: IndicatorParam): boolean {
  const { step } = spec;
  if (step === undefined || !Number.isFinite(step) || step <= 0) return true;
  const steps = (value - (spec.min ?? 0)) / step;
  return Math.abs(steps - Math.round(steps)) <= 1e-12 * Math.max(1, Math.abs(steps));
}

/**
 * Les paramètres d'un indicateur du catalogue, ou `null`. Seules les clés de la définition passent (jamais `__proto__` ou
 * `constructor`), un nombre doit être fini, dans les bornes de la définition et sur son pas (une période de 20,5 donnerait
 * à `sma` et `ema` une série fausse mais finie), un choix doit être l'une de ses options : ce que la ligne `crypto.chart`
 * garde au rechargement, et plus strict sur le pas.
 */
export function readParams(def: IndicatorDefinition, patch: unknown): Record<string, number | string> | null {
  if (!isRec(patch)) return null;
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(patch)) {
    const spec = def.params.find((p) => p.key === key);
    if (!spec) return null;
    if (spec.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) return null;
      if (!onStepGrid(value, spec)) return null;
    } else if (typeof value !== 'string' || !spec.options?.some((option) => option.value === value)) {
      return null;
    }
    out[key] = value;
  }
  return out;
}

/** La watchlist, plus les marchés des alertes de prix qu'elle ne porte pas : une alerte ne vise jamais un marché qu'on ne suit pas. */
function withAlertMarkets(watchlist: readonly CryptoMarketId[], alerts: readonly CryptoAlert[]): CryptoMarketId[] {
  const out = [...watchlist];
  for (const alert of alerts) if (isChartableMarket(alert.target) && !out.includes(alert.target)) out.push(alert.target);
  return out;
}

/** Le genre d'une alerte en quelques mots, dans la langue active, pour le journal de l'agent. */
function kindText(kind: CryptoAlertKind): string {
  switch (kind) {
    case 'price_above':
      return tr('prix au-dessus de', 'price above', 'precio por encima de');
    case 'price_below':
      return tr('prix en dessous de', 'price below', 'precio por debajo de');
    case 'funding_median_above':
      return tr('funding médian au-dessus de', 'median funding above', 'funding mediano por encima de');
    case 'funding_median_below':
      return tr('funding médian en dessous de', 'median funding below', 'funding mediano por debajo de');
    case 'liquidations_long_1h_above':
      return tr('liquidations longues 1 h au-dessus de', 'long liquidations 1 h above', 'liquidaciones largas 1 h por encima de');
    case 'liquidations_short_1h_above':
      return tr('liquidations courtes 1 h au-dessus de', 'short liquidations 1 h above', 'liquidaciones cortas 1 h por encima de');
    case 'breadth_above':
      return tr('largeur du spot au-dessus de', 'spot breadth above', 'amplitud del spot por encima de');
    case 'breadth_below':
      return tr('largeur du spot en dessous de', 'spot breadth below', 'amplitud del spot por debajo de');
  }
}

const alertText = (alert: Pick<CryptoAlert, 'target' | 'kind' | 'level'>): string =>
  `${kindText(alert.kind)} ${alert.level} · ${alert.target === 'temperature' ? tr('température', 'temperature', 'temperatura') : marketLabel(alert.target)}`;

// --- Lecture des réglages ---------------------------------------------------------------------------------------------

/**
 * Une ligne lue et assainie. `read` est faux quand la base a refusé la lecture ; `value` est `undefined` quand la ligne est
 * absente ou invalide (ses défauts s'appliquent).
 */
type Row<T> = { read: true; value: T | undefined } | { read: false };

async function readRow<T>(key: SettingKey, sanitize: (v: unknown) => T | undefined): Promise<Row<T>> {
  try {
    return { read: true, value: sanitize(await getSetting<unknown>(key, undefined)) };
  } catch {
    return { read: false };
  }
}

/** La lecture des quatre lignes en cours, partagée par tous ceux qui l'attendent ; `null` hors d'une lecture (et donc après un échec). */
let settingsPending: Promise<boolean> | null = null;
/** Le rang de la lecture voulue : `reloadSettings` l'incrémente, ce qui rend caduque la lecture alors en vol (elle a pu lire avant le changement de la base). */
let settingsEpoch = 0;

let unsubscribeStatus: (() => void) | null = null;

export const useCrypto = create<CryptoState>((set, get) => {
  const apply = (status: CryptoMainStatus) => set({ enabled: status.enabled, venues: status.venues });

  /**
   * Lit les quatre lignes et les met dans l'état. Une ligne absente ou invalide donne ses défauts ; une ligne qui ne se lit
   * pas garde l'état connu. Rend vrai si les quatre se sont lues (et pose alors `settingsRead`). N'écrit jamais ; ne rejette
   * pas. Aucune écriture ne peut passer pendant la lecture : elles attendent toutes cette étape (`readSettings`).
   */
  async function loadSettings(): Promise<boolean> {
    const epoch = settingsEpoch;
    const [chart, watchlist, alerts, drawings] = await Promise.all([
      readRow(KEY.chart, sanitizeCryptoChart),
      readRow(KEY.watchlist, sanitizeWatchlist),
      readRow(KEY.alerts, sanitizeAlerts),
      readRow(KEY.drawings, sanitizeDrawings),
    ]);
    // Une relecture a été demandée pendant celle-ci (`reloadSettings`) : ce qui vient d'être lu peut dater d'avant le changement de
    // la base, rien n'en est appliqué. Ceux qui attendent cette lecture reçoivent le résultat de la relecture.
    if (epoch !== settingsEpoch) return settingsPending ?? get().settingsRead;
    const complete = chart.read && watchlist.read && alerts.read && drawings.read;
    set((cur) => {
      const chartNext: CryptoChartSetting = chart.read ? (chart.value ?? defaultChart()) : { market: cur.market, timeframe: cur.timeframe, indicators: cur.indicators };
      const alertsNext = alerts.read ? (alerts.value ?? []) : cur.alerts;
      const watchlistNext = watchlist.read ? (watchlist.value ?? defaultWatchlist()) : cur.watchlist;
      const drawingsNext = drawings.read ? (drawings.value ?? []) : cur.drawings;
      // Après la restauration d'un coffre, une alerte peut viser un marché que la watchlist n'a plus : la watchlist reprend ce
      // marché en mémoire (jamais l'alerte supprimée, jamais d'écriture ici).
      return { ...chartNext, alerts: alertsNext, drawings: drawingsNext, watchlist: withAlertMarkets(watchlistNext, alertsNext), settingsRead: complete };
    });
    return complete;
  }

  /**
   * L'étape de lecture des réglages, la même pour `load()`, pour `reloadSettings()` et pour toutes les écritures. Idempotente : une
   * fois les quatre lignes lues elle ne relit plus (jusqu'à `reloadSettings`, qui efface ce mémo) ; les appels concurrents partagent
   * la même lecture ; après un échec, rien n'est gardé et l'appel suivant relit. Rend faux si la base ne se lit pas ; ne rejette pas.
   *
   * Une écriture l'attend ainsi : `if (!get().settingsRead && !(await readSettings())) return …`. Le test de `settingsRead`
   * évite l'`await` quand les réglages sont déjà lus, pour que l'état change dans le tour de l'appel, comme avant. Les appels
   * en attente reprennent dans l'ordre où ils sont arrivés, chacun lisant l'état laissé par le précédent : ils se composent.
   */
  function readSettings(): Promise<boolean> {
    if (get().settingsRead) return Promise.resolve(true);
    if (!settingsPending) {
      const read: Promise<boolean> = loadSettings().finally(() => {
        // Une lecture rendue caduque ne libère pas la relecture qui l'a remplacée.
        if (settingsPending === read) settingsPending = null;
      });
      settingsPending = read;
    }
    return settingsPending;
  }

  /** La ligne du journal d'une écriture réussie de l'agent, la plus récente d'abord ; rien pour le trader. */
  const logged = (by: By, tool: string, effect: () => string): Partial<CryptoState> =>
    by === 'agent' ? { agentLog: [{ at: Date.now(), tool, effect: effect() }, ...get().agentLog].slice(0, AGENT_LOG_MAX) } : {};

  /** Les bougies d'un autre marché ou d'une autre unité de temps ne restent pas sous le nouveau choix : le flux les remplit (CRY3.4). */
  const clearedBars = (): Partial<CryptoState> => ({ bars: [], proxyBars: [], cvdAnchoredAt: null });

  // Chaque `save…` change l'état d'un coup avec `extra` (le journal, les bougies vidées), puis enregistre la valeur assainie :
  // l'état et la ligne sont la même valeur, celle que l'assainisseur rendrait au rechargement. `setSetting` est appelé tout de
  // suite, dans l'ordre des écritures : les lignes arrivent à la base dans l'ordre où l'état a changé, et la dernière porte
  // l'état de la dernière. La promesse rendue est celle de la base (elle rejette si la base refuse).
  const saveChart = (patch: Partial<Pick<CryptoState, 'market' | 'timeframe' | 'indicators'>>, extra: Partial<CryptoState> = {}): Promise<void> => {
    const cur = get();
    const next = { market: patch.market ?? cur.market, timeframe: patch.timeframe ?? cur.timeframe, indicators: patch.indicators ?? cur.indicators };
    // Le marché et l'unité de temps sont déjà validés : l'assainisseur ne rend `undefined` que pour un état posé de l'extérieur.
    const chart = sanitizeCryptoChart(next) ?? next;
    set({ ...extra, ...chart });
    return setSetting(KEY.chart, chart);
  };
  const saveWatchlist = (watchlist: CryptoMarketId[], extra: Partial<CryptoState> = {}): Promise<void> => {
    const clean = sanitizeWatchlist(watchlist) ?? watchlist;
    set({ ...extra, watchlist: clean });
    return setSetting(KEY.watchlist, clean);
  };
  const saveAlerts = (alerts: CryptoAlert[], extra: Partial<CryptoState> = {}): Promise<void> => {
    const clean = sanitizeAlerts(alerts) ?? alerts;
    set({ ...extra, alerts: clean });
    return setSetting(KEY.alerts, clean);
  };
  const saveDrawings = (drawings: CryptoDrawing[], extra: Partial<CryptoState> = {}): Promise<void> => {
    const clean = sanitizeDrawings(drawings) ?? drawings;
    set({ ...extra, drawings: clean });
    return setSetting(KEY.drawings, clean);
  };

  return {
    ready: false,
    settingsRead: false,
    enabled: false,
    venues: OFF_VENUES,

    ...defaultChart(),
    watchlist: defaultWatchlist(),
    alerts: [],
    drawings: [],

    bars: [],
    proxyBars: [],
    cvdAnchoredAt: null,
    tickers: {},
    temperature: null,
    chartError: null,
    proxyError: null,
    tickerErrors: {},
    chartOpen: false,
    agentLog: [],

    async load() {
      // Lancée avant la lecture du statut : les deux se font en même temps, et le statut est demandé dans le même tour qu'avant.
      const settings = readSettings();
      const api = desk?.crypto;
      if (api) {
        try {
          // Abonné avant la lecture : un changement poussé entre les deux ne se perd pas.
          if (!unsubscribeStatus) unsubscribeStatus = api.onStatus(apply);
          apply(await api.status());
        } catch {
          // Process principal illisible : l'état connu reste (éteint à la première lecture), l'écran se montre quand même.
        }
      }
      await settings;
      set(api ? { ready: true } : { ready: true, enabled: false, venues: OFF_VENUES });
    },

    async reloadSettings() {
      // Le mémo est effacé : les écritures qui arrivent maintenant attendent la relecture (leur garde `settingsRead`). La lecture en vol,
      // s'il y en a une, est écartée : `loadSettings` voit que le rang a changé et n'applique rien.
      settingsEpoch++;
      settingsPending = null;
      set({ settingsRead: false });
      await readSettings();
    },

    async requestEnable() {
      const status = await desk?.crypto?.enable();
      if (status) apply(status);
    },

    async disable() {
      const status = await desk?.crypto?.disable();
      if (status) apply(status);
    },

    openChart() {
      set({ chartOpen: true });
    },

    closeChart() {
      set({ chartOpen: false });
    },

    async setMarket(id, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      if (!isChartableMarket(id)) return refuse('unknown_market');
      const changed = id !== get().market;
      await saveChart(
        { market: id },
        {
          ...(changed ? clearedBars() : {}),
          ...logged(actor, TOOL.chart, () => tr(`Marché du chart : ${marketLabel(id)}`, `Chart market: ${marketLabel(id)}`, `Mercado del gráfico: ${marketLabel(id)}`)),
        },
      );
      return { ok: true };
    },

    async setTimeframe(tf, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      if (!isCryptoTimeframe(tf)) return refuse('bad_timeframe');
      const changed = tf !== get().timeframe;
      await saveChart(
        { timeframe: tf },
        {
          ...(changed ? clearedBars() : {}),
          ...logged(actor, TOOL.chart, () => tr(`Unité de temps du chart : ${tf} min`, `Chart timeframe: ${tf} min`, `Marco temporal del gráfico: ${tf} min`)),
        },
      );
      return { ok: true };
    },

    async addIndicator(definitionId, params, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      const def = cryptoIndicatorById(definitionId);
      if (!def) return refuse('unknown_indicator');
      const given = params === undefined ? {} : readParams(def, params);
      if (!given) return refuse('bad_params');
      const { indicators } = get();
      if (indicators.length >= INDICATORS_MAX) return refuse('indicators_full');
      const instance: IndicatorInstance = { id: freshId('ind', indicators), definitionId: def.id, params: { ...defaultParams(def), ...given }, visible: true };
      await saveChart(
        { indicators: [...indicators, instance] },
        logged(actor, TOOL.indicator, () => tr(`Indicateur ajouté : ${def.short}`, `Indicator added: ${def.short}`, `Indicador añadido: ${def.short}`)),
      );
      return { ok: true, id: instance.id };
    },

    async updateIndicator(id, patch) {
      if (!get().settingsRead && !(await readSettings())) return;
      const { indicators } = get();
      const instance = indicators.find((i) => i.id === id);
      const def = instance && cryptoIndicatorById(instance.definitionId);
      const params = def ? readParams(def, patch) : null;
      if (!params) return;
      await saveChart({ indicators: indicators.map((i) => (i.id === id ? { ...i, params: { ...i.params, ...params } } : i)) });
    },

    async toggleIndicator(id) {
      if (!get().settingsRead && !(await readSettings())) return;
      const { indicators } = get();
      if (!indicators.some((i) => i.id === id)) return;
      await saveChart({ indicators: indicators.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)) });
    },

    async removeIndicator(id, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      const { indicators } = get();
      const instance = indicators.find((i) => i.id === id);
      if (!instance) return refuse('unknown_indicator');
      const name = cryptoIndicatorById(instance.definitionId)?.short ?? instance.definitionId;
      await saveChart(
        { indicators: indicators.filter((i) => i.id !== id) },
        logged(actor, TOOL.indicator, () => tr(`Indicateur retiré : ${name}`, `Indicator removed: ${name}`, `Indicador quitado: ${name}`)),
      );
      return { ok: true };
    },

    async addDrawing(d, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      const { market, kind, price, from, to, label } = d;
      if (claimsBadAuthor(d)) return refuse('bad_mode');
      if (!isChartableMarket(market)) return refuse('unknown_market');
      if (kind !== 'level' && kind !== 'zone') return refuse('bad_kind');
      // Seuls les champs du genre sont repris ; un niveau a un prix, une zone deux bornes dans l'ordre.
      let shape: Pick<CryptoDrawing, 'kind' | 'price' | 'from' | 'to'>;
      if (kind === 'level') {
        if (!isPrice(price)) return refuse('bad_price');
        shape = { kind, price };
      } else {
        if (!isPrice(from) || !isPrice(to) || from >= to) return refuse('bad_price');
        shape = { kind, from, to };
      }
      if (label !== undefined) {
        if (typeof label !== 'string') return refuse('bad_label');
        if (label.length > LABEL_MAX) return refuse('label_too_long');
      }
      const { drawings } = get();
      if (drawings.length >= DRAWINGS_MAX) return refuse('drawings_full');
      const drawing: CryptoDrawing = { id: freshId('drw', drawings), market, ...shape, author: actor, createdAt: Date.now() };
      if (label !== undefined) drawing.label = label;
      await saveDrawings(
        [...drawings, drawing],
        logged(actor, TOOL.drawing, () => {
          const name = marketLabel(market);
          return shape.kind === 'level'
            ? tr(`Niveau tracé : ${name} à ${shape.price}`, `Level drawn: ${name} at ${shape.price}`, `Nivel trazado: ${name} en ${shape.price}`)
            : tr(`Zone tracée : ${name} de ${shape.from} à ${shape.to}`, `Zone drawn: ${name} from ${shape.from} to ${shape.to}`, `Zona trazada: ${name} de ${shape.from} a ${shape.to}`);
        }),
      );
      return { ok: true, id: drawing.id };
    },

    async removeDrawing(id, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      const { drawings } = get();
      const drawing = drawings.find((d) => d.id === id);
      if (!drawing) return refuse('unknown_drawing');
      const name = marketLabel(drawing.market);
      await saveDrawings(
        drawings.filter((d) => d.id !== id),
        logged(actor, TOOL.drawing, () => tr(`Tracé retiré : ${name}`, `Drawing removed: ${name}`, `Trazado quitado: ${name}`)),
      );
      return { ok: true };
    },

    async createAlert(a, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      const { target, kind, level, mode } = a;
      if ((mode !== 'once' && mode !== 'rearm') || claimsBadAuthor(a)) return refuse('bad_mode');
      const valid = validateAlert({ target, kind, level, mode, author: actor });
      if (!valid.ok) return refuse(valid.reason);
      const { alerts, watchlist } = get();
      if (isChartableMarket(target) && !watchlist.includes(target)) return refuse('not_in_watchlist');
      if (alerts.length >= ALERTS_MAX) return refuse('alerts_full');
      const alert: CryptoAlert = { id: freshId('alr', alerts), target, kind, level, mode, author: actor, state: 'armed', createdAt: Date.now() };
      await saveAlerts(
        [...alerts, alert],
        logged(actor, TOOL.alert, () => tr(`Alerte créée : ${alertText(alert)}`, `Alert created: ${alertText(alert)}`, `Alerta creada: ${alertText(alert)}`)),
      );
      return { ok: true, id: alert.id };
    },

    async deleteAlert(id, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      const { alerts } = get();
      const alert = alerts.find((a) => a.id === id);
      if (!alert) return refuse('unknown_alert');
      await saveAlerts(
        alerts.filter((a) => a.id !== id),
        logged(actor, TOOL.alert, () => tr(`Alerte supprimée : ${alertText(alert)}`, `Alert deleted: ${alertText(alert)}`, `Alerta eliminada: ${alertText(alert)}`)),
      );
      return { ok: true };
    },

    async setAlertState(id, state, at) {
      if (!get().settingsRead && !(await readSettings())) return;
      if (state !== 'armed' && state !== 'triggered' && state !== 'paused') return;
      if (at !== undefined && !Number.isFinite(at)) return;
      const { alerts } = get();
      if (!alerts.some((a) => a.id === id)) return;
      const stamp = at ?? (state === 'triggered' ? Date.now() : undefined);
      await saveAlerts(alerts.map((a) => (a.id !== id ? a : stamp === undefined ? { ...a, state } : { ...a, state, lastTriggeredAt: stamp })));
    },

    async addToWatchlist(id, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      if (!isChartableMarket(id)) return refuse('unknown_market');
      const { watchlist } = get();
      await saveWatchlist(
        watchlist.includes(id) ? watchlist : [...watchlist, id],
        logged(actor, TOOL.watchlist, () => tr(`Watchlist : ${marketLabel(id)} ajouté`, `Watchlist: ${marketLabel(id)} added`, `Watchlist: ${marketLabel(id)} añadido`)),
      );
      return { ok: true };
    },

    async removeFromWatchlist(id, by = 'trader') {
      if (!get().settingsRead && !(await readSettings())) return refuse('not_ready');
      const actor = readBy(by);
      if (!actor) return refuse('bad_mode');
      if (!isChartableMarket(id)) return refuse('unknown_market');
      const { watchlist, alerts } = get();
      if (!watchlist.includes(id)) return refuse('not_in_watchlist');
      if (alerts.some((a) => a.target === id)) return refuse('market_has_alerts');
      await saveWatchlist(
        watchlist.filter((market) => market !== id),
        logged(actor, TOOL.watchlist, () => tr(`Watchlist : ${marketLabel(id)} retiré`, `Watchlist: ${marketLabel(id)} removed`, `Watchlist: ${marketLabel(id)} quitado`)),
      );
      return { ok: true };
    },
  };
});

// --- Flux en direct (`./cryptoLive`) -----------------------------------------------------------------------------------

/** L'arrêt du flux en cours, ou `null` quand il est éteint. */
let stopLight: (() => void) | null = null;
let stopChart: (() => void) | null = null;

/**
 * Accorde les deux flux à l'état, à chaque changement : rien tant que le store n'est pas prêt (statut et réglages lus) ou que
 * l'interrupteur est éteint ; le léger dès qu'il s'allume, le lourd quand le chart est en plus ouvert. Un flux est relancé à
 * neuf à chaque allumage : un abonnement refusé par le process principal pendant l'extinction n'est jamais ranimé.
 * L'arrêt d'un flux vide ses données (une écriture de l'état, qui rappelle cette écoute) : la variable est remise à `null`
 * avant l'arrêt, pour que l'appel imbriqué voie le flux déjà éteint. Le démarrage n'écrit pas l'état.
 */
function syncFlows(): void {
  const { ready, enabled, chartOpen } = useCrypto.getState();
  const on = ready && enabled;
  if (!(on && chartOpen) && stopChart) {
    const stop = stopChart;
    stopChart = null;
    stop();
  }
  if (!on && stopLight) {
    const stop = stopLight;
    stopLight = null;
    stop();
  }
  if (on && !stopLight) stopLight = startLight();
  if (on && chartOpen && !stopChart) stopChart = startChart();
}

useCrypto.subscribe(syncFlows);
