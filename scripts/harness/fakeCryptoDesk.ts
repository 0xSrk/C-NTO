/**
 * Faux desk du banc de capture de l'onglet 09 · CRY (CRY4.4) : tout ce que le process principal donnerait au renderer,
 * servi sans aucun réseau, d'après des réponses réelles des exchanges.
 *
 * - L'historique sort des réponses REST enregistrées (`./recorded`), lues par `parseCandles` : aucune bougie n'est inventée.
 *   4 h et 1 j sont les regroupements (`aggregateBars`) des bougies 1 h ; plus court, le banc n'a rien (`no_history`).
 * - Le direct est rejoué : les dernières bougies de chaque série sont retirées de l'historique, puis poussées une à une
 *   (la dernière non close), comme si le flux les apportait ; les tickers rejouent le chemin de la dernière bougie
 *   (ouverture, extrêmes, clôture) avec l'heure de l'horloge.
 * - Fixture : les bougies Coinbase et Bybit n'ont pas de volume acheteur (leur historique REST n'en donne pas, le CVD se
 *   construit sur les trades). Le banc donne à chaque bougie rejouée la part acheteuse réelle de la série Binance du même
 *   actif et de la même heure (le volume des « takers », `cvdProxy` du registre), ou une part neutre de 0,5 sans cette série.
 * - Fixture : la température est figée, à des valeurs plausibles, datées de l'horloge pour que rien n'y soit « périmé ».
 * - L'interrupteur est allumé et le reste : le banc n'a pas de module à éteindre.
 *
 * Ce module n'importe que des types de `@/lib/desk` : `@/lib/desk` lit `window.canto` au premier import, que le banc ne
 * pose qu'après avoir construit ce faux desk (`crypto-harness.tsx`).
 */
import { cryptoMarket, isChartableMarket, isCryptoSeriesId, isCryptoTimeframe, type CryptoBar, type CryptoFeedEvent, type CryptoSeriesId, type CryptoTimeframe } from '@/engine/crypto/markets';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import { aggregateBars, parseCandles } from '@/engine/crypto/venues';
import type { CryptoApi, CryptoMainStatus, DeskApi } from '@/lib/desk';
import { APP_VERSION } from '@/lib/version';

export interface CryptoFixtures {
  /** Les réponses REST brutes en 1 h, telles que les exchanges les ont rendues, par série ; plusieurs pages : la plus récente d'abord. */
  responses: Partial<Record<CryptoSeriesId, readonly unknown[]>>;
}

export interface FakeCryptoOptions {
  /** L'horloge, en millisecondes : l'heure des tickers et de la température. `Date.now` par défaut. */
  clock?: () => number;
  /** Combien de bougies finales sont retirées de l'historique et rejouées en direct. 6 par défaut. */
  liveBars?: number;
  /** Délai du premier ticker rejoué, puis celui de la première bougie, puis l'écart entre deux messages, en millisecondes. */
  tickerDelayMs?: number;
  barDelayMs?: number;
  gapMs?: number;
}

/** Le faux module crypto, plus l'orchestrateur que `DeskApi` exige. */
export type FakeCryptoDesk = CryptoApi & Pick<DeskApi, 'orchestrator'>;

/** Les timeframes que le banc sert : le nombre de bougies 1 h par bougie rendue. */
const HOURLY_FACTOR: Partial<Record<CryptoTimeframe, number>> = { 60: 1, 240: 4, 1440: 24 };
const DAY_OF_HOURS = 24;

type SubscribeReply = Awaited<ReturnType<CryptoApi['subscribe']>>;
const refuse = (detail: string): { ok: false; detail: string } => ({ ok: false, detail });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * La température lue chez Binance, figée (fixture) : un funding médian de 0,008 %, un spot à 58 % de paires en hausse, un peu
 * plus de liquidations longues que courtes sur l'heure, un open interest de BTC en hausse et celui d'ETH en baisse.
 * Chaque lecture est datée de `now` moins quelques secondes : l'écran n'en juge aucune périmée.
 */
export function fixtureTemperature(now: number): TemperatureReading {
  return {
    funding: { median: 0.0000812, btc: 0.0000524, symbols: 318, at: now - 12_000 },
    breadth: { upShare: 0.58, pairs: 487, at: now - 45_000 },
    liquidations: { long: 1_284_000, short: 612_000, since: now - 55 * 60_000, at: now - 4_000, lowerBound: true },
    openInterest: { btc: 0.021, eth: -0.008, at: now - 90_000 },
  };
}

export function fakeCryptoDesk(fixtures: CryptoFixtures, options: FakeCryptoOptions = {}): FakeCryptoDesk {
  const { clock = Date.now, liveBars = 6, tickerDelayMs = 150, barDelayMs = 700, gapMs = 220 } = options;
  const listeners = new Set<(e: CryptoFeedEvent) => void>();
  /** Les minuteries de chaque abonnement ouvert : les lâcher les arrête. */
  const subscriptions = new Map<string, ReturnType<typeof setTimeout>[]>();
  let counter = 0;

  const emit = (event: CryptoFeedEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };

  /** Les bougies de la série à ce timeframe, lues par `parseCandles` ; `null` sans réponse ou à un timeframe que le banc n'a pas. Peut lever (Bybit : `retMsg`). */
  const barsOf = (series: CryptoSeriesId, timeframe: CryptoTimeframe): CryptoBar[] | null => {
    const pages = fixtures.responses[series];
    const venue = cryptoMarket(series)?.venue;
    const factor = HOURLY_FACTOR[timeframe];
    if (!pages || !venue || !factor) return null;
    const hourly = aggregateBars(
      pages.flatMap((page) => parseCandles(venue, page)),
      60,
      1,
    );
    return factor === 1 ? hourly : aggregateBars(hourly, 60, factor);
  };

  /** Ce qui reste à l'historique, et ce qui est rejoué en direct. Au moins une bougie reste à l'historique. */
  const split = (bars: CryptoBar[]): { history: CryptoBar[]; live: CryptoBar[] } => {
    const count = Math.max(0, Math.min(liveBars, bars.length - 1));
    return { history: bars.slice(0, bars.length - count), live: bars.slice(bars.length - count) };
  };

  /** La part acheteuse de chaque heure, d'après la série Binance du même actif, par `time` ; vide sans cette série. */
  const buyShares = (series: CryptoSeriesId, timeframe: CryptoTimeframe): Map<number, number> => {
    const shares = new Map<number, number>();
    const proxy = cryptoMarket(series)?.cvdProxy;
    for (const bar of (proxy ? barsOf(proxy, timeframe) : null) ?? []) {
      if (bar.buyVolume !== undefined && bar.volume > 0) shares.set(bar.time, bar.buyVolume / bar.volume);
    }
    return shares;
  };

  /** Une bougie rejouée porte toujours un volume acheteur, entre 0 et son volume ; celui de Binance est gardé tel quel. */
  const withBuyVolume = (bar: CryptoBar, shares: Map<number, number>): CryptoBar => {
    if (bar.buyVolume !== undefined) return bar;
    const share = Math.min(1, Math.max(0, shares.get(bar.time) ?? 0.5));
    return { ...bar, buyVolume: Math.min(bar.volume, Math.round(bar.volume * share * 1e8) / 1e8) };
  };

  const open = (steps: { at: number; run: () => void }[]): SubscribeReply => {
    const id = `sub-${++counter}`;
    subscriptions.set(
      id,
      steps.map(({ at, run }) => setTimeout(run, at)),
    );
    return { ok: true, subscriptionId: id };
  };

  const api: CryptoApi = {
    status: async (): Promise<CryptoMainStatus> => ({ enabled: true, venues: { coinbase: 'live', binance: 'live', bybit: 'live' } }),
    // Le banc n'a pas d'interrupteur : allumé, il le reste.
    enable: () => api.status(),
    disable: () => api.status(),

    async history(req) {
      try {
        const bars = isRecord(req) && isCryptoSeriesId(req.series) && isCryptoTimeframe(req.timeframe) ? barsOf(req.series, req.timeframe) : null;
        return bars && bars.length > 0 ? { ok: true, bars: split(bars).history } : refuse('no_history');
      } catch (error) {
        return refuse(error instanceof Error ? error.message : String(error));
      }
    },

    async subscribe(req) {
      if (!isRecord(req) || !isCryptoSeriesId(req.series)) return refuse('invalid_request');
      const { series, kind, timeframe } = req;
      try {
        if (kind === 'ticker') {
          const hourly = isChartableMarket(series) ? barsOf(series, 60) : null;
          const last = hourly?.at(-1);
          if (!hourly || !last) return refuse('unknown_stream');
          const day = hourly.at(-(DAY_OF_HOURS + 1));
          const change24hPct = day ? (last.close / day.close - 1) * 100 : null;
          // Le chemin de la dernière bougie : l'ouverture, les extrêmes dans l'ordre que la couleur rend le plus probable, la clôture.
          const path = last.close >= last.open ? [last.open, last.low, last.high, last.close] : [last.open, last.high, last.low, last.close];
          return open(
            path.map((price, i) => ({
              at: tickerDelayMs + i * gapMs,
              run: () => emit({ kind: 'ticker', ticker: { market: series, last: price, change24hPct, time: clock() } }),
            })),
          );
        }
        if (kind === 'bars') {
          if (!isCryptoTimeframe(timeframe)) return refuse('invalid_request');
          const bars = barsOf(series, timeframe);
          if (!bars || bars.length < 2) return refuse('unknown_stream');
          const shares = buyShares(series, timeframe);
          const { live } = split(bars);
          return open(
            live.map((bar, i) => ({
              at: barDelayMs + i * gapMs,
              run: () => emit({ kind: 'bar', series, timeframe, bar: withBuyVolume(bar, shares), final: i < live.length - 1 }),
            })),
          );
        }
      } catch (error) {
        return refuse(error instanceof Error ? error.message : String(error));
      }
      return refuse('invalid_request');
    },

    async unsubscribe(id) {
      const timers = subscriptions.get(id);
      if (!timers) return { ok: false };
      for (const timer of timers) clearTimeout(timer);
      subscriptions.delete(id);
      return { ok: true };
    },

    temperature: async () => fixtureTemperature(clock()),

    onEvent: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    // Rien n'est poussé : la lecture figée est celle de `temperature()`, et le statut ne change jamais.
    onTemperature: () => () => {},
    onStatus: () => () => {},
  };

  const orchestrator: DeskApi['orchestrator'] = {
    start: async () => ({ running: false, port: 0, clients: 0 }),
    stop: async () => ({ running: false, port: 0, clients: 0 }),
    status: async () => ({ running: false, port: 0, clients: 0 }),
    rotateToken: async () => ({ running: false, port: 0, clients: 0 }),
    copyToken: async () => null,
    respond: () => {},
    broadcast: () => {},
    onRequest: () => () => {},
    onStatus: () => () => {},
  };

  return { ...api, orchestrator };
}

/**
 * Un `DeskApi` complet autour du faux module crypto : les membres obligatoires sont des fonctions vides (une version, aucune
 * mise à jour, aucun pont, aucun fichier), et seul `crypto` est branché. Le desk se reconnaît comme tel (`isDesk`), avec ses
 * boutons de fenêtre, sans qu'aucun de ces boutons ne fasse rien.
 */
export function fakeDeskApi(crypto: FakeCryptoDesk): DeskApi {
  return {
    isDesk: true,
    platform: 'win32',
    version: async () => APP_VERSION,
    update: {
      check: async () => null,
      changelog: async () => null,
      apply: async () => null,
      relaunch: async () => false,
      startDesk: async () => false,
    },
    bridge: {
      status: async () => null,
      configure: async () => null,
      pickFolder: async () => null,
      defaultFolder: async () => null,
      rescan: async () => null,
      result: () => {},
      openFolder: async () => false,
      onFile: () => () => {},
      onStatus: () => () => {},
    },
    secrets: { encrypt: async () => null },
    window: {
      minimize: () => {},
      toggleMaximize: () => {},
      close: () => {},
      onMaximized: () => () => {},
    },
    files: {
      saveText: async () => false,
      openText: async () => null,
    },
    orchestrator: crypto.orchestrator,
    crypto,
  };
}
