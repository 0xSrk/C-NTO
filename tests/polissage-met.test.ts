/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import p from '@/design/primitives.module.css';
import type { Session } from '@/engine/types';
import { useI18n } from '@/i18n';
import m from '@/modules/metrique/metrique.module.css';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// POL6.1 : le tirage reste en cours tant que le test le veut (sans Worker, `monteCarloOffthread` appelle `monteCarlo`).
vi.mock('@/engine/montecarlo', async (orig) => ({ ...(await orig<typeof import('@/engine/montecarlo')>()), monteCarlo: () => new Promise(() => undefined) }));

import { MonteCarloView } from '@/modules/metrique/MonteCarloView';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

function mount(element: ReactElement): HTMLDivElement {
  useI18n.setState({ locale: 'fr' });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

const sheet = (path: string) => cssRules(readFileSync(path, 'utf8'));
/** La règle de premier niveau (hors de tout bloc @) qui porte exactement ce sélecteur. */
const top = (path: string, selector: string) => sheet(path).find((rule) => rule.selector === selector && rule.at.length === 0);

const session = (i: number): Session => ({
  id: `s${i}`,
  date: `2026-10-${String(10 + i).padStart(2, '0')}`,
  account: 'Sim101',
  instruments: ['NQ'],
  source: 'manuel',
  tradeCount: 3,
  pnl: i % 2 ? 420 : -260,
  grossProfit: 600,
  grossLoss: -300,
  commission: 6,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
});

describe('POL6 Métrique et Visual : la dynamique se polit, le repos ne bouge pas', () => {
  it('POL6.1 Monte-Carlo : un tirage court ne fait rien clignoter, un tirage long court sur le filet de l’en-tête sans rien pousser', () => {
    vi.useFakeTimers();
    const sessions = Array.from({ length: 8 }, (_, i) => session(i));
    const node = mount(createElement(MonteCarloView, { scope: { sessions, trades: [], account: 'Sim101', ignores: [], needsAccount: false } }));
    const cancel = () => [...node.querySelectorAll('button')].find((b) => b.textContent === 'Annuler') ?? null;
    // Sous --t-fast (120 ms), le calcul ne se montre pas : ni barre, ni « Annuler ».
    expect(node.querySelector(`.${p.progress}`)).toBeNull();
    expect(cancel()).toBeNull();
    act(() => vi.advanceTimersByTime(130));
    // Au-delà, la barre sort du flux des paramètres : elle se pose sur le filet de l'en-tête, dans son enveloppe.
    const bar = node.querySelector(`.${p.progress}`);
    expect(bar).not.toBeNull();
    expect(bar!.closest(`.${m.rows}`)).toBeNull();
    expect(bar!.parentElement!.classList.contains(m.mcBusy!)).toBe(true);
    // « Annuler » paraît et garde la hauteur de l'en-tête.
    expect(cancel()?.classList.contains(m.mcCancel!)).toBe(true);
    const sheetPath = 'src/modules/metrique/metrique.module.css';
    expect(top(sheetPath, '.mcBusy')?.body).toMatch(/position:\s*absolute/);
    expect(top(sheetPath, '.mcBusy')?.body).toMatch(/margin-top:\s*-21px/);
    expect(top(sheetPath, '.mcCancel')?.body).toMatch(/margin-block:\s*-5px/);
    // Annuler : la barre et le bouton partent ensemble, dans le même rendu.
    act(() => cancel()!.click());
    expect(node.querySelector(`.${p.progress}`)).toBeNull();
    expect(cancel()).toBeNull();
  });

  it('POL6.2 ce qui s’atténue revient comme il est parti : la transition vit sur la ligne, la cellule et la carte, pas sur l’état', () => {
    const fade = /transition:[^;]*\bopacity 220ms linear/;
    // A.04 : la ligne hors sélection (`.out`, sur le `tr`) ; B · Séances : ses cellules (`.rowOut td`) ; la carte d'un
    // indicateur éteint (`.indicator.off`), dans Visual comme dans Crypto.
    expect(top('src/modules/metrique/dashboard.module.css', '.objRow')?.body).toMatch(fade);
    expect(top('src/modules/metrique/metrique.module.css', '.grilleTable td')?.body).toMatch(fade);
    expect(top('src/modules/visual/visual.module.css', '.indicator')?.body).toMatch(fade);
    // Les états gardent leur valeur : 35 % hors sélection (OROS5.32), 50 % pour l'indicateur éteint.
    expect(top('src/modules/metrique/dashboard.module.css', '.out')?.body).toMatch(/opacity:\s*0\.35/);
    expect(top('src/modules/metrique/metrique.module.css', '.rowOut td')?.body).toMatch(/opacity:\s*0\.35/);
    expect(top('src/modules/visual/visual.module.css', '.indicator.off')?.body).toMatch(/opacity:\s*0\.5\b/);
  });
});
