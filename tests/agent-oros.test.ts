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
    expect(node.textContent).toContain('ou après le kill switch (Ctrl+Maj+K), l’agent ne peut plus ouvrir ni augmenter');
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
    expect(node.textContent).toContain('o tras el kill switch (Ctrl+Mayús+K), el agente ya no puede abrir ni aumentar');
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

  // OROS5.42 : réécrit — M.060 remplace la notice ; son pied dit le délai de la constante, pas un chiffre écrit à la main.
  it('le pied de M.060 dit les comptes Sim*, le délai de la constante et le refus par défaut, dans les trois langues', async () => {
    const { AGENT_CONFIRM_TIMEOUT_MS, AGENT_SIM_PREFIX } = await import('@/engine/agent/orders');
    const { useI18n } = await import('@/i18n');
    const node = await panel(true);
    const foot = () => node.querySelector('[data-plate="M.060"] [data-foot]')?.textContent;
    expect(foot()).toBe(`comptes ${AGENT_SIM_PREFIX}* · ${AGENT_CONFIRM_TIMEOUT_MS / 1000} s · refuser par défaut`);
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(foot()).toBe(`${AGENT_SIM_PREFIX}* accounts · ${AGENT_CONFIRM_TIMEOUT_MS / 1000} s · decline by default`);
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(foot()).toBe(`cuentas ${AGENT_SIM_PREFIX}* · ${AGENT_CONFIRM_TIMEOUT_MS / 1000} s · rechazar por defecto`);
    // Plus de paragraphe de notice ; aucun délai écrit à la main dans le panneau.
    expect(node.textContent).not.toContain('L’agent ne soumet rien');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/modules/agent/AgentOrdersPanel.tsx', 'utf8')).not.toMatch(/\b45\b/);
  });
});

describe('OROS5.42 M.060 remplace la notice des ordres de l’agent', () => {
  const ON = { enabled: true, maxQty: 2, maxPosition: 10, perMinute: 3, pending: false };

  it('l’état des ordres se dit dans les mots de la porte du rail ; le trait vient de la table d’états', async () => {
    const { useAgentOrders } = await import('@/store/agentOrders');
    const { useKillLatch } = await import('@/app/killState');
    const { readGates } = await import('@/app/RailGates');
    const e = (await import('@/design/etat.module.css')).default;
    const cases = [
      [{ ...ON, enabled: false }, false, 'désactivés', e.eteint],
      [ON, false, 'autorisés · Sim', e.plein],
      [{ ...ON, pending: true }, false, 'en attente de vous', e.tirete],
      [ON, true, 'fermés jusqu’au redémarrage', e.eteint],
    ] as const;
    for (const [status, killed, word, etat] of cases) {
      useAgentOrders.setState({ status });
      useKillLatch.setState({ engaged: killed });
      const node = await panel(true);
      const plate = node.querySelector<HTMLElement>('[data-plate="M.060"]')!;
      expect(plate.querySelector('[data-orders-state]')?.textContent).toBe(word);
      expect(plate.className).toContain(etat);
      const porte = readGates({ orders: status, ordersAvailable: true, copier: null, allowWrite: false, link: null, ordersOpen: undefined, killed }).find((g) => g.id === 'agentOrders')!;
      expect(porte.word).toBe(word);
      // Une seule fois : plus de pastille d'état dans le titre du panneau.
      expect(node.textContent?.split(word).length).toBe(2);
      act(() => root?.unmount());
      host?.remove();
    }
    useKillLatch.setState({ engaged: false });
  });

  it('les barres maxQty, maxPosition et perMinute se posent sur AGENT_ORDER_BOUNDS', async () => {
    const { AGENT_ORDER_BOUNDS } = await import('@/engine/agent/orders');
    const { useAgentOrders } = await import('@/store/agentOrders');
    useAgentOrders.setState({ status: ON });
    const node = await panel(true);
    const rows = [...node.querySelectorAll<HTMLElement>('[data-plate="M.060"] [data-limit]')];
    expect(rows.map((row) => row.dataset.limit)).toEqual(['maxQty', 'maxPosition', 'perMinute']);
    for (const row of rows) {
      const key = row.dataset.limit as keyof typeof AGENT_ORDER_BOUNDS;
      const hi = AGENT_ORDER_BOUNDS[key][1];
      expect(row.querySelector('b')?.textContent).toBe(`${ON[key]} / ${hi}`);
      expect(row.querySelector<HTMLElement>('i')?.style.width).toBe(`${(ON[key] / hi) * 100}%`);
    }
  });

  it('Autoriser… et Relever les limites… portent C.070 et n’appellent que les méthodes de dialogue existantes', async () => {
    const { useAgentOrders } = await import('@/store/agentOrders');
    const enable = vi.fn(async () => undefined);
    const setLimits = vi.fn(async () => undefined);
    const disable = vi.fn(async () => undefined);
    useAgentOrders.setState({ status: { ...ON, enabled: false }, enable, setLimits, disable });
    let node = await panel(true);
    const allow = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Autoriser…')!;
    expect(allow.querySelector('[class*="gateNut"] svg')).not.toBeNull();
    await act(async () => allow.click());
    expect(enable).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    host?.remove();
    // Relever une limite : le bouton le dit et porte l'écrou ; baisser seulement est immédiat, sans écrou.
    useAgentOrders.setState({ status: ON });
    node = await panel(true);
    const input = (key: number) => node.querySelectorAll<HTMLInputElement>('input[type="number"]')[key]!;
    const type = async (el: HTMLInputElement, value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await type(input(0), '1');
    let apply = node.querySelector<HTMLButtonElement>('button[data-limits]')!;
    expect([apply.dataset.limits, apply.textContent, !!apply.querySelector('[class*="gateNut"]')]).toEqual(['lower', 'Abaisser les limites', false]);
    await type(input(0), '5');
    apply = node.querySelector<HTMLButtonElement>('button[data-limits]')!;
    expect([apply.dataset.limits, apply.textContent, !!apply.querySelector('[class*="gateNut"]')]).toEqual(['raise', 'Relever les limites…', true]);
    await act(async () => apply.click());
    expect(setLimits).toHaveBeenCalledWith({ maxQty: 5, maxPosition: 10, perMinute: 3 });
    // Le panneau ne joint le process principal que par le store : ni le pont, ni une IPC, ni une autre écriture.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/modules/agent/AgentOrdersPanel.tsx', 'utf8');
    expect(source).not.toMatch(/window\.canto|\bdesk\?\.|ipcRenderer|\.propose\(/);
    expect(source).not.toMatch(/import \{[^}]*\bdesk\b[^}]*\} from/);
    const called = [...source.matchAll(/useAgentOrders\(\(a\) => a\.(\w+)\)/g)].map((m) => m[1]).sort();
    expect(called).toEqual(['disable', 'enable', 'last', 'refresh', 'setLimits', 'status']);
  });
});
