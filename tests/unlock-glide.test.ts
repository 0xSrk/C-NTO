/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLIDE_MS, runUnlockCircuit, unlockTimeline } from '@/app/unlockCircuit';

// Le canevas de jsdom ne dessine pas : un contexte qui accepte tout, pour faire tourner le moteur image par image.
const noop = () => undefined;
const gradient = { addColorStop: noop };
function fakeContext(): CanvasRenderingContext2D {
  const props: Record<PropertyKey, unknown> = {};
  return new Proxy(props, {
    get: (target, key) => (key in target ? target[key] : key === 'createRadialGradient' || key === 'createLinearGradient' ? () => gradient : noop),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OROS4.35 le glissement du sceau, relu à chaque image', () => {
  it('un redimensionnement pendant le glissement ne décentre pas le sceau : il finit au centre de la nouvelle fenêtre', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    if (!('Path2D' in globalThis)) Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: class {} });
    const ctx = fakeContext();
    const canvas = document.createElement('canvas');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return (this === canvas ? ctx : null) as never;
    });
    // la fenêtre, et la place du sceau sans glissement, que la mise en page recalcule au redimensionnement
    const screen = { width: 1440, height: 900, sealRest: 400 };
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, screen.width, screen.height);
    const carrier = { style: {} as Record<string, string> };
    const shifted = () => Number.parseFloat(carrier.style.translate ?? '0') || 0;
    const SEAL_W = 360;
    const seal = () => new DOMRect(screen.sealRest + shifted() - SEAL_W / 2, 300, SEAL_W, SEAL_W * 0.916);
    const tl = unlockTimeline(5);
    const t0 = performance.now();
    const stop = runUnlockCircuit(canvas, {
      timeline: tl,
      clock: () => performance.now() - t0,
      abridged: () => false,
      pads: () => [],
      field: () => null,
      seal,
      sealCarrier: () => carrier as unknown as HTMLElement,
      word: () => null,
      chassis: () => ({ title: null, rail: null, status: null }),
    });
    try {
      const center = () => seal().left + SEAL_W / 2;
      vi.advanceTimersByTime(tl.glide + 100);
      expect(shifted()).toBeGreaterThan(0);
      // la fenêtre rétrécit en plein glissement : le sceau, au repos, se pose ailleurs
      screen.width = 1200;
      screen.sealRest = 330;
      vi.advanceTimersByTime(GLIDE_MS + 50);
      expect(center()).toBeCloseTo(screen.width / 2, 1);
      // et il y reste, le circuit parti, si la fenêtre change encore
      screen.width = 1300;
      screen.sealRest = 360;
      vi.advanceTimersByTime(200);
      expect(center()).toBeCloseTo(screen.width / 2, 1);
    } finally {
      stop();
    }
  });
});
