import { describe, expect, it } from 'vitest';
import type { Bar, BarSeries } from '@/engine/bars';
import type { ContextEvent } from '@/engine/metricsContext';
import type { Session, Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { axisReading, type Axis, type AxisReadingInput, type AxisSettings } from '@/modules/metrique/axisReading';

const SETTINGS: AxisSettings = {
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

function session(date: string, account = 'Sim101'): Session {
  return { id: `${account}-${date}`, date, account, instruments: ['NQ'], source: 'csv', tradeCount: 1, pnl: 0, grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

/** Trade d'une minute, entré à `time` (heure de New York) ; `points` par contrat. */
function trade(id: string, date: string, time: string, points = 1, instrument = 'NQ', account = 'Sim101'): Trade {
  const entry = zonedToUtc(date, time, ET_ZONE);
  const pointValue = instrument === 'ES' ? 50 : instrument === 'MNQ' ? 2 : 20;
  return {
    id,
    sessionId: `${account}-${date}`,
    instrument,
    account,
    direction: 'long',
    qty: 1,
    entryTime: entry,
    exitTime: entry + 60_000,
    entryPrice: 20_000,
    exitPrice: 20_000 + points,
    pnl: points * pointValue,
    commission: 0,
  };
}

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

function bar(date: string, time = '12:00'): Bar {
  return { time: zonedToUtc(date, time, ET_ZONE) / 1000, open: 20_000, high: 20_010, low: 19_990, close: 20_000, volume: 1 };
}

function seriesOf(id: string, instrument: string, bars: Bar[], source = 'csv'): BarSeries {
  return { id, instrument, timeframe: 1440, label: `${instrument} · ${source}`, source, bars, createdAt: 0 };
}

function read(axis: Axis, over: Partial<AxisReadingInput>): ReturnType<typeof axisReading> {
  return axisReading({ axis, sessions: [], trades: [], series: [], activeId: null, events: [], settings: SETTINGS, metricAccount: null, ...over });
}

describe('lecture par contexte, onglet C', () => {
  it('M6.4 : fenêtre de publication de 5 min avant à 30 min après', () => {
    const day = '2026-01-13';
    const cpi: ContextEvent = { date: day, timeET: '08:30', title: 'CPI', impact: 3, estimated: false };
    const trades = [trade('t0800', day, '08:00'), trade('t0827', day, '08:27'), trade('t0845', day, '08:45'), trade('t0905', day, '09:05')];
    const reading = read('release', { sessions: [session(day)], trades, series: [seriesOf('nq', 'NQ', [bar(day)])], activeId: 'nq', events: [cpi] });
    const keyOf = new Map(reading.samples.map((sample) => [sample.tradeId, sample.key]));
    expect(Object.fromEntries(keyOf)).toEqual({ t0800: 'loin', t0827: 'pres', t0845: 'pres', t0905: 'loin' });
  });

  it('rapproche aussi de la moyenne une heure qui n’a qu’un trade', () => {
    const dates = weekdays('2025-03-03', 20);
    const trades = dates.flatMap((date, day) => [trade(`a${day}`, date, '09:40', day % 2 ? 14 : -6), trade(`b${day}`, date, '10:15', day % 2 ? 10 : -10)]);
    trades.push(trade('lone', dates[7]!, '15:05', 40));
    const reading = read('hour', { sessions: dates.map((date) => session(date)), trades });
    const grand = (20 * 4 + 20 * 0 + 40) / 41;
    const lone = reading.rows.find((row) => row.key === '15');
    expect(lone?.trades).toBe(1);
    expect(lone?.points ?? 40).toBeLessThan(40);
    expect(lone?.points ?? 0).toBeGreaterThan(grand);
    expect(reading.rows.find((row) => row.key === '9')?.points ?? 0).toBeLessThan(4);
  });
});
