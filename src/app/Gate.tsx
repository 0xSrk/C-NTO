import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Button, Field } from '@/design/primitives';
import { opens } from '@/engine/gate';
import { tr, useI18n } from '@/i18n';
import { runBootCircuit } from './bootCircuit';
import { SEAL_DRAW_S, sealFormMs } from './unlockMark';
import s from './gate.module.css';

/** Durée de l'ouverture sur l'axe, la même que le boot. */
const LEAVE_MS = 760;

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function UnlockMark({ active }: { active: boolean }) {
  return (
    <p className={active ? s.live : undefined} style={{ '--draw': `${SEAL_DRAW_S}s` } as CSSProperties} role="img" aria-label="Desk Unlocked">
      DESK UNLOCKED
    </p>
  );
}

export function Gate({ onAdmit, onReveal, onOpen }: { onAdmit: () => void; onReveal: () => void; onOpen: () => void }) {
  useI18n((st) => st.locale);
  const [value, setValue] = useState('');
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'locked' | 'forming' | 'opening'>('locked');
  const [reduced] = useState(prefersReducedMotion);
  const [axis, setAxis] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const nanoRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clockRef = useRef<HTMLElement>(null);
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
    if (!live) return;
    const canvas = nanoRef.current;
    if (!canvas) return;
    return runBootCircuit(canvas, {
      reduced,
      anchor: () => markRef.current?.querySelector('svg')?.getBoundingClientRect() ?? null,
      enclose: () => markRef.current?.getBoundingClientRect() ?? null,
      floor: () => window.innerHeight - 36,
      onTick: (t) => {
        if (clockRef.current) clockRef.current.textContent = `T+${(t / 1000).toFixed(3)}`;
      },
    });
  }, [live, reduced]);

  useEffect(() => {
    if (phase !== 'forming') return;
    admitRef.current();
    const wait = reduced ? 280 : sealFormMs();
    const t = window.setTimeout(() => {
      const box = markRef.current?.getBoundingClientRect();
      const root = rootRef.current?.getBoundingClientRect();
      if (box && root && root.height > 0) setAxis(((box.top + box.height / 2 - root.top) / root.height) * 100);
      setPhase('opening');
      revealRef.current();
    }, wait);
    return () => window.clearTimeout(t);
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

  const closed = tr('Fermé', 'Closed', 'Cerrado');
  const stateWord = refused ? tr('Refusé', 'Refused', 'Rechazado') : closed;

  return (
    <div
      ref={rootRef}
      className={[s.gate, phase === 'forming' && s.forming, phase === 'opening' && s.opening, reduced && s.reduced, refused && s.denied].filter(Boolean).join(' ')}
      style={axis !== null ? ({ '--axis': `${axis.toFixed(3)}%` } as CSSProperties) : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
    >
      <div className={s.texture} aria-hidden />
      <canvas ref={nanoRef} className={s.nano} aria-hidden />

      <div className={s.hud} aria-hidden>
        <span>
          CΛNTO <i className={s.slash}>/</i> 002 · {live ? 'UNLOCK' : 'LOCK'}
        </span>
        <b ref={clockRef} className={live ? s.granted : undefined}>
          {live ? 'T+0.000' : closed}
        </b>
      </div>

      <div className={s.stage}>
        <div className={s.stack}>
          <p className={s.sous}>
            SIΞRRΛSKΛ LAB
            <i aria-hidden />
            <b>ARTEFACT 002</b>
          </p>
          <div className={s.slot}>
            <form ref={plateRef} className={s.plate} inert={live} onSubmit={(event) => void submit(event)}>
              <span className={s.corners} aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </span>
              <div className={s.status}>
                <span className={s.index}>01</span>
                <span id="gate-title">{tr('Desk verrouillé', 'Desk locked', 'Desk bloqueado')}</span>
                <span className={s.dots} />
                <span className={s.state} role="status">
                  <i className={s.led} />
                  {stateWord}
                </span>
              </div>
              <Field label={tr('Phrase', 'Phrase', 'Frase')}>
                <input
                  ref={inputRef}
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
              </Field>
              <div className={s.row}>
                <Button type="submit" variant="solid" disabled={busy || value.length === 0}>
                  {tr('Ouvrir', 'Open', 'Abrir')}
                </Button>
              </div>
            </form>
            <div className={s.seal} ref={markRef} aria-hidden={!live}>
              <UnlockMark active={live} />
            </div>
          </div>
        </div>
      </div>

      <div className={s.seam} aria-hidden>
        <i />
        <i />
      </div>
    </div>
  );
}
