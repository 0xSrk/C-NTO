import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Miroir de CFG.pre dans electron/aube.js. Le filet est à PRE + 400 ms. */
const PRE_MS = 1350;
const GUARD_MS = PRE_MS + 400;

const SRC = readFileSync(new URL('../electron/aube.js', import.meta.url), 'utf8');

interface AubeApi {
  launch: () => Promise<void>;
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  readonly handoffAt: number;
}

function canvas2d(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_target, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
      if (typeof prop === 'symbol') return undefined;
      return () => undefined;
    },
    set() {
      return true;
    },
  });
}

function loadAube(raf: (cb: (time: number) => void) => number, cancel: (id: number) => void, now: () => number): AubeApi {
  const ctx = canvas2d();
  const make = (id: string) => {
    const el = {
      id,
      width: 0,
      height: 0,
      className: 'aube',
      classList: {
        add(name: string) {
          el.className = `${el.className} ${name}`;
        },
      },
      style: {},
      getContext: (kind: string) => (kind === '2d' ? ctx : null),
      addEventListener: () => undefined,
      getBoundingClientRect: () => ({ left: 102, top: 239, width: 216, height: 54, right: 318, bottom: 293, x: 102, y: 239 }),
    };
    return el;
  };
  const nodes = new Map([
    ['aube', make('aube')],
    ['aube-gl', make('aube-gl')],
    ['aube-vec', make('aube-vec')],
    ['word', make('word')],
  ]);
  const win: { cantoAube?: AubeApi } & Record<string, unknown> = {
    innerWidth: 420,
    innerHeight: 620,
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const sandbox = {
    console,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    performance: { now },
    requestAnimationFrame: raf,
    cancelAnimationFrame: cancel,
    Path2D: class {
      moveTo(): void {}
      lineTo(): void {}
    },
    window: win,
    document: {
      hidden: false,
      getElementById: (id: string) => nodes.get(id) ?? null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  const api = win.cantoAube;
  if (!api) throw new Error('cantoAube absent');
  return api;
}

describe('transfert du lanceur', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('résout le lancement sans aucune image, au filet CFG.pre + 400 ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const api = loadAube(
      () => 0,
      () => undefined,
      () => 0,
    );
    let resolved = false;
    const pending = api.launch().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(GUARD_MS);
    await pending;
    expect(resolved).toBe(true);
    expect(api.handoffAt).toBeGreaterThanOrEqual(0);
  });

  it('résout par la boucle à 1350 ms, et le filet ne réécrit pas handoffAt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let clock = 0;
    const api = loadAube(
      (cb) =>
        setTimeout(() => {
          clock += 15;
          cb(clock);
        }, 15) as unknown as number,
      (id) => {
        clearTimeout(id);
      },
      () => clock,
    );
    let resolved = false;
    const pending = api.launch().then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(PRE_MS);
    expect(resolved).toBe(true);
    const at = api.handoffAt;
    expect(at).toBeGreaterThanOrEqual(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(api.handoffAt).toBe(at);
    await pending;
  });

  it('résout immédiatement si stop() tombe pendant l’attente', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const api = loadAube(
      () => 0,
      () => undefined,
      () => 0,
    );
    let resolved = false;
    const pending = api.launch().then(() => {
      resolved = true;
    });
    api.stop();
    await pending;
    expect(resolved).toBe(true);
  });
});
