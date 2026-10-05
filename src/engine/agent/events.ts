/**
 * Journal des événements du desk pour les agents : fills NinjaTrader, marge du plan prop,
 * catalyseurs proches, lien du pont. Pur : le renderer y range ce qu'il observe, l'orchestrateur
 * les pousse (`desk.event`), l'outil `desk_events` les relit avec un curseur.
 */
import type { CalEvent } from '../calendar';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import type { DeskEventKind } from './catalog';

export interface DeskEvent {
  seq: number;
  /** Epoch ms. */
  at: number;
  kind: DeskEventKind;
  data: Record<string, unknown>;
}

export const EVENT_LOG_MAX = 500;
export const EVENTS_PAGE_DEFAULT = 50;
export const EVENTS_PAGE_MAX = 200;

export interface DeskEventPage {
  /** À repasser au prochain appel : seuls les événements suivants reviennent. */
  cursor: string;
  events: DeskEvent[];
  /** D'autres événements attendent après cette page. */
  more: boolean;
  /** Événements sortis du journal (500 au plus) avant d'avoir été lus. */
  dropped: number;
  /** Curseur d'un autre lancement du desk, ou inconnu : la page repart des plus récents. */
  reset: boolean;
}

function parseCursor(cursor: string): { epoch: string; seq: number } | null {
  const m = /^([a-z0-9]{1,32})\.(\d{1,12})$/i.exec(cursor);
  return m && m[1] ? { epoch: m[1], seq: Number(m[2]) } : null;
}

/** Anneau d'événements numérotés. `epoch` distingue deux lancements du desk. */
export class DeskEventLog {
  private rows: DeskEvent[] = [];
  private seq = 0;

  constructor(
    readonly epoch: string,
    private readonly max = EVENT_LOG_MAX,
  ) {}

  push(kind: DeskEventKind, data: Record<string, unknown>, at = Date.now()): DeskEvent {
    const event: DeskEvent = { seq: ++this.seq, at, kind, data };
    this.rows.push(event);
    if (this.rows.length > this.max) this.rows.splice(0, this.rows.length - this.max);
    return event;
  }

  get size(): number {
    return this.rows.length;
  }

  last(): DeskEvent | undefined {
    return this.rows[this.rows.length - 1];
  }

  /**
   * Sans curseur : les `limit` plus récents. Avec un curseur de ce lancement : les suivants, du plus ancien
   * au plus récent, `limit` au plus. `kinds` filtre sans faire reculer le curseur.
   */
  read(opts: { cursor?: string; kinds?: readonly string[]; limit?: number } = {}): DeskEventPage {
    const limit = Math.min(EVENTS_PAGE_MAX, Math.max(1, Math.floor(opts.limit ?? EVENTS_PAGE_DEFAULT)));
    const wanted = (e: DeskEvent) => !opts.kinds?.length || opts.kinds.includes(e.kind);
    const parsed = opts.cursor ? parseCursor(opts.cursor) : null;
    const known = !!parsed && parsed.epoch === this.epoch && parsed.seq <= this.seq;
    const reset = !!opts.cursor && !known;
    if (!known || !parsed) {
      const all = this.rows.filter(wanted);
      return { cursor: `${this.epoch}.${this.seq}`, events: all.slice(-limit), more: false, dropped: 0, reset };
    }
    const oldest = this.rows[0]?.seq ?? this.seq + 1;
    const dropped = Math.max(0, oldest - 1 - parsed.seq);
    const pending = this.rows.filter((e) => e.seq > parsed.seq && wanted(e));
    const events = pending.slice(0, limit);
    const more = pending.length > limit;
    const through = more ? (events[events.length - 1]?.seq ?? parsed.seq) : this.seq;
    return { cursor: `${this.epoch}.${through}`, events, more, dropped, reset: false };
  }
}

/* ─── Marge du plan prop ─── */

/** Part restante du drawdown maximal : 50 %, 25 %, 10 %, puis franchi (0). */
export const PROP_BUFFER_THRESHOLDS = [0.5, 0.25, 0.1, 0] as const;
/** Pour remonter d'un niveau, la marge doit repasser le seuil de 5 points : pas d'alerte en rafale. */
export const PROP_BUFFER_HYSTERESIS = 0.05;

/** Nombre de seuils franchis vers le bas (0 = au-dessus de 50 %), avec hystérésis à la remontée. */
export function propBufferLevel(share: number, prev = 0): number {
  let level = 0;
  PROP_BUFFER_THRESHOLDS.forEach((t, i) => {
    if (share <= t) level = i + 1;
  });
  let kept = Math.max(level, prev);
  while (kept > level && share > (PROP_BUFFER_THRESHOLDS[kept - 1] ?? 0) + PROP_BUFFER_HYSTERESIS) kept--;
  return kept;
}

export interface PropBufferInput {
  planId: string;
  /** '' = tous les comptes. */
  account: string;
  maxDrawdown: number;
  /** Marge du rejeu du journal (`evaluatePlan().buffer`). */
  buffer: number;
  floor: number;
  balance: number;
  /** PnL latent du compte suivi, d'après le pont ; 0 hors pont. */
  unrealized: number;
}

/** Marge en direct et part restante du drawdown maximal ; `null` sans drawdown ou sans marge lisible. */
export function propLiveBuffer(input: Pick<PropBufferInput, 'maxDrawdown' | 'buffer' | 'unrealized'>): { liveBuffer: number; share: number } | null {
  if (!(input.maxDrawdown > 0) || !Number.isFinite(input.buffer)) return null;
  const liveBuffer = input.buffer + Math.min(0, Number.isFinite(input.unrealized) ? input.unrealized : 0);
  return { liveBuffer, share: liveBuffer / input.maxDrawdown };
}

/**
 * Marge en direct : celle du rejeu, diminuée d'un latent négatif (un latent positif ne compte pas :
 * il ne relève pas le plancher avant la clôture). Rend un événement quand un seuil est franchi vers le bas.
 */
export function propBufferAlert(prevLevel: number, input: PropBufferInput): { level: number; data: Record<string, unknown> | null } {
  const live = propLiveBuffer(input);
  if (!live) return { level: prevLevel, data: null };
  const { liveBuffer, share } = live;
  const level = propBufferLevel(share, prevLevel);
  if (level <= prevLevel) return { level, data: null };
  return {
    level,
    data: {
      planId: input.planId,
      account: input.account || null,
      threshold: PROP_BUFFER_THRESHOLDS[level - 1],
      breached: liveBuffer <= 0,
      remainingShare: Math.round(share * 1000) / 1000,
      liveBuffer: Math.round(liveBuffer * 100) / 100,
      journalBuffer: Math.round(input.buffer * 100) / 100,
      unrealized: Math.round(input.unrealized * 100) / 100,
      maxDrawdown: input.maxDrawdown,
      floor: input.floor,
      balance: input.balance,
    },
  };
}

/* ─── Catalyseurs ─── */

export const CATALYST_LEAD_MIN = 15;
export const CATALYST_MIN_IMPACT = 3;

/** Instant de publication (heure de New York), `null` pour un événement sans heure. */
export function catalystInstant(event: Pick<CalEvent, 'date' | 'timeET' | 'allDay'>): number | null {
  if (event.allDay || !event.timeET || !/^\d{2}:\d{2}$/.test(event.timeET)) return null;
  return zonedToUtc(event.date, event.timeET, ET_ZONE);
}

/** Catalyseurs majeurs publiés dans les `leadMin` minutes, pas encore annoncés (`seen`, par id). */
export function dueCatalysts(events: readonly CalEvent[], now: number, seen: ReadonlySet<string>, leadMin = CATALYST_LEAD_MIN, minImpact = CATALYST_MIN_IMPACT): { id: string; data: Record<string, unknown> }[] {
  const out: { id: string; data: Record<string, unknown> }[] = [];
  for (const e of events) {
    if (e.impact < minImpact || seen.has(e.id)) continue;
    const at = catalystInstant(e);
    if (at === null || at <= now || at > now + leadMin * 60_000) continue;
    out.push({
      id: e.id,
      data: {
        title: e.title,
        at: new Date(at).toISOString(),
        date: e.date,
        timeET: e.timeET,
        minutesBefore: Math.round((at - now) / 60_000),
        impact: e.impact,
        category: e.category,
        source: e.source ?? 'local',
        estimated: e.estimated,
        ...(e.forecast != null ? { forecast: e.forecast } : {}),
        ...(e.previous != null ? { previous: e.previous } : {}),
        ...(e.instruments?.length ? { instruments: e.instruments } : {}),
      },
    });
  }
  return out;
}

/* ─── Fills et lien du pont ─── */

const SHORT = 64;

function short(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= SHORT ? v : null;
}

/** Exécution reçue du pont NinjaTrader, champs bornés. `null` si elle est incomplète. */
export function fillData(fill: unknown): Record<string, unknown> | null {
  if (!fill || typeof fill !== 'object') return null;
  const f = fill as Record<string, unknown>;
  const account = short(f.account);
  const instrument = short(f.instrument);
  const action = short(f.action);
  const quantity = typeof f.quantity === 'number' && Number.isFinite(f.quantity) ? f.quantity : null;
  const price = typeof f.price === 'number' && Number.isFinite(f.price) ? f.price : null;
  const time = typeof f.time === 'number' && Number.isFinite(f.time) ? f.time : null;
  if (!account || !instrument || !action || quantity === null || price === null || time === null) return null;
  const entryExit = short(f.entryExit);
  return { account, instrument, action, quantity, price, time: new Date(time).toISOString(), ...(entryExit ? { entryExit } : {}) };
}

/** Changement d'état du lien du pont. Le premier état connu n'est pas un événement. */
export function linkTransition(prev: string | null, next: string, addonVersion: string | null = null): Record<string, unknown> | null {
  if (prev === null || prev === next) return null;
  return { from: prev, to: next, ...(addonVersion ? { addonVersion } : {}) };
}
