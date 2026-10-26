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

describe('OROS3.2d la rangée d’outils de Métrique, aux composants de la planche', () => {
  it('chaque outil porte son composant ; deux étoiles séparent le pont, le journal et les réglages', async () => {
    const node = await metrique();
    const row = node.querySelector('[data-tools]')!;
    expect(row).not.toBeNull();
    expect(glyphs(row)).toEqual([GLYPH_ID.bridge, GLYPH_ID.star, GLYPH_ID.addSession, GLYPH_ID.csv, GLYPH_ID.vault, GLYPH_ID.restore, GLYPH_ID.star, GLYPH_ID.settings]);
    const labels = [...row.querySelectorAll('button')].map(textOf);
    expect(labels[0]).toMatch(/^Pont NinjaTrader\s?inactif$/);
    expect(labels.slice(1, 6)).toEqual(['Séance manuelle', 'CSV', 'Coffre', 'Restaurer', 'Réglages']);
    // Les composants doublent un libellé écrit : muets pour les lecteurs d'écran, et plus aucune icône d'emprunt.
    for (const svg of row.querySelectorAll('svg[class*="skg-"]')) expect(svg.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(row.querySelectorAll('svg:not([class*="skg-"])')).toHaveLength(0);
  });

  it('« Importer un CSV » porte la flèche d’import de la planche', async () => {
    const node = await metrique();
    const button = [...node.querySelectorAll('button')].find((el) => textOf(el) === 'Importer un CSV')!;
    expect(button).toBeDefined();
    expect(glyphs(button)).toEqual([GLYPH_ID.arrowImport]);
  });
});
