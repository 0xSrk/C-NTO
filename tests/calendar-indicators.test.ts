import { describe, expect, it } from 'vitest';
import { generateDemoBars } from '@/engine/bars';
import { generateNasdaqEvents } from '@/engine/calendar';
import { INDICATORS, indicatorById, defaultParams, sessionKeyOf } from '@/engine/indicators';
import { monteCarlo } from '@/engine/montecarlo';
import { generateDemoJournal } from '@/engine/demo';
import { easterSunday, nthWeekdayOfMonth, zonedToUtc, ET_ZONE } from '@/lib/time';

describe('calendrier Nasdaq', () => {
  it('place les 8 décisions FOMC 2026 aux dates officielles', () => {
    const ev = generateNasdaqEvents(2026).filter((e) => e.title.startsWith('Décision FOMC'));
    expect(ev.map((e) => e.date)).toEqual(['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09']);
    expect(ev.every((e) => !e.estimated && e.impact === 3)).toBe(true);
  });

  it('calcule fêtes, expirations et rollovers', () => {
    const ev = generateNasdaqEvents(2026);
    const titles = (t: string) => ev.filter((e) => e.title.includes(t));
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(titles('Good Friday')[0].date).toBe('2026-04-03');
    expect(titles('Thanksgiving')[0].date).toBe('2026-11-26');
    expect(titles('Independence Day')[0].date).toBe('2026-07-03');
    expect(titles('Expiration trimestrielle').map((e) => e.date)).toEqual(['2026-03-20', '2026-06-19', '2026-09-18', '2026-12-18']);
    expect(titles('Rollover').map((e) => e.date)).toEqual(['2026-03-12', '2026-06-11', '2026-09-10', '2026-12-10']);
    expect(titles('NFP').length).toBe(12);
    expect(nthWeekdayOfMonth(2026, 3, 0, 2)).toBe('2026-03-08');
    expect(nthWeekdayOfMonth(2026, 3, 0, -1)).toBe('2026-03-29');
  });

  it('convertit une heure ET en UTC selon l’heure d’été', () => {
    expect(zonedToUtc('2026-01-15', '09:30', ET_ZONE)).toBe(Date.UTC(2026, 0, 15, 14, 30));
    expect(zonedToUtc('2026-07-15', '09:30', ET_ZONE)).toBe(Date.UTC(2026, 6, 15, 13, 30));
  });
});

describe('barres et indicateurs', () => {
  const bars = generateDemoBars({ days: 3, timeframe: 5, seed: 7, endDate: '2026-09-11' });

  it('génère une séance Globex par jour ouvré', () => {
    const keys = new Set(bars.map((b) => sessionKeyOf(b.time)));
    expect(keys.size).toBe(3);
    expect(bars.every((b) => b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close))).toBe(true);
    for (let i = 1; i < bars.length; i++) expect(bars[i].time).toBeGreaterThan(bars[i - 1].time);
  });

  it('calcule chaque indicateur sans erreur et avec des valeurs finies', () => {
    for (const def of INDICATORS) {
      const out = def.compute(bars, defaultParams(def));
      expect(out.lines.length).toBeGreaterThan(0);
      for (const l of out.lines) {
        expect(l.data.length).toBeGreaterThan(0);
        expect(l.data.some((p) => p.value !== undefined)).toBe(true);
        expect(l.data.every((p) => p.value === undefined || Number.isFinite(p.value))).toBe(true);
      }
    }
  });

  it('EMA suit la clôture sur une série constante', () => {
    const flat = Array.from({ length: 50 }, (_, i) => ({ time: 1_700_000_000 + i * 300, open: 100, high: 100, low: 100, close: 100, volume: 10 }));
    const ema = indicatorById('ema')!.compute(flat, { period: 9 });
    expect(ema.lines[0].data.at(-1)?.value).toBeCloseTo(100);
    const vwap = indicatorById('vwap')!.compute(flat, { bands: '0' });
    expect(vwap.lines[0].data.at(-1)?.value).toBeCloseTo(100);
  });
});

describe('Monte Carlo & démo', () => {
  it('produit des percentiles ordonnés et reproductibles', () => {
    const { sessions } = generateDemoJournal({ sessions: 60, seed: 3, endDate: new Date(2026, 8, 1) });
    const pnls = sessions.map((s) => s.pnl);
    const a = monteCarlo(pnls, { runs: 300, seed: 11, ruinDrawdown: 2500, target: 3000 });
    const b = monteCarlo(pnls, { runs: 300, seed: 11, ruinDrawdown: 2500, target: 3000 });
    expect(a).not.toBeNull();
    expect(a!.finalPnl.p5).toBeLessThanOrEqual(a!.finalPnl.p50);
    expect(a!.finalPnl.p50).toBeLessThanOrEqual(a!.finalPnl.p95);
    expect(a!.maxDrawdown.p5).toBeLessThanOrEqual(a!.maxDrawdown.p95);
    expect(a!.ruinProbability).toBeGreaterThanOrEqual(0);
    expect(a!.ruinProbability).toBeLessThanOrEqual(1);
    expect(a!.envelope.p50.length).toBe(60);
    expect(a!.finalPnl.p50).toBe(b!.finalPnl.p50);
    expect(monteCarlo([1, 2, 3])).toBeNull();
  });

  it('le jeu de démo est cohérent (séances ↔ trades)', () => {
    const { sessions, trades } = generateDemoJournal({ sessions: 30, seed: 5, endDate: new Date(2026, 8, 1) });
    expect(sessions.length).toBe(30);
    for (const s of sessions) {
      const own = trades.filter((t) => t.sessionId === s.id);
      expect(own.length).toBe(s.tradeCount);
      expect(own.reduce((sum, t) => sum + t.pnl, 0)).toBeCloseTo(s.pnl, 6);
    }
  });
});
