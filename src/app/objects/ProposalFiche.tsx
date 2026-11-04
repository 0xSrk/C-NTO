import { Glyph } from '@/design/Micro';
import e from '@/design/etat.module.css';
import { cx } from '@/design/primitives';
import { mirrorIssueName } from '@/engine/guardMirror';
import { tr, useI18n } from '@/i18n';
import { fmtInt, plural } from '@/lib/format';
import { useObjects, type ObjectRef, type ProposalRef } from '@/store/objects';
import { instrumentKey } from '../registre';
import { ActivitySection, copyAction, FicheHead, FicheSection, ObjectLink, Provenance, type FicheAction } from './Fiche';
import { objectLabel, type IndexSources } from './index';
import {
  authorLine,
  cellStates,
  chainStates,
  chainWord,
  CONFIRM_SECONDS,
  dialogLines,
  isReducing,
  isRefusal,
  outcomeDetail,
  outcomeTitle,
  PROPOSAL_CELLS,
  proposalClock,
  proposalFoot,
  proposalLinks,
  proposalTitle,
  proposalView,
  reasonCaption,
  windowWords,
  type CellState,
  type ChainStep,
  type ProposalView,
} from './proposals';
import fs from './fiche.module.css';
import s from './proposal.module.css';

/**
 * La proposition de l'agent comme objet (OROS5.39 ; repris du prototype D · Porte, d4, sans démonstration) : la carte que la
 * colonne Propositions d'Agent IA et la fiche partagent, puis la fiche elle-même. La carte dit le diff du dialogue du
 * process principal mot pour mot, l'auteur, la raison de l'agent citée comme telle, la chaîne C.092 (l'agent propose, la
 * garde du desk lit, vous décidez), les douze issues de M.040 dans l'ordre de la garde, et l'issue : un refus porte C.042,
 * jamais le rouge. Aucun bouton ici n'accepte l'ordre : la décision se prend dans le dialogue du process principal.
 */

/** Le trait d'une case de M.040 : franchie, pleine ; « vous », tant qu'elle attend, tiretée ; pas encore lue, sans trait. */
const CELL_ETAT: Partial<Record<CellState, string>> = { pass: e.plein, pending: e.tirete };

/** Le trait d'un pas de la chaîne : fait, plein ; en cours, tireté ; à venir, sans trait. */
const STEP_ETAT: Partial<Record<string, string>> = { done: e.plein, current: e.tirete };

const CHAIN: readonly ChainStep[] = ['agent', 'guard', 'you'];

/** M.040 : les douze issues, chacune son nom en clair ; la marque dit l'état, l'identifiant de la garde reste au survol. */
function GuardCells({ cells }: { cells: readonly CellState[] }) {
  return (
    <ol className={s.cells} aria-label={tr('Les douze issues, dans l’ordre de la garde', 'The twelve outcomes, in the guard’s order', 'Los doce resultados, en el orden de la guardia')}>
      {PROPOSAL_CELLS.map((cell, i) => {
        const state = cells[i] ?? 'idle';
        return (
          <li key={cell} className={s.cell} data-cell={cell} data-state={state} title={cell}>
            {state === 'stop' ? (
              <Glyph name="refused" className={s.cellStop} label={tr('arrêtée ici', 'stopped here', 'detenida aquí')} />
            ) : state === 'skip' ? (
              <span className={s.cellSkip} aria-label={tr('contournée : réduction de risque', 'bypassed: risk reduction', 'omitida: reducción de riesgo')}>
                —
              </span>
            ) : (
              <i className={cx(s.cellMark, CELL_ETAT[state])} data-etat={state} aria-hidden />
            )}
            <span className={s.cellName}>{mirrorIssueName(cell)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * La barre du dialogue (OROS5.40) : du dialogue ouvert au refus par défaut, elle se vide d'elle-même, sans minuterie ni
 * relecture (une animation CSS, partie de l'instant d'ouverture que publie le process principal). La seule pièce à l'or :
 * la décision qui attend l'opérateur (décision 1). En mouvement réduit, elle reste pleine et l'heure dit le reste.
 */
function DeadlineBar({ window }: { window: { opened: number; deadline: number } }) {
  const total = Math.max(1, window.deadline - window.opened);
  const elapsed = Math.min(total, Math.max(0, Date.now() - window.opened));
  return (
    <div
      className={s.bar}
      data-deadline=""
      role="progressbar"
      aria-label={tr('Temps laissé à votre décision', 'Time left for your decision', 'Tiempo que queda para su decisión')}
      aria-valuemin={0}
      aria-valuemax={Math.round(total / 1000)}
      aria-valuenow={Math.round((total - elapsed) / 1000)}
    >
      <i style={{ animationDuration: `${total}ms`, animationDelay: `${-elapsed}ms` }} />
    </div>
  );
}

/**
 * La carte d'une proposition : la colonne Propositions et la fiche la posent. `onOpen` : la colonne fait de la chaîne C.092
 * un bouton qui ouvre la fiche — le seul bouton de la carte, et il ne fait que naviguer.
 */
export function ProposalCard({ p, onOpen, compact = false }: { p: ProposalView; onOpen?: (origin: HTMLElement) => void; compact?: boolean }) {
  useI18n((st) => st.locale);
  const decided = p.stage === 'decided';
  const refusal = isRefusal(p);
  const chain = chainStates(p);
  const glyph = <Glyph name="proposal" className={s.chainGlyph} />;
  return (
    <article className={cx(s.card, decided ? e.plein : e.tirete)} data-proposal={p.id} data-stage={p.stage} data-outcome={p.outcome?.status ?? 'pending'}>
      <header className={s.meta}>
        {onOpen ? (
          <button type="button" className={s.open} data-proposal-open="" onClick={(event) => onOpen(event.currentTarget)} aria-label={`${tr('Ouvrir la fiche', 'Open the record', 'Abrir la ficha')} · ${proposalTitle(p)}`} title={tr('Ouvrir la fiche', 'Open the record', 'Abrir la ficha')}>
            {glyph}
          </button>
        ) : (
          glyph
        )}
        <span className={s.author}>{authorLine(p.origin)}</span>
        <time className={s.time} dateTime={new Date(p.at).toISOString()}>
          {proposalClock(p.at)} ET
        </time>
      </header>
      <div className={s.diff} data-dialog="">
        {dialogLines(p).map((text, i) => (
          <p key={i} className={i === 0 ? s.diffOrder : s.diffSub}>
            {text}
          </p>
        ))}
      </div>
      {isReducing(p) ? (
        <p className={s.reduce}>
          <Glyph name="reduceRisk" className={s.reduceGlyph} />
          {tr('Réduction de risque : elle passe toujours la garde', 'Risk reduction: it always passes the guard', 'Reducción de riesgo: siempre pasa la guardia')}
        </p>
      ) : null}
      {p.reason && !compact ? (
        <figure className={s.reason}>
          <figcaption>{reasonCaption()}</figcaption>
          <blockquote>{tr(`« ${p.reason} »`, `“${p.reason}”`, `«${p.reason}»`)}</blockquote>
        </figure>
      ) : null}
      {compact ? null : (
        <ol className={s.chain} aria-label={tr('La chaîne de la proposition', 'The proposal chain', 'La cadena de la propuesta')}>
          {CHAIN.map((step) => {
            const state = chain[step];
            return (
              <li key={step} data-step={step} data-state={state}>
                {state === 'stopped' ? <Glyph name="refused" className={s.chainStop} /> : <i className={cx(s.chainMark, STEP_ETAT[state])} aria-hidden />}
                <span>{chainWord(step)}</span>
              </li>
            );
          })}
        </ol>
      )}
      {p.window ? (
        <div className={s.window} data-window={p.stage === 'dialog' ? 'open' : 'closed'}>
          <p>{windowWords(p.window)}</p>
          {p.stage === 'dialog' ? <DeadlineBar window={p.window} /> : null}
        </div>
      ) : null}
      <GuardCells cells={cellStates(p)} />
      <div className={s.outcome} data-refusal={refusal ? '' : undefined}>
        {refusal ? <Glyph name="refused" className={s.outcomeGlyph} label={tr('n’a pas eu lieu', 'did not happen', 'no tuvo lugar')} /> : <span className={s.outcomeGlyph} aria-hidden />}
        <div>
          <b>{outcomeTitle(p)}</b>
          {p.outcome ? <span>{outcomeDetail(p)}</span> : null}
        </div>
      </div>
      <p className={s.foot}>{proposalFoot()}</p>
    </article>
  );
}

/** Revenir à la conversation de l'agent, où la colonne Propositions tient la liste : un saut, que Retour arrière défait. */
function conversationAction(): FicheAction {
  return {
    id: 'agent',
    glyph: 'agent',
    label: tr('Ouvrir les propositions dans Agent IA', 'Open the proposals in AI Agent', 'Abrir las propuestas en Agente IA'),
    run: () => void useObjects.getState().jumpTo('agent', { view: 'conversation' }),
  };
}

/**
 * La fiche d'une proposition : la carte, puis ses liens — son compte, son instrument, sa séance, lus à l'ouverture et jamais
 * écrits —, son activité au registre et sa provenance. Elle ne fait que lire.
 */
export function ProposalFiche({ target, ctx, now }: { target: ProposalRef; ctx: IndexSources; now: number }) {
  useI18n((st) => st.locale);
  const proposal = ctx.proposals?.find((x) => x.id === target.id);
  if (!proposal) {
    return (
      <>
        <FicheHead type="proposition" title={`${tr('Proposition', 'Proposal', 'Propuesta')} · —`} actions={[conversationAction()]} />
        <div className={fs.body} data-fiche="proposition">
          <p className={fs.empty}>{tr('Cette proposition n’est plus en mémoire.', 'This proposal is no longer in memory.', 'Esta propuesta ya no está en memoria.')}</p>
        </div>
      </>
    );
  }
  const p = proposalView(proposal);
  const links = proposalLinks(p, ctx.sessions, instrumentKey);
  const rows: [string, ObjectRef | null][] = [
    [tr('Compte', 'Account', 'Cuenta'), links.account],
    [tr('Instrument', 'Instrument', 'Instrumento'), links.instrument],
    [tr('Séance', 'Session', 'Sesión'), links.session],
  ];
  const linked = rows.filter(([, ref]) => ref !== null).length;
  return (
    <>
      <FicheHead type="proposition" title={`${tr('Proposition', 'Proposal', 'Propuesta')} · ${proposalTitle(p)}`} actions={[conversationAction(), copyAction(target)]} />
      <div className={fs.body} data-fiche="proposition">
        <ProposalCard p={p} />
        <FicheSection part="links" title={tr('Liens', 'Links', 'Enlaces')} meta={plural(linked, tr('lien', 'link', 'enlace'), tr('liens', 'links', 'enlaces'))}>
          <dl className={fs.props}>
            {rows.map(([label, ref]) => (
              <div key={label} className={fs.prop} data-link-to={ref?.type ?? 'none'}>
                <dt>{label}</dt>
                <dd>{ref && ref.type !== 'proposition' ? <ObjectLink to={ref} label={objectLabel(ref, ctx, now) ?? ref.id} /> : '—'}</dd>
              </div>
            ))}
          </dl>
        </FicheSection>
        <ActivitySection target={target} ctx={ctx} />
        <FicheSection part="provenance" title={tr('Provenance', 'Provenance', 'Procedencia')}>
          <Provenance
            lines={[
              tr(
                `Proposée à ${proposalClock(p.at)} ET · en mémoire seulement, depuis l’ouverture du desk · rien n’est écrit au coffre`,
                `Proposed at ${proposalClock(p.at)} ET · in memory only, since the desk opened · nothing is written to the vault`,
                `Propuesta a las ${proposalClock(p.at)} ET · solo en memoria, desde la apertura del desk · nada se escribe en la caja`,
              ),
              tr(
                `La garde et le dialogue sont ceux du process principal : comptes Sim*, limites, cadence, ${CONFIRM_SECONDS} s, Refuser par défaut`,
                `The guard and the dialog are the main process’s: Sim* accounts, limits, rate, ${CONFIRM_SECONDS} s, Decline by default`,
                `La guardia y el diálogo son los del proceso principal: cuentas Sim*, límites, cadencia, ${CONFIRM_SECONDS} s, Rechazar por defecto`,
              ),
              p.seq !== null
                ? tr(`Événement agent_order n° ${fmtInt(p.seq)} au registre`, `agent_order event no. ${fmtInt(p.seq)} in the log`, `Evento agent_order n.º ${fmtInt(p.seq)} en el registro`)
                : p.outcome
                  ? tr('Absente du registre : la cadence du journal l’a tue', 'Not in the log: the journal rate kept it out', 'Ausente del registro: la cadencia del diario la omitió')
                  : tr('Au registre à son issue', 'In the log once decided', 'En el registro al decidirse'),
            ]}
          />
        </FicheSection>
      </div>
    </>
  );
}
