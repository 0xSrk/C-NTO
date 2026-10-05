import { describe, expect, it, vi } from 'vitest';

describe('réouverture de la passerelle MCP', () => {
  it('seulement si le trader l’avait laissée ouverte, et une seule fois', async () => {
    const starts: [number, boolean][] = [];
    vi.stubGlobal('window', {
      location: { search: '' },
      canto: {
        mcp: {
          start: async (port: number, allow: boolean) => {
            starts.push([port, allow]);
            return { running: true, port, calls: 0 };
          },
          status: async () => ({ running: false, port: 0, calls: 0 }),
          onStatus: () => () => undefined,
        },
      },
    });
    vi.resetModules();
    const { useAgent } = await import('@/store/agent');
    const { useSettings, DEFAULT_SETTINGS } = await import('@/store/settings');

    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, mcpEnabled: false } });
    await useAgent.getState().resumeMcp();
    expect(starts).toEqual([]);

    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, mcpEnabled: true, mcpPort: 47200, orchestratorAllowWrite: false } });
    await useAgent.getState().resumeMcp();
    await useAgent.getState().resumeMcp();
    expect(starts).toEqual([[47200, false]]);
    vi.unstubAllGlobals();
  });
});
