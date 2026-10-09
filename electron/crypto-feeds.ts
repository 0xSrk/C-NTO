import {
  cryptoMarket,
  isCryptoTimeframe,
  type CryptoBar,
  type CryptoFeedEvent,
  type CryptoSeriesId,
  type CryptoTimeframe,
  type CryptoTrade,
  type CryptoVenue,
  type VenueState,
} from './crypto/markets';
import { TradeBarBuilder } from './crypto/tradeBars';
import { HISTORY_BARS, aggregateBars, historyRequests, parseCandles, parseWsMessage, streamKeys, subscribeMessage, wsUrl, type WsParsed } from './crypto/venues';
import { VenueHttpError, type VenueGate } from './crypto-net';
import { ManagedSocket, errorText, safeText, type Timers, type WsFactory } from './crypto-socket';

export { BYBIT_PING_EVERY_MS, ManagedSocket, PING_EVERY_MS, RECONNECT_MAX_MS, STALE_AFTER_MS } from './crypto-socket';
export type { ManagedSocketOptions, Timers, WsFactory, WsLike } from './crypto-socket';

/**
 * Les flux des trois venues, côté process principal (`docs/ONGLET-CRYPTO.md` § 5, « Marchés et données »).
 * Une socket par venue (`ManagedSocket`, `electron/crypto-socket.ts`), ouverte au premier abonnement et fermée au
 * dernier ; un compteur de références par clé de flux, pour ne demander une clé qu'une fois et ne la rendre qu'au
 * dernier désabonnement ; à chaque ouverture, toutes les clés actives redemandées. Les tickers et les bougies de
 * Binance passent tels quels ; Coinbase et Bybit n'ont pas de flux de bougies : elles sont construites depuis les
 * trades (`TradeBarBuilder`). L'historique passe par le fetch gardé injecté (`cryptoFetchJson` en CRY2.5) et par la
 * porte de la venue. Aucun import d'Electron ni de `ws`, aucun minuteur ni horloge globaux : tout est injecté.
 */

/** Marge ajoutée au premier message confirmé d'un abonnement de bougies construites depuis les trades. */
const CONFIRM_MARGIN_MS = 1_000;
/** Le ping applicatif que Bybit demande toutes les 20 s. */
const BYBIT_APP_PING = '{"op":"ping"}';
/** Demandes gardées au plus en attente de réponse sur une connexion. */
const PENDING_MAX = 64;
const DAY_SECONDS = 86_400;
/** Borne d'une ligne de journal. */
const LINE_MAX = 400;

export interface CryptoFeedDeps {
  ws: WsFactory;
  hostOk: (url: string) => boolean;
  timers: Timers;
  now: () => number;
  gate: VenueGate;
  fetchJson: (url: string) => Promise<unknown>;
  emit: (e: CryptoFeedEvent) => void;
  status: (venue: CryptoVenue, state: VenueState) => void;
  log: (l: string) => void;
  /** L'URL de la socket d'une venue ; `wsUrl` par défaut (un serveur local dans les tests). */
  urlFor?: (venue: CryptoVenue) => string;
}

type SubscribeResult = { ok: true; subscriptionId: string } | { ok: false; detail: string };
type HistoryResult = { ok: true; bars: CryptoBar[] } | { ok: false; detail: string };

/** Une demande d'abonnement ou de désabonnement envoyée sur la connexion courante, sans réponse encore. */
interface Pending {
  id: number;
  keys: readonly string[];
  on: boolean;
}

interface VenueLine {
  socket: ManagedSocket | null;
  /** Clés de flux voulues, et le nombre d'abonnements qui tiennent chacune. */
  keys: Map<string, number>;
  /** Demandes envoyées sur la connexion courante, dans l'ordre, en attente d'un accusé ou d'un refus. */
  pending: Pending[];
  /** La venue a refusé tout ce qu'on lui demandait : socket fermée, venue `blocked` jusqu'au prochain abonnement. */
  refused: boolean;
  /** Dernier état remonté par `status`. */
  reported: VenueState;
}

interface Subscription {
  id: string;
  venue: CryptoVenue;
  series: CryptoSeriesId;
  kind: 'ticker' | 'bars';
  timeframe: CryptoTimeframe | null;
  keys: readonly string[];
  /** Bougies construites ici depuis les trades : Coinbase et Bybit. */
  fromTrades: boolean;
  builder: TradeBarBuilder | null;
  /** En attente de confirmation sur la connexion courante. */
  awaiting: boolean;
  /**
   * Les demandes d'abonnement en attente qui portent ses clés : l'accusé de la dernière le confirme. La première trame de
   * son propre flux le confirme aussi (`confirmOwn`) ; vide, ses clés étaient déjà actives et accusées.
   */
  waitingFor: Set<number>;
  /** Refusé par la venue : ses clés sont rendues et il n'est plus jamais redemandé. */
  refused: boolean;
}

function record(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Vrai si le message est l'accusé d'une demande : Coinbase `subscriptions`, Binance `{ result, id }`, Bybit `success: true` d'un `subscribe` ou `unsubscribe`. */
function isAck(venue: CryptoVenue, raw: string): boolean {
  const reply = record(raw);
  if (reply === null) return false;
  switch (venue) {
    case 'coinbase':
      return reply.type === 'subscriptions';
    case 'binance':
      return Object.prototype.hasOwnProperty.call(reply, 'result') && typeof reply.id === 'number';
    case 'bybit':
      return reply.success === true && (reply.op === 'subscribe' || reply.op === 'unsubscribe');
    default:
      return false;
  }
}

/** L'identifiant de demande qu'une réponse Binance rappelle (`id`), ou `null`. */
function replyId(raw: string): number | null {
  const id = record(raw)?.id;
  return typeof id === 'number' && Number.isSafeInteger(id) ? id : null;
}

/** Vrai si le seau de `timeMs` n'a pas plus d'un seau d'avance sur celui de `nowMs` : une horloge un peu en retard est tolérée. */
function withinOneBucket(timeMs: number, timeframe: CryptoTimeframe, nowMs: number): boolean {
  const span = timeframe * 60_000;
  return Math.floor(timeMs / span) <= Math.floor(nowMs / span) + 1;
}

/**
 * La fenêtre gardée d'un historique, coupée par l'heure et jamais par le nombre : les bougies dont
 * `time >= min(00:00 UTC de la veille, seau courant − (HISTORY_BARS − 1) × pas)`, jusqu'au seau qui suit le seau courant.
 * Une bascule de seau pendant la pagination rend une bougie de plus, en fin de série : elle reste, et la bougie de
 * 00:00 UTC de la veille aussi. Une bougie datée de plus d'un seau en avance est écartée.
 */
function keepWindow(bars: readonly CryptoBar[], timeframe: CryptoTimeframe, nowSec: number): CryptoBar[] {
  const step = timeframe * 60;
  const current = Math.floor(nowSec / step) * step;
  const dayBefore = (Math.floor(nowSec / DAY_SECONDS) - 1) * DAY_SECONDS;
  const from = Math.min(dayBefore, current - (HISTORY_BARS - 1) * step);
  return bars.filter((bar) => bar.time >= from && bar.time <= current + step);
}

/**
 * Les flux et l'historique des trois venues. `subscribe` rend un identifiant (`sub-<n>`) ou refuse `unknown_stream`
 * (série, genre ou timeframe que `streamKeys` ne sert pas) ; `unsubscribe` dit si l'identifiant était connu.
 * Événements : un ticker suivi → `{ kind: 'ticker' }` ; une bougie Binance suivie → `{ kind: 'bar', final }` ; un trade
 * Coinbase ou Bybit → le `TradeBarBuilder` de chaque abonnement `bars` du marché, une bougie émise par timeframe.
 * Le constructeur d'un abonnement naît à la confirmation de cet abonnement sur la connexion courante, avec
 * `startedAtMs` = cet instant + 1 s, et renaît à chaque reconnexion : une bougie entamée avant que son flux ne soit
 * effectif, ou qui chevauche une coupure, n'est jamais marquée complète. Confirment un abonnement : l'accusé de la venue
 * pour la demande qui porte ses clés (la dernière, s'il en attend plusieurs) ; ou la première trame de son propre flux
 * (un trade de son marché, son ticker, sa bougie Binance), sauf quand une de ses clés attend encore un désabonnement sur
 * la connexion (la trame peut venir de l'activation précédente du flux). Une trame d'un autre flux, même du même marché
 * (heartbeat, ticker), ne confirme rien. Un trade ou une bougie Binance datés de plus d'un seau en avance sur `now()`
 * sont écartés.
 * Une demande refusée par la venue (Coinbase `error`, Bybit `success: false`, Binance `{ error }`, que Binance fait
 * suivre d'une fermeture 1008) est journalisée ; les abonnements qu'elle portait sont abandonnés et jamais
 * redemandés, si bien qu'une reconnexion ne boucle pas sur une clé refusée.
 * Jamais de socket sans flux : quand plus aucun abonnement actif ne reste sur une venue (désabonnement, refus, ou
 * ouverture sans clé), la socket ferme ; la venue passe `blocked` s'il reste des abonnements refusés, `off` sinon.
 * Une venue que sa porte bloque (418, REST ou socket) reste `blocked` jusqu'au redémarrage, même sans abonnement.
 */
export class CryptoFeedHost {
  private readonly lines = new Map<CryptoVenue, VenueLine>();
  private readonly subs = new Map<string, Subscription>();
  private nextSub = 0;
  private nextRequest = 0;
  /** Change à chaque `closeAll` : un historique en route s'arrête à sa page. */
  private generation = 0;
  private emitFailing = false;

  constructor(private readonly deps: CryptoFeedDeps) {}

  subscribe(req: { series: CryptoSeriesId; kind: 'ticker' | 'bars'; timeframe?: CryptoTimeframe }): SubscribeResult {
    const market = typeof req?.series === 'string' ? cryptoMarket(req.series) : undefined;
    const kind = req?.kind;
    if (market === undefined || (kind !== 'ticker' && kind !== 'bars')) return { ok: false, detail: 'unknown_stream' };
    const timeframe = kind === 'bars' && isCryptoTimeframe(req.timeframe) ? req.timeframe : null;
    // Coinbase et Bybit ont une clé de trades sans timeframe, mais une bougie ne se construit pas sans lui.
    if (kind === 'bars' && timeframe === null) return { ok: false, detail: 'unknown_stream' };
    const keys = streamKeys(market.id, kind, timeframe ?? undefined);
    if (keys.length === 0) return { ok: false, detail: 'unknown_stream' };

    const { venue } = market;
    this.nextSub += 1;
    const sub: Subscription = {
      id: `sub-${this.nextSub}`,
      venue,
      series: market.id,
      kind,
      timeframe,
      keys,
      fromTrades: kind === 'bars' && venue !== 'binance',
      builder: null,
      awaiting: false,
      waitingFor: new Set(),
      refused: false,
    };
    this.subs.set(sub.id, sub);
    const line = this.line(venue);
    const fresh: string[] = [];
    for (const key of keys) {
      const count = line.keys.get(key) ?? 0;
      line.keys.set(key, count + 1);
      if (count === 0) fresh.push(key);
    }
    if (line.socket === null) {
      this.openSocket(venue, line);
    } else if (line.socket.state === 'live') {
      this.request(venue, line, fresh, true);
      this.expect(sub, line);
    }
    return { ok: true, subscriptionId: sub.id };
  }

  unsubscribe(id: string): boolean {
    const sub = typeof id === 'string' ? this.subs.get(id) : undefined;
    if (sub === undefined) return false;
    this.subs.delete(id);
    const line = this.line(sub.venue);
    const gone: string[] = [];
    if (!sub.refused) {
      for (const key of sub.keys) {
        const count = line.keys.get(key);
        if (count === undefined) continue;
        if (count > 1) {
          line.keys.set(key, count - 1);
        } else {
          line.keys.delete(key);
          gone.push(key);
        }
      }
    }
    // Plus aucun flux à suivre : la socket ferme, rien à désabonner sur une connexion qui s'en va.
    if (!this.closeIfIdle(sub.venue, line)) this.request(sub.venue, line, gone, false);
    return true;
  }

  /**
   * L'historique d'une série : refusé `blocked` si la porte de la venue est bloquée, `rate_limited` si elle est en
   * pause (avant chaque page), `no_history` s'il n'y a rien à demander ; pages récupérées l'une après l'autre, chacune
   * lue par `parseCandles` (une page en erreur fait échouer la requête, avec un détail borné), regroupées si besoin
   * (`aggregateBars(bars, timeframe / aggregate, aggregate)`), puis coupées par l'heure (`keepWindow`). Un 429 ou un 418
   * passe par la porte ; un 418 coupe aussi la socket de la venue ; seule une page lue sans erreur compte comme un
   * succès pour la porte (`onSuccess`). Après `closeAll`, la requête s'arrête (`closed`).
   */
  async history(req: { series: CryptoSeriesId; timeframe: CryptoTimeframe }): Promise<HistoryResult> {
    const generation = this.generation;
    const market = typeof req?.series === 'string' ? cryptoMarket(req.series) : undefined;
    const timeframe = req?.timeframe;
    if (market === undefined || !isCryptoTimeframe(timeframe)) return { ok: false, detail: 'no_history' };
    const { venue } = market;
    const nowSec = this.deps.now() / 1000;
    const { urls, aggregate } = historyRequests(market.id, timeframe, nowSec);
    if (urls.length === 0) return { ok: false, detail: 'no_history' };
    const received: CryptoBar[] = [];
    for (const url of urls) {
      const closedGate = this.gateRefusal(venue);
      if (closedGate !== null) return this.historyFailed(venue, market.id, timeframe, closedGate);
      let json: unknown;
      try {
        json = await this.deps.fetchJson(url);
      } catch (error) {
        const detail = this.fetchFailure(venue, error);
        if (generation !== this.generation) return { ok: false, detail: 'closed' };
        return this.historyFailed(venue, market.id, timeframe, detail);
      }
      if (generation !== this.generation) return { ok: false, detail: 'closed' };
      try {
        for (const bar of parseCandles(venue, json)) received.push(bar);
      } catch (error) {
        // Une page refusée par la venue (Bybit `retCode`) n'est pas un succès : le backoff de la porte reste où il est.
        return this.historyFailed(venue, market.id, timeframe, errorText(error));
      }
      this.deps.gate.onSuccess(venue);
    }
    const bars = aggregateBars(received, (timeframe / aggregate) as CryptoTimeframe, aggregate);
    return { ok: true, bars: keepWindow(bars, timeframe, nowSec) };
  }

  states(): Record<CryptoVenue, VenueState> {
    return { coinbase: this.stateOf('coinbase'), binance: this.stateOf('binance'), bybit: this.stateOf('bybit') };
  }

  /** Toutes les sockets fermées, tous les abonnements oubliés, aucun minuteur vivant ; l'hôte reste utilisable. */
  closeAll(): void {
    this.generation += 1;
    this.subs.clear();
    for (const [venue, line] of this.lines) {
      line.keys.clear();
      this.shut(venue, line, false);
    }
  }

  private line(venue: CryptoVenue): VenueLine {
    let line = this.lines.get(venue);
    if (line === undefined) {
      line = { socket: null, keys: new Map(), pending: [], refused: false, reported: 'off' };
      this.lines.set(venue, line);
    }
    return line;
  }

  private openSocket(venue: CryptoVenue, line: VenueLine): void {
    line.refused = false;
    line.pending = [];
    let url = '';
    try {
      url = this.deps.urlFor ? this.deps.urlFor(venue) : wsUrl(venue);
    } catch {
      url = ''; // refusée par hostOk : la venue passe blocked
    }
    const socket: ManagedSocket = new ManagedSocket({
      url,
      venue,
      ws: this.deps.ws,
      hostOk: this.deps.hostOk,
      timers: this.deps.timers,
      now: this.deps.now,
      gate: this.deps.gate,
      onMessage: (raw) => {
        if (line.socket === socket) this.onMessage(venue, line, raw);
      },
      onState: () => {
        if (line.socket === socket) this.publish(venue);
      },
      onOpen: () => {
        if (line.socket === socket) this.resubscribe(venue, line);
      },
      appPing: venue === 'bybit' ? () => BYBIT_APP_PING : undefined,
      log: (text) => this.log(text),
    });
    line.socket = socket;
    socket.open();
  }

  /** Ferme la socket de la venue sans reconnexion ; `refused` : la venue a refusé tout ce qui était suivi. */
  private shut(venue: CryptoVenue, line: VenueLine, refused: boolean): void {
    const socket = line.socket;
    line.socket = null;
    line.pending = [];
    line.refused = refused;
    socket?.close();
    this.publish(venue);
  }

  /**
   * À chaque ouverture : toutes les clés actives redemandées en une demande, et chaque abonnement attend son accusé
   * (constructeurs remis à zéro : des trades ont pu manquer). Une ouverture sans clé à suivre ferme la socket.
   */
  private resubscribe(venue: CryptoVenue, line: VenueLine): void {
    line.pending = [];
    if (this.closeIfIdle(venue, line)) return;
    this.request(venue, line, [...line.keys.keys()], true);
    for (const sub of this.subs.values()) if (sub.venue === venue && !sub.refused) this.expect(sub, line);
  }

  /**
   * Plus aucun abonnement actif sur la venue (ou plus aucune clé) : la socket ferme, jamais de socket sans flux. La venue
   * passe `blocked` s'il lui reste des abonnements refusés, `off` sinon. Vrai si la venue a été fermée.
   */
  private closeIfIdle(venue: CryptoVenue, line: VenueLine): boolean {
    if (line.keys.size > 0 && this.follows(venue, () => true)) return false;
    line.keys.clear();
    this.shut(venue, line, [...this.subs.values()].some((sub) => sub.venue === venue && sub.refused));
    return true;
  }

  /**
   * L'abonnement attend sa confirmation sur la connexion courante : l'accusé de chaque demande en attente qui porte ses
   * clés (celle qui vient de partir pour lui, ou une plus ancienne pour une clé partagée), ou la première trame de son
   * propre flux (`confirmOwn`).
   */
  private expect(sub: Subscription, line: VenueLine): void {
    sub.awaiting = true;
    sub.builder = null;
    sub.waitingFor = new Set(line.pending.filter((request) => request.on && request.keys.some((key) => sub.keys.includes(key))).map((request) => request.id));
  }

  /** Confirmé à `at` : un abonnement de trades reçoit son constructeur, `startedAtMs` = `at` + 1 s. */
  private confirm(sub: Subscription, at: number): void {
    sub.awaiting = false;
    sub.waitingFor.clear();
    if (sub.fromTrades && sub.timeframe !== null) sub.builder = new TradeBarBuilder(sub.timeframe, at + CONFIRM_MARGIN_MS);
  }

  /** L'accusé d'une demande d'abonnement : les abonnements qui n'attendaient plus qu'elle sont confirmés. */
  private acknowledge(venue: CryptoVenue, id: number, at: number): void {
    for (const sub of this.subs.values()) {
      if (sub.venue !== venue || !sub.awaiting || sub.refused || !sub.waitingFor.delete(id)) continue;
      if (sub.waitingFor.size === 0) this.confirm(sub, at);
    }
  }

  /**
   * Une trame de son propre flux confirme un abonnement : sur une activation neuve, la venue ne l'envoie qu'après avoir
   * traité la demande. Sauf quand une de ses clés attend encore un désabonnement sur cette connexion : la trame peut
   * venir de l'activation précédente de son flux, et seul l'accusé de sa propre demande le confirmera.
   */
  private confirmOwn(venue: CryptoVenue, line: VenueLine, at: number, own: (sub: Subscription) => boolean): void {
    for (const sub of this.subs.values()) {
      if (sub.venue !== venue || !sub.awaiting || sub.refused || !own(sub)) continue;
      if (line.pending.some((request) => !request.on && request.keys.some((key) => sub.keys.includes(key)))) continue;
      this.confirm(sub, at);
    }
  }

  private request(venue: CryptoVenue, line: VenueLine, keys: readonly string[], on: boolean): void {
    const socket = line.socket;
    if (socket === null || socket.state !== 'live' || keys.length === 0) return;
    this.nextRequest += 1;
    const id = this.nextRequest;
    const message = subscribeMessage(venue, keys, on, id);
    if (message === '') return;
    line.pending.push({ id, keys: [...keys], on });
    if (line.pending.length > PENDING_MAX) line.pending.shift();
    socket.send(message);
  }

  private onMessage(venue: CryptoVenue, line: VenueLine, raw: string): void {
    const parsed = parseWsMessage(venue, raw);
    const at = this.deps.now();
    for (const item of parsed) {
      if (item.kind === 'error') {
        this.refusal(venue, line, item.detail, raw);
      } else if (item.kind === 'ignored' && line.pending.length > 0 && isAck(venue, raw)) {
        const request = this.answered(venue, line, raw);
        if (request !== null && request.on) this.acknowledge(venue, request.id, at);
      }
    }
    if (line.socket === null) return; // un refus a fermé la venue
    for (const item of parsed) this.dispatch(venue, line, item, at);
  }

  private dispatch(venue: CryptoVenue, line: VenueLine, item: WsParsed, at: number): void {
    switch (item.kind) {
      case 'ticker': {
        const { ticker } = item;
        const own = (sub: Subscription): boolean => sub.kind === 'ticker' && sub.series === ticker.market;
        this.confirmOwn(venue, line, at, own);
        if (this.follows(venue, own)) this.emit({ kind: 'ticker', ticker });
        return;
      }
      case 'kline': {
        if (!withinOneBucket(item.bar.time * 1000, item.timeframe, at)) return;
        const own = (sub: Subscription): boolean => sub.kind === 'bars' && !sub.fromTrades && sub.series === item.series && sub.timeframe === item.timeframe;
        this.confirmOwn(venue, line, at, own);
        if (this.follows(venue, own)) this.emit({ kind: 'bar', series: item.series, timeframe: item.timeframe, bar: item.bar, final: item.final });
        return;
      }
      case 'trade':
        this.confirmOwn(venue, line, at, (sub) => sub.fromTrades && sub.series === item.trade.market);
        this.onTrade(venue, item.trade, at);
        return;
      default:
        return;
    }
  }

  /** Chaque constructeur du marché reçoit le trade ; une seule bougie est émise par timeframe, celle du plus ancien abonnement. */
  private onTrade(venue: CryptoVenue, trade: CryptoTrade, at: number): void {
    const emitted = new Set<CryptoTimeframe>();
    for (const sub of this.subs.values()) {
      if (sub.venue !== venue || sub.refused || sub.series !== trade.market || sub.builder === null || sub.timeframe === null) continue;
      if (!withinOneBucket(trade.time, sub.timeframe, at)) continue;
      const bars = sub.builder.push(trade);
      if (emitted.has(sub.timeframe)) continue;
      emitted.add(sub.timeframe);
      for (const { bar, final } of bars) this.emit({ kind: 'bar', series: sub.series, timeframe: sub.timeframe, bar, final });
    }
  }

  /**
   * Refus d'une demande : journalisé ; les abonnements qui portaient une clé refusée sont abandonnés (leurs clés
   * rendues, une clé qui n'est plus tenue et que la venue avait acceptée est désabonnée) ; plus rien à suivre : la
   * socket ferme et la venue passe `blocked`. Une erreur qui ne répond à aucune demande en attente est seulement journalisée.
   */
  private refusal(venue: CryptoVenue, line: VenueLine, detail: string, raw: string): void {
    this.log(`crypto ${venue}: demande refusée par la venue · ${safeText(detail)}`);
    const request = this.answered(venue, line, raw);
    if (request === null || !request.on) return;
    const refused = new Set(request.keys);
    const release: string[] = [];
    for (const sub of this.subs.values()) {
      if (sub.venue !== venue || sub.refused || !sub.keys.some((key) => refused.has(key))) continue;
      sub.refused = true;
      sub.awaiting = false;
      sub.waitingFor.clear();
      sub.builder = null;
      for (const key of sub.keys) {
        const count = line.keys.get(key);
        if (count === undefined) continue;
        if (count > 1) {
          line.keys.set(key, count - 1);
          continue;
        }
        line.keys.delete(key);
        if (!refused.has(key)) release.push(key);
      }
      this.log(`crypto ${venue}: abonnement ${sub.series} ${sub.kind} abandonné, jamais redemandé`);
    }
    if (!this.closeIfIdle(venue, line)) this.request(venue, line, release, false);
  }

  /** La demande en attente à laquelle répond ce message, retirée de la file : par son `id` chez Binance, sinon la plus ancienne. */
  private answered(venue: CryptoVenue, line: VenueLine, raw: string): Pending | null {
    if (line.pending.length === 0) return null;
    const id = venue === 'binance' ? replyId(raw) : null;
    const index = id === null ? 0 : line.pending.findIndex((request) => request.id === id);
    if (index < 0) return null;
    return line.pending.splice(index, 1)[0] ?? null;
  }

  /** Vrai si un abonnement actif (non refusé) de la venue répond au critère. */
  private follows(venue: CryptoVenue, test: (sub: Subscription) => boolean): boolean {
    for (const sub of this.subs.values()) if (sub.venue === venue && !sub.refused && test(sub)) return true;
    return false;
  }

  private gateRefusal(venue: CryptoVenue): 'blocked' | 'rate_limited' | null {
    if (this.deps.gate.blocked(venue)) return 'blocked';
    return this.deps.gate.allowed(venue) ? null : 'rate_limited';
  }

  /** Ce qu'une page en échec rend à l'appelant ; un 429 ou un 418 passe d'abord par la porte, et un 418 coupe la socket. */
  private fetchFailure(venue: CryptoVenue, error: unknown): string {
    if (error instanceof VenueHttpError) {
      this.deps.gate.onHttpError(venue, error);
      if (error.status === 418) {
        this.cut(venue);
        return 'blocked';
      }
      if (error.status === 429) return 'rate_limited';
    }
    return errorText(error);
  }

  /** 418 : la venue est coupée jusqu'au redémarrage, sa socket comprise. */
  private cut(venue: CryptoVenue): void {
    const line = this.line(venue);
    if (line.socket !== null) this.shut(venue, line, false);
    else this.publish(venue);
  }

  private historyFailed(venue: CryptoVenue, series: CryptoSeriesId, timeframe: CryptoTimeframe, detail: string): HistoryResult {
    this.log(`crypto ${venue}: historique ${series} ${timeframe} min refusé · ${detail}`);
    return { ok: false, detail };
  }

  private stateOf(venue: CryptoVenue): VenueState {
    const line = this.lines.get(venue);
    if (line?.socket) return line.socket.state;
    return line?.refused || this.deps.gate.blocked(venue) ? 'blocked' : 'off';
  }

  /** Remonte l'état de la venue s'il a changé. */
  private publish(venue: CryptoVenue): void {
    const line = this.line(venue);
    const state = this.stateOf(venue);
    if (state === line.reported) return;
    line.reported = state;
    try {
      this.deps.status(venue, state);
    } catch (error) {
      this.log(`crypto ${venue}: état non transmis · ${errorText(error)}`);
    }
  }

  private emit(event: CryptoFeedEvent): void {
    try {
      this.deps.emit(event);
      this.emitFailing = false;
    } catch (error) {
      // Journalisé une fois par panne : un renderer parti ne doit pas noyer le journal.
      if (!this.emitFailing) this.log(`crypto: événement non transmis · ${errorText(error)}`);
      this.emitFailing = true;
    }
  }

  private log(text: string): void {
    try {
      this.deps.log(safeText(text, LINE_MAX));
    } catch {
      // un journal en panne ne doit pas arrêter les flux
    }
  }
}
