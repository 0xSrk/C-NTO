import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** L'opacité où en est une surcouche, si elle est en chemin (ni 0 ni 1) ; sinon rien. */
export function opacityInFlight(el: Element | null): number | null {
  if (!el || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return null;
  const value = Number.parseFloat(window.getComputedStyle(el).opacity);
  return Number.isFinite(value) && value > 0 && value < 1 ? Math.round(value * 1000) / 1000 : null;
}

/**
 * Une surcouche sort comme elle est entrée (POL2.2) : fermée, elle reste montée le temps de l'animation que sa feuille pose
 * sur `[data-leaving]`, inerte et sans pointeur, puis se démonte. Sans animation en cours (mouvement réduit, jsdom sans
 * `getAnimations`), elle se démonte dans la même passe, comme avant. Rouverte pendant sa sortie, elle renaît : `generation`
 * va en `key`, et l'entrée rejoue. Fermée ou rouverte en chemin, elle part de l'opacité où elle en est, jamais d'un bond :
 * `--leave-from` et `--enter-from`, que sa feuille lit, sur la part de chemin qui reste (POL2.2a).
 */
export function usePresence<T extends HTMLElement>(open: boolean): { mounted: boolean; leaving: boolean; ref: RefObject<T | null>; generation: number } {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState({ open, kept: false, generation: 0 });
  const from = useRef<{ leave: number | null; enter: number | null }>({ leave: null, enter: null });
  if (seen.open !== open) {
    // Au geste, le nœud porte encore l'image d'avant : l'opacité de son entrée, ou de sa sortie, à cet instant.
    const at = opacityInFlight(ref.current);
    from.current = open ? { leave: null, enter: seen.kept ? at : null } : { leave: at, enter: null };
    setSeen({ open, kept: !open, generation: open ? seen.generation + 1 : seen.generation });
  }
  const leaving = !open && seen.kept;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { leave, enter } = from.current;
    if (leaving && leave !== null) el.style.setProperty('--leave-from', String(leave));
    else el.style.removeProperty('--leave-from');
    if (!leaving && enter !== null) el.style.setProperty('--enter-from', String(enter));
    else el.style.removeProperty('--enter-from');
  }, [leaving, seen.generation]);
  useLayoutEffect(() => {
    if (!leaving) return;
    let live = true;
    const done = () => {
      if (live) setSeen((current) => (current.open ? current : { ...current, kept: false }));
    };
    const running = ref.current?.getAnimations?.().filter((animation) => animation.playState === 'running') ?? [];
    if (running.length === 0) done();
    else void Promise.all(running.map((animation) => animation.finished)).then(done, done);
    return () => {
      live = false;
    };
  }, [leaving]);
  return { mounted: open || leaving, leaving, ref, generation: seen.generation };
}
