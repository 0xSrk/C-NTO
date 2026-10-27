import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LAUNCHER_GLYPHS, generateLauncherMicro } from '../scripts/launcher-micro.mjs';
import { COMPONENTS, GLYPH_ID } from '@/design/micro/assets';
import { SEAL_HORIZON, SEAL_VIEWBOX } from '@/design/Seal';
import { code128Widths } from '@/lib/code128';

const FILE = 'electron/launcher-micro.js';
const lf = (text: string) => text.replace(/\r\n/g, '\n');

interface LauncherMicro {
  SEAL: { viewBox: string; horizon: number; svg: string };
  GLYPHS: Record<string, string>;
  PLATES?: unknown;
  bindSlots?: unknown;
  code128Widths: (text: string) => number[];
  code128Path: (text: string, height?: number) => { d: string; modules: number };
}

/** Le fichier tel que le lanceur le charge : un script simple qui pose window.cantoMicro. */
function load(): LauncherMicro {
  const win: { cantoMicro?: LauncherMicro } = {};
  vm.runInNewContext(readFileSync(FILE, 'utf8'), { window: win });
  if (!win.cantoMicro) throw new Error('window.cantoMicro absent');
  return win.cantoMicro;
}

describe('OROS3.7 micrographies du lanceur, tirées des sources du desk', () => {
  it('electron/launcher-micro.js est la sortie exacte du générateur, sans retouche', () => {
    expect(lf(readFileSync(FILE, 'utf8'))).toBe(lf(generateLauncherMicro()));
  });

  it('le sceau Horizon du master négatif : quatre groupes dans l’ordre, douze filaments numérotés, horizon à 48,27 %', () => {
    const { SEAL } = load();
    expect(SEAL.viewBox).toBe(SEAL_VIEWBOX);
    expect(SEAL.horizon).toBeCloseTo(SEAL_HORIZON, 6);
    expect([...SEAL.svg.matchAll(/data-part="(\w+)"/g)].map((m) => m[1])).toEqual(['rings', 'horizon', 'filaments', 'inscription']);
    const filaments = /data-part="filaments"[^>]*>([\s\S]*?)<\/g>/.exec(SEAL.svg)![1]!;
    expect([...filaments.matchAll(/<path style="--i:(\d+)"/g)].map((m) => Number(m[1]))).toEqual([...Array(12).keys()]);
    const master = readFileSync('src/design/seal/seal-negative.svg', 'utf8');
    for (const [, d] of SEAL.svg.matchAll(/ d="([^"]+)"/g)) expect(master).toContain(`d="${d}"`);
    expect(SEAL.svg).toMatch(/fill="currentColor"/);
  });

  it('chaque composant est celui de la planche des 150, sous le nom que lui donne le desk', () => {
    const { GLYPHS } = load();
    expect(Object.keys(GLYPHS)).toEqual([...LAUNCHER_GLYPHS]);
    for (const name of LAUNCHER_GLYPHS) {
      const n = GLYPH_ID[name as keyof typeof GLYPH_ID];
      expect(n, name).toBeGreaterThan(0);
      expect(GLYPHS[name], name).toBe(COMPONENTS[n]);
    }
  });

  it('OROS4.8 aucune plaque dans le lanceur : le générateur n’en emporte plus, ni la règle de leurs emplacements', () => {
    const micro = load();
    expect(micro.PLATES).toBeUndefined();
    expect(micro.bindSlots).toBeUndefined();
    expect(readFileSync(FILE, 'utf8')).not.toMatch(/mg-release|mg-seal|mg-artefact|lm-v/);
  });

  it('Code 128 : les largeurs du desk, au module près', () => {
    const { code128Widths: widths, code128Path: drawn } = load();
    for (const text of ['SK-ART-002-3.6.0', 'SK-ART-002-3.7.0', 'SK-ART-002-10.12.3', '0123456789', 'v3.6.0']) {
      expect(widths(text), text).toEqual(code128Widths(text));
    }
    expect(drawn('SK-ART-002-3.6.0', 12).modules).toBe(code128Widths('SK-ART-002-3.6.0').reduce((a, b) => a + b, 0));
  });

  it('ni code 2D ni couleur en dur : l’encre est --k, le papier --p', () => {
    const text = readFileSync(FILE, 'utf8');
    expect(text).not.toMatch(/real-code|data-code|datamatrix|qrcode/i);
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
