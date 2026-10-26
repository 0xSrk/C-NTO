/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('OROS3.3a la plaque AGENT_GUARD lit les invariants de la garde', () => {
  it('ses valeurs viennent des constantes de la garde et du raccourci du process principal', async () => {
    const orders = await import('@/engine/agent/orders');
    const { agentGuardValues } = await import('@/modules/agent/agentGuard');
    const [lo, hi] = orders.AGENT_ORDER_BOUNDS.maxQty;
    expect(agentGuardValues('CommandOrControl+Shift+K')).toEqual({
      accounts: `${orders.AGENT_SIM_PREFIX.toUpperCase()}* // ${lo}–${hi}`,
      confirm: `${orders.AGENT_CONFIRM_TIMEOUT_MS / 1000} S`,
      kill: 'CTRL+SHIFT+K',
    });
    // Raccourci inconnu (navigateur, pont absent) : la plaque dit « — », elle n'invente pas.
    expect(agentGuardValues(null).kill).toBeNull();
  });

  it('changer un invariant change la plaque : aucune valeur n’est recopiée', async () => {
    vi.resetModules();
    vi.doMock('@/engine/agent/orders', async (importOriginal) => {
      const real = await importOriginal<typeof import('@/engine/agent/orders')>();
      return { ...real, AGENT_SIM_PREFIX: 'Demo', AGENT_CONFIRM_TIMEOUT_MS: 30_000, AGENT_ORDER_BOUNDS: { ...real.AGENT_ORDER_BOUNDS, maxQty: [2, 7] } };
    });
    try {
      const { agentGuardValues } = await import('@/modules/agent/agentGuard');
      expect(agentGuardValues('Alt+F4')).toEqual({ accounts: 'DEMO* // 2–7', confirm: '30 S', kill: 'ALT+F4' });
    } finally {
      vi.doUnmock('@/engine/agent/orders');
      vi.resetModules();
    }
  });

  it('le préfixe de la plaque est celui que la garde applique : hors Sim, refus', async () => {
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

  it('le panneau des ordres s’ouvre sur la plaque ; le kill switch est lu au pont, « — » sans lui', async () => {
    const { useBridge } = await import('@/store/bridge');
    useBridge.setState({ nt: nt('CommandOrControl+Shift+K') });
    let node = await panel(false);
    let plate = node.querySelector('svg.mg-agentGuard');
    expect(plate).not.toBeNull();
    expect(plate!.textContent).toContain('ACCOUNTS: SIM* // 1–50');
    expect(plate!.textContent).toContain('CONFIRM — DIALOG: 45 S');
    expect(plate!.textContent).toContain('KILL: CTRL+SHIFT+K');
    // La plaque est la seule à dire le raccourci : elle se lit aux lecteurs d'écran.
    const wrap = plate!.parentElement!;
    expect(wrap.getAttribute('role')).toBe('img');
    expect(wrap.getAttribute('aria-label')).toMatch(/Sim\*.*45 s.*Ctrl\+Shift\+K/);
    act(() => root?.unmount());
    host?.remove();
    useBridge.setState({ nt: null });
    node = await panel(false);
    plate = node.querySelector('svg.mg-agentGuard');
    expect(plate!.textContent).toContain('KILL: —');
  });

  it('la notice dit le délai de la constante, pas un chiffre écrit à la main', async () => {
    const { AGENT_CONFIRM_TIMEOUT_MS } = await import('@/engine/agent/orders');
    const node = await panel(true);
    expect(node.textContent).toContain(`(${AGENT_CONFIRM_TIMEOUT_MS / 1000} s, Refuser par défaut)`);
  });
});
