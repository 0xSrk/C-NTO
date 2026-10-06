import { describe, expect, it } from 'vitest';
import { calendarSeries, cmeTradingDay, computeDailyStats } from '../src/engine/metrics';
import type { Session } from '../src/engine/types';

const MOTIF = [420, -260, 180, -150, 310, -90, 240, -330, 160, 60];
const weekdays = (date: string) => {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
};
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Motif répété, tradé `perWeek` jours par semaine (du lundi), 52 semaines depuis le lundi 06/01/2025. */
function journal(perWeek: number): Session[] {
  const out: Session[] = [];
  let i = 0;
  for (let week = 0; week < 52; week++) {
    for (let day = 0; day < perWeek; day++) {
      const date = addDays('2025-01-06', week * 7 + day);
      const pnl = MOTIF[i++ % MOTIF.length]!;
      out.push({ id: date, date, account: 'A', instruments: ['NQ'], source: 'csv', tradeCount: 1, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 });
    }
  }
  return out;
}

const PERIOD = { from: '2025-01-06', to: '2026-01-02', isTradingDay: weekdays };

describe('1.2 annualisation sur le vrai calendrier', () => {
  it('Sharpe 3,58 / 3,15 / 2,77 / 2,21 tradé 5, 4, 3 puis 2 jours par semaine', () => {
    const sharpe = [5, 4, 3, 2].map((n) => computeDailyStats(journal(n), 50_000, 20, PERIOD).sharpe);
    expect(sharpe[0]).toBeCloseTo(3.58, 1);
    expect(Math.abs(sharpe[0]! - 3.58)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(sharpe[1]! - 3.15)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(sharpe[2]! - 2.77)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(sharpe[3]! - 2.21)).toBeLessThanOrEqual(0.01);
  });

  it('les jours non tradés de la période comptent à zéro, pour Sortino et Calmar aussi', () => {
    const two = computeDailyStats(journal(2), 50_000, 20, PERIOD);
    const five = computeDailyStats(journal(5), 50_000, 20, PERIOD);
    expect(two.tradingDays).toBe(260);
    expect(two.days).toBe(104);
    expect(five.sortino).toBeGreaterThan(two.sortino);
    // Rendement annualisé = net / capital × 252 / 260 journées de cotation.
    expect(two.calmar).toBeCloseTo(((two.netPnl / 50_000) * (252 / 260)) / two.maxDrawdownPct, 9);
  });

  it('série : zéro les jours de cotation sans séance, rien les week-ends, aucune séance perdue', () => {
    const days = [
      { date: '2026-12-24', pnl: 100 },
      { date: '2026-12-27', pnl: 7 },
      { date: '2026-12-28', pnl: -50 },
    ];
    // Vendredi 25/12/2026 : CME fermé ; dimanche 27 : séance saisie, gardée.
    expect(calendarSeries(days)).toEqual([100, 7, -50]);
    expect(calendarSeries(days, { to: '2026-12-30' })).toEqual([100, 7, -50, 0, 0]);
    expect(calendarSeries(days, { from: '2026-12-28', to: '2026-12-28' })).toEqual([-50, 100, 7]);
    expect(cmeTradingDay('2026-12-25')).toBe(false);
    expect(cmeTradingDay('2026-12-26')).toBe(false);
    expect(cmeTradingDay('2026-12-28')).toBe(true);
    // Labor Day : séance écourtée à 13 h, pas fermée.
    expect(cmeTradingDay('2026-09-07')).toBe(true);
  });
});
