/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Dexie est remplacé par une coquille ; les tables lues au montage sont posées dans `beforeEach`.
vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = {
        stores() {
          return chain;
        },
        upgrade() {
          return chain;
        },
      };
      return chain;
    }
    on() {}
    close() {}
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

import { GLYPH_ID } from '@/design/micro/assets';
import { useI18n } from '@/i18n';
import Agent from '@/modules/agent/Agent';
import { useAgent } from '@/store/agent';
import { db } from '@/store/db';
import { useJournal } from '@/store/journal';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  HTMLElement.prototype.scrollTo = () => undefined;
  Object.assign(db as unknown as Record<string, unknown>, {
    settings: { get: async () => undefined, put: async () => undefined },
    agentMessages: { add: async () => undefined, where: () => ({ equals: () => ({ sortBy: async () => [] }) }) },
  });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, agent: { ...DEFAULT_SETTINGS.agent, toolsEnabled: true } } });
  useJournal.setState({ sessions: [], trades: [] });
  useAgent.setState({ messages: [], streaming: false, streamText: '', pendingTool: null, error: null, notice: null });
  useI18n.setState({ locale: 'fr' });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Agent)));
  return host;
}

/** Texte lisible d'un élément : sans les styles embarqués des composants de la planche. */
const textOf = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('svg').forEach((svg) => svg.remove());
  return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
};

const glyphs = (el: Element) => [...el.querySelectorAll('svg[class*="skg-"]')].map((svg) => Number(/\bskg-(\d+)\b/.exec(svg.getAttribute('class') ?? '')?.[1]));

describe('OROS3.3b Agent IA : emblème, interrupteur des outils, test de connexion', () => {
  it('la conversation vide s’ouvre sur l’emblème de l’agent, muet (le titre le dit)', async () => {
    const node = await mount();
    const title = [...node.querySelectorAll('h2')].find((h) => textOf(h) === 'Passerelle agent')!;
    expect(title).toBeDefined();
    const welcome = title.parentElement!;
    expect(glyphs(welcome)).toEqual([GLYPH_ID.agent]);
    const emblem = welcome.querySelector(`svg.skg-${GLYPH_ID.agent}`)!.parentElement!;
    expect(emblem.getAttribute('aria-hidden')).toBe('true');
    expect(emblem.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('l’interrupteur « Outils du desk » montre le composant de la bascule, garde son rôle et bascule l’état', async () => {
    const node = await mount();
    const toggle = [...node.querySelectorAll('[role="switch"]')].find((el) => /activés|désactivés/.test(textOf(el)))!;
    expect(toggle).toBeDefined();
    expect(glyphs(toggle)).toEqual([GLYPH_ID.toggle]);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(textOf(toggle)).toBe('activés');
    await act(async () => (toggle as HTMLButtonElement).click());
    expect(useSettings.getState().settings.agent.toolsEnabled).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(textOf(toggle)).toBe('désactivés');
  });

  it('allumée, la bascule est à l’or (le vivant) ; éteinte, à l’encre des libellés', () => {
    const css = readFileSync('src/modules/agent/agent.module.css', 'utf8');
    expect(css).toMatch(/\[aria-checked='true'\]\s+\.toggleGlyph\s*\{[^}]*--k:\s*var\(--gold\)/);
    expect(css).toMatch(/\.toggleGlyph\s*\{[^}]*--k:\s*var\(--text-2\)/);
  });

  it('« Tester la connexion » porte la flèche de test de la planche', async () => {
    const node = await mount();
    const button = [...node.querySelectorAll('button')].find((el) => textOf(el) === 'Tester la connexion')!;
    expect(button).toBeDefined();
    expect(glyphs(button)).toEqual([GLYPH_ID.arrowTest]);
  });
});
