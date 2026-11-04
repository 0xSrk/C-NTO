import { useCallback, useState } from 'react';

/**
 * La lecture liée d'un instrument de la fiche (OROS5.26, décision 2) : survoler un nœud de M.016 allume sa ligne, et la
 * ligne son nœud. Un seul crochet, celui-ci, pose les écouteurs du pointeur dans `src/app/objects` : il ne pose que
 * `data-lit` sur ce qui est lié, rien d'autre. Les règles de `[data-lit]` vivent sous `@media (hover: hover)` et ne
 * changent que la lumière (tests/design-guard.test.ts). Là où le pointeur ne survole pas (un écran tactile), rien ne
 * s'allume : le toucher ouvre, il ne survole pas.
 */

/** La clé d'un objet lié (`type:id`), ou d'un nœud replié ; `null` : rien d'allumé. */
export type LightKey = string | null;

/** Ce que le crochet pose sur un élément lié : `data-lit` quand il est allumé, et les deux écouteurs du pointeur. */
export interface LightProps {
  'data-lit'?: '';
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/** Le pointeur survole vraiment (`hover: hover`) : sans cela, aucune lumière ne se pose. */
export function canHover(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches;
}

export interface HoverLight {
  /** La clé allumée. */
  lit: LightKey;
  /** Les props d'un élément lié à `key` : la même clé, posée sur le nœud et sur sa ligne, les allume ensemble. */
  light: (key: string) => LightProps;
}

export function useHoverLight(): HoverLight {
  const [lit, setLit] = useState<LightKey>(null);
  const light = useCallback(
    (key: string): LightProps => ({
      ...(lit === key ? { 'data-lit': '' as const } : {}),
      onMouseEnter: () => {
        if (canHover()) setLit(key);
      },
      onMouseLeave: () => setLit((current) => (current === key ? null : current)),
    }),
    [lit],
  );
  return { lit, light };
}
