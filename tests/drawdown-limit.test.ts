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
