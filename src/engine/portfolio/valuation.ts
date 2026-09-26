import type { PropPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { convertAmount } from './fx';
import { bridgeIsFresh } from './fx';
import { positionMultiplier } from './price';
import { propDistance } from './risk';
import type { BridgeSnapshot, CashBalance, Coeur, FxRate, Pocket, PocketValuation, Position, ValuationMark } from './types';
import { isTraditionalKind } from './types';

export interface ValuationContext {
  now: number;
  sessions: readonly Session[];
  trades: readonly Trade[];
  plan?: PropPlan;
  bridgeSnapshot?: BridgeSnapshot | null;
  positions: readonly Position[];
  cash: readonly CashBalance[];
  fx: readonly FxRate[];
  base: string;
  /** Prix d'un port déjà ouvert. Le portefeuille n'en crée pas. */
  quotes?: ReadonlyMap<string, number>;
}

export function sumAccountPnl(sessions: readonly Session[], account: string | undefined): number {
  const key = account ?? '';
  let n = 0;
  for (const s of sessions) {
    if ((s.account ?? '') !== key || !Number.isFinite(s.pnl)) continue;
    n += s.pnl;
  }
  return n;
}

function positionsOf(pocketId: string, positions: readonly Position[]): Position[] {
  return positions.filter((p) => p.pocketId === pocketId);
}

function cashOf(pocketId: string, cash: readonly CashBalance[]): CashBalance[] {
  return cash.filter((c) => c.pocketId === pocketId);
}

interface NativeBook {
  ok: true;
  equity: number;
  unrealized: number | null;
  mark: ValuationMark;
}

function addConverted(total: number, amount: number, currency: string, pocketCcy: string, fx: readonly FxRate[]): { ok: true; value: number } | { ok: false; reason: string } {
  const c = convertAmount(amount, currency, pocketCcy, fx);
  if (!c.ok) return c;
  return { ok: true, value: total + c.value };
}

function traditionalBook(pocket: Pocket, ctx: ValuationContext): NativeBook | { ok: false; reason: string } {
  const lines = positionsOf(pocket.id, ctx.positions);
  let equity = 0;
  let unrealized = 0;
  let unmarked = false;
  let marked = false;
  for (const line of lines) {
    const mult = positionMultiplier(line);
    if (line.closedAt != null) {
      const realized = line.realizedPnl ?? 0;
      const next = addConverted(equity, realized, line.currency, pocket.currency, ctx.fx);
      if (!next.ok) return next;
      equity = next.value;
      continue;
    }
    const quote = ctx.quotes?.get(line.symbol);
    const px = quote != null && Number.isFinite(quote) ? quote : line.lastPrice;
    const price = px != null && Number.isFinite(px) ? px : line.avgPrice;
    const next = addConverted(equity, line.quantity * price * mult, line.currency, pocket.currency, ctx.fx);
    if (!next.ok) return next;
    equity = next.value;
    if (px == null || !Number.isFinite(px)) unmarked = true;
    else {
      marked = true;
      const u = addConverted(unrealized, line.quantity * (px - line.avgPrice) * mult, line.currency, pocket.currency, ctx.fx);
      if (!u.ok) return u;
      unrealized = u.value;
    }
  }
  for (const row of cashOf(pocket.id, ctx.cash)) {
    const next = addConverted(equity, row.amount, row.currency, pocket.currency, ctx.fx);
    if (!next.ok) return next;
    equity = next.value;
  }
  const mark: ValuationMark = unmarked || !marked ? 'prix de revient' : 'saisi';
  return { ok: true, equity, unrealized: unmarked ? null : marked ? unrealized : null, mark };
}

function cashOnly(pocket: Pocket, ctx: ValuationContext): NativeBook | { ok: false; reason: string } {
  let equity = 0;
  for (const row of cashOf(pocket.id, ctx.cash)) {
    const next = addConverted(equity, row.amount, row.currency, pocket.currency, ctx.fx);
    if (!next.ok) return next;
    equity = next.value;
  }
  return { ok: true, equity, unrealized: null, mark: 'saisi' };
}

function freshBridge(pocket: Pocket, ctx: ValuationContext): BridgeSnapshot | null {
  const snap = ctx.bridgeSnapshot;
  if (!snap || snap.account !== (pocket.account ?? '')) return null;
  if (!bridgeIsFresh(snap.at, ctx.now)) return null;
  if (!Number.isFinite(snap.cashValue) || !Number.isFinite(snap.unrealizedPnl)) return null;
  return snap;
}

function excluded(pocket: Pocket, reason: string, native: number | null = null): PocketValuation {
  return {
    pocketId: pocket.id,
    kind: pocket.kind,
    currency: pocket.currency,
    nativeEquity: native,
    equityBase: null,
    unrealized: null,
    mark: 'journal',
    reason,
  };
}

function toBase(pocket: Pocket, native: number, ctx: ValuationContext, mark: ValuationMark, unrealized: number | null, prop?: PocketValuation['prop']): PocketValuation {
  const base = convertAmount(native, pocket.currency, ctx.base, ctx.fx);
  if (!base.ok) return { ...excluded(pocket, base.reason, native), mark, unrealized, prop };
  return {
    pocketId: pocket.id,
    kind: pocket.kind,
    currency: pocket.currency,
    nativeEquity: native,
    equityBase: base.value,
    unrealized,
    mark,
    prop,
  };
}

/** Valorise une poche. Le pont vivant (moins de 60 s) remplace le journal : le réalisé n'est pas compté deux fois. */
export function valuePocket(pocket: Pocket, ctx: ValuationContext): PocketValuation {
  if (pocket.kind === 'crypto') return excluded(pocket, 'crypto hors périmètre');

  if (pocket.kind === 'propfirm') {
    if (!ctx.plan) return excluded(pocket, 'plan manquant');
    const prop = propDistance(ctx.plan, ctx.sessions, ctx.trades, pocket.account);
    const live = freshBridge(pocket, ctx);
    if (live) return toBase(pocket, live.cashValue + live.unrealizedPnl, ctx, 'pont', live.unrealizedPnl, prop);
    const native = ctx.plan.accountSize + sumAccountPnl(ctx.sessions, pocket.account);
    return toBase(pocket, native, ctx, 'journal', null, prop);
  }

  if (pocket.kind === 'futures') {
    const live = freshBridge(pocket, ctx);
    if (live) return toBase(pocket, live.cashValue + live.unrealizedPnl, ctx, 'pont', live.unrealizedPnl);
    const cash = cashOnly(pocket, ctx);
    if (!cash.ok) return excluded(pocket, cash.reason);
    return toBase(pocket, cash.equity + sumAccountPnl(ctx.sessions, pocket.account), ctx, 'journal', null);
  }

  if (pocket.kind === 'liquidites') {
    const cash = cashOnly(pocket, ctx);
    if (!cash.ok) return excluded(pocket, cash.reason);
    return toBase(pocket, cash.equity, ctx, 'saisi', null);
  }

  if (isTraditionalKind(pocket.kind)) {
    const book = traditionalBook(pocket, ctx);
    if (!book.ok) return excluded(pocket, book.reason);
    return toBase(pocket, book.equity, ctx, book.mark, book.unrealized);
  }

  return excluded(pocket, 'type de poche inconnu');
}

export function consolidate(valuations: readonly PocketValuation[], base: string, asOf: number): Coeur {
  let netValue = 0;
  const excluded: Coeur['excluded'] = [];
  for (const v of valuations) {
    if (v.equityBase == null) excluded.push({ pocketId: v.pocketId, reason: v.reason ?? 'exclue' });
    else netValue += v.equityBase;
  }
  return { netValue, currency: base, byPocket: [...valuations], excluded, asOf };
}
