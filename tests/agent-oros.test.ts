/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { NtBridgeStatus } from '@/lib/desk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Statut du pont tel que l'envoie le process principal (seul le raccourci du kill switch compte ici). */
function nt(killSwitchShortcut: string): NtBridgeStatus {
  return { link: 'absent', port: 48231, addonVersion: null, ntVersion: null, accounts: [], accountNames: [], heartbeatLatencyMs: null, ordersOpen: false, hasToken: false, extraAccounts: [], maxContractsPerOrder: 20, killSwitchShortcut };
}

async function panel(available: boolean): Promise<HTMLDivElement> {
  const { AgentOrdersPanel } = await import('@/modules/agent/AgentOrdersPanel');
  const { useI18n } = await import('@/i18n');
  useI18n.setState({ locale: 'fr' });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(AgentOrdersPanel, { available })));
  return host;
}

describe('OROS4.10 le panneau des ordres s’ouvre sur son titre, sans plaque AGENT_GUARD ; la notice dit la garde', () => {
  it('ni plaque ni sa lecture : le titre du panneau vient en premier', async () => {
    const { useBridge } = await import('@/store/bridge');
    useBridge.setState({ nt: nt('CommandOrControl+Shift+K') });
    const node = await panel(true);
    expect(node.querySelector('svg.mg-agentGuard')).toBeNull();
    expect(node.querySelector('[role="img"]')).toBeNull();
    expect(node.firstElementChild?.firstElementChild?.textContent).toMatch(/^Ordres proposés par l’agent/);
    const guard = await import('@/modules/agent/agentGuard');
    expect(Object.keys(guard)).not.toContain('agentGuardValues');
    expect(Object.keys(guard)).not.toContain('agentGuardLabel');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/modules/agent/agent.module.css', 'utf8')).not.toMatch(/\.guardPlate/);
  });

  it('la notice nomme le kill switch avec le raccourci qu’annonce le process principal ; sans pont, elle n’en invente aucun', async () => {
    const { useBridge } = await import('@/store/bridge');
    useBridge.setState({ nt: nt('CommandOrControl+Shift+K') });
    let node = await panel(true);
    expect(node.textContent).toContain('ou après le kill switch (Ctrl+Shift+K), l’agent ne peut plus ouvrir ni augmenter');
    act(() => root?.unmount());
    host?.remove();
    // Un autre raccourci annoncé : la notice le suit, rien n'est écrit à la main.
    useBridge.setState({ nt: nt('Alt+F4') });
    node = await panel(true);
    expect(node.textContent).toContain('après le kill switch (Alt+F4)');
    act(() => root?.unmount());
    host?.remove();
    useBridge.setState({ nt: null });
    node = await panel(true);
    expect(node.textContent).toContain('ou après le kill switch, l’agent ne peut plus ouvrir ni augmenter');
    expect(node.textContent).not.toMatch(/Ctrl\+|Alt\+/);
  });

  it('les trois langues portent le raccourci', async () => {
    const { useBridge } = await import('@/store/bridge');
    const { useI18n } = await import('@/i18n');
    useBridge.setState({ nt: nt('CommandOrControl+Shift+K') });
    const node = await panel(true);
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(node.textContent).toContain('or after the kill switch (Ctrl+Shift+K), the agent can no longer open or add');
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(node.textContent).toContain('o tras el kill switch (Ctrl+Shift+K), el agente ya no puede abrir ni aumentar');
  });
});

describe('OROS3.3a les invariants que dit la notice sont ceux que la garde applique', () => {
  it('le compte Sim de la notice est le préfixe que la garde applique : hors Sim, refus', async () => {
    const { AGENT_ORDER_DEFAULTS, AGENT_SIM_PREFIX, guardProposal } = await import('@/engine/agent/orders');
    const policy = { ...AGENT_ORDER_DEFAULTS, enabled: true };
    const snap = { busy: false, link: 'live', ordersOpen: true, recent: [], now: 0, position: 0 } as unknown as Parameters<typeof guardProposal>[2];
    const proposal = (account: string) => ({ account, instrument: 'MNQ', side: 'buy' as const, qty: 1, type: 'market' as const, reason: 'test' });
    expect(guardProposal(proposal('Live7'), policy, snap)).toMatchObject({ ok: false, reason: 'not_sim' });
    const sim = guardProposal(proposal(`${AGENT_SIM_PREFIX}101`), policy, snap);
    expect(sim.ok || sim.reason !== 'not_sim').toBe(true);
  });

  it('le délai du dialogue est celui que le process principal applique', async () => {
    const engine = await import('@/engine/agent/orders');
    const main = await import('../electron/agent-orders');
    expect(main.AGENT_CONFIRM_TIMEOUT_MS).toBe(engine.AGENT_CONFIRM_TIMEOUT_MS);
  });

  it('la notice dit le délai de la constante, pas un chiffre écrit à la main', async () => {
    const { AGENT_CONFIRM_TIMEOUT_MS } = await import('@/engine/agent/orders');
    const node = await panel(true);
    expect(node.textContent).toContain(`(${AGENT_CONFIRM_TIMEOUT_MS / 1000} s, Refuser par défaut)`);
  });
});
