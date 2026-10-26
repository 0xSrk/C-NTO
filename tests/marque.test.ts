import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARQUE_COLORS, MARQUE_SIZES, marque } from '../scripts/marque.mjs';
import { decodePng, icoEntries } from './helpers/png';

const lf = (text: string) => text.replace(/\r\n/g, '\n');

function token(name: string): string {
  const match = readFileSync('src/design/tokens.css', 'utf8').match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`jeton ${name} introuvable`);
  return match[1].toLowerCase();
}

/** Le pixel lu est l'or de la LED (--gold, #CCB066), à l'anticrénelage près — jamais le rouge de 3.2.2. */
function expectGold([r, g, b]: [number, number, number], where: string): void {
  const [gr, gg, gb] = [0xcc, 0xb0, 0x66];
  expect(Math.max(Math.abs(r - gr), Math.abs(g - gg), Math.abs(b - gb)), `${where} : rgb(${r}, ${g}, ${b})`).toBeLessThanOrEqual(24);
}

/** Pointe du Λ (128, 68 sur la grille 256) ramenée à la taille `px` : le pixel tombe dans la LED à toute taille. */
const apex = (px: number) => [Math.floor(px / 2), Math.floor((px * 68) / 256)] as const;

describe('marque V2 — le Λ garde sa LED carrée, passée à l’or', () => {
  it('le générateur prend ses couleurs aux jetons du Système 4.0 : LED --gold, encre --text-0, nuit --bg-0', () => {
    expect(MARQUE_COLORS.led.toLowerCase()).toBe(token('--gold'));
    expect(MARQUE_COLORS.ink.toLowerCase()).toBe(token('--text-0'));
    expect(MARQUE_COLORS.night.toLowerCase()).toBe(token('--bg-0'));
    expect(MARQUE_SIZES).toEqual([16, 24, 32, 48, 64, 72, 128, 256, 1024]);
  });

  it('tailles optiques : la construction paraît à 48 px, à 32 px et moins le Λ et la LED restent seuls', () => {
    expect(marque(48)).toContain('<line');
    expect(marque(32)).not.toContain('<line');
    for (const px of MARQUE_SIZES) expect(marque(px), String(px)).toContain(`width="${px}" height="${px}"`);
  });

  it('logo.svg porte le Λ et sa LED d’or, plus le rouge de 3.2.2 ni le monogramme de 3.2.1', () => {
    const svg = readFileSync('build/logo.svg', 'utf8');
    expect(svg).toContain('M72 184 L128 68 L184 184');
    expect(svg).toContain('#CCB066');
    expect(svg).not.toMatch(/#E5263D/i);
    expect(svg).not.toContain('M56 56h32v144H56z');
  });

  it('logo.svg est la taille optique 72 du générateur', () => {
    expect(lf(readFileSync('build/logo.svg', 'utf8'))).toBe(lf(marque(72)));
  });

  it('icon.png : 1024 × 1024, la LED de la pointe est or', () => {
    const png = decodePng(readFileSync('build/icon.png'));
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expectGold(png.rgb(...apex(1024)), 'icon.png');
  });

  it('icon.ico : sept tailles, de 16 à 256, chacune dessinée pour elle-même avec sa LED d’or', () => {
    const buf = readFileSync('build/icon.ico');
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(1);
    const entries = icoEntries(buf);
    expect(entries.map((e) => e.size).sort((a, b) => a - b)).toEqual([16, 24, 32, 48, 64, 128, 256]);
    for (const { size, png } of entries) {
      const image = decodePng(png);
      expect([image.width, image.height], String(size)).toEqual([size, size]);
      expectGold(image.rgb(...apex(size)), `icon.ico ${size}`);
    }
  });
});
