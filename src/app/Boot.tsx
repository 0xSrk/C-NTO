import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { tr, useI18n } from '@/i18n';
import { InvertedTab, Sigil } from '@/design/primitives';
import { Wordmark } from '@/design/Wordmark';
import { runBootCircuit } from './bootCircuit';
import s from './boot.module.css';

export interface BootStep {
  id: string;
  label: string;
  status: 'pending' | 'ok' | 'warn' | 'off';
  detail?: string;
}

const MIN_DURATION_MS = 1700;
const MIN_FROM_LAUNCHER_MS = 2300;
/** Durée de l'ouverture sur l'axe (couture → écartement), alignée sur boot.module.css. */
const LEAVE_MS = 760;
const WORDMARK_W = 420;

function fromLauncherHash(): boolean {
  if (typeof window === 'undefined') return false;
  const hit = /from-launcher/i.test(window.location.hash);
  if (hit) {
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}`);
  }
  return hit;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Boot({ steps, ready, onReveal, onFinished }: { steps: BootStep[]; ready: boolean; onReveal?: () => void; onFinished: () => void }) {
  useI18n((s) => s.locale);
  const [startedAt] = useState(() => Date.now());
  const [fromLauncher] = useState(fromLauncherHash);
  const [reduced] = useState(prefersReducedMotion);
  const [leaving, setLeaving] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [axis, setAxis] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const nanoRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const t = setInterval(() => setVisibleCount((c) => Math.min(steps.length, c + 1)), 120);
    return () => clearInterval(t);
  }, [steps.length]);

  // Circuit canvas : reprend la LED du lanceur au centre du logotype et rallume la fenêtre.
  useEffect(() => {
    const canvas = nanoRef.current;
    if (!canvas) return;
    return runBootCircuit(canvas, {
      reduced,
      anchor: () => markRef.current?.querySelector('svg')?.getBoundingClientRect() ?? null,
      enclose: () => markRef.current?.getBoundingClientRect() ?? null,
      floor: () => (consoleRef.current?.getBoundingClientRect().top ?? window.innerHeight - 240) - 32,
      onTick: (t) => {
        if (clockRef.current) clockRef.current.textContent = `T+${(t / 1000).toFixed(3)}`;
      },
    });
  }, [reduced]);

  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const min = fromLauncher ? MIN_FROM_LAUNCHER_MS : MIN_DURATION_MS;
    const remaining = skipped ? 0 : Math.max(0, min - (Date.now() - startedAt));
    const t1 = setTimeout(() => {
      // Axe du logotype en % de l'écran : indépendant de tout zoom CSS.
      const box = markRef.current?.querySelector('svg')?.getBoundingClientRect();
      const root = rootRef.current?.getBoundingClientRect();
      if (box && root && root.height > 0) setAxis(((box.top + box.height / 2 - root.top) / root.height) * 100);
      setLeaving(true);
      onReveal?.();
    }, remaining);
    const t2 = setTimeout(onFinished, remaining + (reduced ? 240 : LEAVE_MS));
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [ready, skipped, startedAt, onFinished, onReveal, fromLauncher, reduced]);

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
  const statusWord = ready
    ? tr('Accès accordé', 'Access granted', 'Acceso concedido')
    : fromLauncher
      ? tr('Circuit engagé', 'Circuit engaged', 'Circuito en marcha')
      : tr('Initialisation', 'Initializing', 'Inicialización');

  return (
    <div
      ref={rootRef}
      className={`${s.boot} ${fromLauncher ? s.fromLauncher : ''} ${leaving ? s.leaving : ''} ${reduced ? s.reduced : ''}`}
      style={axis !== null ? ({ '--axis': `${axis.toFixed(3)}%` } as CSSProperties) : undefined}
    >
      <canvas ref={nanoRef} className={s.nano} aria-hidden />

      <div className={s.hud} aria-hidden>
        <span>
          CΛNTO <i className={s.led}>/</i> 002 · BOOT
        </span>
        <b ref={clockRef}>T+0.000</b>
      </div>

      <div className={s.center} ref={markRef}>
        <Wordmark width={WORDMARK_W} animated delay={fromLauncher ? 0.22 : 0.12} />
        <Sigil size={11} className={s.sigil} engraved />
      </div>

      <div className={s.console} ref={consoleRef}>
        <div className={s.log}>
          {steps.slice(0, visibleCount).map((st, i) => (
            <div key={st.id} className={`${s.line} ${s[st.status]}`}>
              <span className={s.lineIndex}>{String(i + 1).padStart(2, '0')}</span>
              <span className={s.lineLabel}>{st.label}</span>
              <span className={s.lineDots} />
              <span className={s.lineStatus}>
                <i className={s.lineMark} />
                {st.status === 'pending' ? '…' : st.status === 'ok' ? 'OK' : st.status === 'warn' ? tr('ATTENTION', 'WARNING', 'ATENCIÓN') : tr('VEILLE', 'IDLE', 'ESPERA')}
                {st.detail ? ` · ${st.detail}` : ''}
              </span>
            </div>
          ))}
        </div>
        <div className={`${s.bar} ${ready ? s.barDone : ''}`} style={{ '--steps': steps.length } as CSSProperties}>
          <span style={{ width: `${Math.max(2, progress * 100)}%` }} />
        </div>
        <div className={s.footer}>
          <InvertedTab>CΛNTO · Artefact 002</InvertedTab>
          <span>Design Unit · SIΞRRΛSKΛ Lab · Rev. B</span>
          <span className={ready ? s.granted : undefined}>
            <i className={s.grantDot} />
            {statusWord}
          </span>
        </div>
      </div>

      <div className={s.seam} aria-hidden>
        <i />
        <i />
      </div>
    </div>
  );
}
