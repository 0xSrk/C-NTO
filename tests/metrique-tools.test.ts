/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLYPH_ID } from '@/design/micro/assets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Le tableau de bord (graphiques sur canevas) n'est pas l'objet du test.
vi.mock('@/modules/metrique/Dashboard', () => ({ Dashboard: () => null }));

import { useI18n } from '@/i18n';
import Metrique from '@/modules/metrique/Metrique';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function metrique(): Promise<HTMLDivElement> {
  useI18n.setState({ locale: 'fr' });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Metrique)));
  return host;
}

/** Texte lisible d'un élément : sans les styles embarqués des composants de la planche. */
const textOf = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('svg').forEach((svg) => svg.remove());
  return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
};

/** Numéros des composants de la planche dessinés sous `el`, dans l'ordre du document. */
const glyphs = (el: Element) => [...el.querySelectorAll('svg[class*="skg-"]')].map((svg) => Number(/\bskg-(\d+)\b/.exec(svg.getAttribute('class') ?? '')?.[1]));

describe('OROS4.4 les outils de Métrique, dans ses options en haut à droite', () => {
  it('le bouton Options ferme la ligne de l’en-tête ; chaque outil y porte son composant, le pont dit son état', async () => {
    const node = await metrique();
    // plus de rangée d'outils sous les sous-onglets
    expect(node.querySelector('[data-tools]')).toBeNull();
    const head = node.querySelector('h1')!.parentElement!;
    const options = head.querySelector('[data-options]')!;
    expect(options).not.toBeNull();
    // au bout de la ligne : rien ne le suit dans l'en-tête
    expect(options.parentElement!.lastElementChild).toBe(options);
    const trigger = options.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(textOf(trigger)).toBe('Options');
    // le code couleur : un point par état lu, ici le pont, à l'anneau tant qu'il est inactif
    expect([...trigger.querySelectorAll('[data-tone]')].map((i) => i.getAttribute('data-tone'))).toEqual(['neutral']);
    const items = [...options.querySelectorAll('[role="menu"] [role^="menuitem"]')];
    expect(glyphs(options.querySelector('[role="menu"]')!)).toEqual([GLYPH_ID.bridge, GLYPH_ID.addSession, GLYPH_ID.csv, GLYPH_ID.vault, GLYPH_ID.restore, GLYPH_ID.settings]);
    const labels = items.map(textOf);
    expect(labels[0]).toMatch(/^Pont NinjaTrader\s?inactif$/);
    expect(labels.slice(1, 6)).toEqual(['Séance manuelle', 'Exporter les trades en CSV', 'Sauvegarder le coffre', 'Restaurer une sauvegarde', 'Réglages du desk']);
    // journal vide : le jeu de démonstration se propose en dernier
    expect(labels[6]).toBe('Charger un jeu de démonstration');
    // deux filets séparent le pont, le journal et les réglages
    expect(options.querySelectorAll('[role="separator"]')).toHaveLength(2);
    // les composants doublent un libellé écrit : muets pour les lecteurs d'écran
    for (const svg of options.querySelectorAll('svg[class*="skg-"]')) expect(svg.parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('« Importer un CSV » porte la flèche d’import de la planche', async () => {
    const node = await metrique();
    const button = [...node.querySelectorAll('button')].find((el) => textOf(el) === 'Importer un CSV')!;
    expect(button).toBeDefined();
    expect(glyphs(button)).toEqual([GLYPH_ID.arrowImport]);
  });
});

describe('OROS4.15 les périodes dans la langue du desk', () => {
  it('7J · 30J · 90J en français ; 7D · 30D · 90D en anglais et en espagnol', async () => {
    const node = await metrique();
    const periods = () => [...node.querySelectorAll('button')].map(textOf).filter((text) => /^(\d+[JD]|TOUT|ALL|TODO)$/.test(text));
    expect(periods()).toEqual(['7J', '30J', '90J', 'TOUT']);
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(periods()).toEqual(['7D', '30D', '90D', 'ALL']);
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(periods()).toEqual(['7D', '30D', '90D', 'TODO']);
  });

  it('le Portefeuille dit ses périodes et ses jours gagnants par tr, jamais par un « J » écrit en dur', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['src/modules/portefeuille/Portefeuille.tsx', 'src/modules/portefeuille/Synthese.tsx', 'src/modules/metrique/Metrique.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/label: '\d+J'/);
      expect(source, file).not.toMatch(/\)\} J\n/);
    }
    expect(readFileSync('src/modules/portefeuille/Synthese.tsx', 'utf8')).toContain("{tr('J', 'D', 'D')}");
  });
});
