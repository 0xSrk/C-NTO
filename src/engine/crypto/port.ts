/**
 * Port `crypto` du moteur : l'historique, les bougies et les derniers prix des exchanges, lus comme n'importe quelle
 * source de marché (`MarketDataPort`), par le store comme par l'agent. Le renderer ne voit ni socket ni exchange : le
 * transport est injecté (IPC `crypto:*` côté desk, faux transport dans les tests), comme celui du pont NT8
 * (`marketdata/adapters/nt8.ts`).
 *
 * - `history` : `instrument` est l'identifiant de série du registre (`coinbase:BTC-USD`), `timeframe` l'un des six
 *   du chart, en minutes. Le transport rend les dernières bougies de la venue ; le port garde celles de `[from, to]`
 *   (secondes UTC, bornes comprises), triées, une seule par instant (la dernière gagne).
 * - `subscribe` : `bars` suit une série à un timeframe, `quote` le dernier prix d'un marché (le ticker du transport,
 *   `time` en millisecondes) ; `tick` n'existe pas en crypto. Le process principal pousse ses événements sans
 *   identifiant d'abonnement : chaque abonnement ne reçoit que ceux de sa série et de son timeframe (barres) ou de son
 *   marché (tickers), et plus rien une fois lâché.
 * - Un `Bar` a six champs : `buyVolume` (volume acheteur, pour le CVD) n'en fait pas partie, qui en a besoin lit les
 *   bougies du transport. Une bougie ou un prix dont un nombre n'est pas fini est écarté : jamais de NaN en sortie.
 * - Une demande hors du registre (série, timeframe) est refusée sans toucher au transport. Un refus ou un échec de
 *   l'abonnement arrive en `status` `error`, après le retour de `subscribe` comme tout statut de ce port ; les motifs
 *   du transport passent tels quels (codes du process principal : `crypto_disabled`, `blocked`, `rate_limited`…).
 */
import type { Bar } from '@/engine/bars';
import { dedupeBars, type MarketDataPort, type SubscribeRequest, type Unsubscribe } from '@/engine/marketdata/port';
import { CRYPTO_MARKETS, isCryptoSeriesId, isCryptoTimeframe, type CryptoBar, type CryptoFeedEvent, type CryptoSeriesId, type CryptoTimeframe } from './markets';

export interface CryptoTransport {
  history(req: { series: CryptoSeriesId; timeframe: CryptoTimeframe }): Promise<{ ok: true; bars: CryptoBar[] } | { ok: false; detail: string }>;
  subscribe(req: { series: CryptoSeriesId; kind: 'ticker' | 'bars'; timeframe?: CryptoTimeframe }): Promise<{ ok: true; subscriptionId: string } | { ok: false; detail: string }>;
  unsubscribe(id: string): Promise<{ ok: boolean }>;
  onEvent(cb: (e: CryptoFeedEvent) => void): () => void;
}

type SubscribeReply = Awaited<ReturnType<CryptoTransport['subscribe']>>;
type TransportRequest = Parameters<CryptoTransport['subscribe']>[0];

const unknownSeries = (instrument: string): string => `Série crypto inconnue : ${instrument}`;
const unknownTimeframe = (timeframe: number | undefined): string => `Unité de temps crypto inconnue : ${timeframe}`;
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Une bougie du moteur : les six champs de `Bar`, ou `null` si l'un n'est pas un nombre fini. */
function toBar(row: CryptoBar): Bar | null {
  const { time, open, high, low, close, volume } = row;
  return [time, open, high, low, close, volume].every(Number.isFinite) ? { time, open, high, low, close, volume } : null;
}

/** La demande telle que le transport l'attend, ou le motif pour lequel ce port ne la sert pas. */
function toTransportRequest(req: SubscribeRequest): { ok: true; request: TransportRequest } | { ok: false; detail: string } {
  if (req.kind !== 'bars' && req.kind !== 'quote') return { ok: false, detail: `Flux crypto non pris en charge : ${req.kind}` };
  const { instrument, timeframe } = req;
  if (!isCryptoSeriesId(instrument)) return { ok: false, detail: unknownSeries(instrument) };
  if (req.kind === 'quote') {
    // Un dernier prix n'a pas d'unité de temps : celle qu'on y joint doit pourtant être du registre, et ne part pas.
    return timeframe === undefined || isCryptoTimeframe(timeframe)
      ? { ok: true, request: { series: instrument, kind: 'ticker' } }
      : { ok: false, detail: unknownTimeframe(timeframe) };
  }
  return isCryptoTimeframe(timeframe) ? { ok: true, request: { series: instrument, kind: 'bars', timeframe } } : { ok: false, detail: unknownTimeframe(timeframe) };
}

export function createCryptoPort(transport: CryptoTransport): MarketDataPort {
  let disposed = false;
  /** Les abonnements ouverts ; chacun se retire en se fermant. */
  const active = new Set<Unsubscribe>();

  /** Rend le flux au process principal. Un échec ne se rattrape pas : il ne doit ni lever, ni laisser une promesse rejetée. */
  const release = (id: string): void => {
    void (async () => {
      try {
        await transport.unsubscribe(id);
      } catch {
        // Rien à rattraper : à la fermeture de la fenêtre, le process principal ferme de lui-même les flux restants.
      }
    })();
  };

  return {
    sourceId: 'crypto',
    capabilities: { history: true, live: ['bars', 'quote'], instruments: CRYPTO_MARKETS.map((m) => m.id) },
    async history(req) {
      if (disposed) throw new Error('Port crypto libéré');
      const { instrument, timeframe } = req;
      if (!isCryptoSeriesId(instrument)) throw new Error(unknownSeries(instrument));
      if (!isCryptoTimeframe(timeframe)) throw new Error(unknownTimeframe(timeframe));
      const res = await transport.history({ series: instrument, timeframe });
      if (!res.ok) throw new Error(res.detail);
      const bars: Bar[] = [];
      for (const row of res.bars) {
        const bar = toBar(row);
        if (bar && bar.time >= req.from && bar.time <= req.to) bars.push(bar);
      }
      return dedupeBars(bars);
    },
    subscribe(req, onEvent) {
      if (disposed) return () => {};
      let closed = false;
      const wanted = toTransportRequest(req);
      if (!wanted.ok) {
        // Annoncé après le retour de `subscribe` : l'appelant tient alors son `Unsubscribe`, et peut encore le lâcher.
        queueMicrotask(() => {
          if (!closed && !disposed) onEvent({ kind: 'status', state: 'error', detail: wanted.detail });
        });
        return () => {
          closed = true;
        };
      }

      const { request } = wanted;
      let subscriptionId: string | null = null;
      // L'écoute précède la demande : le flux peut devancer la réponse du transport.
      const stopListening = transport.onEvent((event) => {
        if (closed) return;
        if (event.kind === 'bar') {
          if (request.kind !== 'bars' || event.series !== request.series || event.timeframe !== request.timeframe) return;
          const bar = toBar(event.bar);
          if (bar) onEvent({ kind: 'bar', instrument: event.series, timeframe: event.timeframe, bar, final: event.final === true });
        } else if (event.kind === 'ticker') {
          const { market, last, time } = event.ticker;
          if (request.kind !== 'ticker' || market !== request.series) return;
          if (Number.isFinite(last) && Number.isFinite(time)) onEvent({ kind: 'quote', quote: { instrument: market, time, last } });
        }
      });
      const stop: Unsubscribe = () => {
        if (closed) return;
        closed = true;
        stopListening();
        active.delete(stop);
        if (subscriptionId !== null) release(subscriptionId);
      };
      active.add(stop);

      void (async () => {
        let reply: SubscribeReply;
        try {
          reply = await transport.subscribe(request);
        } catch (error) {
          reply = { ok: false, detail: reason(error) };
        }
        if (closed) {
          // Lâché (ou port libéré) avant la réponse : le flux que le transport vient d'ouvrir, personne ne l'attend.
          if (reply.ok) release(reply.subscriptionId);
          return;
        }
        if (!reply.ok) {
          stop();
          onEvent({ kind: 'status', state: 'error', detail: reply.detail });
          return;
        }
        subscriptionId = reply.subscriptionId;
        onEvent({ kind: 'status', state: 'live' });
      })();
      return stop;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of [...active]) stop();
    },
  };
}
