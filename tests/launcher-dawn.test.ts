/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const HTML = readFileSync('electron/launcher.html', 'utf8');
const UI = readFileSync('electron/launcher-ui.js', 'utf8');
const MICRO = readFileSync('electron/launcher-micro.js', 'utf8');
const AUBE = readFileSync('electron/aube.js', 'utf8');
const CSS = (/<style>([\s\S]*?)<\/style>/.exec(HTML)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Les temps de l'aube, posés une fois dans le bloc de jetons (s). */
const PHASES = ['--t-horizon', '--t-strike', '--t-fold', '--t-rise', '--t-trace', '--t-land', '--t-plates', '--t-panel', '--t-strip', '--t-rest'] as const;
function phase(name: string): number {
  const m = new RegExp(`${name}:\\s*([\\d.]+)s;`).exec(CSS);
  if (!m) throw new Error(`${name} absent du bloc de jetons`);
  return Number(m[1]);
}

/** Règles de l'aube : `.frame[data-phase='intro'] …` et leurs animations. */
function introRules(): { selector: string; body: string }[] {
  return [...CSS.matchAll(/([^{}]*\.frame\[data-phase='intro'\][^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
}

function installPage(reduced = false): void {
  const body = /<body>([\s\S]*?)<\/body>/.exec(HTML)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: reduced && query.includes('reduce'), addEventListener() {}, removeEventListener() {} }),
  });
}

const startDesk = vi.fn(async () => true);

function boot(reduced = false): HTMLElement {
  installPage(reduced);
  startDesk.mockClear();
  // jsdom n'a pas de canvas : le circuit du départ se neutralise de lui-même.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
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
  return document.getElementById('frame')!;
}

const key = (k: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete (window as unknown as { canto?: unknown }).canto;
});

describe('OROS3.10 l’aube : la séquence', () => {
  it('pose ses phases dans l’ordre du récit — horizon, frappe, pli, lever, tracé, pose, plaques, commandes, bande — et se tait avant 2,8 s', () => {
    const times = PHASES.map(phase);
    for (let i = 1; i < times.length; i++) expect(times[i]!, PHASES[i]).toBeGreaterThan(times[i - 1]!);
    expect(phase('--t-rest')).toBeLessThanOrEqual(2.8);
    for (const name of PHASES.slice(0, -1)) expect(introRules().some((r) => r.body.includes(`var(${name})`)), name).toBe(true);
  });

  it('chaque animation de l’aube finit avant le repos', () => {
    const rest = phase('--t-rest');
    const vars = Object.fromEntries(PHASES.map((p) => [p, phase(p)]));
    /** Découpe aux espaces hors parenthèses. */
    const split = (text: string, sep: RegExp) => {
      const out: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of text) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth === 0 && sep.test(ch)) {
          if (cur.trim()) out.push(cur.trim());
          cur = '';
        } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    // Rang le plus haut d'une famille décalée (--i) : les lettres du logotype (0 → 4), les filaments du sceau (0 → 11).
    const lastRank = (selector: string) => (/filament/.test(selector) ? 11 : /\.word/.test(selector) ? Math.max(...[...HTML.matchAll(/--i: (\d+)/g)].map((m) => Number(m[1]))) : 0);
    let checked = 0;
    for (const { selector, body } of introRules()) {
      const anim = /(?:^|;)\s*animation:\s*([^;]+);/.exec(body)?.[1];
      if (!anim) continue;
      for (const part of split(anim, /,/)) {
        expect(part, `${selector} : animation infinie dans l’aube`).not.toMatch(/infinite/);
        const tokens = split(part, /\s/);
        const times = tokens.filter((t) => /^\d*\.?\d+s$|^var\(--t-|^calc\(/.test(t));
        const duration = Number.parseFloat(times[0] ?? '0');
        const delayToken = times[1] ?? '0s';
        const base = /var\((--t-[a-z]+)\)/.exec(delayToken)?.[1];
        const step = /var\(--i\)\s*\*\s*([\d.]+)s/.exec(delayToken)?.[1];
        const extra = /\+\s*([\d.]+)s/.exec(delayToken)?.[1];
        const delay = (base ? vars[base]! : Number.parseFloat(delayToken) || 0) + (step ? lastRank(selector) * Number(step) : 0) + (extra ? Number(extra) : 0);
        expect(delay + duration, `${selector} → ${part}`).toBeLessThanOrEqual(rest + 0.001);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(12);
  });

  it('l’interface compte le même repos que la feuille', () => {
    expect(UI).toContain(`INTRO_REST_MS = ${Math.round(phase('--t-rest') * 1000)}`);
  });

  it('le sceau frappe sur l’horizon de l’écran, puis se plie en lui : son horizon (48,27 %) est l’origine du pli', () => {
    expect(HTML).toMatch(/class="seal"[^>]*id="seal"/);
    expect(CSS).toMatch(/\.seal\s*\{[^}]*transform-origin:\s*50% 48\.27%/);
    expect(CSS).toMatch(/\.seal\s*\{[^}]*top:\s*calc\(var\(--H\) - 0\.4827 \* var\(--seal-h\)\)/);
  });

  it('la LED se lève de l’horizon avec les rayons de la planche et se pose sur la pointe du Λ', () => {
    installPage();
    window.eval(MICRO);
    window.eval(UI);
    expect(document.querySelector('#rays .skg-96')).not.toBeNull();
    expect(document.getElementById('led-path')?.querySelector('#led')).not.toBeNull();
  });
});

describe('OROS3.10 l’aube : on l’abrège, on la tait', () => {
  it('se tient en phase d’aube à l’ouverture, puis gagne le repos à --t-rest', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const frame = boot();
    expect(frame.dataset.phase).toBe('intro');
    vi.advanceTimersByTime(phase('--t-rest') * 1000 - 50);
    expect(frame.dataset.phase).toBe('intro');
    vi.advanceTimersByTime(100);
    expect(frame.dataset.phase).toBe('rest');
  });

  it('une touche abrège l’aube jusqu’au repos, sans lancer le desk', () => {
    const frame = boot();
    key('Enter');
    expect(frame.dataset.phase).toBe('rest');
    expect(frame.classList.contains('leaving')).toBe(false);
    expect(startDesk).not.toHaveBeenCalled();
  });

  it('un clic abrège l’aube : ce clic-là ne vise rien, le suivant agit', async () => {
    const frame = boot();
    const launch = document.getElementById('btn-launch')!;
    launch.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    launch.click();
    expect(frame.dataset.phase).toBe('rest');
    expect(frame.classList.contains('leaving')).toBe(false);
    launch.click();
    expect(frame.classList.contains('leaving')).toBe(true);
    await vi.waitFor(() => expect(startDesk).toHaveBeenCalledTimes(1));
  });

  it('Échap ferme toujours la fenêtre, même pendant l’aube', () => {
    boot();
    const close = vi.fn();
    (window as unknown as { canto: { window: { close: () => void } } }).canto.window.close = close;
    key('Escape');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('mouvement réduit : le repos d’emblée, et la feuille éteint toute animation de l’aube', () => {
    const frame = boot(true);
    expect(frame.dataset.phase).toBe('rest');
    const reducedBlock = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n {6}\}/.exec(CSS)?.[1] ?? '';
    expect(reducedBlock).toMatch(/\.frame\[data-phase='intro'\][^{]*\{[^}]*animation:\s*none/);
  });

  it('le calque vectoriel connaît le repos : l’abréger arrête sa boucle', () => {
    const win: Record<string, unknown> = {
      innerWidth: 420,
      innerHeight: 620,
      devicePixelRatio: 1,
      matchMedia: () => ({ matches: false }),
      addEventListener: () => undefined,
    };
    const ctx = new Proxy({}, { get: (_t, p) => (p === 'createLinearGradient' || p === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => undefined), set: () => true });
    const el = () => ({ getContext: () => ctx, classList: { add() {} }, getBoundingClientRect: () => ({ left: 50, top: 204, width: 320, height: 80 }) });
    const nodes: Record<string, unknown> = { aube: el(), 'aube-vec': el(), word: el() };
    vm.runInNewContext(AUBE, {
      window: win,
      document: { getElementById: (id: string) => nodes[id] ?? null },
      performance: { now: () => 0 },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => undefined,
      setTimeout,
      clearTimeout,
    });
    const api = win.cantoAube as { isRunning: () => boolean; rest: () => void };
    expect(api.isRunning()).toBe(true);
    api.rest();
    expect(api.isRunning()).toBe(false);
  });
});
