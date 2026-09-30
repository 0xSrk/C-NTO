import { describe, expect, it } from 'vitest';
import { montantAria, montantParts } from '@/lib/format';

describe('montantParts', () => {
  it('découpe 4812,50', () => {
    expect(montantParts(4812.5, 2)).toEqual({ sign: '+', groups: ['4', '812'], decimals: '50' });
  });

  it('signe moins U+2212', () => {
    expect(montantParts(-148.5, 2).sign).toBe('\u2212');
  });

  it('zéro arrondi sans signe', () => {
    expect(montantParts(-0.004, 2)).toEqual({ sign: '', groups: ['0'], decimals: '00' });
  });

  it('trois groupes et arrondi', () => {
    expect(montantParts(1234567.891, 2)).toEqual({ sign: '+', groups: ['1', '234', '567'], decimals: '89' });
  });

  it('valeur de stock : pas de plus, le négatif garde son moins', () => {
    expect(montantParts(51842, 2, { sign: false })).toEqual({ sign: '', groups: ['51', '842'], decimals: '00' });
    expect(montantParts(5000, 2, { sign: false }).sign).toBe('');
    expect(montantParts(-5000, 2, { sign: false }).sign).toBe('\u2212');
    expect(montantParts(-12.5, 2, { sign: false })).toEqual({ sign: '\u2212', groups: ['12'], decimals: '50' });
    expect(montantParts(-0.004, 2, { sign: false })).toEqual({ sign: '', groups: ['0'], decimals: '00' });
    expect(montantAria(montantParts(4812.5, 2, { sign: false }))).toBe('4\u202f812,50');
    expect(montantAria(montantParts(-5000, 2, { sign: false }))).toBe('\u22125\u202f000,00');
  });

  it('aria-label contient U+202F', () => {
    const label = montantAria(montantParts(4812.5, 2));
    expect(label).toContain('\u202f');
    expect(label).toBe('+4\u202f812,50');
  });
});
