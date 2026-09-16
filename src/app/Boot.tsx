import { useEffect, useRef, useState } from 'react';
import { InvertedTab, Sigil } from '@/design/primitives';
import { Wordmark } from '@/design/Wordmark';
import s from './boot.module.css';

export interface BootStep {
  id: string;
  label: string;
  status: 'pending' | 'ok' | 'warn' | 'off';
  detail?: string;
}

const MIN_DURATION_MS = 1500;
const MIN_FROM_LAUNCHER_MS = 2100;
const LEAVE_MS = 480;

function fromLauncherHash(): boolean {
  if (typeof window === 'undefined') return false;
  const hit = /from-launcher/i.test(window.location.hash);
  if (hit) {
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}`);
  }
  return hit;
}

export function Boot({ steps, ready, onFinished }: { steps: BootStep[]; ready: boolean; onFinished: () => void }) {
  const [startedAt] = useState(() => Date.now());
  const [fromLauncher] = useState(fromLauncherHash);
  const [leaving, setLeaving] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const nanoRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const t = setInterval(() => setVisibleCount((c) => Math.min(steps.length, c + 1)), 120);
    return () => clearInterval(t);
  }, [steps.length]);

  // Nano-circuit pixels (continuité visuelle avec le lanceur).
  useEffect(() => {
    const canvas = nanoRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const cells: { x: number; y: number; led: boolean; t: number }[] = [];
    const step = 10;
    for (let y = 48; y < window.innerHeight - 48; y += step) {
      for (let x = 48; x < window.innerWidth - 48; x += step) {
        const onCross = x % 80 < 2 || y % 80 < 2;
        if (onCross || Math.random() < 0.04) cells.push({ x, y, led: Math.random() < 0.1, t: Math.random() * 0.85 });
      }
    }
    const t0 = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const p = Math.min(1, (now - t0) / (fromLauncher ? 1600 : 1100));
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const c of cells) {
        if (c.t > p) continue;
        ctx.fillStyle = c.led ? 'rgba(196,30,58,0.75)' : 'rgba(255,255,255,0.22)';
        ctx.fillRect(c.x, c.y, 1, 1);
      }
      if (p < 1) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [fromLauncher]);

  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const min = fromLauncher ? MIN_FROM_LAUNCHER_MS : MIN_DURATION_MS;
    const remaining = skipped ? 0 : Math.max(0, min - (Date.now() - startedAt));
    const t1 = setTimeout(() => setLeaving(true), remaining);
    const t2 = setTimeout(onFinished, remaining + LEAVE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [ready, skipped, startedAt, onFinished, fromLauncher]);

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
    <div className={`${s.boot} ${fromLauncher ? s.fromLauncher : ''} ${leaving ? s.leaving : ''}`}>
      <canvas ref={nanoRef} className={s.nano} aria-hidden />
      <svg className={s.circuit} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <rect className={s.inset} x="3" y="4" width="94" height="92" pathLength={1} />
        <rect className={s.inset} x="6" y="8" width="88" height="84" pathLength={1} />
        <path className={s.trace} pathLength={1} d="M0 28 H50" />
        <path className={s.trace} pathLength={1} d="M100 28 H50" />
        <path className={s.trace} pathLength={1} d="M0 50 H50" />
        <path className={s.trace} pathLength={1} d="M100 50 H50" />
        <path className={s.trace} pathLength={1} d="M0 72 H50" />
        <path className={s.trace} pathLength={1} d="M100 72 H50" />
        <path className={s.traceV} pathLength={1} d="M32 0 V100" />
        <path className={s.traceV} pathLength={1} d="M68 0 V100" />
        <path className={s.traceLed} pathLength={1} d="M50 12 V88" />
        <path className={s.traceLed} pathLength={1} d="M18 50 H82" />
      </svg>
      <div className={s.beams} aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className={s.center}>
        <Wordmark width={420} animated />
        <Sigil size={11} className={s.sigil} engraved />
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
          <InvertedTab>CΛNTO · Artefact 002</InvertedTab>
          <span>Design Unit · SIΞRRΛSKΛ Lab · Rev. A</span>
          <span className={ready ? s.granted : undefined}>{ready ? 'Accès accordé' : fromLauncher ? 'Circuit engagé' : 'Initialisation'}</span>
        </div>
      </div>
    </div>
  );
}
