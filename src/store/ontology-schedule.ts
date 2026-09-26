/** Recalcul différé des liens. Le runner est enregistré par `useLinks` ; sans lui, l'appel ne fait rien. */
export const ONTOLOGY_DEBOUNCE_MS = 500;

let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let runner: (() => void) | null = null;

export function registerOntologyRunner(fn: () => void): void {
  runner = fn;
}

export function currentOntologyGeneration(): number {
  return generation;
}

export function scheduleOntologyRecompute(): void {
  generation += 1;
  const scheduled = generation;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (scheduled !== generation) return;
    runner?.();
  }, ONTOLOGY_DEBOUNCE_MS);
  const handle = timer as unknown as { unref?: () => void };
  handle.unref?.();
}
