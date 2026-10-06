import { describe, expect, it } from 'vitest';
import { findPlan } from '@/engine/propfirm';
import { tradeRisk } from '@/engine/riskConsole';
import type { Session, Trade } from '@/engine/types';
import { callTool } from './helpers/agentEval';
import { fakePorts } from './helpers/deskPorts';

const AT = Date.parse('2026-09-30T20:00:00Z');
const r = (v: number | null, d: number) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

const session = (id: string, account: string): Session => ({
  id,
  date: '2026-09-30',
  account,
  instruments: ['NQ'],
  source: 'ninjatrader',
  tradeCount: 4,
  pnl: 0,
  grossProfit: 0,
  grossLoss: 0,
  commission: 0,
  tags: [],
  createdAt: AT,
  updatedAt: AT,
});

const trade = (id: string, sessionId: string, account: string, minute: number, over: Partial<Trade>): Trade => ({
  id,
  sessionId,
  instrument: 'MNQ',
  account,
  direction: 'long',
  qty: 2,
  entryTime: AT + minute * 60_000,
  exitTime: AT + (minute + 5) * 60_000,
  entryPrice: 20_000,
  exitPrice: 20_030,
  pnl: 60,
  commission: 0,
  ...over,
});

describe('A6.12 get_session rend le risque et le R de chaque trade, comme l’onglet C', () => {
  // Quatre sources : stop saisi, risque saisi, risque fixe par contrat, aucune.
  const plan = findPlan('topstep-50');
  const trades = (account: string, sid: string): Trade[] => [
    trade(`${sid}_stop`, sid, account, 0, { stopPrice: 19_990, targetPrice: 20_040 }),
    trade(`${sid}_saisi`, sid, account, 10, { risk: 80, pnl: -40, exitPrice: 19_990 }),
    trade(`${sid}_fixe`, sid, account, 20, { pnl: 15, exitPrice: 20_007.5 }),
    trade(`${sid}_nul`, sid, account, 30, { qty: 0, pnl: 0, exitPrice: 20_000 }),
  ];
  const all = [...trades('Sim101', 's_plan'), ...trades('Sim202', 's_autre')];
  const ports = fakePorts({
    sessions: () => [session('s_plan', 'Sim101'), session('s_autre', 'Sim202')],
    trades: () => all,
    startingBalance: () => 50_000,
    planId: () => 'topstep-50',
    planAccount: () => 'Sim101',
    riskPerContract: () => 25,
  });

  type Row = { id: string; stopPrice?: number; targetPrice?: number; risk: { amount: number | null; source: string; plannedRr: number | null; realizedR: number | null; capitalShare: number | null } };
  type Out = { riskCapital: { amount: number; basis: string }; trades: Row[] };

  const expected = (list: Trade[], capital: number) =>
    list.map((t) => {
      const risk = tradeRisk(t, 25, capital);
      return {
        id: t.id,
        ...(t.stopPrice != null ? { stopPrice: t.stopPrice } : {}),
        ...(t.targetPrice != null ? { targetPrice: t.targetPrice } : {}),
        risk: { amount: r(risk.risk, 2), source: risk.source, plannedRr: r(risk.plannedRr, 2), realizedR: r(risk.realizedR, 2), capitalShare: r(risk.lossPct, 4) },
      };
    });

  it('compte suivi par le plan : capital = perte maximale du plan', async () => {
    const out = await callTool<Out>(ports, 'get_session', { id: 's_plan' });
    expect(plan?.maxDrawdown).toBe(2_000);
    expect(out.riskCapital).toEqual({ amount: 2_000, basis: 'plan' });
    const rows = out.trades.map((t) => ({ id: t.id, ...(t.stopPrice != null ? { stopPrice: t.stopPrice } : {}), ...(t.targetPrice != null ? { targetPrice: t.targetPrice } : {}), risk: t.risk }));
    expect(rows).toEqual(expected(trades('Sim101', 's_plan'), 2_000));
    // Les quatre sources sont lues : la comparaison n'est pas vide.
    expect(out.trades.map((t) => t.risk.source)).toEqual(['stop', 'saisi', 'fixe', 'absent']);
  });

  it('autre compte : capital de référence', async () => {
    const out = await callTool<Out>(ports, 'get_session', { id: 's_autre' });
    expect(out.riskCapital).toEqual({ amount: 50_000, basis: 'reference' });
    const rows = out.trades.map((t) => ({ id: t.id, ...(t.stopPrice != null ? { stopPrice: t.stopPrice } : {}), ...(t.targetPrice != null ? { targetPrice: t.targetPrice } : {}), risk: t.risk }));
    expect(rows).toEqual(expected(trades('Sim202', 's_autre'), 50_000));
  });
});
