import { Fragment, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { BraceCode, Button, cx } from '@/design/primitives';
import { Glyph } from '@/design/Micro';
import { Seal } from '@/design/Seal';
import { Wordmark } from '@/design/Wordmark';
import { Modal } from '@/design/Modal';
import { OptionsMenu, type OptionItem } from '@/design/OptionsMenu';
import { desk, isDesk } from '@/lib/desk';
import { APP_VERSION } from '@/lib/version';
import { dateKeyLocal, ET_ZONE, etDateKey } from '@/lib/time';
import { useJournal } from '@/store/journal';
import { useUi, type TabId } from '@/store/ui';
import { useAgent } from '@/store/agent';
import { useAgentCloud } from '@/store/agentCloud';
import { useCalendar } from '@/store/calendar';
import { useCopier } from '@/store/copier';
import { useCrypto } from '@/store/crypto';
import { useLinks } from '@/store/links';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { ChangelogJournal } from './ChangelogJournal';
import { FriseDrawer } from './Frise';
import { FriseAnswer } from './FriseAnswer';
import { RailAccounts } from './RailAccounts';
import { SeatMark } from './SeatMark';
import { UpdateButton } from './UpdateButton';
import { ZoomControls } from './ZoomControls';
import { chooseLocale, LOCALES, tr, useI18n } from '@/i18n';
import { followerCount, railQuantity, type RailSnapshot } from './railQuantity';
import { LAYER_GLYPH, MODULE_LAYERS, layerCode, layerName } from './moduleLayers';
import { KillBand } from './KillBand';
import { useKillSwitch } from './killState';
import { ObjectCrumb, ObjectDrawer } from './objects/Fiche';
import { Omnibar } from './objects/Omnibar';
import { RailGates } from './RailGates';
import { useRegistre } from './registre';
import { RegistreDrawer } from './RegistreDrawer';
import { matchShortcut } from './shortcuts';
import { ShortcutHelp, useShortcutHelp } from './ShortcutHelp';
import { StatusBornes } from './StatusBornes';
import { useWallClock } from './useWallClock';
import { tabCopy, TABS } from './tabs';
import s from './shell.module.css';

/** Les zones du châssis que F6 parcourt, dans l'ordre : le rail, la zone de travail, la fiche, la barre d'état. */
const ZONES = ['[data-chassis="rail"]', 'main', 'aside[data-drawer]', '[data-chassis="status"]'] as const;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * F6 (ou Maj+F6) : le focus passe à la zone suivante (ou précédente). La fiche le prend elle-même (↑ ↓ y passent d'un
 * objet à l'autre) ; une autre zone, sur son premier élément actif ; une zone sans élément actif est sautée.
 */
function moveZone(step: 1 | -1): void {
  const zones = ZONES.map((selector) => document.querySelector<HTMLElement>(selector)).flatMap((zone) => {
    if (!zone) return [];
    // Un tiroir qui sort est inerte : son premier élément actif ne compte plus (POL2.2).
    const target = zone.matches('aside[data-drawer]') ? zone : [...zone.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => !el.closest('[inert]'));
    return target ? [{ zone, target }] : [];
  });
  if (zones.length === 0) return;
  const here = zones.findIndex(({ zone }) => zone.contains(document.activeElement));
  const next = zones[here < 0 ? (step > 0 ? 0 : zones.length - 1) : (here + step + zones.length) % zones.length]!;
  next.target.focus();
}

type ClockFace = '24' | '12';

/**
 * L'horloge de la barre d'état : New York seule (Système 5, décision 7 de l'ADMIN). Tokyo, Paris et le libellé de séance
 * « CME GLOBEX · ETH » cèdent leur place à la ligne de la journée ; l'ET est l'heure de la frise et des fiches.
 */
const NEW_YORK = { zone: ET_ZONE, code: 'NYC', city: ['New York', 'New York', 'Nueva York'] } as const;

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
  const toasts = useUi((u) => u.toasts);
  const dismiss = useUi((u) => u.dismiss);
  const sessions = useJournal((j) => j.sessions);
  const orchestrator = useAgent((a) => a.orchestrator);
  const reportsUnread = useAgentCloud((c) => c.status?.unread ?? null);
  const kill = useKillSwitch();
  // La barre d'état dit la minute : le châssis ne se rend qu'à sa frontière (POL9.1). Ce qui compte les secondes bat
  // de lui-même : l'âge du pont dans StatusBornes, la barre du dialogue dans sa fiche.
  const now = useWallClock(60_000);
  const noteCount = useNotes((n) => n.notes.length);
  const linkCount = useLinks((l) => l.links.length);
  const calendarEntries = useCalendar((c) => c.entries);
  const copierReady = useCopier((c) => c.ready);
  const copierFollowers = useCopier((c) => followerCount(c.accounts));
  const cryptoEnabled = useCrypto((c) => c.enabled);
  const cryptoMarkets = useCrypto((c) => c.watchlist.length);
  const openRef = useObjects((o) => o.open);
  const friseOpen = useUi((u) => u.friseOpen);
  const registreOpen = useRegistre((st) => st.open);
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

  // Le verrou du châssis tient aussi la fiche et ses sauts : sous lui, rien ne répond (src/store/objects.ts).
  useLayoutEffect(() => {
    useObjects.getState().setLocked(inert);
  }, [inert]);

  // Les touches du châssis, lues dans le registre des raccourcis (OROS5.18) : aucune n'est comparée ici.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = matchShortcut('desk', e);
      if (!hit) return;
      // Les modules du rail répondent comme avant, verrou compris.
      if (hit.id === 'module') {
        e.preventDefault();
        const next = TABS[hit.index];
        if (next) setTab(next.id);
        return;
      }
      // Le reste ne répond pas sous le verrou.
      if (inert || e.defaultPrevented) return;
      const dialog = !!document.querySelector('[role="dialog"][aria-modal="true"]');
      const objects = useObjects.getState();
      // L'omnibar (OROS5.17) : Ctrl+J, jamais Ctrl+K, voisin du kill switch Ctrl+Maj+K. Jamais par-dessus un dialogue ;
      // d'un champ, oui, comme toute fenêtre de navigation.
      if (hit.id === 'omnibar') {
        if (objects.omnibar) {
          e.preventDefault();
          objects.setOmnibar(false);
        } else if (!dialog) {
          e.preventDefault();
          objects.setOmnibar(true);
        }
        return;
      }
      if (dialog) return;
      // F6 passe d'une zone du châssis à l'autre, d'un champ comme d'ailleurs : la barre d'état s'atteint ainsi.
      if (hit.id === 'zones') {
        e.preventDefault();
        moveZone(hit.index === 0 ? 1 : -1);
        return;
      }
      // Le reste : jamais dans un champ, où la touche s'écrit ou édite.
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (hit.id === 'help') {
        e.preventDefault();
        useShortcutHelp.setState({ open: true });
      } else if (hit.id === 'close' && objects.open) {
        // Échap ferme la fiche et rend le focus à la ligne d'origine.
        e.preventDefault();
        objects.close();
      } else if (hit.id === 'back' && objects.history.length > 0) {
        // Retour arrière défait le dernier saut : le module, sa vue, la fiche et le fil reviennent.
        e.preventDefault();
        objects.back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab, inert]);

  const localeTag = locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'fr-FR';
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
  // L'« aujourd'hui » du rail et du Calendrier reste la date locale (décision 7) : la journée CME n'est que celle de la frise.
  const todayKey = dateKeyLocal(new Date(now));
  /** Bordereau du rail : ce que chaque module contient, lu dans les stores du démarrage. */
  const snapshot: RailSnapshot = {
    sessions: sessions.length,
    todayEntries: calendarEntries.filter((entry) => entry.date === todayKey).length,
    notes: noteCount,
    links: linkCount,
    agentRunning: orchestrator.running,
    agentReportsUnread: reportsUnread,
    copierFollowers: copierReady ? copierFollowers : null,
    cryptoEnabled,
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
    <div className={cx(s.shell, !revealed && s.pending, openRef && s.withDrawer)} inert={inert}>
      <div className={s.texture} aria-hidden />
      {/* Les trois lignes du châssis : le circuit de l'ouverture les trace là où elles sont (src/app/unlockCircuit.ts). */}
      <header className={s.title} data-chassis="title">
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
            {/* Le fil va jusqu'à l'objet ouvert, et porte celui d'où vient le dernier saut. */}
            {openRef ? <ObjectCrumb slash={s.slash} /> : null}
          </span>
        </div>
        <div className={s.titleRight}>
          {/* La version a quitté la barre de titre pour le pied, en bas à gauche (décision de l'ADMIN, 2026-11-07). */}
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

      {/* Niveau 3 : le kill switch est engagé ; la bande reste jusqu'au redémarrage du desk. */}
      {kill.engaged && <KillBand shortcut={kill.shortcut} />}

      <aside className={s.rail} data-chassis="rail">
        {/* Les modules en cartouches, sans catégorie : chacun son emblème, son nom, ce qu'il contient, son code au coin. */}
        <nav className={s.nav} aria-label={tr('Modules', 'Modules', 'Módulos')}>
          {TABS.map((item) => (
            <RailButton key={item.id} itemId={item.id} index={item.index} label={tabCopy(item).label} qty={railQuantity(item.id, snapshot)} on={tab === item.id} onClick={() => setTab(item.id)} link={item.id === 'agent' && orchestrator.running} />
          ))}
        </nav>
        {/* Les portes du process principal, en lecture, sous les cartouches (OROS5.25, décision 11) : compactées à l'étroit,
            elles ne déplacent ni le compte ni le sceau, qui restent au pied du rail. */}
        <RailGates />
        <div className={s.railFoot}>
          {/* Les comptes connectés au pont NT8, à la place de la cartouche « Tous les comptes » (décision de l'ADMIN,
              2026-11-07) : la micro, son voyant vert, le nom ; empilés s'ils sont plusieurs ; rien sans compte connecté. */}
          <RailAccounts />
          {/* La plaque réduite à sa marque (4.1) : le sceau du Lab gravé dans la nuit, le même qu'au verrou, puis les langues. */}
          <div className={s.signature}>
            <span className={s.sealMark} data-part="lab-seal">
              <Seal kind="negative" className={s.sealMarkSvg} label="SIΞRRΛSKΛ Lab" />
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
      </aside>

      {/* Un tiroir déplié (la frise, 64 px ; le registre, 240 px) recouvre le bas de la zone de travail : les messages montent
          au-dessus de lui. Les deux ne s'ouvrent pas ensemble. */}
      <main className={s.main} data-frise-open={friseOpen ? '' : undefined} data-registre-open={registreOpen ? '' : undefined}>
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

      {/* La fiche d'objet : la troisième colonne du châssis, hors de la zone de travail, inerte avec lui sous le verrou. */}
      <ObjectDrawer />

      <footer className={s.status} data-chassis="status">
        {/* Le tiroir de la frise (OROS5.24), déplié par la réponse au-dessus de la barre ; premier de la zone pour F6. */}
        <FriseDrawer className={s.friseDrawer} />
        {/* Le registre du lancement (OROS5.38), en tiroir bas de 240 px, ouvert par « Registre n » ou une fiche. */}
        <RegistreDrawer className={s.registreDrawer} />
        {/* La ligne de la journée (Système 5, décision 7) : le pont, les bornes, puis la réponse du temps. La version la
            précède, premier indicateur en bas à gauche du desk, et ouvre le journal (décision de l'ADMIN, 2026-11-07). */}
        <div className={s.statusLeft}>
          <span className={s.statusVersion} data-status="version">
            <ChangelogJournal version={appVersion} />
          </span>
          <i className={s.statusSep} aria-hidden />
          <StatusBornes />
          <i className={s.statusSep} aria-hidden />
          <FriseAnswer />
        </div>
        <div className={s.statusRight}>
          {/* New York reste (décision 7) : la date et l'heure de la séance, sur 24 ou 12 h. */}
          <span className={s.clocks} role="group" aria-label={tr('Heure de New York', 'New York time', 'Hora de Nueva York')}>
            <time className={s.sessionDate} dateTime={etDateKey(now)}>
              {sessionDate}
            </time>
            <span className={s.clock} title={tr(NEW_YORK.city[0], NEW_YORK.city[1], NEW_YORK.city[2])}>
              <b>{hour(NEW_YORK.zone)}</b>
              {NEW_YORK.code}
            </span>
            <span className={s.clockFace}>
              <button type="button" className={face === '24' ? s.on : undefined} aria-pressed={face === '24'} onClick={() => chooseFace('24')}>
                24
              </button>
              <button type="button" className={face === '12' ? s.on : undefined} aria-pressed={face === '12'} onClick={() => chooseFace('12')}>
                12
              </button>
            </span>
          </span>
          {/* La signature : le code d'accolades sous le geste du siège, puis le nom du Lab, sans losange entre eux
              (décision de l'ADMIN, 2026-11-07). */}
          <span className={s.sigEnd}>
            <SeatMark>
              <BraceCode />
            </SeatMark>
            <span className={s.stripName}>[ SIΞRRΛSKΛ ]</span>
          </span>
        </div>
      </footer>

      <ConfirmDialog />
      <Omnibar />
      <ShortcutHelp />
    </div>
  );
}

/**
 * Un onglet du rail (4.1) : une cartouche — filet d'un pixel, coin chanfreiné, fond à peine levé. L'emblème du module en
 * tête (composant de la planche), le nom et, dessous, ce que le module contient ; le numéro du raccourci en code, au coin,
 * sous le chanfrein. L'onglet ouvert s'allume : filet plus clair, lumière zénithale au sommet, l'emblème à l'or.
 */
function RailButton({ itemId, index, label, qty, on, link, onClick }: { itemId: TabId; index: string; label: string; qty?: string | null; on: boolean; link?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cx(s.navItem, on && s.on)} onClick={onClick} title={`${label} — Ctrl+${index.slice(-1)}`} aria-current={on ? 'page' : undefined} data-tab={itemId}>
      <Glyph name={itemId} className={s.navEmblem} />
      <span className={s.navText}>
        <span className={s.navHead}>
          <span className={s.navLabel}>{label}</span>
          {link ? <span className={s.lienBadge}>{tr('LIEN', 'LINK', 'ENLACE')}</span> : null}
        </span>
        {qty ? <RailQty text={qty} /> : null}
      </span>
      <span className={s.navIndex} data-part="rail-index" aria-hidden>
        {index}
      </span>
      <span className={s.srOnly}>{itemId}</span>
    </button>
  );
}

/**
 * La quantité sous le nom du module (4.1) : jamais coupée. Trop longue pour le rail, elle passe à la ligne, deux lignes au
 * plus ; faite de plusieurs parties, elle ne se brise qu'entre elles (« 2 notes · » puis « 472 liens »).
 */
function RailQty({ text }: { text: string }) {
  const parts = text.split(' · ');
  return (
    <span className={s.navQty}>
      {parts.length < 2
        ? text
        : parts.map((part, i) => (
            <Fragment key={i}>
              {i > 0 ? ' · ' : null}
              <span className={s.navQtyPart}>{part}</span>
            </Fragment>
          ))}
    </span>
  );
}

function ConfirmDialog() {
  const pending = useUi((u) => u.pendingConfirm);
  const resolve = useUi((u) => u.resolveConfirm);
  if (!pending) return null;
  return (
    <Modal
      title={pending.title}
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
 * En-tête de module (4.1) : numéro d'afficheur et nom sur une ligne, rien dessous. La couche du Lab tient en un seul
 * composant, posé après le nom ; un relevé du module (`meta`) le suit sur la même ligne. Puis le bloc-titre que le
 * module remplit de ses propres données, sans cellule passée aucun, ses actions, et ses options tout au bout.
 */
export function ModuleHeader({ tab, actions, options, crumb = '', meta, cells }: { tab: TabId; actions?: ReactNode; options?: OptionItem[]; crumb?: string; meta?: ReactNode; cells?: TitleCell[] }) {
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
      <h1 className={s.modulePlate} data-plate={tab}>
        <span className={s.moduleNum} aria-hidden>
          {def.index}
        </span>
        <span className={s.moduleName}>{copy.label}</span>
      </h1>
      {/* La couche du Lab à laquelle le module appartient : son seul composant de la planche (Ligne V2). */}
      <span className={s.moduleLayer} role="img" aria-label={`${tr('Couche', 'Layer', 'Capa')} ${layerCode(layer)} · ${layerName(layer)}`} data-layer={layer}>
        <Glyph name={LAYER_GLYPH[layer]} className={s.layerGlyph} />
      </span>
      {meta ? <span className={s.moduleMeta}>{meta}</span> : null}
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
      {actions || (options && options.length > 0) ? (
        <div className={s.moduleActions}>
          {actions}
          {/* Les options du module, au bout de la ligne, en haut à droite. */}
          {options && options.length > 0 ? <OptionsMenu items={options} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ModuleContent({ children, noPad, className }: { children: ReactNode; noPad?: boolean; className?: string }) {
  return <div className={cx(s.content, noPad && s.noPad, className)}>{children}</div>;
}
