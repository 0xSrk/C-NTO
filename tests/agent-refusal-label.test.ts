import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('refus d’écriture relayé à un agent externe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('nomme la porte du client (MCP ou orchestrateur), dans la langue du desk', async () => {
    let handler: ((req: Request) => Promise<void>) | null = null;
    const answers: { clientId: string; error?: string }[] = [];
    vi.stubGlobal('window', {
      location: { search: '' },
      canto: {
        orchestrator: {
          onRequest: (cb: (req: Request) => Promise<void>) => {
            handler = cb;
            return () => undefined;
          },
          respond: (_id: string, clientId: string, _result: unknown, error?: string) => answers.push({ clientId, error }),
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
    const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');
    const { useI18n } = await import('@/i18n');
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, orchestratorAllowWrite: false } });
    useI18n.setState({ locale: 'fr' });
    await useAgent.getState().load();
    expect(handler).not.toBeNull();
    const write = (id: string, clientId: string) => handler!({ id, clientId, method: 'tool.create_note', params: { title: 'T', body: 'B' } });

    await write('m1', 'mcp');
    await write('o1', 'c1');
    expect(answers[0]?.error).toMatch(/Agent IA › Options › Agents externes · MCP/);
    expect(answers[1]?.error).toMatch(/Agent IA › Options › Orchestrateur externe/);

    useI18n.setState({ locale: 'en' });
    await write('m2', 'mcp');
    await write('o2', 'c1');
    expect(answers[2]?.error).toMatch(/AI Agent › Options › External agents · MCP/);
    expect(answers[3]?.error).toMatch(/AI Agent › Options › External orchestrator/);

    useI18n.setState({ locale: 'es' });
    await write('m3', 'mcp');
    expect(answers[4]?.error).toMatch(/Agente IA › Opciones › Agentes externos · MCP/);
  });
});
