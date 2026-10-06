import { describe, expect, it } from 'vitest';
import { atrSeries } from '@/engine/atr';
import type { Bar } from '@/engine/bars';
import { buildMetricsContext, rawVolCycle, stabilizeVolCycles, toDailyBars, type VolCycle } from '@/engine/metricsContext';
import type { Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

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
  const variance = (sigma * sigma) / 252;
  const half = Math.sqrt(2 * variance) / 2;
  const mid = 20_000;
  return {
    time: zonedToUtc(date, '12:00', ET_ZONE) / 1000,
    open: mid,
    close: mid,
    high: mid * Math.exp(half),
    low: mid * Math.exp(-half),
    volume: 1,
  };
}

function trade(id: string, date: string, account: string, qty = 1): Trade {
  const entry = zonedToUtc(date, '10:00', ET_ZONE);
  return {
    id,
    sessionId: `${account}-${date}`,
    instrument: 'NQ',
    account,
    direction: 'long',
    qty,
    entryTime: entry,
    exitTime: entry + 60_000,
    entryPrice: 20_000,
    exitPrice: 20_010,
    pnl: 200,
    commission: 0,
  };
}

describe('régime stabilisé', () => {
  it('attend 2 séances pour adopter, et 5 pour quitter', () => {
    const raw: VolCycle[] = [...Array(8).fill('compression'), 'choc', ...Array(4).fill('compression'), ...Array(2).fill('choc'), ...Array(2).fill('expansion')];
    const out = stabilizeVolCycles(raw, 2, 5);
    expect(out[0]).toBeNull();
    expect(out[1]).toBe('compression');
    expect(out[8]).toBe('compression');
    expect(out[13]).toBe('compression');
    expect(out[14]).toBe('choc');
    expect(out[15]).toBe('choc');
    expect(out[16]).toBe('choc');
    expect(rawVolCycle(0.3, 0.2, 0.2)).toBe('choc');
    expect(rawVolCycle(0.4, 0.3, 0.2)).toBe('expansion');
    expect(rawVolCycle(0.2, 0.3, 0.2)).toBe('decrue');
    expect(rawVolCycle(0.2, 0.2, 0.2)).toBe('compression');
  });
});

describe('fiche de contexte', () => {
  const dates = weekdays('2024-01-02', 240);
  const sigmas = dates.map((_, index) => {
    if (index < 130) return 0.12;
    if (index < 145) return 0.55;
    if (index < 165) return 0.55 + ((index - 145) / 20) * 0.35;
    if (index < 180) return 0.9;
    if (index < 190) return 0.9 - ((index - 180) / 10) * 0.78;
    return 0.12;
  });
  const bars = dates.map((date, index) => barAt(date, sigmas[index] ?? 0.15));

  it('passe par choc, expansion, décrue puis compression', () => {
    const { days } = buildMetricsContext({ root: 'NQ', bars, trades: [] });
    const seq = days.flatMap((day) => (day.volCycle ? [day.volCycle] : []));
    const changes: VolCycle[] = [];
    for (const cycle of seq) if (changes[changes.length - 1] !== cycle) changes.push(cycle);
    const choc = changes.indexOf('choc');
    const expansion = changes.indexOf('expansion', Math.max(0, choc));
    const decrue = changes.indexOf('decrue', Math.max(0, expansion));
    const compression = changes.indexOf('compression', Math.max(0, decrue));
    expect(choc).toBeGreaterThanOrEqual(0);
    expect(expansion).toBeGreaterThan(choc);
    expect(decrue).toBeGreaterThan(expansion);
    expect(compression).toBeGreaterThan(decrue);
  });

  it('laisse les fiches antérieures identiques quand l’historique est tronqué', () => {
    const full = buildMetricsContext({ root: 'NQ', bars, trades: [] });
    for (const cutoff of [dates[150]!, dates[180]!, dates[210]!]) {
      const kept = bars.filter((_, index) => dates[index]! <= cutoff);
      const partial = buildMetricsContext({ root: 'NQ', bars: kept, trades: [] });
      const before = full.days.filter((day) => day.date < cutoff);
      expect(partial.days.filter((day) => day.date < cutoff)).toEqual(before);
    }
  });

  it('garde les jours sans trade et ne triple pas les contrats copiés', () => {
    const slice = bars.slice(0, 100);
    const day = dates[20]!;
    const sessions = ['A', 'B', 'C'].map((account) => ({
      id: `${account}-${day}`,
      date: day,
      account,
      instruments: ['NQ'],
      source: 'csv' as const,
      tradeCount: 1,
      pnl: 200,
      grossProfit: 200,
      grossLoss: 0,
      commission: 0,
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    }));
    const trades = ['A', 'B', 'C'].map((account) => trade(account, day, account));
    const { days, sufficient } = buildMetricsContext({ root: 'NQ', bars: slice, trades, sessions });
    expect(sufficient).toBe(true);
    const quiet = days.find((row) => row.date === dates[21]);
    expect(quiet?.traded).toBe(false);
    expect(quiet?.trades).toBe(0);
    const busy = days.find((row) => row.date === day);
    expect(busy?.traded).toBe(true);
    expect(busy?.contracts).toBe(1);
    expect(busy?.trades).toBe(1);
  });

  it('aligne l’ATR de la fiche sur l’indicateur des barres journalières', () => {
    const daily = toDailyBars(bars);
    const series = atrSeries(daily.map((day, index) => ({ time: index, open: day.open, high: day.high, low: day.low, close: day.close, volume: 0 })));
    const { days } = buildMetricsContext({ root: 'NQ', bars, trades: [] });
    days.forEach((day, index) => {
      const value = series[index];
      if (value == null) expect(day.atr14).toBeUndefined();
      else expect(day.atr14).toBe(value);
    });
  });

  it('laisse les volatilités vides sous 90 séances', () => {
    const { sufficient, days } = buildMetricsContext({ root: 'NQ', bars: bars.slice(0, 40), trades: [] });
    expect(sufficient).toBe(false);
    expect(days.every((day) => day.volCT == null && day.volCycle == null)).toBe(true);
  });
});
