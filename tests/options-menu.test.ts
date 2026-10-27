/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionsMenu, type OptionItem } from '@/design/OptionsMenu';
import { GLYPH_ID } from '@/design/micro/assets';
import { useI18n } from '@/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useI18n.setState({ locale: 'fr' });
});

function mount(items: OptionItem[]) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(OptionsMenu, { items })));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  const menu = host.querySelector<HTMLElement>('[role="menu"]')!;
  return { trigger, menu, entries: () => [...menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')] };
}

const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

const css = readFileSync('src/design/optionsMenu.module.css', 'utf8').replace(/\r\n/g, '\n');
const rule = (selector: string) => {
  const at = css.search(new RegExp(`^${selector.replace(/[.[\]'()=]/g, '\\$&')} \\{`, 'm'));
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('OROS4.4 le bouton Options d’un module', () => {
  it('s’ouvre sur la première option et se referme par Échap, la main rendue au bouton', () => {
    const run = vi.fn();
    const { trigger, menu, entries } = mount([
      { id: 'a', label: 'Première', glyph: 'csv', onSelect: run },
      { id: 'b', label: 'Seconde', onSelect: run },
    ]);
    expect(trigger.textContent).toContain('Options');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('data-open')).toBe('false');
    act(() => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('data-open')).toBe('true');
    expect(document.activeElement).toBe(entries()[0]);
    // le composant de la planche nomme l'option, muet
    expect(entries()[0]!.querySelector(`svg.skg-${GLYPH_ID.csv}`)?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    key(menu, 'ArrowDown');
    expect(document.activeElement).toBe(entries()[1]);
    key(menu, 'ArrowDown');
    expect(document.activeElement).toBe(entries()[0]);
    key(menu, 'End');
    expect(document.activeElement).toBe(entries()[1]);
    key(menu, 'Escape');
    expect(menu.getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(run).not.toHaveBeenCalled();
  });

  it('une action s’exécute et referme ; un interrupteur se coche et laisse le menu ouvert ; une option fermée ne répond pas', () => {
    const action = vi.fn();
    const toggle = vi.fn();
    const blocked = vi.fn();
    const { trigger, menu, entries } = mount([
      { id: 'a', label: 'Action', onSelect: action },
      { id: 't', label: 'Bascule', checked: true, onSelect: toggle },
      { id: 'x', label: 'Fermée', disabled: true, onSelect: blocked },
    ]);
    act(() => trigger.click());
    const [run, check, off] = entries();
    expect(check!.getAttribute('role')).toBe('menuitemcheckbox');
    expect(check!.getAttribute('aria-checked')).toBe('true');
    expect(run!.getAttribute('role')).toBe('menuitem');
    act(() => check!.click());
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(menu.getAttribute('data-open')).toBe('true');
    act(() => off!.click());
    expect(blocked).not.toHaveBeenCalled();
    act(() => run!.click());
    expect(action).toHaveBeenCalledTimes(1);
    expect(menu.getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('un appui hors du menu le referme ; ↓ sur le bouton l’ouvre', () => {
    const { trigger, menu } = mount([{ id: 'a', label: 'Action', onSelect: () => undefined }]);
    key(trigger, 'ArrowDown');
    expect(menu.getAttribute('data-open')).toBe('true');
    act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(menu.getAttribute('data-open')).toBe('false');
  });

  it('OROS4.23 ↑ sur le bouton ouvre le menu sur sa dernière option, ↓ sur la première', () => {
    const { trigger, menu, entries } = mount([
      { id: 'a', label: 'Première', onSelect: () => undefined },
      { id: 'b', label: 'Milieu', onSelect: () => undefined },
      { id: 'c', label: 'Dernière', onSelect: () => undefined },
    ]);
    key(trigger, 'ArrowUp');
    expect(menu.getAttribute('data-open')).toBe('true');
    expect(document.activeElement).toBe(entries()[2]);
    key(menu, 'Escape');
    expect(document.activeElement).toBe(trigger);
    key(trigger, 'ArrowDown');
    expect(document.activeElement).toBe(entries()[0]);
    key(menu, 'Escape');
    // un clic ouvre toujours sur la première
    act(() => trigger.click());
    expect(document.activeElement).toBe(entries()[0]);
  });

  it('OROS4.42 un ↑ menu déjà ouvert ne colle pas à l’ouverture suivante : Entrée, Espace ou un clic rouvrent sur la première', () => {
    const { trigger, menu, entries } = mount([
      { id: 'a', label: 'Première', onSelect: () => undefined },
      { id: 'b', label: 'Milieu', onSelect: () => undefined },
      { id: 'c', label: 'Dernière', onSelect: () => undefined },
    ]);
    act(() => trigger.click()); // ouvert à la souris : la première
    expect(document.activeElement).toBe(entries()[0]);
    // Dans Chromium : un clic sur le filet entre deux groupes, puis Maj+Tab, rendent le focus au bouton, menu ouvert.
    act(() => trigger.focus());
    key(trigger, 'ArrowUp'); // menu déjà ouvert : la dernière
    expect(document.activeElement).toBe(entries()[2]);
    key(menu, 'Escape');
    expect(menu.getAttribute('data-open')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    // Entrée sur un bouton se dit par son clic : il rouvre sur la première, pas sur la dernière du ↑ d'avant.
    act(() => trigger.click());
    expect(document.activeElement).toBe(entries()[0]);
    // ↓ menu ouvert garde son sens, et ne colle pas davantage.
    act(() => trigger.focus());
    key(trigger, 'ArrowDown');
    expect(document.activeElement).toBe(entries()[0]);
    key(menu, 'Escape');
    key(trigger, 'ArrowUp'); // fermé : ↑ ouvre sur la dernière, comme le veut le motif
    expect(document.activeElement).toBe(entries()[2]);
  });

  it('le code couleur se lit sur le bouton : un point par état lu, à la couleur de l’état ; les filets séparent les groupes', () => {
    const { trigger, menu } = mount([
      { id: 'pont', label: 'Pont', state: 'actif', tone: 'mint', onSelect: () => undefined },
      { id: 'sync', label: 'Synchro', state: 'hors ligne', group: true, onSelect: () => undefined },
      { id: 'plain', label: 'Sans état', onSelect: () => undefined },
    ]);
    expect([...trigger.querySelectorAll('[data-tone]')].map((i) => i.getAttribute('data-tone'))).toEqual(['mint', 'neutral']);
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(menu.textContent).toContain('actif');
    expect(menu.textContent).toContain('hors ligne');
  });

  it('OROS4.22 ce que les points montrent se dit aussi : le nom du bouton porte chaque état lu, sans ouvrir le menu', () => {
    const { trigger } = mount([
      { id: 'pont', label: 'Pont NinjaTrader', state: 'actif', tone: 'mint', onSelect: () => undefined },
      { id: 'sync', label: 'Synchro', state: 'hors ligne', onSelect: () => undefined },
      { id: 'plain', label: 'Sans état', onSelect: () => undefined },
    ]);
    // les points restent muets ; une ligne cachée les dit, dans l'ordre du menu
    expect(trigger.querySelector('[data-tone]')!.parentElement!.getAttribute('aria-hidden')).toBe('true');
    const said = trigger.querySelector('[class*="srOnly"]');
    expect(said?.textContent).toBe(' · Pont NinjaTrader · actif · Synchro · hors ligne');
    expect(trigger.textContent).toBe('Options · Pont NinjaTrader · actif · Synchro · hors ligne');
    // sans état lu, le bouton se nomme « Options », seul
    act(() => root?.unmount());
    host?.remove();
    const bare = mount([{ id: 'a', label: 'Action', onSelect: () => undefined }]);
    expect(bare.trigger.textContent).toBe('Options');
  });

  it('OROS4.24 une option sans composant ni lecture porte sa couleur en point : « Supprimer la série » se lit à la braise', () => {
    const { trigger, entries } = mount([
      { id: 'demo', label: 'Régénérer la démo', onSelect: () => undefined },
      { id: 'supprimer', label: 'Supprimer la série', tone: 'ember', group: true, onSelect: () => undefined },
    ]);
    act(() => trigger.click());
    const [plain, remove] = entries();
    expect(plain!.querySelector('[data-tone]')).toBeNull();
    const dot = remove!.querySelector<HTMLElement>('[data-tone="ember"]');
    expect(dot).not.toBeNull();
    expect(dot!.className).toMatch(/mark/);
    expect(dot!.className).toMatch(/ember/);
    expect(dot!.parentElement!.getAttribute('aria-hidden')).toBe('true');
    // le nom, lui, reste à l'encre de toutes les options ; le point prend la braise du bouton
    expect(rule('.mark.ember')).toMatch(/background: var\(--ember\)/);
    expect(css).not.toMatch(/\.item\.ember \.label|\.item\.ember \{/);
    // le Visual pose la suppression d'une série importée à la braise
    const visual = readFileSync('src/modules/visual/Visual.tsx', 'utf8');
    expect(visual).toMatch(/id: 'supprimer'[^}]*tone: 'ember'/);
  });

  it('OROS4.25 le pont se lit dans le menu : 24 px de large, son trait relevé à un demi-pixel rendu', async () => {
    const { COMPONENTS } = await import('@/design/micro/assets');
    const { trigger, entries } = mount([{ id: 'pont', label: 'Pont NinjaTrader', glyph: 'bridge', state: 'actif', tone: 'mint', onSelect: () => undefined }]);
    act(() => trigger.click());
    const lead = entries()[0]!.querySelector<HTMLElement>('[data-glyph]')!;
    expect(lead.getAttribute('data-glyph')).toBe('bridge');
    expect(lead.querySelector(`svg.skg-${GLYPH_ID.bridge}`)).not.toBeNull();
    const box = rule(".lead[data-glyph='bridge'] .glyph");
    const width = Number(/width: ([\d.]+)px/.exec(box)?.[1]);
    expect(width).toBe(24);
    const [, , vw] = /viewBox="([^"]+)"/.exec(COMPONENTS[GLYPH_ID.bridge]!)![1]!.split(' ').map(Number);
    const raised = Number(/stroke-width: ([\d.]+)px/.exec(rule(".lead[data-glyph='bridge'] :global(.g1-1)"))?.[1]);
    const rendered = (raised * width) / vw!;
    expect(rendered).toBeGreaterThanOrEqual(0.4);
    expect(rendered).toBeLessThanOrEqual(0.75);
  });

  it('parle la langue du desk', () => {
    useI18n.setState({ locale: 'es' });
    const { trigger } = mount([{ id: 'a', label: 'Acción', onSelect: () => undefined }]);
    expect(trigger.textContent).toContain('Opciones');
  });

  it('se déroule, fluide : le menu glisse et s’éclaire, chaque option entre à son tour ; il reste au bord droit du bouton', () => {
    const menu = rule('.menu');
    expect(menu).toMatch(/right: 0/);
    expect(menu).toMatch(/opacity: 0/);
    expect(menu).toMatch(/transform: translateY\(-6px\) scale\(0\.985\)/);
    expect(menu).toMatch(/transition:[\s\S]*transform 240ms var\(--ease-out\)/);
    expect(menu).toMatch(/background-image: var\(--light-edge\)/);
    expect(rule(".menu[data-open='true']")).toMatch(/opacity: 1/);
    expect(rule(".menu[data-open='true'] .row")).toMatch(/transition-delay: calc\(var\(--i, 0\) \* 24ms\)/);
  });
});
