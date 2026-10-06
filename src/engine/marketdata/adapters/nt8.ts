/**
 * Port `nt8-bridge`. Le renderer ne voit pas le socket : le transport est injecté
 * (IPC `marketdata:*` côté desk, faux transport dans les tests).
 */
import type { Bar } from '../../bars';
import { resolveSymbol } from '../../instruments';
import { dedupeBars, type FeedEvent, type HistoryRequest, type MarketDataPort, type SubscribeRequest, type Unsubscribe } from '../port';

export interface Nt8Transport {
  subscribe(req: SubscribeRequest): Promise<{ ok: true; subscriptionId: string } | { ok: false; detail: string }>;
  unsubscribe(id: string): Promise<{ ok: boolean }>;
  history(req: HistoryRequest): Promise<{ ok: true; bars: Bar[] } | { ok: false; detail: string }>;
  onEvent(cb: (event: FeedEvent) => void): Unsubscribe;
}

interface HeldBar {
  bar: Bar;
  final: boolean;
}

/**
 * NinjaTrader date une barre temporelle à sa **clôture** (la barre 9:30–9:35 porte 9:35). Le desk,
 * comme lightweight-charts et les indicateurs (Opening Range, VWAP), date une barre à son
 * **ouverture**. Une barre de `timeframe` minutes recule donc d'autant à l'entrée dans le desk.
 */
export function ntBarToOpenTime(bar: Bar, timeframeMin: number | undefined): Bar {
  if (!timeframeMin || timeframeMin <= 0) return bar;
  return { ...bar, time: bar.time - timeframeMin * 60 };
}

function normName(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Le flux reçu est-il celui demandé ? L'AddOn 2.2.0 renvoie `Instrument.FullName` (`NQ 12-26`), pas le
 * texte de la demande : on compare le contrat, pas la chaîne. Même nom à la casse et aux espaces près ;
 * sinon même racine du registre, et même échéance si la demande en porte une (une racine seule suit
 * tout contrat de cette racine).
 */
export function sameContract(requested: string, received: string): boolean {
  const wanted = normName(requested);
  const got = normName(received);
  if (wanted === got) return true;
  const asked = resolveSymbol(wanted);
  const seen = resolveSymbol(got);
  return !!asked && !!seen && asked.symbol === seen.symbol && (!asked.contractMonth || asked.contractMonth === seen.contractMonth);
}

export function createNt8Port(transport: Nt8Transport): MarketDataPort {
  let disposed = false;
  const stops: Unsubscribe[] = [];
  const books = new Map<string, Map<number, HeldBar>>();

  const port: MarketDataPort = {
    sourceId: 'nt8-bridge',
    capabilities: { history: true, live: ['bars', 'tick', 'quote'], instruments: 'any' },
    async history(req) {
      if (disposed) throw new Error('Port libéré');
      const res = await transport.history(req);
      if (!res.ok) throw new Error(res.detail);
      return dedupeBars(res.bars.map((bar) => ntBarToOpenTime(bar, req.timeframe)).filter((bar) => bar.time >= req.from && bar.time <= req.to));
    },
    subscribe(req, onEvent) {
      if (disposed) return () => {};
      let subscriptionId: string | null = null;
      let closed = false;
      const bookKey = `${req.instrument}|${req.timeframe ?? 0}|${req.kind}`;
      let book = books.get(bookKey);
      if (!book) {
        book = new Map();
        books.set(bookKey, book);
      }
      const stopListen = transport.onEvent((event) => {
        if (closed || disposed) return;
        if (event.kind === 'status') {
          onEvent(event);
          return;
        }
        if (event.kind === 'bar') {
          if (!sameContract(req.instrument, event.instrument) || (req.timeframe !== undefined && event.timeframe !== req.timeframe)) return;
          const opened = ntBarToOpenTime(event.bar, event.timeframe);
          const accepted = acceptBar(book!, opened, event.final);
          if (accepted) onEvent({ kind: 'bar', instrument: event.instrument, timeframe: event.timeframe, bar: accepted, final: event.final && book!.get(opened.time)?.final === true });
          return;
        }
        if (event.kind === 'tick' && sameContract(req.instrument, event.tick.instrument)) onEvent(event);
        if (event.kind === 'quote' && sameContract(req.instrument, event.quote.instrument)) onEvent(event);
      });
      void transport.subscribe(req).then((res) => {
        if (closed || disposed) {
          if (res.ok) void transport.unsubscribe(res.subscriptionId);
          return;
        }
        if (!res.ok) {
          onEvent({ kind: 'status', state: 'error', detail: res.detail });
          return;
        }
        subscriptionId = res.subscriptionId;
        onEvent({ kind: 'status', state: 'live' });
      });
      const stop = () => {
        if (closed) return;
        closed = true;
        stopListen();
        if (subscriptionId) void transport.unsubscribe(subscriptionId);
      };
      stops.push(stop);
      return stop;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of stops) stop();
      stops.length = 0;
    },
  };
  return port;
}

/** `final: true` est immuable. Une barre non finale de même `time` est remplacée. */
function acceptBar(book: Map<number, HeldBar>, bar: Bar, final: boolean): Bar | null {
  const prev = book.get(bar.time);
  if (prev?.final) return null;
  book.set(bar.time, { bar, final });
  return bar;
}
