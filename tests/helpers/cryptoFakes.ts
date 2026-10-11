import { vi } from 'vitest';
import type { FetchLike } from '../../electron/crypto-net';
import type { Timers, WsFactory, WsLike } from '../../electron/crypto-socket';

/**
 * Faux réseau des tests du module crypto côté process principal : sockets, minuteurs, fetch d'exchange. Les fichiers
 * `tests/crypto-feeds.test.ts` et `tests/crypto-temperature-host.test.ts` gardent leur propre copie (antérieure) ; tout
 * nouveau test les prend ici.
 */

/** Un écouteur de la fausse socket : `any` pour couvrir chaque surcharge de `WsLike.on` (paramètres de rappel vérifiés strictement). */
type Listener = (...args: any[]) => void;

/** Fausse socket : ce que le desk envoie est noté ; le « serveur » du test pousse ses événements par `emit`. */
export class FakeWs implements WsLike {
  readonly sent: string[] = [];
  pings = 0;
  /** `close()` demandé : la poignée de fermeture. */
  closed = false;
  /** `terminate()` demandé : coupée net. */
  terminated = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  ping(): void {
    this.pings += 1;
  }

  close(): void {
    this.closed = true;
  }

  terminate(): void {
    this.terminated = true;
  }

  on(event: string, cb: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }

  open(): void {
    this.emit('open');
  }

  message(raw: string | Uint8Array): void {
    this.emit('message', raw);
  }

  pong(): void {
    this.emit('pong');
  }

  /** La venue ferme la connexion, ou la tentative échoue avant de s’ouvrir (ws : `close` avec un code). */
  drop(code = 1006): void {
    this.emit('close', code, Buffer.from(''));
  }

  /** Réponse HTTP à la place du passage en WebSocket. */
  refuse(statusCode: number): void {
    this.emit('unexpected-response', {}, { statusCode });
  }

  /** Fermée, d’une façon ou de l’autre. */
  get gone(): boolean {
    return this.closed || this.terminated;
  }

  /** Les messages envoyés, décodés. */
  json(): unknown[] {
    return this.sent.map((m) => JSON.parse(m) as unknown);
  }
}

/** Une fabrique de fausses sockets, et toutes celles qu’elle a rendues, dans l’ordre. */
export function fakeNet(): { sockets: FakeWs[]; ws: WsFactory } {
  const sockets: FakeWs[] = [];
  return {
    sockets,
    ws: (url) => {
      const socket = new FakeWs(url);
      sockets.push(socket);
      return socket;
    },
  };
}

/** Les minuteurs du moment : appelée après `vi.useFakeTimers()`, elle rend les faux. */
export const timers = (): Timers => ({ setTimeout, clearTimeout, setInterval, clearInterval });

/** Une réponse JSON d’exchange. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Faux `fetch` d’exchange, à donner en `fetchImpl` : chaque appel est noté (URL et options) ; `reply` rend la réponse
 * de chaque URL (une liste vide en JSON par défaut).
 */
export function fakeFetch(reply: (url: string) => Response | Promise<Response> = () => jsonResponse([])) {
  const fetchImpl = vi.fn<FetchLike>(async (url) => reply(url));
  return {
    fetchImpl,
    /** Les URLs demandées, dans l’ordre. */
    urls: (): string[] => fetchImpl.mock.calls.map(([url]) => url),
  };
}

/** Laisse filer les promesses en cours (une réponse reçue, lue, fusionnée, émise). */
export async function settle(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** L’élément à cet index (négatif : depuis la fin), ou une erreur claire. */
export function nth<T>(list: readonly T[], index: number): T {
  const item = list[index < 0 ? list.length + index : index];
  if (item === undefined) throw new Error(`aucun élément à l’index ${index}`);
  return item;
}
