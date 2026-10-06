import { describe, expect, it } from 'vitest';
import { isDeskEventKind } from '@/engine/agent/catalog';
import { dailyLossAlert, propBufferAlert, propBufferLevel, ThresholdWatch, type DailyLossInput, type PropBufferInput } from '@/engine/agent/events';

const day = (loss: number, over: Partial<DailyLossInput> = {}): DailyLossInput => ({ day: '2026-10-06', account: 'PA-1', loss, limit: 500, source: 'trader', realized: -loss, unrealized: 0, ...over });

describe('événement daily_loss', () => {
  it('types daily_loss et discipline connus du catalogue partagé', () => {
    expect(isDeskEventKind('daily_loss')).toBe(true);
    expect(isDeskEventKind('discipline')).toBe(true);
  });

  it('alerte à 50, 75 et 100 % de la limite consommée, une fois par seuil', () => {
    let level = 0;
    const seen: unknown[] = [];
    for (const loss of [0, 200, 250, 260, 370, 375, 499, 500, 650]) {
      const r = dailyLossAlert(level, day(loss));
      level = r.level;
      if (r.data) seen.push([r.data.threshold, r.data.consumed, r.data.breached]);
    }
    expect(seen).toEqual([
      [0.5, 0.5, false],
      [0.75, 0.75, false],
      [1, 1, true],
    ]);
    expect(dailyLossAlert(0, day(400, { limit: 0 }))).toEqual({ level: 0, data: null });
    expect(dailyLossAlert(0, day(300, { source: 'plan', limit: 1100, planId: 'tpt-50' })).data).toBeNull();
    expect(dailyLossAlert(0, day(600, { source: 'plan', limit: 1100, planId: 'tpt-50' })).data).toMatchObject({ threshold: 0.5, source: 'plan', limit: 1100, planId: 'tpt-50', account: 'PA-1', day: '2026-10-06' });
  });

  it('premier passage muet, hystérésis de 5 points à la remontée, comme la marge du plan', () => {
    const watch = new ThresholdWatch(dailyLossAlert);
    const steps: [string, number][] = [
      ['k1', 300], // 60 % à l'ouverture : niveau posé, rien d'émis
      ['k1', 320],
      ['k1', 380], // 76 % : seuil 75 %
      ['k1', 360], // 72 % : reste au-dessus de 70 %, pas de remontée
      ['k1', 380],
      ['k1', 300], // 60 % : redescend sous 75 − 5
      ['k1', 380], // 76 % : seuil 75 % à nouveau
      ['k1', 500], // 100 %
      ['k2', 0], // journée suivante : nouvelle clé, passage muet
      ['k2', 260], // 52 %
    ];
    const out = steps.map(([key, loss]) => watch.step(key, day(loss))?.threshold ?? null);
    expect(out).toEqual([null, null, 0.75, null, null, null, 0.75, 1, null, 0.5]);
  });

  it('la fonction de seuils générique ne change rien à la marge du plan', () => {
    expect([0.6, 0.5, 0.52, 0.56, 0.3, 0.24, 0.1, 0, -0.2].map((share) => propBufferLevel(share))).toEqual([0, 1, 0, 0, 1, 2, 3, 4, 4]);
    expect(propBufferLevel(0.53, 1)).toBe(1);
    expect(propBufferLevel(0.56, 1)).toBe(0);
    const watch = new ThresholdWatch(propBufferAlert);
    const input = (buffer: number, unrealized: number): PropBufferInput => ({ planId: 'apex-50', account: 'PA-1', maxDrawdown: 2500, buffer, floor: 47_500, balance: 50_000, unrealized });
    const out = [input(2500, 0), input(2500, -1300), input(1800, -1300)].map((i) => watch.step('apex-50|1|PA-1', i));
    expect(out.map((d) => (d ? [d.threshold, d.liveBuffer] : null))).toEqual([null, [0.5, 1200], [0.25, 500]]);
  });
});
