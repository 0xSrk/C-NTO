import { useMemo } from 'react';
import { Glyph } from '@/design/Micro';
import { cx, Montant } from '@/design/primitives';
import { sameAccount, matchAccount } from '@/engine/accounts';
import { AGENT_SIM_PREFIX } from '@/engine/agent/orders';
import type { DayBornes } from '@/engine/bornes';
import { gateWords, mirrorIssueName, type GateState, type MirrorGate } from '@/engine/guardMirror';
import { dayMargin, planReading, type EntityRef, type PlanReading } from '@/engine/ontology';
import { BRIDGE_MAX_AGE_MS } from '@/engine/portfolio/types';
import { findPlan } from '@/engine/propfirm';
import { tr, useI18n } from '@/i18n';
import { fmtInt, fmtPct, fmtRatio, fmtUsd, plural } from '@/lib/format';
import { useBridge } from '@/store/bridge';
import { useCopier } from '@/store/copier';
import { useObjects } from '@/store/objects';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { landOn } from '../RailGates';
import { ageText, readFrom } from '../StatusBornes';
import { useBornesReplay, useDayBornes } from '../useDayBornes';
import { useGuardMirror } from '../useGuardMirror';
import { copyAction, EtatMark, FicheHead, FicheSection, ficheTitle, LinksByPredicate, linkProvenance, ObjectLink, Provenance, type FicheAction } from './Fiche';
import { shortDay, type EtatStroke, type IndexSources } from './index';
import { BoundsDisk, IdentityGrid, TradeBeads, tradesOfMax, type BoundsReading } from './Instruments';
import s from './fiche.module.css';
import { AroundOf } from './AroundOf';

/**
 * La fiche Compte (OROS5.27, Système 5 « Fiche et Frise » ; reprise de d1, d2 et d4, le bloquant de l'audit levé). Le
 * compte n'a pas de table (décision 13) : il est le nom que portent les séances, les trades et le pont, apparié par la
 * règle de la garde (`sameAccount`, `matchAccount`). La puce Compte d'une fiche, les cellules de la barre d'état et la
 * cartouche du rail l'ouvrent (décision 11). Elle ne fait que lire :
 * - M.057 : Sim ou hors Sim, la période, la marge du jour au numéral (`planReading`, `dayMargin`) ou « — » quand le plan
 *   est clos ou ailleurs, le net cumulé, la réussite, le rôle au Copieur, le pont ;
 * - ΟΡΟΣ · Bornes, le seul grec du desk, en IBM Plex Sans (décision 6) : les bornes du jour du calcul unique
 *   (`useDayBornes`), leur source et leur âge, M.065 (les trades du jour jusqu'au maximum), M.011 (la marge et la perte du
 *   jour dans le drawdown maximal, le plancher C.125 ou C.126) ;
 * - la garde : le miroir (`useGuardMirror`, qui appelle `guardProposal`), le verdict et la garde qui refuse en tête, les
 *   douze issues au dépliage ;
 * - le plan suivi en miroir, ses critères en direct, et son effet vrai sur la garde (décision 10) ; le bouton mène à
 *   l'écriture existante de Firme prop, sans rien écrire lui-même ;
 * - les positions du pont et le rôle au Copieur ; les liens ; la provenance.
 */

const signedClass = (v: number) => (v > 0 ? s.pos : v < 0 ? s.neg : undefined);
const montantChars = (v: number) => fmtUsd(v, { cents: true, sign: true }).length;

/** Le trait d'une issue du miroir, dans la table d'états : elle laisse passer (plein), attend la proposition ou vous
 * (tireté), ou elle est fermée, hors ligne, sans objet (filet graphite). */
export const GATE_ETAT: Readonly<Record<GateState, EtatStroke>> = { pass: 'plein', proposal: 'tirete', operator: 'tirete', refuse: 'eteint', unknown: 'eteint', moot: 'eteint' };

/** Un compte Sim, où l'agent peut proposer (la règle de la garde : le préfixe, au caractère près). */
export const isSimAccount = (name: string) => name.startsWith(AGENT_SIM_PREFIX);

/** La lecture du plan pour ce compte : celle du rejeu partagé quand le plan le suit, rien sinon. */
export function accountPlanReading(replay: ReturnType<typeof useBornesReplay>, tracked: boolean): PlanReading {
  if (!tracked || !replay.plan) return { kind: 'none' };
  return planReading(replay.plan.ev, replay.plan.dated, replay.lastDay ?? undefined);
}

/**
 * L'effet du plan suivi sur la garde de l'agent, tel qu'il est (décision 10) : la garde ne change pas, la fiche le dit.
 * Suivre un compte hors Sim rend la marge datée nulle pour les comptes Sim (`trackedPropShare`), et la perte du jour ne
 * borne que le compte suivi (`limitAccount`) : ni l'une ni l'autre ne gardent alors les comptes Sim, les seuls que
 * l'agent trade.
 */
export function planEffect(input: { account: string; planAccount: string; hasPlan: boolean; hasDailyLimit: boolean; binds: { margin: boolean; dailyLoss: boolean } }): string[] {
  const { account, planAccount, hasPlan, hasDailyLimit, binds } = input;
  const sim = isSimAccount(account);
  const out: string[] = [];
  if (planAccount && !isSimAccount(planAccount)) {
    out.push(
      tr(
        `Le plan suit ${planAccount}, hors Sim : la marge datée et la perte du jour ne gardent plus les comptes Sim, les seuls où l’agent propose.`,
        `The plan tracks ${planAccount}, not a Sim account: the dated margin and the day loss no longer guard the Sim accounts, the only ones the agent proposes on.`,
        `El plan sigue ${planAccount}, fuera de Sim: el margen fechado y la pérdida del día ya no protegen las cuentas Sim, las únicas donde el agente propone.`,
      ),
    );
  }
  if (!sim) {
    out.push(tr(`L’agent ne propose aucun ordre sur ${account} : la garde s’arrête aux comptes Sim.`, `The agent proposes no order on ${account}: the guard stops at Sim accounts.`, `El agente no propone ninguna orden en ${account}: la guarda se detiene en las cuentas Sim.`));
    return out;
  }
  const margin = binds.margin
    ? tr(`la marge datée du plan borne l’agent sur ${account}`, `the plan’s dated margin bounds the agent on ${account}`, `el margen fechado del plan limita al agente en ${account}`)
    : hasPlan
      ? tr(`la marge datée ne borne pas l’agent sur ${account}`, `the dated margin does not bound the agent on ${account}`, `el margen fechado no limita al agente en ${account}`)
      : tr('aucun plan suivi : pas de marge datée', 'no tracked plan: no dated margin', 'ningún plan seguido: sin margen fechado');
  const daily = !hasDailyLimit
    ? tr('aucune limite de perte du jour réglée', 'no day loss limit set', 'ningún límite de pérdida del día ajustado')
    : binds.dailyLoss
      ? tr(`la perte du jour borne l’agent sur ${account}`, `the day loss bounds the agent on ${account}`, `la pérdida del día limita al agente en ${account}`)
      : tr(`la perte du jour ne borne que ${planAccount}`, `the day loss only bounds ${planAccount}`, `la pérdida del día solo limita ${planAccount}`);
  out.push(`${margin.charAt(0).toLocaleUpperCase()}${margin.slice(1)} ; ${daily}.`);
  return out;
}

/** Une issue du miroir, en ligne : son trait, son nom, ce qu'elle dit. */
function GateRow({ gate }: { gate: MirrorGate }) {
  return (
    <li className={s.gateRow} data-gate={gate.key} data-state={gate.state}>
      <EtatMark stroke={GATE_ETAT[gate.state]} />
      <span className={s.gateName}>{mirrorIssueName(gate.key)}</span>
      <span className={s.gateWords}>{gateWords(gate)}</span>
    </li>
  );
}

/** La section ΟΡΟΣ · Bornes : la journée lue, la perte du jour, M.065, M.011 ; ou l'objet que le plan et les règles suivent. */
function Bornes({ account, planAccount, b, tracked }: { account: string; planAccount: string; b: DayBornes; tracked: boolean }) {
  useI18n((st) => st.locale);
  if (!tracked) {
    return (
      <div className={s.bornesAway} data-bornes="away">
        <p className={s.empty}>
          {tr(`Les bornes du jour suivent ${planAccount} : ni la perte du jour ni la marge ne bornent ${account}.`, `The day’s bounds follow ${planAccount}: neither the day loss nor the margin bound ${account}.`, `Los límites del día siguen ${planAccount}: ni la pérdida del día ni el margen limitan ${account}.`)}
        </p>
        <ObjectLink to={{ type: 'compte', id: planAccount }} label={planAccount} />
      </div>
    );
  }
  const { loss, trades, margin } = b;
  const none = loss.limit === null && trades.max === null && margin.planLabel === null;
  if (none) return <p className={s.empty}>{tr('Aucune borne réglée : ni limite de perte du jour, ni maximum de trades, ni plan suivi.', 'No bound set: no day loss limit, no trade maximum, no tracked plan.', 'Ningún límite ajustado: ni límite de pérdida del día, ni máximo de trades, ni plan seguido.')}</p>;
  const dated = !b.day.today && b.day.key !== null;
  const stale = b.day.stale || dated;
  const reading: BoundsReading = {
    maxDrawdown: margin.maxDrawdown,
    margin: margin.inService ? margin.value : margin.dated,
    marginDate: margin.date,
    marginLive: margin.live,
    daily: loss.limit !== null && loss.remaining !== null ? Math.max(0, loss.remaining) : null,
    floorKind: margin.floorKind,
    closed: margin.status === 'objectif' || margin.status === 'echec' ? { status: margin.status, date: margin.date } : null,
  };
  return (
    <div className={s.bornes} data-bornes="tracked">
      <p className={s.bornesRead} data-read="">
        {stale ? <Glyph name="stale" className={s.bornesStale} label={tr('Lecture datée ou périmée', 'Dated or stale reading', 'Lectura fechada o caducada')} /> : null}
        <span>
          {b.day.key ? `${tr('Journée du', 'Day of', 'Jornada del')} ${shortDay(b.day.key)} · ` : ''}
          {readFrom(b)}
          {` · ${planAccount ? planAccount : tr('tous les comptes', 'all accounts', 'todas las cuentas')}`}
        </span>
      </p>
      <div className={s.borneLine} data-borne="loss">
        <span className={s.borneKey}>{tr('Perte du jour', 'Day loss', 'Pérdida del día')}</span>
        <b className={s.borneVal}>{loss.limit !== null ? `${loss.value === null ? '—' : fmtInt(loss.value)} / ${fmtUsd(loss.limit)}` : tr('aucune limite', 'no limit', 'sin límite')}</b>
        {loss.limit !== null ? (
          loss.source === 'plan' ? (
            <span className={s.borneSrc} data-source="plan">
              {tr('plan', 'plan', 'plan')}
            </span>
          ) : (
            <Glyph name="traderRule" className={s.borneSrcGlyph} label={tr('Règle du trader', 'Trader rule', 'Regla del trader')} />
          )
        ) : null}
      </div>
      <div className={s.borneLine} data-borne="trades">
        <span className={s.borneKey}>{tr('Trades', 'Trades', 'Trades')}</span>
        <b className={s.borneVal}>{tradesOfMax(trades.count, trades.max)}</b>
        <TradeBeads
          pnls={trades.pnls}
          max={trades.max}
          label={tr(`Trades de la journée : ${tradesOfMax(trades.count, trades.max)}`, `Trades of the day: ${tradesOfMax(trades.count, trades.max)}`, `Trades de la jornada: ${tradesOfMax(trades.count, trades.max)}`)}
        />
      </div>
      {margin.planLabel !== null ? <BoundsDisk reading={reading} day={shortDay} /> : null}
      {reading.closed ? (
        <p className={s.bornesClosed} data-closed={reading.closed.status}>
          <EtatMark stroke="eteint" />
          <span>
            {reading.closed.status === 'objectif' ? tr('Objectif atteint', 'Target reached', 'Objetivo alcanzado') : tr('Compte invalidé', 'Account failed', 'Cuenta invalidada')}
            {reading.closed.date ? ` · ${shortDay(reading.closed.date)}` : ''} · {tr('le rejeu du plan s’arrête là', 'the plan replay stops there', 'la repetición del plan se detiene ahí')}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function AccountFiche({ target, ctx, now }: { target: EntityRef; ctx: IndexSources; now: number }) {
  useI18n((st) => st.locale);
  const id = target.id.trim();
  const planAccount = useSettings((st) => st.settings.planAccount);
  const planId = useSettings((st) => st.settings.planId);
  useSettings((st) => st.settings.userPlans);
  const replay = useBornesReplay();
  const b = useDayBornes();
  const mirror = useGuardMirror(id);
  const nt = useBridge((st) => st.nt);
  const copier = useCopier((c) => c.accounts);
  const own = useMemo(() => ctx.sessions.filter((x) => sameAccount(x.account ?? '', id)).sort((a, c) => a.date.localeCompare(c.date)), [ctx.sessions, id]);
  const ownTrades = useMemo(() => ctx.trades.filter((t) => sameAccount(t.account ?? '', id)), [ctx.trades, id]);
  // Le plan et les bornes suivent ce compte : le compte suivi (la règle de la garde), ou tous les comptes.
  const tracked = planAccount ? sameAccount(planAccount, id) : true;
  const reading = accountPlanReading(replay, tracked);
  const margin = dayMargin(reading);
  const plan = findPlan(planId) ?? null;
  const net = own.reduce((sum, x) => sum + (Number.isFinite(x.pnl) ? x.pnl : 0), 0);
  const wins = ownTrades.filter((t) => t.pnl > 0).length;
  const role = copier.find((a) => sameAccount(a.ntAccount, id));
  const bridgeRow = useMemo(() => {
    const rows = nt?.accounts ?? [];
    const hit = matchAccount(rows.map((row) => row.name), id);
    return hit ? { row: rows.find((row) => row.name === hit.name)!, by: hit.by } : null;
  }, [nt, id]);
  const live = nt?.link === 'live';
  const age = live && nt?.accountsAt ? Math.max(0, now - nt.accountsAt) : null;
  const stale = age !== null && age > BRIDGE_MAX_AGE_MS;
  const sim = isSimAccount(id);

  const actions: FicheAction[] = [
    {
      id: 'metrique',
      glyph: 'metrique',
      label: tr('Filtrer Métrique sur ce compte', 'Filter Metrics on this account', 'Filtrar Métrica en esta cuenta'),
      run: () => {
        useUi.getState().setMetricAccount(id);
        useObjects.getState().jumpTo('metrique', { view: 'bord' });
      },
    },
    copyAction(target),
  ];
  /** Firme prop, filtrée sur ce compte : l'écriture existante (« Suivre ce plan pour … ») y vit ; rien n'est écrit d'ici. */
  const openProp = () => {
    useUi.getState().setMetricAccount(id);
    if (useObjects.getState().jumpTo('metrique', { view: 'prop' })) landOn('[data-plan-target]');
  };

  const sub =
    reading.kind === 'current'
      ? `${tr('marge du jour', 'today’s margin', 'margen del día')} · USD${planAccount ? '' : ` · ${tr('tous les comptes', 'all accounts', 'todas las cuentas')}`}`
      : reading.kind === 'closed'
        ? tr('marge du jour · plan clos', 'today’s margin · plan closed', 'margen del día · plan cerrado')
        : tracked
          ? tr('marge du jour · aucun plan suivi', 'today’s margin · no tracked plan', 'margen del día · ningún plan seguido')
          : tr(`marge du jour · plan suivi sur ${planAccount}`, `today’s margin · plan tracked on ${planAccount}`, `margen del día · plan seguido en ${planAccount}`);
  const first = mirror.first;
  const declined = mirror.gates.at(-1)!;

  return (
    <>
      <FicheHead type="compte" title={ficheTitle(target, ctx, now)} actions={actions} />
      <div className={s.body} data-fiche="compte">
        <IdentityGrid
          label={tr('Identité du compte', 'Account identity', 'Identidad de la cuenta')}
          lead={<span className={s.identText} data-sim={sim ? 'sim' : 'hors'}>{sim ? 'Sim' : tr('hors Sim', 'not Sim', 'fuera de Sim')}</span>}
          when={own.length ? `${shortDay(own[0]!.date)} → ${shortDay(own[own.length - 1]!.date)}` : '—'}
          numeral={margin !== null ? <Montant value={margin} /> : '—'}
          chars={margin !== null ? montantChars(margin) : 1}
          sub={sub}
          aside={
            <>
              <Montant value={net} className={cx(s.identPnl, signedClass(net))} />
              <span className={s.identUnit}>{tr('net cumulé', 'cumulative net', 'neto acumulado')} · USD</span>
            </>
          }
          foot={[
            `${plural(own.length, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))} · ${plural(ownTrades.length, 'trade', 'trades')}`,
            `${tr('réussite', 'win rate', 'acierto')} ${ownTrades.length ? fmtPct(wins / ownTrades.length, 0) : '—'}`,
            `${tr('copieur', 'copier', 'copiador')} ${role ? (role.role === 'maitre' ? tr('maître', 'master', 'maestro') : tr('suiveur', 'follower', 'seguidor')) : '—'}`,
            `${tr('pont', 'bridge', 'puente')} ${bridgeRow && live ? (stale ? tr('périmé', 'stale', 'caducado') : tr('vif', 'live', 'vivo')) : tr('hors ligne', 'offline', 'fuera de línea')}`,
          ]}
        />

        <FicheSection
          part="bornes"
          title={
            <>
              <span className={s.oros} lang="el">
                ΟΡΟΣ
              </span>{' '}
              {tr('Bornes', 'Bounds', 'Límites')}
            </>
          }
          meta={tracked ? (b.margin.planLabel ?? undefined) : undefined}
        >
          <Bornes account={id} planAccount={planAccount} b={b} tracked={tracked} />
        </FicheSection>

        <FicheSection part="guard" title={tr('Garde d’un ordre de l’agent', 'Guard of an agent order', 'Guarda de una orden del agente')} meta={tr('miroir', 'mirror', 'espejo')}>
          <p className={s.verdict} data-verdict={first?.key ?? 'declined'}>
            <Glyph name={first ? 'refused' : 'guard'} className={s.verdictGlyph} />
            <span>
              <b>{first ? `${tr('Refuserait', 'Would refuse', 'Rechazaría')} · ${mirrorIssueName(first.key)}` : tr('Passerait la garde · vous décidez', 'Would pass the guard · you decide', 'Pasaría la guarda · usted decide')}</b>
              <small>{gateWords(first ?? declined)}</small>
            </span>
          </p>
          <details className={s.gates}>
            <summary>{tr(`Les ${mirror.gates.length} issues, dans l’ordre de la garde`, `The ${mirror.gates.length} outcomes, in the guard’s order`, `Los ${mirror.gates.length} resultados, en el orden de la guarda`)}</summary>
            <ul>
              {mirror.gates.map((gate) => (
                <GateRow key={gate.key} gate={gate} />
              ))}
            </ul>
          </details>
        </FicheSection>

        <FicheSection part="plan" title={tr('Plan suivi', 'Tracked plan', 'Plan seguido')}>
          <div className={s.planLine} data-plan={tracked && plan ? 'tracked' : 'mirror'}>
            <EtatMark stroke={tracked && plan ? 'plein' : 'tirete'} />
            <span className={s.rowMain}>
              <b className={s.findingName}>
                {plan
                  ? tr(`Suivre ${plan.firm} ${plan.label} pour ${id}`, `Track ${plan.firm} ${plan.label} for ${id}`, `Seguir ${plan.firm} ${plan.label} para ${id}`)
                  : tr(`Aucun plan prop choisi pour ${id}`, `No prop plan chosen for ${id}`, `Ningún plan prop elegido para ${id}`)}
              </b>
              <small className={s.findingText}>
                {[
                  plan ? `${tr('DD max', 'max DD', 'DD máx.')} ${fmtUsd(plan.maxDrawdown)}${plan.dailyLossLimit ? ` · ${tr('perte/jour', 'loss/day', 'pérdida/día')} ${fmtUsd(plan.dailyLossLimit)}` : ''}` : null,
                  planAccount ? (tracked ? tr('suivi pour ce compte', 'tracked for this account', 'seguido para esta cuenta') : tr(`suivi pour ${planAccount}`, `tracked for ${planAccount}`, `seguido para ${planAccount}`)) : tr('suivi pour tous les comptes, agrégés', 'tracked for all accounts, aggregated', 'seguido para todas las cuentas, agregadas'),
                  sim ? 'Sim' : tr('hors Sim', 'not Sim', 'fuera de Sim'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
          </div>
          <ul className={s.effect} data-effect="">
            {planEffect({ account: id, planAccount, hasPlan: plan !== null, hasDailyLimit: b.loss.limit !== null, binds: mirror.binds }).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <button type="button" className={s.planOpen} onClick={openProp} data-action="prop">
            {tr('Firme prop, pour ce compte', 'Prop firm, for this account', 'Firma prop, para esta cuenta')}
            <span aria-hidden> →</span>
          </button>
        </FicheSection>

        <FicheSection part="bridge" title={tr('Pont et Copieur', 'Bridge and Copier', 'Puente y Copiador')} meta={age !== null && bridgeRow ? tr(`lu il y a ${ageText(age)}`, `read ${ageText(age)} ago`, `leído hace ${ageText(age)}`) : undefined}>
          {bridgeRow && live ? (
            bridgeRow.row.positions.filter((p) => p.quantity !== 0).length ? (
              <ul className={s.positions}>
                {bridgeRow.row.positions
                  .filter((p) => p.quantity !== 0)
                  .map((p) => (
                    <li key={p.instrument} className={cx(s.position, stale && s.positionStale)}>
                      {stale ? <Glyph name="stale" className={s.rowGlyph} label={tr('Périmé', 'Stale', 'Caducado')} /> : <Glyph name="sectorMarkets" className={s.rowGlyph} />}
                      <b>
                        {p.quantity > 0 ? '+' : '−'}
                        {fmtInt(Math.abs(p.quantity))} {p.instrument}
                      </b>
                      <small>@ {fmtRatio(p.avgPrice, 2)}</small>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className={s.empty}>{tr('À plat au pont.', 'Flat at the bridge.', 'Sin posición en el puente.')}</p>
            )
          ) : (
            <p className={s.empty}>{tr('Pont hors ligne : aucune position lue.', 'Bridge offline: no position read.', 'Puente fuera de línea: ninguna posición leída.')}</p>
          )}
          <p className={s.copierRole} data-copier={role?.role ?? 'none'}>
            {role
              ? role.role === 'maitre'
                ? tr('Copieur : compte maître ; jamais suiveur de lui-même.', 'Copier: master account; never a follower of itself.', 'Copiador: cuenta maestra; nunca seguidora de sí misma.')
                : tr(`Copieur : suiveur${role.enabled ? '' : ', inactif'}.`, `Copier: follower${role.enabled ? '' : ', inactive'}.`, `Copiador: seguidor${role.enabled ? '' : ', inactivo'}.`)
              : tr('Copieur : ce compte n’y a pas de rôle.', 'Copier: this account has no role there.', 'Copiador: esta cuenta no tiene papel allí.')}
          </p>
        </FicheSection>

        <FicheSection part="links" title={tr('Liens', 'Links', 'Enlaces')}>
          <LinksByPredicate target={target} ctx={ctx} now={now} />
        </FicheSection>

        <FicheSection part="around" title={tr('Autour de…', 'Around…', 'Alrededor de…')}>
          <AroundOf target={target} ctx={ctx} now={now} />
        </FicheSection>

        <FicheSection part="provenance" title={tr('Provenance', 'Provenance', 'Procedencia')}>
          <Provenance
            lines={[
              tr(
                'Compte : le nom que portent les séances, les trades et le pont, sans table propre ; apparié comme la garde (le nom exact, sinon replié)',
                'Account: the name sessions, trades and the bridge carry, with no table of its own; matched like the guard (the exact name, else folded)',
                'Cuenta: el nombre que llevan las sesiones, los trades y el puente, sin tabla propia; emparejada como la guarda (el nombre exacto, si no plegado)',
              ),
              bridgeRow ? (bridgeRow.by === 'exact' ? tr('Au pont : reconnu par son nom exact', 'At the bridge: recognized by its exact name', 'En el puente: reconocida por su nombre exacto') : tr(`Au pont : reconnu par son nom replié (${bridgeRow.row.name})`, `At the bridge: recognized by its folded name (${bridgeRow.row.name})`, `En el puente: reconocida por su nombre plegado (${bridgeRow.row.name})`)) : tr('Au pont : aucun compte de ce nom', 'At the bridge: no account by this name', 'En el puente: ninguna cuenta con este nombre'),
              tr(
                'Bornes et marge : le calcul unique de la barre d’état (rejeu du plan sur tout l’historique, journée lue), sans rien rejouer ici',
                'Bounds and margin: the status bar’s single computation (plan replayed over the whole history, day read), nothing replayed here',
                'Límites y margen: el cálculo único de la barra de estado (repetición del plan sobre todo el historial, jornada leída), nada repetido aquí',
              ),
              tr(
                'Garde : le miroir appelle la garde même avec ce que le desk lui transmettrait ; le process principal décide, l’opérateur confirme chaque ordre',
                'Guard: the mirror calls the guard itself with what the desk would pass it; the main process decides, the operator confirms each order',
                'Guarda: el espejo llama a la guarda misma con lo que el desk le transmitiría; el proceso principal decide, el operador confirma cada orden',
              ),
              ...linkProvenance(target, ctx.links),
            ]}
          />
        </FicheSection>
      </div>
    </>
  );
}
