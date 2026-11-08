/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
