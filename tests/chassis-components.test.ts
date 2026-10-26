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
  it('chaque module du rail porte son emblème sous son numéro ; l’onglet poinçonné l’imprime à l’encre', () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    for (const tab of TABS) {
      const item = el.querySelector<HTMLElement>(`nav button[data-tab="${tab.id}"]`);
      expect(item, tab.id).not.toBeNull();
      const emblem = item!.querySelector(`svg.skg-${GLYPH_ID[tab.id]}`);
      expect(emblem, tab.id).not.toBeNull();
      // sous le numéro : même colonne, après lui
      const column = emblem!.closest('[data-part="rail-index"]');
      expect(column?.textContent, tab.id).toContain(tab.index);
    }
    expect(rule(shellCss, '.navCol')).toMatch(/flex-direction: column/);
    expect(rule(shellCss, '.navEmblem')).toMatch(/--k: var\(--text-2\)/);
    expect(rule(shellCss, '.navItem.on .navEmblem')).toMatch(/--k: var\(--ink\)/);
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
