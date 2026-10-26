import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { tr, useI18n } from '@/i18n';
import { InvertedTab } from '@/design/primitives';
import { Plate } from '@/design/Micro';
import { Seal, SEAL_HORIZON } from '@/design/Seal';
import { CONSTRUCTION_END, Wordmark } from '@/design/Wordmark';
import { APP_VERSION } from '@/lib/version';
import s from './boot.module.css';

export interface BootStep {
  id: string;
  label: string;
  status: 'pending' | 'ok' | 'warn' | 'off';
  detail?: string;
}

/** La construction du logotype (2,1 s) et la ligne du Lab se voient en entier avant l'ouverture. */
const MIN_DURATION_MS = 2500;
const MIN_FROM_LAUNCHER_MS = 2600;
/** Décalage de la construction : la LED du lanceur attend au centre du logotype avant de monter au Λ. */
const DELAY_S = 0.12;
const DELAY_FROM_LAUNCHER_S = 0.22;
/** La ligne du Lab reprend le point or quand la LED quitte la pointe du Λ. */
const SOUS_AT_S = CONSTRUCTION_END - 0.3;
/** Durée de l'ouverture sur l'axe (couture → écartement), alignée sur boot.module.css. */
const LEAVE_MS = 760;
const WORDMARK_W = 420;
/** L'horizon du sceau (48,27 % de sa hauteur) se pose sur l'axe du logotype (y 80 de 160). */
const SEAL_HZ = `${(SEAL_HORIZON * 100).toFixed(2)}%`;

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
  const markRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const t = setInterval(() => setVisibleCount((c) => Math.min(steps.length, c + 1)), 120);
    return () => clearInterval(t);
  }, [steps.length]);

  // Télémétrie : le temps écoulé depuis la frappe, lu à chaque image.
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (clockRef.current) clockRef.current.textContent = `T+${(Math.max(0, now - t0) / 1000).toFixed(3)}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const min = fromLauncher ? MIN_FROM_LAUNCHER_MS : MIN_DURATION_MS;
    const remaining = skipped ? 0 : Math.max(0, min - (Date.now() - startedAt));
    const t1 = setTimeout(() => {
      // Axe du logotype en % de l'écran : indépendant de tout zoom CSS.
      const box = markRef.current?.querySelector('svg[aria-label="CΛNTO"]')?.getBoundingClientRect();
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

  const delay = fromLauncher ? DELAY_FROM_LAUNCHER_S : DELAY_S;
  const completed = steps.filter((st) => st.status !== 'pending').length;
  const progress = steps.length ? completed / steps.length : 0;

  return (
    <div
      ref={rootRef}
      className={`${s.boot} ${fromLauncher ? s.fromLauncher : ''} ${leaving ? s.leaving : ''} ${reduced ? s.reduced : ''}`}
      style={axis !== null ? ({ '--axis': `${axis.toFixed(3)}%` } as CSSProperties) : undefined}
    >
      <div className={s.hud} aria-hidden>
        <span>
          CΛNTO <i className={s.led}>/</i> 002 · BOOT
        </span>
        <b ref={clockRef}>T+0.000</b>
      </div>

      <div className={s.center} ref={markRef}>
        {/* Une seule boîte pour le logotype, le sceau et sa plaque : l'axe du logotype (y 80) est la ligne d'horizon. */}
        <div className={s.mark} data-part="mark">
          <span className={s.horizon} aria-hidden />
          <div className={s.sealw} data-part="seal" style={{ '--hz': SEAL_HZ } as CSSProperties}>
            <Seal kind="negative" className={s.seal} />
          </div>
          <Wordmark width={WORDMARK_W} animated delay={delay} />
          <div className={s.plateSeal} data-part="seal-plate">
            <Plate id="seal" values={{ version: APP_VERSION }} />
          </div>
        </div>
        <p className={s.sous} style={{ '--sous-delay': `${(delay + SOUS_AT_S).toFixed(2)}s` } as CSSProperties}>
          SIΞRRΛSKΛ LAB
          <i aria-hidden />
          <b>ARTEFACT 002</b>
        </p>
      </div>

      <div className={s.console}>
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
          <span className={s.markSlot}>SIΞRRΛSKΛ</span>
        </div>
      </div>

      <div className={s.plateArtefact} data-part="artefact-plate">
        <Plate id="artefact" values={{ state: 'LIVE' }} />
      </div>

      <div className={s.seam} aria-hidden>
        <i />
        <i />
      </div>
    </div>
  );
}
