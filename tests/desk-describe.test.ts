import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_TOOL_TITLES } from '@/engine/agent/catalog';
import { describedDeskTools } from '@/engine/agent/tools';
import { useI18n } from '@/i18n';

// Dexie est remplacé par une coquille : `load()` lit une conversation vide.
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

type Request = { id: string; clientId: string; method: string; params: unknown };
type Described = { name: string; kind: string; title?: string; description: string; parameters: unknown };

describe('A14.1 titres dans desk.describe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('chaque outil porte le titre du catalogue dans la langue active', () => {
    useI18n.setState({ locale: 'en' });
    // Les outils crypto ne sont décrits qu'avec le module allumé (`{ crypto: true }`).
    const tools = describedDeskTools({ crypto: true });
    expect(tools.length).toBe(Object.keys(DESK_TOOL_TITLES).length);
    expect(describedDeskTools().length).toBe(Object.keys(DESK_TOOL_TITLES).filter((name) => !name.startsWith('crypto_')).length);
    for (const tool of tools) {
      const titles = DESK_TOOL_TITLES[tool.name as keyof typeof DESK_TOOL_TITLES];
      expect(tool.title, tool.name).toBe(titles[1]);
      expect(tool.kind === 'read' || tool.kind === 'write').toBe(true);
    }
    useI18n.setState({ locale: 'fr' });
  });

  it('A14.8 la réponse du desk à desk.describe (onRequest) porte le type et le titre de chaque outil, dans la langue du desk', async () => {
    let handler: ((req: Request) => Promise<void>) | null = null;
    const answers: { id: string; clientId: string; result: unknown; error?: string }[] = [];
    vi.stubGlobal('window', {
      location: { search: '' },
      canto: {
        orchestrator: {
          onRequest: (cb: (req: Request) => Promise<void>) => {
            handler = cb;
            return () => undefined;
          },
          respond: (id: string, clientId: string, result: unknown, error?: string) => answers.push({ id, clientId, result, error }),
          onStatus: () => () => undefined,
          status: async () => ({ running: false, port: 0, clients: 0 }),
        },
      },
    });
    vi.resetModules();
    const { db } = await import('@/store/db');
    Object.assign(db as unknown as Record<string, unknown>, {
      settings: { get: async () => undefined },
      agentMessages: { where: () => ({ equals: () => ({ sortBy: async () => [] }) }) },
    });
    const { useAgent } = await import('@/store/agent');
    const { useCrypto } = await import('@/store/crypto');
    const i18n = await import('@/i18n');
    const catalog = await import('@/engine/agent/catalog');
    await useAgent.getState().load();
    expect(handler).not.toBeNull();

    // Les outils `crypto_*` ne sont décrits que module crypto allumé (CRY6.2) : éteint, les 23 autres ; allumé, les 33.
    const all = Object.keys(catalog.DESK_TOOL_KINDS).sort();
    const native = all.filter((name) => !name.startsWith('crypto_'));
    expect(all.length - native.length).toBe(10);
    for (const enabled of [false, true, false]) {
      useCrypto.setState({ enabled });
      const names = enabled ? all : native;
      for (const [index, locale] of (['fr', 'en', 'es'] as const).entries()) {
        i18n.useI18n.setState({ locale });
        for (const clientId of ['mcp', 'c1']) {
          const id = `${clientId}-${locale}-${answers.length}`;
          await handler!({ id, clientId, method: 'desk.describe', params: {} });
          const answer = answers.find((a) => a.id === id);
          expect(answer?.clientId).toBe(clientId);
          expect(answer?.error).toBeUndefined();
          const tools = (answer?.result as { tools: Described[] }).tools;
          expect(tools.map((t) => t.name).sort(), `${enabled} · ${locale} · ${clientId}`).toEqual(names);
          for (const tool of tools) {
            const name = tool.name as keyof typeof catalog.DESK_TOOL_TITLES;
            expect(tool.kind, tool.name).toBe(catalog.DESK_TOOL_KINDS[name]);
            expect(tool.title, `${locale} · ${tool.name}`).toBe(catalog.DESK_TOOL_TITLES[name][index]);
            expect(tool.description.length, tool.name).toBeGreaterThan(0);
          }
        }
      }
    }
    i18n.useI18n.setState({ locale: 'fr' });
  });
});
