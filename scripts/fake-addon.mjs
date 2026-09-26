/**
 * Faux AddOn NT8 : se connecte au desk, envoie des barres et une exécution,
 * et répond à `order.submit` sur Sim101 par un remplissage de sortie.
 *
 *   node scripts/fake-addon.mjs --port 48231 --token <jeton>
 *   node scripts/fake-addon.mjs --config ~/Documents/NinjaTrader\ 8/export/CANTO/bridge.json
 *
 * Le CSV réel et la compilation NT8 ne sont pas simulés ici.
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const configPath = arg('config');
const file = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const port = Number(arg('port') ?? file.port ?? 48231);
const token = arg('token') ?? file.token;
if (!token) {
  console.error('Jeton manquant : --token ou --config bridge.json');
  process.exit(1);
}

let delay = 1000;
let socket;
let beat;

function connect() {
  socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
  socket.on('open', () => {
    delay = 1000;
    send({ jsonrpc: '2.0', id: 1, method: 'bridge.hello', params: { kind: 'ninjatrader', ntVersion: 'fake', addonVersion: 'fake-addon', accounts: ['Sim101'], protocol: 1 } });
    send({
      jsonrpc: '2.0',
      method: 'bridge.execution',
      params: { Instrument: 'MNQ 12-26', Action: 'Buy', Quantity: 1, Price: 21000.25, Time: Date.now(), ID: 'fake-entry', 'E/X': 'Entry', Account: 'Sim101', Commission: 0.5, Rate: 1, Connection: 'Simulated' },
    });
    beat = setInterval(() => send({ jsonrpc: '2.0', method: 'bridge.heartbeat', params: { at: Date.now() } }), 2000);
  });
  socket.on('message', (data) => {
    const msg = JSON.parse(String(data));
    if (msg.method === 'marketdata.subscribe' && msg.params?.kind === 'bars') {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { subscriptionId: 'fake-bars' } }));
      for (let i = 0; i < 3; i++) {
        const time = Math.floor(Date.now() / 1000) - (2 - i) * 300;
        send({ jsonrpc: '2.0', method: 'marketdata.bar', params: { instrument: msg.params.instrument, timeframe: msg.params.timeframe ?? 5, bar: { time, open: 21000, high: 21010, low: 20990, close: 21000 + i, volume: 10 }, final: true } });
      }
    }
    if (msg.method === 'order.submit') {
      const orderId = `fake-${Date.now()}`;
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { orderId, latencyMs: 1 } }));
      send({
        jsonrpc: '2.0',
        method: 'bridge.execution',
        params: { Instrument: msg.params.instrument, Action: 'Sell', Quantity: msg.params.quantity, Price: 21010.25, Time: Date.now(), ID: `fake-exit-${orderId}`, 'E/X': 'Exit', Account: msg.params.account, Name: msg.params.tag, Commission: 0.5, Rate: 1, Connection: 'Simulated', 'Order ID': orderId },
      });
      console.log(`order.submit exécuté ${orderId} tag=${msg.params.tag}`);
    }
    if (msg.method === 'order.flatten') socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { closed: 1 } }));
    if (msg.method === 'order.cancel') socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }));
    if (msg.method === 'bridge.snapshot') socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { accounts: [] } }));
  });
  socket.on('close', (code) => {
    clearInterval(beat);
    console.log(`fermé ${code}, reconnexion dans ${delay} ms`);
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30_000);
  });
  socket.on('error', () => {});
}

function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

connect();
