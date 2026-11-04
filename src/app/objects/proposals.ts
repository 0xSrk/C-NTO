import { sameAccount } from '@/engine/accounts';
import { AGENT_CONFIRM_TIMEOUT_MS, reducesRisk, signedQty } from '@/engine/agent/orders';
import { MIRROR_ISSUES, type MirrorIssue } from '@/engine/guardMirror';
import type { EntityRef } from '@/engine/ontology';
import type { Session } from '@/engine/types';
import { tr } from '@/i18n';
import { refusalLabel } from '@/lib/agentOrderLabels';
import { cmeDay } from '@/lib/frise';
import { dateTimeFormatter, ET_ZONE } from '@/lib/time';
import type { AgentProposal } from '@/store/agentOrders';

/** Qui propose, et ce que le desk en a fait : les types du store, la fiche ne lisant pas le pont du process principal. */
type AgentOrderOrigin = AgentProposal['origin'];
type AgentOrderOutcome = NonNullable<AgentProposal['outcome']>;

/**
 * La proposition de l'agent comme objet (OROS5.39, Système 5 « Fiche et Frise » ; repris du prototype D · Porte, d4) : ce
 * que la colonne Propositions d'Agent IA et la fiche d'une proposition lisent. Pur. L'agent propose, la garde du process
 * principal lit, l'opérateur décide dans le dialogue du process principal (Refuser par défaut) : le renderer ne fait que
 * montrer cette chaîne, du flux réel seulement (`useAgentOrders.proposals`, les événements `agent_order`), jamais une trace
 * de démonstration, et aucun bouton n'y accepte un ordre.
 */

/** Les douze issues d'une proposition (M.040), dans l'ordre où le desk les lit : la lecture, les dix gardes, puis vous. */
export const PROPOSAL_CELLS = MIRROR_ISSUES;
export type ProposalCell = MirrorIssue;

/**
 * L'état d'une case : `pass` franchie ; `stop` a arrêté la proposition ; `skip` contournée (une réduction de risque ne
 * rencontre ni la position, ni la marge datée, ni la règle du trader) ; `idle` pas encore lue.
 */
export type CellState = 'pass' | 'stop' | 'skip' | 'idle';

/** Les gardes qu'une réduction de risque ne rencontre pas (`guardProposal` : « une réduction de risque passe toujours »). */
const REDUCING_SKIPS: readonly ProposalCell[] = ['position', 'prop_buffer', 'trader_rule'];

/** L'étape d'une proposition : remise au desk, qui la garde puis vous la soumet ; ou décidée. */
export type ProposalStage = 'desk' | 'decided';

export interface ProposalView {
  id: string;
  at: number;
  origin: AgentOrderOrigin;
  account: string;
  instrument: string;
  side: 'buy' | 'sell' | null;
  qty: number | null;
  type: string;
  limit?: number;
  stop?: number;
  /** La raison donnée par l'agent : une citation, jamais un fait vérifié. */
  reason: string;
  /** La position signée avant l'ordre, telle que la garde l'a lue ; `null` : le renderer ne la connaît pas. */
  position: number | null;
  stage: ProposalStage;
  outcome: AgentOrderOutcome | null;
  /** Le numéro de l'événement `agent_order` au registre du desk, quand il y est rangé. */
  seq: number | null;
}

/**
 * Une proposition du store, comme objet. Un ordre envoyé porte les noms du pont (ceux du dialogue) et la position atteinte,
 * dont se déduit la position d'avant ; sinon les noms de la proposition, et la position reste inconnue du renderer.
 */
export function proposalView(p: AgentProposal): ProposalView {
  const sent = p.outcome?.status === 'sent' ? p.outcome : null;
  const side = sent ? sent.side : p.side === 'buy' || p.side === 'sell' ? p.side : null;
  return {
    id: p.id,
    at: p.at,
    origin: p.origin,
    account: sent?.account ?? p.account,
    instrument: sent?.instrument ?? p.instrument,
    side,
    qty: sent?.qty ?? p.qty,
    type: p.type,
    ...(p.limit !== undefined ? { limit: p.limit } : {}),
    ...(p.stop !== undefined ? { stop: p.stop } : {}),
    reason: p.reason,
    position: sent ? sent.resulting - signedQty({ side: sent.side, qty: sent.qty }) : null,
    stage: p.outcome ? 'decided' : 'desk',
    outcome: p.outcome,
    seq: p.seq,
  };
}

/** La position que l'ordre atteindrait ; `null` sans position, sens ou quantité connus. */
export function resultingPosition(p: Pick<ProposalView, 'position' | 'side' | 'qty'>): number | null {
  if (p.position === null || !p.side || p.qty === null) return null;
  return p.position + signedQty({ side: p.side, qty: p.qty });
}

/** L'ordre rapproche la position de zéro sans la retourner (`reducesRisk` du moteur). */
export function isReducing(p: Pick<ProposalView, 'position' | 'side' | 'qty'>): boolean {
  const after = resultingPosition(p);
  return after !== null && p.position !== null && reducesRisk(p.position, after);
}

/**
 * L'état de chacune des douze cases (M.040), lu de l'issue, dans l'ordre de `guardProposal` : un refus de la garde passe
 * les cases qui le précèdent et s'arrête sur la sienne ; un refus de l'opérateur (ou son silence) s'arrête sur « vous » ; un
 * ordre envoyé, ou que le pont a refusé après votre accord, les passe toutes. En cours, rien n'est encore lu.
 */
export function cellStates(p: Pick<ProposalView, 'position' | 'side' | 'qty' | 'outcome'>): CellState[] {
  const reducing = isReducing(p);
  const guard = (cell: ProposalCell): CellState => (reducing && REDUCING_SKIPS.includes(cell) ? 'skip' : 'pass');
  const o = p.outcome;
  if (!o) return PROPOSAL_CELLS.map(() => 'idle');
  if (o.status === 'refused') {
    const at = PROPOSAL_CELLS.indexOf(o.reason);
    return PROPOSAL_CELLS.map((cell, i) => (i < at ? guard(cell) : i === at ? 'stop' : 'idle'));
  }
  if (o.status === 'declined') return PROPOSAL_CELLS.map((cell) => (cell === 'declined' ? 'stop' : guard(cell)));
  return PROPOSAL_CELLS.map((cell) => (cell === 'declined' ? 'pass' : guard(cell)));
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Le sens, comme le dialogue l'écrit. */
function sideWord(side: ProposalView['side']): string {
  return side === 'buy' ? tr('ACHAT', 'BUY', 'COMPRA') : side === 'sell' ? tr('VENTE', 'SELL', 'VENTA') : '—';
}

/**
 * Les premières lignes du dialogue du process principal, mot pour mot (`proposalDialog`, `electron/agent-orders.ts`) : le
 * sens, la quantité, l'instrument et le type ; le compte ; la position avant et après, seulement quand la garde l'a lue. Un
 * miroir : tests/proposal-object.test.ts les compare au dialogue, dans les trois langues.
 */
export function dialogLines(p: Pick<ProposalView, 'side' | 'qty' | 'instrument' | 'type' | 'limit' | 'stop' | 'account' | 'position'>): string[] {
  const kind =
    p.type === 'limit'
      ? tr(`limite ${p.limit ?? '—'}`, `limit ${p.limit ?? '—'}`, `límite ${p.limit ?? '—'}`)
      : p.type === 'stop'
        ? tr(`stop ${p.stop ?? '—'}`, `stop ${p.stop ?? '—'}`, `stop ${p.stop ?? '—'}`)
        : p.type === 'market'
          ? tr('au marché', 'at market', 'a mercado')
          : p.type || '—';
  const lines = [`${sideWord(p.side)} ${p.qty ?? '—'} × ${p.instrument || '—'} ${kind}`, `${tr('Compte', 'Account', 'Cuenta')} : ${p.account || '—'}`];
  const after = resultingPosition(p);
  if (p.position !== null && after !== null) lines.push(`${tr('Position', 'Position', 'Posición')} : ${signed(p.position)} → ${signed(after)}`);
  return lines;
}

/** Qui propose, comme le process principal le nomme (`ORIGIN`, `electron/agent-orders.ts`). */
const ORIGIN: Readonly<Record<AgentOrderOrigin, readonly [string, string, string]>> = {
  llm: ['l’agent intégré', 'the built-in agent', 'el agente integrado'],
  mcp: ['un agent externe (MCP)', 'an external agent (MCP)', 'un agente externo (MCP)'],
  orch: ['l’orchestrateur externe', 'the external orchestrator', 'el orquestador externo'],
};

/** La ligne d'auteur, en tête de la proposition : le titre du dialogue du process principal, mot pour mot. */
export function authorLine(origin: AgentOrderOrigin): string {
  const [fr, en, es] = ORIGIN[origin];
  return tr(`Ordre proposé par ${fr}`, `Order proposed by ${en}`, `Orden propuesta por ${es}`);
}

/** La légende de la raison, comme le dialogue l'écrit : ce qui suit est une citation de l'agent. */
export function reasonCaption(): string {
  return tr('Raison donnée par l’agent', 'Reason given by the agent', 'Razón dada por el agente');
}

/** Le délai du dialogue, en secondes, lu de la constante du moteur (le process principal applique la même). */
export const CONFIRM_SECONDS = AGENT_CONFIRM_TIMEOUT_MS / 1000;

/** Le pied de la carte : le délai, le refus par défaut, et qu'aucun bouton ici n'accepte l'ordre. */
export function proposalFoot(): string {
  return tr(
    `${CONFIRM_SECONDS} s · Refuser par défaut · aucun bouton ici n’accepte l’ordre`,
    `${CONFIRM_SECONDS} s · Decline by default · no button here accepts the order`,
    `${CONFIRM_SECONDS} s · Rechazar por defecto · ningún botón aquí acepta la orden`,
  );
}

/** L'issue en une ligne : le titre. */
export function outcomeTitle(p: Pick<ProposalView, 'outcome'>): string {
  const o = p.outcome;
  if (!o) return tr('Chez la garde du desk', 'With the desk guard', 'En la guardia del desk');
  if (o.status === 'sent') return tr('Envoyée', 'Sent', 'Enviada');
  if (o.status === 'refused') return tr('Refusée par la garde', 'Refused by the guard', 'Rechazada por la guardia');
  if (o.status === 'failed') return tr('Refusée par le pont', 'Refused by the bridge', 'Rechazada por el puente');
  return tr('Non envoyée', 'Not sent', 'No enviada');
}

/**
 * Le détail de l'issue : le motif typé d'un refus de la garde (`refusalLabel`, puis ce que la garde a écrit d'une règle du
 * trader), l'ordre et sa latence, ce que le pont a répondu, ou les mots du process principal pour une proposition non
 * envoyée — tels quels, jamais relus.
 */
export function outcomeDetail(p: Pick<ProposalView, 'outcome'>): string {
  const o = p.outcome;
  if (!o) return '';
  if (o.status === 'sent') return `${o.orderId}${o.latencyMs != null ? ` · ${o.latencyMs} ms` : ''}`;
  if (o.status === 'refused') return o.reason === 'trader_rule' && o.detail ? `${refusalLabel(o.reason)} · ${o.detail}` : refusalLabel(o.reason);
  if (o.status === 'failed') return `${o.code != null ? `${tr('code', 'code', 'código')} ${o.code} · ` : ''}${o.detail}`;
  return o.detail;
}

/** Une issue qui n'a pas eu lieu (refus de la garde, de l'opérateur, du pont) : C.042, jamais le rouge. */
export function isRefusal(p: Pick<ProposalView, 'outcome'>): boolean {
  return !!p.outcome && p.outcome.status !== 'sent';
}

/** Les trois pas de la chaîne C.092 : l'agent propose, la garde du desk lit, vous décidez. */
export type ChainStep = 'agent' | 'guard' | 'you';
export type ChainState = 'done' | 'current' | 'stopped' | 'ahead';

/** Où en est la proposition sur la chaîne C.092, et où elle s'est arrêtée. */
export function chainStates(p: Pick<ProposalView, 'outcome'>): Record<ChainStep, ChainState> {
  const o = p.outcome;
  if (!o) return { agent: 'done', guard: 'current', you: 'ahead' };
  if (o.status === 'refused') return { agent: 'done', guard: 'stopped', you: 'ahead' };
  if (o.status === 'declined') return { agent: 'done', guard: 'done', you: 'stopped' };
  return { agent: 'done', guard: 'done', you: 'done' };
}

/** Le nom de chaque pas de la chaîne. */
export function chainWord(step: ChainStep): string {
  if (step === 'agent') return tr('l’agent propose', 'the agent proposes', 'el agente propone');
  if (step === 'guard') return tr('la garde du desk lit', 'the desk guard reads', 'la guardia del desk lee');
  return tr('vous décidez', 'you decide', 'usted decide');
}

const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: ET_ZONE };

/** L'heure d'une proposition, à New York (décision 7 : l'ET pour la frise et les fiches). */
export function proposalClock(ms: number): string {
  return dateTimeFormatter(CLOCK, 'en-GB').format(ms);
}

/** Le nom d'une proposition en clair : « ACHAT 1 × MNQ 12-26 · Sim101 ». */
export function proposalTitle(p: Pick<ProposalView, 'side' | 'qty' | 'instrument' | 'account'>): string {
  return `${sideWord(p.side)} ${p.qty ?? '—'} × ${p.instrument || '—'} · ${p.account || '—'}`;
}

/** L'issue en un mot : la ligne de l'omnibar. */
export function outcomeWord(p: Pick<ProposalView, 'outcome'>): string {
  const o = p.outcome;
  if (!o) return tr('chez la garde', 'with the guard', 'en la guardia');
  if (o.status === 'sent') return tr('envoyée', 'sent', 'enviada');
  if (o.status === 'refused') return `${tr('refusée par la garde', 'refused by the guard', 'rechazada por la guardia')} · ${refusalLabel(o.reason)}`;
  if (o.status === 'failed') return tr('refusée par le pont', 'refused by the bridge', 'rechazada por el puente');
  return tr('non envoyée', 'not sent', 'no enviada');
}

/** La journée CME d'une proposition : sa séance est celle de son compte ce jour-là. */
export function proposalDay(p: Pick<ProposalView, 'at'>): string {
  return cmeDay(p.at);
}

/**
 * Les objets auxquels une proposition est liée, lus à l'ouverture de sa fiche (rien n'est écrit au coffre) : son compte, tel
 * que le journal l'écrit quand il le connaît (la règle de la garde, `sameAccount`) ; son instrument, par sa racine (MNQ
 * n'est pas NQ) ; sa séance, celle de ce compte à la journée CME de la proposition, quand le journal l'a.
 */
export function proposalLinks(
  p: Pick<ProposalView, 'account' | 'instrument' | 'at'>,
  sessions: readonly Pick<Session, 'id' | 'date' | 'account'>[],
  rootOf: (instrument: string) => string,
): { account: EntityRef | null; instrument: EntityRef | null; session: EntityRef | null } {
  const account = p.account.trim();
  const journal = account ? sessions.find((x) => x.account && sameAccount(x.account, account)) : undefined;
  const day = proposalDay(p);
  const session = account ? sessions.find((x) => x.date === day && sameAccount(x.account ?? '', account)) : undefined;
  const root = p.instrument.trim() ? rootOf(p.instrument) : '';
  return {
    account: account ? { type: 'compte', id: journal?.account?.trim() || account } : null,
    instrument: root ? { type: 'instrument', id: root } : null,
    session: session ? { type: 'session', id: session.id } : null,
  };
}
