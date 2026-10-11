import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Bar } from '@/engine/bars';
import { CRYPTO_MARKETS, type CryptoBar, type CryptoFeedEvent, type CryptoSeriesId, type CryptoTimeframe } from '@/engine/crypto/markets';
import { createCryptoPort, type CryptoTransport } from '@/engine/crypto/port';
import type { FeedEvent, MarketDataPort, SubscribeRequest } from '@/engine/marketdata/port';

type HistoryCall = Parameters<CryptoTransport['history']>[0];
type SubscribeCall = Parameters<CryptoTransport['subscribe']>[0];
type HistoryReply = Awaited<ReturnType<CryptoTransport['history']>>;
type SubscribeReply = Awaited<ReturnType<CryptoTransport['subscribe']>>;

const BTC: CryptoSeriesId = 'coinbase:BTC-USD';
const ONDO: CryptoSeriesId = 'coinbase:ONDO-USD';
const ONE: CryptoSeriesId = 'binance:ONEUSDT';

/** Le 9 octobre 2026, midi UTC : en secondes pour les barres, en millisecondes pour les derniers prix. */
const T0 = Date.UTC(2026, 9, 9, 12) / 1000;
const NOW_MS = T0 * 1000;
const HOUR = 3600;

/** Des identifiants que le registre ne porte pas : un autre marché, le symbole natif, la casse, le vide. */
const UNKNOWN_SERIES = ['coinbase:ETH-USD', 'BTC-USD', 'binance:btcusdt', ''];
/** Des timeframes hors des six du chart (1, 5, 15, 60, 240, 1440 minutes). */
const UNKNOWN_TIMEFRAMES = [0, 3, 30, 1441, Number.NaN];

/**
 * Le transport tel que le port le voit : le faux garde les appels reçus et la liste des écoutes ouvertes.
 * Un abonnement est accepté sous `sub-<n>` (n = rang de la demande) ; l’historique rend ce que `replyHistory` pose.
 */
function fakeTransport() {
  const listeners = new Set<(event: CryptoFeedEvent) => void>();
  const histories: HistoryCall[] = [];
  const subscribes: SubscribeCall[] = [];
  const unsubs: string[] = [];
  let historyReply: HistoryReply = { ok: true, bars: [] };
  const transport: CryptoTransport = {
    async history(req) {
      histories.push({ ...req });
      return historyReply;
    },
    async subscribe(req) {
      subscribes.push({ ...req });
      return { ok: true, subscriptionId: `sub-${subscribes.length}` };
    },
    async unsubscribe(id) {
      unsubs.push(id);
      return { ok: true };
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return {
    transport,
    histories,
    subscribes,
    unsubs,
    /** Nombre d’écoutes ouvertes sur `onEvent`. */
    listening: () => listeners.size,
    replyHistory: (reply: HistoryReply) => {
      historyReply = reply;
    },
    /** Le process principal pousse un événement : chaque écoute le reçoit. */
    emit: (event: CryptoFeedEvent) => {
      for (const cb of [...listeners]) cb(event);
    },
  };
}

type Fake = ReturnType<typeof fakeTransport>;

/** Laisse `subscribe` sans réponse jusqu’à `answer(n, réponse)` : la réponse qui arrive après un désabonnement. */
function holdSubscribes(fake: Fake): (index: number, reply: SubscribeReply) => void {
  const waiting: Array<(reply: SubscribeReply) => void> = [];
  fake.transport.subscribe = (req) => {
    fake.subscribes.push({ ...req });
    return new Promise<SubscribeReply>((resolve) => waiting.push(resolve));
  };
  return (index, reply) => waiting[index]?.(reply);
}

/** Laisse passer les promesses en attente : réponses du transport et statuts du port. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('la promesse devait être rejetée');
}

function listen(port: MarketDataPort, req: SubscribeRequest) {
  const seen: FeedEvent[] = [];
  const stop = port.subscribe!(req, (event) => seen.push(event));
  return { seen, stop };
}

/** Sans les statuts : les barres et les derniers prix reçus. */
const data = (events: FeedEvent[]): FeedEvent[] => events.filter((event) => event.kind !== 'status');

/** Une bougie du transport, `buyVolume` se pose par `over`. */
const row = (time: number, close: number, over: Partial<CryptoBar> = {}): CryptoBar => ({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 10, ...over });
/** La même, telle que le moteur la lit : les six champs de `Bar`. */
const bar = (time: number, close: number): Bar => ({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 10 });

const barEvent = (series: CryptoSeriesId, timeframe: CryptoTimeframe, bars: CryptoBar, final = false): CryptoFeedEvent => ({ kind: 'bar', series, timeframe, bar: bars, final });
const tickerEvent = (market: CryptoSeriesId, last: number): CryptoFeedEvent => ({ kind: 'ticker', ticker: { market, last, change24hPct: 1.25, time: NOW_MS } });

const barOut = (series: CryptoSeriesId, timeframe: CryptoTimeframe, time: number, close: number, final = false): FeedEvent => ({ kind: 'bar', instrument: series, timeframe, bar: bar(time, close), final });
const quoteOut = (market: CryptoSeriesId, last: number): FeedEvent => ({ kind: 'quote', quote: { instrument: market, time: NOW_MS, last } });

describe('port crypto du moteur', () => {
  it('se déclare source crypto : historique, barres et derniers prix, sur les six séries du registre', () => {
    const port = createCryptoPort(fakeTransport().transport);
    expect(port.sourceId).toBe('crypto');
    expect(port.capabilities).toEqual({ history: true, live: ['bars', 'quote'], instruments: CRYPTO_MARKETS.map((m) => m.id) });
  });

  describe('history', () => {
    it('demande la série et le timeframe au transport, filtre sur from et to (bornes comprises), trie et dédoublonne', async () => {
      const fake = fakeTransport();
      fake.replyHistory({ ok: true, bars: [row(T0 + 2 * HOUR, 3), row(T0 - HOUR, 9), row(T0 + HOUR, 2), row(T0, 1), row(T0 + HOUR, 5), row(T0 + 3 * HOUR, 8)] });
      const port = createCryptoPort(fake.transport);

      const bars = await port.history!({ instrument: BTC, timeframe: 60, from: T0, to: T0 + 2 * HOUR });

      expect(fake.histories).toEqual([{ series: BTC, timeframe: 60 }]);
      // Avant `from` et après `to` : écartées. Deux barres à T0 + 1 h : la dernière gagne.
      expect(bars).toEqual([bar(T0, 1), bar(T0 + HOUR, 5), bar(T0 + 2 * HOUR, 3)]);
    });

    it('rend des barres du moteur : les six champs de Bar, sans buyVolume, même quand il vaut NaN', async () => {
      const fake = fakeTransport();
      fake.replyHistory({ ok: true, bars: [row(T0, 100, { buyVolume: 4 }), row(T0 + 60, 101, { buyVolume: Number.NaN })] });
      const port = createCryptoPort(fake.transport);

      const bars = await port.history!({ instrument: BTC, timeframe: 1, from: 0, to: T0 + 60 });

      expect(bars).toEqual([bar(T0, 100), bar(T0 + 60, 101)]);
      for (const one of bars) expect(Object.keys(one).sort()).toEqual(['close', 'high', 'low', 'open', 'time', 'volume']);
    });

    it('garde les prix minuscules et énormes tels quels', async () => {
      const tiny: CryptoBar = { time: T0, open: 0.002163, high: 0.002171, low: 0.002158, close: 0.002163, volume: 1_250_000.5 };
      const huge: CryptoBar = { time: T0 + HOUR, open: 82_528.01, high: 82_901.5, low: 82_100, close: 82_528.5, volume: 0.00012 };
      const fake = fakeTransport();
      fake.replyHistory({ ok: true, bars: [tiny, huge] });
      const port = createCryptoPort(fake.transport);

      expect(await port.history!({ instrument: ONE, timeframe: 60, from: 0, to: T0 + HOUR })).toEqual([tiny, huge]);
    });

    it('écarte une barre dont un champ n’est pas un nombre fini : jamais de NaN dans l’historique', async () => {
      const broken: CryptoBar[] = [];
      for (const field of ['time', 'open', 'high', 'low', 'close', 'volume']) {
        for (const value of [Number.NaN, Infinity, -Infinity, undefined, null, '12']) broken.push({ ...row(T0 + 60, 5), [field]: value } as CryptoBar);
      }
      const fake = fakeTransport();
      fake.replyHistory({ ok: true, bars: [row(T0, 1), ...broken, row(T0 + 120, 2)] });
      const port = createCryptoPort(fake.transport);

      const bars = await port.history!({ instrument: BTC, timeframe: 1, from: 0, to: T0 + 3600 });

      expect(bars).toEqual([bar(T0, 1), bar(T0 + 120, 2)]);
      expect(bars.flatMap((one) => Object.values(one)).every((value) => Number.isFinite(value))).toBe(true);
    });

    it('rejette avec le détail du transport quand l’historique échoue', async () => {
      const fake = fakeTransport();
      fake.replyHistory({ ok: false, detail: 'rate_limited' });
      const port = createCryptoPort(fake.transport);

      const error = await rejection(port.history!({ instrument: BTC, timeframe: 60, from: 0, to: 1 }));

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('rate_limited');
    });

    it('refuse sans appeler le transport une série hors du registre ou un timeframe hors des six', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);

      for (const instrument of UNKNOWN_SERIES) {
        const error = await rejection(port.history!({ instrument, timeframe: 60, from: 0, to: 1 }));
        expect(error, instrument).toBeInstanceOf(Error);
        expect((error as Error).message, instrument).toContain(`Série crypto inconnue : ${instrument}`);
      }
      for (const timeframe of UNKNOWN_TIMEFRAMES) {
        const error = await rejection(port.history!({ instrument: BTC, timeframe, from: 0, to: 1 }));
        expect(error, String(timeframe)).toBeInstanceOf(Error);
        expect((error as Error).message, String(timeframe)).toContain(`Unité de temps crypto inconnue : ${timeframe}`);
      }
      expect(fake.histories).toEqual([]);
    });

    it('rejette une fois le port libéré, sans appeler le transport', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);
      port.dispose();

      const error = await rejection(port.history!({ instrument: BTC, timeframe: 60, from: 0, to: 1 }));

      expect((error as Error).message).toMatch(/libéré/);
      expect(fake.histories).toEqual([]);
    });
  });

  describe('subscribe', () => {
    it('barres : demande {series, bars, timeframe} au transport, dit live une fois accepté, puis rend les barres de la série et du timeframe', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);

      const { seen } = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      await flush();

      expect(fake.subscribes).toEqual([{ series: BTC, kind: 'bars', timeframe: 60 }]);
      expect(seen).toEqual([{ kind: 'status', state: 'live' }]);

      fake.emit(barEvent(BTC, 60, row(T0, 1, { buyVolume: 3 })));
      fake.emit(barEvent(BTC, 60, row(T0, 2), true));
      expect(data(seen)).toEqual([
        { kind: 'bar', instrument: BTC, timeframe: 60, bar: bar(T0, 1), final: false },
        { kind: 'bar', instrument: BTC, timeframe: 60, bar: bar(T0, 2), final: true },
      ]);
    });

    it('derniers prix : demande {series, ticker} sans timeframe, puis rend chaque ticker en quote (heure en millisecondes)', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);

      const first = listen(port, { instrument: ONE, kind: 'quote' });
      // Un timeframe du registre joint à un dernier prix est accepté mais ne part pas au transport.
      const second = listen(port, { instrument: ONE, kind: 'quote', timeframe: 5 });
      await flush();

      expect(fake.subscribes).toEqual([
        { series: ONE, kind: 'ticker' },
        { series: ONE, kind: 'ticker' },
      ]);
      expect(first.seen).toEqual([{ kind: 'status', state: 'live' }]);

      fake.emit(tickerEvent(ONE, 0.002163));
      expect(data(first.seen)).toEqual([{ kind: 'quote', quote: { instrument: ONE, time: NOW_MS, last: 0.002163 } }]);
      expect(data(second.seen)).toEqual(data(first.seen));
    });

    it('route chaque barre vers le seul abonné de sa série et de son timeframe, chaque ticker vers le seul abonné de son marché', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);
      const btc60 = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      const btc5 = listen(port, { instrument: BTC, kind: 'bars', timeframe: 5 });
      const ondo60 = listen(port, { instrument: ONDO, kind: 'bars', timeframe: 60 });
      const btcQuote = listen(port, { instrument: BTC, kind: 'quote' });
      const ondoQuote = listen(port, { instrument: ONDO, kind: 'quote' });
      await flush();

      fake.emit(barEvent(BTC, 60, row(T0, 1)));
      fake.emit(barEvent(BTC, 5, row(T0, 2)));
      fake.emit(barEvent(ONDO, 60, row(T0, 3)));
      fake.emit(tickerEvent(BTC, 4));
      fake.emit(tickerEvent(ONDO, 5));
      // Personne n’écoute ONE : ni sa barre ni son ticker n’atteignent quelqu’un.
      fake.emit(barEvent(ONE, 60, row(T0, 6)));
      fake.emit(tickerEvent(ONE, 7));

      expect(data(btc60.seen)).toEqual([barOut(BTC, 60, T0, 1)]);
      expect(data(btc5.seen)).toEqual([barOut(BTC, 5, T0, 2)]);
      expect(data(ondo60.seen)).toEqual([barOut(ONDO, 60, T0, 3)]);
      expect(data(btcQuote.seen)).toEqual([quoteOut(BTC, 4)]);
      expect(data(ondoQuote.seen)).toEqual([quoteOut(ONDO, 5)]);
    });

    it('rend un événement arrivé avant la réponse du transport : le flux peut précéder l’accusé', async () => {
      const fake = fakeTransport();
      const answer = holdSubscribes(fake);
      const port = createCryptoPort(fake.transport);

      const { seen } = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      fake.emit(barEvent(BTC, 60, row(T0, 1)));
      answer(0, { ok: true, subscriptionId: 'sub-1' });
      await flush();

      expect(seen).toEqual([barOut(BTC, 60, T0, 1), { kind: 'status', state: 'live' }]);
    });

    it('refuse un abonnement tick par un status error, sans appeler le transport', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);

      const { seen, stop } = listen(port, { instrument: BTC, kind: 'tick' });
      await flush();

      expect(seen).toEqual([{ kind: 'status', state: 'error', detail: expect.stringContaining('tick') }]);
      expect(fake.subscribes).toEqual([]);
      expect(fake.listening()).toBe(0);
      stop();
      await flush();
      expect(fake.unsubs).toEqual([]);
    });

    it('refuse par un status error, sans appeler le transport, une série hors du registre ou un timeframe hors des six', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);
      const refused: Array<[SubscribeRequest, string]> = [];
      for (const instrument of UNKNOWN_SERIES) {
        refused.push([{ instrument, kind: 'bars', timeframe: 60 }, `Série crypto inconnue : ${instrument}`]);
        refused.push([{ instrument, kind: 'quote' }, `Série crypto inconnue : ${instrument}`]);
      }
      for (const timeframe of UNKNOWN_TIMEFRAMES) refused.push([{ instrument: BTC, kind: 'bars', timeframe }, `Unité de temps crypto inconnue : ${timeframe}`]);
      // Une barre ne se construit pas sans timeframe ; un timeframe joint à un dernier prix doit lui aussi être du registre.
      refused.push([{ instrument: BTC, kind: 'bars' }, 'Unité de temps crypto inconnue : undefined']);
      refused.push([{ instrument: BTC, kind: 'quote', timeframe: 7 }, 'Unité de temps crypto inconnue : 7']);

      for (const [req, detail] of refused) {
        const { seen } = listen(port, req);
        await flush();
        expect(seen, JSON.stringify(req)).toEqual([{ kind: 'status', state: 'error', detail }]);
      }
      expect(fake.subscribes).toEqual([]);
      expect(fake.listening()).toBe(0);
    });

    it('annonce un refus après le retour de subscribe : l’appelant tient son Unsubscribe avant de le recevoir', async () => {
      const port = createCryptoPort(fakeTransport().transport);
      const seen: FeedEvent[] = [];

      port.subscribe!({ instrument: BTC, kind: 'tick' }, (event) => seen.push(event));
      expect(seen).toEqual([]);
      await flush();

      expect(seen).toHaveLength(1);
    });

    it('un abonnement refusé, lâché ou libéré avant l’annonce du refus n’émet rien', async () => {
      const port = createCryptoPort(fakeTransport().transport);

      const released = listen(port, { instrument: BTC, kind: 'tick' });
      released.stop();
      await flush();
      expect(released.seen).toEqual([]);

      const disposed = listen(port, { instrument: ONDO, kind: 'bars', timeframe: 3 });
      port.dispose();
      await flush();
      expect(disposed.seen).toEqual([]);
    });

    it('rend le refus du transport en status error avec son détail ; l’abonnement ne reçoit plus rien et n’a rien à désabonner', async () => {
      const fake = fakeTransport();
      fake.transport.subscribe = async (req) => {
        fake.subscribes.push({ ...req });
        return { ok: false, detail: 'crypto_disabled' };
      };
      const port = createCryptoPort(fake.transport);

      const { seen, stop } = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      await flush();

      expect(seen).toEqual([{ kind: 'status', state: 'error', detail: 'crypto_disabled' }]);
      expect(fake.listening()).toBe(0);
      fake.emit(barEvent(BTC, 60, row(T0, 1)));
      stop();
      await flush();
      expect(seen).toHaveLength(1);
      expect(fake.unsubs).toEqual([]);
    });

    it('rend en status error un transport qui rejette (une Error ou autre chose), au lieu de l’avaler', async () => {
      for (const failure of [new Error('ipc coupé'), 'ipc coupé']) {
        const fake = fakeTransport();
        fake.transport.subscribe = () => Promise.reject(failure);
        const port = createCryptoPort(fake.transport);

        const { seen } = listen(port, { instrument: BTC, kind: 'quote' });
        await flush();

        expect(seen).toEqual([{ kind: 'status', state: 'error', detail: 'ipc coupé' }]);
        expect(fake.listening()).toBe(0);
      }
    });

    it('ne rend jamais de NaN en direct : une barre ou un ticker qui ne tient pas est écarté, l’abonnement continue', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);
      const bars = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      const quotes = listen(port, { instrument: BTC, kind: 'quote' });
      await flush();

      for (const field of ['time', 'open', 'high', 'low', 'close', 'volume']) {
        for (const value of [Number.NaN, Infinity, undefined, '12']) fake.emit(barEvent(BTC, 60, { ...row(T0, 1), [field]: value } as CryptoBar));
      }
      fake.emit(tickerEvent(BTC, Number.NaN));
      fake.emit(tickerEvent(BTC, Infinity));
      fake.emit({ kind: 'ticker', ticker: { market: BTC, last: 5, change24hPct: null, time: Number.NaN } });
      expect(data(bars.seen)).toEqual([]);
      expect(data(quotes.seen)).toEqual([]);

      fake.emit(barEvent(BTC, 60, row(T0, 9)));
      fake.emit(tickerEvent(BTC, 10));
      expect(data(bars.seen)).toEqual([barOut(BTC, 60, T0, 9)]);
      expect(data(quotes.seen)).toEqual([quoteOut(BTC, 10)]);
    });

    it('désabonner lâche le transport une seule fois, coupe l’écoute, et laisse les autres abonnés de la même série', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);
      const first = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      const second = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      await flush();
      expect(fake.listening()).toBe(2);

      first.stop();
      expect(fake.unsubs).toEqual(['sub-1']);
      expect(fake.listening()).toBe(1);
      first.stop();
      first.stop();
      await flush();
      expect(fake.unsubs).toEqual(['sub-1']);

      fake.emit(barEvent(BTC, 60, row(T0, 1)));
      expect(data(first.seen)).toEqual([]);
      expect(data(second.seen)).toEqual([barOut(BTC, 60, T0, 1)]);
    });

    it('un abonné qui se lâche en recevant le statut live est tout de même désabonné du transport', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);
      let stop = (): void => undefined;

      stop = port.subscribe!({ instrument: BTC, kind: 'bars', timeframe: 60 }, (event) => {
        if (event.kind === 'status' && event.state === 'live') stop();
      });
      await flush();

      expect(fake.unsubs).toEqual(['sub-1']);
      expect(fake.listening()).toBe(0);
    });

    it('un abonné lâché par un autre pendant la distribution d’un événement ne reçoit plus rien', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);
      let dropSecond = (): void => undefined;
      const firstSeen: FeedEvent[] = [];
      port.subscribe!({ instrument: BTC, kind: 'bars', timeframe: 60 }, (event) => {
        firstSeen.push(event);
        if (event.kind === 'bar') dropSecond();
      });
      const second = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      dropSecond = second.stop;
      await flush();

      // Le transport distribue à une liste figée avant l’événement : la seconde écoute est encore dedans.
      fake.emit(barEvent(BTC, 60, row(T0, 1)));

      expect(data(firstSeen)).toEqual([barOut(BTC, 60, T0, 1)]);
      expect(data(second.seen)).toEqual([]);
      expect(fake.unsubs).toEqual(['sub-2']);
    });

    it('un désabonnement qui échoue ne lève pas et ne laisse aucune promesse rejetée', async () => {
      const fake = fakeTransport();
      fake.transport.unsubscribe = async () => {
        throw new Error('ipc coupé');
      };
      const port = createCryptoPort(fake.transport);
      const first = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      listen(port, { instrument: BTC, kind: 'quote' });
      await flush();

      const unhandled: unknown[] = [];
      const catcher = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', catcher);
      try {
        expect(() => first.stop()).not.toThrow();
        expect(() => port.dispose()).not.toThrow();
        await flush();
        await flush();
      } finally {
        process.off('unhandledRejection', catcher);
      }
      expect(unhandled).toEqual([]);
    });

    it('un transport qui répond après le désabonnement est lâché aussitôt, sans rien émettre', async () => {
      const fake = fakeTransport();
      const answer = holdSubscribes(fake);
      const port = createCryptoPort(fake.transport);

      const { seen, stop } = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      stop();
      fake.emit(barEvent(BTC, 60, row(T0, 1)));
      expect(fake.unsubs).toEqual([]);

      answer(0, { ok: true, subscriptionId: 'late-1' });
      await flush();
      expect(fake.unsubs).toEqual(['late-1']);
      expect(seen).toEqual([]);

      stop();
      await flush();
      expect(fake.unsubs).toEqual(['late-1']);
    });

    it('un transport qui répond après dispose est lâché aussitôt, sans rien émettre', async () => {
      const fake = fakeTransport();
      const answer = holdSubscribes(fake);
      const port = createCryptoPort(fake.transport);

      const { seen } = listen(port, { instrument: BTC, kind: 'quote' });
      port.dispose();
      answer(0, { ok: true, subscriptionId: 'late-2' });
      await flush();

      expect(fake.unsubs).toEqual(['late-2']);
      expect(seen).toEqual([]);
      expect(fake.listening()).toBe(0);
    });

    it('un refus du transport qui arrive après le désabonnement ne dit rien et n’a rien à lâcher', async () => {
      const fake = fakeTransport();
      const answer = holdSubscribes(fake);
      const port = createCryptoPort(fake.transport);

      const { seen, stop } = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      stop();
      answer(0, { ok: false, detail: 'crypto_disabled' });
      await flush();

      expect(seen).toEqual([]);
      expect(fake.unsubs).toEqual([]);
    });

    it('dispose, appelé deux fois, lâche chaque abonnement une seule fois ; ensuite plus rien ne passe', async () => {
      const fake = fakeTransport();
      const port = createCryptoPort(fake.transport);
      const btcBars = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      const btcQuote = listen(port, { instrument: BTC, kind: 'quote' });
      const ondoBars = listen(port, { instrument: ONDO, kind: 'bars', timeframe: 5 });
      await flush();
      // Déjà lâché par l’appelant : dispose ne le lâche pas une seconde fois.
      ondoBars.stop();

      port.dispose();
      port.dispose();
      await flush();
      expect([...fake.unsubs].sort()).toEqual(['sub-1', 'sub-2', 'sub-3']);
      expect(fake.listening()).toBe(0);

      btcBars.stop();
      btcQuote.stop();
      fake.emit(barEvent(BTC, 60, row(T0, 1)));
      fake.emit(tickerEvent(BTC, 2));
      await flush();
      expect(fake.unsubs).toHaveLength(3);
      expect(data(btcBars.seen)).toEqual([]);
      expect(data(btcQuote.seen)).toEqual([]);

      const after = listen(port, { instrument: BTC, kind: 'bars', timeframe: 60 });
      await flush();
      expect(after.seen).toEqual([]);
      expect(fake.subscribes).toHaveLength(3);
      expect(fake.listening()).toBe(0);
      expect(() => after.stop()).not.toThrow();
    });
  });
});

describe('renderer seulement', () => {
  it('n’est pas émis pour le process principal et n’importe que le moteur', () => {
    const config = JSON.parse(readFileSync('electron/tsconfig.sources.json', 'utf8')) as { files: string[] };
    expect(config.files).not.toContain('../src/engine/crypto/port.ts');
    expect(existsSync('electron/crypto/port.d.ts')).toBe(false);
    expect(readFileSync('vitest.config.mts', 'utf8')).not.toContain("'crypto/port'");

    const source = readFileSync('src/engine/crypto/port.ts', 'utf8');
    const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
    expect(specifiers).toContain('./markets');
    expect(specifiers).toContain('@/engine/marketdata/port');
    expect(specifiers.filter((s) => !/^(@\/engine\/|\.\/)/.test(s))).toEqual([]);
    // `bars.ts` tire l’i18n et le CSV : seul le type `Bar` en vient.
    expect(source).toMatch(/^import type \{[^}]*\} from '@\/engine\/bars';/m);
    expect(source).not.toMatch(/^import (?!type\b)[^;]*from '@\/engine\/bars'/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
