import positive from './seal/seal-positive.svg?raw';
import negative from './seal/seal-negative.svg?raw';

/**
 * Sceau Horizon de SIΞRRΛSKΛ Lab, vectorisé (Ligne V2, révision A ; masters dans `src/design/seal/`).
 * Quatre groupes — anneaux, horizon, filaments, inscription — à la couleur du texte (`currentColor`).
 * Positif sur papier, négatif sur la nuit : seul l'horizon change. Il frappe au démarrage, ferme le
 * verrou et signe, gravé, le pied du rail ; il ne décore aucun module (Système 4.1, `docs/DESIGN.md` § 07).
 */
export type SealKind = 'positive' | 'negative';

const PARTS = ['rings', 'horizon', 'filaments', 'inscription'] as const;
type Part = (typeof PARTS)[number];
export interface SealShape {
  d: string;
  evenOdd: boolean;
}
type Shape = SealShape;

/** Fraction de la hauteur où passe l'horizon (y = −12,8 dans la boîte −370 → 370). */
export const SEAL_HORIZON = (370 - 12.8) / 740;
export const SEAL_VIEWBOX = '-404 -370 808 740';

function parse(svg: string): Record<Part, Shape[]> {
  const out = {} as Record<Part, Shape[]>;
  for (const part of PARTS) {
    const group = new RegExp(`<g id="${part}"[^>]*>([\\s\\S]*?)</g>`).exec(svg)?.[1] ?? '';
    out[part] = [...group.matchAll(/<path ([^>]*?)\/?>/g)].map((m) => ({
      d: /\bd="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? '',
      evenOdd: /fill-rule="evenodd"/.test(m[1] ?? ''),
    }));
  }
  return out;
}

const SHAPES: Record<SealKind, Record<Part, Shape[]>> = { positive: parse(positive), negative: parse(negative) };

/** Les tracés du master, groupe par groupe : l'ouverture du verrou les rallume par-dessus le sceau (`src/app/unlockCircuit.ts`). */
export function sealShapes(kind: SealKind): Readonly<Record<Part, readonly SealShape[]>> {
  return SHAPES[kind];
}

export function Seal({ kind = 'negative', className, label }: { kind?: SealKind; className?: string; label?: string }) {
  const shapes = SHAPES[kind];
  return (
    <svg className={className} viewBox={SEAL_VIEWBOX} fill="currentColor" focusable="false" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      {PARTS.map((part) => (
        <g key={part} data-part={part}>
          {shapes[part].map((shape, i) => (
            <path key={i} d={shape.d} fillRule={shape.evenOdd ? 'evenodd' : undefined} />
          ))}
        </g>
      ))}
    </svg>
  );
}
