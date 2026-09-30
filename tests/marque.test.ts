import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Tailles déclarées dans l'en-tête ICO (0 vaut 256). */
function icoSizes(buf: Buffer): number[] {
  expect(buf.readUInt16LE(0)).toBe(0);
  expect(buf.readUInt16LE(2)).toBe(1);
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => buf[6 + i * 16] || 256).sort((a, b) => a - b);
}

describe('marque 3.2.2 — Λ à pointe LED', () => {
  it('logo.svg porte le Λ et sa LED, plus le monogramme de 3.2.1', () => {
    const svg = readFileSync('build/logo.svg', 'utf8');
    expect(svg).toContain('M72 184 L128 68 L184 184');
    expect(svg).toContain('#E5263D');
    expect(svg).not.toContain('M56 56h32v144H56z');
  });

  it('logo.svg est la taille optique 72 de la source', () => {
    expect(readFileSync('build/logo.svg', 'utf8')).toBe(readFileSync('docs/design/3.2.2/marque/marque-72.svg', 'utf8'));
  });

  it('icon.png : 1024 × 1024', () => {
    const png = readFileSync('build/icon.png');
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1024, 1024]);
  });

  it('icon.ico : sept tailles, de 16 à 256', () => {
    expect(icoSizes(readFileSync('build/icon.ico'))).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });
});
