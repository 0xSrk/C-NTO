import { describe, expect, it } from 'vitest';
import { fmtRatio } from '@/lib/format';

describe('fmtRatio (F-08)', () => {
  it('masque Infinity en tiret (pas de ∞ trompeur)', () => {
    expect(fmtRatio(Infinity)).toBe('—');
    expect(fmtRatio(-Infinity)).toBe('—');
    expect(fmtRatio(2.5)).toBe('2,50');
  });
});
