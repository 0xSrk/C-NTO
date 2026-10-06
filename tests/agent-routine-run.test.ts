import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderRoutine } from '@/engine/agent/routines';

const provider = vi.hoisted(() => ({ calls: 0 }));

vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = { stores() { return chain; }, upgrade() { return chain; } };
      return chain;
    }
    on() {}
    close() {}
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

vi.mock('@/engine/agent/llm', () => ({
  probeProvider: vi.fn(),
  streamChat: vi.fn(async () => {
    provider.calls += 1;
    return { text: 'ok', toolCalls: [] };
  }),
}));

const NOW = Date.parse('2026-10-06T13:00:00Z');

const REFUSAL = {
  fr: 'Les outils du desk sont coupés : le brief et le débrief ne partent pas.',
  en: 'Desk tools are off: the brief and the debrief are not sent.',
  es: 'Las herramientas del desk están cortadas: el brief y el debrief no se envían.',
} as const;

describe('A12.2 lancer une routine depuis le store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    provider.calls = 0;
  });

  async function boot() {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.resetModules();
    const { db } = await import('@/store/db');
    const added: { role: string; content: string }[] = [];
    Object.assign(db as unknown as Record<string, unknown>, {
      settings: { get: async () => undefined, put: async () => undefined },
      agentMessages: {
        add: async (message: { role: string; content: string }) => {
          added.push(message);
        },
        where: () => ({ equals: () => ({ sortBy: async () => [] }) }),
      },
    });
    const { useAgent } = await import('@/store/agent');
    const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');
    const { useI18n } = await import('@/i18n');
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, agent: { ...DEFAULT_SETTINGS.agent, toolsEnabled: true } } });
    useI18n.setState({ locale: 'fr' });
    await useAgent.getState().load();
    return { useAgent, useSettings, useI18n, DEFAULT_SETTINGS, added };
  }

  it('envoie le texte de renderRoutine, et rien au fournisseur si les outils sont coupés', async () => {
    const { useAgent, useSettings, useI18n, DEFAULT_SETTINGS, added } = await boot();
    await useAgent.getState().runRoutine('pre_session_brief', { instrument: 'MNQ' });
    const rendered = renderRoutine('pre_session_brief', { instrument: 'MNQ' }, { locale: 'fr', allowWrites: true, now: NOW });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(added.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([rendered.text]);
    expect(provider.calls).toBe(1);

    provider.calls = 0;
    added.length = 0;
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS, agent: { ...DEFAULT_SETTINGS.agent, toolsEnabled: false } } });
      await useAgent.getState().runRoutine('session_debrief', {});
      expect(useAgent.getState().notice).toBe(REFUSAL[locale]);
    }
    expect(added).toEqual([]);
    expect(provider.calls).toBe(0);
  });
});
