/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cssRules, type CssRule } from './helpers/cssRules';

/* Polissage du lanceur AUBE (lot POL8) : la dynamique seulement — comment on arrive au repos et comment on en part.
   Le repos de chaque écran reste identique au pixel. */

const HTML = readFileSync('electron/launcher.html', 'utf8');
const UI = readFileSync('electron/launcher-ui.js', 'utf8');
const MICRO = readFileSync('electron/launcher-micro.js', 'utf8');
const CSS = (/<style>([\s\S]*?)<\/style>/.exec(HTML)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = cssRules(CSS);
const REDUCED = (r: CssRule) => r.at.some((head) => /prefers-reduced-motion:\s*reduce/.test(head));

/** Les sélecteurs d'une règle, un par entrée (liste à virgules hors parenthèses). */
function selectors(rule: CssRule): string[] {
  return splitOutside(rule.selector, ',');
}

/** Découpe à un séparateur hors parenthèses. */
function splitOutside(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && ch === sep) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Valeur d'une propriété dans le corps d'une règle (la dernière déclarée). */
function decl(body: string, prop: string): string | undefined {
  const all = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`, 'g'))];
  return all.at(-1)?.[1]?.trim();
}

/** Les règles d'un sélecteur exact, hors mouvement réduit. */
function rulesOf(selector: string, reduced = false): CssRule[] {
  return RULES.filter((r) => REDUCED(r) === reduced && selectors(r).includes(selector));
}

/** Les temps de l'aube, posés une fois dans le bloc de jetons (s). */
function phase(name: string): number {
  const m = new RegExp(`${name}:\\s*([\\d.]+)s;`).exec(CSS);
  if (!m) throw new Error(`${name} absent du bloc de jetons`);
  return Number(m[1]);
}

/** Règles de l'aube : `.frame[data-phase='intro'] …`. */
function introRules(): CssRule[] {
  return RULES.filter((r) => r.selector.includes(".frame[data-phase='intro']"));
}

const AVAILABLE = { current: '3.6.0', latest: '3.7.0', available: true, busy: false, source: 'github' };
const UP_TO_DATE = { current: '3.6.0', latest: '3.6.0', available: false, busy: false, source: 'github' };
const NOTES = { schemaVersion: 1, entries: [{ version: '3.7.0', date: '2026-11-08', kind: 'fonctionnalite', highlights: { fr: ['Point'], en: ['Point'], es: ['Punto'] } }] };
const FAKE = ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;

const startDesk = vi.fn(async () => true);

interface Boot {
  /** Délai de la réponse du contrôle (ms, horloge du test) ; 0 : au prochain tour. */
  answer?: number;
  available?: boolean;
  reduced?: boolean;
}

/** Le lanceur entier, sans ses scripts, puis ses micrographies et son interface évaluées dans l'ordre de la page. */
function boot({ answer = 0, available = false, reduced = false }: Boot = {}): HTMLElement {
  const body = /<body>([\s\S]*?)<\/body>/.exec(HTML)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: reduced && query.includes('reduce'), addEventListener() {}, removeEventListener() {} }),
  });
  startDesk.mockClear();
  // jsdom n'a pas de canvas : le circuit du départ se neutralise de lui-même.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const status = available ? AVAILABLE : UP_TO_DATE;
  (window as unknown as { canto?: unknown }).canto = {
    version: async () => '3.6.0',
    update: {
      check: () => new Promise((r) => setTimeout(() => r(status), answer)),
      changelog: async () => NOTES,
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

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const key = (k: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

function reset(): void {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete (window as unknown as { canto?: unknown }).canto;
  delete (window as unknown as { cantoMicro?: unknown }).cantoMicro;
}

afterEach(reset);

describe('POL8 lanceur AUBE — la dynamique polie, le repos inchangé', () => {
  it('POL8.1 la mise à jour monte avec les commandes quand le contrôle répond : son départ se règle sur l’horloge de l’aube', async () => {
    const slot = Math.round(phase('--t-panel') * 1000) + 150; // le pas de la mise à jour dans la montée des commandes
    const rest = Math.round(phase('--t-rest') * 1000);
    for (const answer of [600, 1500, 3200]) {
      vi.useFakeTimers({ toFake: [...FAKE] });
      boot({ answer, available: true });
      const update = byId<HTMLButtonElement>('btn-update');
      expect(update.hidden).toBe(true);
      await vi.advanceTimersByTimeAsync(answer);
      expect(update.hidden, `réponse à ${answer} ms`).toBe(false);
      // Dans l'aube, elle garde son pas (--t-panel + 0,15 s depuis l'ouverture) ; venue au repos, elle monte dès qu'elle paraît.
      expect(update.style.animationDelay, `réponse à ${answer} ms`).toBe(`${answer < rest ? Math.max(0, slot - answer) : 0}ms`);
      reset();
    }

    // La minuterie de l'aube, elle, ne pose rien : une réponse tardive (0,1 s avant le repos) garde sa montée entière.
    vi.useFakeTimers({ toFake: [...FAKE] });
    const late = boot({ answer: 2700, available: true });
    await vi.advanceTimersByTimeAsync(2700);
    const lateUpdate = byId<HTMLButtonElement>('btn-update');
    const lateRise = { animationName: 'aube-rise', finish: vi.fn() };
    (lateUpdate as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [lateRise];
    await vi.advanceTimersByTimeAsync(rest - 2700 + 50);
    expect(late.dataset.phase).toBe('rest');
    expect(lateRise.finish).not.toHaveBeenCalled();
    reset();

    // L'aube abrégée ne fait plus attendre le bouton : sa montée se pose, comme les autres commandes.
    vi.useFakeTimers({ toFake: [...FAKE] });
    const frame = boot({ answer: 600, available: true });
    const update = byId<HTMLButtonElement>('btn-update');
    await vi.advanceTimersByTimeAsync(600);
    expect(update.style.animationDelay).toBe(`${slot - 600}ms`);
    const rise = { animationName: 'aube-rise', finish: vi.fn() };
    const other = { animationName: undefined, transitionProperty: 'background-color', finish: vi.fn() };
    (update as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [rise, other];
    await vi.advanceTimersByTimeAsync(400);
    key('Shift');
    expect(frame.dataset.phase).toBe('rest');
    expect(update.style.animationDelay).toBe('0ms');
    expect(rise.finish).toHaveBeenCalledTimes(1);
    expect(other.finish).not.toHaveBeenCalled();

    // La feuille : plus de montée tenue à la phase 'intro' (elle partait de l'affichage, pas de l'ouverture) ;
    // la montée vit sur le bouton, à toute phase, sans remplissage de fin ; le mouvement réduit la tait.
    expect(introRules().some((r) => r.selector.includes('.btn.update'))).toBe(false);
    expect(decl(rulesOf('.btn.update')[0]?.body ?? '', 'animation')).toBe('aube-rise 0.4s var(--ease) backwards');
    expect(rulesOf('.btn.update', true).some((r) => decl(r.body, 'animation') === 'none')).toBe(true);
    expect(UI).toContain(`PANEL_MS = ${Math.round(phase('--t-panel') * 1000)}`);
  });
});
