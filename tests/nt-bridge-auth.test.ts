import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CLOSE, ERR } from '../electron/nt-bridge/protocol';
import { AUTH_TIMEOUT_MS, MAX_PENDING_AUTH, ManualClock, NtBridgeServer, authProof } from '../electron/nt-bridge/server';

const TOKEN = 'jeton-de-test-auth';
const HELLO = { kind: 'ninjatrader', ntVersion: '8', addonVersion: '2.2.0', accounts: ['Sim101'], protocol: 1 };

type Msg = Record<string, any>;

function inbox(ws: WebSocket): (method?: string) => Promise<Msg> {
  const queue: Msg[] = [];
  const waiters: { method?: string; resolve: (m: Msg) => void }[] = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as Msg;
    const i = waiters.findIndex((w) => !w.method || w.method === msg.method);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg);
    else queue.push(msg);
  });
  return (method) =>
    new Promise((resolve) => {
      const i = queue.findIndex((m) => !method || m.method === method);
      if (i >= 0) resolve(queue.splice(i, 1)[0]!);
      else waiters.push({ method, resolve });
    });
}

const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
const send = (ws: WebSocket, msg: Msg) => ws.send(JSON.stringify({ jsonrpc: '2.0', ...msg }));

/** Ce que fait l'AddOn 2.2.0 : pas de jeton dans l'URL, réponse au défi, vérification du desk. */
async function addon(port: number, token = TOKEN): Promise<{ ws: WebSocket; next: ReturnType<typeof inbox>; deskProofOk: boolean; closed: Promise<number> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?v=2`);
  const next = inbox(ws);
  const closed = closeCode(ws);
  const challenge = await next('bridge.challenge');
  const serverNonce = challenge.params.nonce as string;
  expect(serverNonce).toMatch(/^[0-9a-f]{64}$/);
  const clientNonce = randomBytes(32).toString('hex');
  const proof = createHmac('sha256', token).update(`canto-addon|${serverNonce}|${clientNonce}`).digest('hex');
  send(ws, { method: 'bridge.auth', params: { nonce: clientNonce, proof } });
  const outcome = await Promise.race([next('bridge.welcome'), closed.then(() => null)]);
  const expected = createHmac('sha256', token).update(`canto-desk|${clientNonce}|${serverNonce}`).digest('hex');
  return { ws, next, deskProofOk: !!outcome && outcome.params.proof === expected, closed };
}

describe('pont NT8 · authentification mutuelle (protocole 2)', () => {
  const servers: NtBridgeServer[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.stop()));
  });
  async function serve(clock?: ManualClock) {
    const server = new NtBridgeServer({ token: TOKEN, port: 0, ...(clock ? { clock } : {}) });
    servers.push(server);
    return { server, port: await server.start() };
  }

  it('défi-réponse : chacun prouve le jeton sans l’envoyer, puis bridge.hello', async () => {
    const { server, port } = await serve();
    const a = await addon(port);
    expect(a.deskProofOk).toBe(true);
    send(a.ws, { method: 'bridge.hello', params: HELLO });
    await new Promise((r) => setTimeout(r, 50));
    expect(server.status()).toMatchObject({ link: 'live', auth: 'mutual', addonVersion: '2.2.0' });
    a.ws.close();
  });

  it('preuve fausse : 4401, et l’AddOn en place n’est pas délogé', async () => {
    const { server, port } = await serve();
    const live = await addon(port);
    send(live.ws, { method: 'bridge.hello', params: HELLO });
    await new Promise((r) => setTimeout(r, 50));
    const rogue = await addon(port, 'mauvais-jeton');
    expect(rogue.deskProofOk).toBe(false);
    expect(await rogue.closed).toBe(CLOSE.BAD_TOKEN);
    expect(server.status()).toMatchObject({ link: 'live', auth: 'mutual' });
    expect(live.ws.readyState).toBe(WebSocket.OPEN);
    live.ws.close();
  });

  it('avant la preuve, toute autre trame ferme en 4401', async () => {
    const { server, port } = await serve();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?v=2`);
    const next = inbox(ws);
    const closed = closeCode(ws);
    await next('bridge.challenge');
    send(ws, { method: 'bridge.hello', params: HELLO });
    expect(await closed).toBe(CLOSE.BAD_TOKEN);
    expect(server.status().link).toBe('absent');
  });

  it('pas de preuve dans le délai : 4401 ; au plus 4 connexions en attente', async () => {
    const clock = new ManualClock();
    const { port } = await serve(clock);
    const pending = Array.from({ length: MAX_PENDING_AUTH }, () => new WebSocket(`ws://127.0.0.1:${port}/?v=2`));
    const challenged = pending.map((ws) => inbox(ws)('bridge.challenge'));
    await Promise.all(challenged);
    const extra = new WebSocket(`ws://127.0.0.1:${port}/?v=2`);
    expect(await closeCode(extra)).toBe(CLOSE.BAD_TOKEN);
    const codes = pending.map(closeCode);
    clock.advance(AUTH_TIMEOUT_MS);
    expect(await Promise.all(codes)).toEqual(pending.map(() => CLOSE.BAD_TOKEN));
  });

  it('ancien AddOn (jeton dans l’URL) : accepté et signalé auth = token', async () => {
    const { server, port } = await serve();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${TOKEN}`);
    await new Promise((r) => ws.once('open', r));
    send(ws, { method: 'bridge.hello', params: { ...HELLO, addonVersion: '2.1.1' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(server.status()).toMatchObject({ link: 'live', auth: 'token' });
    ws.close();
  });

  it('un refus de la garde de l’AddOn garde son code (compte, plafond, tag)', async () => {
    const { server, port } = await serve();
    server.setPolicy({ extraAccounts: ['APEX-1'], maxContractsPerOrder: 1000 });
    const a = await addon(port);
    send(a.ws, { method: 'bridge.hello', params: HELLO });
    await new Promise((r) => setTimeout(r, 50));
    a.ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as Msg;
      if (msg.method === 'order.submit') send(a.ws, { id: msg.id, error: { code: ERR.ACCOUNT, message: 'compte non autorisé par l’AddOn : APEX-1' } });
    });
    const result = await server.submit({ account: 'APEX-1', instrument: 'MNQ 12-26', action: 'Buy', type: 'Market', quantity: 1, tag: 't' });
    expect(result).toEqual({ ok: false, code: ERR.ACCOUNT, message: 'compte non autorisé par l’AddOn : APEX-1' });
    a.ws.close();
  });

  it('format de la preuve : HMAC-SHA256 hexadécimal, clé = jeton UTF-8 (vecteur fixe)', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    expect(authProof('jeton', 'addon', a, b)).toBe(createHmac('sha256', Buffer.from('jeton', 'utf8')).update(`canto-addon|${a}|${b}`).digest('hex'));
    expect(authProof('jeton', 'desk', b, a)).toBe(createHmac('sha256', 'jeton').update(`canto-desk|${b}|${a}`).digest('hex'));
    expect(authProof('jeton', 'addon', a, b)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AddOn 2.2.0 · forme du défi-réponse', () => {
  const SRC = readFileSync('ninjatrader/CantoBridge.cs', 'utf8');

  it('ne met plus le jeton dans l’URL', () => {
    expect(SRC).not.toMatch(/\?token=/);
    expect(SRC).toContain('"/?v=2"');
  });

  it('signe et vérifie avec les mêmes messages que le desk', () => {
    expect(SRC).toContain('new HMACSHA256(Encoding.UTF8.GetBytes(wsToken');
    expect(SRC).toContain('Proof("canto-addon|" + nonce + "|" + mine)');
    expect(SRC).toContain('Proof("canto-desk|" + clientNonce + "|" + serverNonce)');
    expect(SRC).toContain('b.ToString("x2", CultureInfo.InvariantCulture)');
  });

  it('rien n’est exécuté ni envoyé avant la preuve du desk', () => {
    const dispatch = SRC.slice(SRC.indexOf('private void DispatchDesk('), SRC.indexOf('private JObject SubscribeMarket('));
    const gate = dispatch.indexOf('if (!deskVerified) return;');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(dispatch.indexOf('order.submit'));
    const send = SRC.slice(SRC.indexOf('private void Send(JObject msg)'), SRC.indexOf('private void SendNow(JObject msg)'));
    expect(send).toContain('if (!deskVerified) return;');
    // Hello, battements et comptes ne partent qu'après VerifyDesk.
    const connect = SRC.slice(SRC.indexOf('private async Task ConnectLoop('), SRC.indexOf('private async Task ReceiveLoop('));
    expect(connect).not.toContain('SendHello()');
    expect(SRC.slice(SRC.indexOf('private void VerifyDesk('), SRC.indexOf('private void StartSession('))).toContain('StartSession();');
  });
});
