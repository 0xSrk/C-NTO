import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Barcode, Button, Led, cx } from '@/design/primitives';
import { Cartouche, Glyph } from '@/design/Micro';
import { Wordmark } from '@/design/Wordmark';
import { Modal } from '@/design/Modal';
import { BRIDGE_MAX_AGE_MS } from '@/engine/portfolio/types';
import { desk, isDesk } from '@/lib/desk';
import { APP_VERSION } from '@/lib/version';
import { cmeSession } from '@/lib/cmeClosed';
import { dateKeyLocal, ET_ZONE, etDateKey, globexState, type GlobexState } from '@/lib/time';
import { useJournal } from '@/store/journal';
import { useUi, type TabId } from '@/store/ui';
import { useAgent } from '@/store/agent';
import { useCalendar } from '@/store/calendar';
import { useCopier } from '@/store/copier';
import { useCrypto } from '@/store/crypto';
import { useLinks } from '@/store/links';
import { useNotes } from '@/store/notes';
import { isBridgeLive, useBridge } from '@/store/bridge';
import { ChangelogJournal } from './ChangelogJournal';
import { SeatMark } from './SeatMark';
import { UpdateButton } from './UpdateButton';
import { ZoomControls } from './ZoomControls';
import { chooseLocale, LOCALES, tr, useI18n } from '@/i18n';
import { railQuantity, type RailSnapshot } from './railQuantity';
import { LAYER_CARTOUCHE, LAYER_GLYPH, MODULE_LAYERS, layerCode, layerName } from './moduleLayers';
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

type ClockFace = '24' | '12';

const CLOCKS = [
  { zone: 'Asia/Tokyo', code: 'TYO', city: ['Tokyo', 'Tokyo', 'Tokio'] },
  { zone: 'Europe/Paris', code: 'PAR', city: ['Paris', 'Paris', 'París'] },
  { zone: 'America/New_York', code: 'NYC', city: ['New York', 'New York', 'Nueva York'] },
] as const;

/** Date de séance (New York), même ordre dans les trois langues : jour, quantième, mois. */
function sessionStamp(ms: number, localeTag: string): string {
  const parts = new Intl.DateTimeFormat(localeTag, { weekday: 'short', day: 'numeric', month: 'short', timeZone: ET_ZONE }).formatToParts(ms);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('weekday')} ${pick('day')} ${pick('month')}`.replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function readClockFace(): ClockFace {
  try {
    return localStorage.getItem('canto.clock') === '12' ? '12' : '24';
  } catch {
    return '24';
  }
}

export function Shell({ children, revealed = true, inert = false }: { children: ReactNode; revealed?: boolean; inert?: boolean }) {
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
  const noteCount = useNotes((n) => n.notes.length);
  const linkCount = useLinks((l) => l.links.length);
  const calendarEntries = useCalendar((c) => c.entries);
  const copierReady = useCopier((c) => c.ready);
  const copierAccounts = useCopier((c) => c.accounts.length);
  const cryptoMarkets = useCrypto((c) => c.watchlist.length);
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];
  const activeCopy = active ? tabCopy(active) : null;
  const [maximized, setMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState(APP_VERSION);
  const [face, setFace] = useState<ClockFace>(readClockFace);

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
      const m = /^Digit([1-9])$/.exec(e.code);
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
  const session = cmeSession(etDateKey(now));
  const phase = globexState(now, session.closed, session.earlyCloseMinute);
  const sessionDate = sessionStamp(now, localeTag);
  const hour = (zone: string) =>
    new Intl.DateTimeFormat(localeTag, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: face === '24' ? 'h23' : 'h12',
      timeZone: zone,
    }).format(now);
  const moduleName = (activeCopy?.label ?? '').toLocaleUpperCase(localeTag);
  const third = crumb && crumb.tab === tab ? crumb.label : '';
  const reported = nt?.accountNames?.filter(Boolean) ?? [];
  const todayKey = dateKeyLocal(new Date(now));
  /** Bordereau du rail : ce que chaque module contient, lu dans les stores du démarrage. */
  const snapshot: RailSnapshot = {
    sessions: sessions.length,
    todayEntries: calendarEntries.filter((entry) => entry.date === todayKey).length,
    notes: noteCount,
    links: linkCount,
    agentRunning: orchestrator.running,
    copierAccounts: copierReady ? copierAccounts : null,
    cryptoMarkets,
  };
  const chooseFace = (next: ClockFace) => {
    setFace(next);
    try {
      localStorage.setItem('canto.clock', next);
    } catch {
      /* navigation privée */
    }
  };

  return (
    <div className={cx(s.shell, revealed ? s.intro : s.pending)} inert={inert}>
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
          {/* Le losange du secteur S.01 (cartouche SK-SEC-S01) : le desk sert les marchés. */}
          <span className={s.sector} role="img" aria-label={tr('Secteur S.01 · Marchés', 'Sector S.01 · Markets', 'Sector S.01 · Mercados')}>
            <Cartouche id="sectorS01" />
          </span>
          <UpdateButton />
          <div className={s.titleZoom}>
            <ZoomControls />
          </div>
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
          <div className={s.navLabelHead}>
            <span>{tr('BORDEREAU', 'MANIFEST', 'ALBARÁN')}</span>
            <i aria-hidden />
            <span>
              {TABS.length} {tr('MODULES', 'MODULES', 'MÓDULOS')}
            </span>
          </div>
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
                <RailButton itemId={item.id} index={item.index} label={tabCopy(item).label} qty={railQuantity(item.id, snapshot)} on={tab === item.id} dashed={conception} onClick={() => setTab(item.id)} link={item.id === 'agent' && orchestrator.running} />
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
          {/* Plaque d'artefact (Système 4.0) : la cartouche SK-ART-002 du Lab, la version qui ouvre le journal, les langues. Le seul objet arrondi. */}
          <div className={s.plate} role="group" aria-label={tr(`Plaque d’artefact : SK-ART-002, CΛNTO, version ${appVersion}`, `Artefact plate: SK-ART-002, CΛNTO, version ${appVersion}`, `Placa del artefacto: SK-ART-002, CΛNTO, versión ${appVersion}`)}>
            <Cartouche id="artefact" values={{ build: `v${appVersion} · DESK`, runs: 'MACOS / WINDOWS / LINUX' }} className={s.plateLabel} />
            <div className={s.plateRow}>
              <span className={s.plateVer}>
                <ChangelogJournal version={appVersion} />
              </span>
              <div className={s.langRow} role="radiogroup" aria-label={tr('Langue du desk', 'Desk language', 'Idioma del desk')}>
                {LOCALES.map((item) => (
                  <button key={item.id} type="button" role="radio" aria-checked={locale === item.id} aria-label={item.label} title={item.label} className={cx(s.langBtn, locale === item.id && s.on)} onClick={() => void chooseLocale(item.id)}>
                    {item.id.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
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
          {nt?.heartbeatLatencyMs != null ? <span>{tr('LATENCE', 'LATENCY', 'LATENCIA')} {nt.heartbeatLatencyMs} MS</span> : null}
          <i className={s.statusSep} aria-hidden />
          <span className={s.session}>CME GLOBEX · {globexLabel(phase)}</span>
          <time className={s.sessionDate} dateTime={etDateKey(now)}>
            {sessionDate}
          </time>
          <span className={s.clocks} role="group" aria-label={tr('Heures Tokyo, Paris, New York', 'Tokyo, Paris, New York times', 'Horas Tokio, París, Nueva York')}>
            {CLOCKS.map((city) => (
              <span key={city.code} className={s.clock} title={tr(city.city[0], city.city[1], city.city[2])}>
                <b>{hour(city.zone)}</b>
                {city.code}
              </span>
            ))}
            <span className={s.clockFace}>
              <button type="button" className={face === '24' ? s.on : undefined} aria-pressed={face === '24'} onClick={() => chooseFace('24')}>
                24
              </button>
              <button type="button" className={face === '12' ? s.on : undefined} aria-pressed={face === '12'} onClick={() => chooseFace('12')}>
                12
              </button>
            </span>
          </span>
        </div>
        <div className={s.statusRight}>
          <span className={s.sigEnd}>
            <SeatMark>
              <Barcode />
            </SeatMark>
            <span className={s.stripName}>
              <Glyph name="lozenge" className={s.lozenge} />
              [ SIΞRRΛSKΛ ]
            </span>
          </span>
        </div>
      </footer>

      <ConfirmDialog />
    </div>
  );
}

function RailButton({ itemId, index, label, qty, on, dashed, link, onClick }: { itemId: TabId; index: string; label: string; qty?: string | null; on: boolean; dashed?: boolean; link?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cx(s.navItem, on && s.on, dashed && s.dashed)} onClick={onClick} title={`${label} — Ctrl+${index.slice(-1)}`} aria-current={on ? 'page' : undefined} data-tab={itemId}>
      {/* Le numéro, et sous lui l'emblème du module (composant de la planche). */}
      <span className={s.navCol} data-part="rail-index">
        <span className={s.navIndex}>{index}</span>
        <Glyph name={itemId} className={s.navEmblem} />
      </span>
      <span className={s.navText}>
        <span className={s.navLabel}>{label}</span>
        {qty ? <span className={s.navQty}>{qty}</span> : null}
      </span>
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

/** Une cellule du bloc-titre : un libellé et une valeur lue par le module (`plan` : valeur prévue, pas encore réelle). */
export interface TitleCell {
  label: string;
  value: ReactNode;
  plan?: boolean;
}

/**
 * En-tête de module (Système 4.0) : numéro d'afficheur, nom, code et baseline, puis le bloc-titre
 * que le module remplit de ses propres données. Sans cellule passée, pas de bloc-titre.
 */
export function ModuleHeader({ tab, actions, crumb = '', meta, cells }: { tab: TabId; actions?: ReactNode; crumb?: string; meta?: ReactNode; cells?: TitleCell[] }) {
  const setCrumb = useUi((u) => u.setCrumb);
  const def = TABS.find((item) => item.id === tab);
  useEffect(() => {
    if (def) setCrumb(tab, crumb);
  }, [crumb, def, setCrumb, tab]);
  if (!def) return null;
  const copy = tabCopy(def);
  const layer = MODULE_LAYERS[tab];
  return (
    <div className={s.moduleHead}>
      <h1 className={s.modulePlate}>
        <span className={s.moduleNum} aria-hidden>
          {def.index}
        </span>
        <span className={s.moduleTitle}>
          <span className={s.moduleName}>{copy.label}</span>
          <span className={s.moduleLine}>
            <span className={s.moduleCode}>{def.code}</span>
            <span className={s.moduleTagline}>{copy.tagline}</span>
            {meta ? <span className={s.moduleMeta}>{meta}</span> : null}
          </span>
        </span>
      </h1>
      {/* La couche du Lab à laquelle le module appartient : son composant et sa bande (Ligne V2). */}
      <span className={s.moduleLayer} role="img" aria-label={`${tr('Couche', 'Layer', 'Capa')} ${layerCode(layer)} · ${layerName(layer)}`} data-layer={layer}>
        <Glyph name={LAYER_GLYPH[layer]} className={s.layerGlyph} />
        <Cartouche id={LAYER_CARTOUCHE[layer]} className={s.layerBand} />
      </span>
      {cells && cells.length > 0 ? (
        <dl className={s.titleBlock}>
          {cells.map((cell) => (
            <div key={cell.label}>
              <dt>{cell.label}</dt>
              <dd className={cell.plan ? s.plan : undefined}>{cell.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions && <div className={s.moduleActions}>{actions}</div>}
    </div>
  );
}

export function ModuleContent({ children, noPad, className }: { children: ReactNode; noPad?: boolean; className?: string }) {
  return <div className={cx(s.content, noPad && s.noPad, className)}>{children}</div>;
}
