import { describe, expect, it } from 'vitest';
import { groupIntoSessions } from '../src/engine/import/ninjatrader';
import { computeTradeStats, dayHourGrid, sessionDates, tradeDay, WEEKDAY_KEYS } from '../src/engine/metrics';
import type { Trade } from '../src/engine/types';

/** Heure de New York (EDT, UTC−4 fin septembre) → epoch ms. */
const et = (iso: string) => Date.parse(`${iso}-04:00`);

function trade(id: string, entry: string, exit: string, pnl: number): Trade {
  return { id, sessionId: '', instrument: 'NQ', account: 'A', direction: 'long', qty: 1, entryTime: et(entry), exitTime: et(exit), entryPrice: 20000, exitPrice: 20000 + pnl / 20, pnl, commission: 0 };
}

/** 1.1 : un trade du dimanche soir et un du lundi 20 h appartiennent aux séances du lundi et du mardi. */
const TRADES = [
  trade('dim', '2026-09-27T19:05:00', '2026-09-27T19:40:00', 500),
  trade('lun', '2026-09-28T10:00:00', '2026-09-28T10:20:00', 100),
  trade('soir', '2026-09-28T20:10:00', '2026-09-28T20:50:00', -300),
];

describe('1.1 une seule définition de la journée', () => {
  const trades = TRADES.map((t) => ({ ...t }));
  const sessions = groupIntoSessions(trades, 18, 'csv');
  const days = sessionDates(sessions);

  it('Séances : 28/09 = +600 $, 29/09 = −300 $', () => {
    expect(sessions.map((s) => [s.date, s.pnl])).toEqual([
      ['2026-09-28', 600],
      ['2026-09-29', -300],
    ]);
  });

  it('Analyse : mêmes sommes par jour que les séances, avec ou sans la carte des séances', () => {
    for (const map of [days, undefined]) {
      const byDay = Object.fromEntries(computeTradeStats(trades, map).byWeekday.filter((b) => b.count).map((b) => [b.key, b.pnl]));
      expect(byDay).toEqual({ lun: 600, mar: -300 });
      const grid = dayHourGrid(trades, map);
      const sum = (dow: number) => grid.filter((c) => c.dow === dow).reduce((acc, c) => acc + c.pnl, 0);
      expect([sum(1), sum(2), sum(0)]).toEqual([600, -300, 0]);
    }
  });

  it('trame : jour de la séance, heure d’entrée à New York', () => {
    const cells = dayHourGrid(trades, days)
      .map((c) => [WEEKDAY_KEYS[c.dow], c.hour, c.pnl])
      .sort((a, b) => String(a).localeCompare(String(b)));
    expect(cells).toEqual([
      ['lun', 10, 100],
      ['lun', 19, 500],
      ['mar', 20, -300],
    ]);
  });

  it('la date de séance l’emporte ; sans elle, journée CME de l’instrument à la sortie', () => {
    expect(tradeDay(trades[0]!, '2026-09-30')).toBe('2026-09-30');
    expect(TRADES.map((t) => tradeDay(t))).toEqual(['2026-09-28', '2026-09-28', '2026-09-29']);
    expect(tradeDay({ ...TRADES[2]!, instrument: 'ZZZ' })).toBe('2026-09-29');
  });
});
