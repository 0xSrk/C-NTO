import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LAUNCHER_GLYPHS, RELEASE_LIMITS, generateLauncherMicro } from '../scripts/launcher-micro.mjs';
import { COMPONENTS, GLYPH_ID, PLATES } from '@/design/micro/assets';
import { bindSlots } from '@/design/Micro';
import { SEAL_HORIZON, SEAL_VIEWBOX } from '@/design/Seal';
import { code128Widths } from '@/lib/code128';

const FILE = 'electron/launcher-micro.js';
const lf = (text: string) => text.replace(/\r\n/g, '\n');

interface LauncherMicro {
  SEAL: { viewBox: string; horizon: number; svg: string };
  GLYPHS: Record<string, string>;
  PLATES: Record<string, { svg: string; slots: string[] }>;
  bindSlots: (svg: string, values?: Record<string, unknown>) => string;
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

/** Lignes de la plaque de liaison dans la maquette validée (sierraska-canto-v2/build/micro.cjs, dklink). */
const MASTER_LINES = ['LOCAL', 'COINBASE', 'WS.LIVE', 'MARKET FEED — ACTIVE', 'PUBLIC DATA | LATENCY: 82 MS'];

const texts = (svg: string) => [...svg.matchAll(/<tspan[^>]*>([^<]*(?:<tspan[^>]*>[^<]*<\/tspan>[^<]*)*)<\/tspan>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));

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

  it('les plaques du sceau et de l’artefact sont celles du desk ; la liaison devient le canal de publication', () => {
    const { PLATES: P } = load();
    expect(P.seal!.slots).toEqual(['version']);
    expect(P.artefact!.slots).toEqual(['state']);
    expect(P.release!.slots).toEqual(['next', 'state', 'channel', 'latency']);
    for (const id of ['seal', 'artefact'] as const) {
      expect(texts(P[id]!.svg), id).toEqual(texts(PLATES[id].svg));
    }
    expect(texts(P.release!.svg)).toEqual(['LOCAL', '{{next}}', '{{state}}', 'RELEASE — {{channel}}', 'CHECK | LATENCY: {{latency}}']);
  });

  it('une ligne réécrite, emplacements remplis au plus long, ne dépasse pas la ligne du master', () => {
    const { PLATES: P } = load();
    const longest = (line: string) => line.replace(/\{\{(\w+)\}\}/g, (_, key: string) => 'X'.repeat(RELEASE_LIMITS[key as keyof typeof RELEASE_LIMITS]));
    texts(P.release!.svg).forEach((line, i) => expect(longest(line).length, line).toBeLessThanOrEqual(MASTER_LINES[i]!.length));
  });

  it('une valeur liée s’allume seule : chaque emplacement est porté par son propre tspan', () => {
    const { PLATES: P } = load();
    for (const [id, plate] of Object.entries(P)) {
      for (const slot of plate.slots) expect(plate.svg, `${id}.${slot}`).toContain(`<tspan class="lm-v">{{${slot}}}</tspan>`);
    }
  });

  it('un emplacement sans valeur se lit « — », une valeur est échappée : la même règle que le desk', () => {
    const { bindSlots: bind } = load();
    for (const [svg, values] of [
      ['<text>{{x}}</text>', { x: '<b>&' }],
      ['<text>{{x}} {{y}}</text>', { x: null, y: '' }],
      ['<text>{{x}}</text>', {}],
      ['<text>{{n}}</text>', { n: 0 }],
    ] as const) {
      expect(bind(svg, values), svg).toBe(bindSlots(svg, values));
    }
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
