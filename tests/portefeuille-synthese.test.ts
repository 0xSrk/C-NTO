import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './helpers/cssRules';

const css = readFileSync('src/modules/portefeuille/synthese.module.css', 'utf8');
const body = (selector: string) => cssRules(css).find((rule) => rule.selector === selector)?.body ?? '';
const px = (value: string) => value.split(/\s+/).map((part) => Number.parseFloat(part));

describe('OROS4.13 les en-têtes des cartes de la Synthèse s’alignent', () => {
  it('dans une carte à marge, l’en-tête annule la marge : titre à la même place que celui de B.02, filet d’un bord à l’autre', () => {
    const [padTop, padSide] = px(/padding:\s*([^;]+);/.exec(body('.pad'))![1]!);
    const margin = /margin:\s*([^;]+);/.exec(body('.pad > .head'))?.[1];
    expect(margin).toBeDefined();
    const [top, side, bottom] = px(margin!);
    expect(top).toBe(-padTop!);
    expect(side).toBe(-padSide!);
    expect(bottom).toBe(0);
    // L'en-tête garde ses propres marges : le titre est à 22 px du bord, comme dans une carte sans marge.
    expect(body('.head')).toMatch(/padding:\s*14px 22px 10px/);
    expect(body('.head')).toMatch(/border-bottom:\s*1px solid var\(--line-1\)/);
  });

  it('les quatre cartes à en-tête de la Synthèse posent cet en-tête comme premier enfant', () => {
    const source = readFileSync('src/modules/portefeuille/Synthese.tsx', 'utf8');
    const heads = [...source.matchAll(/<section className=\{`\$\{s\.card\}( \$\{s\.pad\})? \$\{s\.span\d\}`\}>\s*<div className=\{s\.head\}>/g)];
    expect(heads.map((m) => Boolean(m[1]))).toEqual([false, true, true, true]);
  });
});
