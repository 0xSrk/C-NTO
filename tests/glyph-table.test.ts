import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COMPONENTS as MASTERS, GLYPH_ID as MASTER_ID } from '@/design/micro/assets';
import { DRAWN, DRAWN_ID } from '@/design/micro/drawn';
import { MEANING, RESERVED_GLYPHS, STATE_GLYPHS, TYPE_GLYPH } from '@/design/micro/meaning';
import { COMPONENTS, GLYPH_ID, Glyph } from '@/design/Micro';
import { ENTITY_TYPES } from '@/engine/ontology';

/**
 * OROS5.3 — une seule bibliothèque de glyphes (Système 5 « Fiche et Frise », décision 5 de l'ADMIN, 2026-11-01). Les
 * composants sans master au dépôt sont dessinés une fois, dans `src/design/micro/drawn.ts`, fusionnés dans `GLYPH_ID` et
 * rendus par `Glyph` ; `src/design/micro/meaning.ts` tient la table sens → numéro.
 */

/** Décision 5 : le glyphe de chaque type d'objet. */
const TYPES = { session: 94, trade: 35, evenement: 90, compte: 65, instrument: 100, note: 91, strategie: 41 } as const;
/** Plan OROS5.3 : les états et les gardes, C.092 sans triangle. */
const STATES = [42, 13, 54, 24, 70, 73, 105, 109, 125, 140, 92];
/** Les signes réservés du châssis : aucun ne marque une donnée. */
const RESERVED = [131, 12, 123, 27, 124, 126, 141, 142];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(css|tsx?|mjs)$/.test(name)) out.push(relative('.', path).split(/[/\\]/).join('/'));
  }
  return out;
}

describe('OROS5.3 tous les glyphes d’une seule bibliothèque', () => {
  it('un glyphe par type d’objet, celui de la décision 5', () => {
    expect(Object.keys(TYPE_GLYPH).sort()).toEqual([...ENTITY_TYPES].sort());
    const numbers = Object.fromEntries(Object.entries(TYPE_GLYPH).map(([type, name]) => [type, GLYPH_ID[name]]));
    expect(numbers).toEqual(TYPES);
    expect(new Set(Object.values(numbers)).size).toBe(ENTITY_TYPES.length);
    for (const type of ENTITY_TYPES) expect(MEANING[`type.${type}`], type).toBe(TYPES[type]);
  });

  it('un sens par numéro : chaque état a son glyphe, et chaque glyphe dessiné un sens', () => {
    const numbers = Object.values(MEANING);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(STATE_GLYPHS.map((name) => GLYPH_ID[name]).sort((a, b) => a - b)).toEqual([...STATES].sort((a, b) => a - b));
    for (const name of STATE_GLYPHS) expect(MEANING[name], name).toBe(GLYPH_ID[name]);
    // Rien n'est dessiné sans un sens à dire.
    for (const n of Object.keys(DRAWN).map(Number)) expect(numbers.filter((m) => m === n), `C.${n}`).toHaveLength(1);
  });

  it('aucun signe réservé (131, 12, 123, 27, 124, 126, 141, 142) ne marque une donnée', () => {
    expect(Object.keys(RESERVED_GLYPHS).map(Number).sort((a, b) => a - b)).toEqual([...RESERVED].sort((a, b) => a - b));
    expect(Object.values(MEANING).filter((n) => RESERVED.includes(n))).toEqual([]);
    expect(Object.keys(DRAWN).map(Number).filter((n) => RESERVED.includes(n))).toEqual([]);
    // Chaque signe réservé garde son master et son nom au châssis.
    for (const n of RESERVED) expect(Object.values(MASTER_ID), `C.${n}`).toContain(n);
  });

  it('dessinés à la taille d’usage : viewBox en pixels, encre --k et papier --p, aucune couleur écrite, un trait lisible', () => {
    expect(Object.keys(DRAWN).length).toBe(15);
    for (const [key, svg] of Object.entries(DRAWN)) {
      const n = Number(key);
      expect(svg, `C.${n}`).toMatch(new RegExp(`^<svg class="skg skg-${n}" viewBox="0 0 (\\d+) (\\d+)" fill="var\\(--k\\)" aria-hidden="true">`));
      const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!.map(Number);
      // Une unité, un pixel : la boîte d'usage d'un glyphe de 14 à 16 px, ni la vignette de 150 ni un master.
      for (const side of [w!, h!]) expect(side, `C.${n}`).toBeGreaterThanOrEqual(6);
      for (const side of [w!, h!]) expect(side, `C.${n}`).toBeLessThanOrEqual(24);
      expect(svg, `C.${n}`).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|<style|<text|<image|xlink:href/i);
      for (const [, paint] of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) expect(['var(--k)', 'var(--p)', 'none'], `C.${n} ${paint}`).toContain(paint);
      // Un trait d'au moins 0,7 px à la taille d'usage (le groupe mis à l'échelle compte sa propre échelle).
      for (const [tag] of svg.matchAll(/<[a-z]+ [^>]*stroke-width="[^"]+"[^>]*>/g)) {
        const width = Number(/stroke-width="([^"]+)"/.exec(tag)![1]);
        const scale = Number(/scale\(([\d.]+)\)/.exec(tag)?.[1] ?? 1);
        expect(width * scale, `C.${n} ${tag}`).toBeGreaterThanOrEqual(0.7);
      }
    }
  });

  it('fusionnés dans GLYPH_ID et rendus par Glyph, sans toucher les masters', () => {
    for (const [name, n] of Object.entries(DRAWN_ID)) {
      expect(GLYPH_ID[name as keyof typeof GLYPH_ID], name).toBe(n);
      expect(COMPONENTS[n], name).toBe(DRAWN[n]);
      const html = renderToStaticMarkup(createElement(Glyph, { name: name as keyof typeof GLYPH_ID }));
      expect(html, name).toContain(`skg-${n}`);
      expect(html, name).toContain('aria-hidden="true"');
    }
    // Un nom, un numéro : rien de dessiné ne recouvre un master.
    expect(Object.keys(DRAWN_ID).filter((name) => name in MASTER_ID)).toEqual([]);
    expect(Object.keys(DRAWN).filter((n) => n in MASTERS)).toEqual([]);
    for (const [name, n] of Object.entries(MASTER_ID)) {
      expect(GLYPH_ID[name as keyof typeof GLYPH_ID], name).toBe(n);
      expect(COMPONENTS[n], name).toBe(MASTERS[n]);
    }
    expect(renderToStaticMarkup(createElement(Glyph, { name: 'account', label: 'Compte' }))).toContain('aria-label="Compte"');
  });

  it('jamais quatre bibliothèques parallèles : le desk lit ses glyphes par Micro.tsx, et seule la planche les dessine', () => {
    const sources = walk('src').filter((path) => !path.startsWith('src/design/micro/'));
    const readers = sources.filter((path) => /from ['"](?:@\/design\/micro\/|\.\/micro\/)(?:assets|drawn)['"]/.test(readFileSync(path, 'utf8')));
    expect(readers).toEqual(['src/design/Micro.tsx']);
    // Un composant de la planche ne se dessine qu'ici : ailleurs, aucun svg ne s'ouvre en `skg`.
    const drawers = sources.filter((path) => /class(?:Name)?=["'{`]+skg\b/.test(readFileSync(path, 'utf8')));
    expect(drawers).toEqual([]);
    for (const path of ['src/app/objects/TypeGlyph.tsx', 'src/design/bornes/Glyphs.tsx', 'src/design/instruments/glyphs.tsx', 'src/design/instruments/marks.tsx']) {
      expect(existsSync(path), path).toBe(false);
    }
  });
});
