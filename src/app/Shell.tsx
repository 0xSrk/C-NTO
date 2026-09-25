import { useEffect, useState, type ReactNode } from 'react';
import { InvertedTab, Progress, cx } from '@/design/primitives';
import { plural } from '@/lib/format';
import { Wordmark } from '@/design/Wordmark';
import { Modal } from '@/design/Modal';
import { Button } from '@/design/primitives';
import { SESSION_CAPACITY } from '@/engine/types';
import { desk, isDesk } from '@/lib/desk';
import { APP_VERSION } from '@/lib/version';
import { ET_ZONE } from '@/lib/time';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useUi, type TabId } from '@/store/ui';
import { useAgent } from '@/store/agent';
import { useBridge } from '@/store/bridge';
import { UpdateButton } from './UpdateButton';
import { ZoomControls } from './ZoomControls';
import { chooseLocale, LOCALES, tr, useI18n } from '@/i18n';
import { tabCopy, TABS } from './tabs';
import s from './shell.module.css';

function useClock(everyMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function clockFormat(locale: string, zone?: string): Intl.DateTimeFormat {
  const base: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  if (zone) return new Intl.DateTimeFormat(locale, { ...base, timeZone: zone });
  return new Intl.DateTimeFormat(locale, { ...base, second: '2-digit' });
}

const fmtPhase = new Intl.DateTimeFormat('en-US', { timeZone: ET_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function marketPhase(now: Date): { label: string; tone: 'ok' | 'warn' | 'off' } {
  const parts = fmtPhase.formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const t = h * 60 + m;
  if (wd === 'Sat' || (wd === 'Sun' && t < 18 * 60) || (wd === 'Fri' && t >= 17 * 60)) return { label: tr('Globex fermé · week-end', 'Globex closed · weekend', 'Globex cerrado · fin de semana'), tone: 'off' };
  if (t >= 17 * 60 && t < 18 * 60) return { label: tr('Maintenance Globex', 'Globex maintenance', 'Mantenimiento Globex'), tone: 'off' };
  if (t >= 9 * 60 + 30 && t < 16 * 60) return { label: tr('RTH ouvert', 'RTH open', 'RTH abierto'), tone: 'ok' };
  if (t >= 8 * 60 && t < 9 * 60 + 30) return { label: tr('Pré-ouverture', 'Pre-open', 'Preapertura'), tone: 'warn' };
  return { label: tr('Globex · hors RTH', 'Globex · outside RTH', 'Globex · fuera de RTH'), tone: 'warn' };
}

export function Shell({ children }: { children: ReactNode }) {
  const locale = useI18n((s) => s.locale);
  const tab = useUi((u) => u.tab);
  const setTab = useUi((u) => u.setTab);
  const toasts = useUi((u) => u.toasts);
  const dismiss = useUi((u) => u.dismiss);
  const sessionsCount = useJournal((j) => j.sessions.length);
  const callsign = useSettings((st) => st.settings.callsign);
  const orchestrator = useAgent((a) => a.orchestrator);
  const bridgeStatus = useBridge((b) => b.status);
  const bridgeLive = !!bridgeStatus?.enabled && !!bridgeStatus.folder && !bridgeStatus.error;
  const active = TABS.find((t) => t.id === tab);
  const activeCopy = active ? tabCopy(active) : null;
  const [maximized, setMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState(APP_VERSION);

  useEffect(() => {
    if (!desk) return;
    return desk.window.onMaximized(setMaximized);
  }, []);

  useEffect(() => {
    if (!desk?.version) return;
    void desk.version().then(setAppVersion);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // e.code est indépendant de la disposition clavier (AZERTY : Ctrl+& = Digit1).
      const m = /^Digit([1-7])$/.exec(e.code);
      if ((e.ctrlKey || e.metaKey) && m && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const tab = TABS[Number(m[1]) - 1];
        if (tab) setTab(tab.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab]);

  const live = bridgeLive || orchestrator.running;
  const liveLabel = bridgeLive && orchestrator.running ? tr('Pont · Lien', 'Bridge · Link', 'Puente · Enlace') : bridgeLive ? tr('Pont NT8', 'NT8 bridge', 'Puente NT8') : orchestrator.running ? tr('Lien IA', 'AI link', 'Enlace IA') : isDesk ? tr('Veille', 'Idle', 'En espera') : tr('Navigateur', 'Browser', 'Navegador');

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
            <b>{active?.code}</b> <span className={s.sep}>·</span> {activeCopy?.label}
          </span>
          <span>
            NQ <span className={s.sep}>·</span> CME
          </span>
        </div>
        <div className={s.titleRight}>
          <UpdateButton />
          <span className={cx(s.livePill, live ? s.on : s.off)} title={bridgeStatus?.folder ?? undefined}>
            <i className={s.liveDot} />
            {liveLabel}
          </span>
          {isDesk && (
            <div className={s.winControls}>
              <button onClick={() => desk?.window.minimize()} aria-label={tr('Réduire', 'Minimize', 'Minimizar')} title={tr('Réduire', 'Minimize', 'Minimizar')}>
                <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1">
                  <path d="M0 5h10" />
                </svg>
              </button>
              <button onClick={() => desk?.window.toggleMaximize()} aria-label={tr('Agrandir', 'Maximize', 'Maximizar')} title={tr('Agrandir', 'Maximize', 'Maximizar')}>
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
              <button className={s.close} onClick={() => desk?.window.close()} aria-label={tr('Fermer', 'Close', 'Cerrar')} title={tr('Fermer', 'Close', 'Cerrar')}>
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
          <span className="micro">{tr('Indicatif', 'Callsign', 'Indicativo')}</span>
          <span className={s.railCallsign}>{callsign}</span>
        </div>
        <nav className={s.nav}>
          {TABS.map((item) => {
            const Icon = item.icon;
            const copy = tabCopy(item);
            return (
              <button key={item.id} className={cx(s.navItem, tab === item.id && s.on)} onClick={() => setTab(item.id)} title={`${copy.label} — Ctrl+${item.index.slice(-1)}`} aria-current={tab === item.id ? 'page' : undefined}>
                <span className={s.navIndex}>{item.index}</span>
                <Icon size={14} />
                <span className={s.navLabel}>{copy.label}</span>
                <span className={s.navBadge}>
                  {item.id === 'metrique' && sessionsCount > 0 ? sessionsCount : ''}
                  {item.id === 'agent' && orchestrator.running ? <span className={s.lienBadge}>{tr('LIEN', 'LINK', 'ENLACE')}</span> : null}
                  {(item.id === 'bot' || item.id === 'copieur') && (
                    <i className={s.protoPill} title={tr('Prototypage · déploiement à venir', 'Prototype · deployment coming', 'Prototipo · despliegue pendiente')}>
                      PROTO
                    </i>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
        <div className={s.railFoot}>
          <div className={s.hatch} aria-hidden />
          <div className={s.capacity}>
            <div className={s.capacityRow}>
              <span>{tr('Séances', 'Sessions', 'Sesiones')}</span>
              <b>
                {sessionsCount} / {SESSION_CAPACITY}
              </b>
            </div>
            <Progress value={sessionsCount / SESSION_CAPACITY} tone={sessionsCount / SESSION_CAPACITY > 0.9 ? 'ember' : 'gold'} />
          </div>
          <div className={s.railMeta}>
            <span className={s.dimmer}>v{appVersion}</span>
          </div>
        </div>
      </aside>

      <main className={s.main}>{children}</main>

      <footer className={cx(s.status, s.frameBottom)}>
        <MarketPhase />
        <span className={s.statusItem}>
          <i className={cx(s.statusDot, orchestrator.running && s.gold, orchestrator.running && s.live)} />
          {tr('Passerelle', 'Gateway', 'Pasarela')} {orchestrator.running ? `${tr('active', 'active', 'activa')} · ${plural(orchestrator.clients, tr('lien', 'link', 'enlace'), tr('liens', 'links', 'enlaces'))}` : tr('en veille', 'idle', 'en espera')}
        </span>
        <span className={s.statusItem} title={bridgeStatus?.folder ?? undefined}>
          <i className={cx(s.statusDot, bridgeLive && s.gold, bridgeLive && s.live, !!bridgeStatus?.error && s.warn)} />
          {tr('Pont NinjaTrader', 'NinjaTrader bridge', 'Puente NinjaTrader')} {bridgeStatus?.error ? tr('en erreur', 'in error', 'en error') : bridgeLive ? `${tr('actif', 'active', 'activo')} · ${plural(bridgeStatus.files, tr('fichier', 'file', 'archivo'), tr('fichiers', 'files', 'archivos'))}` : isDesk ? tr('non configuré', 'not configured', 'no configurado') : tr('import manuel', 'manual import', 'importación manual')}
        </span>
        <div className={s.statusRight}>
          <div className={s.langRow} role="radiogroup" aria-label={tr('Langue du desk', 'Desk language', 'Idioma del desk')}>
            {LOCALES.map((item) => (
              <button key={item.id} type="button" role="radio" aria-checked={locale === item.id} className={cx(s.langBtn, locale === item.id && s.on)} onClick={() => void chooseLocale(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <ZoomControls />
          <Clocks locale={locale} />
        </div>
      </footer>

      <div className={s.toasts} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx(s.toast, t.tone !== 'info' && s[t.tone])} onClick={() => dismiss(t.id)}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className={s.toastAction}
                onClick={(e) => {
                  e.stopPropagation();
                  t.action?.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
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
      sub={tr('confirmation requise', 'confirmation required', 'confirmación requerida')}
      onClose={() => resolve(false)}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={() => resolve(false)} autoFocus>
            {tr('Annuler', 'Cancel', 'Cancelar')}
          </Button>
          <Button variant={pending.danger ? 'danger' : 'gold'} onClick={() => resolve(true)}>
            {tr('Confirmer', 'Confirm', 'Confirmar')}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{pending.text ?? tr('Cette action ne peut pas être annulée.', 'This action cannot be undone.', 'Esta acción no se puede deshacer.')}</p>
    </Modal>
  );
}

/** Horloges isolées : seules ces cellules se rafraîchissent chaque seconde. */
function Clocks({ locale }: { locale: string }) {
  const now = useClock();
  const fmtLocal = clockFormat(locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'fr-FR');
  const fmtEt = clockFormat(locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'fr-FR', ET_ZONE);
  return (
    <>
      <span className={s.statusItem}>
        {tr('Local', 'Local', 'Local')} <b>{fmtLocal.format(now)}</b>
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
  const def = TABS.find((t) => t.id === tab);
  if (!def) return null;
  const copy = tabCopy(def);
  return (
    <div className={s.moduleHead}>
      <span className={s.watermark} aria-hidden>
        {def.code}
      </span>
      <div className={s.moduleTitle}>
        <h1>
          {copy.label}
          <small>
            <b>{def.index}</b> · {def.code} · v{APP_VERSION}
          </small>
        </h1>
        <span className={s.moduleTagline}>{copy.tagline}</span>
      </div>
      {actions && <div className={s.moduleActions}>{actions}</div>}
    </div>
  );
}

export function ModuleContent({ children, noPad, className }: { children: ReactNode; noPad?: boolean; className?: string }) {
  return <div className={cx(s.content, noPad && s.noPad, className)}>{children}</div>;
}
