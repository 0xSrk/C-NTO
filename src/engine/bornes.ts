/**
 * Les bornes de la journée CME (OROS5.11, ΟΡΟΣ). Pur. Une seule réponse à « où en est le compte suivi » : la perte du
 * jour sur sa limite et sa source, les trades sur leur maximum, la marge datée au plancher du plan suivi, le prochain
 * catalyseur majeur et le canal d'ordres. Ce sont les bornes que lisent l'alerte `daily_loss`, la veille discipline et
 * la garde de l'agent (`prop_buffer`, `trader_rule`) ; l'écran n'en est que le miroir, la décision reste au process
 * principal.
 *
 * Deux temps, pour ne rejouer qu'une fois :
 * - `replayBornes` rejoue ce qui ne change qu'avec le journal, le plan, le compte suivi ou les règles : le plan sur tout
 *   l'historique (`evaluatePlan`, `planMargin`, comme K.04 et la garde), et chaque journée lue (`dayLoss`, les écarts
 *   de `detectRuleBreaches`), une fois par journée ;
 * - `dayBornes` y ajoute le vif : le latent du pont, son âge, l'horloge, le calendrier et le canal.
 *
 * Chaque lecture est faite par la fonction même que lit la garde. Zéro n'est pas l'absence : une valeur inconnue vaut
 * `null` et se lit « — ».
 */
import { DAILY_LOSS_THRESHOLDS, propLiveBuffer } from './agent/events';
import { AGENT_PROP_FLOOR } from './agent/orders';
import { matchAccount, type AccountMatch } from './accounts';
import type { CalendarSourceStatus } from './calendarEvents';
import { dailyLimit, dayLoss, detectRuleBreaches, entryOfTrade, lossOfDay, tradingDayNow, type DailyLimit, type MajorCatalyst, type TraderRules } from './discipline';
import { PROP_DRAWDOWN_ALERT } from './portfolio/risk';
import { BRIDGE_MAX_AGE_MS } from './portfolio/types';
import { evaluatePlan, planMargin, type PlanMargin, type PropEvaluation, type PropPlan } from './propfirm';
import type { Session, Trade } from './types';

/** 0 : rien ; 2 : borne approchée (C.012) ; 3 : borne franchie (C.123, le seul rouge). */
export type BorneLevel = 0 | 2 | 3;

/** Part de la limite du jour où la borne passe en attention : le deuxième seuil de l'alerte `daily_loss` (75 %). */
export const LOSS_WARN = DAILY_LOSS_THRESHOLDS[1];
/** Part restante du drawdown maximal sous laquelle la marge passe en attention : l'alerte du portefeuille et la garde. */
export const MARGIN_WARN = Math.max(PROP_DRAWDOWN_ALERT, AGENT_PROP_FLOOR);

/**
 * Le niveau d'une marge au plancher, le même partout où elle se lit : 3 franchie (compte invalidé, ou marge épuisée),
 * 2 approchée — à `MARGIN_WARN` restants, là où la garde cesse d'ouvrir et où le portefeuille alerte —, 0 sinon. Hors
 * service (objectif atteint), la borne ne bouge plus : aucune alerte.
 */
export function marginLevel(share: number | null, status: PropEvaluation['status'] | null): BorneLevel {
  if (status === 'echec' || (share !== null && share <= 0)) return 3;
  return status === 'en-cours' && share !== null && share <= MARGIN_WARN ? 2 : 0;
}

/* ─── Le rejeu : une fois par journal, plan, compte suivi et règles ─── */

export interface BornesReplayInput {
  sessions: readonly Session[];
  trades: readonly Trade[];
  /** Compte suivi (`planAccount`) ; '' : tous les comptes, agrégés par journée (comme la garde et l'alerte). */
  account: string;
  /** Plan suivi (`planId`) ; `null` s'il ne se trouve pas au registre. */
  plan: PropPlan | null;
  rules: TraderRules;
}

export interface DayReplay {
  day: string;
  /** Réalisé de la journée sur le compte suivi, sans latent (`dayLoss`). */
  realized: number;
  /** Trades de la journée (`dayLoss`). */
  trades: number;
  /** P&L de chaque trade de la journée, dans l'ordre des entrées. */
  pnls: number[];
  /** Entrées au-delà du maximum de trades et entrées après la perte du jour, rejouées comme la veille discipline. */
  overMax: number;
  afterLimit: number;
}

export interface PlanReplay {
  plan: PropPlan;
  ev: PropEvaluation;
  /** Marge datée de la jauge K.04 : plus-bas de la dernière séance rejouée moins le plancher. */
  dated: PlanMargin | null;
  /** Le plancher ne bouge plus (statique, ou trailing verrouillé) : C.126 ; sinon C.125 au trait. */
  locked: boolean;
}

export interface BornesReplay {
  account: string;
  rules: TraderRules;
  limit: DailyLimit | null;
  maxTrades: number | null;
  plan: PlanReplay | null;
  /** Dernière journée du journal sur le compte suivi. */
  lastDay: string | null;
  hasDay: (day: string) => boolean;
  /** Une journée rejouée, une seule fois par clé. */
  day: (day: string) => DayReplay;
}

export function replayBornes(input: BornesReplayInput): BornesReplay {
  const { account, rules } = input;
  const mine = input.sessions.filter((s) => !account || (s.account ?? '') === account);
  const dates = new Set(mine.map((s) => s.date));
  const lastDay = mine.reduce<string | null>((max, s) => (max === null || s.date > max ? s.date : max), null);
  const limit = dailyLimit(rules, input.plan);
  const maxTrades = rules.maxTradesPerDay > 0 ? rules.maxTradesPerDay : null;
  let plan: PlanReplay | null = null;
  if (input.plan && input.plan.maxDrawdown > 0) {
    // Le rejeu que lisent la garde (`trackedPlan`) et K.04 (`drawdownGauge`) : tout l'historique du compte suivi.
    const ev = evaluatePlan(input.plan, [...input.sessions], [...input.trades], account || undefined);
    const locked = input.plan.drawdownType === 'static' || (input.plan.trailingLockAt !== undefined && ev.floor >= input.plan.accountSize + input.plan.trailingLockAt);
    plan = { plan: input.plan, ev, dated: planMargin(ev), locked };
  }
  const days = new Map<string, DayReplay>();
  const day = (key: string): DayReplay => {
    const hit = days.get(key);
    if (hit) return hit;
    const read = dayLoss({ sessions: input.sessions, trades: input.trades, day: key, account });
    const ids = new Set(mine.filter((s) => s.date === key).map((s) => s.id));
    const own = input.trades.filter((t) => ids.has(t.sessionId) && Number.isFinite(t.pnl)).sort((a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id));
    const findings = own.length ? detectRuleBreaches(own.map(entryOfTrade), { rules, closed: input.trades, catalysts: [], limit, limitAccount: account }) : [];
    const row: DayReplay = {
      day: key,
      realized: read.realized,
      trades: read.trades,
      pnls: own.map((t) => t.pnl),
      overMax: findings.filter((f) => f.kind === 'over_max_trades').length,
      afterLimit: findings.filter((f) => f.kind === 'after_daily_limit').length,
    };
    days.set(key, row);
    return row;
  };
  return { account, rules, limit, maxTrades, plan, lastDay, hasDay: (key) => dates.has(key), day };
}

/* ─── Le vif : le pont, l'horloge, le calendrier, le canal ─── */

/** État des sources officielles du calendrier : sans elles, FOMC et NFP manquent (adaptateurs `fed` et `bls`). */
export type CalendarSources = 'complete' | 'partial' | 'offline';

/** Complètes, partielles (une source en erreur, ou rien de synchronisé mais un cache), ou hors ligne (rien du tout). */
export function calendarSourcesState(sources: readonly CalendarSourceStatus[], lastError: string | undefined, cached: number): CalendarSources {
  if (sources.length && !lastError && sources.every((src) => src.state === 'ok')) return 'complete';
  if (!sources.length && !cached) return 'offline';
  return 'partial';
}

/** Un catalyseur majeur daté ; `estimated` : une date déduite d'une récurrence, pas encore publiée. */
export type BorneCatalyst = MajorCatalyst & { estimated?: boolean };

export interface BornesLive {
  now: number;
  /** Lien du pont NinjaTrader (`absent` en navigateur). */
  link: string;
  /** Réception des derniers comptes du pont (epoch ms). */
  accountsAt?: number | null;
  accounts: readonly { name: string; unrealizedPnl: number }[];
  /** Catalyseurs majeurs datés, triés (`majorCatalysts`). */
  catalysts: readonly BorneCatalyst[];
  calendarSources?: CalendarSources;
  ordersOpen?: boolean;
  /** Kill switch engagé au pont : fermé jusqu'au redémarrage du desk. */
  ordersClosed?: boolean;
  /** Verrou du renderer : une coupure vue garde le canal fermé jusqu'au redémarrage. */
  killLatched?: boolean;
  maxContractsPerOrder?: number | null;
  /**
   * Depuis quand la journée CME en cours est fermée sur le compte suivi (décision 15 de l'ADMIN), d'après la fermeture
   * retenue et le journal, comme la garde le lit (`trackedDayClosedSince`) ; `null` ou absent : rien de tel. La perte relue
   * à l'instant, latent compris, la ferme aussi : la borne la lit d'elle-même.
   */
  dayClosedSince?: number | null;
}

export interface DayRead {
  /** Journée CME lue : celle de maintenant en séance (pont vivant ou journal du jour), sinon la dernière du journal. */
  key: string | null;
  /** Journée CME de maintenant (18 h ET la veille → 17 h ET). */
  tradingDay: string;
  /** La journée lue est la journée CME en cours. */
  today: boolean;
  /** Le pont est vivant : le latent entre dans la perte du jour et la marge. */
  live: boolean;
  /** Âge de la dernière lecture du pont, `null` hors pont. */
  ageMs: number | null;
  /** Au-delà de `BRIDGE_MAX_AGE_MS`, une valeur vive est périmée : C.013. */
  stale: boolean;
  /**
   * Le compte suivi au pont, et comment il a été reconnu (`matchAccount`) : nom exact, sinon replié. Depuis A18, la garde
   * lit le latent de l'un comme de l'autre, et ces bornes aussi ; la provenance dit lequel.
   */
  bridgeAccount: AccountMatch | null;
  /** Le latent du pont entre dans la perte du jour et la marge. */
  unrealizedRead: boolean;
}

export interface LossBorne {
  value: number | null;
  realized: number | null;
  unrealized: number | null;
  limit: number | null;
  /** D'où vient la limite : la règle du trader (C.109) ou le plan. */
  source: 'trader' | 'plan' | null;
  /** Compte borné ; `null` : tous les comptes. */
  account: string | null;
  /** Part de la limite consommée, `null` sans limite. */
  consumed: number | null;
  /** Ce qui reste avant la limite, en dollars (négatif : franchie). */
  remaining: number | null;
  /** P&L de la journée (réalisé + latent négatif), signé. */
  pnl: number | null;
  /** Entrées prises après la perte du jour atteinte, rejouées. */
  afterLimit: number | null;
  /**
   * La journée fermée depuis (décision 15) : la perte du jour a atteint la limite, la journée CME en cours reste fermée aux
   * ouvertures de l'agent jusqu'à la suivante, même si un gain la ramène sous la limite ; `null` : ouverte. C.123 tant
   * qu'elle tient.
   */
  closedSince: number | null;
  level: BorneLevel;
}

export interface TradesBorne {
  count: number | null;
  max: number | null;
  /** P&L de chaque trade de la journée, dans l'ordre des entrées. */
  pnls: number[];
  consumed: number | null;
  /** Entrées au-delà du maximum, rejouées. */
  over: number | null;
  level: BorneLevel;
}

export interface MarginBorne {
  /** Marge en direct, celle de la garde : la marge datée moins un latent négatif (`propLiveBuffer`). */
  value: number | null;
  /** Marge datée du rejeu, au plus-bas de la dernière séance (`planMargin`), sans le latent : celle de K.04. */
  dated: number | null;
  maxDrawdown: number | null;
  /** Marge / drawdown maximal : la part que lit `prop_buffer` (`trackedPropShare`). */
  share: number | null;
  /** Drawdown consommé : 1 − part. */
  consumed: number | null;
  /** Date de la dernière séance rejouée : la marge est datée. */
  date: string | null;
  planLabel: string | null;
  /** Compte rejoué ; `null` : tous les comptes. */
  account: string | null;
  status: PropEvaluation['status'] | null;
  /** En service tant que l'évaluation court ; objectif atteint, le rejeu s'arrête : la borne est finie. */
  inService: boolean;
  /** La marge est datée d'une autre journée que la journée lue : C.013, et la date va dans la valeur. */
  otherDay: boolean;
  /** `mobile` : le plancher suit encore (C.125 au trait) ; `fixed` : il ne bouge plus (C.126). */
  floorKind: 'mobile' | 'fixed' | null;
  floor: number | null;
  /** Le latent négatif du pont est retranché. */
  live: boolean;
  level: BorneLevel;
}

export interface CatalystBorne {
  at: number | null;
  title: string | null;
  date: string | null;
  timeET: string | null;
  /** Fenêtre des règles du trader, en minutes (0 : inactive). */
  windowMin: number;
  /** Minutes avant l'ouverture de la fenêtre (ou avant le catalyseur sans fenêtre) ; négatif : dedans. */
  untilMin: number | null;
  /** Maintenant est dans ± la fenêtre : la garde de l'agent refuse les ouvertures (`catalyst_window`). */
  inWindow: boolean;
  /** Date déduite d'une récurrence, pas encore publiée : « ≈ » devant la date. */
  estimated: boolean;
  /** Sources officielles absentes ou en erreur : le prochain catalyseur peut être plus proche que celui-ci. */
  partial: boolean;
  level: BorneLevel;
}

export interface ChannelBorne {
  state: 'open' | 'closed' | 'absent';
  /** Kill switch engagé : fermé jusqu'au redémarrage du desk. */
  killed: boolean;
  maxContracts: number | null;
  level: BorneLevel;
}

export type BorneKey = 'loss' | 'trades' | 'margin' | 'catalyst' | 'channel';

export interface DayBornes {
  day: DayRead;
  loss: LossBorne;
  trades: TradesBorne;
  margin: MarginBorne;
  catalyst: CatalystBorne;
  channel: ChannelBorne;
  /** La borne la plus proche de sa limite, d'après ce que dessine chaque règle ; `null` sans borne vivante. */
  nearest: BorneKey | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Le compte suivi au pont, lu comme la garde (`liveAccounts`, A18) : le nom exact d'abord, sinon le nom replié. */
function trackedRows(replay: BornesReplay, live: BornesLive): BornesLive['accounts'] {
  if (!replay.account) return live.accounts;
  const match = matchAccount(live.accounts.map((row) => row.name), replay.account);
  const row = match ? live.accounts.find((r) => r.name === match.name) : undefined;
  return row ? [row] : [];
}

/** Latent du compte suivi ('' = tous) d'après le pont vivant, lu comme la garde (`trackedPlan`, `liveUnrealized`). */
function unrealizedOf(replay: BornesReplay, live: BornesLive): number {
  if (live.link !== 'live') return 0;
  return trackedRows(replay, live).reduce((sum, row) => sum + (finite(row.unrealizedPnl) ? row.unrealizedPnl : 0), 0);
}

function readDay(replay: BornesReplay, live: BornesLive): DayRead {
  const tradingDay = tradingDayNow(live.now);
  const isLive = live.link === 'live';
  const at = finite(live.accountsAt) ? live.accountsAt : null;
  const ageMs = isLive && at !== null ? Math.max(0, live.now - at) : null;
  const bridgeAccount = replay.account ? matchAccount(live.accounts.map((row) => row.name), replay.account) : null;
  const unrealizedRead = isLive && (!replay.account || bridgeAccount !== null);
  const base = { tradingDay, ageMs, bridgeAccount, unrealizedRead };
  if (isLive || replay.hasDay(tradingDay)) return { ...base, key: tradingDay, today: true, live: isLive, stale: isLive && (ageMs === null || ageMs > BRIDGE_MAX_AGE_MS) };
  return { ...base, key: replay.lastDay, today: false, live: false, ageMs: null, stale: false };
}

function lossAndTrades(replay: BornesReplay, live: BornesLive, day: DayRead): { loss: LossBorne; trades: TradesBorne } {
  const { limit, maxTrades } = replay;
  const account = replay.account || null;
  // La journée CME en cours fermée (décision 15), sans séance du jour ni pont vivant : la perte du jour n'est pas lue, mais
  // la fermeture tient, et se dit au niveau 3 plutôt que la dernière séance, datée (OROS5.48i).
  const unread = (closedSince: number | null): LossBorne => ({ value: null, realized: null, unrealized: null, limit: limit?.amount ?? null, source: limit?.source ?? null, account, consumed: null, remaining: null, pnl: null, afterLimit: null, closedSince, level: closedSince !== null ? 3 : 0 });
  const closedToday = !day.today && finite(live.dayClosedSince) ? live.dayClosedSince : null;
  if (!day.key) return { loss: unread(closedToday), trades: { count: null, max: maxTrades, pnls: [], consumed: null, over: null, level: 0 } };
  const read = replay.day(day.key);
  const { unrealized, loss } = lossOfDay(read.realized, day.live ? unrealizedOf(replay, live) : 0);
  const consumed = limit ? loss / limit.amount : null;
  // Une borne ne s'allume que pour la journée en cours : la dernière séance est une lecture datée, pas une alerte. La
  // journée fermée (décision 15) reste franchie jusqu'à la suivante, même si un gain ramène la perte sous la limite.
  const reachedNow = day.today && limit !== null && loss >= limit.amount ? live.now : null;
  const closedSince = !day.today ? null : finite(live.dayClosedSince) ? Math.min(live.dayClosedSince, reachedNow ?? Number.POSITIVE_INFINITY) : reachedNow;
  const lossLevel: BorneLevel = !day.today ? 0 : closedSince !== null ? 3 : consumed === null ? 0 : consumed >= 1 ? 3 : consumed >= LOSS_WARN ? 2 : 0;
  const tradesLevel: BorneLevel = !day.today || maxTrades === null ? 0 : read.trades > maxTrades ? 3 : read.trades === maxTrades ? 2 : 0;
  return {
    loss: closedToday !== null ? unread(closedToday) : {
      value: loss,
      realized: read.realized,
      unrealized: day.live ? unrealized : null,
      limit: limit?.amount ?? null,
      source: limit?.source ?? null,
      account,
      consumed,
      remaining: limit ? limit.amount - loss : null,
      pnl: read.realized + unrealized,
      afterLimit: read.afterLimit,
      closedSince,
      level: lossLevel,
    },
    trades: { count: read.trades, max: maxTrades, pnls: read.pnls, consumed: maxTrades === null ? null : read.trades / maxTrades, over: read.overMax, level: tradesLevel },
  };
}

function marginBorne(replay: BornesReplay, live: BornesLive, day: DayRead): MarginBorne {
  const tracked = replay.plan;
  const empty: MarginBorne = {
    value: null,
    dated: null,
    maxDrawdown: tracked?.plan.maxDrawdown ?? null,
    share: null,
    consumed: null,
    date: null,
    planLabel: tracked ? `${tracked.plan.firm} ${tracked.plan.label}` : null,
    account: replay.account || null,
    status: null,
    inService: false,
    otherDay: false,
    floorKind: null,
    floor: null,
    live: false,
    level: 0,
  };
  if (!tracked) return empty;
  const { ev, dated, locked } = tracked;
  const unrealized = unrealizedOf(replay, live);
  const read = propLiveBuffer({ maxDrawdown: tracked.plan.maxDrawdown, buffer: ev.buffer, margin: dated?.margin ?? null, unrealized });
  if (!read) return { ...empty, status: ev.status };
  return {
    ...empty,
    value: read.liveBuffer,
    dated: dated?.margin ?? null,
    share: read.share,
    consumed: 1 - read.share,
    date: dated?.date ?? null,
    status: ev.status,
    inService: ev.status === 'en-cours',
    otherDay: !!dated && dated.date !== (day.today ? day.tradingDay : day.key),
    floorKind: locked ? 'fixed' : 'mobile',
    floor: ev.floor,
    live: Math.min(0, unrealized) !== 0,
    level: marginLevel(read.share, ev.status),
  };
}

function catalystBorne(replay: BornesReplay, live: BornesLive): CatalystBorne {
  const windowMin = replay.rules.catalystBlackoutMin > 0 ? replay.rules.catalystBlackoutMin : 0;
  const span = windowMin * 60_000;
  const partial = (live.calendarSources ?? 'complete') !== 'complete';
  const next = live.catalysts.find((c) => c.at + span >= live.now);
  if (!next) return { at: null, title: null, date: null, timeET: null, windowMin, untilMin: null, inWindow: false, estimated: false, partial, level: 0 };
  const inWindow = span > 0 && Math.abs(live.now - next.at) <= span;
  return { at: next.at, title: next.title, date: next.date, timeET: next.timeET, windowMin, untilMin: (next.at - span - live.now) / 60_000, inWindow, estimated: next.estimated === true, partial, level: inWindow ? 2 : 0 };
}

function channelBorne(live: BornesLive): ChannelBorne {
  const maxContracts = finite(live.maxContractsPerOrder) ? live.maxContractsPerOrder : null;
  if (live.ordersClosed || live.killLatched) return { state: 'closed', killed: true, maxContracts, level: 3 };
  if (live.link !== 'live') return { state: 'absent', killed: false, maxContracts: null, level: 0 };
  // Lien vivant au canal fermé : seule la coupure le ferme.
  if (live.ordersOpen === false) return { state: 'closed', killed: true, maxContracts, level: 3 };
  return { state: 'open', killed: false, maxContracts, level: 0 };
}

/** Horizon de la règle d'un catalyseur : la journée qui vient. Au-delà, il ne borne pas encore. */
export const CATALYST_HORIZON_MIN = 24 * 60;

/** Position, de 0 (24 h avant) à 1 (la borne), d'un instant à `untilMin` minutes, sur une échelle logarithmique. */
export function catalystFraction(untilMin: number | null): number | null {
  if (!finite(untilMin) || untilMin > CATALYST_HORIZON_MIN) return null;
  return 1 - Math.log1p(Math.max(0, untilMin)) / Math.log1p(CATALYST_HORIZON_MIN);
}

/** Ce que dessine chaque règle, de 0 (loin) à 1 (sur la borne) : la même mesure compare les bornes entre elles. */
export function drawnShare(b: Omit<DayBornes, 'nearest'>, key: BorneKey): number | null {
  if (key === 'loss') return b.day.today ? b.loss.consumed : null;
  if (key === 'trades') return b.day.today ? b.trades.consumed : null;
  if (key === 'margin') return b.margin.inService ? b.margin.consumed : null;
  if (key === 'catalyst') return b.catalyst.inWindow ? 1 : catalystFraction(b.catalyst.untilMin);
  return null;
}

/** Les bornes de la journée : le rejeu, une fois, et le vif du pont, de l'horloge et du calendrier. */
export function dayBornes(replay: BornesReplay, live: BornesLive): DayBornes {
  const day = readDay(replay, live);
  const { loss, trades } = lossAndTrades(replay, live, day);
  const base = { day, loss, trades, margin: marginBorne(replay, live, day), catalyst: catalystBorne(replay, live), channel: channelBorne(live) };
  let nearest: BorneKey | null = null;
  let best = -Infinity;
  for (const key of ['loss', 'trades', 'margin', 'catalyst'] as const) {
    const v = drawnShare(base, key);
    if (v !== null && v > best) {
      best = v;
      nearest = key;
    }
  }
  return { ...base, nearest };
}
