import { useEffect, useState, type ReactNode } from 'react';
import { Progress, Sigil, cx } from '@/design/primitives';
import { Wordmark } from '@/design/Wordmark';
import { SESSION_CAPACITY } from '@/engine/types';
import { desk, isDesk } from '@/lib/desk';
import { ET_ZONE } from '@/lib/time';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useUi, type TabId } from '@/store/ui';
import { useAgent } from '@/store/agent';
import { TABS } from './tabs';
import s from './shell.module.css';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const fmtLocal = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const fmtEt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ET_ZONE });

function marketPhase(now: Date): { label: string; tone: 'ok' | 'warn' | 'off' } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const t = h * 60 + m;
  if (wd === 'Sat' || (wd === 'Sun' && t < 18 * 60) || (wd === 'Fri' && t >= 17 * 60)) return { label: 'Globex fermé · week-end', tone: 'off' };
  if (t >= 17 * 60 && t < 18 * 60) return { label: 'Maintenance Globex', tone: 'off' };
  if (t >= 9 * 60 + 30 && t < 16 * 60) return { label: 'RTH ouvert', tone: 'ok' };
  if (t >= 8 * 60 && t < 9 * 60 + 30) return { label: 'Pré-ouverture', tone: 'warn' };
  return { label: 'Globex · hors RTH', tone: 'warn' };
}

export function Shell({ children }: { children: ReactNode }) {
  const tab = useUi((u) => u.tab);
  const setTab = useUi((u) => u.setTab);
  const toasts = useUi((u) => u.toasts);
  const dismiss = useUi((u) => u.dismiss);
  const sessionsCount = useJournal((j) => j.sessions.length);
  const callsign = useSettings((st) => st.settings.callsign);
  const orchestrator = useAgent((a) => a.orchestrator);
  const now = useClock();
  const phase = marketPhase(now);
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desk) return;
    return desk.window.onMaximized(setMaximized);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && /^[1-7]$/.test(e.key)) {
        e.preventDefault();
        setTab(TABS[Number(e.key) - 1].id as TabId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab]);

  return (
    <div className={s.shell}>
      <header className={s.title}>
        <div className={s.brand}>
          <Wordmark width={64} strokeWidth={4} color="#f3f4f8" />
          <span className={s.brandSep} />
          <Sigil size={9} className={s.brandSigil} />
        </div>
        <div className={s.titleCenter}>
          <span>
            <b>{active.code}</b> · {active.label}
          </span>
          <span>NASDAQ-100 · CME GLOBEX</span>
          <span>NQ / MNQ</span>
        </div>
        <div className={s.titleRight}>
          <span className={cx('micro')}>{isDesk ? 'SHELL LOCAL' : 'MODE NAVIGATEUR'}</span>
          {isDesk && (
            <div className={s.winControls}>
              <button onClick={() => desk?.window.minimize()} aria-label="Réduire">
                <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1">
                  <path d="M0 5h10" />
                </svg>
              </button>
              <button onClick={() => desk?.window.toggleMaximize()} aria-label="Agrandir">
                {maximized ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1" fill="none">
                    <path d="M2 3h5v5H2zM3.5 3V1.5h5v5H7" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1" fill="none">
                    <rect x="0.5" y="0.5" width="9" height="9" />
                  </svg>
                )}
              </button>
              <button className={s.close} onClick={() => desk?.window.close()} aria-label="Fermer">
                <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1">
                  <path d="M0 0l10 10M10 0L0 10" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      <aside className={s.rail}>
        <div className={s.railHead}>
          <span className="micro">Opérateur</span>
          <span className={s.railCallsign}>{callsign}</span>
        </div>
        <nav className={s.nav}>
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} className={cx(s.navItem, tab === t.id && s.on)} onClick={() => setTab(t.id)} title={`${t.label} — Ctrl+${t.index.slice(-1)}`}>
                <span className={s.navIndex}>{t.index}</span>
                <Icon size={16} />
                <span className={s.navLabel}>{t.label}</span>
                <span className={s.navBadge}>
                  {t.id === 'metrique' && sessionsCount > 0 ? sessionsCount : ''}
                  {t.id === 'agent' && orchestrator.running ? 'LINK' : ''}
                </span>
              </button>
            );
          })}
        </nav>
        <div className={s.railFoot}>
          <div className={s.capacity}>
            <div className={s.capacityRow}>
              <span>Séances</span>
              <b>
                {sessionsCount} / {SESSION_CAPACITY}
              </b>
            </div>
            <Progress value={sessionsCount / SESSION_CAPACITY} tone={sessionsCount / SESSION_CAPACITY > 0.9 ? 'ember' : 'gold'} />
          </div>
          <div className={s.railMeta}>
            <span>Artefact · prototype 0.1.0</span>
            <span>Forgé par SIΞRRΛSKΛ</span>
          </div>
        </div>
      </aside>

      <main className={s.main}>{children}</main>

      <footer className={s.status}>
        <span className={s.statusItem}>
          <i className={cx(s.statusDot, phase.tone === 'ok' && s.ok, phase.tone === 'warn' && s.warn, phase.tone === 'ok' && s.live)} />
          {phase.label}
        </span>
        <span className={s.statusItem}>
          <i className={cx(s.statusDot, orchestrator.running && s.ok, orchestrator.running && s.live)} />
          Passerelle {orchestrator.running ? `active · ${orchestrator.clients} lien(s)` : 'en veille'}
        </span>
        <span className={s.statusItem}>
          <i className={s.statusDot} />
          Pont NinjaTrader hors ligne
        </span>
        <div className={s.statusRight}>
          <span className={s.statusItem}>
            Local <b>{fmtLocal.format(now)}</b>
          </span>
          <span className={s.statusItem}>
            New York <b>{fmtEt.format(now)} ET</b>
          </span>
          <span className={s.statusItem}>Coffre local · IndexedDB</span>
        </div>
      </footer>

      <div className={s.toasts}>
        {toasts.map((t) => (
          <div key={t.id} className={cx(s.toast, t.tone !== 'info' && s[t.tone])} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ModuleHeader({ tab, actions }: { tab: TabId; actions?: ReactNode }) {
  const def = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <div className={s.moduleHead}>
      <div className={s.moduleTitle}>
        <h1>
          {def.label}
          <small>
            {def.index} · {def.code}
          </small>
        </h1>
        <span className={s.moduleTagline}>{def.tagline}</span>
      </div>
      {actions && <div className={s.moduleActions}>{actions}</div>}
    </div>
  );
}

export function ModuleContent({ children, noPad, className }: { children: ReactNode; noPad?: boolean; className?: string }) {
  return <div className={cx(s.content, noPad && s.noPad, className)}>{children}</div>;
}
