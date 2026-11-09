import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AccountView, ExecutionEvent, ExecutionPort, LinkState, OrderRequest } from '@/engine/execution/port';
import { ARM_STATE_MAX_AGE_MS, CopierHost, copierArmDialog, copierArmRefusalDialog, requestCopierArm, type CopierArmRefusal } from '../electron/nt-bridge/copier-host';

/**
 * SEC2.1 — la réplication ne s'arme pas sans un état frais des comptes. Le livre du copieur suit le maître par ses
 * fills et ne se recale sur sa position réelle qu'à l'armement. Armé avant le premier `bridge.accounts`, alors que le
 * maître était déjà long 2, il partait de zéro : la sortie du maître devenait une vente de 2 chez un suiveur à plat,
 * que le routeur traitait comme une ouverture (un short que personne n'a voulu). L'armement est maintenant refusé tant
 * que le pont, en ligne, n'a pas rendu depuis moins de dix secondes l'état du maître et de chaque suiveur ; le dialogue
 * du process principal dit ce qui manque.
 */

const T0 = Date.UTC(2026, 10, 9, 15, 0, 0);

function harness(followers = ['Sim102']) {
  const listeners = new Set<(event: ExecutionEvent) => void>();
  const submitted: OrderRequest[] = [];
  const logs: string[] = [];
  const clock = { now: T0 };
  const link: { state: LinkState } = { state: 'live' };
  const port: ExecutionPort = {
    sourceId: 'memory',
    capabilities: { submit: true, cancel: true, flatten: true, accounts: 'sim' },
    status: () => ({ state: link.state }),
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async submit(order) {
      submitted.push(order);
      return { ok: true, orderId: `o${submitted.length}` };
    },
    async cancel() {
      return { ok: true };
    },
    async flatten() {
      return { ok: true, closed: 0 };
    },
    dispose() {},
  };
  const host = new CopierHost(port, mkdtempSync(path.join(tmpdir(), 'canto-arm-')), (line) => logs.push(line), () => {}, () => clock.now);
  host.open();
  const configure = (masterAccount = 'Sim101') =>
    host.configure({
      masterAccount,
      latencyBudgetMs: 60_000,
      newsBlackout: false,
      windowStart: '00:00',
      windowEnd: '23:59',
      followerBufferFloor: 0.3,
      flattenOnCut: false,
      maxContractsPerOrder: 20,
      catalysts: [],
      followers: followers.map((account) => ({ account, sizing: { mode: 'ratio', value: 1, maxContracts: 20 }, symbolMap: { mode: 'identique' } })),
    });
  let seq = 0;
  const emit = (event: ExecutionEvent) => listeners.forEach((cb) => cb(event));
  return {
    host,
    submitted,
    logs,
    clock,
    link,
    configure,
    accounts: (accounts: AccountView[]) => emit({ kind: 'accounts', accounts }),
    fill: (side: 'buy' | 'sell', qty: number) =>
      emit({ kind: 'fill', fill: { account: 'Sim101', instrument: 'NQ 12-26', side, qty, price: 25_000, time: clock.now, executionId: `e${++seq}` } }),
  };
}

const flat = (...names: string[]): AccountView[] => names.map((name) => ({ name, positions: [], unrealizedPnl: 0 }));
const brief = (orders: OrderRequest[]) => orders.map((order) => `${order.account} ${order.side} ${order.qty} ${order.instrument}`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('SEC2.1 pas d’armement du copieur sans état frais des comptes', () => {
  it('avant le premier état des comptes, maître déjà long 2 : l’armement est refusé, et sa sortie ne vend rien chez le suiveur', async () => {
    const h = harness();
    h.configure();
    expect(h.host.arm()).toEqual({ reason: 'stale', missing: [] });
    expect(h.host.status().armed).toBe(false);
    // La sortie du maître, long 2 depuis avant l'ouverture du desk : sans le correctif, deux ventes partaient chez Sim102.
    h.fill('sell', 2);
    await settle();
    expect(h.submitted).toEqual([]);
    expect(h.logs.some((line) => line === 'copieur armement refusé motif=stale')).toBe(true);
    h.host.dispose();
  });

  it('avec un état frais du maître et de chaque suiveur, l’armement est accepté et une ouverture se copie', async () => {
    const h = harness();
    h.configure();
    h.accounts(flat('Sim101', 'Sim102'));
    expect(h.host.armRefusal()).toBeNull();
    expect(h.host.arm()).toBeNull();
    expect(h.host.status().armed).toBe(true);
    h.fill('buy', 1);
    await settle();
    expect(brief(h.submitted)).toEqual(['Sim102 buy 1 NQ 12-26']);
    h.host.dispose();
  });

  it('la position du maître à l’armement vient de cet état : déjà long 2, sa sortie ne touche pas le suiveur', async () => {
    const h = harness();
    h.configure();
    h.accounts([{ name: 'Sim101', positions: [{ instrument: 'NQ 12-26', qty: 2, avgPrice: 25_000 }] }, ...flat('Sim102')]);
    expect(h.host.arm()).toBeNull();
    h.fill('sell', 2);
    await settle();
    expect(h.submitted).toEqual([]);
    h.host.dispose();
  });

  it('un état de dix secondes ou plus ne vaut plus : l’AddOn le renvoie toutes les cinq secondes', () => {
    expect(ARM_STATE_MAX_AGE_MS).toBe(10_000);
    const h = harness();
    h.configure();
    h.accounts(flat('Sim101', 'Sim102'));
    h.clock.now = T0 + ARM_STATE_MAX_AGE_MS - 1;
    expect(h.host.armRefusal()).toBeNull();
    h.clock.now = T0 + ARM_STATE_MAX_AGE_MS;
    expect(h.host.arm()).toEqual({ reason: 'stale', missing: [] });
    // Une horloge reculée ne rajeunit pas un état.
    h.clock.now = T0 - 1;
    expect(h.host.arm()).toEqual({ reason: 'stale', missing: [] });
    expect(h.host.status().armed).toBe(false);
    // Un nouvel état rouvre l'armement.
    h.clock.now = T0 + 60_000;
    h.accounts(flat('Sim101', 'Sim102'));
    expect(h.host.arm()).toBeNull();
    h.host.dispose();
  });

  it('l’état doit couvrir le maître et chaque suiveur : le plancher du suiveur lit son latent, sa réduction sa position', () => {
    const h = harness(['Sim102', 'Sim103']);
    h.configure();
    h.accounts(flat('Sim101', 'Sim102'));
    expect(h.host.arm()).toEqual({ reason: 'accounts', missing: ['Sim103'] });
    h.accounts(flat('Sim102', 'Sim103'));
    expect(h.host.arm()).toEqual({ reason: 'accounts', missing: ['Sim101'] });
    h.accounts(flat('Sim999'));
    expect(h.host.arm()).toEqual({ reason: 'accounts', missing: ['Sim101', 'Sim102', 'Sim103'] });
    expect(h.host.status().armed).toBe(false);
    h.accounts(flat('Sim101', 'Sim102', 'Sim103', 'Sim104'));
    expect(h.host.arm()).toBeNull();
    h.host.dispose();
  });

  it('pont hors ligne, ou aucun maître : refusé, quel que soit l’état gardé', () => {
    const h = harness();
    h.accounts(flat('Sim101', 'Sim102'));
    // Rien de configuré, puis un maître vide.
    expect(h.host.arm()).toEqual({ reason: 'master', missing: [] });
    h.configure('');
    expect(h.host.arm()).toEqual({ reason: 'master', missing: [] });
    h.configure();
    for (const state of ['absent', 'connecting', 'stale', 'lost'] as const) {
      h.link.state = state;
      expect(h.host.arm(), state).toEqual({ reason: 'link', missing: [] });
    }
    expect(h.host.status().armed).toBe(false);
    h.link.state = 'live';
    expect(h.host.arm()).toBeNull();
    h.host.dispose();
  });

  it('le dialogue dit ce qui manque, dans les trois langues, avec un seul bouton', () => {
    const cases: [CopierArmRefusal, string, string, string][] = [
      [{ reason: 'master', missing: [] }, 'Aucun compte maître actif', 'No active master account', 'Ninguna cuenta maestra activa'],
      [{ reason: 'link', missing: [] }, 'Le pont NinjaTrader n’est pas en ligne', 'The NinjaTrader bridge is not live', 'El puente NinjaTrader no está en línea'],
      [{ reason: 'stale', missing: [] }, 'depuis dix secondes', 'for ten seconds', 'desde hace diez segundos'],
      [{ reason: 'accounts', missing: ['Sim101', 'Sim103'] }, 'Sim101, Sim103', 'Sim101, Sim103', 'Sim101, Sim103'],
    ];
    for (const [refusal, fr, en, es] of cases) {
      const dialog = copierArmRefusalDialog('fr', refusal);
      expect(dialog).toMatchObject({ type: 'warning', buttons: ['Fermer'], defaultId: 0, cancelId: 0, noLink: true, title: 'CΛNTO', message: 'Réplication non armée' });
      expect(dialog.detail, refusal.reason).toContain(fr);
      expect(copierArmRefusalDialog('en', refusal)).toMatchObject({ buttons: ['Close'], message: 'Replication not armed' });
      expect(copierArmRefusalDialog('en', refusal).detail, refusal.reason).toContain(en);
      expect(copierArmRefusalDialog('es', refusal)).toMatchObject({ buttons: ['Cerrar'], message: 'Réplica no armada' });
      expect(copierArmRefusalDialog('es', refusal).detail, refusal.reason).toContain(es);
    }
    // Un nom de compte trop long ou porteur de caractères de contrôle ne déforme pas le dialogue.
    const odd = copierArmRefusalDialog('fr', { reason: 'accounts', missing: [`Sim‮\n${'x'.repeat(200)}`] });
    expect(odd.detail).not.toMatch(/[\u0000-\u001f‪-‮⁦-⁩]/);
    expect(odd.detail.length).toBeLessThan(260);
  });

  it('Armer : sans état, un dialogue le dit et rien ne s’arme ; avec, le dialogue d’armement décide', async () => {
    const win = { isDestroyed: () => false };
    const run = async (refusals: (CopierArmRefusal | null)[], responses: number[]) => {
      const shown: { message: string; buttons: string[] }[] = [];
      const logs: string[] = [];
      let armed = 0;
      const next = () => refusals.shift() ?? null;
      const ok = await requestCopierArm({
        win,
        locale: 'fr',
        showMessageBox: async (_win, options) => {
          shown.push({ message: options.message, buttons: [...options.buttons] });
          return { response: responses.shift() ?? 0 };
        },
        log: (line) => logs.push(line),
        refusal: next,
        arm: () => {
          const refusal = next();
          if (!refusal) armed += 1;
          return refusal;
        },
      });
      return { ok, shown, logs, armed };
    };
    const confirm = copierArmDialog('fr');
    // Sans état : un seul dialogue, celui du refus ; l'armement n'est même pas proposé.
    const refused = await run([{ reason: 'stale', missing: [] }], [0]);
    expect(refused).toMatchObject({ ok: false, armed: 0, logs: [] });
    expect(refused.shown).toEqual([{ message: 'Réplication non armée', buttons: ['Fermer'] }]);
    // Avec un état frais : le dialogue d'armement, Annuler par défaut.
    const cancelled = await run([null], [1]);
    expect(cancelled).toMatchObject({ ok: false, armed: 0, logs: [] });
    expect(cancelled.shown).toEqual([{ message: confirm.message, buttons: confirm.buttons }]);
    const accepted = await run([null, null], [0]);
    expect(accepted).toMatchObject({ ok: true, armed: 1, logs: ['copieur armé'] });
    expect(accepted.shown).toEqual([{ message: confirm.message, buttons: confirm.buttons }]);
    // L'état s'est perdu pendant le dialogue : l'armement relit, refuse et le dit.
    const lost = await run([null, { reason: 'link', missing: [] }], [0, 0]);
    expect(lost).toMatchObject({ ok: false, armed: 0, logs: [] });
    expect(lost.shown.map((dialog) => dialog.message)).toEqual([confirm.message, 'Réplication non armée']);
    // Sans fenêtre, rien.
    expect(await requestCopierArm({ win: null, locale: 'fr', showMessageBox: async () => ({ response: 0 }), log: () => {}, refusal: () => null, arm: () => null })).toBe(false);
  });

  it('le canal `copier:arm` passe par ce chemin, et par lui seul', () => {
    const main = readFileSync('electron/main.ts', 'utf8').replace(/\r\n/g, '\n');
    const handler = main.slice(main.indexOf("ipcMain.handle('copier:arm'"), main.indexOf('/* ─── Calendrier macro'));
    expect(handler).toMatch(/await requestCopierArm\(\{/);
    expect(handler).toMatch(/refusal: \(\) => host\.copierArmRefusal\(\),/);
    expect(handler).toMatch(/arm: \(\) => host\.armCopier\(\),/);
    expect([...main.matchAll(/armCopier\(/g)]).toHaveLength(1);
  });
});
