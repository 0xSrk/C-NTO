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

/** Barre journalière comme un CSV la lit : minuit local (la suite tourne en UTC). */
const dailyTime = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;

function bar(date: string): Bar {
  return { time: dailyTime(date), open: 20_000, high: 20_010, low: 19_990, close: 20_000, volume: 1 };
}

/** Une barre par séance ; volatilité qui décroît sur 100 séances, puis remonte d'un coup. */
function dailyBars(dates: readonly string[], level = 20_000, base = 0.3): Bar[] {
  return dates.map((date, index) => {
    const sigma = index < 100 ? base - (0.1 * index) / 100 : base;
    const half = Math.sqrt((2 * sigma * sigma) / 252) / 2;
    return { time: dailyTime(date), open: level, close: level, high: level * Math.exp(half), low: level * Math.exp(-half), volume: 1 };
  });
}

function seriesOf(id: string, instrument: string, bars: Bar[], source = 'csv'): BarSeries {
  return { id, instrument, timeframe: 1440, label: `${instrument} · ${source}`, source, bars, createdAt: 0 };
}

function read(axis: Axis, over: Partial<AxisReadingInput>): ReturnType<typeof axisReading> {
  return axisReading({ axis, sessions: [], trades: [], series: [], activeId: null, events: [], settings: SETTINGS, metricAccount: null, ...over });
}

describe('lecture par contexte, onglet C', () => {
  it('classe « proche » de 5 min avant à 30 min après une publication', () => {
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

  it('lit une seule racine : les trades de la série, et jamais le régime d’une démo', () => {
    const dates = weekdays('2024-01-02', 130);
    const traded = dates.slice(100);
    const sessions = traded.map((date) => session(date));
    const trades = traded.flatMap((date, day) => [trade(`nq${day}`, date, '10:00', 10, 'NQ'), trade(`es${day}`, date, '11:00', 2, 'ES')]);
    const es = seriesOf('es', 'ES', dailyBars(dates, 5_000, 0.25));
    const demo = seriesOf('demo', 'NQ', dailyBars(dates), 'demo');
    const nq = seriesOf('nq', 'NQ', dailyBars(dates));

    // Série active ES : seuls les trades ES sont lus, leurs points ne se moyennent pas avec ceux du NQ.
    const onEs = read('weekday', { sessions, trades, series: [es, demo], activeId: 'es' });
    expect(onEs.samples.map((sample) => sample.tradeId).filter((id) => !id.startsWith('es'))).toEqual([]);
    expect(onEs.samples).toHaveLength(30);
    for (const row of onEs.rows) expect(row.points).toBeCloseTo(2, 8);
    expect(onEs.root).toBe('ES');

    // Série active de démonstration (NQ) : le NQ est lu, mais son régime ne vient pas de la démo.
    const onDemo = read('regime', { sessions, trades, series: [es, demo], activeId: 'demo' });
    expect(onDemo.rows).toEqual([]);
    expect(onDemo.root).toBe('NQ');
    expect(onDemo.regime).toBe('demo');
    expect(read('weekday', { sessions, trades, series: [es, demo], activeId: 'demo' }).samples).toHaveLength(30);

    // Avec une vraie série NQ, le régime vient d'elle, même quand la démo est la série active.
    const withNq = read('regime', { sessions, trades, series: [es, demo, nq], activeId: 'demo' });
    expect(withNq.regime).toBe('ok');
    expect(withNq.samples).toHaveLength(30);
    expect(withNq.samples.every((sample) => sample.tradeId.startsWith('nq'))).toBe(true);

    // Aucune série de la racine tradée : rien n'est lu sur le régime.
    const nqOnly = trades.filter((row) => row.instrument === 'NQ');
    const noBars = read('regime', { sessions, trades: nqOnly, series: [es], activeId: 'es' });
    expect(noBars.root).toBe('NQ');
    expect(noBars.regime).toBe('absent');
    expect(noBars.rows).toEqual([]);
  });

  it('borne à la période le dénominateur des jours tradés du régime et de la bande', () => {
    // La bande demande 90 séances avant la fiche, plus son propre historique : les 30 journées tradées en ont toutes une.
    const dates = weekdays('2024-01-02', 170);
    const traded = dates.slice(140);
    const input = { sessions: traded.map((date) => session(date)), trades: traded.map((date, day) => trade(`t${day}`, date, '10:00', 5)), series: [seriesOf('nq', 'NQ', dailyBars(dates))], activeId: 'nq' };
    for (const axis of ['regime', 'band'] as const) {
      const reading = read(axis, input);
      expect(reading.rows.length).toBeGreaterThan(0);
      // Une journée de la période par trade : chaque journée comptée a été tradée.
      expect(reading.rows.reduce((sum, row) => sum + row.days, 0)).toBe(traded.length);
      for (const row of reading.rows) expect(row.tradedShare).toBe(1);
    }
  });
});
