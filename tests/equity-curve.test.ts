import { describe, expect, it } from 'vitest';
import { equityCurve } from '../src/engine/equityCurve';
import { computeDailyStats } from '../src/engine/metrics';
import type { Session, Trade } from '../src/engine/types';

function session(id: string, date: string, pnl: number, tradeCount = 1, account = 'Sim101'): Session {
  return { id, date, account, instruments: ['MNQ'], source: 'ninjatrader', tradeCount, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function trade(id: string, sessionId: string, exit: string, pnl: number, instrument = 'MNQ'): Trade {
  const exitTime = Date.parse(exit);
  return { id, sessionId, instrument, direction: 'long', qty: 1, entryTime: exitTime - 60_000, exitTime, entryPrice: 100, exitPrice: 101, pnl, commission: 0 };
}

const at = (date: string) => Date.parse(`${date}T12:00:00Z`) / 1000;

describe('courbe d’équité : grain séance', () => {
  const sessions = [session('a', '2026-09-02', 300), session('b', '2026-09-01', 100), session('c', '2026-09-03', -500), session('d', '2026-09-03', 50, 2, 'Sim102'), session('e', '2026-09-04', 200)];

  it('un pas par date, comptes réunis ; départ la veille ; cumul, plus haut, drawdown', () => {
    const curve = equityCurve(sessions, [], 'session');
    expect(curve.steps.map((s) => [s.date, s.pnl, s.equity, s.peak, s.drawdown, s.trades])).toEqual([
      ['2026-08-31', 0, 0, 0, 0, 0],
      ['2026-09-01', 100, 100, 100, 0, 1],
      ['2026-09-02', 300, 400, 400, 0, 1],
      ['2026-09-03', -450, -50, 400, -450, 3],
      ['2026-09-04', 200, 150, 400, -250, 1],
    ]);
    expect(curve.steps[0]).toMatchObject({ origin: true, at: null, time: at('2026-08-31') });
    expect(curve.steps[1]?.time).toBe(at('2026-09-01'));
    expect(curve.net).toBe(150);
    expect(curve.maxDrawdown).toEqual({ depth: 450, peak: 2, trough: 3 });
  });

  it('même drawdown max que la tuile K.04', () => {
    expect(equityCurve(sessions, [], 'session').maxDrawdown?.depth).toBe(computeDailyStats(sessions, 50_000).maxDrawdown);
  });

  it('une perte d’entrée part du départ ; sans recul, pas de drawdown ; journal vide', () => {
    expect(equityCurve([session('a', '2026-09-01', -80), session('b', '2026-09-02', 30)], [], 'session').maxDrawdown).toEqual({ depth: 80, peak: 0, trough: 1 });
    expect(equityCurve([session('a', '2026-09-01', 80), session('b', '2026-09-02', 30)], [], 'session').maxDrawdown).toBeNull();
    expect(equityCurve([], [], 'session')).toEqual({ grain: 'session', steps: [], net: 0, maxDrawdown: null });
  });
});

describe('courbe d’équité : grain trade', () => {
  const sessions = [session('a', '2026-09-01', 70, 3), session('m', '2026-09-02', -40, 2), session('b', '2026-09-03', 25, 1)];
  const trades = [
    trade('t3', 'a', '2026-09-01T14:30:00.400Z', 50, 'NQ'),
    trade('t1', 'a', '2026-09-01T13:30:00Z', -30),
    trade('t2', 'a', '2026-09-01T14:30:00.100Z', 50),
    trade('t4', 'b', '2026-09-03T15:00:00Z', 25),
  ];

  it('un pas par sortie, dans l’ordre ; deux sorties dans la même seconde restent distinctes', () => {
    const curve = equityCurve(sessions, trades, 'trade');
    const steps = curve.steps.slice(1);
    expect(steps.map((s) => [s.pnl, s.equity, s.drawdown, s.instrument ?? null])).toEqual([
      [-30, -30, -30, 'MNQ'],
      [50, 20, 0, 'MNQ'],
      [50, 70, 0, 'NQ'],
      [-40, 30, -40, null],
      [25, 55, -15, 'MNQ'],
    ]);
    const times = curve.steps.map((s) => s.time);
    expect(times.every((t, i) => i === 0 || t > (times[i - 1] ?? Infinity))).toBe(true);
    expect(steps[1]?.time).toBe(Date.parse('2026-09-01T14:30:00Z') / 1000);
    expect(steps[2]?.time).toBe(Date.parse('2026-09-01T14:30:01Z') / 1000);
    expect(curve.steps[0]).toMatchObject({ origin: true, time: Date.parse('2026-09-01T13:29:00Z') / 1000, equity: 0 });
  });

  it('une séance sans trade (saisie manuelle) reste un pas : même cumul que le grain séance', () => {
    const curve = equityCurve(sessions, trades, 'trade');
    expect(curve.steps[4]).toMatchObject({ date: '2026-09-02', at: Date.parse('2026-09-02T12:00:00Z'), pnl: -40, trades: 2 });
    expect(curve.net).toBe(equityCurve(sessions, trades, 'session').net);
    expect(curve.maxDrawdown).toEqual({ depth: 40, peak: 3, trough: 4 });
  });

  it('un P&L non fini est écarté', () => {
    const curve = equityCurve([session('a', '2026-09-01', 10)], [trade('x', 'a', '2026-09-01T13:00:00Z', Number.NaN), trade('y', 'a', '2026-09-01T13:05:00Z', 10)], 'trade');
    expect(curve.steps.slice(1).map((s) => s.pnl)).toEqual([10]);
  });
});
