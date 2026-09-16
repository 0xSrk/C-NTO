import { useEffect, useState, type ReactNode } from 'react';
import { InvertedTab, Progress, cx } from '@/design/primitives';
import { plural } from '@/lib/format';
import { Wordmark } from '@/design/Wordmark';
import { Modal } from '@/design/Modal';
import { Button } from '@/design/primitives';
import { SESSION_CAPACITY } from '@/engine/types';
import { desk, isDesk } from '@/lib/desk';
import { ET_ZONE } from '@/lib/time';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useUi, type TabId } from '@/store/ui';
import { useAgent } from '@/store/agent';
import { useBridge } from '@/store/bridge';
import { TABS } from './tabs';
import s from './shell.module.css';

function useClock(everyMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const fmtLocal = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const fmtEt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ET_ZONE });

const fmtPhase = new Intl.DateTimeFormat('en-US', { timeZone: ET_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function marketPhase(now: Date): { label: string; tone: 'ok' | 'warn' | 'off' } {
  const parts = fmtPhase.formatToParts(now);
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
  const bridgeStatus = useBridge((b) => b.status);
  const bridgeLive = !!bridgeStatus?.enabled && !!bridgeStatus.folder && !bridgeStatus.error;
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desk) return;
    return desk.window.onMaximized(setMaximized);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // e.code est indépendant de la disposition clavier (AZERTY : Ctrl+& = Digit1).
      const m = /^Digit([1-7])$/.exec(e.code);
      if ((e.ctrlKey || e.metaKey) && m && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setTab(TABS[Number(m[1]) - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab]);

  const live = bridgeLive || orchestrator.running;
  const liveLabel = bridgeLive && orchestrator.running ? 'Pont · Lien' : bridgeLive ? 'Pont NT8' : orchestrator.running ? 'Lien IA' : isDesk ? 'Veille' : 'Navigateur';

  return (
    <div className={s.shell}>
      <div className={s.ambience} aria-hidden>
        <div className={s.lightRoom} />
        <div className={s.lightBeams} />
        <div className={cx(s.lightWarm, !live && s.off)} />
        <div className={s.lightHeader} />
      </div>

      <header className={s.title}>
        <div className={s.brand}>
          <Wordmark width={64} strokeWidth={1} color="var(--text-0)" />
          <span className={s.brandSep} />
          <span className={s.brandMark}>SIΞRRΛSKΛ—LAB</span>
          <InvertedTab>CΛNTO · Artefact 002</InvertedTab>
        </div>
        <div className={s.titleCenter}>
          <span>
            <b>{active.code}</b> <span className={s.sep}>·</span> {active.label}
          </span>
          <span>
            NQ <span className={s.sep}>·</span> CME
          </span>
        </div>
        <div className={s.titleRight}>
          <span className={cx(s.livePill, live ? s.on : s.off)} title={bridgeStatus?.folder ?? undefined}>
            <i className={s.liveDot} />
            {liveLabel}
          </span>
          {isDesk && (
            <div className={s.winControls}>
              <button onClick={() => desk?.window.minimize()} aria-label="Réduire" title="Réduire">
                <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1">
                  <path d="M0 5h10" />
                </svg>
              </button>
              <button onClick={() => desk?.window.toggleMaximize()} aria-label="Agrandir" title="Agrandir">
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
              <button className={s.close} onClick={() => desk?.window.close()} aria-label="Fermer" title="Fermer">
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
          <span className="micro">Indicatif</span>
          <span className={s.railCallsign}>{callsign}</span>
        </div>
        <nav className={s.nav}>
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} className={cx(s.navItem, tab === t.id && s.on)} onClick={() => setTab(t.id)} title={`${t.label} — Ctrl+${t.index.slice(-1)}`} aria-current={tab === t.id ? 'page' : undefined}>
                <span className={s.navIndex}>{t.index}</span>
                <Icon size={14} />
                <span className={s.navLabel}>{t.label}</span>
                <span className={s.navBadge}>
                  {t.id === 'metrique' && sessionsCount > 0 ? sessionsCount : ''}
                  {t.id === 'agent' && orchestrator.running ? 'LIEN' : ''}
                </span>
              </button>
            );
          })}
        </nav>
        <div className={s.railFoot}>
          <div className={s.hatch} aria-hidden />
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
            <span>Design Unit</span>
            <span>SIΞRRΛSKΛ Lab</span>
            <span className={s.dimmer}>Rev. A · 1.0.0</span>
          </div>
        </div>
      </aside>

      <main className={s.main}>{children}</main>

      <footer className={cx(s.status, s.frameBottom)}>
        <MarketPhase />
        <span className={s.statusItem}>
          <i className={cx(s.statusDot, orchestrator.running && s.gold, orchestrator.running && s.live)} />
          Passerelle {orchestrator.running ? `active · ${plural(orchestrator.clients, 'lien')}` : 'en veille'}
        </span>
        <span className={s.statusItem} title={bridgeStatus?.folder ?? undefined}>
          <i className={cx(s.statusDot, bridgeLive && s.gold, bridgeLive && s.live, !!bridgeStatus?.error && s.warn)} />
          Pont NinjaTrader {bridgeStatus?.error ? 'en erreur' : bridgeLive ? `actif · ${plural(bridgeStatus.files, 'fichier')}` : isDesk ? 'non configuré' : 'import manuel'}
        </span>
        <div className={s.statusRight}>
          <Clocks />
          <span className={cx(s.statusItem, s.statusHide)}>Coffre local</span>
        </div>
      </footer>

      <div className={s.toasts} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx(s.toast, t.tone !== 'info' && s[t.tone])} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
      <ConfirmDialog />
    </div>
  );
}

function ConfirmDialog() {
  const pending = useUi((u) => u.pendingConfirm);
  const resolve = useUi((u) => u.resolveConfirm);
  if (!pending) return null;
  return (
    <Modal
      title={pending.title}
      sub="confirmation requise"
      onClose={() => resolve(false)}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => resolve(false)} autoFocus>
            Annuler
          </Button>
          <Button variant={pending.danger ? 'danger' : 'gold'} onClick={() => resolve(true)}>
            Confirmer
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{pending.text ?? 'Cette action ne peut pas être annulée.'}</p>
    </Modal>
  );
}

/** Horloges isolées : seules ces cellules se rafraîchissent chaque seconde. */
function Clocks() {
  const now = useClock();
  return (
    <>
      <span className={s.statusItem}>
        Local <b>{fmtLocal.format(now)}</b>
      </span>
      <span className={s.statusItem}>
        New York <b>{fmtEt.format(now)} ET</b>
      </span>
    </>
  );
}

function MarketPhase() {
  const now = useClock(30_000);
  const phase = marketPhase(now);
  return (
    <span className={s.statusItem}>
      <i className={cx(s.statusDot, phase.tone === 'ok' && s.ok, phase.tone === 'warn' && s.warn, phase.tone === 'ok' && s.live)} />
      {phase.label}
    </span>
  );
}

export function ModuleHeader({ tab, actions }: { tab: TabId; actions?: ReactNode }) {
  const def = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <div className={s.moduleHead}>
      <span className={s.watermark} aria-hidden>
        {def.code}
      </span>
      <div className={s.moduleTitle}>
        <h1>
          {def.label}
          <small>
            <b>{def.index}</b> · {def.code} · Rev. A
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
