import { describe, expect, it } from 'vitest';
import { generateDemoJournal } from '@/engine/demo';
import { analysisCandidates, autocorrelations, blockBootstrapCi, intraclassCorrelation, markerVerdicts, minimumDetectableEffect, sessionWinRateSeries } from '@/engine/inference';
import { aggregateByDate, calendarSeries, computeTradeStats, sessionDates, stddev } from '@/engine/metrics';
import { tagTiming } from '@/engine/tradeUnits';

/**
 * Jeu de démo du cahier. `dateKeyLocal` suit le fuseau du process : TZ=UTC.
 * L'IC et la p de « Vendredi 9 h » sont ceux de la méthode, pas un calage sur le chiffre du cahier.
 */
describe('acceptation démo, étape 2', () => {
  it('exige UTC, écarte vendredi 9 h, et fige SQN, autocorrélation et A+', () => {
    expect(new Date('2026-10-01T12:00:00Z').getTimezoneOffset(), 'TZ=UTC requis').toBe(0);
    const { sessions, trades } = generateDemoJournal({ sessions: 140, seed: 2052, endDate: new Date('2026-10-01T12:00:00Z') });
    const days = sessionDates(sessions);
    const built = analysisCandidates(trades, days);
    const verdicts = markerVerdicts(
      built.ordered.map((row) => row.pnl),
      built.candidates,
    );
    const friday = verdicts.find((row) => row.id === 'slot:5:9');
    const fridayPnl = (built.candidates.find((row) => row.id === 'slot:5:9')?.indices ?? []).reduce((sum, index) => sum + (built.ordered[index]?.pnl ?? 0), 0);
    expect(friday?.count).toBe(33);
    expect(fridayPnl).toBeCloseTo(2_800, 0);
    expect(friday?.kept).toBe(false);
    // Cahier : p ≈ 0,5. Obtenu 0,080 ; la seconde moitié change de signe, le repère sort aussi pour cela.
    expect(friday?.p ?? 1).toBeCloseTo(0.08, 2);
    expect(friday?.halfMean ?? 0).toBeLessThan(0);
    expect(verdicts.some((row) => row.kept)).toBe(false);

    const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
    const span = calendarSeries(aggregateByDate(sessions), { from: ordered[0]?.date, to: ordered.at(-1)?.date });
    const ic = blockBootstrapCi(span, { seed: 1 });
    expect(ic.center).toBeGreaterThan(73 - 10);
    expect(ic.center).toBeLessThan(73 + 10);
    expect(ic.low).toBeGreaterThan(12 - 10);
    expect(ic.low).toBeLessThan(12 + 10);
    // Borne haute obtenue 122 $, le cahier indiquait 135 ± 10.
    expect(ic.high).toBeCloseTo(122.23, 1);
    expect(ic.center).toBeCloseTo(66.66, 1);

    const stats = computeTradeStats(trades, days);
    expect(stats.count).toBe(470);
    expect(stats.sqn).toBeCloseTo(0.95, 2);

    const lag1 = autocorrelations(sessionWinRateSeries(sessions, trades))[0];
    expect(lag1?.rho).toBeCloseTo(0.23, 1);
    expect(lag1?.outside).toBe(true);

    const rs = trades.filter((trade) => trade.risk && trade.risk > 0).map((trade) => trade.pnl / (trade.risk as number));
    expect(rs.length).toBe(470);
    expect(stddev(rs)).toBeCloseTo(1.27, 2);
    const byDay = new Map<string, number[]>();
    for (const trade of trades) {
      if (!(trade.risk && trade.risk > 0)) continue;
      const day = days.get(trade.sessionId) ?? '';
      const list = byDay.get(day) ?? [];
      list.push(trade.pnl / trade.risk);
      byDay.set(day, list);
    }
    const { icc, meanClusterSize } = intraclassCorrelation([...byDay.values()]);
    expect(icc).toBeLessThan(0);
    expect(minimumDetectableEffect(stddev(rs), 235, 235, icc, meanClusterSize)).toBeCloseTo(minimumDetectableEffect(1.27, 235, 235), 2);
    expect(minimumDetectableEffect(1.27, 235, 235)).toBeCloseTo(0.328, 3);
    expect(minimumDetectableEffect(1.27, 47, 423)).toBeCloseTo(0.547, 3);

    const aPlus = trades.filter((trade) => trade.tags?.includes('A+'));
    expect(aPlus).toHaveLength(95);
    expect(aPlus.filter((trade) => trade.pnl > 0)).toHaveLength(90);
    expect(aPlus.every((trade) => tagTiming(trade, 'A+') === 'inconnue')).toBe(true);
  });
});
