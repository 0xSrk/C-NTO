import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: () => '1.1.2' },
}));

import { WebSocket } from 'ws';
import type { AppLocale } from '../electron/locale';
import { Orchestrator } from '../electron/orchestrator';

/** Ouvre une connexion et rend chaque trame reçue (hors `desk.hello`). */
function connect(url: string): Promise<{ ws: WebSocket; next: () => Promise<{ error?: { code: number; message: string } }> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames: unknown[] = [];
    const waiters: ((frame: unknown) => void)[] = [];
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as { method?: string };
      if (frame.method === 'desk.hello') return;
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else frames.push(frame);
    });
    ws.once('open', () =>
      resolve({
        ws,
        next: () =>
          new Promise((done) => {
            const frame = frames.shift();
            if (frame) done(frame as { error?: { code: number; message: string } });
            else waiters.push(done as (frame: unknown) => void);
          }),
      }),
    );
    ws.once('error', reject);
  });
}

function closeReason(url: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once('close', (_code, reason) => resolve(reason.toString()));
    ws.once('error', () => {
      /* la fermeture suit */
    });
  });
}

describe('orchestrateur · langue du desk', () => {
  let orch: Orchestrator | null = null;

  afterEach(() => {
    orch?.stop();
    orch = null;
  });

  async function messages(locale: AppLocale): Promise<string[]> {
    orch = new Orchestrator(() => locale);
    const { port } = await orch.start(0);
    const out: string[] = [await closeReason(`ws://127.0.0.1:${port}/?token=faux`)];

    const anonymous = await connect(`ws://127.0.0.1:${port}/`);
    anonymous.ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'desk.describe' }));
    out.push((await anonymous.next()).error?.message ?? '');
    anonymous.ws.close();

    const client = await connect(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(orch.copyToken())}`);
    for (const raw of ['pas du json', '[]', JSON.stringify({ jsonrpc: '2.0', id: 2 }), JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'desk.inconnue' }), JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'desk.describe' })]) {
      client.ws.send(raw);
      out.push((await client.next()).error?.message ?? '');
    }
    client.ws.close();
    return out;
  }

  it('répond en français par défaut', async () => {
    expect(await messages('fr')).toEqual([
      'Jeton invalide',
      'Authentification requise : desk.auth { token } ou ?token=',
      'JSON invalide',
      'Requête invalide : objet attendu',
      'Requête invalide : method manquant',
      'Méthode introuvable',
      'Desk indisponible',
    ]);
  });

  it('répond en anglais et en espagnol quand le desk est dans ces langues', async () => {
    expect(await messages('en')).toEqual([
      'Invalid token',
      'Authentication required: desk.auth { token } or ?token=',
      'Invalid JSON',
      'Invalid request: object expected',
      'Invalid request: method is missing',
      'Method not found',
      'Desk unavailable',
    ]);
    orch?.stop();
    expect(await messages('es')).toEqual([
      'Token inválido',
      'Autenticación requerida: desk.auth { token } o ?token=',
      'JSON no válido',
      'Solicitud no válida: se espera un objeto',
      'Solicitud no válida: falta method',
      'Método no encontrado',
      'Desk no disponible',
    ]);
  });
});
