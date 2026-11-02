import { useMemo } from 'react';
import { Glyph } from '@/design/Micro';
import { cx, Montant } from '@/design/primitives';
import type { CalEvent } from '@/engine/calendar';
import { catalystSource, familyKey } from '@/engine/macroMerge';
import { mirror, sampleOf, type EntityRef } from '@/engine/ontology';
import { tr, useI18n } from '@/i18n';
import { strokeOf, type Stroke } from '@/lib/calendarMarks';
import { trEventTitle } from '@/lib/eventTitles';
import { fmtInt, plural } from '@/lib/format';
import { ET_ZONE, etDateKey, formatDateFr, formatTimeLocal, zonedToUtc } from '@/lib/time';
import { useMacro } from '@/store/macro';
import { useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';
import { catalystSourceWord, copyAction, EtatMark, FicheHead, FicheSection, ficheTitle, LinksByPredicate, linkProvenance, MissingFiche, openDayAction, Properties, Provenance, type FicheAction } from './Fiche';
import { catalystWindow, dayWithYear, STROKE_ETAT, type IndexSources } from './index';
import { IdentityGrid, Mirror } from './Instruments';
import { sampleWord } from './sample';
import s from './fiche.module.css';

/**
 * La fiche Catalyseur (OROS5.29, Système 5 « Fiche et Frise » ; reprise de d1). Un repère du Calendrier l'ouvre, comme
 * l'omnibar et les liens « pendant ». Elle lit la source unique du catalyseur (OROS5.13) :
 * - M.057 : l'heure de New York au numéral, l'heure du poste dessous ; l'impact, l'état par le trait (publiée, à venir,
 *   au-delà de l'horizon), la période et les instruments ;
 * - ses occurrences, de la famille (`familyKey`), du début du journal à deux mois, chacune son trait et la séance du jour ;
 * - « Autour de… » : les séances liées « pendant » à la famille, et M.036 qui les met face au reste (`mirror`, au moteur),
 *   l'échantillon de chaque côté ;
 * - l'attendu, le précédent et le publié ; les liens ; la provenance.
 * Elle ne fait que lire.
 */

/** L'état d'une publication, en un mot ; le trait le dit déjà. Un repère local estimé dont l'heure est passée n'a rien publié. */
export function stateWord(event: Pick<CalEvent, 'actual' | 'estimated'>, stroke: Stroke): string {
  if (stroke === 'publie') return event.actual != null && event.actual !== '' ? tr('publiée', 'released', 'publicada') : event.estimated ? tr('passée', 'past', 'pasada') : tr('publiée', 'released', 'publicada');
  if (stroke === 'prevu') return tr('à venir', 'upcoming', 'por venir');
  return tr('au-delà de l’horizon', 'beyond the horizon', 'más allá del horizonte');
}

/** La catégorie d'un catalyseur, en mots. */
export function categoryWord(category: CalEvent['category']): string {
  switch (category) {
    case 'fed':
      return tr('Réserve fédérale', 'Federal Reserve', 'Reserva Federal');
    case 'banque-centrale':
      return tr('Banque centrale', 'Central bank', 'Banco central');
    case 'emploi':
      return tr('Emploi', 'Employment', 'Empleo');
    case 'inflation':
      return tr('Inflation', 'Inflation', 'Inflación');
    case 'croissance':
      return tr('Croissance', 'Growth', 'Crecimiento');
    case 'sentiment':
      return tr('Sentiment', 'Sentiment', 'Sentimiento');
    case 'resultats':
      return tr('Résultats', 'Earnings', 'Resultados');
    case 'energie':
      return tr('Énergie', 'Energy', 'Energía');
    case 'adjudication':
      return tr('Adjudication', 'Auction', 'Subasta');
    case 'cme':
      return tr('CME · contrats', 'CME · contracts', 'CME · contratos');
    case 'horaire':
      return tr('Horaires', 'Schedule', 'Horarios');
    case 'perso':
      return tr('Personnel', 'Personal', 'Personal');
  }
}

/** L'heure du poste d'une publication datée à New York ; « — » sans heure. */
export function localOf(event: Pick<CalEvent, 'date' | 'timeET'>): string | null {
  return event.timeET ? formatTimeLocal(zonedToUtc(event.date, event.timeET, ET_ZONE)) : null;
}

/** Le catalyseur d'un identifiant : la source unique du desk, et, au-delà de ses années, l'année que l'identifiant date. */
export function useCatalyst(id: string, ctx: IndexSources): CalEvent | null {
  const rows = useMacro((m) => m.events);
  return useMemo(() => {
    const own = ctx.catalysts.find((x) => x.id === id);
    if (own) return own;
    const year = Number(/(\d{4})-\d{2}-\d{2}/.exec(id)?.[1] ?? NaN);
    if (!Number.isInteger(year)) return null;
    return catalystSource(rows, [year]).find((x) => x.id === id) ?? null;
  }, [ctx.catalysts, id, rows]);
}

export function CatalystFiche({ target, ctx, now }: { target: EntityRef; ctx: IndexSources; now: number }) {
  useI18n((st) => st.locale);
  const event = useCatalyst(target.id, ctx);
  const openObject = useObjects((o) => o.openObject);
  // Les occurrences de la famille, sur la fenêtre de la fiche : du début du journal à deux mois au-delà d'aujourd'hui.
  const family = useMemo(() => {
    if (!event) return [];
    const key = familyKey(event.title);
    const span = catalystWindow(ctx.sessions, etDateKey(now));
    const seen = new Set<string>();
    return ctx.catalysts
      .filter((x) => familyKey(x.title) === key && x.date >= span.from && x.date <= span.to && !seen.has(x.id) && seen.add(x.id))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.timeET ?? '').localeCompare(b.timeET ?? ''));
  }, [event, ctx.catalysts, ctx.sessions, now]);
  // « Autour de… » : les séances liées « pendant » à l'une des publications de la famille, face au reste.
  const during = useMemo(() => {
    const ids = new Set(family.map((x) => x.id));
    if (event) ids.add(event.id);
    const out = new Set<string>();
    for (const link of ctx.links) {
      if (link.predicate !== 'pendant' || link.kind === 'rejete' || link.from.type !== 'session' || link.to.type !== 'evenement' || !ids.has(link.to.id)) continue;
      out.add(link.from.id);
    }
    return out;
  }, [family, event, ctx.links]);
  const reading = useMemo(() => mirror(ctx.sessions, ctx.trades, during), [ctx.sessions, ctx.trades, during]);
  if (!event) return <MissingFiche target={target} ctx={ctx} now={now} />;
  const stroke = strokeOf(event, now);
  const local = localOf(event);
  const published = family.filter((x) => strokeOf(x, now) === 'publie').length;
  const sessionsByDate = new Map<string, (typeof ctx.sessions)[number][]>();
  for (const x of ctx.sessions) sessionsByDate.set(x.date, [...(sessionsByDate.get(x.date) ?? []), x]);
  const daySession = sessionsByDate.get(event.date)?.[0];
  const actions: FicheAction[] = [
    openDayAction(event.date),
    ...(daySession
      ? [
          {
            id: 'visual',
            glyph: 'visual' as const,
            label: tr('Projeter la séance du jour dans Visual', 'Project the day’s session in Visual', 'Proyectar la sesión del día en Visual'),
            run: () => {
              useUi.getState().focusSession(daySession.id);
              useObjects.getState().jumpTo('visual');
            },
          },
        ]
      : []),
    copyAction(target),
  ];
  const scope = tr('tous les comptes · tout l’historique · tous instruments', 'all accounts · whole history · all instruments', 'todas las cuentas · todo el historial · todos los instrumentos');
  return (
    <>
      <FicheHead type="evenement" title={ficheTitle(target, { ...ctx, catalysts: ctx.catalysts.some((x) => x.id === event.id) ? ctx.catalysts : [...ctx.catalysts, event] }, now)} actions={actions} />
      <div className={s.body} data-fiche="evenement">
        <IdentityGrid
          label={tr('Identité du catalyseur', 'Catalyst identity', 'Identidad del catalizador')}
          lead={<span className={s.identText}>{categoryWord(event.category)}</span>}
          when={formatDateFr(event.date, { weekday: true, short: true })}
          numeral={event.timeET ? `${event.timeET} ET` : tr('journée', 'all day', 'jornada')}
          chars={event.timeET ? 8 : 7}
          sub={local ? `${local} ${tr('poste', 'local', 'local')}` : undefined}
          aside={
            <>
              <span className={cx(s.identStrong, s.nowrap)}>
                {tr('impact', 'impact', 'impacto')} {event.impact}/3
              </span>
              <span className={s.identState} data-state={stroke}>
                <EtatMark stroke={STROKE_ETAT[stroke]} />
                {stateWord(event, stroke)}
                {event.estimated ? ` · ${tr('estimée', 'estimated', 'estimada')}` : ''}
              </span>
            </>
          }
          foot={[event.period ?? '—', event.instruments?.length ? event.instruments.join(' · ') : tr('tous instruments', 'all instruments', 'todos los instrumentos')]}
        />

        <FicheSection part="around" title={tr('Autour de…', 'Around…', 'Alrededor de…')}>
          <p className={s.scopeLine}>{scope}</p>
          <p className={s.aroundLine}>
            <span className={s.predicate}>{tr('pendant', 'during', 'durante')}</span> {plural(during.size, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))} · {plural(reading.inside.trades, 'trade', 'trades')}
          </p>
          <Mirror inside={reading.inside} outside={reading.outside} leftTitle={tr('pendant', 'during', 'durante')} rightTitle={tr('hors', 'outside', 'fuera')} leftSample={sampleWord(sampleOf(reading.inside.trades))} rightSample={sampleWord(sampleOf(reading.outside.trades))} />
        </FicheSection>

        <FicheSection part="properties" title={tr('Propriétés', 'Properties', 'Propiedades')}>
          <Properties
            rows={[
              [tr('Attendu', 'Forecast', 'Esperado'), event.forecast || '—'],
              [tr('Précédent', 'Previous', 'Anterior'), event.previous || '—'],
              [tr('Publié', 'Actual', 'Publicado'), event.actual || '—'],
              [tr('Source', 'Source', 'Fuente'), catalystSourceWord(event.source, event.origin)],
            ]}
          />
        </FicheSection>

        <FicheSection part="occurrences" title={tr('Occurrences', 'Occurrences', 'Ocurrencias')} meta={`${fmtInt(family.length)} · ${fmtInt(published)} ${tr('passées', 'past', 'pasadas')} · ${fmtInt(family.length - published)} ${tr('à venir', 'upcoming', 'por venir')}`}>
          <div className={s.links}>
            {family.map((occ) => {
              const occStroke = strokeOf(occ, now);
              const day = sessionsByDate.get(occ.date) ?? [];
              const net = day.reduce((sum, x) => sum + x.pnl, 0);
              return (
                <div key={occ.id} className={cx(s.row, s.occRow, occ.id === event.id && s.occOn)} data-occurrence={occ.id} data-stroke={occStroke}>
                  <EtatMark stroke={STROKE_ETAT[occStroke]} />
                  <span className={s.occDate}>
                    {occ.estimated && !occ.actual ? '≈ ' : ''}
                    {dayWithYear(occ.date, now)}
                  </span>
                  <span className={s.rowMain}>
                    <span className={s.occText}>
                      {occ.timeET ? `${occ.timeET} ET` : tr('journée', 'all day', 'jornada')} · {tr('att.', 'exp.', 'esp.')} {occ.forecast ?? '—'} · {tr('préc.', 'prev.', 'ant.')} {occ.previous ?? '—'} · {tr('publ.', 'act.', 'publ.')} {occ.actual ?? '—'}
                    </span>
                  </span>
                  {day.length ? (
                    <button type="button" className={s.occSession} onClick={() => openObject({ type: 'session', id: day[0]!.id }, { jump: true })} aria-label={tr(`Séance du ${dayWithYear(occ.date, now)}`, `Session of ${dayWithYear(occ.date, now)}`, `Sesión del ${dayWithYear(occ.date, now)}`)}>
                      <Glyph name="session" className={s.occGlyph} />
                      <Montant value={net} className={net > 0 ? s.pos : net < 0 ? s.neg : undefined} />
                    </button>
                  ) : (
                    <span className={s.occNone}>—</span>
                  )}
                </div>
              );
            })}
          </div>
        </FicheSection>

        <FicheSection part="links" title={tr('Liens', 'Links', 'Enlaces')}>
          <LinksByPredicate target={target} ctx={ctx} now={now} />
        </FicheSection>

        <FicheSection part="provenance" title={tr('Provenance', 'Provenance', 'Procedencia')}>
          <Provenance
            lines={[
              `${trEventTitle(event.title)} · ${catalystSourceWord(event.source, event.origin)}`,
              event.estimated ? tr('Date estimée par récurrence, pas encore publiée', 'Date estimated by recurrence, not yet published', 'Fecha estimada por recurrencia, aún no publicada') : tr('Date publiée par la source', 'Date published by the source', 'Fecha publicada por la fuente'),
              tr('Occurrences : la famille du catalyseur, du début du journal à deux mois au-delà d’aujourd’hui', 'Occurrences: the catalyst’s family, from the journal start to two months past today', 'Ocurrencias: la familia del catalizador, del inicio del diario a dos meses después de hoy'),
              ...linkProvenance(target, ctx.links),
            ]}
          />
        </FicheSection>
      </div>
    </>
  );
}
