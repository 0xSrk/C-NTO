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
