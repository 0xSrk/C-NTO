/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Boot, type BootStep } from '@/app/Boot';
import { cssRules } from './helpers/cssRules';

// La phrase du verrou : une doublure, seule « la phrase » ouvre (tests/gate-lock.test.ts).
vi.mock('@/engine/gate', () => ({ opens: vi.fn(async (phrase: string) => phrase === 'la phrase') }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(node: ReturnType<typeof createElement>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('POL5 cérémonies : démarrage, verrou et ouverture, geste du siège, logotype', () => {
  it('POL5.1 la couture du démarrage s’ouvre sur le verrou déjà monté, non sur le vide ; une phrase admise pendant l’écartement monte le desk dessous aussitôt', async () => {
    // Le démarrage, le verrou et le châssis en doublures : seul compte ce que l'App monte, et quand.
    const boot = { props: null as null | { onReveal?: () => void; onFinished: () => void } };
    const gate = { props: null as null | { onAdmit: () => void } };
    vi.resetModules();
    vi.doMock('@/app/Boot', () => ({
      Boot: (props: { onReveal?: () => void; onFinished: () => void }) => {
        boot.props = props;
        return createElement('div', { 'data-stub': 'boot' });
      },
    }));
    vi.doMock('@/app/Gate', () => ({
      Gate: (props: { onAdmit: () => void }) => {
        gate.props = props;
        return createElement('div', { 'data-stub': 'gate' });
      },
    }));
    vi.doMock('@/app/Shell', () => ({ Shell: () => createElement('div', { 'data-stub': 'shell' }) }));
    const part = (el: HTMLElement, name: string) => el.querySelector(`[data-stub="${name}"]`);
    try {
      const { App } = await import('@/app/App');
      // Le chemin courant : la phrase vient après le démarrage.
      let el = render(createElement(App));
      expect(part(el, 'boot')).not.toBeNull();
      expect(part(el, 'gate')).toBeNull();
      // l'écartement commence : le démarrage est encore là, le verrou déjà dessous
      act(() => boot.props!.onReveal!());
      expect(part(el, 'boot')).not.toBeNull();
      expect(part(el, 'gate')).not.toBeNull();
      expect(part(el, 'shell')).toBeNull();
      // le démarrage parti, le même verrou reste, seul
      const first = part(el, 'gate');
      act(() => boot.props!.onFinished());
      expect(part(el, 'boot')).toBeNull();
      expect(part(el, 'gate')).toBe(first);
      expect(part(el, 'shell')).toBeNull();
      // la phrase admise : le desk se monte dessous
      act(() => gate.props!.onAdmit());
      expect(part(el, 'shell')).not.toBeNull();
      act(() => root?.unmount());
      host?.remove();

      // La phrase collée et admise pendant l'écartement (Ctrl+V puis Entrée au lancement) : le desk se monte dessous
      // aussitôt, sous le démarrage et le verrou, avant que les glyphes ne partent, et reste le même à la fin du démarrage.
      el = render(createElement(App));
      act(() => boot.props!.onReveal!());
      act(() => gate.props!.onAdmit());
      expect(part(el, 'boot')).not.toBeNull();
      const desk = part(el, 'shell');
      expect(desk, 'desk monté à l’admission, le démarrage encore là').not.toBeNull();
      act(() => boot.props!.onFinished());
      expect(part(el, 'boot')).toBeNull();
      expect(part(el, 'shell')).toBe(desk);
      act(() => root?.unmount());
      host?.remove();

      // Le même chemin avec le vrai verrou : il a le focus dès l'écartement, et la phrase soumise y monte le desk.
      vi.doUnmock('@/app/Gate');
      vi.resetModules();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      const { App: RealGateApp } = await import('@/app/App');
      el = render(createElement(RealGateApp));
      act(() => boot.props!.onReveal!());
      const input = el.querySelector<HTMLInputElement>('input[type="password"]')!;
      expect(document.activeElement).toBe(input);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'la phrase');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        el.querySelector<HTMLFormElement>('form')!.requestSubmit();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(el.querySelector('[data-part="unlock-glyphs"]')).not.toBeNull();
      expect(part(el, 'boot')).not.toBeNull();
      expect(part(el, 'shell'), 'desk monté sous le démarrage à l’admission').not.toBeNull();
    } finally {
      vi.doUnmock('@/app/Boot');
      vi.doUnmock('@/app/Gate');
      vi.doUnmock('@/app/Shell');
      vi.resetModules();
    }
    // Tant que le démarrage s'écarte, il garde le pointeur : un clic ne traverse pas jusqu'au verrou qu'il couvre encore.
    const leaving = cssRules(readFileSync('src/app/boot.module.css', 'utf8')).filter((rule) => rule.selector.split(/,\s*/).some((sel) => /\.leaving\b/.test(sel) && !/\s/.test(sel.trim())));
    expect(leaving.map((rule) => rule.selector)).toContain('.boot.leaving');
    for (const rule of leaving) expect(rule.body, rule.selector).not.toMatch(/pointer-events:\s*none/);
  });

  it('POL5.2 la console du démarrage garde sa hauteur finale dès le premier pas : le logotype ne saute plus pendant qu’il se trace', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
    const steps: BootStep[] = ['core', 'vault', 'engine', 'calendar', 'notes', 'agent', 'bridge'].map((id) => ({ id, label: `étape ${id}`, status: 'ok', detail: 'détail' }));
    const el = render(createElement(Boot, { steps, ready: false, onFinished: () => undefined }));
    const log = el.querySelector<HTMLElement>('[class*="_log_"]')!;
    expect(log).not.toBeNull();
    for (let shown = 0; shown <= steps.length; shown++) {
      // autant de lignes que d'étapes, dès le premier pas : celles à venir gardent leur place, invisibles et muettes
      expect(log.children, `pas ${shown}`).toHaveLength(steps.length);
      const lines = [...log.children] as HTMLElement[];
      const waiting = lines.filter((line) => line.getAttribute('aria-hidden') === 'true');
      const visible = lines.filter((line) => line.getAttribute('aria-hidden') !== 'true');
      expect(waiting.every((line) => /_slot_/.test(line.className))).toBe(true);
      expect(visible.some((line) => /_slot_/.test(line.className))).toBe(false);
      // les lignes parues, dans l'ordre, sous celles à venir ; leur numéro reste celui de l'étape
      expect(visible.map((line) => line.textContent)).toEqual(steps.slice(0, shown).map((st, i) => `${String(i + 1).padStart(2, '0')}étape ${st.id}OK · détail`));
      expect(lines.slice(steps.length - shown)).toEqual(visible);
      act(() => vi.advanceTimersByTime(120));
    }
    // à la fin, le même DOM qu'avant : sept lignes parues, plus aucune réserve
    expect(log.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    const css = cssRules(readFileSync('src/app/boot.module.css', 'utf8'));
    const slot = css.find((rule) => rule.selector === '.slot');
    expect(slot?.body).toMatch(/visibility: hidden;/);
    expect(slot?.body).toMatch(/animation: none;/);
    // la réserve ne change ni taille ni marge : la console garde sa hauteur minimale d'avant
    expect(css.find((rule) => rule.selector === '.log')?.body).toMatch(/min-height: 136px;/);
    expect(css.findIndex((rule) => rule.selector === '.slot')).toBeGreaterThan(css.findIndex((rule) => rule.selector === '.line'));
  });

  it('POL5.3 la ligne de l’écran ne saute pas à sa pleine lumière au pli : l’étape qui l’efface garde les transitions qui l’éclairent', () => {
    const css = cssRules(readFileSync('src/app/gate.module.css', 'utf8'));
    /** Les propriétés qu'une liste de transitions anime (les virgules des fonctions ne séparent rien). */
    const listed = (body: string) => {
      const value = /(?:^|;)\s*transition:\s*([^;]+)/.exec(body)?.[1] ?? '';
      const flat = value.replace(/\([^()]*\)/g, (m) => m.replace(/,/g, ' '));
      return new Set(flat.split(',').map((layer) => layer.trim().split(/\s+/)[0]!).filter(Boolean));
    };
    const rules = css.filter((rule) => /(^|\s)\.horizon$/.test(rule.selector) && !/reduced/.test(rule.selector));
    const own = rules.find((rule) => rule.selector === '.horizon')!;
    const lit = [...listed(own.body)].sort();
    expect(lit).toEqual(['background-color', 'box-shadow']);
    // une transition en cours dont la propriété sort de la liste est annulée et saute à sa fin : chaque étape qui règle la
    // ligne garde donc la lumière en cours, avec ses durées et son délai
    for (const rule of rules.filter((r) => /transition:/.test(r.body))) for (const prop of lit) expect(listed(rule.body), `${rule.selector} : ${prop}`).toContain(prop);
    const spreading = rules.find((rule) => rule.selector === '.spreading .horizon')!;
    expect(spreading.body).toMatch(/opacity 0\.3s linear/);
    expect(spreading.body).toMatch(/background-color 0\.42s linear var\(--fold-at, 0\.34s\)/);
    expect(spreading.body).toMatch(/box-shadow 0\.5s linear var\(--fold-at, 0\.34s\)/);
    // l'éclairage lui-même ne change pas : la ligne monte à 42 %, son halo à 16 %
    const gliding = rules.find((rule) => rule.selector === '.gliding .horizon')!;
    expect(gliding.body).toMatch(/background-color: color-mix\(in srgb, var\(--text-0\) 42%, transparent\);/);
    expect(gliding.body).toMatch(/box-shadow: 0 0 12px color-mix\(in srgb, var\(--text-0\) 16%, transparent\);/);
    // en mouvement réduit, la ligne ne transite toujours pas
    expect(css.find((rule) => rule.selector.split(/,\s*/).includes('.reduced .horizon'))?.body).toMatch(/transition: none;/);
  });
});
