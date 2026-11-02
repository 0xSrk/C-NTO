/**
 * @vitest-environment jsdom
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { NtBridgeHost, type KillCutReport } from '../electron/nt-bridge/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Le preload simulé, posé avant le chargement de `@/lib/desk` : le process principal pousse le rapport de coupure par
 * `onKillReport` et le rend, redemandé, par `lastKill`. Rien d'autre du pont n'est l'objet du test.
 */
const fake = vi.hoisted(() => {
  const state = {
    push: null as ((report: unknown) => void) | null,
    last: null as unknown,
    asked: 0,
    killReturn: null as unknown,
  };
  const quiet = () => () => undefined;
  (window as unknown as { canto: unknown }).canto = {
    isDesk: true,
    bridge: { status: async () => null, onFile: quiet, onStatus: quiet, result: () => undefined },
    ntbridge: {
      status: async () => null,
      onStatus: quiet,
      onExecution: quiet,
      killSwitch: async () => state.killReturn,
      onKillReport: (cb: (report: unknown) => void) => {
        state.push = cb;
        return () => {
          state.push = null;
        };
      },
      lastKill: async () => {
        state.asked += 1;
        return state.last;
      },
    },
    marketdata: { onEvent: quiet },
  };
  return state;
});

// jsdom n'a pas d'IndexedDB : rien ici ne lit le coffre, la doublure le garantit.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { KillBand } from '@/app/KillBand';
import { useI18n } from '@/i18n';
import { parseKillReport, useBridge, type LastKill } from '@/store/bridge';

/** Égalité de types, vérifiée par `npm run typecheck` : ce que pousse le process principal est ce que lit la bande. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const mirrored: Same<KillCutReport, LastKill> = true;

/** 14:32:07 à New York le 2 novembre 2026. */
const AT = Date.UTC(2026, 10, 2, 19, 32, 7);
const report = (patch: Partial<LastKill> = {}): LastKill => ({
  at: AT,
  accounts: ['Sim101', 'SimApex2'],
  sent: true,
  results: [
    { account: 'Sim101', ok: true, closed: 1 },
    { account: 'SimApex2', ok: false, error: 'délai dépassé' },
  ],
  ...patch,
});

let root: Root | null = null;
let host: HTMLElement | null = null;
const hosts: NtBridgeHost[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(hosts.splice(0).map((h) => h.dispose()));
  useBridge.setState({ lastKill: null });
  fake.last = null;
  fake.killReturn = null;
  useI18n.setState({ locale: 'fr' });
});

function mountBand() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(KillBand)));
  return host.querySelector<HTMLElement>('[role="alert"]')!;
}
const lines = (alert: HTMLElement) => [...alert.querySelectorAll<HTMLElement>('[data-kill]')].map((node) => node.textContent ?? '');

describe('OROS5.20 le rapport d’une coupure faite au clavier arrive au renderer, en lecture seule', () => {
  it('un rapport mal formé est ignoré : ni le store ni la bande ne le lisent', async () => {
    await useBridge.getState().load();
    expect(fake.push).not.toBeNull();
    const valid = report();
    const malformed: unknown[] = [
      null,
      undefined,
      'rapport',
      42,
      [valid],
      { ...valid, at: undefined },
      { ...valid, at: -1 },
      { ...valid, at: 0 },
      { ...valid, at: 1.5 },
      { ...valid, at: Number.NaN },
      { ...valid, at: Number.POSITIVE_INFINITY },
      { ...valid, at: String(AT) },
      { ...valid, sent: 'oui' },
      { ...valid, sent: undefined },
      { ...valid, accounts: 'Sim101' },
      { ...valid, accounts: [''] },
      { ...valid, accounts: [42] },
      { ...valid, accounts: ['x'.repeat(129)] },
      { ...valid, accounts: Array.from({ length: 1001 }, (_, i) => `Sim${i}`), results: [] },
      { ...valid, results: null },
      { ...valid, results: [...valid.results, { account: 'Sim101', ok: true }] },
      { ...valid, results: [{ account: 'Inconnu', ok: false }] },
      { ...valid, results: [{ account: 'SimApex2', ok: 'non' }] },
      { ...valid, results: [{ account: 'SimApex2' }] },
      { ...valid, results: ['SimApex2'] },
      { ...valid, results: [{ account: 'SimApex2', ok: false, error: 42 }] },
      { ...valid, results: [{ account: 'SimApex2', ok: false, error: 'x'.repeat(501) }] },
      { ...valid, results: [{ account: 'Sim101', ok: true, closed: '1' }] },
    ];
    malformed.forEach((raw, index) => {
      act(() => fake.push!(raw));
      expect(useBridge.getState().lastKill, `cas ${index}`).toBeNull();
      expect(parseKillReport(raw), `cas ${index}`).toBeNull();
    });
    // la bande dit la coupure, et n'invente aucun compte
    const alert = mountBand();
    expect(alert.textContent).toContain('Kill switch engagé');
    expect(lines(alert)).toEqual([]);
  });

  it('un rapport valide alimente lastKill et la bande, qui dit quel compte reste à aplatir ; rien d’autre n’y passe', async () => {
    await useBridge.getState().load();
    act(() => fake.push!({ ...report(), token: 'jeton-du-pont', policy: { maxContractsPerOrder: 1000 } }));
    const last = useBridge.getState().lastKill;
    expect(last).toEqual(report());
    expect(Object.keys(last!).sort()).toEqual(['accounts', 'at', 'results', 'sent']);
    expect(JSON.stringify(last)).not.toMatch(/jeton|policy|maxContracts/);
    expect(lines(mountBand())).toEqual(['SimApex2 sans réponse · aplatir dans NinjaTrader', 'Ordres d’aplatir partis à 14:32:07 ET · 1 / 2 aplatis']);
    // une valeur hors usage du compte d'aplatissement n'efface pas le rapport : elle n'est pas gardée
    expect(parseKillReport({ ...report(), results: [{ account: 'Sim101', ok: true, closed: -3 }] })?.results).toEqual([{ account: 'Sim101', ok: true }]);
    expect(parseKillReport({ ...report(), results: [{ account: 'Sim101', ok: true, closed: Number.POSITIVE_INFINITY }] })?.results).toEqual([{ account: 'Sim101', ok: true }]);
  });

  it('au chargement, le renderer redemande le dernier rapport ; un rapport plus ancien ne remplace jamais le plus récent', async () => {
    fake.last = report();
    const asked = fake.asked;
    await useBridge.getState().load();
    expect(fake.asked).toBe(asked + 1);
    expect(useBridge.getState().lastKill).toEqual(report());
    // un rapport mal formé redemandé ne pose rien
    useBridge.setState({ lastKill: null });
    fake.last = { ...report(), at: 'hier' };
    await useBridge.getState().load();
    expect(useBridge.getState().lastKill).toBeNull();
    // l'ordre d'arrivée ne compte pas : le départ des ordres d'aplatir date le rapport
    act(() => fake.push!(report({ at: AT + 60_000, results: [{ account: 'Sim101', ok: true, closed: 0 }, { account: 'SimApex2', ok: true, closed: 1 }] })));
    act(() => fake.push!(report({ at: AT })));
    expect(useBridge.getState().lastKill?.at).toBe(AT + 60_000);
    expect(lines(mountBand())).toEqual(['Ordres d’aplatir partis à 14:33:07 ET · 2 / 2 aplatis']);
  });

  it('le kill switch demandé par le renderer lit le rapport daté par le process principal, validé comme le rapport poussé', async () => {
    fake.killReturn = report({ at: AT + 5_000 });
    await useBridge.getState().killSwitch();
    expect(useBridge.getState().lastKill?.at).toBe(AT + 5_000);
    // une date illisible ne pose aucun rapport
    useBridge.setState({ lastKill: null });
    fake.killReturn = { ...report(), at: 'hier' };
    await useBridge.getState().killSwitch();
    expect(useBridge.getState().lastKill).toBeNull();
  });

  it('le process principal garde et pousse le rapport d’une coupure faite au clavier, sans jeton ; la soumission reste fermée', async () => {
    const TOKEN = 'jeton-coupure-oros520';
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-kill-'));
    writeFileSync(path.join(dir, 'nt-bridge.json'), JSON.stringify({ port: await freePort(), token: TOKEN, extraAccounts: [], maxContractsPerOrder: 20 }));
    const bridge = new NtBridgeHost(dir, () => dir);
    hosts.push(bridge);
    await bridge.start();
    const sent: [string, unknown][] = [];
    const win = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push([channel, payload]) } };
    const fileBridge = { setSocketLive: () => undefined, status: () => ({ folder: null }), noteExecution: () => undefined };
    bridge.attach(win as never, fileBridge as never);
    expect(bridge.lastKillReport()).toBeNull();

    // AddOn factice : Sim101 s'aplatit, SimApex2 n'est pas connecté dans NinjaTrader
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.publicStatus()!.port}/?token=${TOKEN}`);
    sockets.push(ws);
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { id?: number; method?: string; params?: { account?: string } };
      if (msg.method !== 'order.flatten' || msg.id === undefined) return;
      if (msg.params?.account === 'Sim101') ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { closed: 1, cancelled: 0 } }));
      else ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'compte non connecté' } }));
    });
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: '8.1.5', addonVersion: 'fake', accounts: ['Sim101', 'SimApex2'], protocol: 1 } }));
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.heartbeat', params: { at: Date.now() } }));
    await waitFor(() => bridge.publicStatus()?.link === 'live');

    // Ctrl+Maj+K : le raccourci global du process principal appelle killSwitchReport et ne garde rien lui-même
    const before = Date.now();
    const cut = await bridge.killSwitchReport();
    expect(cut.at).toBeGreaterThanOrEqual(before);
    expect(cut).toEqual({ at: cut.at, accounts: ['Sim101', 'SimApex2'], sent: true, results: [{ account: 'Sim101', ok: true, closed: 1 }, { account: 'SimApex2', ok: false, error: 'compte non connecté' }] });
    const pushed = sent.filter(([channel]) => channel === 'ntbridge:kill-report');
    expect(pushed).toEqual([['ntbridge:kill-report', cut]]);
    expect(Object.keys(cut).sort()).toEqual(['accounts', 'at', 'results', 'sent']);
    // ni jeton ni secret, dans le rapport comme dans tout ce que le pont a poussé
    expect(JSON.stringify(sent)).not.toContain(TOKEN);
    // la bande se pose d'abord sur le statut au canal fermé, puis le rapport arrive
    const closedAt = sent.findIndex(([channel, payload]) => channel === 'ntbridge:status' && (payload as { ordersClosed?: boolean }).ordersClosed === true);
    expect(closedAt).toBeGreaterThanOrEqual(0);
    expect(closedAt).toBeLessThan(sent.findIndex(([channel]) => channel === 'ntbridge:kill-report'));
    // redemandé, le même rapport ; rien ne s'y écrit
    expect(bridge.lastKillReport()).toEqual(cut);
    // la soumission reste fermée jusqu'au redémarrage du desk
    const order = await bridge.order({ op: 'submit', account: 'Sim101', instrument: 'MNQ 12-26', action: 'Buy', quantity: 1, type: 'Market', tag: 'canto-oros520' });
    expect(order).toMatchObject({ ok: false, message: 'canal d’ordres fermé' });
    expect(bridge.publicStatus()?.ordersClosed).toBe(true);

    // le renderer le reçoit par le preload, le valide, et la bande dit quel compte reste à aplatir
    await useBridge.getState().load();
    act(() => fake.push!(pushed[0]![1]));
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'America/New_York' }).format(cut.at);
    expect(lines(mountBand())).toEqual(['SimApex2 compte non connecté · aplatir dans NinjaTrader', `Ordres d’aplatir partis à ${time} ET · 1 / 2 aplatis`]);
  });

  it('câblage : une méthode nommée du preload par sens, le gestionnaire derrière trusted(e), aucun canal d’écriture', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const preload = readFileSync('electron/preload.ts', 'utf8');
    const bridgeHost = readFileSync('electron/nt-bridge/index.ts', 'utf8');
    // le raccourci global coupe comme avant ; le pont garde et pousse son rapport
    const shortcut = main.slice(main.indexOf('globalShortcut.register(KILL_SWITCH_SHORTCUT'), main.indexOf('if (!shortcut)'));
    expect(shortcut).toContain('void ntBridge?.killSwitchReport();');
    expect([...bridgeHost.matchAll(/this\.send\('ntbridge:kill-report', report\)/g)]).toHaveLength(1);
    // redemander le dernier rapport : derrière trusted(e), sans argument à valider
    expect(main).toContain("ipcMain.handle('ntbridge:last-kill', (e) => (trusted(e) ? ntBridge?.lastKillReport() ?? null : null));");
    // chaque gestionnaire du pont passe d'abord par trusted(e), sur sa ligne ou en tête de son bloc
    const rows = main.split('\n');
    rows.forEach((row, index) => {
      if (!row.includes("ipcMain.handle('ntbridge:")) return;
      if (row.trimEnd().endsWith('=> {')) expect(rows[index + 1], row).toMatch(/^\s+if \(!trusted\(e\)/);
      else expect(row, row).toMatch(/\(e(, [a-z]+: unknown)?\) => \(trusted\(e\)/);
    });
    // le preload : deux méthodes nommées, en lecture seule
    expect(preload).toContain("lastKill: () => ipcRenderer.invoke('ntbridge:last-kill'),");
    expect(preload).toContain("onKillReport: (cb: (report: unknown) => void) => subscribe('ntbridge:kill-report', cb),");
    // rien ne remonte vers le process principal sur ces canaux, et le renderer n'émet rien au pont par send
    expect(main).not.toMatch(/ipcMain\.(on|handle)\('ntbridge:kill-report'/);
    expect(preload).not.toMatch(/ipcRenderer\.send\('ntbridge:/);
    expect(mirrored).toBe(true);
  });
});

/** Un port libre de la boucle locale, pour la politique du pont de test. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
