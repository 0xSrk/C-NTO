/**
 * Discipline du trader : ses règles chiffrées, sa perte du jour, ses dérives après une perte et ses
 * écarts aux règles. Pur : le desk lit le journal, le pont et le calendrier, puis appelle ces fonctions.
 * Une règle à 0 (ou une liste vide) est inactive : elle ne signale rien.
 */
import { ET_ZONE, tradingDayKey } from '@/lib/time';
import { resolveSymbol } from './instruments';
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
