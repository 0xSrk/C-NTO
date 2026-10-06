import { describe, expect, it } from 'vitest';
import { generateDemoJournal } from '@/engine/demo';
import {
  addCalendarDays,
  comparableSet,
  daySide,
  decomposeExact,
  labelRelease,
  readAxis,
  releaseContrast,
  semiOpenClasses,
  tailLoss,
  tradingDaysBetween,
  weekdayKey,
  type ReadingSample,
} from '@/engine/contextReading';
import type { Bar, BarSeries } from '@/engine/bars';
import { permutationPValues } from '@/engine/inference';
import { sessionDates } from '@/engine/metrics';
import { buildMetricsContext, type DayContext } from '@/engine/metricsContext';
import { pointsPerContract } from '@/engine/tradeUnits';
import type { Session, Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc, zonedWallClock } from '@/lib/time';
import { axisReading, type AxisSettings } from '@/modules/metrique/axisReading';

const AXIS_SETTINGS: AxisSettings = {
  regimeConfirm: 2,
  regimeMinSessions: 5,
  releaseBefore: 5,
  releaseAfter: 30,
  markerMinTrades: 30,
  falseDiscoveryRate: 0.05,
  riskPerContract: 0,
  riskBasePoints: 1.5,
  impliedVol: null,
  startingBalance: 50_000,
  planAccount: '',
  planId: 'apex-50',
};

function weekdays(start: string, count: number): string[] {
  const out: string[] = [];
  let cursor = start;
  while (out.length < count) {
    const dow = new Date(`${cursor}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(cursor);
    const [y, m, d] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(y ?? 2024, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10);
  }
  return out;
}

/** Séance dont la variance de Garman-Klass annualisée vaut `sigma` (ouverture = clôture). */
function barAt(date: string, sigma: number): Bar {
  const half = Math.sqrt((2 * sigma * sigma) / 252) / 2;
  return { time: zonedToUtc(date, '12:00', ET_ZONE) / 1000, open: 20_000, close: 20_000, high: 20_000 * Math.exp(half), low: 20_000 * Math.exp(-half), volume: 1 };
}

function nqSeries(bars: Bar[]): BarSeries {
  return { id: 'nq', instrument: 'NQ', timeframe: 1440, label: 'NQ', source: 'csv', bars, createdAt: 0 };
}

function daySession(date: string): Session {
  return { id: `s-${date}`, date, account: 'Sim101', instruments: ['NQ'], source: 'csv', tradeCount: 1, pnl: 200, grossProfit: 200, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function dayTrade(date: string): Trade {
  const entry = zonedToUtc(date, '10:00', ET_ZONE);
  return { id: `t-${date}`, sessionId: `s-${date}`, instrument: 'NQ', account: 'Sim101', direction: 'long', qty: 1, entryTime: entry, exitTime: entry + 60_000, entryPrice: 20_000, exitPrice: 20_010, pnl: 200, commission: 0 };
}

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

  it('classe le jour du changement avec sa propre fiche, arrêtée à la veille', () => {
    const dates = weekdays('2024-01-02', 240);
    // Volatilité qui décroît doucement (compression), puis un choc modéré à partir de la séance 133.
    const bars = dates.map((date, index) => barAt(date, index < 133 ? 0.3 - (0.1 * index) / 133 : 0.26));
    const traded = dates.slice(120, 170);
    const input = {
      sessions: traded.map((date) => daySession(date)),
      trades: traded.map((date) => dayTrade(date)),
      series: [nqSeries(bars)],
      activeId: 'nq',
      events: [],
      settings: AXIS_SETTINGS,
      metricAccount: null,
    };
    const { days } = buildMetricsContext({ root: 'NQ', bars, trades: [], confirm: AXIS_SETTINGS.regimeConfirm, minStay: AXIS_SETTINGS.regimeMinSessions });
    const sheet = new Map(days.map((day) => [day.date, day]));
    const shock = days.findIndex((day, index) => index > 0 && day.volCycle === 'choc' && days[index - 1]?.volCycle !== 'choc');
    const changeDay = days[shock]!.date;
    expect(days[shock - 1]?.volCycle).toBe('compression');
    expect(traded).toContain(changeDay);

    const keysOf = (axis: 'regime' | 'band', over: Partial<typeof input> = {}) => new Map(axisReading({ axis, ...input, ...over }).samples.map((sample) => [sample.date, sample.key]));
    const regime = keysOf('regime');
    const band = keysOf('band');
    // Le jour où la fiche passe en choc, ses trades sont classés « choc », pas avec la fiche de la veille.
    expect(regime.get(changeDay)).toBe('choc');
    for (const date of traded) {
      expect(regime.get(date)).toBe(sheet.get(date)?.volCycle);
      expect(band.get(date)).toBe(sheet.get(date)?.volBand);
    }
    const bandShift = days.findIndex((day, index) => index > shock && day.volBand !== days[index - 1]?.volBand);
    expect(band.get(days[bandShift]!.date)).toBe(days[bandShift]!.volBand);
    expect(days[bandShift]!.volBand).not.toBe(days[bandShift - 1]!.volBand);

    // Aucune fuite : la barre du jour D ne change ni le régime ni la bande de ses trades, seulement la fiche du lendemain.
    const at = dates.indexOf(changeDay);
    const shaken = bars.map((bar, index) => (index === at ? { ...bar, high: bar.high * 1.05, low: bar.low * 0.95, close: bar.close * 1.03 } : bar));
    const moved = { series: [nqSeries(shaken)] };
    const shakenRegime = keysOf('regime', moved);
    const shakenBand = keysOf('band', moved);
    for (const date of traded.filter((day) => day <= changeDay)) {
      expect(shakenRegime.get(date)).toBe(regime.get(date));
      expect(shakenBand.get(date)).toBe(band.get(date));
    }
    const next = buildMetricsContext({ root: 'NQ', bars: shaken, trades: [] }).days[at + 1];
    expect(next?.volCT).not.toBe(days[at + 1]?.volCT);

    expect(daySide(0)).toBeNull();
    expect(daySide(1)).toBe('hausse');
    expect(daySide(-1)).toBe('baisse');
  });

  it('confirme un groupe à 0 point quand le reste fait +12 : la permutation se centre sur la moyenne générale', () => {
    const dates = weekdays('2025-01-06', 40);
    const samples: ReadingSample[] = dates.flatMap((date, day) => [
      { date, exitTime: day * 10, points: day % 2 ? 3 : -3, key: 'creux' },
      ...[1, 2, 3, 4].map((k) => ({ date, exitTime: day * 10 + k, points: 12 + (k % 2 ? 3 : -3), key: 'reste' })),
    ]);
    const rows = readAxis(samples, [], { draws: 400, seed: 1 });
    const creux = rows.find((row) => row.key === 'creux');
    expect(creux?.trades).toBe(40);
    expect(creux?.verdict).toBe('confirme');

    const values = samples.map((sample) => sample.points as number);
    const group = samples.flatMap((sample, index) => (sample.key === 'creux' ? [index] : []));
    expect(permutationPValues(values, [group], { draws: 400, seed: 1, centered: true })[0]).toBeLessThan(0.01);
    // Le rail de l'étape 2 garde la valeur absolue de la moyenne : un groupe à 0 n'y est jamais extrême.
    expect(permutationPValues(values, [group], { draws: 400, seed: 1 })[0]).toBe(1);

    const contrast = releaseContrast(samples.map((sample) => ({ points: sample.points as number, treated: sample.key === 'creux' })), { draws: 400, seed: 1 });
    expect(contrast.diff).toBeCloseTo(-12, 8);
    expect(contrast.significant).toBe(true);
  });

  it('juge le verdict sur 30 journées distinctes, pas sur 30 trades', () => {
    const dates = weekdays('2025-01-06', 40);
    const swing = (index: number) => (index % 2 ? 3 : -3);
    const samples: ReadingSample[] = dates.flatMap((date, day) => [
      // 60 trades serrés sur 12 journées, et 40 trades sur 40 journées : même écart à la moyenne.
      ...(day < 12 ? [0, 1, 2, 3, 4].map((k) => ({ date, exitTime: day * 100 + k, points: swing(k + day), key: 'serre' })) : []),
      { date, exitTime: day * 100 + 10, points: swing(day), key: 'etale' },
      ...[0, 1, 2, 3].map((k) => ({ date, exitTime: day * 100 + 20 + k, points: 12 + swing(k), key: 'reste' })),
    ]);
    const rows = readAxis(samples, [], { draws: 400, seed: 1 });
    const serre = rows.find((row) => row.key === 'serre');
    const etale = rows.find((row) => row.key === 'etale');
    expect(serre?.trades).toBe(60);
    expect(serre?.verdict).toBe('insuffisant');
    expect(etale?.trades).toBe(40);
    expect(etale?.verdict).toBe('confirme');
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
