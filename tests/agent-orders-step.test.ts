/**
 * @vitest-environment jsdom
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * OROS5.40 — le process principal publie l'étape d'une proposition (décision 9 de l'ADMIN, § 5) : en lecture seule, par une
 * méthode nommée du preload, gardée puis dialogue ouvert à hh:mm:ss, et une issue `declined` typée (`timeout`). La carte
 * suit l'étape sans relecture : ni minuterie ni statut relu dans le store. La garde, le dialogue (Refuser par défaut, 45 s)
 * et les limites ne changent pas.
 */

/** Faux desk, posé avant le chargement de `@/lib/desk` : l'étape arrive par `onStep`, l'issue quand le test la rend. */
const fake = vi.hoisted(() => {
  const state = { step: null as ((raw: unknown) => void) | null, release: null as ((outcome: unknown) => void) | null, calls: [] as unknown[][], statusReads: 0 };
  const status = { enabled: true, maxQty: 1, maxPosition: 2, perMinute: 3, pending: false };
  (window as unknown as { canto: unknown }).canto = {
    agentOrders: {
      status: async () => {
        state.statusReads += 1;
        return status;
      },
      enable: async () => status,
      disable: async () => status,
      limits: async () => status,
      propose: (...args: unknown[]) => {
        state.calls.push(args);
        return new Promise((resolve) => {
          state.release = resolve;
        });
      },
      onStep: (cb: (raw: unknown) => void) => {
        state.step = cb;
        return () => undefined;
      },
    },
  };
  return state;
});

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { AgentOrderHost, AGENT_CONFIRM_TIMEOUT_MS, type AgentDialogOptions, type AgentProposalStep, type BridgeView } from '../electron/agent-orders';
import { ProposalCard } from '@/app/objects/ProposalFiche';
import { cellStates, outcomeDetail, outcomeTitle, proposalView } from '@/app/objects/proposals';
import { eventLine } from '@/app/registre';
import { AGENT_CONFIRM_TIMEOUT_MS as ENGINE_TIMEOUT_MS } from '@/engine/agent/orders';
import { useI18n } from '@/i18n';
import { useAgentOrders } from '@/store/agentOrders';
import { deskEventLog } from '@/store/deskEvents';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

const PROPOSAL = { account: 'sim101', instrument: 'mnq 12-26', side: 'buy', qty: 1, type: 'market', reason: 'cassure de l’Opening Range' };
const VIEW: BridgeView = { link: 'live', ordersOpen: true, accounts: [{ name: 'Sim101', positions: [{ instrument: 'MNQ 12-26', quantity: 1 }] }] };

/** Le process principal, avec ses vraies gardes et son vrai dialogue ; la fenêtre et le pont sont des doublures. */
function harness(opts: { answers?: number[]; hang?: boolean; confirmTimeoutMs?: number; view?: BridgeView; window?: () => { isDestroyed: () => boolean } | null } = {}) {
  const timeline: string[] = [];
  const published: AgentProposalStep[] = [];
  const dialogs: AgentDialogOptions[] = [];
  const answers = [...(opts.answers ?? [])];
  let clock = 1_000_000;
  const host = new AgentOrderHost({
    userDataDir: mkdtempSync(path.join(tmpdir(), 'canto-agent-step-')),
    locale: () => 'fr',
    window: opts.window ?? (() => ({ isDestroyed: () => false })),
    showMessageBox: (_w, options) => {
      dialogs.push(options);
      // Deux marques distinctes : le dialogue (« box ») et chaque étape publiée (« step:… »), pour tenir leur ordre.
      timeline.push('box');
      if (opts.hang && options.signal) return new Promise((resolve) => options.signal?.addEventListener('abort', () => resolve({ response: options.cancelId })));
      return Promise.resolve({ response: answers.shift() ?? 1 });
    },
    bridge: () => opts.view ?? VIEW,
    submit: async () => ({ ok: true, orderId: 'nt-1', latencyMs: 3 }),
    log: () => undefined,
    publish: (step) => {
      published.push(step);
      timeline.push(`step:${step.stage}`);
    },
    now: () => (clock += 1000),
    confirmTimeoutMs: opts.confirmTimeoutMs,
  });
  return { host, published, dialogs, timeline };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  useI18n.setState({ locale: 'fr' });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useAgentOrders.setState({ proposals: [], last: null });
  fake.calls.length = 0;
  fake.statusReads = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('OROS5.40 l’étape d’une proposition, publiée par le process principal', () => {
  it('l’étape suit gardée → dialogue → issue : publiée avant le dialogue, avec les noms et la position du dialogue', async () => {
    const h = harness({ answers: [0, 1] });
    await h.host.enable();
    const outcome = await h.host.propose(PROPOSAL, 'mcp', null, null, 'p7');
    expect(outcome).toEqual({ status: 'declined', detail: 'refusé par le trader', timeout: false });
    // L'activation n'a pas d'étape ; la proposition : gardée, dialogue ouvert, puis le dialogue lui-même (OROS5.40b : le
    // dialogue et l'étape portent deux marques, l'étape `dialog` part avant que le dialogue ne s'ouvre).
    expect(h.timeline).toEqual(['box', 'step:guarded', 'step:dialog', 'box']);
    const [guarded, dialog] = h.published;
    expect(guarded).toEqual({ ticket: 'p7', stage: 'guarded', at: guarded!.at, account: 'Sim101', instrument: 'MNQ 12-26', position: 1, resulting: 2 });
    expect(dialog).toEqual({ ticket: 'p7', stage: 'dialog', at: guarded!.at, deadline: guarded!.at + AGENT_CONFIRM_TIMEOUT_MS });
    // Ce que l'étape dit est ce que dit le dialogue : les noms du pont, la position avant et après.
    expect(h.dialogs[1]!.detail).toContain('ACHAT 1 × MNQ 12-26 au marché');
    expect(h.dialogs[1]!.detail).toContain('Compte : Sim101');
    expect(h.dialogs[1]!.detail).toContain('Position : +1 → +2');
    // Ni jeton ni secret : les seules clés de l'étape.
    expect(h.published.map((step) => Object.keys(step).sort())).toEqual([
      ['account', 'at', 'instrument', 'position', 'resulting', 'stage', 'ticket'],
      ['at', 'deadline', 'stage', 'ticket'],
    ]);
  });

  it('le timeout est typé ; la garde, le dialogue et les limites ne changent pas', async () => {
    const late = harness({ answers: [0], hang: true, confirmTimeoutMs: 30 });
    await late.host.enable();
    const silent = await late.host.propose(PROPOSAL, 'llm', null, null, 'p8');
    expect(silent).toMatchObject({ status: 'declined', timeout: true });
    expect((late.published[1] as { deadline: number }).deadline - late.published[1]!.at).toBe(30);
    expect(late.dialogs[1]).toMatchObject({ defaultId: 1, cancelId: 1, noLink: true });

    // Refusée par la garde : aucune étape. Sans ticket, ou un ticket mal formé : la même issue, rien de publié.
    const g = harness({ answers: [0] });
    await g.host.enable();
    expect(await g.host.propose({ ...PROPOSAL, account: 'APEX-50K' }, 'llm', null, null, 'p9')).toMatchObject({ status: 'refused', reason: 'not_sim' });
    expect(await g.host.propose({ ...PROPOSAL, qty: 5 }, 'llm', null, null, 'p10')).toMatchObject({ status: 'refused', reason: 'quantity' });
    expect(g.published).toEqual([]);
    for (const ticket of [null, 'p 11', 'x'.repeat(33), { id: 'p12' }]) {
      const t = harness({ answers: [0, 1] });
      await t.host.enable();
      expect(await t.host.propose(PROPOSAL, 'llm', null, null, ticket)).toEqual({ status: 'declined', detail: 'refusé par le trader', timeout: false });
      expect(t.published).toEqual([]);
      expect(t.dialogs).toHaveLength(2);
    }
  });

  it('le store suit l’étape sans relecture : aucune minuterie, le statut relu une fois, à l’issue', async () => {
    const pending = useAgentOrders.getState().propose(PROPOSAL, 'llm');
    const [sent] = fake.calls;
    const ticket = sent![4] as string;
    expect(ticket).toBe(useAgentOrders.getState().proposals[0]!.id);
    const view = () => proposalView(useAgentOrders.getState().proposals[0]!);
    expect(view().stage).toBe('desk');
    // Une étape d'une autre proposition, ou mal formée : rien ne bouge.
    fake.step!({ ticket: 'p999', stage: 'guarded', at: 1, account: 'X', instrument: 'Y', position: 0, resulting: 1 });
    fake.step!({ ticket, stage: 'guarded', at: 1, account: 'Sim101', instrument: 'MNQ 12-26', position: 'un', resulting: 2 });
    fake.step!({ ticket, stage: 'dialog', at: 10, deadline: 5 });
    expect(view().stage).toBe('desk');
    const at = Date.now();
    fake.step!({ ticket, stage: 'guarded', at, account: 'Sim101', instrument: 'MNQ 12-26', position: 1, resulting: 2 });
    expect(view()).toMatchObject({ stage: 'guarded', account: 'Sim101', instrument: 'MNQ 12-26', position: 1 });
    fake.step!({ ticket, stage: 'dialog', at, deadline: at + ENGINE_TIMEOUT_MS });
    expect(view()).toMatchObject({ stage: 'dialog', window: { opened: at, deadline: at + ENGINE_TIMEOUT_MS } });
    expect(cellStates(view()).at(-1)).toBe('pending');
    expect(outcomeTitle(view())).toBe('En attente de vous');
    expect(fake.statusReads).toBe(0);

    fake.release!({ status: 'declined', detail: 'sans réponse du trader en 45 s : non envoyé', timeout: true });
    await pending;
    expect(fake.statusReads).toBe(1);
    expect(view()).toMatchObject({ stage: 'decided', window: { opened: at }, position: 1 });
    expect(outcomeTitle(view())).toBe(`Sans réponse en ${ENGINE_TIMEOUT_MS / 1000} s`);
    expect(outcomeDetail(view())).toBe('non envoyée · refus par défaut');
    // L'issue décidée ne bouge plus ; l'événement du registre porte l'issue typée.
    fake.step!({ ticket, stage: 'guarded', at, account: 'Autre', instrument: 'MNQ 12-26', position: 0, resulting: 1 });
    expect(view().account).toBe('Sim101');
    const ev = deskEventLog.last()!;
    expect(ev.data).toMatchObject({ status: 'declined', timeout: true });
    expect(eventLine(ev).detail).toBe(`achat 1 · sans réponse en ${ENGINE_TIMEOUT_MS / 1000} s`);

    const store = readFileSync('src/store/agentOrders.ts', 'utf8');
    expect(store).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|\b250\b/);
  });

  it('la carte suit l’étape : dialogue ouvert à hh:mm:ss, la barre du délai seule à l’or, refusée par vous', async () => {
    const pending = useAgentOrders.getState().propose(PROPOSAL, 'llm');
    const ticket = fake.calls[0]![4] as string;
    const opened = Date.parse('2026-10-14T14:05:00Z');
    fake.step!({ ticket, stage: 'guarded', at: opened, account: 'Sim101', instrument: 'MNQ 12-26', position: 1, resulting: 2 });
    fake.step!({ ticket, stage: 'dialog', at: opened, deadline: opened + ENGINE_TIMEOUT_MS });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const render = () => act(async () => root!.render(createElement(ProposalCard, { p: proposalView(useAgentOrders.getState().proposals[0]!) })));
    await render();
    expect(host.querySelector('[data-stage]')?.getAttribute('data-stage')).toBe('dialog');
    expect(host.querySelector('[data-window="open"]')?.textContent).toBe('Dialogue du desk ouvert à 10:05:00 ET · refus par défaut à 10:05:45 ET');
    expect(host.querySelector('[data-deadline]')?.getAttribute('aria-valuemax')).toBe(String(ENGINE_TIMEOUT_MS / 1000));
    expect(host.querySelector('[data-dialog]')?.textContent).toContain('Position : +1 → +2');
    expect(host.querySelector('[data-step="you"]')?.getAttribute('data-state')).toBe('current');

    fake.release!({ status: 'declined', detail: 'refusé par le trader', timeout: false });
    await pending;
    await render();
    expect(host.querySelector('[data-deadline]')).toBeNull();
    expect(host.querySelector('[data-window="closed"]')).not.toBeNull();
    expect(host.querySelector('[data-refusal]')?.textContent).toBe('Refusée par vousnon envoyée');

    // L'or ne dit que la barre du délai : une seule règle de la carte le porte.
    const gold = cssRules(readFileSync('src/app/objects/proposal.module.css', 'utf8')).filter((r) => r.body.includes('--gold'));
    expect(gold.map((r) => r.selector)).toEqual(['.bar i']);
  });

  it('OROS5.40a la barre du délai ne se recale pas à chaque rendu : son délai est pris une fois, à l’ouverture', async () => {
    const opened = Date.parse('2026-10-14T14:05:00Z');
    vi.useFakeTimers({ now: opened + 5, toFake: ['Date'] });
    try {
      const pending = useAgentOrders.getState().propose(PROPOSAL, 'llm');
      const ticket = fake.calls[0]![4] as string;
      fake.step!({ ticket, stage: 'guarded', at: opened, account: 'Sim101', instrument: 'MNQ 12-26', position: 1, resulting: 2 });
      fake.step!({ ticket, stage: 'dialog', at: opened, deadline: opened + ENGINE_TIMEOUT_MS });
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
      const render = () => act(async () => root!.render(createElement(ProposalCard, { p: proposalView(useAgentOrders.getState().proposals[0]!) })));
      const bar = () => host!.querySelector<HTMLElement>('[data-deadline] i')!;
      await render();
      expect([bar().style.animationDuration, bar().style.animationDelay]).toEqual([`${ENGINE_TIMEOUT_MS}ms`, '-5ms']);
      // Vingt secondes plus tard, un nouveau rendu (la minuterie de 30 s d'Agent IA, un événement du desk) : l'animation
      // en cours compte déjà ces vingt secondes ; réécrire son délai les compterait deux fois (Chromium l'applique depuis
      // son départ), et la barre se viderait à 25 s.
      vi.setSystemTime(opened + 20_000);
      await render();
      expect([bar().style.animationDuration, bar().style.animationDelay]).toEqual([`${ENGINE_TIMEOUT_MS}ms`, '-5ms']);
      fake.release!({ status: 'declined', detail: 'refusé par le trader', timeout: false });
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('OROS5.40c sans fenêtre du desk à la proposition : ni étape `dialog` ni dialogue, et la carte dit « Non envoyée »', async () => {
    let present: { isDestroyed: () => boolean } | null = { isDestroyed: () => false };
    const h = harness({ answers: [0], window: () => present });
    // L'activation passe par son dialogue : la fenêtre est là.
    await h.host.enable();
    expect(h.dialogs).toHaveLength(1);
    for (const gone of [null, { isDestroyed: () => true }]) {
      present = gone;
      useAgentOrders.setState({ proposals: [], last: null });
      fake.calls.length = 0;
      const pending = useAgentOrders.getState().propose(PROPOSAL, 'llm');
      const ticket = fake.calls[0]![4] as string;
      const before = h.published.length;
      const outcome = await h.host.propose(PROPOSAL, 'llm', null, null, ticket);
      expect(outcome).toEqual({ status: 'declined', detail: 'refusé par le trader', timeout: false });
      // Gardée seulement : aucune étape `dialog`, aucun dialogue ouvert.
      const steps = h.published.slice(before);
      expect(steps.map((step) => step.stage)).toEqual(['guarded']);
      expect(h.dialogs).toHaveLength(1);
      // Le renderer reçoit ce que le process principal publie, puis l'issue : personne n'a refusé.
      for (const step of steps) fake.step!(step);
      fake.release!(outcome);
      await pending;
      const view = proposalView(useAgentOrders.getState().proposals[0]!);
      expect(view.window).toBeNull();
      expect([outcomeTitle(view), outcomeDetail(view)]).toEqual(['Non envoyée', 'aucun dialogue du desk ne s’est ouvert']);
    }
  });

  it('câblage : une méthode nommée du preload, le canal en lecture seule, le gestionnaire derrière trusted(e)', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const preload = readFileSync('electron/preload.ts', 'utf8');
    expect(preload).toContain("onStep: (cb: (step: unknown) => void) => subscribe('agent-orders:step', cb),");
    expect(main).toContain("win.webContents.send('agent-orders:step', step);");
    // rien ne remonte au process principal sur ce canal
    expect(main).not.toMatch(/ipcMain\.(on|handle)\('agent-orders:step'/);
    expect(preload).not.toMatch(/ipcRenderer\.(send|invoke)\('agent-orders:step'/);
    // chaque gestionnaire des ordres de l'agent passe d'abord par trusted(e)
    const rows = main.split('\n');
    rows.forEach((row, index) => {
      if (!row.includes("ipcMain.handle('agent-orders:")) return;
      if (row.trimEnd().endsWith('=> {')) expect(rows[index + 1], row).toMatch(/^\s+if \(!trusted\(e\)/);
      else expect(row, row).toMatch(/\(trusted\(e\) && agentOrders/);
    });
  });
});
