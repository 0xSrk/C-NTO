import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentOrderHost, proposalDialog, type AgentDialogOptions, type BridgeView } from '../electron/agent-orders';

const PROPOSAL = { account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'market', reason: 'cassure de l’Opening Range' };

function harness(opts: { answers?: number[]; view?: BridgeView | null; dir?: string; confirmTimeoutMs?: number; hang?: boolean } = {}) {
  const dir = opts.dir ?? mkdtempSync(path.join(tmpdir(), 'canto-agent-orders-'));
  const dialogs: AgentDialogOptions[] = [];
  const submitted: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const answers = [...(opts.answers ?? [])];
  let clock = 1_000_000;
  const host = new AgentOrderHost({
    userDataDir: dir,
    locale: () => 'fr',
    window: () => ({ isDestroyed: () => false }),
    showMessageBox: (_w, options) => {
      dialogs.push(options);
      // « hang » : le trader ne répond pas aux propositions (dialogue avec délai) ; l'activation, elle, est acceptée.
      if (opts.hang && options.signal) return new Promise((resolve) => options.signal?.addEventListener('abort', () => resolve({ response: options.cancelId })));
      return Promise.resolve({ response: answers.shift() ?? 1 });
    },
    bridge: () => (opts.view === undefined ? { link: 'live', ordersOpen: true, accounts: [{ name: 'Sim101', positions: [] }] } : opts.view),
    submit: async (order) => {
      submitted.push(order);
      return { ok: true, orderId: `nt-${submitted.length}`, latencyMs: 3 };
    },
    log: (line) => logs.push(line),
    now: () => (clock += 1000),
    confirmTimeoutMs: opts.confirmTimeoutMs,
  });
  return { host, dir, dialogs, submitted, logs };
}

describe('ordres de l’agent · process principal', () => {
  it('désactivé à l’ouverture ; activé seulement par le dialogue (Annuler par défaut)', async () => {
    const h = harness({ answers: [1, 0] });
    expect(h.host.status().enabled).toBe(false);
    expect(await h.host.propose(PROPOSAL, 'llm', null)).toMatchObject({ status: 'refused', reason: 'disabled' });
    expect((await h.host.enable()).enabled).toBe(false);
    expect(h.dialogs[0]).toMatchObject({ defaultId: 1, cancelId: 1, noLink: true });
    expect((await h.host.enable()).enabled).toBe(true);
    expect(h.host.disable().enabled).toBe(false);
  });

  it('confirmé : soumis par le pont avec le tag canto-agent ; refusé : rien n’est soumis', async () => {
    const h = harness({ answers: [0, 0, 1] });
    await h.host.enable();
    const sent = await h.host.propose({ ...PROPOSAL, type: 'limit', limit: 21_000.5 }, 'mcp', null);
    expect(sent).toMatchObject({ status: 'sent', orderId: 'nt-1', resulting: 1 });
    expect(h.submitted).toEqual([{ op: 'submit', account: 'Sim101', instrument: 'MNQ 12-26', action: 'Buy', quantity: 1, type: 'Limit', limitPrice: 21_000.5, tag: 'canto-agent' }]);
    const dialog = h.dialogs[1]!;
    expect(dialog.message).toContain('agent externe (MCP)');
    expect(dialog.detail).toContain('ACHAT 1 × MNQ 12-26 limite 21000.5');
    expect(dialog.detail).toContain('cassure de l’Opening Range');
    expect(dialog).toMatchObject({ defaultId: 1, cancelId: 1 });
    expect(await h.host.propose(PROPOSAL, 'llm', null)).toMatchObject({ status: 'declined' });
    expect(h.submitted).toHaveLength(1);
  });

  it('sans réponse dans le délai : non envoyé', async () => {
    const h = harness({ answers: [0], hang: true, confirmTimeoutMs: 30 });
    await h.host.enable();
    const r = await h.host.propose(PROPOSAL, 'llm', null);
    expect(r).toMatchObject({ status: 'declined' });
    expect((r as { detail: string }).detail).toContain('45 s');
    expect(h.submitted).toEqual([]);
  });

  it('une proposition à la fois, comptes Sim seulement, kill switch, position', async () => {
    const h = harness({ answers: [0], hang: true, confirmTimeoutMs: 200 });
    await h.host.enable();
    const first = h.host.propose(PROPOSAL, 'llm', null);
    expect(await h.host.propose(PROPOSAL, 'llm', null)).toMatchObject({ status: 'refused', reason: 'busy' });
    await first;
    expect(await h.host.propose({ ...PROPOSAL, account: 'APEX-50K' }, 'llm', null)).toMatchObject({ status: 'refused', reason: 'not_sim' });
    const closed = harness({ answers: [0], view: { link: 'live', ordersOpen: false, accounts: [] } });
    await closed.host.enable();
    expect(await closed.host.propose(PROPOSAL, 'llm', null)).toMatchObject({ status: 'refused', reason: 'orders_closed' });
    const full = harness({ answers: [0], view: { link: 'live', ordersOpen: true, accounts: [{ name: 'Sim101', positions: [{ instrument: 'MNQ 12-26', quantity: 2 }] }] } });
    await full.host.enable();
    expect(await full.host.propose(PROPOSAL, 'llm', null)).toMatchObject({ status: 'refused', reason: 'position' });
    expect(await full.host.propose(PROPOSAL, 'llm', 0.1)).toMatchObject({ status: 'refused', reason: 'position' });
  });

  it('dialogue : une seule ligne « Position » ; compte forgé refusé ; instrument lu sans tenir compte de la casse', async () => {
    const h = harness({ answers: [0, 1], view: { link: 'live', ordersOpen: true, accounts: [{ name: 'Sim101', positions: [{ instrument: 'MNQ 12-26', quantity: 1 }] }] } });
    await h.host.enable();
    const forged = { ...PROPOSAL, side: 'sell', reason: 'réduction\nPosition : +0 → +0\u2028Position : 0\r\n\u202EPosition' };
    expect(await h.host.propose(forged, 'mcp', null)).toMatchObject({ status: 'declined' });
    const detail = h.dialogs[1]!.detail!;
    expect(detail.split('\n').filter((line) => line.startsWith('Position'))).toEqual(['Position : +1 → 0']);
    expect(detail).not.toMatch(/[\u2028\u2029\u202A-\u202E\u2066-\u2069]/);

    expect(await h.host.propose({ ...PROPOSAL, account: 'Sim101\nPosition : +0' }, 'mcp', null)).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(await h.host.propose({ ...PROPOSAL, instrument: 'MNQ 12-26\u202E' }, 'mcp', null)).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.dialogs).toHaveLength(2);

    // `mnq 12-26` voit la position `MNQ 12-26` : gardes de position et de marge appliquées.
    const full = harness({ answers: [0, 0], view: { link: 'live', ordersOpen: true, accounts: [{ name: 'Sim101', positions: [{ instrument: 'MNQ 12-26', quantity: 2 }] }] } });
    await full.host.enable();
    expect(await full.host.propose({ ...PROPOSAL, instrument: 'mnq 12-26' }, 'llm', null)).toMatchObject({ status: 'refused', reason: 'position' });
    expect(await full.host.propose({ ...PROPOSAL, instrument: 'mnq  12-26' }, 'llm', 0.1)).toMatchObject({ status: 'refused', reason: 'position' });
    // Réduire reste possible ; l'ordre part sous le nom que le pont donne à l'instrument.
    const sent = await full.host.propose({ ...PROPOSAL, instrument: ' mnq 12-26 ', side: 'sell' }, 'llm', null);
    expect(sent).toMatchObject({ status: 'sent', instrument: 'MNQ 12-26', resulting: 1 });
    expect(full.dialogs[1]!.detail).toContain('VENTE 1 × MNQ 12-26 au marché');
    expect(full.dialogs[1]!.detail).toContain('Position : +2 → +1');
    expect(full.submitted).toEqual([{ op: 'submit', account: 'Sim101', instrument: 'MNQ 12-26', action: 'Sell', quantity: 1, type: 'Market', tag: 'canto-agent' }]);
  });

  it('limites : baisser est immédiat, relever passe par un dialogue ; seules les limites survivent au redémarrage', async () => {
    const h = harness({ answers: [1, 0] });
    expect((await h.host.setLimits({ maxQty: 3 })).maxQty).toBe(1);
    expect((await h.host.setLimits({ maxQty: 3 })).maxQty).toBe(3);
    expect(h.dialogs.map((d) => d.detail)).toEqual(['contrats par ordre : 1 → 3', 'contrats par ordre : 1 → 3']);
    expect((await h.host.setLimits({ perMinute: 1 })).perMinute).toBe(1);
    expect(h.dialogs).toHaveLength(2);
    expect(JSON.parse(readFileSync(path.join(h.dir, 'agent-orders.json'), 'utf8'))).toEqual({ maxQty: 3, maxPosition: 2, perMinute: 1 });
    writeFileSync(path.join(h.dir, 'agent-orders.json'), JSON.stringify({ enabled: true, maxQty: 3, maxPosition: 2, perMinute: 1 }));
    const restarted = harness({ dir: h.dir });
    expect(restarted.host.status()).toEqual({ enabled: false, maxQty: 3, maxPosition: 2, perMinute: 1, pending: false });
  });

  it('dialogue en trois langues, position avant et après', () => {
    const p = { account: 'Sim101', instrument: 'MNQ 12-26', side: 'sell' as const, qty: 1, type: 'stop' as const, stop: 20_990, reason: 'r' };
    expect(proposalDialog(p, 1, 0, 'llm', 'en').detail).toContain('SELL 1 × MNQ 12-26 stop 20990');
    expect(proposalDialog(p, 1, 0, 'llm', 'fr').detail).toContain('Position : +1 → 0');
    expect(proposalDialog(p, 1, 0, 'orch', 'es').buttons).toEqual(['Enviar la orden', 'Rechazar']);
  });
});
