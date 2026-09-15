import type { Session, Trade } from './types';

export type DrawdownType = 'eod-trailing' | 'intraday-trailing' | 'static';

export interface PropPlan {
  id: string;
  firm: string;
  label: string;
  accountSize: number;
  profitTarget: number;
  maxDrawdown: number;
  drawdownType: DrawdownType;
  /** Le plancher cesse de suivre une fois arrivé à solde initial + lock (ex. +100 $) */
  trailingLockAt?: number;
  dailyLossLimit?: number;
  /** 0.3 ⇒ le meilleur jour ne peut dépasser 30 % du profit total */
  consistencyPct?: number;
  minTradingDays?: number;
  phase: 'evaluation' | 'funded';
  note?: string;
}

export interface PropFirm {
  id: string;
  name: string;
  country: string;
  platform: string[];
  payoutNote: string;
  plans: PropPlan[];
}

export const DRAWDOWN_LABEL: Record<DrawdownType, string> = {
  'eod-trailing': 'Trailing fin de journée',
  'intraday-trailing': 'Trailing intrajournalier',
  static: 'Statique',
};

/**
 * Registre indicatif des firmes de prop trading futures (CME) fréquentes chez les traders Nasdaq.
 * Les règles évoluent régulièrement : chaque plan est éditable et doit être validé par le trader
 * avant toute décision. Aucune valeur ici ne constitue une garantie.
 */
export const PROP_FIRMS: PropFirm[] = [
  {
    id: 'topstep',
    name: 'Topstep',
    country: 'US',
    platform: ['NinjaTrader', 'Tradovate', 'TopstepX'],
    payoutNote: 'Express Funded Account après Combine. Payouts hebdomadaires selon règles du compte.',
    plans: [
      { id: 'topstep-50', firm: 'Topstep', label: 'Combine 50K', accountSize: 50_000, profitTarget: 3_000, maxDrawdown: 2_000, drawdownType: 'eod-trailing', minTradingDays: 2, phase: 'evaluation' },
      { id: 'topstep-100', firm: 'Topstep', label: 'Combine 100K', accountSize: 100_000, profitTarget: 6_000, maxDrawdown: 3_000, drawdownType: 'eod-trailing', minTradingDays: 2, phase: 'evaluation' },
      { id: 'topstep-150', firm: 'Topstep', label: 'Combine 150K', accountSize: 150_000, profitTarget: 9_000, maxDrawdown: 4_500, drawdownType: 'eod-trailing', minTradingDays: 2, phase: 'evaluation' },
    ],
  },
  {
    id: 'apex',
    name: 'Apex Trader Funding',
    country: 'US',
    platform: ['NinjaTrader', 'Rithmic', 'Tradovate'],
    payoutNote: 'Compte PA après évaluation ; règle de consistance 30 % sur les demandes de payout.',
    plans: [
      { id: 'apex-25', firm: 'Apex', label: 'Full 25K', accountSize: 25_000, profitTarget: 1_500, maxDrawdown: 1_500, drawdownType: 'intraday-trailing', trailingLockAt: 100, consistencyPct: 0.3, minTradingDays: 1, phase: 'evaluation' },
      { id: 'apex-50', firm: 'Apex', label: 'Full 50K', accountSize: 50_000, profitTarget: 3_000, maxDrawdown: 2_500, drawdownType: 'intraday-trailing', trailingLockAt: 100, consistencyPct: 0.3, minTradingDays: 1, phase: 'evaluation' },
      { id: 'apex-100', firm: 'Apex', label: 'Full 100K', accountSize: 100_000, profitTarget: 6_000, maxDrawdown: 3_000, drawdownType: 'intraday-trailing', trailingLockAt: 100, consistencyPct: 0.3, minTradingDays: 1, phase: 'evaluation' },
      { id: 'apex-150', firm: 'Apex', label: 'Full 150K', accountSize: 150_000, profitTarget: 9_000, maxDrawdown: 5_000, drawdownType: 'intraday-trailing', trailingLockAt: 100, consistencyPct: 0.3, minTradingDays: 1, phase: 'evaluation' },
      { id: 'apex-100s', firm: 'Apex', label: 'Static 100K', accountSize: 100_000, profitTarget: 2_000, maxDrawdown: 625, drawdownType: 'static', consistencyPct: 0.3, minTradingDays: 1, phase: 'evaluation' },
    ],
  },
  {
    id: 'mffu',
    name: 'MyFundedFutures',
    country: 'US',
    platform: ['NinjaTrader', 'Tradovate', 'Rithmic'],
    payoutNote: 'Plans Starter / Expert ; règle de consistance selon plan.',
    plans: [
      { id: 'mffu-50', firm: 'MyFundedFutures', label: 'Starter 50K', accountSize: 50_000, profitTarget: 3_000, maxDrawdown: 2_000, drawdownType: 'eod-trailing', consistencyPct: 0.4, minTradingDays: 1, phase: 'evaluation' },
      { id: 'mffu-100', firm: 'MyFundedFutures', label: 'Starter 100K', accountSize: 100_000, profitTarget: 6_000, maxDrawdown: 3_000, drawdownType: 'eod-trailing', consistencyPct: 0.4, minTradingDays: 1, phase: 'evaluation' },
      { id: 'mffu-150', firm: 'MyFundedFutures', label: 'Starter 150K', accountSize: 150_000, profitTarget: 9_000, maxDrawdown: 4_500, drawdownType: 'eod-trailing', consistencyPct: 0.4, minTradingDays: 1, phase: 'evaluation' },
    ],
  },
  {
    id: 'tpt',
    name: 'Take Profit Trader',
    country: 'US',
    platform: ['NinjaTrader', 'Tradovate', 'Rithmic'],
    payoutNote: 'Compte PRO après test ; retraits quotidiens possibles selon règles.',
    plans: [
      { id: 'tpt-50', firm: 'Take Profit Trader', label: 'Test 50K', accountSize: 50_000, profitTarget: 3_000, maxDrawdown: 2_000, drawdownType: 'eod-trailing', dailyLossLimit: 1_100, minTradingDays: 5, phase: 'evaluation' },
      { id: 'tpt-100', firm: 'Take Profit Trader', label: 'Test 100K', accountSize: 100_000, profitTarget: 6_000, maxDrawdown: 3_000, drawdownType: 'eod-trailing', dailyLossLimit: 2_200, minTradingDays: 5, phase: 'evaluation' },
      { id: 'tpt-150', firm: 'Take Profit Trader', label: 'Test 150K', accountSize: 150_000, profitTarget: 9_000, maxDrawdown: 4_500, drawdownType: 'eod-trailing', dailyLossLimit: 3_300, minTradingDays: 5, phase: 'evaluation' },
    ],
  },
  {
    id: 'tradeify',
    name: 'Tradeify',
    country: 'US',
    platform: ['NinjaTrader', 'Tradovate'],
    payoutNote: 'Plans Growth / Select / Lightning avec règles distinctes.',
    plans: [
      { id: 'tradeify-50', firm: 'Tradeify', label: 'Growth 50K', accountSize: 50_000, profitTarget: 3_000, maxDrawdown: 2_000, drawdownType: 'eod-trailing', consistencyPct: 0.35, minTradingDays: 1, phase: 'evaluation' },
      { id: 'tradeify-100', firm: 'Tradeify', label: 'Growth 100K', accountSize: 100_000, profitTarget: 6_000, maxDrawdown: 3_000, drawdownType: 'eod-trailing', consistencyPct: 0.35, minTradingDays: 1, phase: 'evaluation' },
    ],
  },
  {
    id: 'e2t',
    name: 'Earn2Trade',
    country: 'US',
    platform: ['NinjaTrader', 'Rithmic'],
    payoutNote: 'Gauntlet Mini ; compte financé chez un partenaire après réussite.',
    plans: [
      { id: 'e2t-50', firm: 'Earn2Trade', label: 'Gauntlet Mini 50K', accountSize: 50_000, profitTarget: 3_000, maxDrawdown: 2_000, drawdownType: 'eod-trailing', dailyLossLimit: 1_100, minTradingDays: 10, phase: 'evaluation' },
      { id: 'e2t-100', firm: 'Earn2Trade', label: 'Gauntlet Mini 100K', accountSize: 100_000, profitTarget: 6_000, maxDrawdown: 3_500, drawdownType: 'eod-trailing', dailyLossLimit: 2_200, minTradingDays: 10, phase: 'evaluation' },
    ],
  },
];

export function findPlan(id: string): PropPlan | undefined {
  for (const f of PROP_FIRMS) {
    const p = f.plans.find((pl) => pl.id === id);
    if (p) return p;
  }
  return undefined;
}

export interface PropTimelinePoint {
  date: string;
  dayPnl: number;
  balance: number;
  floor: number;
  intradayLow: number;
  intradayHigh: number;
  breached: boolean;
  dailyLossBreached: boolean;
}

export interface PropEvaluation {
  status: 'en-cours' | 'objectif' | 'echec';
  reason?: string;
  failedOn?: string;
  startBalance: number;
  balance: number;
  highWater: number;
  floor: number;
  buffer: number;
  targetProgress: number;
  remainingToTarget: number;
  daysTraded: number;
  consistency: { bestDay: number; share: number; limit: number | null; ok: boolean };
  dailyLossBreaches: string[];
  timeline: PropTimelinePoint[];
}

/**
 * Rejoue une suite de séances contre les règles d'un plan.
 * - Le plancher (floor) est le seuil de solde qui invalide le compte.
 * - Le trailing intrajournalier utilise le chemin intraday reconstruit à partir des trades
 *   (cumul après chaque trade, élargi par MFE/MAE si disponibles).
 */
export function evaluatePlan(plan: PropPlan, sessionsInput: Session[], trades: Trade[] = []): PropEvaluation {
  const sessions = [...sessionsInput].sort((a, b) => a.date.localeCompare(b.date));
  const tradesBySession = new Map<string, Trade[]>();
  for (const t of trades) {
    const arr = tradesBySession.get(t.sessionId);
    if (arr) arr.push(t);
    else tradesBySession.set(t.sessionId, [t]);
  }

  const start = plan.accountSize;
  const lockFloor = plan.trailingLockAt !== undefined ? start + plan.trailingLockAt : Infinity;
  let balance = start;
  let highWater = start;
  let floor = start - plan.maxDrawdown;
  let status: PropEvaluation['status'] = 'en-cours';
  let reason: string | undefined;
  let failedOn: string | undefined;
  const dailyLossBreaches: string[] = [];
  const timeline: PropTimelinePoint[] = [];
  let daysTraded = 0;

  for (const s of sessions) {
    if (status === 'echec') break;
    const dayTrades = (tradesBySession.get(s.id) ?? []).sort((a, b) => a.exitTime - b.exitTime);
    if (s.tradeCount > 0 || dayTrades.length > 0) daysTraded++;

    let cum = 0;
    let intradayLow = 0;
    let intradayHigh = 0;
    let breached = false;
    let dayFloor = floor;
    for (const t of dayTrades) {
      const adverse = cum - (t.mae ?? Math.max(0, -t.pnl));
      const favorable = cum + (t.mfe ?? Math.max(0, t.pnl));
      if (adverse < intradayLow) intradayLow = adverse;
      if (favorable > intradayHigh) intradayHigh = favorable;
      // L'ordre MAE/MFE au sein d'un trade est inconnu : l'excursion adverse est testée contre
      // le plancher en vigueur à l'entrée, la clôture contre le plancher mis à jour par le pic.
      if (balance + adverse <= dayFloor) breached = true;
      if (plan.drawdownType === 'intraday-trailing') {
        const peak = balance + intradayHigh;
        if (peak > highWater) highWater = peak;
        const candidate = Math.min(highWater - plan.maxDrawdown, lockFloor);
        if (candidate > dayFloor) dayFloor = candidate;
      }
      cum += t.pnl;
      if (cum < intradayLow) intradayLow = cum;
      if (cum > intradayHigh) intradayHigh = cum;
      if (balance + cum <= dayFloor) breached = true;
    }
    if (dayTrades.length === 0) {
      cum = s.pnl;
      intradayLow = Math.min(0, s.pnl);
      intradayHigh = Math.max(0, s.pnl);
    }
    floor = dayFloor;
    balance += cum;
    if (balance <= floor) breached = true;

    const dailyLossBreached = plan.dailyLossLimit !== undefined && -intradayLow >= plan.dailyLossLimit;
    if (dailyLossBreached) dailyLossBreaches.push(s.date);

    if (balance > highWater) highWater = balance;
    if (plan.drawdownType === 'eod-trailing') {
      floor = Math.max(floor, Math.min(highWater - plan.maxDrawdown, lockFloor));
    } else if (plan.drawdownType === 'intraday-trailing') {
      floor = Math.max(floor, Math.min(highWater - plan.maxDrawdown, lockFloor));
    }

    timeline.push({ date: s.date, dayPnl: cum, balance, floor, intradayLow, intradayHigh, breached, dailyLossBreached });

    if (breached) {
      status = 'echec';
      reason = `Drawdown maximal touché (${DRAWDOWN_LABEL[plan.drawdownType].toLowerCase()})`;
      failedOn = s.date;
    } else if (dailyLossBreached && plan.phase === 'evaluation') {
      status = 'echec';
      reason = 'Limite de perte journalière dépassée';
      failedOn = s.date;
    }
  }

  const profit = balance - start;
  const positives = timeline.filter((p) => p.dayPnl > 0).map((p) => p.dayPnl);
  const bestDay = positives.length ? Math.max(...positives) : 0;
  const share = profit > 0 ? bestDay / profit : 0;
  const limit = plan.consistencyPct ?? null;
  const consistencyOk = limit === null || profit <= 0 || share <= limit;

  if (status !== 'echec') {
    const minDays = plan.minTradingDays ?? 0;
    if (profit >= plan.profitTarget && consistencyOk && daysTraded >= minDays) status = 'objectif';
  }

  return {
    status,
    reason,
    failedOn,
    startBalance: start,
    balance,
    highWater,
    floor,
    buffer: balance - floor,
    targetProgress: Math.max(0, Math.min(1, profit / plan.profitTarget)),
    remainingToTarget: Math.max(0, plan.profitTarget - profit),
    daysTraded,
    consistency: { bestDay, share, limit, ok: consistencyOk },
    dailyLossBreaches,
    timeline,
  };
}
