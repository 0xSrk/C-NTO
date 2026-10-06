/**
 * Discipline du trader : ses règles chiffrées, sa perte du jour, ses dérives après une perte et ses
 * écarts aux règles. Pur : le desk lit le journal, le pont et le calendrier, puis appelle ces fonctions.
 * Une règle à 0 (ou une liste vide) est inactive : elle ne signale rien.
 */
import { ET_ZONE, tradingDayKey } from '@/lib/time';
import { CATALYST_MIN_IMPACT, catalystInstant } from './agent/events';
import type { CalEvent } from './calendar';
import { getInstrument, resolveSymbol, standardCounterpart } from './instruments';
import { evaluatePlan, type PropPlan } from './propfirm';
import type { Session, Trade } from './types';

export interface TraderRules {
  /** Perte maximale de la journée CME, en dollars. 0 = inactive. */
  maxDailyLoss: number;
  /** Entrées maximales par journée CME et par compte. 0 = inactive. */
  maxTradesPerDay: number;
  /** Pas d'entrée dans ± ces minutes autour d'un catalyseur majeur. 0 = inactive. */
  catalystBlackoutMin: number;
  /** Racines du registre autorisées (NQ, MNQ…). Vide = toutes. */
  allowedInstruments: string[];
  /** Une entrée dans ces minutes après une sortie perdante, sur le même compte, est une revanche. 0 = inactive. */
  revengeWindowMin: number;
}

export const DEFAULT_TRADER_RULES: TraderRules = {
  maxDailyLoss: 0,
  maxTradesPerDay: 0,
  catalystBlackoutMin: 0,
  allowedInstruments: [],
  revengeWindowMin: 5,
};

/** Bornes de saisie : une valeur hors bornes retombe sur la valeur précédente. */
export const TRADER_RULE_BOUNDS = {
  maxDailyLoss: { min: 0, max: 1_000_000 },
  maxTradesPerDay: { min: 0, max: 200 },
  catalystBlackoutMin: { min: 0, max: 120 },
  revengeWindowMin: { min: 0, max: 120 },
} as const;

const ALLOWED_MAX = 32;

function pick(v: unknown, bounds: { min: number; max: number }, fallback: number, integer: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < bounds.min || v > bounds.max) return fallback;
  if (integer && !Number.isInteger(v)) return fallback;
  return v;
}

/** Racines du registre, sans doublon ; un symbole hors registre est retiré (`NQ 12-26` devient `NQ`). */
export function allowedSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length > 32) continue;
    const symbol = resolveSymbol(item)?.symbol;
    if (symbol && !out.includes(symbol)) out.push(symbol);
    if (out.length >= ALLOWED_MAX) break;
  }
  return out;
}

/**
 * Saisie libre d'une liste d'instruments (« MNQ, MES ; NQ 12-26 ») : racines du registre sans doublon, et
 * ce qui n'a pas été reconnu. Séparateurs : virgule, point-virgule, retour à la ligne, puis espace.
 */
export function parseInstrumentList(text: string): { symbols: string[]; rejected: string[] } {
  const symbols: string[] = [];
  const rejected: string[] = [];
  const keep = (token: string): boolean => {
    const symbol = token.length <= 32 ? resolveSymbol(token)?.symbol : undefined;
    if (!symbol) return false;
    if (!symbols.includes(symbol) && symbols.length < ALLOWED_MAX) symbols.push(symbol);
    return true;
  };
  for (const chunk of text.split(/[,;\n]+/)) {
    const part = chunk.trim();
    if (!part || keep(part)) continue;
    for (const word of part.split(/\s+/)) if (word && !keep(word) && !rejected.includes(word)) rejected.push(word);
  }
  return { symbols, rejected };
}

/** Règles venant du stockage ou d'un coffre : chaque champ typé et borné, sinon celui de `base`. */
export function coerceTraderRules(raw: unknown, base: TraderRules = DEFAULT_TRADER_RULES): TraderRules {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return { ...base, allowedInstruments: [...base.allowedInstruments] };
  return {
    maxDailyLoss: pick(r.maxDailyLoss, TRADER_RULE_BOUNDS.maxDailyLoss, base.maxDailyLoss, false),
    maxTradesPerDay: pick(r.maxTradesPerDay, TRADER_RULE_BOUNDS.maxTradesPerDay, base.maxTradesPerDay, true),
    catalystBlackoutMin: pick(r.catalystBlackoutMin, TRADER_RULE_BOUNDS.catalystBlackoutMin, base.catalystBlackoutMin, true),
    allowedInstruments: Array.isArray(r.allowedInstruments) ? allowedSymbols(r.allowedInstruments) : [...base.allowedInstruments],
    revengeWindowMin: pick(r.revengeWindowMin, TRADER_RULE_BOUNDS.revengeWindowMin, base.revengeWindowMin, true),
  };
}

/** Vrai si au moins une règle chiffrée est active (la fenêtre de revanche est un réglage de détection). */
export function hasActiveRules(rules: TraderRules): boolean {
  return rules.maxDailyLoss > 0 || rules.maxTradesPerDay > 0 || rules.catalystBlackoutMin > 0 || rules.allowedInstruments.length > 0;
}

/* ─── Perte du jour ─── */

/**
 * Journée CME en cours (18 h → 17 h, heure de New York) : la date de séance du journal (`tradeDay`,
 * `Session.date`). Un instant du dimanche 18 h 30 compte pour le lundi.
 */
export function tradingDayNow(now: number): string {
  return tradingDayKey(now, 18, ET_ZONE);
}

export interface DayLossInput {
  sessions: readonly Session[];
  trades: readonly Trade[];
  /** Journée CME (`tradingDayNow`). */
  day: string;
  /** Compte suivi ; '' ou absent = tous les comptes, comme le rejeu du plan. */
  account?: string;
  /** Latent du compte d'après le pont. Seul un latent négatif compte. */
  unrealized?: number;
}

export interface DayLoss {
  day: string;
  account: string | null;
  /** P&L réalisé de la journée (séances du journal datées de ce jour). */
  realized: number;
  /** Latent retenu : négatif ou nul. Un latent positif ne compte pas avant la clôture. */
  unrealized: number;
  /** Perte du jour, en dollars, ≥ 0 : −(réalisé + latent négatif). */
  loss: number;
  /** Plus-bas intrajournalier du réalisé, excursions défavorables comprises : celui de `evaluatePlan().timeline`. */
  intradayLow: number;
  /** Trades de la journée. */
  trades: number;
}

/**
 * Une journée rejouée par le moteur du plan, sans règle (ni plancher, ni objectif) : son plus-bas
 * intrajournalier est, par construction, celui du rejeu du plan suivi le même jour.
 */
const DAY_REPLAY: PropPlan = {
  id: 'discipline-day',
  firm: '',
  label: '',
  accountSize: 0,
  profitTarget: Number.POSITIVE_INFINITY,
  maxDrawdown: Number.POSITIVE_INFINITY,
  drawdownType: 'static',
  phase: 'funded',
  version: 1,
  source: 'user',
};

/** Perte de la journée CME : réalisé du jour plus latent négatif, et plus-bas du rejeu. */
export function dayLoss(input: DayLossInput): DayLoss {
  const account = input.account ?? '';
  const sessions = input.sessions.filter((s) => s.date === input.day && (!account || (s.account ?? '') === account) && Number.isFinite(s.pnl));
  const ids = new Set(sessions.map((s) => s.id));
  const trades = input.trades.filter((t) => ids.has(t.sessionId));
  const realized = sessions.reduce((sum, s) => sum + s.pnl, 0);
  const point = sessions.length ? evaluatePlan(DAY_REPLAY, [...sessions], [...trades]).timeline[0] : undefined;
  const unrealized = Math.min(0, typeof input.unrealized === 'number' && Number.isFinite(input.unrealized) ? input.unrealized : 0);
  return {
    day: input.day,
    account: account || null,
    realized,
    unrealized,
    loss: Math.max(0, -(realized + unrealized)),
    intradayLow: point?.intradayLow ?? 0,
    trades: sessions.reduce((sum, s) => sum + s.tradeCount, 0),
  };
}

export interface DailyLimit {
  /** Limite retenue : la plus basse des deux. */
  amount: number;
  /** D'où elle vient : la règle du trader ou le plan prop suivi (la règle à égalité). */
  source: 'trader' | 'plan';
  trader: number | null;
  plan: number | null;
}

/** Limite de perte du jour : la plus basse de la règle du trader et de `plan.dailyLossLimit` ; `null` sans l'une ni l'autre. */
export function dailyLimit(rules: Pick<TraderRules, 'maxDailyLoss'>, plan?: Pick<PropPlan, 'dailyLossLimit'> | null): DailyLimit | null {
  const trader = rules.maxDailyLoss > 0 ? rules.maxDailyLoss : null;
  const fromPlan = plan?.dailyLossLimit !== undefined && plan.dailyLossLimit > 0 ? plan.dailyLossLimit : null;
  if (trader !== null && (fromPlan === null || trader <= fromPlan)) return { amount: trader, source: 'trader', trader, plan: fromPlan };
  if (fromPlan !== null) return { amount: fromPlan, source: 'plan', trader, plan: fromPlan };
  return null;
}

/* ─── Dérives après une perte ─── */

/** Entrée à juger : celle d'un trade du journal, ou un fill d'entrée reçu du pont. */
export interface DisciplineEntry {
  /** Identifiant stable : celui du trade, ou de l'exécution. */
  id: string;
  /** '' = sans compte. Deux comptes ne sont jamais appariés. */
  account: string;
  /** Racine ou contrat (NQ, MNQ 12-26). */
  instrument: string;
  qty: number;
  /** Epoch ms. */
  time: number;
}

export type DriftKind = 'revenge_entry' | 'size_up_after_loss';
export type RuleBreachKind = 'catalyst_window' | 'over_max_trades' | 'after_daily_limit' | 'instrument_not_allowed';

export interface DisciplineFinding {
  /** `<type>:<entrée>` : le même constat garde le même identifiant d'un calcul à l'autre. */
  id: string;
  kind: DriftKind | RuleBreachKind;
  /** `drift` : dérive après une perte ; `rule` : écart à une règle du trader. */
  family: 'drift' | 'rule';
  entryId: string;
  account: string | null;
  instrument: string;
  /** Instant de l'entrée (ISO) et sa journée CME. */
  at: string;
  day: string;
  detail: Record<string, string | number | boolean | null | string[]>;
}

/** Entrée d'un trade du journal. */
export function entryOfTrade(trade: Trade): DisciplineEntry {
  return { id: trade.id, account: trade.account ?? '', instrument: trade.instrument, qty: trade.qty, time: trade.entryTime };
}

/** Exposition d'une entrée : contrats × valeur du point du registre. `null` hors registre. */
export function entryExposure(instrument: string, qty: number): number | null {
  const symbol = resolveSymbol(instrument)?.symbol;
  if (!symbol || !Number.isFinite(qty)) return null;
  return Math.abs(qty) * getInstrument(symbol).pointValue;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function finding(kind: DriftKind | RuleBreachKind, family: 'drift' | 'rule', entry: DisciplineEntry, detail: DisciplineFinding['detail']): DisciplineFinding {
  return {
    id: `${kind}:${entry.id}`,
    kind,
    family,
    entryId: entry.id,
    account: entry.account || null,
    instrument: entry.instrument,
    at: new Date(entry.time).toISOString(),
    day: tradingDayNow(entry.time),
    detail,
  };
}

/** Dernière sortie du même compte avant l'entrée (le trade de l'entrée exclu). */
function lastExitBefore(entry: DisciplineEntry, closed: readonly Trade[]): Trade | undefined {
  let last: Trade | undefined;
  for (const t of closed) {
    if (t.id === entry.id || (t.account ?? '') !== entry.account || t.exitTime > entry.time || !Number.isFinite(t.pnl)) continue;
    if (!last || t.exitTime > last.exitTime || (t.exitTime === last.exitTime && t.id > last.id)) last = t;
  }
  return last;
}

/**
 * Dérives après une sortie perdante, sur le même compte :
 * - `revenge_entry` : entrée dans les `revengeWindowMin` minutes (0 = inactive) ;
 * - `size_up_after_loss` : la même journée CME, une exposition (contrats × valeur du point) plus forte que
 *   celle du trade perdant (1 MNQ perdant puis 1 NQ : signalé).
 * Seule la dernière sortie avant l'entrée compte : une sortie gagnante entre-temps efface la dérive.
 */
export function detectDrifts(entries: readonly DisciplineEntry[], closed: readonly Trade[], rules: Pick<TraderRules, 'revengeWindowMin'>): DisciplineFinding[] {
  const out: DisciplineFinding[] = [];
  for (const entry of entries) {
    const loss = lastExitBefore(entry, closed);
    if (!loss || !(loss.pnl < 0)) continue;
    const minutes = (entry.time - loss.exitTime) / 60_000;
    if (rules.revengeWindowMin > 0 && minutes <= rules.revengeWindowMin) {
      out.push(finding('revenge_entry', 'drift', entry, { lossTradeId: loss.id, lossPnl: round2(loss.pnl), minutesAfterLoss: Math.round(minutes * 10) / 10, windowMin: rules.revengeWindowMin }));
    }
    const before = entryExposure(loss.instrument, loss.qty);
    const now = entryExposure(entry.instrument, entry.qty);
    if (before !== null && now !== null && now > before && tradingDayNow(entry.time) === tradingDayNow(loss.exitTime)) {
      out.push(finding('size_up_after_loss', 'drift', entry, { lossTradeId: loss.id, lossPnl: round2(loss.pnl), lossExposure: before, entryExposure: now, ratio: Math.round((now / before) * 100) / 100 }));
    }
  }
  return out;
}

/* ─── Écarts aux règles ─── */

/** Catalyseur majeur daté (impact 3, heure de New York connue). */
export interface MajorCatalyst {
  /** Epoch ms de la publication. */
  at: number;
  title: string;
  date: string;
  timeET: string;
  /** Vide = tous les instruments. */
  instruments: string[];
}

/** Catalyseurs majeurs avec heure, triés ; un événement sans heure (fenêtre de résultats) n'a pas de fenêtre. */
export function majorCatalysts(events: readonly CalEvent[], minImpact = CATALYST_MIN_IMPACT): MajorCatalyst[] {
  const out: MajorCatalyst[] = [];
  for (const e of events) {
    if (e.impact < minImpact) continue;
    const at = catalystInstant(e);
    if (at === null || !e.timeET) continue;
    out.push({ at, title: e.title, date: e.date, timeET: e.timeET, instruments: e.instruments ?? [] });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Un catalyseur sans instrument vaut pour tous ; sinon la racine, ou son contrat standard pour un micro. */
function concerns(catalyst: MajorCatalyst, symbol: string | null): boolean {
  if (!catalyst.instruments.length) return true;
  if (!symbol) return false;
  return catalyst.instruments.includes(symbol) || catalyst.instruments.includes(standardCounterpart(symbol)?.symbol ?? '');
}

export interface RuleCheckContext {
  rules: TraderRules;
  /** Trades clos du journal : entrées déjà prises dans la journée, réalisé avant l'entrée. */
  closed: readonly Trade[];
  catalysts: readonly MajorCatalyst[];
  /** Limite du jour retenue (`dailyLimit`) et le compte qu'elle suit ('' = tous les comptes). */
  limit: DailyLimit | null;
  limitAccount: string;
  /** Latent du compte suivi à l'instant de l'entrée (fill en direct) ; seul un latent négatif compte. */
  unrealized?: number;
}

/**
 * Écarts aux règles du trader, à l'entrée :
 * - `catalyst_window` : entrée dans ± `catalystBlackoutMin` minutes d'un catalyseur majeur ;
 * - `over_max_trades` : entrée au-delà de `maxTradesPerDay` dans la journée CME, sur le compte ;
 * - `after_daily_limit` : entrée alors que la perte du jour avait atteint la limite (règle ou plan) ;
 * - `instrument_not_allowed` : racine hors de `allowedInstruments` (ou hors registre).
 * Une règle à 0 (liste vide, limite absente) ne signale rien.
 */
export function detectRuleBreaches(entries: readonly DisciplineEntry[], ctx: RuleCheckContext): DisciplineFinding[] {
  const { rules } = ctx;
  const out: DisciplineFinding[] = [];
  for (const entry of entries) {
    const symbol = resolveSymbol(entry.instrument)?.symbol ?? null;
    const day = tradingDayNow(entry.time);

    if (rules.catalystBlackoutMin > 0) {
      const window = rules.catalystBlackoutMin * 60_000;
      let near: MajorCatalyst | undefined;
      for (const c of ctx.catalysts) {
        if (Math.abs(entry.time - c.at) > window || !concerns(c, symbol)) continue;
        if (!near || Math.abs(entry.time - c.at) < Math.abs(entry.time - near.at)) near = c;
      }
      if (near) {
        out.push(finding('catalyst_window', 'rule', entry, { title: near.title, catalystAt: new Date(near.at).toISOString(), timeET: near.timeET, minutesFromCatalyst: Math.round((entry.time - near.at) / 6_000) / 10, windowMin: rules.catalystBlackoutMin }));
      }
    }

    if (rules.maxTradesPerDay > 0) {
      let ordinal = 1;
      for (const t of ctx.closed) {
        if (t.id === entry.id || (t.account ?? '') !== entry.account || tradingDayNow(t.entryTime) !== day) continue;
        if (t.entryTime < entry.time || (t.entryTime === entry.time && t.id < entry.id)) ordinal++;
      }
      if (ordinal > rules.maxTradesPerDay) out.push(finding('over_max_trades', 'rule', entry, { ordinal, max: rules.maxTradesPerDay }));
    }

    if (ctx.limit && (!ctx.limitAccount || ctx.limitAccount === entry.account)) {
      let realized = 0;
      for (const t of ctx.closed) {
        if (t.id === entry.id || t.exitTime > entry.time || !Number.isFinite(t.pnl) || tradingDayNow(t.exitTime) !== day) continue;
        if (ctx.limitAccount && (t.account ?? '') !== ctx.limitAccount) continue;
        realized += t.pnl;
      }
      const unrealized = Math.min(0, typeof ctx.unrealized === 'number' && Number.isFinite(ctx.unrealized) ? ctx.unrealized : 0);
      const loss = Math.max(0, -(realized + unrealized));
      if (loss >= ctx.limit.amount) out.push(finding('after_daily_limit', 'rule', entry, { loss: round2(loss), limit: ctx.limit.amount, source: ctx.limit.source }));
    }

    if (rules.allowedInstruments.length > 0 && (!symbol || !rules.allowedInstruments.includes(symbol))) {
      out.push(finding('instrument_not_allowed', 'rule', entry, { symbol, allowed: [...rules.allowedInstruments] }));
    }
  }
  return out;
}
