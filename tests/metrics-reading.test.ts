import { describe, expect, it } from 'vitest';
import { generateDemoJournal } from '@/engine/demo';
import {
  addCalendarDays,
  comparableSet,
  daySide,
  decomposeExact,
  labelRelease,
  laggedValue,
  readAxis,
  releaseContrast,
  semiOpenClasses,
  tailLoss,
  tradingDaysBetween,
  weekdayKey,
  type ReadingSample,
} from '@/engine/contextReading';
import { sessionDates } from '@/engine/metrics';
import type { DayContext } from '@/engine/metricsContext';
import { pointsPerContract } from '@/engine/tradeUnits';
import { ET_ZONE, zonedWallClock } from '@/lib/time';

describe('lecture par contexte', () => {
  it('retrouve exactement le gain moyen par journée', () => {
    const rows = [
      { date: '2026-01-05', contracts: 2, atr: 10, points: 5 },
      { date: '2026-01-05', contracts: 1, atr: 10, points: -2 },
      { date: '2026-01-06', contracts: 1, atr: 8, points: 4 },
    ];
    const gross = rows.reduce((sum, row) => sum + row.points * 20 * row.contracts, 0);
    const term = decomposeExact(3, ['2026-01-05', '2026-01-06'], rows, 20);
    expect(term?.perDay).toBeCloseTo(gross / 3, 8);
  });

  it('classe le jour du changement avec le régime de la veille', () => {
    expect(laggedValue(['compression', 'compression', 'expansion'])).toEqual([undefined, 'compression', 'compression']);
    const samples: ReadingSample[] = [
      { date: '2026-01-05', exitTime: 1, points: 1, key: 'compression' },
      { date: '2026-01-06', exitTime: 2, points: 1, key: 'compression' },
      { date: '2026-01-07', exitTime: 3, points: 100, key: 'compression' },
    ];
    const rows = readAxis(samples, [
      { date: '2026-01-05', key: null },
      { date: '2026-01-06', key: 'compression' },
      { date: '2026-01-07', key: 'compression' },
    ], { minTrades: 30, draws: 50 });
    expect(rows.map((row) => row.key)).toEqual(['compression']);
    expect(rows[0]?.trades).toBe(3);
    expect(daySide(0)).toBeNull();
    expect(daySide(1)).toBe('hausse');
    expect(daySide(-1)).toBe('baisse');
  });

  it('ferme les classes d’amplitude à 100 % et ignore les vides', () => {
    const classes = semiOpenClasses([0, 5, 10, 15, Number.NaN], [0, 10, 20]);
    expect(classes.reduce((sum, row) => sum + row.count, 0)).toBe(4);
    expect(classes.at(-1)?.cumulative).toBe(1);
    expect(semiOpenClasses([0, 5, 10, 15], [0, 10, 20])).toEqual(classes);
  });

  it('le contrôle décalé d’une semaine n’est pas significatif', () => {
    const trades = [
      ...Array.from({ length: 8 }, () => ({ date: '2026-01-05', minute: 600, points: 12 })),
      ...Array.from({ length: 8 }, () => ({ date: '2026-01-06', minute: 600, points: 0 })),
    ];
    const events = [{ date: '2026-01-05', minute: 600 }];
    const direct = releaseContrast(labelRelease(trades, events, 5, 30), { draws: 300, seed: 1 });
    expect(direct.significant).toBe(true);
    const shifted = events.map((event) => ({ ...event, date: addCalendarDays(event.date, 7) }));
    expect(releaseContrast(labelRelease(trades, shifted, 5, 30), { draws: 200, seed: 1 }).significant).toBe(false);
  });

  it('n’utilise la queue de Pareto qu’à partir de 500 journées', () => {
    const mild = Array.from({ length: 300 }, (_, i) => i - 250);
    expect(tailLoss(mild)?.method).toBe('empirique');
    expect(tailLoss(mild.slice(0, 100))).toBeNull();
    const heavy = Array.from({ length: 520 }, (_, i) => (i < 40 ? -100 - i : i - 200));
    expect(tailLoss(heavy)?.method).toBe('gpd');
  });

  it('la démo ne confirme ni le jour ni l’heure', () => {
    const { sessions, trades } = generateDemoJournal({ sessions: 140, seed: 2052, endDate: new Date('2026-10-01T12:00:00Z') });
    const dates = sessionDates(sessions);
    const span = [...dates.values()].sort();
    const calendar = tradingDaysBetween(span[0] ?? '', span.at(-1) ?? '').map((date) => ({ date, key: weekdayKey(date) }));
    const samples: ReadingSample[] = trades.map((trade) => {
      const date = dates.get(trade.sessionId) ?? '';
      return { date, exitTime: trade.exitTime, points: pointsPerContract(trade), key: weekdayKey(date) };
    });
    const hours: ReadingSample[] = trades.map((trade) => {
      const date = dates.get(trade.sessionId) ?? '';
      return { date, exitTime: trade.exitTime, points: pointsPerContract(trade), key: String(zonedWallClock(trade.entryTime, ET_ZONE).hour) };
    });
    const hourCalendar = tradingDaysBetween(span[0] ?? '', span.at(-1) ?? '').map((date) => ({ date, key: '0' }));
    expect(readAxis(samples, calendar, { draws: 400, seed: 1 }).some((row) => row.verdict === 'confirme')).toBe(false);
    expect(readAxis(hours, hourCalendar, { draws: 400, seed: 1 }).some((row) => row.verdict === 'confirme')).toBe(false);
    expect(comparableSet([] as DayContext[], 'compression', 'basse').hausse).toBeNull();
  });
});
