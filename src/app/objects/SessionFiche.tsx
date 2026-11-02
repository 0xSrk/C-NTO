import { useMemo } from 'react';
import { Glyph } from '@/design/Micro';
import { cx, Montant } from '@/design/primitives';
import type { DisciplineFinding } from '@/engine/discipline';
import { egoNodes, entityKey, groupNeighbors, kindCounts, neighborsOf, orderGroups, rDomain, releaseLabel, tradeReleaseDistance, type EgoRay, type EntityRef, type Neighbor, type NeighborGroup } from '@/engine/ontology';
import { findPlan } from '@/engine/propfirm';
import { tradeRisk } from '@/engine/riskConsole';
import type { Session, Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { trEventTitle } from '@/lib/eventTitles';
import { fmtInt, fmtUsd, plural } from '@/lib/format';
import { replayDiscipline } from '@/lib/frise';
import { formatDateFr } from '@/lib/time';
import { useObjects } from '@/store/objects';
import { useSettings } from '@/store/settings';
import { EtatMark, FicheHead, FicheSection, LINK_ETAT, LinksByPredicate, linkProvenance, objectInstant, ObjectLink, predicateLabel, Properties, Provenance, sessionActions, sourceWord, stamped, ficheTitle, type PropertyRow } from './Fiche';
import { catalystTitle, etClock, typeWord, type IndexSources } from './index';
import { EgoGraph, fmtR, IdentityGrid, RScaleBar, type EgoLabel } from './Instruments';
import { useHoverLight, type LightProps } from './useHoverLight';
import s from './fiche.module.css';

/**
 * La fiche Séance (OROS5.26, Système 5 « Fiche et Frise » ; reprise du prototype d1, corrigée par le juge Ligne V2 et
 * l'audit). Elle se pose sur le cadre commun de la fiche (`FicheHead`, `FicheSection`, `LinksByPredicate`, `Properties`,
 * `Provenance`) et ne fait que lire :
 * - M.057 : le P&L net au numéral, le compte en lien (C.065), la date, les instruments, les étiquettes, les trades et
 *   leurs gagnants, la commission ;
 * - M.016 : ce qui encadre la séance en haut, ce qui la compose en bas, chaque arc dans l'ordre du temps ; rayons au
 *   glacier, l'hypothèse au halo tireté ;
 * - les liens par prédicat avec leur compte ; les trades sur un axe en R commun (M.022, le stop en simple trait) et leur
 *   distance à la publication, à la minute, lue au moteur (`tradeReleaseDistance`) ;
 * - les écarts rejoués comme le couloir Desk de la frise (`replayDiscipline` : `detectDrifts`, `detectRuleBreaches`) ;
 * - la provenance par genre de lien.
 * Le survol relie un nœud à sa ligne par un seul crochet (`useHoverLight`). Aucune écriture : une ligne ouvre un objet.
 */

const signedClass = (v: number) => (v > 0 ? s.pos : v < 0 ? s.neg : undefined);

/** Le nombre de signes d'un montant, pour le corps du numéral. */
const montantChars = (v: number) => fmtUsd(v, { cents: true, sign: true }).length;

/** « Mer. 14.10.2026 » : le jour de la semaine et la date, dans la langue du desk. */
function dayStamp(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDateFr(date, { weekday: true, short: true }) : date;
}

/** Un écart rejoué, en mots : ce qui s'est passé à l'entrée, avec ses chiffres. */
export function findingWords(finding: Pick<DisciplineFinding, 'kind' | 'detail' | 'instrument'>): string {
  const d = finding.detail;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  switch (finding.kind) {
    case 'revenge_entry': {
      const min = num(d.minutesAfterLoss);
      const loss = num(d.lossPnl);
      const lossText = loss !== null ? fmtUsd(loss, { cents: true }).replace(/^-/, '−') : '—';
      return tr(
        `entrée ${min !== null ? fmtInt(min) : '—'} min après une perte de ${lossText} (fenêtre ${fmtInt(num(d.windowMin))} min)`,
        `entry ${min !== null ? fmtInt(min) : '—'} min after a ${lossText} loss (window ${fmtInt(num(d.windowMin))} min)`,
        `entrada ${min !== null ? fmtInt(min) : '—'} min tras una pérdida de ${lossText} (ventana ${fmtInt(num(d.windowMin))} min)`,
      );
    }
    case 'size_up_after_loss': {
      const ratio = num(d.ratio);
      const x = ratio !== null ? `×${String(ratio).replace('.', tr(',', '.', ','))}` : '—';
      return tr(`taille ${x} après un trade perdant`, `size ${x} after a losing trade`, `tamaño ${x} tras un trade perdedor`);
    }
    case 'catalyst_window': {
      const min = num(d.minutesFromCatalyst);
      const at = min === null ? '—' : Math.round(min) === 0 ? '0 min' : `${min < 0 ? '−' : '+'}${fmtInt(Math.abs(min))} min`;
      const title = trEventTitle(String(d.title ?? ''));
      return tr(
        `${title} à ${String(d.timeET ?? '')} ET : entrée à ${at}, fenêtre ± ${fmtInt(num(d.windowMin))} min`,
        `${title} at ${String(d.timeET ?? '')} ET: entry at ${at}, window ± ${fmtInt(num(d.windowMin))} min`,
        `${title} a las ${String(d.timeET ?? '')} ET: entrada a ${at}, ventana ± ${fmtInt(num(d.windowMin))} min`,
      );
    }
    case 'over_max_trades':
      return tr(`trade n° ${fmtInt(num(d.ordinal))}, au-delà du maximum de ${fmtInt(num(d.max))}`, `trade no. ${fmtInt(num(d.ordinal))}, beyond the maximum of ${fmtInt(num(d.max))}`, `trade n.º ${fmtInt(num(d.ordinal))}, más allá del máximo de ${fmtInt(num(d.max))}`);
    case 'after_daily_limit': {
      const source = d.source === 'plan' ? tr('plan', 'plan', 'plan') : tr('règle du trader', 'trader rule', 'regla del trader');
      return tr(
        `entrée après la perte du jour atteinte : ${fmtUsd(num(d.loss))} sur ${fmtUsd(num(d.limit))} (${source})`,
        `entry after the day loss was reached: ${fmtUsd(num(d.loss))} of ${fmtUsd(num(d.limit))} (${source})`,
        `entrada tras alcanzar la pérdida del día: ${fmtUsd(num(d.loss))} de ${fmtUsd(num(d.limit))} (${source})`,
      );
    }
    case 'instrument_not_allowed': {
      const symbol = typeof d.symbol === 'string' ? d.symbol : finding.instrument;
      return tr(`${symbol} hors des instruments autorisés`, `${symbol} is not an allowed instrument`, `${symbol} fuera de los instrumentos autorizados`);
    }
  }
}

/** Le nom court d'un écart : dérive après une perte, ou règle du trader. */
function findingName(finding: Pick<DisciplineFinding, 'kind'>): string {
  switch (finding.kind) {
    case 'revenge_entry':
      return tr('Revanche', 'Revenge', 'Revancha');
    case 'size_up_after_loss':
      return tr('Taille relevée', 'Size up', 'Tamaño subido');
    case 'catalyst_window':
      return tr('Fenêtre', 'Window', 'Ventana');
    case 'over_max_trades':
      return tr('Trades max.', 'Max trades', 'Trades máx.');
    case 'after_daily_limit':
      return tr('Perte du jour', 'Day loss', 'Pérdida del día');
    case 'instrument_not_allowed':
      return tr('Instrument', 'Instrument', 'Instrumento');
  }
}

/** Une ligne de trade : l'entrée et la sortie (ET), le sens, la distance à la publication, l'échelle en R, le P&L. */
function TradeLine({ n, trade, release, risk, domain, light }: { n: Neighbor; trade: Trade; release: string; risk: ReturnType<typeof tradeRisk> | null; domain: ReturnType<typeof rDomain>; light: LightProps }) {
  const openObject = useObjects((o) => o.openObject);
  const exit = Number.isFinite(trade.exitTime) ? etClock(trade.exitTime) : '—';
  return (
    <button type="button" className={cx(s.row, s.tradeRow)} data-link={n.link.kind} data-trade={trade.id} onClick={() => openObject(n.ref, { jump: true })} title={tr('Ouvrir sa fiche', 'Open its record', 'Abrir su ficha')} {...light}>
      <EtatMark stroke={LINK_ETAT[n.link.kind]} />
      <Glyph name="trade" className={s.rowGlyph} />
      <span className={s.tradeTime}>
        <b>
          {etClock(trade.entryTime)} → {exit} ET
        </b>
        <small>
          {trade.direction === 'long' ? 'L' : 'S'} {fmtInt(trade.qty)} {trade.instrument}
          {release !== '—' ? (
            <>
              {' · '}
              <span className={s.release} data-release="">
                {release}
              </span>
            </>
          ) : null}
        </small>
      </span>
      <RScaleBar risk={risk?.risk ?? null} realizedR={risk?.realizedR ?? null} plannedRr={risk?.plannedRr ?? null} domain={domain} />
      <Montant value={trade.pnl} className={cx(s.tradePnl, signedClass(trade.pnl))} />
    </button>
  );
}

export function SessionFiche({ target, ctx, now }: { target: EntityRef; ctx: IndexSources; now: number }) {
  useI18n((st) => st.locale);
  const riskPerContract = useSettings((st) => st.settings.riskPerContract);
  const rules = useSettings((st) => st.settings.traderRules);
  const planId = useSettings((st) => st.settings.planId);
  const planAccount = useSettings((st) => st.settings.planAccount);
  const openObject = useObjects((o) => o.openObject);
  const { lit, light } = useHoverLight();
  const session: Session | undefined = ctx.sessions.find((x) => x.id === target.id);
  const own = useMemo(() => ctx.trades.filter((t) => t.sessionId === target.id).sort((a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id)), [ctx.trades, target.id]);
  const neighbors = useMemo(() => neighborsOf(target, ctx.links), [target, ctx.links]);
  const groups = useMemo(() => orderGroups(groupNeighbors(neighbors), (ref) => objectInstant(ref, ctx)), [neighbors, ctx]);
  // Un seul axe en R pour toute la fiche : les trades se comparent d'une ligne à l'autre (le risque ne dépend pas du capital).
  const risks = useMemo(() => new Map(own.map((t) => [t.id, tradeRisk(t, riskPerContract)])), [own, riskPerContract]);
  const domain = useMemo(() => rDomain([...risks.values()]), [risks]);
  // La distance à la publication, au moteur : la publication liée par « pendant » la plus proche de l'entrée.
  const releases = useMemo(() => new Map(own.map((t) => [t.id, releaseLabel(tradeReleaseDistance(t, ctx.links, ctx.catalysts))])), [own, ctx.links, ctx.catalysts]);
  // Les écarts rejoués comme le couloir Desk de la frise : la même fonction, sur les trades de la séance.
  const findings = useMemo(() => (own.length ? replayDiscipline(own, ctx.catalysts, rules, findPlan(planId), planAccount) : []), [own, ctx.catalysts, rules, planId, planAccount]);

  if (!session) return null;
  const tradeById = new Map(own.map((t) => [t.id, t]));
  const wins = own.filter((t) => t.pnl > 0).length;
  const total = own.length || session.tradeCount;
  const counts = kindCounts(neighbors);
  const live = neighbors.length - counts.rejete;
  const account = session.account?.trim() ?? '';

  const nodes = egoNodes(groups);
  const labelOf = (ray: EgoRay): EgoLabel => {
    const predicate = predicateLabel(ray.group.split(':')[1] as Parameters<typeof predicateLabel>[0]);
    if (ray.count > 1) return { text: `${fmtInt(ray.count)} ${typeWord(ray.type, ray.count)}`, meta: predicate };
    if (!ray.ref) return { text: '—' };
    if (ray.type === 'trade') {
      // Le nœud se rattache à sa ligne par l'heure d'entrée (ET) et le R : le P&L reste à la ligne, en montant.
      const t = tradeById.get(ray.ref.id);
      if (!t) return { text: '—' };
      const r = risks.get(t.id)?.realizedR ?? null;
      return { text: `${etClock(t.entryTime)} ET`, value: r !== null ? `${fmtR(r)} R` : 'R —', tone: r !== null ? (r >= 0 ? 'pos' : 'neg') : undefined };
    }
    if (ray.type === 'evenement') {
      const event = ctx.catalysts.find((x) => x.id === ray.ref?.id);
      return event ? { text: catalystTitle(event), meta: event.timeET ? `${event.timeET} ET` : tr('journée', 'all day', 'jornada') } : { text: '—' };
    }
    if (ray.type === 'note' || ray.type === 'strategie') {
      const note = ctx.notes.find((x) => x.id === ray.ref?.id);
      return { text: note?.title.trim() || tr('Sans titre', 'Untitled', 'Sin título'), meta: predicate };
    }
    return { text: ray.ref.id, meta: predicate };
  };
  const openRay = (ray: EgoRay) => {
    if (ray.ref && ray.count === 1) openObject(ray.ref, { jump: true });
  };

  /** Les trades de la séance : chacun sur l'axe commun, avec sa distance à la publication ; les autres groupes, la ligne commune. */
  const renderItem = (n: Neighbor, group: NeighborGroup) => {
    if (group.id !== 'in:de-la-seance:trade') return undefined;
    const t = tradeById.get(n.ref.id);
    if (!t) return undefined;
    return <TradeLine key={n.link.id} n={n} trade={t} release={releases.get(t.id) ?? '—'} risk={risks.get(t.id) ?? null} domain={domain} light={light(entityKey(n.ref))} />;
  };

  const properties: PropertyRow[] = [
    [tr('Éval.', 'Rating', 'Eval.'), session.rating ? `${session.rating} / 5` : '—'],
    [tr('Note de séance', 'Session note', 'Nota de sesión'), session.note ? <span className={s.quote}>{session.note}</span> : '—'],
    [tr('Gains · pertes bruts', 'Gross wins · losses', 'Ganancias · pérdidas brutas'), `${fmtUsd(session.grossProfit, { cents: true })} · ${fmtUsd(session.grossLoss, { cents: true }).replace(/^-/, '−')}`],
    [tr('Contrat', 'Contract', 'Contrato'), session.contractMonth ?? '—'],
    [tr('Modifiée', 'Updated', 'Modificada'), stamped(session.updatedAt)],
  ];

  return (
    <>
      <FicheHead type="session" title={ficheTitle(target, ctx, now)} actions={sessionActions(target, session)} />
      <div className={s.body}>
        <IdentityGrid
          label={tr('Identité de la séance', 'Session identity', 'Identidad de la sesión')}
          lead={account ? <ObjectLink to={{ type: 'compte', id: account }} label={account} className={s.identLink} /> : <span className={s.identText}>{tr('sans compte', 'no account', 'sin cuenta')}</span>}
          when={dayStamp(session.date)}
          numeral={<Montant value={session.pnl} className={signedClass(session.pnl)} />}
          chars={montantChars(session.pnl)}
          sub={`${tr('net', 'net', 'neto')} · USD`}
          aside={
            <>
              <span className={s.identStrong}>{session.instruments.join(' · ') || '—'}</span>
              <span className={s.identUnit}>{session.tags.length ? session.tags.join(' · ') : tr('sans étiquette', 'no tag', 'sin etiqueta')}</span>
            </>
          }
          foot={[
            <span key="t" className={s.nowrap}>
              {plural(total, 'trade', 'trades')} · {fmtInt(wins)}/{fmtInt(total)} {tr('gagnants', 'winners', 'ganadores')}
            </span>,
            `${tr('comm.', 'comm.', 'com.')} ${fmtUsd(-Math.abs(session.commission), { cents: true }).replace(/^-/, '−')}`,
          ]}
        />

        {live > 0 ? (
          <EgoGraph
            center="session"
            nodes={nodes}
            labelOf={labelOf}
            onOpen={openRay}
            light={light}
            lit={lit}
            label={tr(
              `Graphe d’ego de la séance : ${plural(live, 'lien')}, ${plural(counts.hypothese, 'hypothèse')}`,
              `Session ego graph: ${plural(live, 'link')}, ${plural(counts.hypothese, 'hypothesis', 'hypotheses')}`,
              `Grafo de ego de la sesión: ${plural(live, 'enlace')}, ${plural(counts.hypothese, 'hipótesis', 'hipótesis')}`,
            )}
          />
        ) : null}

        <FicheSection part="links" title={tr('Liens', 'Links', 'Enlaces')} meta={plural(live, tr('lien', 'link', 'enlace'), tr('liens', 'links', 'enlaces'))}>
          <LinksByPredicate target={target} ctx={ctx} now={now} renderItem={renderItem} light={light} />
        </FicheSection>

        <FicheSection part="drifts" title={tr('Écarts', 'Deviations', 'Desvíos')} meta={plural(findings.length, tr('rejoué', 'replayed', 'repetido'), tr('rejoués', 'replayed', 'repetidos'))}>
          {findings.length === 0 ? (
            <p className={s.empty}>{tr('Aucun écart rejoué sur les trades de la séance.', 'No deviation replayed on the session’s trades.', 'Ningún desvío repetido en los trades de la sesión.')}</p>
          ) : (
            <div className={s.links}>
              {findings.map((finding) => (
                <button key={finding.id} type="button" className={s.row} data-finding={finding.kind} onClick={() => openObject({ type: 'trade', id: finding.entryId }, { jump: true })} title={tr('Ouvrir le trade', 'Open the trade', 'Abrir el trade')} {...light(`trade:${finding.entryId}`)}>
                  <EtatMark stroke="plein" />
                  <Glyph name={finding.family === 'drift' ? 'drift' : 'traderRule'} className={s.rowGlyph} />
                  <span className={s.rowMain}>
                    <b className={s.findingName}>
                      {findingName(finding)} · {etClock(Date.parse(finding.at))} ET
                    </b>
                    <small className={s.findingText}>{findingWords(finding)}</small>
                  </span>
                  <span className={s.rowGo} aria-hidden>
                    →
                  </span>
                </button>
              ))}
            </div>
          )}
        </FicheSection>

        <FicheSection part="properties" title={tr('Propriétés', 'Properties', 'Propiedades')}>
          <Properties rows={properties} />
        </FicheSection>

        <FicheSection part="provenance" title={tr('Provenance', 'Provenance', 'Procedencia')}>
          <Provenance
            lines={[
              `${tr('Séance', 'Session', 'Sesión')} · ${sourceWord(session.source)} · ${tr('écrite au coffre', 'written to the vault', 'escrita en la caja')} ${stamped(session.createdAt)}`,
              ...linkProvenance(target, ctx.links),
              tr(
                'Distance à la publication : la publication liée « pendant » la plus proche de l’entrée, à 180 min au plus (le calcul d’Analyse)',
                'Distance to the release: the nearest release linked “during” the entry, 180 min at most (the Analysis computation)',
                'Distancia a la publicación: la publicación ligada «durante» más cercana a la entrada, a 180 min como máximo (el cálculo de Análisis)',
              ),
              tr(
                'Écarts : rejoués sur les trades de la séance par la veille discipline, aux règles actuelles du trader',
                'Deviations: replayed on the session’s trades by the discipline watch, with the trader’s current rules',
                'Desvíos: repetidos en los trades de la sesión por la vigilancia de disciplina, con las reglas actuales del trader',
              ),
            ]}
          />
        </FicheSection>
      </div>
    </>
  );
}
