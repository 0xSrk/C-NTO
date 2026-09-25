import { describe, expect, it } from 'vitest';
import { parseLocale } from '@/i18n';

describe('langue du desk', () => {
  it('accepte français, anglais et espagnol', () => {
    expect(parseLocale('fr')).toBe('fr');
    expect(parseLocale('en')).toBe('en');
    expect(parseLocale('es')).toBe('es');
  });

  it('refuse une langue inconnue', () => {
    expect(parseLocale('de')).toBeNull();
    expect(parseLocale('')).toBeNull();
    expect(parseLocale(null)).toBeNull();
  });
});
