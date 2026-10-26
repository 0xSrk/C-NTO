/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const HTML = readFileSync('electron/launcher.html', 'utf8');
const UI = readFileSync('electron/launcher-ui.js', 'utf8');
const MICRO = readFileSync('electron/launcher-micro.js', 'utf8');
const CSS = (/<style>([\s\S]*?)<\/style>/.exec(HTML)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Temps du départ, après la main rendue par l'aube (miroir de runTransfer). */
const T_COLLAPSE = 1000;
const T_LED = 1260;
const T_DONE = 1520;

type Call = { name: string; args: unknown[]; at: number };

function canvasRecorder(calls: Call[]) {
  const gradient = { addColorStop() {} };
  return new Proxy(
    {},
    {
      get: (_t, name: string) =>
        name === 'createLinearGradient' || name === 'createRadialGradient'
          ? () => gradient
          : (...args: unknown[]) => {
              calls.push({ name, args, at: performance.now() });
            },
      set: () => true,
    },
  );
}

const startDesk = vi.fn(async () => true);

function boot(calls: Call[]): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  const body = /<body>([\s\S]*?)<\/body>/.exec(HTML)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 420 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 620 });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasRecorder(calls) as unknown as CanvasRenderingContext2D);
  startDesk.mockClear();
  (window as unknown as { canto?: unknown }).canto = {
    version: async () => '3.6.0',
    update: {
      check: async () => ({ current: '3.6.0', latest: '3.6.0', available: false, busy: false, source: 'github' }),
      changelog: async () => null,
      startDesk,
      apply: async () => ({}),
      relaunch: async () => true,
      onProgress: () => () => undefined,
    },
    locale: { get: async () => 'fr', set: async (l: string) => l },
    window: { close() {} },
  };
  window.eval(MICRO);
  window.eval(UI);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete (window as unknown as { canto?: unknown }).canto;
});

describe('OROS3.11 le départ se replie sur l’horizon', () => {
  it('chaque trait de la graduation est une liaison : toutes comptées avant que la LED ne s’embrase', async () => {
    const calls: Call[] = [];
    boot(calls);
    await vi.advanceTimersByTimeAsync(3000); // l'aube gagne le repos
    document.getElementById('btn-launch')!.click();
    await vi.advanceTimersByTimeAsync(T_LED - 40);
    // 420 px : un trait tous les 8 px du centre vers chaque bord, et le centre.
    const total = 1 + 2 * Math.floor(210 / 8);
    expect(document.getElementById('hud-count')!.textContent).toBe(`${String(total).padStart(3, '0')} / ${String(total).padStart(3, '0')}`);
  });

  it('le sceau se rouvre en filets puis se replie avec le logotype ; la LED reste seule et rayonne en anneaux', async () => {
    const calls: Call[] = [];
    boot(calls);
    await vi.advanceTimersByTimeAsync(3000);
    document.getElementById('btn-launch')!.click();
    const t0 = performance.now();
    await vi.advanceTimersByTimeAsync(T_COLLAPSE + 20);
    expect(document.getElementById('frame')!.classList.contains('collapse')).toBe(true);
    await vi.advanceTimersByTimeAsync(T_DONE - T_COLLAPSE);
    const at = (c: Call) => c.at - t0;
    const ellipses = calls.filter((c) => c.name === 'ellipse');
    expect(ellipses.some((c) => at(c) > 500 && at(c) < T_COLLAPSE)).toBe(true);
    expect(ellipses.some((c) => at(c) > T_LED)).toBe(false);
    expect(calls.some((c) => c.name === 'arc' && at(c) > T_LED)).toBe(true);
    // Plus de pistes de circuit imprimé : rien ne se trace hors de l'horizon avant l'embrasement, sauf les anneaux du sceau.
    expect(calls.some((c) => c.name === 'strokeRect')).toBe(false);
    expect(startDesk).toHaveBeenCalledTimes(1);
    expect(document.getElementById('hud-fill')!.style.width).toBe('100%');
  });

  it('la LED quitte la pointe du Λ dès le départ : la lumière de l’aube la ramène sur l’horizon', () => {
    expect(CSS).toMatch(/\.frame\.leaving \.led-path\s*\{[^}]*opacity:\s*0/);
  });
});
