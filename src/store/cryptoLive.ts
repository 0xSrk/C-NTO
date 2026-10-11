/**
 * Les flux en direct de l'onglet crypto, côté renderer (`docs/ONGLET-CRYPTO.md` § 5, « Deux niveaux de flux ») : le store
 * (`./crypto`) les allume et les éteint, ce module les tient. Tout passe par le port du moteur (`createCryptoPort`) sur
 * `desk.crypto` : le renderer n'ouvre aucune connexion, le process principal valide chaque demande. Hors du desk (pas de
 * `desk.crypto`), rien ne part.
 *
 * - **Léger** (`startLight`), tant que l'interrupteur est allumé : un abonnement ticker par marché de la watchlist, suivi
 *   quand elle change ; l'écoute de la température, puis sa lecture initiale. Les venues viennent de l'écoute du statut que
 *   `load()` pose une fois pour toutes (CRY0.4).
 * - **Lourd** (`startChart`), tant que le chart est ouvert : les bougies du marché et du timeframe (abonnement, puis
 *   historique), et pour BTC et ONDO, quand l'indicateur `cvd-binance` est visible, celles de leur série Binance dans
 *   `proxyBars`. Chaque bougie en direct passe par `mergeLiveBar` ; `cvdAnchoredAt` est recalculé après chaque fusion.
 *
 * Un changement de marché ou de timeframe, d'où qu'il vienne (trader, agent, `reloadSettings`), vide aussitôt les bougies et
 * incrémente le jeton de requête : un historique ou une bougie de l'ancien choix qui arrive ensuite est ignoré. Le flux n'est
 * redemandé que 300 ms après le dernier changement (Binance ferme la socket au-delà de 5 messages d'abonnement par seconde).
 *
 * Les refus du process principal restent des codes (`crypto_disabled`, `blocked`, `rate_limited`, `no_history`,
 * `unknown_stream`, `invalid_request`) dans `chartError`, `proxyError` et `tickerErrors` : l'écran les traduit. Un abonnement
 * refusé n'est pas redemandé ; le prochain allumage repart de zéro. Chaque arrêt lâche tous ses abonnements et ses écoutes,
 * ne laisse aucune minuterie et vide les données vivantes de son flux.
 */
import { cvdAnchor } from '@/engine/crypto/cvd';
import { cryptoMarket, type CryptoBar, type CryptoMarketId, type CryptoSeriesId, type CryptoTimeframe } from '@/engine/crypto/markets';
import { createCryptoPort, type CryptoPortEvent } from '@/engine/crypto/port';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import { mergeLiveBar } from '@/engine/crypto/tradeBars';
import type { IndicatorInstance } from '@/engine/indicators';
import { desk } from '@/lib/desk';
import { useCrypto, type CryptoState } from './crypto';

/**
 * Bougies gardées par série : la fenêtre que le process principal charge (jusqu'à 2 880 bougies en 1m pour remonter à la veille
 * UTC), jamais le plafond par défaut de `mergeLiveBar` (1 000), qui lâcherait les plus anciennes et laisserait le VWAP et les
 * niveaux du jour UTC sans la veille.
 */
export const LIVE_BARS_MAX = 3000;

/** Délai entre le dernier changement de marché, de timeframe ou du CVD Binance et la nouvelle demande de flux. */
export const RESUBSCRIBE_DELAY_MS = 300;

/** L'indicateur qui lit la série Binance du même actif (`inputBarsFor`). */
const CVD_BINANCE = 'cvd-binance';

/** Sans motif du port : un code tout de même, jamais une chaîne vide. */
const UNKNOWN_ERROR = 'error';

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)) || UNKNOWN_ERROR;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** L'objet sans ces clés ; le même objet s'il n'en porte aucune. */
function without<T>(record: Partial<Record<CryptoMarketId, T>>, keys: readonly CryptoMarketId[]): Partial<Record<CryptoMarketId, T>> {
  if (!keys.some((key) => key in record)) return record;
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}

/**
 * Le flux léger : tickers de la watchlist et température. Rend l'arrêt, idempotent, qui lâche les abonnements et les écoutes
 * et vide `tickers`, `tickerErrors` et `temperature`. Ne change pas l'état à l'appel : seulement à l'arrivée des données.
 */
export function startLight(): () => void {
  const api = desk?.crypto;
  if (!api) return () => {};
  const port = createCryptoPort(api);
  /** Les abonnements ticker ouverts, par marché. Un abonnement refusé reste ici, mort : il n'est pas redemandé. */
  const tickers = new Map<CryptoMarketId, () => void>();
  let stopped = false;
  /** Vrai dès qu'une lecture a été poussée : la lecture initiale, plus ancienne, ne la remplace pas. */
  let pushed = false;

  const follow = (market: CryptoMarketId) =>
    port.subscribe({ kind: 'quote', instrument: market }, (event: CryptoPortEvent) => {
      if (stopped) return;
      if (event.kind === 'quote') {
        const { last, time, change24hPct } = event.quote;
        useCrypto.setState((s) => ({ tickers: { ...s.tickers, [market]: { market, last, change24hPct, time } } }));
      } else if (event.kind === 'status' && event.state === 'error') {
        useCrypto.setState((s) => ({ tickerErrors: { ...s.tickerErrors, [market]: event.detail || UNKNOWN_ERROR } }));
      }
    });

  let watchlist: readonly CryptoMarketId[] = [];
  const syncTickers = () => {
    const next = useCrypto.getState().watchlist;
    if (next === watchlist) return;
    watchlist = next;
    const dropped: CryptoMarketId[] = [];
    for (const [market, stop] of tickers) {
      if (watchlist.includes(market)) continue;
      stop();
      tickers.delete(market);
      dropped.push(market);
    }
    // Le dernier prix d'un marché qu'on ne suit plus ne reste pas : rien ne le tiendrait à jour.
    if (dropped.length > 0) useCrypto.setState((s) => ({ tickers: without(s.tickers, dropped), tickerErrors: without(s.tickerErrors, dropped) }));
    for (const market of watchlist) if (!tickers.has(market)) tickers.set(market, follow(market));
  };

  // L'écoute précède la lecture : une lecture poussée entre les deux ne se perd pas.
  const stopTemperature = api.onTemperature((r: TemperatureReading) => {
    if (stopped || !isRecord(r)) return;
    pushed = true;
    useCrypto.setState({ temperature: r });
  });
  void api.temperature().then(
    (r) => {
      if (!stopped && !pushed && isRecord(r)) useCrypto.setState({ temperature: r });
    },
    () => {
      // Process principal illisible : la prochaine lecture poussée prendra la place.
    },
  );

  const stopWatching = useCrypto.subscribe(syncTickers);
  syncTickers();

  return () => {
    if (stopped) return;
    stopped = true;
    stopWatching();
    stopTemperature();
    port.dispose();
    tickers.clear();
    useCrypto.setState({ tickers: {}, tickerErrors: {}, temperature: null });
  };
}

/** Ce que le chart affiche, et donc ce que le flux lourd suit. */
interface ChartTarget {
  market: CryptoMarketId;
  timeframe: CryptoTimeframe;
  indicators: IndicatorInstance[];
}

/** La série Binance que le chart demande en plus : celle du marché, si l'indicateur `cvd-binance` est visible. */
function proxySeriesFor({ market, indicators }: Pick<ChartTarget, 'market' | 'indicators'>): CryptoSeriesId | null {
  const proxy = cryptoMarket(market)?.cvdProxy;
  return proxy && indicators.some((i) => i.definitionId === CVD_BINANCE && i.visible) ? proxy : null;
}

/** Un flux de bougies ouvert : une série à un timeframe, versée dans `bars` (le chart) ou `proxyBars` (le CVD Binance). */
interface Leg {
  series: CryptoSeriesId;
  timeframe: CryptoTimeframe;
  /** Le jeton de requête à l'ouverture : périmé dès que le marché ou le timeframe change. */
  token: number;
  closed: boolean;
  close: () => void;
}

/** Ce que l'arrêt du flux lourd et un changement de marché ou de timeframe effacent ; des tableaux neufs à chaque fois. */
const noChartData = (): Pick<CryptoState, 'bars' | 'proxyBars' | 'cvdAnchoredAt' | 'chartError' | 'proxyError'> => ({
  bars: [],
  proxyBars: [],
  cvdAnchoredAt: null,
  chartError: null,
  proxyError: null,
});

/**
 * Le flux lourd : bougies du chart et, s'il le faut, du CVD Binance. Ouvert tout de suite sur le choix courant, puis suit le
 * store. Rend l'arrêt, idempotent, qui lâche les abonnements, annule la temporisation en cours et vide les données du chart.
 * Ne change pas l'état à l'appel : seulement à l'arrivée des données ou d'un changement de choix.
 */
export function startChart(): () => void {
  const api = desk?.crypto;
  if (!api) return () => {};
  const port = createCryptoPort(api);
  /** Le jeton de requête : incrémenté à chaque changement de marché ou de timeframe, dans le tour même du changement. */
  let token = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chart: Leg | null = null;
  let proxy: Leg | null = null;
  let seen: ChartTarget = useCrypto.getState();

  function open(target: 'bars' | 'proxyBars', series: CryptoSeriesId, timeframe: CryptoTimeframe): Leg {
    const leg: Leg = { series, timeframe, token, closed: false, close: () => {} };
    const current = () => !stopped && !leg.closed && leg.token === token;
    const fail = (detail: string) => useCrypto.setState(target === 'bars' ? { chartError: detail } : { proxyError: detail });
    const write = (bars: CryptoBar[]) => useCrypto.setState(target === 'bars' ? { bars, cvdAnchoredAt: cvdAnchor(bars) } : { proxyBars: bars });
    /**
     * Les bougies arrivées avant l'historique, déjà rangées entre elles par `mergeLiveBar` (le même résultat que de les ranger
     * une à une sur l'historique, et borné) ; `null` une fois l'historique posé.
     */
    let early: CryptoBar[] | null = [];
    const settle = (history: CryptoBar[]) => {
      let bars = history.length > LIVE_BARS_MAX ? history.slice(history.length - LIVE_BARS_MAX) : history;
      for (const live of early ?? []) bars = mergeLiveBar(bars, live, LIVE_BARS_MAX);
      early = null;
      write(bars);
    };

    // L'abonnement d'abord, l'historique ensuite : aucune bougie ne tombe entre les deux.
    const unsubscribe = port.subscribe({ kind: 'bars', instrument: series, timeframe }, (event) => {
      if (!current()) return;
      if (event.kind === 'bar') {
        if (early) early = mergeLiveBar(early, event.bar, LIVE_BARS_MAX);
        else write(mergeLiveBar(useCrypto.getState()[target], event.bar, LIVE_BARS_MAX));
      } else if (event.kind === 'status' && event.state === 'error') {
        fail(event.detail || UNKNOWN_ERROR);
      }
    });
    // `from` et `to` ne filtrent que côté renderer : la fenêtre est celle que le process principal charge.
    port.history({ instrument: series, timeframe, from: 0, to: Number.POSITIVE_INFINITY }).then(
      (history) => {
        if (current()) settle(history);
      },
      (error: unknown) => {
        if (!current()) return;
        fail(reason(error));
        // Sans historique, le chart montre au moins ce qui arrive en direct.
        settle([]);
      },
    );
    leg.close = () => {
      leg.closed = true;
      unsubscribe();
    };
    return leg;
  }

  /** Accorde les flux ouverts au choix courant : rouvre ce qui a changé ou dont le jeton est périmé, lâche ce qui n'est plus voulu. */
  function sync(): void {
    timer = null;
    if (stopped) return;
    const { market, timeframe, indicators } = useCrypto.getState();
    if (!chart || chart.token !== token || chart.series !== market || chart.timeframe !== timeframe) {
      chart?.close();
      chart = open('bars', market, timeframe);
    }
    const proxySeries = proxySeriesFor({ market, indicators });
    if (proxy && (proxy.token !== token || proxy.series !== proxySeries || proxy.timeframe !== timeframe)) {
      proxy.close();
      proxy = null;
      useCrypto.setState({ proxyBars: [], proxyError: null });
    }
    if (!proxy && proxySeries) proxy = open('proxyBars', proxySeries, timeframe);
  }

  /** Le dernier changement gagne : la temporisation repart à chaque appel. */
  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(sync, RESUBSCRIBE_DELAY_MS);
  }

  const stopWatching = useCrypto.subscribe(() => {
    if (stopped) return;
    const state = useCrypto.getState();
    if (state.market !== seen.market || state.timeframe !== seen.timeframe) {
      // Retenu avant d'écrire l'état : l'écriture qui suit rappelle cette écoute, qui ne doit pas y voir un second changement.
      seen = state;
      token++;
      useCrypto.setState(noChartData());
      schedule();
    } else if (state.indicators !== seen.indicators) {
      seen = state;
      // Seul le CVD Binance dépend des indicateurs ; un changement en attente fera le reste quand sa temporisation tombera.
      if (timer === null && proxySeriesFor(state) !== (proxy?.series ?? null)) schedule();
    }
  });
  sync();

  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    stopWatching();
    port.dispose();
    chart = null;
    proxy = null;
    useCrypto.setState(noChartData());
  };
}
