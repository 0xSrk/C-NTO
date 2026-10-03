import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Barcode, Button, Led, cx } from '@/design/primitives';
import { PlaqueSignature } from '@/design/PlaqueSignature';
import { Wordmark } from '@/design/Wordmark';
import { Modal } from '@/design/Modal';
import { BRIDGE_MAX_AGE_MS } from '@/engine/portfolio/types';
import { desk, isDesk } from '@/lib/desk';
import { APP_VERSION } from '@/lib/version';
import { cmeSession } from '@/lib/cmeClosed';
import { ET_ZONE, dateTimeFormatter, etDateKey, globexState, type GlobexState } from '@/lib/time';
import { useJournal } from '@/store/journal';
import { useUi, type TabId } from '@/store/ui';
import { useAgent } from '@/store/agent';
import { isBridgeLive, useBridge } from '@/store/bridge';
import { ChangelogJournal } from './ChangelogJournal';
import { UpdateButton } from './UpdateButton';
import { ZoomControls } from './ZoomControls';
import { chooseLocale, LOCALES, tr, useI18n } from '@/i18n';
import { isConception, tabCopy, TABS } from './tabs';
import s from './shell.module.css';

function useClock(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function globexLabel(state: GlobexState): string {
  if (state === 'FERMÉ') return tr('FERMÉ', 'CLOSED', 'CERRADO');
  if (state === 'FERMÉ · FÉRIÉ') return tr('FERMÉ · FÉRIÉ', 'CLOSED · HOLIDAY', 'CERRADO · FESTIVO');
  return state;
}

export function Shell({ children, revealed = true }: { children: ReactNode; revealed?: boolean }) {
  const locale = useI18n((st) => st.locale);
  const tab = useUi((u) => u.tab);
  const setTab = useUi((u) => u.setTab);
  const crumb = useUi((u) => u.crumb);
  const metricAccount = useUi((u) => u.metricAccount);
  const toasts = useUi((u) => u.toasts);
  const dismiss = useUi((u) => u.dismiss);
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const orchestrator = useAgent((a) => a.orchestrator);
  const bridgeStatus = useBridge((b) => b.status);
  const nt = useBridge((b) => b.nt);
  const now = useClock();
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];
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
      const m = /^Digit([1-8])$/.exec(e.code);
      if ((e.ctrlKey || e.metaKey) && m && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const next = TABS[Number(m[1]) - 1];
        if (next) setTab(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab]);

  const accounts = useMemo(() => [...new Set(sessions.map((row) => row.account).filter((name): name is string => !!name))].sort(), [sessions]);
  const accountLine = metricAccount
    ? metricAccount
    : tr(`Tous les comptes · ${accounts.length}`, `All accounts · ${accounts.length}`, `Todas las cuentas · ${accounts.length}`);
  const bridgeUp = nt?.link === 'live' || isBridgeLive(bridgeStatus);
  const source = bridgeUp ? 'NinjaTrader 8' : tr('Import CSV', 'CSV import', 'Importación CSV');
  const live = useMemo(() => {
    if (nt?.link !== 'live') return false;
    const cutoff = now - BRIDGE_MAX_AGE_MS;
    return trades.some((trade) => {
      if (metricAccount && (trade.account ?? '') !== metricAccount) return false;
      return Math.max(trade.entryTime || 0, trade.exitTime || 0) >= cutoff;
    });
  }, [nt?.link, trades, metricAccount, now]);
  /** Voyant du compte : allumé quand les exécutions arrivent, en veille quand le pont est ouvert, éteint sinon. */
  const linkState = live ? 'voyantOn' : bridgeUp ? 'voyantVeille' : 'voyantOff';
  const linkLabel = live
    ? tr('Pont NT8 · exécutions en direct', 'NT8 bridge · live executions', 'Puente NT8 · ejecuciones en directo')
    : bridgeUp
      ? tr('Pont NT8 connecté · en veille', 'NT8 bridge connected · standing by', 'Puente NT8 conectado · en espera')
      : tr('Hors ligne · import CSV', 'Offline · CSV import', 'Fuera de línea · importación CSV');

  const localeTag = locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'fr-FR';
  const clock = new Intl.DateTimeFormat(localeTag, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: ET_ZONE }).format(now);
  const session = cmeSession(etDateKey(now));
  const phase = globexState(now, session.closed, session.earlyCloseMinute);
  const shortDate = dateTimeFormatter({ weekday: 'short', day: 'numeric', month: 'short', timeZone: ET_ZONE }, localeTag).format(now);
  const moduleName = (activeCopy?.label ?? '').toLocaleUpperCase(localeTag);
  const third = crumb && crumb.tab === tab ? crumb.label : '';
  const reported = nt?.accountNames?.filter(Boolean) ?? [];
  const port = nt?.port ?? 48231;

  return (
    <div className={cx(s.shell, revealed ? s.intro : s.pending)}>
      <div className={s.texture} aria-hidden />
      <header className={s.title}>
        <div className={s.brand}>
          <span className={s.brandMark}>
            <Wordmark width={84} ticks survol />
          </span>
          <span className={s.brandSep} />
          <span className={s.crumb}>
            <span>{active?.index}</span>
            <span className={s.slash}>/</span>
            <b>{moduleName}</b>
            {third ? (
              <>
                <span className={s.slash}>/</span>
                <span>{third}</span>
              </>
            ) : null}
          </span>
        </div>
        <div className={s.titleRight}>
          <UpdateButton />
          <span className={s.labMark}>SRK—LAB / ART-002</span>
          <span className={s.clock}>{clock} ET</span>
          {isDesk && (
            <div className={s.winControls}>
              <button onClick={() => desk?.window.minimize()} aria-label={tr('Réduire', 'Minimize', 'Minimizar')} title={tr('Réduire', 'Minimize', 'Minimizar')}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path d="M1 6 H11" />
                </svg>
              </button>
              <button onClick={() => desk?.window.toggleMaximize()} aria-label={tr('Agrandir', 'Maximize', 'Maximizar')} title={tr('Agrandir', 'Maximize', 'Maximizar')}>
                {maximized ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M3 4h5v5H3zM4.2 4V2.2h5.6v5.6H8" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <rect x="1.5" y="1.5" width="9" height="9" />
                  </svg>
                )}
              </button>
              <button className={s.close} onClick={() => desk?.window.close()} aria-label={tr('Fermer', 'Close', 'Cerrar')} title={tr('Fermer', 'Close', 'Cerrar')}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path d="M1.5 1.5 L10.5 10.5 M10.5 1.5 L1.5 10.5" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      <aside className={s.rail}>
        <nav className={s.nav} aria-label={tr('Modules', 'Modules', 'Módulos')}>
          <span className={s.navLabelHead}>{tr('MODULES', 'MODULES', 'MÓDULOS')}</span>
          {TABS.map((item, index) => {
            const conception = isConception(item.id);
            const prev = index > 0 ? TABS[index - 1] : undefined;
            const openConcept = conception && (!prev || !isConception(prev.id));
            return (
              <Fragment key={item.id}>
                {openConcept && (
                  <div className={s.conceptLabel}>
                    <span>{tr('EN CONCEPTION', 'IN DESIGN', 'EN DISEÑO')}</span>
                    <i />
                  </div>
                )}
                <RailButton itemId={item.id} index={item.index} label={tabCopy(item).label} on={tab === item.id} dashed={conception} onClick={() => setTab(item.id)} link={item.id === 'agent' && orchestrator.running} />
              </Fragment>
            );
          })}
        </nav>
        <div className={s.railFoot}>
          <div className={s.account}>
            <span className={s.railLabel}>
              {tr('COMPTE ACTIF', 'ACTIVE ACCOUNT', 'CUENTA ACTIVA')}
              <i aria-hidden />
            </span>
            <div className={s.accountLine} title={linkLabel}>
              <span className={cx(s.voyant, s[linkState])} role="img" aria-label={linkLabel} />
              <span className={s.accountName}>{accountLine}</span>
            </div>
            <span className={s.accountSource}>{source}</span>
          </div>
          <div className={s.versionRow}>
            <span>{tr('VERSION', 'VERSION', 'VERSIÓN')}</span>
            <i aria-hidden />
            <ChangelogJournal version={appVersion} />
          </div>
          <div className={s.tools}>
            <div className={s.langRow} role="radiogroup" aria-label={tr('Langue du desk', 'Desk language', 'Idioma del desk')}>
              {LOCALES.map((item) => (
                <button key={item.id} type="button" role="radio" aria-checked={locale === item.id} className={cx(s.langBtn, locale === item.id && s.on)} onClick={() => void chooseLocale(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
            <ZoomControls />
          </div>
          <PlaqueSignature className={s.signature} />
        </div>
      </aside>

      <main className={s.main}>
        <span className={s.edge} aria-hidden>
          SIΞRRΛSKΛ LAB · DEEP TECH · ARTEFACT 002 · RÉV. 3.4
        </span>
        {children}
        <div className={s.toasts} role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={cx(s.toast, toast.tone !== 'info' && s[toast.tone])} onClick={() => dismiss(toast.id)}>
              <span>{toast.text}</span>
              {toast.action && (
                <button
                  type="button"
                  className={s.toastAction}
                  onClick={(event) => {
                    event.stopPropagation();
                    toast.action?.run();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      </main>

      <footer className={s.status}>
        <div className={s.statusLeft}>
          <span className={s.statusLive}>
            <Led on={nt?.link === 'live'}>{tr('PONT NT8', 'NT8 BRIDGE', 'PUENTE NT8')}</Led>
            {' · '}
            {nt?.link === 'live' ? 'LIVE' : tr('HORS LIGNE', 'OFFLINE', 'FUERA DE LÍNEA')}
          </span>
          {reported.length > 0 ? <span>{reported.join(' · ')}</span> : null}
          <span>127.0.0.1:{port}</span>
          {nt?.heartbeatLatencyMs != null ? <span>{tr('LATENCE', 'LATENCY', 'LATENCIA')} {nt.heartbeatLatencyMs} MS</span> : null}
        </div>
        <div className={s.statusRight}>
          <span>
            CME GLOBEX · {globexLabel(phase)} · {shortDate}
          </span>
          <span className={s.sigEnd}>
            <Barcode />
            <span>[ SIΞRRΛSKΛ ]</span>
          </span>
        </div>
      </footer>

      <ConfirmDialog />
    </div>
  );
}

function RailButton({ itemId, index, label, on, dashed, link, onClick }: { itemId: TabId; index: string; label: string; on: boolean; dashed?: boolean; link?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cx(s.navItem, on && s.on, dashed && s.dashed)} onClick={onClick} title={`${label} — Ctrl+${index.slice(-1)}`} aria-current={on ? 'page' : undefined}>
      <span className={s.navIndex}>{index}</span>
      <span className={s.navLabel}>{label}</span>
      {link ? <span className={s.lienBadge}>{tr('LIEN', 'LINK', 'ENLACE')}</span> : null}
      <span className={s.navMark} aria-hidden />
      <span className={s.srOnly}>{itemId}</span>
    </button>
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

export function ModuleHeader({ tab, actions, crumb = '', meta }: { tab: TabId; actions?: ReactNode; crumb?: string; meta?: ReactNode }) {
  const setCrumb = useUi((u) => u.setCrumb);
  const def = TABS.find((item) => item.id === tab);
  useEffect(() => {
    if (def) setCrumb(tab, crumb);
  }, [crumb, def, setCrumb, tab]);
  if (!def) return null;
  const copy = tabCopy(def);
  return (
    <div className={s.moduleHead}>
      <div className={s.moduleTitle}>
        <h1>{copy.label}</h1>
        <span className={s.moduleTagline}>{copy.tagline}</span>
        {meta ? <span className={s.moduleMeta}>{meta}</span> : null}
      </div>
      {actions && <div className={s.moduleActions}>{actions}</div>}
    </div>
  );
}

export function ModuleContent({ children, noPad, className }: { children: ReactNode; noPad?: boolean; className?: string }) {
  return <div className={cx(s.content, noPad && s.noPad, className)}>{children}</div>;
}
