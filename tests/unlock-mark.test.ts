import { describe, expect, it } from 'vitest';
import { SEAL_DRAW_S, UNLOCK_SEAL, seal, sealFormMs } from '@/app/unlockMark';

describe('sceau d’ouverture', () => {
  it('forme Desk Unlocked, avec une respiration entre les deux mots', () => {
    const { glyphs, width, height } = seal();
    expect(glyphs.map((glyph) => glyph.ch).join('')).toBe(UNLOCK_SEAL.replace(/ /g, ''));
    expect(UNLOCK_SEAL).toBe('DESK UNLOCKED');
    expect(height).toBe(80);
    for (const glyph of glyphs) {
      expect(glyph.strokes.length).toBeGreaterThan(0);
      expect(glyph.strokes.every((d) => d.startsWith('M'))).toBe(true);
    }
    for (let i = 1; i < glyphs.length; i++) {
      const prev = glyphs[i - 1];
      const next = glyphs[i];
      expect(prev && next && next.x > prev.x).toBe(true);
      expect(prev && next && next.delay > prev.delay).toBe(true);
    }
    const desk = glyphs[3];
    const unlocked = glyphs[4];
    const step = (glyphs[1]?.delay ?? 0) - (glyphs[0]?.delay ?? 0);
    expect(desk && unlocked && unlocked.delay - desk.delay).toBeGreaterThan(step);
    const last = glyphs.at(-1);
    expect(last && last.x + 52 <= width).toBe(true);
    expect(last && last.delay + SEAL_DRAW_S).toBeGreaterThan(1.6);
    expect(sealFormMs()).toBeGreaterThan(2200);
    expect(sealFormMs()).toBeLessThan(2700);
  });
});
