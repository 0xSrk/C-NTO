import { describe, expect, it } from 'vitest';
import { metricDrawdownLimit } from '@/modules/metrique/drawdownLimit';

const base = { planId: 'apex-50', planAccount: 'PA-4471' };

describe('metricDrawdownLimit', () => {
  it('rien pour tous les comptes', () => {
    expect(metricDrawdownLimit({ ...base, selected: null })).toBeNull();
  });

  it('limite du plan quand le compte filtré est celui du plan', () => {
    expect(metricDrawdownLimit({ ...base, selected: 'PA-4471' })).toBe(2500);
  });

  it('rien pour un autre compte ou un plan inconnu', () => {
    expect(metricDrawdownLimit({ ...base, selected: 'AUTRE' })).toBeNull();
    expect(metricDrawdownLimit({ ...base, selected: 'PA-4471', planId: 'inconnu' })).toBeNull();
  });
});

describe('planTracking', () => {
  it('propose de suivre le plan pour le compte filtré, le dit une fois suivi, rien sans filtre', async () => {
    const { planTracking } = await import('@/modules/metrique/drawdownLimit');
    expect(planTracking('A', '')).toBe('suivre');
    expect(planTracking('A', 'B')).toBe('suivre');
    expect(planTracking('A', 'A')).toBe('suivi');
    expect(planTracking(null, 'A')).toBeNull();
  });
});

describe('OROS3.2c signal de la borne (jauge K.04)', () => {
  const plan = (used: number, margin: number, status: 'en-cours' | 'objectif' | 'echec' = 'en-cours') =>
    ({ kind: 'plan', limit: 2500, margin, used, highWater: 51_000, floor: 48_500, lastLow: 48_500 + margin, date: '2026-08-11', status }) as const;
  const closes = (maxDrawdown: number, limit: number | null) => ({ kind: 'clotures', limit, maxDrawdown, used: limit ? maxDrawdown / limit : 0 }) as const;

  it('attention (niveau 2) dès 80 % de la borne consommée, rien en deçà', async () => {
    const { BORNE_WARN, borneSignal } = await import('@/modules/metrique/drawdownLimit');
    expect(BORNE_WARN).toBe(0.8);
    expect(borneSignal(plan(0.84, 400))).toBe(2);
    expect(borneSignal(plan(0.8, 500))).toBe(2);
    expect(borneSignal(plan(0.79, 525))).toBe(0);
    expect(borneSignal(closes(2_000, 2_500))).toBe(2);
    expect(borneSignal(closes(1_000, 2_500))).toBe(0);
  });

  it('critique (niveau 3) quand la borne est franchie : marge épuisée, compte invalidé, repli au-delà de la limite', async () => {
    const { borneSignal } = await import('@/modules/metrique/drawdownLimit');
    expect(borneSignal(plan(1, 0))).toBe(3);
    expect(borneSignal(plan(1, -200, 'echec'))).toBe(3);
    expect(borneSignal(plan(0.5, 1_250, 'echec'))).toBe(3);
    expect(borneSignal(closes(2_600, 2_500))).toBe(3);
  });

  it('sans borne (aucun plan suivi), aucun signal : la jauge ne s’invente pas de limite', async () => {
    const { borneSignal } = await import('@/modules/metrique/drawdownLimit');
    expect(borneSignal(closes(9_000, null))).toBe(0);
  });
});
