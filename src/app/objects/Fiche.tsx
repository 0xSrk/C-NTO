import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Glyph, type GlyphName } from '@/design/Micro';
import { TYPE_GLYPH } from '@/design/micro/meaning';
import e from '@/design/etat.module.css';
import { cx } from '@/design/primitives';
import { authorCounts, entityKey, groupNeighbors, kindCounts, neighborsOf, orderGroups, type EntityRef, type Link, type LinkKind, type Neighbor, type NeighborGroup, type Predicate } from '@/engine/ontology';
import { tr, useI18n } from '@/i18n';
import { publicationInstant } from '@/lib/calendarMarks';
import { fmtInt, plural } from '@/lib/format';
import { dateKeyLocal, formatDateFr, formatTimeLocal } from '@/lib/time';
import { deskEventLog, useDeskEvents } from '@/store/deskEvents';
import { useLinks } from '@/store/links';
import { previousObject, refKey, useObjects, type ObjectRef, type ObjectType } from '@/store/objects';
import { useUi } from '@/store/ui';
import { activityOf, eventLine, eventTarget, KIND_GLYPH, kindLabel, logEvents, openRegistre, registreClock, registreScope } from '../registre';
import { matchShortcut } from '../shortcuts';
import { objectGlyph, objectLabel, typeWord, useIndexSources, type EtatStroke, type IndexSources } from './index';
import { AccountFiche } from './AccountFiche';
import { CatalystFiche } from './CatalystFiche';
import { InstrumentFiche } from './InstrumentFiche';
import { NoteFiche } from './NoteFiche';
import { ProposalFiche } from './ProposalFiche';
import { SessionFiche } from './SessionFiche';
import { StrategyFiche } from './StrategyFiche';
import { TradeFiche } from './TradeFiche';
import { LinkMeta } from './Instruments';
import type { LightProps } from './useHoverLight';
import s from './fiche.module.css';

/**
 * La fiche d'objet (OROS5.16, Système 5 « Fiche et Frise » ; repris du prototype d1) : la troisième colonne du châssis,
 * 400 px à droite de la zone de travail, la même pour tous les objets. Le cadre commun : un en-tête (le glyphe du type, à
 * l'or pour l'objet ouvert, l'identifiant en clair, trois actions au plus), puis les Propriétés, les Liens par prédicat
 * et la Provenance. Les fiches propres à chaque type s'y posent ensuite (OROS5.26 à OROS5.29).
 *
 * La fiche lit et navigue : elle n'écrit rien. Une action ouvre un module, un autre objet, ou copie l'identifiant.
 */

export const capital = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** Le nom d'un prédicat, dans la langue du desk. */
export function predicateLabel(predicate: Predicate): string {
  switch (predicate) {
    case 'pendant':
      return tr('pendant', 'during', 'durante');
    case 'de-la-seance':
      return tr('de la séance', 'of the session', 'de la sesión');
    case 'applique':
      return tr('applique', 'applies', 'aplica');
    case 'mentionne':
      return tr('mentionne', 'mentions', 'menciona');
    case 'soutient':
      return tr('soutient', 'supports', 'respalda');
    case 'contredit':
      return tr('contredit', 'contradicts', 'contradice');
    case 'raffine':
      return tr('raffine', 'refines', 'refina');
    case 'partie-de':
      return tr('partie de', 'part of', 'parte de');
    case 'cause':
      return tr('cause', 'causes', 'causa');
    case 'relie':
      return tr('relie', 'relates', 'relaciona');
  }
}

/** Le trait d'un lien, dans la table d'états : structurel ou affirmé, en service ; hypothèse, tiretée ; rejeté, éteint. */
export const LINK_ETAT: Readonly<Record<LinkKind, EtatStroke>> = { structurel: 'plein', affirme: 'plein', hypothese: 'tirete', rejete: 'eteint' };

/** L'échantillon d'un trait de la table d'états, en tête d'une ligne : l'état, jamais une couleur. */
export function EtatMark({ stroke, className }: { stroke: EtatStroke; className?: string }) {
  return <i className={cx(s.etat, e[stroke], className)} data-etat={stroke} aria-hidden />;
}

/* ─── Le tiroir ─────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * La troisième colonne du châssis : posée tant qu'un objet est ouvert, enfant du châssis (hors de `main`), inerte avec lui
 * sous le verrou. Elle entre par l'opacité. ↑ ↓, la fiche ayant le focus, passent à l'objet voisin de la liste d'origine.
 */
export function ObjectDrawer() {
  useI18n((st) => st.locale);
  const open = useObjects((o) => o.open);
  const focusStamp = useObjects((o) => o.focusStamp);
  const step = useObjects((o) => o.step);
  const ref = useRef<HTMLElement>(null);
  const handled = useRef(focusStamp);
  useEffect(() => {
    if (focusStamp === handled.current) return;
    handled.current = focusStamp;
    ref.current?.focus();
  }, [focusStamp, open]);
  if (!open) return null;
  // ↑ (rang 0) ou ↓ (rang 1), lus dans le registre des raccourcis (OROS5.18), la fiche ayant le focus.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const key = matchShortcut('fiche', event);
    if (key?.id === 'neighbor' && step(key.index === 1 ? 1 : -1)) event.preventDefault();
  };
  return (
    <aside ref={ref} className={s.drawer} data-drawer={open.type} tabIndex={-1} aria-label={tr('Fiche de l’objet', 'Object record', 'Ficha del objeto')} onKeyDown={onKeyDown}>
      <ObjectFiche key={refKey(open)} target={open} />
    </aside>
  );
}

/** Le fil d'Ariane jusqu'à l'objet : l'objet d'où vient le dernier saut, en lien (Retour arrière), puis l'objet ouvert. */
export function ObjectCrumb({ slash }: { slash?: string }) {
  useI18n((st) => st.locale);
  const open = useObjects((o) => o.open);
  const previous = useObjects((o) => previousObject(o));
  const back = useObjects((o) => o.back);
  const stamp = useObjects((o) => o.stamp);
  const now = useMemo(() => Date.now(), [stamp]);
  const ctx = useIndexSources(now);
  if (!open) return null;
  const name = (ref: ObjectRef) => objectLabel(ref, ctx, now) ?? typeWord(ref.type);
  return (
    <>
      <span className={slash}>/</span>
      {previous ? (
        <>
          <button type="button" className={s.crumbLink} onClick={() => back()} title={tr('Revenir à cet objet · Retour arrière', 'Back to this object · Backspace', 'Volver a este objeto · Retroceso')}>
            {name(previous)}
          </button>
          <span className={s.crumbStep} aria-hidden>
            ›
          </span>
        </>
      ) : null}
      <button type="button" className={s.crumbObject} data-crumb="object" onClick={() => document.querySelector<HTMLElement>('[data-drawer]')?.focus()} title={tr('Aller à la fiche', 'Go to the record', 'Ir a la ficha')}>
        {name(open)}
      </button>
    </>
  );
}

/* ─── Le cadre commun ───────────────────────────────────────────────────────────────────────────────────────── */

export interface FicheAction {
  id: string;
  label: string;
  /** Le composant de la planche qui dit l'action (l'emblème du module qu'elle ouvre) ; sans lui, la copie. */
  glyph?: GlyphName;
  run: () => void;
}

/** Trois actions au plus : la fiche n'est pas une barre d'outils. */
export const FICHE_ACTIONS_MAX = 3;

/** L'en-tête : le glyphe du type, à l'or pour l'objet ouvert ; l'identifiant en clair ; les actions ; la fermeture. */
export function FicheHead({ type, title, actions }: { type: ObjectType; title: string; actions: readonly FicheAction[] }) {
  const close = useObjects((o) => o.close);
  return (
    <header className={s.head}>
      <Glyph name={objectGlyph(type)} className={s.headGlyph} label={capital(typeWord(type))} />
      <h2 className={s.headTitle} data-fiche="title">
        {title}
      </h2>
      <span className={s.headActions}>
        {actions.slice(0, FICHE_ACTIONS_MAX).map((action) => (
          <button key={action.id} type="button" className={s.iconBtn} onClick={action.run} title={action.label} aria-label={action.label} data-action={action.id}>
            {action.glyph ? (
              <Glyph name={action.glyph} className={s.iconGlyph} />
            ) : (
              <svg viewBox="0 0 12 12" className={s.iconSvg} aria-hidden>
                <path d="M4 1.5h6.5V8M1.5 4H8v6.5H1.5z" />
              </svg>
            )}
          </button>
        ))}
        <button type="button" className={s.iconBtn} onClick={() => close()} title={tr('Fermer · Échap', 'Close · Esc', 'Cerrar · Esc')} aria-label={tr('Fermer la fiche', 'Close the record', 'Cerrar la ficha')} data-action="close">
          <svg viewBox="0 0 12 12" className={s.iconSvg} aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </span>
    </header>
  );
}

export function FicheSection({ title, meta, children, part }: { title: ReactNode; meta?: ReactNode; children: ReactNode; part: string }) {
  return (
    <section className={s.section} data-section={part}>
      <header className={s.sectionHead}>
        <h3>{title}</h3>
        {meta != null ? <span>{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

export type PropertyRow = readonly [label: string, value: ReactNode];

/** Les propriétés : un libellé, une valeur ; une valeur absente se lit « — », jamais zéro. */
export function Properties({ rows }: { rows: readonly PropertyRow[] }) {
  return (
    <dl className={s.props}>
      {rows.map(([label, value]) => (
        <div key={label} className={s.prop}>
          <dt>{label}</dt>
          <dd>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** L'instant d'un objet, pour ranger ses voisins dans l'ordre du temps ; sans instant, il passe en dernier. */
export function objectInstant(ref: EntityRef, ctx: IndexSources): number | undefined {
  switch (ref.type) {
    case 'trade':
      return ctx.trades.find((t) => t.id === ref.id)?.entryTime;
    case 'session': {
      const date = ctx.sessions.find((x) => x.id === ref.id)?.date;
      return date ? Date.parse(`${date}T12:00:00Z`) : undefined;
    }
    case 'evenement': {
      const event = ctx.catalysts.find((x) => x.id === ref.id);
      return event ? publicationInstant(event) : undefined;
    }
    case 'note':
    case 'strategie':
      return ctx.notes.find((x) => x.id === ref.id)?.updatedAt;
    default:
      return undefined;
  }
}

/**
 * Les liens de l'objet, par prédicat, sens et type, dans l'ordre de lecture du moteur, chaque groupe dans l'ordre du
 * temps ; chacun ouvre son objet. Une fiche par type peut rendre les lignes d'un groupe à sa façon (`renderItem` : les
 * trades d'une séance sur leur axe en R) et relier chaque ligne à son nœud de M.016 (`light`, `useHoverLight`).
 */
export function LinksByPredicate({
  target,
  ctx,
  now,
  renderItem,
  light,
}: {
  target: EntityRef;
  ctx: IndexSources;
  now: number;
  /** La ligne d'un voisin rendue par la fiche du type ; `undefined` : la ligne commune. */
  renderItem?: (n: Neighbor, group: NeighborGroup) => ReactNode | undefined;
  light?: (key: string) => LightProps;
}) {
  useI18n((st) => st.locale);
  const openObject = useObjects((o) => o.openObject);
  // Le seul chemin d'écriture de la fiche (décision 12) : Promouvoir ou Rejeter une hypothèse, par le store des liens.
  const promote = useLinks((l) => l.promote);
  const reject = useLinks((l) => l.reject);
  const neighbors = useMemo(() => neighborsOf(target, ctx.links), [target, ctx.links]);
  const groups = useMemo(() => orderGroups(groupNeighbors(neighbors), (ref) => objectInstant(ref, ctx)), [neighbors, ctx]);
  const live = groups.filter((group) => group.count > 0);
  const rejected = useMemo(() => neighbors.filter((n) => n.link.kind === 'rejete'), [neighbors]);
  const open = (n: Neighbor) => openObject(n.ref, { jump: true });
  const name = (n: Neighbor) => objectLabel(n.ref, ctx, now);
  if (live.length === 0 && rejected.length === 0) return <p className={s.empty}>{tr('Aucun lien.', 'No link.', 'Ningún enlace.')}</p>;
  return (
    <div className={s.links}>
      {live.map((group) => (
        <div key={group.id} className={s.group} data-group={group.id}>
          <div className={s.groupHead}>
            <span className={s.predicate}>
              {group.side === 'out' ? '→' : '←'} {predicateLabel(group.predicate)}
            </span>
            <span className={s.groupName}>{capital(typeWord(group.type, group.count))}</span>
            <span className={s.groupCount}>{fmtInt(group.count)}</span>
          </div>
          {group.items.map((n) => {
            const own = renderItem?.(n, group);
            if (own !== undefined) return own;
            const label = name(n);
            const row = (
              <button key={n.link.id} type="button" className={cx(s.row, s.linkRow)} data-link={n.link.kind} data-by={n.link.by} onClick={() => open(n)} title={tr('Ouvrir sa fiche', 'Open its record', 'Abrir su ficha')} {...light?.(entityKey(n.ref))}>
                <EtatMark stroke={LINK_ETAT[n.link.kind]} />
                <Glyph name={TYPE_GLYPH[n.ref.type]} className={s.rowGlyph} />
                <span className={cx(s.rowMain, !label && s.rowMissing)}>{label ?? tr('Absent du coffre', 'Missing from the vault', 'Ausente de la caja')}</span>
                <LinkMeta link={n.link} />
                <span className={s.rowGo} aria-hidden>
                  →
                </span>
              </button>
            );
            if (n.link.kind !== 'hypothese') return row;
            // Une hypothèse se décide ici : Promouvoir l'affirme sous son prédicat, Rejeter la range parmi les rejetées.
            return (
              <div key={n.link.id} className={s.hypothesis} data-hypothesis={n.link.id}>
                {row}
                <span className={s.decide} role="group" aria-label={tr('Décider de l’hypothèse', 'Decide on the hypothesis', 'Decidir la hipótesis')}>
                  <button type="button" className={s.decideBtn} data-decide="promote" onClick={() => void promote(n.link.id, n.link.predicate)}>
                    {tr('Promouvoir', 'Promote', 'Promover')}
                  </button>
                  <button type="button" className={s.decideBtn} data-decide="reject" onClick={() => void reject(n.link.id)}>
                    {tr('Rejeter', 'Reject', 'Rechazar')}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ))}
      {/* Les hypothèses rejetées ne sont pas des voisins : comptées, masquées par défaut, sous C.042. */}
      {rejected.length > 0 ? (
        <details className={s.rejected} data-rejected={rejected.length}>
          <summary>
            <Glyph name="refused" className={s.rejectedGlyph} />
            {plural(rejected.length, tr('lien rejeté', 'rejected link', 'enlace rechazado'), tr('liens rejetés', 'rejected links', 'enlaces rechazados'))} · {tr('masqués', 'hidden', 'ocultos')}
          </summary>
          {rejected.map((n) => (
            <button key={n.link.id} type="button" className={cx(s.row, s.linkRow, s.rowMuted)} data-link="rejete" data-by={n.link.by} onClick={() => open(n)} title={tr('Ouvrir sa fiche', 'Open its record', 'Abrir su ficha')}>
              <EtatMark stroke={LINK_ETAT.rejete} />
              <Glyph name={TYPE_GLYPH[n.ref.type]} className={s.rowGlyph} />
              <span className={s.rowMain}>
                {predicateLabel(n.link.predicate)} · {name(n) ?? tr('Absent du coffre', 'Missing from the vault', 'Ausente de la caja')}
              </span>
              <LinkMeta link={n.link} />
              <span className={s.rowGo} aria-hidden>
                →
              </span>
            </button>
          ))}
        </details>
      ) : null}
    </div>
  );
}

export function Provenance({ lines }: { lines: readonly ReactNode[] }) {
  return (
    <ul className={s.prov}>
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}

/** La provenance des liens : leur genre, puis leur auteur. */
export function linkProvenance(target: EntityRef, links: readonly Link[]): string[] {
  const neighbors = neighborsOf(target, links);
  if (neighbors.length === 0) return [tr('Aucun lien au coffre.', 'No link in the vault.', 'Ningún enlace en la caja.')];
  const kinds = kindCounts(neighbors);
  const by = authorCounts(neighbors);
  return [
    tr(
      `Liens : ${fmtInt(kinds.structurel)} structurels, calculés par le moteur · ${fmtInt(kinds.affirme)} affirmés · ${fmtInt(kinds.hypothese)} hypothèses · ${fmtInt(kinds.rejete)} rejetés`,
      `Links: ${fmtInt(kinds.structurel)} structural, computed by the engine · ${fmtInt(kinds.affirme)} affirmed · ${fmtInt(kinds.hypothese)} hypotheses · ${fmtInt(kinds.rejete)} rejected`,
      `Enlaces: ${fmtInt(kinds.structurel)} estructurales, calculados por el motor · ${fmtInt(kinds.affirme)} afirmados · ${fmtInt(kinds.hypothese)} hipótesis · ${fmtInt(kinds.rejete)} rechazados`,
    ),
    tr(
      `Auteurs : moteur ${fmtInt(by.moteur)} · vous ${fmtInt(by.utilisateur)} · agent ${fmtInt(by.agent)}`,
      `Authors: engine ${fmtInt(by.moteur)} · you ${fmtInt(by.utilisateur)} · agent ${fmtInt(by.agent)}`,
      `Autores: motor ${fmtInt(by.moteur)} · usted ${fmtInt(by.utilisateur)} · agente ${fmtInt(by.agent)}`,
    ),
  ];
}

/* ─── Ce que les fiches par type partagent ──────────────────────────────────────────────────────────────────── */

/** L'instant d'une écriture au coffre, à l'heure du poste. */
export function stamped(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return `${formatDateFr(dateKeyLocal(new Date(ms)), { short: true })} ${formatTimeLocal(ms)}`;
}

export function sourceWord(source: string): string {
  if (source === 'ninjatrader') return 'NinjaTrader';
  if (source === 'csv') return tr('import CSV', 'CSV import', 'importación CSV');
  if (source === 'manuel') return tr('saisie manuelle', 'manual entry', 'entrada manual');
  if (source === 'demo') return tr('démonstration', 'demo', 'demostración');
  return source;
}


/** Un objet voisin, en lien : son glyphe et son nom ; il ouvre sa fiche par un saut. */
export function ObjectLink({ to, label, className }: { to: EntityRef; label: string; className?: string }) {
  const openObject = useObjects((o) => o.openObject);
  return (
    <button type="button" className={className ?? s.objLink} data-object={entityKey(to)} onClick={() => openObject(to, { jump: true })} title={tr('Ouvrir sa fiche', 'Open its record', 'Abrir su ficha')}>
      <Glyph name={TYPE_GLYPH[to.type]} className={s.objLinkGlyph} />
      <span>{label}</span>
    </button>
  );
}

/** Copier l'identifiant interne : le seul geste où la clé interne paraît (elle ne s'écrit jamais dans la fiche). */
export function copyAction(target: ObjectRef): FicheAction {
  return {
    id: 'copy',
    label: tr('Copier l’identifiant interne', 'Copy the internal identifier', 'Copiar el identificador interno'),
    run: () => {
      void navigator.clipboard?.writeText(target.id).then(
        () => useUi.getState().toast(tr('Identifiant copié', 'Identifier copied', 'Identificador copiado'), 'ok'),
        () => undefined,
      );
    },
  };
}

/** Ouvrir le jour au Calendrier : un saut, que Retour arrière défait. */
export function openDayAction(date: string): FicheAction {
  return {
    id: 'calendar',
    glyph: 'calendrier',
    label: tr('Ouvrir le jour au Calendrier', 'Open the day in the Calendar', 'Abrir el día en el Calendario'),
    run: () => {
      useUi.getState().focusOnDate(date);
      useObjects.getState().jumpTo('calendrier');
    },
  };
}

/** Les actions d'une séance : le jour au Calendrier, la projection dans Visual, la copie de l'identifiant. */
export function sessionActions(target: EntityRef, session: { id: string; date: string }): FicheAction[] {
  return [
    openDayAction(session.date),
    {
      id: 'visual',
      glyph: 'visual',
      label: tr('Projeter dans Visual', 'Project in Visual', 'Proyectar en Visual'),
      run: () => {
        useUi.getState().focusSession(session.id);
        useObjects.getState().jumpTo('visual');
      },
    },
    copyAction(target),
  ];
}

/** L'identifiant en clair, en tête de fiche : « Séance · 14.10 · Apex-PA-50K ». */
export function ficheTitle(target: EntityRef, ctx: IndexSources, now: number): string {
  return `${capital(typeWord(target.type))} · ${objectLabel(target, ctx, now) ?? '—'}`;
}

/** La source d'une publication, dans la langue du desk. */
export function catalystSourceWord(source: string | undefined, origin: string | undefined): string {
  if (!source || source === 'local') return tr('repère local du desk', 'desk local marker', 'hito local del desk');
  if (source === 'bundle') return `${tr('calendrier embarqué', 'embedded calendar', 'calendario embebido')}${origin ? ` · ${origin.toUpperCase()}` : ''}`;
  return source.toUpperCase();
}

/** Une fiche : le cadre commun, rempli de ce que le type de l'objet dit. */
export function ObjectFiche({ target }: { target: ObjectRef }) {
  useI18n((st) => st.locale);
  const stamp = useObjects((o) => o.stamp);
  const now = useMemo(() => Date.now(), [stamp]);
  const ctx = useIndexSources(now);
  // Une fiche par type, sur le même cadre (OROS5.26 à OROS5.29) ; un objet absent du coffre garde le cadre seul. Une
  // proposition de l'agent n'est pas au coffre : sa fiche la lit en mémoire (OROS5.39).
  switch (target.type) {
    case 'proposition':
      return <ProposalFiche target={target} ctx={ctx} now={now} />;
    case 'session':
      if (ctx.sessions.some((x) => x.id === target.id)) return <SessionFiche target={target} ctx={ctx} now={now} />;
      break;
    case 'compte':
      if (target.id.trim()) return <AccountFiche target={target} ctx={ctx} now={now} />;
      break;
    case 'trade':
      if (ctx.trades.some((x) => x.id === target.id)) return <TradeFiche target={target} ctx={ctx} now={now} />;
      break;
    case 'note':
      if (ctx.notes.some((x) => x.id === target.id)) return <NoteFiche target={target} ctx={ctx} now={now} />;
      break;
    case 'strategie':
      if (ctx.notes.some((x) => x.id === target.id)) return <StrategyFiche target={target} ctx={ctx} now={now} />;
      break;
    case 'instrument':
      if (target.id.trim()) return <InstrumentFiche target={target} ctx={ctx} now={now} />;
      break;
    case 'evenement':
      return <CatalystFiche target={target} ctx={ctx} now={now} />;
  }
  return <MissingFiche target={target} ctx={ctx} now={now} />;
}

/** Au plus tant de lignes d'activité dans une fiche ; le registre entier dit le reste. */
export const ACTIVITY_MAX = 12;

/**
 * La section Activité de chaque fiche (OROS5.38) : le registre du lancement (`deskEventLog`), filtré sur l'objet, du plus
 * récent au plus ancien — l'heure de New York, le glyphe du genre (aucun signe réservé), ce qui s'est passé. Chaque ligne
 * ouvre la fiche de son objet, par un saut que Retour arrière défait ; « Tout le registre » ouvre le tiroir bas. La portée
 * est écrite : depuis l'ouverture, en mémoire, 500 au plus. Lecture seule.
 */
export function ActivitySection({ target, ctx }: { target: ObjectRef; ctx: IndexSources }) {
  useI18n((st) => st.locale);
  const count = useDeskEvents((d) => d.count);
  const openObject = useObjects((o) => o.openObject);
  const events = useMemo(() => activityOf(target, logEvents(deskEventLog), ctx), [target, ctx, count]);
  const shown = events.slice(0, ACTIVITY_MAX);
  return (
    <FicheSection part="activity" title={tr('Activité', 'Activity', 'Actividad')} meta={plural(events.length, tr('événement', 'event', 'evento'), tr('événements', 'events', 'eventos'))}>
      <p className={s.activityScope}>{registreScope()}</p>
      {shown.length === 0 ? (
        <p className={s.empty}>{tr('Rien depuis l’ouverture.', 'Nothing since opening.', 'Nada desde la apertura.')}</p>
      ) : (
        <ol className={s.activity}>
          {shown.map((ev) => {
            const line = eventLine(ev);
            const to = eventTarget(ev, ctx);
            const body = (
              <>
                <time className={s.activityTime} dateTime={new Date(ev.at).toISOString()}>
                  {registreClock(ev.at)}
                </time>
                <Glyph name={KIND_GLYPH[ev.kind]} className={s.activityGlyph} />
                <span className={s.activityText}>
                  <b>{kindLabel(ev.kind)}</b> · {line.object} · {line.detail}
                </span>
              </>
            );
            return (
              <li key={ev.seq} data-seq={ev.seq} data-kind={ev.kind}>
                {to ? (
                  <button type="button" className={s.activityRow} onClick={() => openObject(to, { jump: true })}>
                    {body}
                  </button>
                ) : (
                  <span className={s.activityRow}>{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <button type="button" className={s.activityAll} data-registre-open="" onClick={(event) => openRegistre(event.currentTarget)}>
        {tr('Tout le registre', 'The whole log', 'Todo el registro')}
      </button>
    </FicheSection>
  );
}

/** Un objet qui n'est plus au coffre (un lien vers une séance supprimée) : le cadre seul, ses liens et leur provenance. */
export function MissingFiche({ target, ctx, now }: { target: EntityRef; ctx: IndexSources; now: number }) {
  return (
    <>
      <FicheHead type={target.type} title={ficheTitle(target, ctx, now)} actions={[copyAction(target)]} />
      <div className={s.body} data-fiche="missing">
        <p className={s.empty}>{tr('Cet objet n’est plus au coffre.', 'This object is no longer in the vault.', 'Este objeto ya no está en la caja.')}</p>
        <FicheSection part="links" title={tr('Liens', 'Links', 'Enlaces')} meta={plural(neighborsOf(target, ctx.links).filter((n) => n.link.kind !== 'rejete').length, tr('lien', 'link', 'enlace'), tr('liens', 'links', 'enlaces'))}>
          <LinksByPredicate target={target} ctx={ctx} now={now} />
        </FicheSection>
        <ActivitySection target={target} ctx={ctx} />
        <FicheSection part="provenance" title={tr('Provenance', 'Provenance', 'Procedencia')}>
          <Provenance lines={linkProvenance(target, ctx.links)} />
        </FicheSection>
      </div>
    </>
  );
}
