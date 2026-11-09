import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BROWSER_REFUSAL_LOG_MS, MAX_PENDING_AUTH, ManualClock, NtBridgeServer } from '../electron/nt-bridge/server';

const TOKEN = 'jeton-de-test-origine';
const HELLO = { kind: 'ninjatrader', ntVersion: '8', addonVersion: '2.2.0', accounts: ['Sim101'], protocol: 1 };
const PAGE = 'https://page.example';

type Msg = Record<string, any>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Issue de la poignée de main : ouverte, ou refusée avec le statut HTTP de la réponse. */
function handshake(url: string, origin?: string): Promise<{ ws: WebSocket; opened: boolean; status: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, origin ? { headers: { Origin: origin } } : {});
    ws.once('open', () => resolve({ ws, opened: true, status: 101 }));
    ws.once('unexpected-response', (_req, res) => {
      res.resume();
      resolve({ ws, opened: false, status: res.statusCode ?? 0 });
    });
    ws.once('error', () => resolve({ ws, opened: false, status: 0 }));
  });
}

/** Ce que fait l'AddOn 2.2.0 : aucun en-tête `Origin`, réponse au défi, puis `bridge.hello`. */
async function addon(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?v=2`);
  const challenge = await new Promise<Msg>((resolve, reject) => {
    ws.once('message', (data) => resolve(JSON.parse(String(data)) as Msg));
    ws.once('close', () => reject(new Error('connexion fermée avant le défi')));
  });
  const serverNonce = challenge.params.nonce as string;
  const clientNonce = randomBytes(32).toString('hex');
  const proof = createHmac('sha256', TOKEN).update(`canto-addon|${serverNonce}|${clientNonce}`).digest('hex');
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'bridge.auth', params: { nonce: clientNonce, proof } }));
  await new Promise((resolve) => ws.once('message', resolve));
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.hello', params: HELLO }));
  return ws;
}

describe('SEC1.1 pont NT8 : une page web ne s’y connecte pas', () => {
  const servers: NtBridgeServer[] = [];
  const sockets: WebSocket[] = [];
  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });
  async function serve(clock?: ManualClock) {
    const lines: string[] = [];
    const server = new NtBridgeServer({ token: TOKEN, port: 0, log: (line) => lines.push(line), ...(clock ? { clock } : {}) });
    servers.push(server);
    return { server, port: await server.start(), lines };
  }

  it('refuse à la poignée de main toute connexion qui porte un en-tête Origin', async () => {
    const { port } = await serve();
    const page = await handshake(`ws://127.0.0.1:${port}/?v=2`, PAGE);
    sockets.push(page.ws);
    expect(page.opened).toBe(false);
    expect(page.status).toBe(403);
  });

  it('refuse aussi l’ancien chemin au jeton dans l’URL : un jeton juste ne rachète pas une origine de navigateur', async () => {
    const { server, port } = await serve();
    const page = await handshake(`ws://127.0.0.1:${port}/?token=${TOKEN}`, PAGE);
    sockets.push(page.ws);
    expect(page.opened).toBe(false);
    expect(page.status).toBe(403);
    expect(server.status().link).toBe('absent');
  });

  it('accepte l’AddOn, qui n’envoie pas d’en-tête Origin', async () => {
    const { server, port } = await serve();
    sockets.push(await addon(port));
    await sleep(50);
    expect(server.status()).toMatchObject({ link: 'live', auth: 'mutual' });
  });

  it('des pages web ne prennent plus les places d’authentification : l’AddOn se reconnecte', async () => {
    const { server, port } = await serve();
    // Plus de pages que de places : sans le refus, la suivante — l'AddOn — se voit fermer la porte.
    const pages = await Promise.all(Array.from({ length: MAX_PENDING_AUTH + 2 }, () => handshake(`ws://127.0.0.1:${port}/?v=2`, PAGE)));
    sockets.push(...pages.map((page) => page.ws));
    expect(pages.every((page) => !page.opened)).toBe(true);
    sockets.push(await addon(port));
    await sleep(50);
    expect(server.status()).toMatchObject({ link: 'live', auth: 'mutual' });
  });

  it('le dit au journal sans le remplir : une ligne, puis le compte une fois par minute au plus', async () => {
    const clock = new ManualClock();
    const { port, lines } = await serve(clock);
    const knock = async (count: number) => {
      const pages = await Promise.all(Array.from({ length: count }, () => handshake(`ws://127.0.0.1:${port}/?v=2`, PAGE)));
      sockets.push(...pages.map((page) => page.ws));
    };
    const refused = () => lines.filter((line) => line.includes('Origin'));
    await knock(5);
    expect(refused()).toHaveLength(1);
    clock.advance(BROWSER_REFUSAL_LOG_MS - 1);
    await knock(3);
    expect(refused()).toHaveLength(1);
    clock.advance(1);
    await knock(1);
    expect(refused()).toHaveLength(2);
    expect(refused()[1]).toContain('9 depuis le démarrage');
    // Ni l'origine ni le jeton ne sont journalisés : une page choisit son origine, elle n'écrit pas dans le journal.
    expect(lines.join('\n')).not.toContain('page.example');
    expect(lines.join('\n')).not.toContain(TOKEN);
  });
});
