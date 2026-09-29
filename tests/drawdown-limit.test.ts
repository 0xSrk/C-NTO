import { describe, expect, it } from 'vitest';
import { metricDrawdownLimit } from '@/modules/metrique/drawdownLimit';

const base = { planId: 'apex-50', planAccount: 'PA-4471', sessions: [], trades: [] };

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
