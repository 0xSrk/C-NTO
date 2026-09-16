import { describe, expect, it } from 'vitest';
import { tokensMatch } from '../electron/secure-token';

describe('tokensMatch (F-01)', () => {
  it('accepte un jeton ASCII identique', () => {
    const token = 'abcdefghijklmnopqr';
    expect(tokensMatch(token, token)).toBe(true);
  });

  it('refuse un jeton ASCII différent de même longueur', () => {
    expect(tokensMatch('abcdefghijklmnopqr', 'abcdefghijklmnopqX')).toBe(false);
  });

  it('refuse un jeton multi-octets de même longueur de caractères sans lever', () => {
    const expected = 'a'.repeat(24);
    const candidate = 'é'.repeat(24);
    expect(Buffer.byteLength(candidate, 'utf8')).not.toBe(Buffer.byteLength(expected, 'utf8'));
    expect(tokensMatch(candidate, expected)).toBe(false);
  });

  it('accepte un jeton multi-octets correctement égal', () => {
    const token = 'é'.repeat(18);
    expect(tokensMatch(token, token)).toBe(true);
  });
});
