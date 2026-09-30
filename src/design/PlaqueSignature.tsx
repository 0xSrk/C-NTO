import s from './plaqueSignature.module.css';

/**
 * Plaque signature du Lab, gravée en bas du rail (3.2.2 : format nano, 40 px).
 * Même format que les plaques du desk (Système 3.4, D.01 sans vis ni languette),
 * en laque noire, ivoire et or gravés finement : lettres au burin, repères de calage
 * et une ligne de micro-texte, comme une épreuve de lithographie.
 * Une seule image nommée pour les lecteurs d'écran ; tout le reste est décoratif.
 */

export interface PlaqueSignatureProps {
  /** Numéro d'artefact gravé sous le nom du Lab. */
  artefact?: string;
  className?: string;
}

const LAB = 'SIΞRRΛSKΛ';

export function PlaqueSignature({ artefact = '002', className }: PlaqueSignatureProps) {
  const micro = `${LAB} · ARTEFACT ${artefact} · SRK—LAB · `;
  return (
    <div className={className ? `${s.plaque} ${className}` : s.plaque} role="img" aria-label={`${LAB} — Artefact ${artefact}`}>
      <span className={s.nom} aria-hidden>
        {LAB}
      </span>
      <span className={s.art} aria-hidden>
        ARTEFACT <b>{artefact}</b>
      </span>
      <span className={s.micro} aria-hidden>
        {micro.repeat(4)}
      </span>
    </div>
  );
}
