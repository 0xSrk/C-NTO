/**
 * @vitest-environment jsdom
 */
import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { KillBand } from '@/app/KillBand';
import { LAYER_GLYPH, MODULE_LAYERS } from '@/app/moduleLayers';
import { ModuleHeader, Shell } from '@/app/Shell';
import { TABS } from '@/app/tabs';
import { GLYPH_ID } from '@/design/micro/assets';
import { useI18n } from '@/i18n';
import { APP_VERSION } from '@/lib/version';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : le réglage « journal vu » se lit et s'écrit dans une doublure.
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
  useI18n.setState({ locale: 'fr' });
});

const css = readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n');
/** Corps de la règle dont le sélecteur ouvre la ligne. */
const rule = (selector: string) => {
  const at = css.search(new RegExp(`^${selector.replace(/[.]/g, '\\.')} \\{`, 'm'));
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};
const shellSource = readFileSync('src/app/Shell.tsx', 'utf8');

describe('OROS2.10 cartouches du châssis', () => {
  it('OROS4.5 le pied du rail porte le sceau du Lab et les trois langues ; la version, en haut à droite, ouvre le journal', () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    const seal = el.querySelector<HTMLElement>('aside [data-part="lab-seal"]');
    expect(seal).not.toBeNull();
    const svg = seal!.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('SIΞRRΛSKΛ Lab');
    expect(svg.querySelector('g[data-part="horizon"]')).not.toBeNull();
    // plus de cartouche SK-ART-002 au rail, plus de version au rail
    expect(el.querySelector('aside svg.lbl-plaque')).toBeNull();
    expect(el.querySelector('aside button[aria-label="Journal des versions"]')).toBeNull();
    // la version vit dans la barre de titre et ouvre le journal des versions
    const version = el.querySelector<HTMLButtonElement>('header button[aria-label="Journal des versions"]');
    expect(version?.textContent).toContain(`v${APP_VERSION}`);
    act(() => version!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Journal des versions');
    // FR / EN / ES, sous le sceau
    const radios = [...el.querySelectorAll<HTMLButtonElement>('aside [role="radiogroup"] [role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(['FR', 'EN', 'ES']);
    act(() => radios[1]!.click());
    expect(useI18n.getState().locale).toBe('en');
  });

  it('OROS4.17 la barre de titre ne porte plus de micro : la version seule, avant la cellule de mise à jour', () => {
    const el = mount(createElement(Shell, null, createElement('div', null, 'module')));
    // la demande était « Supprimer », pas « S'imprimer » : plus de losange du secteur à gauche de la version
    expect(el.querySelector('header [role="img"][aria-label^="Secteur S.01"]')).toBeNull();
    expect(el.querySelector('header svg.lbl-losange')).toBeNull();
    const header = shellSource.slice(shellSource.indexOf('<header'), shellSource.indexOf('</header>'));
    expect(header).not.toMatch(/<Cartouche\b/);
    expect(header.indexOf('<ChangelogJournal')).toBeGreaterThan(-1);
    expect(header.indexOf('<ChangelogJournal')).toBeLessThan(header.indexOf('<UpdateButton />'));
    expect(rule('.sector')).toBe('');
  });

  it('OROS4.3 chaque en-tête de module dit sa couche du Lab par son seul composant, lu dans une table centrale ; rien sous le titre', () => {
    expect(MODULE_LAYERS).toEqual({ metrique: 'L02', visual: 'L02', calendrier: 'L01', note: 'L05', portefeuille: 'L02', agent: 'L04', bot: 'L04', copieur: 'L03', crypto: 'L03' });
    for (const tab of TABS) {
      const layer = MODULE_LAYERS[tab.id];
      const el = mount(createElement(ModuleHeader, { tab: tab.id }));
      const mark = el.querySelector<HTMLElement>('[data-layer]');
      expect(mark?.getAttribute('data-layer'), tab.id).toBe(layer);
      expect(mark!.getAttribute('aria-label'), tab.id).toMatch(new RegExp(`^Couche ${layer.replace('L0', 'L.0')} · `));
      expect(mark!.querySelector(`svg.skg-${GLYPH_ID[LAYER_GLYPH[layer]]}`), tab.id).not.toBeNull();
      // un composant, une place : plus de bande de couche à côté
      expect(mark!.querySelectorAll('svg'), tab.id).toHaveLength(1);
      expect(el.querySelector('svg.lbl-bande'), tab.id).toBeNull();
      // le titre est le numéro et le nom, rien d'autre
      expect(el.querySelector('h1')?.textContent, tab.id).toBe(`${tab.index}${el.querySelector('h1 span:last-child')?.textContent}`);
      act(() => root?.unmount());
      host?.remove();
      root = null;
    }
    // les modules n'ont rien à passer : la couche se déduit de l'onglet
    const header = shellSource.slice(shellSource.indexOf('export function ModuleHeader'), shellSource.indexOf('export function ModuleContent'));
    expect(header).toMatch(/MODULE_LAYERS\[tab\]/);
    expect(header).not.toMatch(/tagline|def\.code|<Cartouche/);
  });

  it('OROS4.21 le numéro et le nom du module ne cèdent jamais : à l’étroit, les actions passent à la ligne de l’en-tête', () => {
    const plate = rule('.modulePlate');
    expect(plate).toMatch(/flex: none;/);
    expect(plate).not.toMatch(/min-width: 0/);
    const head = rule('.moduleHead');
    expect(head).toMatch(/flex-wrap: wrap;/);
    expect(head).toMatch(/gap: 10px 18px;/);
    // le relevé, lui, s'abrège ; les actions gardent leur bord droit sur leur ligne
    expect(rule('.moduleMeta')).toMatch(/min-width: 0;[^}]*text-overflow: ellipsis;/);
    expect(rule('.moduleActions')).toMatch(/flex-wrap: wrap;[^}]*justify-content: flex-end;[^}]*margin-left: auto;/);
  });

  it('la bande du kill switch : cartouche SK-SIG-3 rouge, titre, sous-titre, plaque critique à droite, 66 px', () => {
    const el = mount(createElement(KillBand));
    const band = el.querySelector<HTMLElement>('[role="alert"]');
    expect(band).not.toBeNull();
    const triangle = band!.querySelector('svg.lbl-triangle');
    expect(triangle?.getAttribute('class')).toMatch(/\bis-signal\b/);
    expect(band!.textContent).toContain('Kill switch engagé');
    expect(band!.textContent).toContain('Soumission fermée jusqu’au redémarrage du desk');
    expect(band!.textContent).toContain('Ctrl+Shift+K');
    const plate = band!.querySelector('svg.mg-critical');
    expect(plate).not.toBeNull();
    // l'ordre de la bande : signal, texte, plaque
    expect(triangle!.compareDocumentPosition(plate!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const look = rule('.band');
    expect(look).toMatch(/height: 66px/);
    expect(look).toMatch(/border-top: 2px solid var\(--signal\)/);
    expect(look).toMatch(/--k: var\(--text-0\)/);
    expect(rule('.bandPlate')).toMatch(/margin-left: auto/);
    // le rouge marque, il n'écrit pas : le texte de la bande reste ivoire
    expect(look).toMatch(/(^|[\s;{])color: var\(--text-0\)/);
  });
});
