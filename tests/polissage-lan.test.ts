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

  it('POL8.2 l’action principale a son anneau de focus : tracé par son conteneur, au-dehors, à 2 px, il suit le chanfrein', () => {
    // L'anneau de tous les boutons du lanceur : 1 px d'or à 2 px. Le chanfrein le rogne (la découpe rogne tout ce que
    // l'élément peint, contour compris) : chaque bouton découpé porte son anneau sur un autre élément que lui.
    const focus = rulesOf('button:focus-visible')[0]?.body ?? '';
    const thick = parseFloat(decl(focus, 'outline') ?? '');
    const offset = parseFloat(decl(focus, 'outline-offset') ?? '');
    expect([thick, offset]).toEqual([1, 2]);
    const clipped = RULES.filter((r) => !REDUCED(r) && !r.selector.includes('data-phase') && /\.btn/.test(r.selector) && r.props.includes('clip-path'));
    expect(clipped.map((r) => r.selector)).toEqual(['.btn.primary']);
    for (const rule of clipped) {
      const on = RULES.find((r) => r.selector === `.actions:has(> ${rule.selector}:focus-visible)::before`);
      expect(decl(on?.body ?? '', 'opacity'), rule.selector).toBe('1');
      expect(decl(rulesOf(`${rule.selector}:focus-visible`)[0]?.body ?? '', 'outline-color'), rule.selector).toBe('transparent');
    }

    // Le porteur : le conteneur des actions, posé sans rien déplacer ; l'anneau, éteint au repos, ne capte rien.
    // Il est taillé pour l'action principale en tête du conteneur, sur toute sa largeur : déplacée, l'anneau ne la
    // suivrait pas.
    const actions = new DOMParser().parseFromString(HTML, 'text/html').querySelector('.actions');
    expect(actions?.firstElementChild?.matches('#btn-launch.btn.primary')).toBe(true);
    expect(decl(rulesOf('.actions')[0]?.body ?? '', 'flex-direction')).toBe('column');
    expect(decl(rulesOf('.actions')[0]?.body ?? '', 'align-items')).toBeUndefined();
    expect(decl(rulesOf('.actions')[0]?.body ?? '', 'position')).toBe('relative');
    const ring = rulesOf('.actions::before')[0]?.body ?? '';
    expect(decl(ring, 'position')).toBe('absolute');
    expect(decl(ring, 'background')).toBe('var(--gold)');
    expect(decl(ring, 'opacity')).toBe('0');
    expect(decl(ring, 'pointer-events')).toBe('none');

    // Sa géométrie : la boîte du bouton agrandie de l'écart et de l'épaisseur de l'anneau, et le chanfrein décalé
    // d'autant, au-dehors (bord extérieur à 3 px) comme au-dedans (bord intérieur à 2 px).
    const pad = offset + thick;
    const chamfer = Number(/--chamfer:\s*polygon\(0 0, calc\(100% - (\d+)px\) 0/.exec(CSS)?.[1]);
    const height = parseFloat(decl(rulesOf('.btn')[0]?.body ?? '', 'height') ?? '');
    expect([chamfer, height]).toEqual([10, 44]);
    expect(decl(ring, 'left')).toBe(`-${pad}px`);
    expect(decl(ring, 'top')).toBe(`-${pad}px`);
    expect(decl(ring, 'width')).toBe(`calc(100% + ${2 * pad}px)`);
    expect(decl(ring, 'height')).toBe(`${height + 2 * pad}px`);
    const outer = (chamfer + 2 * pad - pad * Math.SQRT2).toFixed(2);
    const inner = (chamfer + pad + offset - offset * Math.SQRT2).toFixed(2);
    const t = `${thick}px`;
    expect(decl(ring, 'clip-path')).toBe(
      `polygon(evenodd, 0 0, calc(100% - ${outer}px) 0, 100% ${outer}px, 100% 100%, 0 100%, 0 0, ${t} ${t}, ${t} calc(100% - ${t}), calc(100% - ${t}) calc(100% - ${t}), calc(100% - ${t}) ${inner}px, calc(100% - ${inner}px) ${t}, ${t} ${t})`,
    );
  });

  it('POL8.3 mouvement réduit : le départ se tait aussi — rien ne balaie ni ne glisse, les commandes s’effacent', () => {
    // En mouvement réduit, la phase vaut 'rest' dès l'ouverture : l'extinction en bloc de l'aube ne couvre pas le départ.
    const plain = RULES.filter((r) => !REDUCED(r) && !r.at.some((h) => h.startsWith('@keyframes')) && !r.selector.includes("data-phase='intro'"));
    const quiet = RULES.filter(REDUCED);
    /** La valeur qui l'emporte pour un sélecteur : la dernière règle qui la déclare (même spécificité). */
    const effective = (sel: string, prop: string, rules: CssRule[]) =>
      rules
        .filter((r) => selectors(r).includes(sel) && decl(r.body, prop) !== undefined)
        .map((r) => decl(r.body, prop))
        .at(-1);
    const missing: string[] = [];
    for (const sel of new Set(plain.flatMap(selectors))) {
      const anim = effective(sel, 'animation', plain);
      if (anim && anim !== 'none' && effective(sel, 'animation', quiet) !== 'none') missing.push(`${sel} › animation`);
      const move = effective(sel, 'transform', plain);
      if (sel.startsWith('.frame.leaving') && move && move !== 'none' && effective(sel, 'transform', quiet) !== 'none') missing.push(`${sel} › transform`);
    }
    expect(missing).toEqual([]);
    // Le fondu d'opacité du départ reste, comme au verrou du desk : « le mot paraît, le verrou s'efface ».
    for (const rule of quiet.filter((r) => selectors(r).some((s) => s.startsWith('.frame.leaving')))) {
      expect(rule.props.filter((p) => p !== 'transform' && p !== 'animation'), rule.selector).toEqual([]);
    }
    expect(effective('.frame.leaving .panel', 'transition', plain)).toMatch(/^opacity 0\.22s linear/);
  });

  it('POL8.4 au départ, les commandes se retirent avec le panneau : elles ne prennent pas l’air d’un bouton refusé', async () => {
    // L'action principale garde sa plaque : la pierre, celle du pointeur et de l'appui, sans le filet gris du désactivé.
    const leaving = rulesOf('.frame.leaving .btn.primary:disabled')[0]?.body ?? '';
    expect(decl(leaving, 'background')).toBe('var(--stone)');
    expect(decl(leaving, 'color')).toBe('var(--ink)');
    expect(decl(leaving, 'box-shadow')).toBe('none');
    expect(decl(leaving, '--k')).toBe('var(--ink)');
    expect(decl(rulesOf('.btn.primary:hover:not(:disabled)')[0]?.body ?? '', 'background-color')).toBe('var(--stone)');
    expect(decl(rulesOf('.btn.primary:active:not(:disabled)')[0]?.body ?? '', 'background')).toBe('var(--stone)');
    // La mise à jour garde son plein : le voile de 0,4 du désactivé ne tombe pas sur elle en une image.
    expect(decl(rulesOf('button:disabled')[0]?.body ?? '', 'opacity')).toBe('0.4');
    expect(decl(rulesOf('.frame.leaving .btn.update:disabled')[0]?.body ?? '', 'opacity')).toBe('1');
    // Hors du départ, le désactivé d'une mise à jour qui s'applique ne change pas.
    const applying = rulesOf('.btn.primary:disabled')[0]?.body ?? '';
    expect([decl(applying, 'background'), decl(applying, 'color'), decl(applying, 'box-shadow')]).toEqual(['transparent', 'var(--text-2)', 'inset 0 0 0 1px var(--line-2)']);

    // Au clic, les deux boutons sont bien désactivés sous le cadre qui part : les règles du départ les tiennent.
    vi.useFakeTimers({ toFake: [...FAKE] });
    const frame = boot({ available: true });
    await vi.advanceTimersByTimeAsync(Math.round(phase('--t-rest') * 1000) + 100);
    const launch = byId<HTMLButtonElement>('btn-launch');
    const update = byId<HTMLButtonElement>('btn-update');
    expect([launch.disabled, update.hidden, update.disabled]).toEqual([false, false, false]);
    launch.click();
    expect(frame.classList.contains('leaving')).toBe(true);
    expect(launch.matches('.frame.leaving .btn.primary:disabled')).toBe(true);
    expect(update.matches('.frame.leaving .btn.update:disabled')).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(startDesk).toHaveBeenCalledTimes(1);
  });
});
