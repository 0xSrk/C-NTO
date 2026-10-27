import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Button } from '@/design/primitives';
import { Glyph } from '@/design/Micro';
import { Seal, SEAL_HORIZON } from '@/design/Seal';
import { opens } from '@/engine/gate';
import { tr, useI18n } from '@/i18n';
import { desk } from '@/lib/desk';
import { SEAL_DRAW_S, SEAL_FOLD_AT_S, SEAL_FOLD_S, SEAL_GLIDE_S, WORD_AT_S, sealFormMs } from './unlockMark';
import s from './gate.module.css';

/** Durée de l'ouverture sur l'axe, la même que le boot. */
const LEAVE_MS = 760;
/** L'horizon du sceau (48,27 % de sa hauteur) se pose sur la ligne de l'écran. */
const SEAL_HZ = `${(SEAL_HORIZON * 100).toFixed(2)}%`;
/** Les temps de l'ouverture, posés une fois ici et lus par la feuille. */
const TIMING = {
  '--glide-s': `${SEAL_GLIDE_S}s`,
  '--fold-at': `${SEAL_FOLD_AT_S}s`,
  '--fold-s': `${SEAL_FOLD_S}s`,
  '--word-at': `${WORD_AT_S}s`,
  '--draw': `${SEAL_DRAW_S}s`,
} as CSSProperties;

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function UnlockMark({ active }: { active: boolean }) {
  return (
    <p className={active ? s.live : undefined} role="img" aria-label="Desk Unlocked">
      DESK UNLOCKED
    </p>
  );
}

/**
 * Le verrou (4.1) : le sceau du Lab, et une fiche d'accès plus large — la phrase, « Coller » pour qui navigue à la
 * souris, « Fermer CΛNTO » pour qui n'a pas la phrase, « Ouvrir ». L'ouverture part du sceau : il glisse au centre,
 * se plie dans son horizon, le mot se lève de la ligne, puis la couture s'ouvre sur le desk déjà monté.
 */
export function Gate({ onAdmit, onReveal, onOpen }: { onAdmit: () => void; onReveal: () => void; onOpen: () => void }) {
  useI18n((st) => st.locale);
  const [value, setValue] = useState('');
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'locked' | 'forming' | 'opening'>('locked');
  const [reduced] = useState(prefersReducedMotion);
  const [axis, setAxis] = useState<number | null>(null);
  const [glide, setGlide] = useState(0);
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const sealRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef(phase);
  const admitRef = useRef(onAdmit);
  const revealRef = useRef(onReveal);
  const openRef = useRef(onOpen);
  phaseRef.current = phase;
  admitRef.current = onAdmit;
  revealRef.current = onReveal;
  openRef.current = onOpen;

  const live = phase !== 'locked';

  useEffect(() => {
    if (phase !== 'forming') return;
    admitRef.current();
    // Le sceau part de sa place vers le centre de l'écran. L'écart se mesure deux images après l'admission : le desk
    // monté dessous a posé son zoom (navigateur) ; il se convertit en pixels CSS, ceux du `translate`.
    let raf = 0;
    if (!reduced) {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          const seal = sealRef.current?.getBoundingClientRect();
          const root = rootRef.current?.getBoundingClientRect();
          const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
          if (seal && root && seal.width > 0) setGlide((root.left + root.width / 2 - (seal.left + seal.width / 2)) / zoom);
        });
      });
    }
    const wait = reduced ? 280 : sealFormMs();
    const t = window.setTimeout(() => {
      const box = markRef.current?.getBoundingClientRect();
      const root = rootRef.current?.getBoundingClientRect();
      if (box && root && root.height > 0) setAxis(((box.top + box.height / 2 - root.top) / root.height) * 100);
      setPhase('opening');
      revealRef.current();
    }, wait);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [phase, reduced]);

  useEffect(() => {
    if (phase !== 'opening') return;
    const t = window.setTimeout(() => openRef.current(), reduced ? 240 : LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [phase, reduced]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || phaseRef.current !== 'locked') return;
    setBusy(true);
    const phrase = value;
    const ok = await opens(phrase);
    setBusy(false);
    if (phaseRef.current !== 'locked') return;
    if (ok) {
      setValue('');
      setRefused(false);
      inputRef.current?.blur();
      setPhase('forming');
      return;
    }
    setRefused(true);
    setValue('');
    inputRef.current?.focus();
    const plate = plateRef.current;
    if (plate && !reduced) {
      plate.animate(
        [
          { translate: '0 0' },
          { translate: '-2px 0', offset: 0.2 },
          { translate: '2px 0', offset: 0.45 },
          { translate: '-1px 0', offset: 0.7 },
          { translate: '0 0' },
        ],
        { duration: 420, easing: 'linear' },
      );
    }
  };

  /**
   * « Coller » : la phrase du presse-papiers entre dans le champ comme par Ctrl+V. Dans le desk, le process principal
   * colle dans le champ qui a le focus (le renderer ne lit pas le presse-papiers) ; dans un navigateur, l'API du
   * presse-papiers, si la page y a droit. Sinon, le champ garde le focus pour Ctrl+V.
   */
  const paste = async () => {
    const input = inputRef.current;
    if (!input || phaseRef.current !== 'locked') return;
    input.focus();
    if (desk?.window.paste) {
      desk.window.paste();
      return;
    }
    try {
      const text = (await navigator.clipboard?.readText?.()) ?? '';
      const line = text.replace(/[\r\n]+/g, '');
      if (line) {
        setRefused(false);
        setValue(line);
      }
    } catch {
      /* presse-papiers refusé : Ctrl+V reste possible, le champ a le focus */
    }
  };

  const stateWord = refused ? tr('Refusé', 'Refused', 'Rechazado') : tr('Fermé', 'Closed', 'Cerrado');
  const lock = tr('VERROU', 'LOCK', 'CERROJO');

  return (
    <div
      ref={rootRef}
      className={[s.gate, phase === 'forming' && s.forming, phase === 'opening' && s.opening, reduced && s.reduced, refused && s.denied].filter(Boolean).join(' ')}
      style={{ ...TIMING, ...(axis !== null ? { '--axis': `${axis.toFixed(3)}%` } : null), '--glide': `${glide.toFixed(1)}px` } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
    >
      <div className={s.texture} aria-hidden />

      <div className={s.hud} aria-hidden>
        <span>
          CΛNTO <i className={s.slash}>/</i> 002 · {live ? 'UNLOCK' : lock}
        </span>
      </div>

      {/* La ligne d'horizon de l'écran : le sceau y pose le sien, s'y plie, la couture s'y ouvre. */}
      <span className={s.horizon} data-part="horizon-line" aria-hidden />

      <div className={s.stage}>
        {/* Le sceau ferme le verrou ; c'est de lui que part l'ouverture. */}
        <div className={s.sealbox}>
          <div ref={sealRef} className={s.sealw} data-part="seal" style={{ '--hz': SEAL_HZ } as CSSProperties}>
            <Seal kind="negative" className={s.sealSvg} />
          </div>
        </div>
        <div className={s.stack}>
          <h2 className={s.heading}>
            <span className={s.nm}>SIΞRRΛSKΛ LAB · ARTEFACT 002</span>
            <span id="gate-title">{tr('Desk verrouillé', 'Desk locked', 'Desk bloqueado')}</span>
          </h2>
          {/* Fiche d'accès (Ligne V2) : aucun code ici — le seul code du desk est au pied de la barre d'état. */}
          <form ref={plateRef} className={s.fiche} data-part="fiche" inert={live} onSubmit={(event) => void submit(event)}>
            <div className={s.fh}>
              <span>{tr('FICHE D’ACCÈS', 'ACCESS SHEET', 'FICHA DE ACCESO')}</span>
              <span>SK-ART-002 / {lock}</span>
            </div>
            <div className={s.fin}>
              <div className={s.fieldHead}>
                <label htmlFor={inputId} className={s.fieldLabel}>
                  {tr('Phrase', 'Phrase', 'Frase')}
                </label>
                <span className={s.stateLine}>
                  <i className={s.led} aria-hidden />
                  <span className={s.state} role="status">
                    {stateWord}
                  </span>
                </span>
              </div>
              <div className={s.inputRow}>
                <input
                  ref={inputRef}
                  id={inputId}
                  type="password"
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  aria-invalid={refused}
                  value={value}
                  onChange={(event) => {
                    setRefused(false);
                    setValue(event.target.value);
                  }}
                />
                {/* Le champ garde le focus : le clic ne le lui prend pas, le collage y entre. */}
                <button type="button" className={s.paste} data-part="paste" onMouseDown={(event) => event.preventDefault()} onClick={() => void paste()}>
                  {tr('Coller', 'Paste', 'Pegar')}
                </button>
              </div>
              <div className={s.row}>
                {desk ? (
                  <Button variant="ghost" data-part="close-canto" onClick={() => desk?.window.close()}>
                    {tr('Fermer CΛNTO', 'Close CΛNTO', 'Cerrar CΛNTO')}
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" variant="chamfer" disabled={busy || value.length === 0}>
                  {tr('Ouvrir', 'Open', 'Abrir')}
                  <Glyph name="arrowOpen" className={s.bi} />
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div className={s.unlock} ref={markRef} aria-hidden={!live}>
        <UnlockMark active={live} />
      </div>

      <div className={s.seam} aria-hidden>
        <i />
        <i />
      </div>
    </div>
  );
}
