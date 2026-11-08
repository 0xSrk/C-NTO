import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Une surcouche sort comme elle est entrée (POL2.2) : fermée, elle reste montée le temps de l'animation que sa feuille pose
 * sur `[data-leaving]`, inerte et sans pointeur, puis se démonte. Sans animation en cours (mouvement réduit, jsdom sans
 * `getAnimations`), elle se démonte dans la même passe, comme avant. Rouverte pendant sa sortie, elle renaît : `generation`
 * va en `key`, et l'entrée rejoue.
 */
export function usePresence<T extends HTMLElement>(open: boolean): { mounted: boolean; leaving: boolean; ref: RefObject<T | null>; generation: number } {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState({ open, kept: false, generation: 0 });
  if (seen.open !== open) setSeen({ open, kept: !open, generation: open ? seen.generation + 1 : seen.generation });
  const leaving = !open && seen.kept;
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
