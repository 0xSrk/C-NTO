import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accountsFit, ACCOUNT_ROW_GAP, ACCOUNT_ROW_H } from '@/app/railFit';
import { cssRules, type CssRule } from './helpers/cssRules';

/*
 * La hauteur du rail, calculée sur ses feuilles : jsdom ne met rien en page, alors le test refait la pile du rail avec
 * les valeurs que déclarent shell.module.css et tokens.css — hauteurs de ligne, marges, écarts, le sceau à son
 * rapport. Les mesures dans Chromium (1180 × 720 au zoom 100 %, démo chargée, orchestrateur en service) le confirment :
 * nav de 439 px, rien de caché.
 */
const shell = cssRules(readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n'));
const tokens = readFileSync('src/design/tokens.css', 'utf8');
const main = readFileSync('electron/main.ts', 'utf8');
const seal = readFileSync('src/design/Seal.tsx', 'utf8');

const COMPACT = /^@container rail \(max-height: (\d+)px\)$/;

/** La règle du sélecteur, hors de tout bloc @ (`compact` : dans la requête du rail court). */
function rule(selector: string, compact = false): CssRule | undefined {
  return shell.find((r) => r.selector === selector && (compact ? r.at.some((head) => COMPACT.test(head)) : r.at.length === 0));
}
/** La valeur d'une propriété, la requête du rail court l'emportant sur la règle de base quand `compact`. */
function value(selector: string, prop: string, compact: boolean): string {
  for (const r of compact ? [rule(selector, true), rule(selector)] : [rule(selector)]) {
    const hit = r ? new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(r.body) : null;
    if (hit) return hit[1]!.trim();
  }
  throw new Error(`${selector} { ${prop} } introuvable`);
}
const px = (text: string) => {
  const n = Number(/^(-?[\d.]+)px$/.exec(text)?.[1]);
  if (!Number.isFinite(n)) throw new Error(`pas une longueur en px : ${text}`);
  return n;
};
/** Haut et bas d'un `padding` ou d'un `padding-block`. */
function block(selector: string, compact: boolean): [number, number] {
  try {
    const [a, b = a] = value(selector, 'padding-block', compact).split(/\s+/);
    return [px(a!), px(b!)];
  } catch {
    const parts = value(selector, 'padding', compact).split(/\s+/);
    return [px(parts[0]!), px(parts[2] ?? parts[0]!)];
  }
}
const lineHeight = (selector: string, fontFrom = selector) => Number(value(selector, 'line-height', false)) * px(value(fontFrom, 'font-size', false));

/** Hauteur d'une cartouche dont la quantité tient sur `lines` lignes (0 : le nom seul). */
function item(lines: number, compact: boolean): number {
  const [top, bottom] = block('.navItem', compact);
  const text = lineHeight('.navLabel', '.navItem') + (lines > 0 ? px(value('.navText', 'gap', false)) + lines * lineHeight('.navQty') : 0);
  return Math.max(px(value('.navItem', 'min-height', compact)), top + bottom + text);
}

/**
 * Hauteur que demande le contenu du rail : nav, écart, comptes connectés, sceau et langues. La pile des comptes (OROS5.51)
 * montre autant de lignes qu'`accountsFit` lui en laisse dans `content` (toutes, sans contenu donné), une par compte ;
 * aucun compte connecté, rien, ni la pile ni l'écart du pied qui la sépare du sceau.
 */
function railNeed(lines: number[], compact: boolean, accounts = 1, content = Number.POSITIVE_INFINITY): number {
  const gap = px(value('.nav', 'gap', compact));
  const nav = lines.reduce((sum, n) => sum + item(n, compact), 0) + gap * (lines.length - 1);
  const [, , w, h] = /SEAL_VIEWBOX = '([^']+)'/.exec(seal)![1]!.split(' ').map(Number);
  const sealH = (px(value('.sealMark', 'width', false)) * h!) / w!;
  const signature = sealH + px(value('.signature', 'gap', false)) + px(value('.langBtn', 'height', false));
  const railGap = px(value('.rail', 'gap', false));
  const footGap = px(value('.railFoot', 'gap', compact));
  const rows = Math.min(accounts, accountsFit({ content, nav, gap: railGap, footGap, signature }));
  const stack = rows > 0 ? rows * ACCOUNT_ROW_H + (rows - 1) * ACCOUNT_ROW_GAP + footGap : 0;
  return nav + railGap + stack + signature;
}

/** Hauteur de contenu du rail pour une fenêtre de `windowH` px CSS : barre de titre, barre d'état, marges du rail. */
function railBox(windowH: number): number {
  const token = (name: string) => px(new RegExp(`${name}:\\s*([\\d.]+px)`).exec(tokens)![1]!);
  const [top, bottom] = block('.rail', false);
  return windowH - token('--titlebar-h') - token('--statusbar-h') - top - bottom;
}

describe('OROS4.39 le rail tient dans la fenêtre minimale du desk', () => {
  it('à 1180 × 720 au zoom 100 %, les neuf cartouches et les comptes connectés tiennent ; à 1600 × 1000, le rail reste celui du 4.1 ; la barre ne mange pas les cartouches', () => {
    // La fenêtre minimale du desk, lue dans le process principal.
    const minHeight = Number(/minHeight:\s*(\d+)/.exec(main)?.[1]);
    expect(minHeight).toBe(720);
    // Le rail se mesure lui-même : un conteneur de taille, qui voit le zoom natif comme le zoom CSS de la racine.
    expect(value('.rail', 'container', false)).toBe('rail / size');
    const head = shell.flatMap((r) => r.at).find((at) => COMPACT.test(at));
    expect(head).toBeDefined();
    const threshold = Number(COMPACT.exec(head!)![1]);
    // Neuf onglets : huit quantités sur une ligne au plus, celle de l'orchestrateur en service sur deux (fr, es).
    const orchestrator = [1, 0, 1, 1, 0, 2, 0, 1, 1];
    const busy = [1, 0, 1, 2, 0, 2, 0, 1, 1]; // et « 128 notes · 1 472 liens »
    // OROS5.51 les comptes connectés (décision de l'ADMIN, 2026-11-07) : la feuille pose les mesures que compte
    // `accountsFit`, une ligne de 28 px, 4 px entre deux.
    expect(px(value('.account', 'min-height', false))).toBe(ACCOUNT_ROW_H);
    expect(px(value('.accounts', 'gap', false))).toBe(ACCOUNT_ROW_GAP);
    // À la fenêtre minimale, le rail court s'applique, et tout y tient : neuf cartouches dont deux quantités sur deux
    // lignes, et deux comptes empilés ; au-delà, la pile défile.
    expect(railBox(minHeight)).toBeLessThanOrEqual(threshold);
    for (const accounts of [0, 1, 2, 3, 12]) {
      expect(railNeed(orchestrator, true, accounts, railBox(minHeight)), `${accounts} compte(s)`).toBeLessThanOrEqual(railBox(minHeight));
      expect(railNeed(busy, true, accounts, railBox(minHeight)), `${accounts} compte(s)`).toBeLessThanOrEqual(railBox(minHeight));
    }
    // Au-dessus du seuil, le rail ordinaire tient neuf cartouches dont deux quantités sur deux lignes, et deux comptes : le
    // seuil passe de 704 à 716 px avec eux (à 704, deux comptes faisaient défiler les cartouches de 705 à 714 px).
    expect(railNeed(busy, false, 2)).toBeLessThanOrEqual(threshold);
    expect(railNeed(busy, false, 2)).toBeGreaterThan(704);
    expect(threshold).toBe(716);
    // De 720 à 1200 px de fenêtre, quel que soit le nombre de comptes : la pile prend ce que les cartouches laissent, et
    // les cartouches ne défilent jamais.
    for (let windowH = minHeight; windowH <= 1200; windowH += 1) {
      const content = railBox(windowH);
      const short = content <= threshold;
      for (const lines of [orchestrator, busy]) {
        for (const accounts of [0, 1, 2, 3, 6, 12]) expect(railNeed(lines, short, accounts, content), `${windowH} px · ${lines} · ${accounts}`).toBeLessThanOrEqual(content);
      }
    }
    // Le rail ordinaire, lui, ne tenait pas à la fenêtre minimale, même sans compte : c'était le défaut (786 px de fenêtre
    // pour neuf quantités d'une ligne, 799 avec l'orchestrateur en service).
    expect(railNeed(orchestrator, false, 0)).toBeGreaterThan(railBox(minHeight));
    // À 1600 × 1000, rien ne change pour les cartouches : 48 px, 8 px entre deux ; une ligne de compte, 28 px.
    expect(railBox(1000)).toBeGreaterThan(threshold);
    expect(px(value('.navItem', 'min-height', false))).toBe(48);
    expect(px(value('.nav', 'gap', false))).toBe(8);
    expect(px(value('.account', 'min-height', false))).toBe(28);
    // Le rail court ne touche ni au sceau ni aux couleurs : seulement des hauteurs, des marges et des écarts.
    const compact = shell.filter((r) => r.at.some((at) => COMPACT.test(at)));
    for (const r of compact) for (const prop of r.props) expect(['gap', 'min-height', 'padding-block', 'margin-block'], `${r.selector} ${prop}`).toContain(prop);
    // S'il faut encore défiler (zoom relevé), la barre fine passe dans la marge droite du rail : les cartouches gardent
    // la largeur du compte, sous les barres classiques (Windows, Linux) comme sous les barres superposées.
    const [, right] = value('.rail', 'padding', false).split(/\s+/).map(px);
    expect(px(value('.nav', 'margin-right', false))).toBe(-right!);
    expect(value('.nav', 'scrollbar-width', false)).toBe('thin');
    // la largeur du contenu du rail (100cqw), celle du compte, jamais plus que la nav
    expect(value('.navItem', 'width', false)).toBe('min(100cqw, 100%)');
  });
});

describe('OROS4.40 une cartouche ne s’écrase jamais', () => {
  it('à l’étroit, la nav défile : une quantité sur deux lignes garde sa cartouche entière, sous le filet', () => {
    // Sans flex: none, une cartouche de 60,5 px (« ORCHESTRATEUR EN / SERVICE ») était ramenée à sa hauteur minimale et
    // sa quantité passait 5,5 px sous le filet (6,5 px dans le rail court, au zoom 125 %).
    expect(value('.navItem', 'flex', false)).toBe('none');
    for (const compact of [false, true]) expect(item(2, compact), compact ? 'rail court' : 'rail ordinaire').toBeGreaterThan(px(value('.navItem', 'min-height', compact)));
    // la nav, elle, peut céder sa hauteur et défiler
    expect(value('.nav', 'min-height', false)).toBe('0');
    expect(value('.nav', 'overflow', false)).toBe('auto');
  });
});
