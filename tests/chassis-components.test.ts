/**
 * @vitest-environment jsdom
 */
import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Shell } from '@/app/Shell';
import { TABS } from '@/app/tabs';
import { ZoomControls } from '@/app/ZoomControls';
import { GLYPH_ID } from '@/design/micro/assets';
import { Panel } from '@/design/primitives';
import { useUi } from '@/store/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useUi.setState({ tab: 'metrique' });
});

const shellCss = readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n');
const primCss = readFileSync('src/design/primitives.module.css', 'utf8').replace(/\r\n/g, '\n');
/** Corps de la règle dont le sélecteur ouvre la ligne. */
const rule = (css: string, selector: string) => {
  const at = css.search(new RegExp(`^${selector.replace(/[.()]/g, '\\$&')} \\{`, 'm'));
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('OROS2.11 composants de la planche dans le châssis', () => {
  it('OROS4.2 chaque module du rail porte son emblème en tête, seul ; l’onglet ouvert l’allume à l’or, le numéro du raccourci au bout', () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    for (const tab of TABS) {
      const item = el.querySelector<HTMLElement>(`nav button[data-tab="${tab.id}"]`);
      expect(item, tab.id).not.toBeNull();
      const emblem = item!.querySelector(`svg.skg-${GLYPH_ID[tab.id]}`);
      expect(emblem, tab.id).not.toBeNull();
      // l'emblème ouvre l'onglet ; le numéro le ferme
      expect(item!.firstElementChild?.contains(emblem!), tab.id).toBe(true);
      const index = item!.querySelector('[data-part="rail-index"]');
      expect(index?.textContent, tab.id).toBe(tab.index);
      expect(emblem!.compareDocumentPosition(index!) & Node.DOCUMENT_POSITION_FOLLOWING, tab.id).toBeTruthy();
    }
    expect(rule(shellCss, '.navItem')).toMatch(/grid-template-columns: 20px minmax\(0, 1fr\) auto/);
    expect(rule(shellCss, '.navEmblem')).toMatch(/--k: var\(--text-1\)/);
    expect(rule(shellCss, '.navItem.on .navEmblem')).toMatch(/--k: var\(--gold\)/);
  });

  it('OROS4.14 chaque emblème du rail et chaque couche d’en-tête pèse le même trait : entre 0,4 et 0,75 px rendu', async () => {
    const { COMPONENTS } = await import('@/design/micro/assets');
    const { LAYER_GLYPH } = await import('@/app/moduleLayers');
    const { cssRules } = await import('./helpers/cssRules');
    const rules = cssRules(shellCss);
    /** La graisse qu'impose la feuille du châssis à une classe du master, sous `scope`. */
    const override = (scope: string, cls: string) => {
      for (const r of rules) {
        if (r.selector.split(',').some((sel) => sel.trim() === `${scope} :global(.${cls})`)) return Number.parseFloat(/stroke-width:\s*([\d.]+)px/.exec(r.body)?.[1] ?? 'NaN');
      }
      return null;
    };
    const check = (n: number, size: number, scope: string, what: string) => {
      const svg = COMPONENTS[n]!;
      const [, , w, h] = /viewBox="([^"]+)"/.exec(svg)![1]!.split(' ').map(Number);
      const scale = size / Math.max(w!, h!);
      const style = /<style>([^<]*)<\/style>/.exec(svg)?.[1] ?? '';
      for (const [, selectors, body] of style.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const width = /stroke-width:\s*([\d.]+)px/.exec(body!)?.[1];
        if (!width) continue;
        for (const [, cls] of selectors!.matchAll(/\.(g\d+-\d+)/g)) {
          const rendered = (override(scope, cls!) ?? Number(width)) * scale;
          expect(rendered, `${what} · .${cls}`).toBeGreaterThanOrEqual(0.4);
          expect(rendered, `${what} · .${cls}`).toBeLessThanOrEqual(0.75);
        }
      }
    };
    expect(rule(shellCss, '.navEmblem')).toMatch(/width: 20px;\s*height: 20px/);
    expect(rule(shellCss, '.layerGlyph')).toMatch(/width: 18px;\s*height: 18px/);
    for (const tab of TABS) check(GLYPH_ID[tab.id], 20, '.navEmblem', `rail ${tab.id}`);
    for (const [layer, glyph] of Object.entries(LAYER_GLYPH)) check(GLYPH_ID[glyph], 18, '.layerGlyph', `couche ${layer}`);
  });

  it('OROS4.11 la quantité du rail n’est jamais coupée : elle passe à la ligne, deux lignes au plus, entre ses parties', async () => {
    const { useNotes } = await import('@/store/notes');
    const { useLinks } = await import('@/store/links');
    const notes = useNotes.getState().notes;
    const links = useLinks.getState().links;
    useNotes.setState({ notes: [{ id: 'a' }, { id: 'b' }] as unknown as typeof notes });
    useLinks.setState({ links: Array.from({ length: 472 }, (_, i) => ({ id: `l${i}` })) as unknown as typeof links });
    try {
      const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
      const qty = el.querySelector('nav button[data-tab="note"] [class*="navQty"]')!;
      // Deux parties, chacune insécable : la ligne ne se brise qu'au séparateur.
      expect(qty.textContent).toBe('2 notes · 472 liens');
      expect([...qty.children].map((part) => part.textContent)).toEqual(['2 notes', '472 liens']);
      const parts = rule(shellCss, '.navQtyPart');
      expect(parts).toMatch(/white-space: nowrap/);
      // Une quantité d'une seule partie (« Orchestrateur en service ») se brise entre ses mots.
      const agent = el.querySelector('nav button[data-tab="agent"] [class*="navQty"]')!;
      expect(agent.children).toHaveLength(0);
    } finally {
      useNotes.setState({ notes });
      useLinks.setState({ links });
    }
    const body = rule(shellCss, '.navQty');
    expect(body).not.toMatch(/text-overflow: ellipsis|white-space: nowrap/);
    expect(body).toMatch(/-webkit-line-clamp: 2/);
  });

  it('le zoom de la barre de titre est le bouton « + — » de la planche : le plus et la barre restent deux boutons', () => {
    const el = mount(createElement(ZoomControls));
    const plus = el.querySelector<HTMLButtonElement>('button[aria-label="Augmenter le zoom"]');
    const minus = el.querySelector<HTMLButtonElement>('button[aria-label="Réduire le zoom"]');
    expect(plus?.querySelector(`svg.skg-${GLYPH_ID.zoom}`)).not.toBeNull();
    expect(minus?.querySelector(`svg.skg-${GLYPH_ID.zoom}`)).not.toBeNull();
    expect(plus!.closest('[role="group"]')).toBe(minus!.closest('[role="group"]'));
    // le pourcentage reste lisible et bascule auto / manuel
    expect(el.querySelector('button[aria-label="Basculer auto / manuel"]')?.textContent).toMatch(/AUTO|FIXE/);
  });

  it('l’en-tête de panneau pose son code entre repères d’angle ; chaque panneau a ses croix de calage aux quatre coins', () => {
    const el = mount(createElement(Panel, { code: 'K.01', title: 'Espérance', sub: '/ trade', children: 'corps' }));
    const head = el.querySelector('header')!;
    const code = head.querySelector<HTMLElement>('[data-part="panel-code"]');
    expect(code?.textContent).toBe('K.01');
    expect(code!.compareDocumentPosition(head.querySelector('h3')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const before = rule(primCss, '.panelCode::before');
    const after = rule(primCss, '.panelCode::after');
    expect(before).toMatch(/border-width: 1px 0 0 1px/);
    expect(after).toMatch(/border-width: 0 1px 1px 0/);
    const crosses = rule(primCss, '.panel::after');
    expect(crosses).toMatch(/inset: -4px/);
    expect(crosses).toMatch(/background: var\(--line-3\)/);
    for (const corner of ['0 0', '100% 0', '0 100%', '100% 100%']) expect(crosses).toContain(`) ${corner} / 7px 7px no-repeat`);
    // sans code, l'en-tête reste celui d'avant
    act(() => root!.render(createElement(Panel, { title: 'Sans code', children: 'corps' })));
    expect(el.querySelector('[data-part="panel-code"]')).toBeNull();
  });

  it('la bande d’étiquette : le losange strié devant le nom, et un seul code-barres dans tout le desk', () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    const footer = el.querySelector('footer')!;
    const name = [...footer.querySelectorAll('span')].find((span) => [...span.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('[ SIΞRRΛSKΛ ]')));
    expect(name).toBeDefined();
    expect(name!.firstElementChild?.querySelector(`svg.skg-${GLYPH_ID.lozenge}`)).not.toBeNull();
    // le code d'accolades du pied (crispEdges) est le seul : ni la plaque, ni la barre de titre, ni l'en-tête n'en portent
    expect(el.querySelectorAll('svg[shape-rendering="crispEdges"]')).toHaveLength(1);
    expect(footer.querySelectorAll('svg[shape-rendering="crispEdges"]')).toHaveLength(1);
    expect(rule(shellCss, '.lozenge')).toMatch(/--k: currentColor/);
  });
});
