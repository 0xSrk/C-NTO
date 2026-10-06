/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React : act() est attendu dans ce fichier.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Faux desk, posé avant le chargement de `@/lib/desk` : deux passerelles, deux jetons distincts. */
const fake = vi.hoisted(() => {
  const state = {
    mcpToken: 'jeton-mcp-0123456789abcdef',
    orchToken: 'jeton-orch-fedcba9876543210',
    copied: [] as string[],
  };
  const idle = { running: false, port: 0, clients: 0 };
  (window as unknown as { canto: unknown }).canto = {
    orchestrator: {
      start: async () => idle,
      stop: async () => idle,
      status: async () => idle,
      rotateToken: async () => idle,
      copyToken: async () => state.orchToken,
      onRequest: () => () => undefined,
      respond: () => undefined,
      onStatus: () => () => undefined,
      broadcast: () => undefined,
    },
    mcp: {
      start: async () => ({ running: true, port: 47118, calls: 0 }),
      stop: async () => ({ running: false, port: 0, calls: 0 }),
      status: async () => ({ running: true, port: 47118, calls: 0 }),
      rotateToken: async () => ({ running: true, port: 47118, calls: 0 }),
      connection: async () => ({ url: 'http://127.0.0.1:47118/mcp', token: state.mcpToken }),
      onStatus: () => () => undefined,
    },
  };
  return state;
});

// Dexie est remplacé par une coquille ; les tables utiles sont posées dans `beforeEach`.
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

import Agent from '@/modules/agent/Agent';
import { db } from '@/store/db';
import { useI18n } from '@/i18n';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  fake.copied.length = 0;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        fake.copied.push(text);
      },
    },
  });
  // jsdom ne fait pas défiler.
  HTMLElement.prototype.scrollTo = () => undefined;
  Object.assign(db as unknown as Record<string, unknown>, {
    settings: { get: async () => undefined, put: async () => undefined },
    agentMessages: { add: async () => undefined, where: () => ({ equals: () => ({ sortBy: async () => [] }) }) },
  });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
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
  await act(async () => {
    root?.render(createElement(Agent));
  });
  return host;
}

/** Bloc de l'onglet dont le titre est `title` (titre de section : `span` dans l'en-tête du bloc). */
function section(node: HTMLElement, title: string): HTMLElement {
  const label = [...node.querySelectorAll('span')].find((el) => el.textContent === title);
  const block = label?.parentElement?.parentElement;
  if (!block) throw new Error(`section introuvable : ${title}`);
  return block;
}

function buttons(node: HTMLElement, text: RegExp): HTMLButtonElement[] {
  return [...node.querySelectorAll('button')].filter((b) => text.test(b.textContent ?? ''));
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

describe('onglet Agent · passerelle MCP', () => {
  it('A14.9 la section MCP copie le jeton de la passerelle MCP, celle de l’orchestrateur garde le sien', async () => {
    const node = await mount();
    const mcp = section(node, 'Agents externes · MCP');
    for (const button of buttons(mcp, /^Copier le jeton/)) await click(button);
    expect(fake.copied).toEqual([fake.mcpToken]);
    expect(buttons(mcp, /^Copier le jeton MCP$/)).toHaveLength(1);

    fake.copied.length = 0;
    const orchestrator = section(node, 'Orchestrateur externe');
    for (const button of buttons(orchestrator, /^Copier le jeton/)) await click(button);
    expect(fake.copied).toEqual([fake.orchToken]);

    for (const [locale, title, label] of [
      ['en', 'External agents · MCP', 'Copy MCP token'],
      ['es', 'Agentes externos · MCP', 'Copiar el token MCP'],
    ] as const) {
      await act(async () => {
        useI18n.setState({ locale });
      });
      fake.copied.length = 0;
      const block = section(node, title);
      const [button] = buttons(block, new RegExp(`^${label}$`));
      expect(button, locale).toBeDefined();
      await click(button!);
      expect(fake.copied).toEqual([fake.mcpToken]);
    }
  });
});
