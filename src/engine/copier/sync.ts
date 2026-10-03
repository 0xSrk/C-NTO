import type { PropPlan } from '../propfirm';
import type { Session, Trade } from '../types';
import type { FollowerState } from './router';
import type { CopierConfig, CopierSizing, CopierTopology, FollowerRule, SymbolMap } from './types';

export interface CopierSync {
  topology: CopierTopology;
  states: FollowerState[];
  catalysts: { at: number }[];
  maxContractsPerOrder: number;
  flattenOnCut: boolean;
}

const SIZING = new Set(['fixe', 'ratio', 'risque']);
const DRAWDOWN = new Set(['eod-trailing', 'intraday-trailing', 'static']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function symbolMap(raw: unknown): SymbolMap | null {
  if (!isRecord(raw)) return null;
  if (raw.mode === 'identique' || raw.mode === 'micro' || raw.mode === 'standard') return { mode: raw.mode };
  if (raw.mode === 'explicite') {
    const from = str(raw.from, 32);
    const to = str(raw.to, 32);
    if (!from || !to) return null;
    return { mode: 'explicite', from, to };
  }
  return null;
}

function sizing(raw: unknown): CopierSizing | null {
  if (!isRecord(raw) || !SIZING.has(String(raw.mode))) return null;
  const value = raw.value;
  const maxContracts = raw.maxContracts;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (typeof maxContracts !== 'number' || !Number.isInteger(maxContracts) || maxContracts < 1 || maxContracts > 1000) return null;
  return { mode: raw.mode as CopierSizing['mode'], value, maxContracts };
}

function planOf(raw: unknown): PropPlan | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, 64);
  const drawdownType = raw.drawdownType;
  const phase = raw.phase;
  if (!id || !DRAWDOWN.has(String(drawdownType))) return null;
  if (phase !== 'evaluation' && phase !== 'funded') return null;
  const accountSize = raw.accountSize;
  const maxDrawdown = raw.maxDrawdown;
  const profitTarget = raw.profitTarget;
  const version = raw.version;
  if (typeof accountSize !== 'number' || typeof maxDrawdown !== 'number' || typeof profitTarget !== 'number' || typeof version !== 'number') return null;
  if (!Number.isFinite(accountSize) || !Number.isFinite(maxDrawdown) || maxDrawdown <= 0 || !Number.isFinite(profitTarget)) return null;
  const plan: PropPlan = {
    id,
    firm: typeof raw.firm === 'string' ? raw.firm : '',
    label: typeof raw.label === 'string' ? raw.label : id,
    accountSize,
    profitTarget,
    maxDrawdown,
    drawdownType: drawdownType as PropPlan['drawdownType'],
    phase,
    version,
    source: raw.source === 'user' ? 'user' : 'bundled',
  };
  if (typeof raw.trailingLockAt === 'number') plan.trailingLockAt = raw.trailingLockAt;
  if (typeof raw.dailyLossLimit === 'number') plan.dailyLossLimit = raw.dailyLossLimit;
  if (typeof raw.consistencyPct === 'number') plan.consistencyPct = raw.consistencyPct;
  if (typeof raw.minTradingDays === 'number') plan.minTradingDays = raw.minTradingDays;
  return plan;
}

function sessionOf(raw: unknown): Session | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, 80);
  const date = str(raw.date, 10);
  if (!id || !date || typeof raw.pnl !== 'number' || !Number.isFinite(raw.pnl)) return null;
  const tradeCount = typeof raw.tradeCount === 'number' && Number.isFinite(raw.tradeCount) ? raw.tradeCount : 0;
  return {
    id,
    date,
    account: typeof raw.account === 'string' ? raw.account : undefined,
    instruments: ['NQ'],
    source: 'ninjatrader',
    tradeCount,
    pnl: raw.pnl,
    grossProfit: typeof raw.grossProfit === 'number' ? raw.grossProfit : Math.max(0, raw.pnl),
    grossLoss: typeof raw.grossLoss === 'number' ? raw.grossLoss : Math.min(0, raw.pnl),
    commission: typeof raw.commission === 'number' ? raw.commission : 0,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function tradeOf(raw: unknown): Trade | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, 80);
  const sessionId = str(raw.sessionId, 80);
  if (!id || !sessionId || typeof raw.pnl !== 'number' || !Number.isFinite(raw.pnl)) return null;
  return {
    id,
    sessionId,
    instrument: typeof raw.instrument === 'string' ? raw.instrument : 'NQ',
    account: typeof raw.account === 'string' ? raw.account : undefined,
    direction: raw.direction === 'short' ? 'short' : 'long',
    qty: typeof raw.qty === 'number' ? raw.qty : 1,
    entryTime: typeof raw.entryTime === 'number' ? raw.entryTime : 0,
    exitTime: typeof raw.exitTime === 'number' ? raw.exitTime : 0,
    entryPrice: typeof raw.entryPrice === 'number' ? raw.entryPrice : 0,
    exitPrice: typeof raw.exitPrice === 'number' ? raw.exitPrice : 0,
    pnl: raw.pnl,
    commission: typeof raw.commission === 'number' ? raw.commission : 0,
  };
}

function hhmm(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : fallback;
}

/**
 * Charge utile IPC du renderer. Les suiveurs qui ne commencent pas par `Sim` sont écartés.
 * `null` si le maître ou le plafond est illisible.
 */
export function coerceCopierSync(raw: unknown): CopierSync | null {
  if (!isRecord(raw)) return null;
  const masterAccount = typeof raw.masterAccount === 'string' ? raw.masterAccount.trim() : null;
  const maxContractsPerOrder = raw.maxContractsPerOrder;
  if (masterAccount === null || masterAccount.length > 128) return null;
  if (typeof maxContractsPerOrder !== 'number' || !Number.isInteger(maxContractsPerOrder) || maxContractsPerOrder < 1 || maxContractsPerOrder > 1000) return null;
  const followersIn = Array.isArray(raw.followers) ? raw.followers.slice(0, 32) : [];
  const followers: FollowerRule[] = [];
  const states: FollowerState[] = [];
  for (const row of followersIn) {
    if (!isRecord(row)) continue;
    const account = str(row.account, 128);
    const ruleSizing = sizing(row.sizing);
    const map = symbolMap(row.symbolMap);
    if (!account || !account.startsWith('Sim') || !ruleSizing || !map) continue;
    followers.push({ account, sizing: ruleSizing, symbolMap: map });
    const sessions = Array.isArray(row.sessions) ? row.sessions.slice(0, 1000).map(sessionOf).filter((s): s is Session => s !== null) : [];
    const trades = Array.isArray(row.trades) ? row.trades.slice(0, 5000).map(tradeOf).filter((t): t is Trade => t !== null) : [];
    states.push({ account, plan: planOf(row.plan), sessions, trades });
  }
  const catalysts = Array.isArray(raw.catalysts)
    ? raw.catalysts
        .slice(0, 64)
        .map((row) => (isRecord(row) && typeof row.at === 'number' && Number.isFinite(row.at) ? { at: row.at } : null))
        .filter((row): row is { at: number } => row !== null)
    : [];
  const latency = typeof raw.latencyBudgetMs === 'number' && Number.isFinite(raw.latencyBudgetMs) ? Math.min(60_000, Math.max(0, raw.latencyBudgetMs)) : 250;
  const floor = typeof raw.followerBufferFloor === 'number' && Number.isFinite(raw.followerBufferFloor) ? Math.min(1, Math.max(0, raw.followerBufferFloor)) : 0.3;
  return {
    topology: {
      masterAccount,
      followers,
      latencyBudgetMs: latency,
      newsBlackout: raw.newsBlackout !== false,
      windowStart: hhmm(raw.windowStart, '15:30'),
      windowEnd: hhmm(raw.windowEnd, '17:30'),
      followerBufferFloor: floor,
    },
    states,
    catalysts,
    maxContractsPerOrder,
    flattenOnCut: raw.flattenOnCut === true,
  };
}

export interface PackAccount {
  role: 'maitre' | 'suiveur';
  ntAccount: string;
  enabled: boolean;
  sizing: CopierSizing;
  symbolMap: SymbolMap;
  planId?: string;
}

/** Objet JSON que `coerceCopierSync` relit. Un seul maître actif. */
export function packCopierSync(input: {
  accounts: PackAccount[];
  config: CopierConfig;
  sessions: Session[];
  trades: Trade[];
  planById: (id: string) => PropPlan | undefined;
  catalysts: { at: number }[];
  maxContractsPerOrder: number;
}): Record<string, unknown> {
  const masters = input.accounts.filter((account) => account.enabled && account.role === 'maitre' && account.ntAccount.trim());
  const master = masters.length === 1 ? masters[0] : undefined;
  const followers = master ? input.accounts.filter((account) => account.enabled && account.role === 'suiveur' && account.ntAccount.startsWith('Sim')) : [];
  return {
    masterAccount: master ? master.ntAccount.trim() : '',
    latencyBudgetMs: input.config.latencyBudgetMs,
    newsBlackout: input.config.newsBlackout,
    windowStart: input.config.windowStart,
    windowEnd: input.config.windowEnd,
    followerBufferFloor: input.config.followerBufferFloor,
    flattenOnCut: input.config.flattenOnCut,
    maxContractsPerOrder: input.maxContractsPerOrder,
    catalysts: input.catalysts,
    followers: followers.map((account) => {
      const name = account.ntAccount.trim();
      const sessions = input.sessions.filter((session) => (session.account ?? '') === name);
      const ids = new Set(sessions.map((session) => session.id));
      return {
        account: name,
        sizing: account.sizing,
        symbolMap: account.symbolMap,
        plan: account.planId ? input.planById(account.planId) ?? null : null,
        sessions,
        trades: input.trades.filter((trade) => ids.has(trade.sessionId)),
      };
    }),
  };
}
