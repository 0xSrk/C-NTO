import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compare deux jetons en temps constant via SHA-256.
 * Évite le RangeError de `timingSafeEqual` sur des chaînes de même longueur
 * de caractères mais de longueurs d'octets différentes (multi-octets).
 */
export function tokensMatch(candidate: string, expected: string): boolean {
  try {
    const a = createHash('sha256').update(candidate, 'utf8').digest();
    const b = createHash('sha256').update(expected, 'utf8').digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
