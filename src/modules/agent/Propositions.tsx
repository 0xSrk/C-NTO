import { useMemo } from 'react';
import { ProposalCard } from '@/app/objects/ProposalFiche';
import { CONFIRM_SECONDS, proposalView } from '@/app/objects/proposals';
import { tr, useI18n } from '@/i18n';
import { fmtInt } from '@/lib/format';
import { useAgentOrders } from '@/store/agentOrders';
import { useObjects, type ObjectRef } from '@/store/objects';
import s from './agent.module.css';

/**
 * La colonne Propositions d'Agent IA › Conversation (OROS5.39 ; repris du prototype D · Porte, d4, sans démonstration) :
 * chaque ordre que l'agent a proposé depuis l'ouverture du desk, du plus récent au plus ancien, lu du flux réel seulement
 * (`useAgentOrders.proposals`, en mémoire). Chaque carte s'ouvre en fiche par sa chaîne C.092 ; ↑ ↓, dans la fiche, passent
 * à la proposition voisine. La colonne ne fait que lire : aucun bouton n'y accepte un ordre, la décision se prend dans le
 * dialogue du process principal.
 */
export function Propositions() {
  useI18n((st) => st.locale);
  const proposals = useAgentOrders((a) => a.proposals);
  const views = useMemo(() => proposals.map(proposalView), [proposals]);
  const refs = useMemo<ObjectRef[]>(() => views.map((p) => ({ type: 'proposition', id: p.id })), [views]);
  const open = (id: string, origin: HTMLElement) => useObjects.getState().openObject({ type: 'proposition', id }, { origin, siblings: refs });
  return (
    <aside className={s.proposals} aria-label={tr('Propositions de l’agent', 'Agent proposals', 'Propuestas del agente')} data-proposals={views.length}>
      <header className={s.proposalsHead}>
        <h2>{tr('Propositions', 'Proposals', 'Propuestas')}</h2>
        <span>{`${fmtInt(views.length)} · ${tr('depuis l’ouverture · en mémoire', 'since opening · in memory', 'desde la apertura · en memoria')}`}</span>
      </header>
      {views.length === 0 ? (
        <p className={s.proposalsEmpty}>
          {tr(
            `Aucune proposition depuis l’ouverture. L’agent propose ; la garde du desk lit ; vous décidez dans le dialogue du desk, ${CONFIRM_SECONDS} s, Refuser par défaut.`,
            `No proposal since opening. The agent proposes; the desk guard reads; you decide in the desk dialog, ${CONFIRM_SECONDS} s, Decline by default.`,
            `Ninguna propuesta desde la apertura. El agente propone; la guardia del desk lee; usted decide en el diálogo del desk, ${CONFIRM_SECONDS} s, Rechazar por defecto.`,
          )}
        </p>
      ) : (
        <ol className={s.proposalsList}>
          {views.map((p, i) => (
            <li key={p.id}>
              {/* La plus récente se lit en entier, comme une proposition en cours ; une décidée plus ancienne tient en quelques lignes. */}
              <ProposalCard p={p} compact={i > 0 && p.stage === 'decided'} onOpen={(origin) => open(p.id, origin)} />
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
