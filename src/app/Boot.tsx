import { useEffect, useState } from 'react';
import { Sigil } from '@/design/primitives';
import { Wordmark } from '@/design/Wordmark';
import s from './boot.module.css';

export interface BootStep {
  id: string;
  label: string;
  status: 'pending' | 'ok' | 'warn' | 'off';
  detail?: string;
}

const MIN_DURATION_MS = 1500;
const LEAVE_MS = 420;

export function Boot({ steps, ready, onFinished }: { steps: BootStep[]; ready: boolean; onFinished: () => void }) {
  const [startedAt] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setVisibleCount((c) => Math.min(steps.length, c + 1)), 120);
    return () => clearInterval(t);
  }, [steps.length]);

  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const remaining = skipped ? 0 : Math.max(0, MIN_DURATION_MS - (Date.now() - startedAt));
    const t1 = setTimeout(() => setLeaving(true), remaining);
    const t2 = setTimeout(onFinished, remaining + LEAVE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [ready, skipped, startedAt, onFinished]);

  // Un clic ou une touche écourte l'attente dès que le desk est prêt.
  useEffect(() => {
    const skip = () => setSkipped(true);
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, []);

  const completed = steps.filter((st) => st.status !== 'pending').length;
  const progress = steps.length ? completed / steps.length : 0;

  return (
    <div className={`${s.boot} ${leaving ? s.leaving : ''}`}>
      <div className={s.beams} aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className={s.center}>
        <Wordmark width={420} animated />
        <Sigil size={11} className={s.sigil} />
      </div>
      <div className={s.console}>
        <div className={s.log}>
          {steps.slice(0, visibleCount).map((st) => (
            <div key={st.id} className={`${s.line} ${s[st.status]}`}>
              <span className={s.lineLabel}>{st.label}</span>
              <span className={s.lineDots} />
              <span className={s.lineStatus}>
                {st.status === 'pending' ? '…' : st.status === 'ok' ? 'OK' : st.status === 'warn' ? 'ATTENTION' : 'VEILLE'}
                {st.detail ? ` · ${st.detail}` : ''}
              </span>
            </div>
          ))}
        </div>
        <div className={s.bar}>
          <span style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
        <div className={s.footer}>
          <span>ARTEFACT CΛNTO · PROTOTYPE 0.1</span>
          <span>{ready ? 'ACCÈS ACCORDÉ' : 'INITIALISATION'}</span>
        </div>
      </div>
    </div>
  );
}
