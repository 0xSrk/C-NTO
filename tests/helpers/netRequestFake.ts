import { EventEmitter } from 'node:events';

/**
 * Faux `net.request` d'Electron, sur le comportement relevé sous Electron 43.7.1 (essai sur 127.0.0.1, UPD2) : en
 * `redirect: 'manual'`, chaque saut émet `redirect` avec une URL absolue ; `followRedirect()` appelé pendant
 * l'événement le suit, `abort()` arrête tout et émet `abort`, et sans l'un ni l'autre la requête est annulée.
 */
export interface FakeWorld {
  /** Les cibles des redirections successives, dans l'ordre. */
  hops: string[];
  status: number;
  body: string;
  /** En-tête `content-length` annoncé, s'il diffère de la taille du corps. */
  contentLength?: string;
}

export interface FakeRequestLog {
  options: Record<string, unknown>;
  /** Les sauts suivis par le code testé, dans l'ordre. */
  followed: string[];
  aborted: boolean;
}

export function fakeNetRequest(world: () => FakeWorld) {
  const log: FakeRequestLog[] = [];
  const request = (options: Record<string, unknown>) => {
    const entry: FakeRequestLog = { options, followed: [], aborted: false };
    log.push(entry);
    const req = new EventEmitter() as EventEmitter & { end: () => void; abort: () => void; followRedirect: () => void };
    let follow = false;
    req.followRedirect = () => {
      follow = true;
    };
    req.abort = () => {
      if (entry.aborted) return;
      entry.aborted = true;
      req.emit('abort');
    };
    req.end = () => {
      queueMicrotask(() => {
        const w = world();
        for (const hop of w.hops) {
          follow = false;
          req.emit('redirect', 302, 'GET', hop, {});
          if (entry.aborted) return;
          if (!follow) {
            req.emit('error', new Error('Redirect was cancelled'));
            return;
          }
          entry.followed.push(hop);
        }
        const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string | string[]> };
        res.statusCode = w.status;
        res.headers = { 'content-length': w.contentLength ?? String(Buffer.byteLength(w.body)) };
        req.emit('response', res);
        const bytes = Buffer.from(w.body, 'utf8');
        for (let at = 0; at < bytes.length && !entry.aborted; at += 16 * 1024) res.emit('data', bytes.subarray(at, at + 16 * 1024));
        if (!entry.aborted) res.emit('end');
      });
    };
    return req;
  };
  return { request, log };
}
