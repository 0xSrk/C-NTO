import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentOrderHost, type AgentDialogOptions, type BridgeView } from '../electron/agent-orders';
import { AGENT_DAY_CLOSE_MAX, coerceDayCloses, dayCloseFor, mergeDayCloses, parseDayClose, withDayClose } from '@/engine/agent/dayClose';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

/**
 * OROS5.48a — décision 15 de l'ADMIN (2026-11-03) : « On ferme la journée une fois la limite touchée. » Le process
 * principal garde son propre verrou par journée CME dès qu'il a vu la perte du jour atteinte ; le renderer ne peut pas le
 * lever, et une réduction de risque passe toujours.
 */

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const et = (day: string, hhmm: string) => zonedToUtc(day, hhmm, ET_ZONE);
const DAY = '2026-11-04';
const OPEN = { account: 'Sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 1, type: 'market', reason: 'cassure de l’Opening Range' };
const LOSS_RULE = { rule: 'after_daily_limit', detail: 'perte du jour 620 $ ≥ limite 600 $ (règle du trader)' };

function harness(opts: { dir?: string; position?: number; at: number }) {
  const dir = opts.dir ?? mkdtempSync(path.join(tmpdir(), 'canto-day-close-'));
  const dialogs: AgentDialogOptions[] = [];
  const submitted: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const clock = { now: opts.at };
  const view: BridgeView = { link: 'live', ordersOpen: true, accounts: [{ name: 'Sim101', positions: opts.position ? [{ instrument: 'MNQ 12-26', quantity: opts.position }] : [] }] };
  const host = new AgentOrderHost({
    userDataDir: dir,
    locale: () => 'fr',
    window: () => ({ isDestroyed: () => false }),
    // Le trader accepte tout ce qu'on lui montre : seul un dialogue ouvert laisse passer l'ordre.
    showMessageBox: (_w, options) => {
      dialogs.push(options);
      return Promise.resolve({ response: 0 });
    },
    bridge: () => view,
    submit: async (order) => {
      submitted.push(order);
      return { ok: true, orderId: `nt-${submitted.length}`, latencyMs: 2 };
    },
    log: (line) => logs.push(line),
    now: () => clock.now,
  });
  return { host, dir, dialogs, submitted, logs, clock, view };
}

describe('OROS5.48a · le process principal ferme la journée CME à la perte du jour atteinte', () => {
  it('vue une fois dans la règle du renderer, la journée reste fermée même quand le renderer cesse d’envoyer la règle', async () => {
    const h = harness({ at: et(DAY, '10:56') });
    await h.host.enable();
    const first = await h.host.propose(OPEN, 'llm', null, LOSS_RULE);
    expect(first).toMatchObject({ status: 'refused', reason: 'trader_rule', detail: LOSS_RULE.detail });
    // 11:45 : un gain a ramené la perte sous la limite, le renderer ne transmet plus rien ; la journée reste fermée
    h.clock.now = et(DAY, '11:45');
    const dialogsBefore = h.dialogs.length;
    const later = await h.host.propose(OPEN, 'llm', null, null);
    expect(later).toEqual({ status: 'refused', reason: 'trader_rule', detail: 'journée fermée depuis 10:56 ET : perte du jour atteinte' });
    // une autre règle transmise ne remplace pas la journée fermée, qui se lit d'abord (la cadence compte : une minute après)
    h.clock.now = et(DAY, '11:47');
    const window = await h.host.propose(OPEN, 'llm', null, { rule: 'catalyst_window', detail: 'CPI 08:30 ET' });
    expect(window).toMatchObject({ status: 'refused', reason: 'trader_rule', detail: 'journée fermée depuis 10:56 ET : perte du jour atteinte' });
    // un nom du pont replié (casse, espaces) désigne le même compte
    h.clock.now = et(DAY, '11:49');
    expect(await h.host.propose({ ...OPEN, account: '  sim101 ' }, 'llm', null, null)).toMatchObject({ status: 'refused', reason: 'trader_rule' });
    expect(h.dialogs.length).toBe(dialogsBefore);
    expect(h.submitted).toEqual([]);
    expect(h.logs).toContain('agent journée fermée 2026-11-04 compte=Sim101 depuis 10:56 ET');
  });

  it('une réduction de risque passe pendant la journée fermée : dialogue, puis envoi', async () => {
    const h = harness({ at: et(DAY, '10:56'), position: 1 });
    await h.host.enable();
    await h.host.propose(OPEN, 'llm', null, LOSS_RULE);
    h.clock.now = et(DAY, '11:45');
    // ajouter au long : refusé ; le réduire : passe
    expect(await h.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'refused', reason: 'trader_rule' });
    h.clock.now = et(DAY, '11:47');
    const reduce = await h.host.propose({ ...OPEN, side: 'sell' }, 'llm', null, null);
    expect(reduce).toMatchObject({ status: 'sent', resulting: 0 });
    expect(h.submitted).toEqual([expect.objectContaining({ action: 'Sell', quantity: 1, tag: 'canto-agent' })]);
  });

  it('la journée CME suivante lève la fermeture : 18:00 ET, et non minuit', async () => {
    const h = harness({ at: et(DAY, '10:56') });
    await h.host.enable();
    await h.host.propose(OPEN, 'llm', null, LOSS_RULE);
    h.clock.now = et(DAY, '17:59');
    expect(await h.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'refused', reason: 'trader_rule' });
    h.clock.now = et(DAY, '18:01');
    expect(await h.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'sent' });
  });

  it('elle survit au redémarrage du desk le même jour ; un fichier illisible n’ouvre ni ne ferme rien', async () => {
    const first = harness({ at: et(DAY, '10:56') });
    await first.host.enable();
    await first.host.propose(OPEN, 'llm', null, LOSS_RULE);
    const stored = JSON.parse(read(path.join(first.dir, 'agent-day-close.json'))) as unknown;
    expect(stored).toEqual([{ day: DAY, account: 'Sim101', at: et(DAY, '10:56') }]);
    const again = harness({ dir: first.dir, at: et(DAY, '14:00') });
    await again.host.enable();
    expect(await again.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'refused', reason: 'trader_rule', detail: 'journée fermée depuis 10:56 ET : perte du jour atteinte' });
    // le lendemain, le même fichier ne ferme plus rien
    const tomorrow = harness({ dir: first.dir, at: et('2026-11-05', '09:40') });
    await tomorrow.host.enable();
    expect(await tomorrow.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'sent' });
    writeFileSync(path.join(first.dir, 'agent-day-close.json'), '{pas du json');
    const broken = harness({ dir: first.dir, at: et(DAY, '14:00') });
    await broken.host.enable();
    expect(await broken.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'sent' });
  });

  it('closeDay : le renderer ne peut que fermer ; la journée est celle de l’horloge du process principal', async () => {
    const h = harness({ at: et(DAY, '11:02') });
    await h.host.enable();
    // tous les comptes : la limite les suit tous ; l'instant dit d'où part la fermeture
    expect(h.host.closeDay({ account: '', at: et(DAY, '10:56') })).toBe(true);
    expect(await h.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'refused', detail: 'journée fermée depuis 10:56 ET : perte du jour atteinte' });
    // un instant d'une autre journée, ou à venir, cède la place à maintenant ; une forme illisible ne fait rien
    const other = harness({ at: et(DAY, '11:02') });
    await other.host.enable();
    expect(other.host.closeDay({ account: 'Sim101', at: et('2026-11-03', '10:00') })).toBe(true);
    expect(await other.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'refused', detail: 'journée fermée depuis 11:02 ET : perte du jour atteinte' });
    for (const bad of [null, 'Sim101', [], { account: 42 }, { account: 'Sim‮101' }, { account: 'x'.repeat(129) }]) expect(other.host.closeDay(bad)).toBe(false);
    // une fermeture ne rouvre jamais : un autre compte, une heure plus tardive n'y changent rien
    expect(other.host.closeDay({ account: 'Sim202', at: et(DAY, '11:00') })).toBe(true);
    expect(other.host.closeDay({ account: 'Sim101', at: et(DAY, '11:01') })).toBe(true);
    expect(await other.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'refused', detail: 'journée fermée depuis 11:01 ET : perte du jour atteinte' });
    // un compte que la fermeture ne vise pas reste ouvert
    const third = harness({ at: et(DAY, '11:02') });
    await third.host.enable();
    third.host.closeDay({ account: 'Sim202', at: et(DAY, '10:00') });
    expect(await third.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'sent' });
  });

  it('OROS5.48e au-delà du plafond, rien ne sort : les fermetures se replient en une fermeture de tous les comptes', async () => {
    const junk = (n: number, at: number) => Array.from({ length: n }, (_, i) => ({ account: `Junk${String(i).padStart(2, '0')}`, at }));
    // Sim101 fermé à 10:56 ; puis le renderer envoie trente-deux fermetures plus anciennes : Sim101 reste fermé
    const h = harness({ at: et(DAY, '10:56') });
    await h.host.enable();
    await h.host.propose(OPEN, 'llm', null, LOSS_RULE);
    h.clock.now = et(DAY, '11:45');
    for (const close of junk(AGENT_DAY_CLOSE_MAX, et(DAY, '09:00'))) expect(h.host.closeDay(close)).toBe(true);
    h.clock.now = et(DAY, '11:50');
    expect(await h.host.propose(OPEN, 'llm', null, null)).toEqual({ status: 'refused', reason: 'trader_rule', detail: 'journée fermée depuis 09:00 ET : perte du jour atteinte' });
    const stored = JSON.parse(read(path.join(h.dir, 'agent-day-close.json'))) as unknown[];
    expect(stored.length).toBeLessThanOrEqual(AGENT_DAY_CLOSE_MAX);
    // après un redémarrage du desk, la journée reste fermée
    const again = harness({ dir: h.dir, at: et(DAY, '12:30') });
    await again.host.enable();
    expect(await again.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'refused', reason: 'trader_rule' });
    expect(h.submitted).toEqual([]);
    expect(again.submitted).toEqual([]);
    // une fermeture de tous les comptes ne sort pas davantage
    const all = harness({ at: et(DAY, '11:00') });
    await all.host.enable();
    all.host.closeDay({ account: '', at: et(DAY, '10:56') });
    for (const close of junk(AGENT_DAY_CLOSE_MAX, et(DAY, '09:00'))) all.host.closeDay(close);
    all.clock.now = et(DAY, '11:10');
    expect(await all.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'refused', reason: 'trader_rule' });
    // le module partagé : aucune fermeture de la journée la plus récente ne sort, la liste reste bornée
    let list = withDayClose([], { day: DAY, account: 'Sim101', at: et(DAY, '10:56') });
    for (let i = 0; i < 3 * AGENT_DAY_CLOSE_MAX; i++) list = withDayClose(list, { day: DAY, account: `Junk${i}`, at: et(DAY, '09:00') + i });
    expect(list.length).toBeLessThanOrEqual(AGENT_DAY_CLOSE_MAX);
    for (const account of ['Sim101', 'Junk0', `Junk${3 * AGENT_DAY_CLOSE_MAX - 1}`]) expect(dayCloseFor(list, account, et(DAY, '11:00')), account).not.toBeNull();
    expect(dayCloseFor(list, 'Sim101', et(DAY, '11:00'))!.at).toBe(et(DAY, '09:00'));
    expect(dayCloseFor(coerceDayCloses(list), 'Sim101', et(DAY, '11:00'))).not.toBeNull();
  });

  it('OROS5.48f une horloge qui avançait, puis corrigée : la fermeture de la vraie journée est retenue, et survit au redémarrage', async () => {
    // 2026-11-05 10:00 à l'horloge du poste, un jour d'avance : la perte du jour vue ferme cette journée-là
    const h = harness({ at: et('2026-11-05', '10:00') });
    await h.host.enable();
    expect(await h.host.propose(OPEN, 'llm', null, LOSS_RULE)).toMatchObject({ status: 'refused', reason: 'trader_rule' });
    // l'horloge corrigée : la perte du jour vue à 10:56 ferme la vraie journée, et la retient
    h.clock.now = et(DAY, '10:56');
    expect(await h.host.propose(OPEN, 'llm', null, LOSS_RULE)).toMatchObject({ status: 'refused', reason: 'trader_rule' });
    expect(h.logs).toContain('agent journée fermée 2026-11-04 compte=Sim101 depuis 10:56 ET');
    // 11:45 : un gain a ramené la perte sous la limite, le renderer ne transmet plus rien ; la journée reste fermée
    h.clock.now = et(DAY, '11:45');
    expect(await h.host.propose(OPEN, 'llm', null, null)).toEqual({ status: 'refused', reason: 'trader_rule', detail: 'journée fermée depuis 10:56 ET : perte du jour atteinte' });
    // après un redémarrage du desk, de même
    const again = harness({ dir: h.dir, at: et(DAY, '12:30') });
    await again.host.enable();
    expect(await again.host.propose(OPEN, 'llm', null, null)).toEqual({ status: 'refused', reason: 'trader_rule', detail: 'journée fermée depuis 10:56 ET : perte du jour atteinte' });
    // par closeDay, de même
    const ipc = harness({ at: et('2026-11-05', '10:00') });
    await ipc.host.enable();
    ipc.host.closeDay({ account: 'Sim101', at: et('2026-11-05', '10:00') });
    ipc.clock.now = et(DAY, '11:02');
    ipc.host.closeDay({ account: 'Sim101', at: et(DAY, '10:56') });
    expect(await ipc.host.propose(OPEN, 'llm', null, null)).toMatchObject({ status: 'refused', detail: 'journée fermée depuis 10:56 ET : perte du jour atteinte' });
    expect([...h.submitted, ...again.submitted, ...ipc.submitted]).toEqual([]);
    // le module partagé : la journée de la fermeture et la plus récente restent, dans un sens comme dans l'autre ; une
    // liste relue garde la journée en cours de l'horloge qui la relit
    const real = { day: DAY, account: 'Sim101', at: et(DAY, '10:56') };
    const ahead = { day: '2026-11-06', account: 'z', at: et('2026-11-06', '09:00') };
    const now = et(DAY, '11:45');
    expect(withDayClose([ahead], real)).toEqual([real, ahead]);
    for (const list of [mergeDayCloses([real], [ahead], now), mergeDayCloses([ahead], [real], now), coerceDayCloses([real, ahead], now), coerceDayCloses([ahead, real], now)]) expect(dayCloseFor(list, 'Sim101', now)).toEqual(real);
    // une journée passée sort toujours
    expect(withDayClose([{ day: '2026-11-03', account: 'Sim101', at: et('2026-11-03', '10:00') }], real)).toEqual([real]);
    expect(coerceDayCloses([{ day: '2026-11-03', account: 'Sim101', at: et('2026-11-03', '10:00') }, real], now)).toEqual([real]);
  });

  it('la fermeture relue : bornée, sans caractère de contrôle, d’une seule journée, la plus ancienne heure', () => {
    const at = et(DAY, '10:56');
    expect(parseDayClose({ day: DAY, account: ' Sim101 ', at })).toEqual({ day: DAY, account: 'Sim101', at });
    expect(parseDayClose({ day: '2026-11-03', account: 'Sim101', at })).toBeNull();
    expect(parseDayClose({ day: DAY, account: 'Sim\n101', at })).toBeNull();
    expect(parseDayClose({ day: DAY, account: 'Sim101', at: Number.NaN })).toBeNull();
    const list = withDayClose(withDayClose([], { day: DAY, account: 'Sim101', at: at + 60_000 }), { day: DAY, account: 'SIM101', at });
    expect(list).toEqual([{ day: DAY, account: 'Sim101', at }]);
    // une nouvelle journée remplace l'ancienne
    const next = withDayClose(list, { day: '2026-11-05', account: '', at: et('2026-11-05', '09:00') });
    expect(next).toEqual([{ day: '2026-11-05', account: '', at: et('2026-11-05', '09:00') }]);
    // une ancienne n'efface pas la nouvelle, et, la journée de l'horloge qui l'envoie, elle reste à côté (OROS5.48f)
    expect(withDayClose(next, { day: DAY, account: 'Sim101', at })).toEqual([{ day: DAY, account: 'Sim101', at }, ...next]);
    expect(coerceDayCloses('x')).toEqual([]);
    expect(coerceDayCloses([{ day: DAY, account: 'Sim101', at }, 'x', { day: DAY }])).toEqual([{ day: DAY, account: 'Sim101', at }]);
    expect(mergeDayCloses([{ day: DAY, account: 'Sim101', at }], [{ day: '2026-11-03', account: 'Sim101', at: et('2026-11-03', '09:00') }])).toEqual([{ day: DAY, account: 'Sim101', at }]);
    expect(dayCloseFor(list, 'sim101', et(DAY, '16:59'))).toEqual({ day: DAY, account: 'Sim101', at });
    expect(dayCloseFor(list, '', et(DAY, '16:59'))).toBeNull();
    expect(dayCloseFor(list, 'Sim101', et(DAY, '18:00'))).toBeNull();
  });

  it('câblage : un canal nommé du preload, derrière trusted(e) ; aucun canal ne rouvre ; module partagé aux trois endroits', () => {
    const main = read('electron/main.ts');
    const preload = read('electron/preload.ts');
    expect(main).toContain("ipcMain.handle('agent-orders:close-day', (e, raw: unknown) => (trusted(e) && agentOrders ? agentOrders.closeDay(raw) : false));");
    expect(preload).toContain("closeDay: (close: { account: string; at: number }) => ipcRenderer.invoke('agent-orders:close-day', close),");
    expect(main).not.toMatch(/ipcMain\.(on|handle)\('agent-orders:(open|reopen|clear)/);
    expect(read('electron/agent-orders.ts')).not.toMatch(/(open|reopen|clear|lift)Day\(/);
    const config = JSON.parse(read('electron/tsconfig.sources.json')) as { files: string[] };
    expect(config.files).toContain('../src/engine/agent/dayClose.ts');
    expect(read('vitest.config.mts')).toContain("'agent/dayClose': 'src/engine/agent/dayClose.ts'");
    expect(read('electron/agent/dayClose.d.ts')).toContain('export function dayCloseFor(list: readonly AgentDayClose[], account: string, now: number): AgentDayClose | null;');
    const source = read('src/engine/agent/dayClose.ts');
    expect([...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['../tradingDay']);
  });
});
