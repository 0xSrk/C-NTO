/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Graph } from '@/modules/note/Graph';
import type { Note } from '@/store/db';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * POL7 — polissage des autres modules (Calendrier, Note, Portefeuille, Agent IA, Bot, Copieur, Crypto) : la dynamique
 * seulement. Le repos de chaque écran reste identique au pixel ; aucune couleur, taille ni jeton nouveau.
 */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Le banc du graphe : un canevas qui note ses peintures (les centres de chaque nœud), une file d'images vidée à la main. */
function graphBench(reduce: boolean) {
  const frames: FrameRequestCallback[] = [];
  const paints: [number, number][][] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key === 'clearRect') return () => paints.push([]);
      if (key === 'arc') return (x: number, y: number) => paints.at(-1)?.push([x, y]);
      return key in target ? target[key] : () => undefined;
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) } as DOMRect);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)', media: query, addEventListener() {}, removeEventListener() {} }));
  return { frames, paints };
}

const note = (id: string, title: string, body = ''): Note => ({ id, title, body, tags: [] }) as unknown as Note;
const FOUR = [note('a', 'Alpha', '[[Beta]] [[Gamma]]'), note('b', 'Beta', '[[Gamma]]'), note('c', 'Gamma'), note('d', 'Delta')];

function mountGraph(notes: Note[]): void {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Graph, { notes, activeId: null, onOpen: () => undefined })));
}

/** Joue les images demandées jusqu'à ce que le graphe n'en demande plus (borne : `limit`). Rend le nombre d'images jouées. */
function drain(frames: FrameRequestCallback[], limit = 2000): number {
  let n = 0;
  while (frames.length > 0 && n < limit) {
    frames.shift()!(n * 16);
    n++;
  }
  return n;
}

describe('POL7 autres modules : la dynamique polie, le repos inchangé', () => {
  it('POL7.1 sous mouvement réduit, le graphe des notes paraît posé : une seule peinture, au repos du mouvement normal, par tranches qui ne figent pas le desk', () => {
    // Mouvement normal : la mise en page se déroule sous les yeux, puis se pose.
    const normal = graphBench(false);
    mountGraph(FOUR);
    drain(normal.frames);
    expect(normal.frames).toHaveLength(0);
    expect(normal.paints.length).toBeGreaterThan(10);
    const rest = normal.paints.at(-1)!;
    expect(rest).toHaveLength(4);
    act(() => root!.unmount());
    root = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    // Mouvement réduit : le même repos, peint une fois ; rien ne glisse.
    const reduced = graphBench(true);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    mountGraph(FOUR);
    drain(reduced.frames);
    expect(reduced.frames).toHaveLength(0);
    expect(reduced.paints).toHaveLength(1);
    reduced.paints[0]!.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(rest[i]![0], 6);
      expect(y).toBeCloseTo(rest[i]![1], 6);
    });
    act(() => root!.unmount());
    root = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    // Un graphe chargé se calcule par tranches, hors de la vue : plusieurs images sans peinture, puis le repos, une fois.
    const big = graphBench(true);
    const many = Array.from({ length: 120 }, (_, i) => note(`n${i}`, `N${i}`, i + 1 < 120 ? `[[N${i + 1}]]` : ''));
    mountGraph(many);
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 5));
    const ticks = drain(big.frames);
    expect(big.frames).toHaveLength(0);
    expect(ticks).toBeGreaterThan(1);
    expect(big.paints).toHaveLength(1);
  });
});
