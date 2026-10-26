/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ModuleHeader } from '@/app/Shell';

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(props: Parameters<typeof ModuleHeader>[0]) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ModuleHeader, props)));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('OROS2.5 en-tête de module en bloc-titre', () => {
  it('le numéro d’afficheur, le nom, puis les cellules que le module passe, dans son ordre', () => {
    const el = mount({ tab: 'metrique', cells: [{ label: 'Période', value: '28.09 → 23.10' }, { label: 'Séances', value: '18' }, { label: 'Source', value: 'Démonstration', plan: true }] });
    expect(el.querySelector('h1')?.textContent).toContain('Métrique');
    expect(el.textContent).toContain('01');
    const cells = [...el.querySelectorAll('dl > div')].map((div) => [div.querySelector('dt')?.textContent, div.querySelector('dd')?.textContent]);
    expect(cells).toEqual([
      ['Période', '28.09 → 23.10'],
      ['Séances', '18'],
      ['Source', 'Démonstration'],
    ]);
  });

  it('sans cellule passée, aucun bloc-titre : l’en-tête n’invente rien', () => {
    const el = mount({ tab: 'visual' });
    expect(el.querySelector('dl')).toBeNull();
  });

  it('aucune cellule écrite en dur dans l’en-tête ; Métrique passe les siennes', () => {
    const shell = readFileSync('src/app/Shell.tsx', 'utf8');
    const header = shell.slice(shell.indexOf('export function ModuleHeader'), shell.indexOf('export function ModuleContent'));
    expect(header).not.toMatch(/Période|Séances|Compte|Source/);
    expect(readFileSync('src/modules/metrique/Metrique.tsx', 'utf8')).toMatch(/<ModuleHeader[\s\S]*?cells=\{/);
  });
});
