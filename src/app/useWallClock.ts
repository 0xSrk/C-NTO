import { useEffect, useState } from 'react';

/** Le délai jusqu'à la prochaine frontière de `stepMs` sur l'horloge murale. */
export function msToNextBoundary(nowMs: number, stepMs: number): number {
  return stepMs - (nowMs % stepMs);
}

/**
 * L'instant, rendu à chaque frontière de `stepMs` de l'horloge murale, et à elle seule : une horloge qui dit la minute ne
 * re-rend plus ce qui l'entoure chaque seconde. Le minuteur attend au plus une seconde : une veille du poste, où les
 * minuteurs s'arrêtent, ou une horloge recalée se rattrapent en une seconde, comme avec un battement d'une seconde.
 */
export function useWallClock(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let shown = Math.floor(Date.now() / stepMs);
    let id: ReturnType<typeof setTimeout>;
    const arm = () => {
      id = setTimeout(() => {
        const t = Date.now();
        const bucket = Math.floor(t / stepMs);
        if (bucket !== shown) {
          shown = bucket;
          setNow(t);
        }
        arm();
      }, Math.min(1_000, msToNextBoundary(Date.now(), stepMs) + 1));
    };
    arm();
    return () => clearTimeout(id);
  }, [stepMs]);
  return now;
}

/** Un rendu par seconde tant que `active`, aucun sinon : pour ce qui compte vraiment les secondes (un âge, un délai). */
export function useSecondWhile(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [active]);
}
