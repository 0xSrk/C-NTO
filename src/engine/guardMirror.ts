/**
 * Le miroir de la garde de l'agent (OROS5.10). Pur. Il ne recopie aucun critère : il lit la proposition comme le
 * process principal (`parseProposal`), puis appelle `guardProposal` (`src/engine/agent/orders.ts`), la garde même, sur
 * une ouverture fictive d'un contrat, avec ce que le renderer lui transmettrait (`propShareFor`, `traderRulesOf`),
 * l'activation, les limites et le canal que le process principal annonce.
 *
 * - Le verdict est celui du process principal : la lecture, puis la garde ; le premier refus, ou la décision de
 *   l'opérateur.
 * - Les douze issues suivent l'ordre où le desk les lit : la lecture, les dix gardes (`AGENT_ORDER_REFUSALS`), puis
 *   vous. L'état de chacune est le retour de `guardProposal` quand les gardes qui la précèdent sont levées : on lit ce
 *   qui refuserait ensuite, sans rien recoder.
 * - Un compte hors `Sim*` arrête la chaîne : l'agent n'y propose jamais. Pont hors ligne, ce qui se lit au pont (le
 *   canal, la position) n'est pas connu : jamais « canal ouvert ».
 * - Une réduction de risque passe toujours la position, la marge et les règles du trader : la garde le dit, le miroir
 *   le répète.
 *
 * Un miroir : rien ici n'accepte, n'envoie ni ne lève une garde. L'opérateur décide dans le dialogue du process principal.
 */
import { tr } from '@/i18n';
import {
  AGENT_CONFIRM_TIMEOUT_MS,
  AGENT_ORDER_REFUSALS,
  AGENT_PROP_FLOOR,
  guardProposal,
  parseProposal,
  reducesRisk,
  signedQty,
  type AgentOrderPolicy,
  type AgentOrderProposal,
  type AgentOrderRefusal,
  type AgentOrderSnapshot,
  type AgentTraderRuleBlock,
} from './agent/orders';

/** Les douze issues d'une proposition, dans l'ordre où le desk les lit : la lecture, les dix gardes, puis vous. */
export const MIRROR_ISSUES = ['invalid', ...AGENT_ORDER_REFUSALS, 'declined'] as const;
export type MirrorIssue = (typeof MIRROR_ISSUES)[number];

/**
 * `refuse` : refuserait ; `pass` : laisse passer ; `moot` : l'agent n'arrive pas jusque-là sur ce compte ; `unknown` :
 * se lit au pont, hors ligne ; `proposal` : se lit à chaque proposition (sa quantité, la cadence que compte le process
 * principal) ; `operator` : vous, dans le dialogue du desk.
 */
export type GateState = 'refuse' | 'pass' | 'moot' | 'unknown' | 'proposal' | 'operator';

export type GateDistance =
  | { kind: 'position'; position: number; resulting: number; max: number }
  | { kind: 'margin'; share: number | null; floor: number }
  | { kind: 'bound'; max: number; unit: 'contracts' | 'perMinute' }
  | { kind: 'rules'; rules: readonly AgentTraderRuleBlock[] }
  | { kind: 'timeout'; ms: number };

export interface MirrorGate {
  key: MirrorIssue;
  state: GateState;
  /** Le motif tel que la garde l'écrit, quand ce critère refuse. */
  detail?: string;
  /** Ce qui sépare de la borne : position, marge, limite, règles, délai. */
  distance?: GateDistance;
  /** Passée parce que l'ordre réduit le risque : la garde ne borne pas une réduction. */
  reduction?: true;
}

export interface MirrorInput {
  now: number;
  /** Activation et limites annoncées par le process principal ; hors desk : désactivées. */
  policy: AgentOrderPolicy;
  /** Une proposition attend déjà la réponse de l'opérateur. */
  pending: boolean;
  /** Lien du pont, tel que le process principal le lit (`publicStatus().link`). */
  link: string;
  /** Canal d'ordres, tel que le process principal le lit (`publicStatus().ordersOpen`) ; faux après le kill switch. */
  ordersOpen: boolean;
  /** Compte de l'ouverture fictive ; `null` : aucun compte connu. */
  account: string | null;
  instrument: string | null;
  /** Position signée du compte sur l'instrument (0 sans position). */
  position: number;
  /** Ce que le renderer transmettrait au process principal pour ce compte (`propShareFor`). */
  propShare: number | null;
  /** Toutes les règles du trader que l'ouverture enfreindrait (`traderRulesOf`) ; la garde lit la première. */
  traderRules: readonly AgentTraderRuleBlock[];
  /** Sens de l'ordre fictif ; absent : celui qui éloigne la position de zéro (une ouverture). */
  side?: AgentOrderProposal['side'];
  /** Quantité de l'ordre fictif ; absente : celle de chaque proposition (le miroir dit sa borne, un contrat est lu). */
  qty?: number;
  /** Propositions de la dernière minute, si on les connaît ; absentes : le process principal seul les compte. */
  recent?: readonly number[];
}

export interface GuardMirror {
  proposal: AgentOrderProposal;
  /** Le verdict du process principal : la lecture (`parseProposal`), puis `guardProposal`. */
  verdict: { ok: true; resulting: number; reducing: boolean } | { ok: false; reason: AgentOrderRefusal | 'invalid'; detail: string };
  /** L'ordre fictif rapproche la position de zéro sans la retourner. */
  reducing: boolean;
  /** Le premier refus, dans l'ordre de la garde : celui du verdict ; `null` quand la décision revient à l'opérateur. */
  first: MirrorGate | null;
  /** Les douze issues, dans l'ordre de `MIRROR_ISSUES`. */
  gates: MirrorGate[];
}

/** Ce qui se lit au pont : hors ligne, ni le canal ni la position ne sont connus. */
const BRIDGE_READ: readonly MirrorIssue[] = ['orders_closed', 'position'];
/** Ce que la garde ne borne pas pour une réduction de risque. */
const REDUCTION_PASSES: readonly MirrorIssue[] = ['position', 'prop_buffer', 'trader_rule'];

/** L'ordre fictif : un contrat (ou `qty`), au marché, dans le sens donné ou celui qui éloigne la position de zéro. */
export function mirrorProposal(input: Pick<MirrorInput, 'account' | 'instrument' | 'position' | 'qty' | 'side'>): AgentOrderProposal {
  return {
    account: input.account ?? '',
    instrument: input.instrument ?? '',
    side: input.side ?? (input.position < 0 ? 'sell' : 'buy'),
    qty: input.qty ?? 1,
    type: 'market',
    reason: tr('miroir de la garde', 'guard mirror', 'espejo de la guarda'),
  };
}

export function guardMirror(input: MirrorInput): GuardMirror {
  const raw = mirrorProposal(input);
  const parsed = parseProposal(raw);
  const proposal = parsed.ok ? parsed.proposal : raw;
  const snap: AgentOrderSnapshot = {
    now: input.now,
    link: input.link,
    ordersOpen: input.ordersOpen,
    position: input.position,
    recent: input.recent ?? [],
    busy: input.pending,
    propShare: input.propShare,
    traderRule: input.traderRules[0] ?? null,
  };
  const verdict: GuardMirror['verdict'] = parsed.ok ? guardProposal(proposal, input.policy, snap) : { ok: false, reason: 'invalid', detail: parsed.detail };
  const resulting = input.position + signedQty(proposal);
  const reducing = reducesRisk(input.position, resulting);
  const distanceOf = (key: AgentOrderRefusal): GateDistance | undefined => {
    if (key === 'position') return { kind: 'position', position: input.position, resulting, max: input.policy.maxPosition };
    if (key === 'prop_buffer') return { kind: 'margin', share: input.propShare, floor: AGENT_PROP_FLOOR };
    if (key === 'quantity') return { kind: 'bound', max: input.policy.maxQty, unit: 'contracts' };
    if (key === 'rate') return { kind: 'bound', max: input.policy.perMinute, unit: 'perMinute' };
    if (key === 'trader_rule') return { kind: 'rules', rules: input.traderRules };
    return undefined;
  };

  const gates: MirrorGate[] = [parsed.ok ? { key: 'invalid', state: 'pass' } : { key: 'invalid', state: 'refuse', detail: parsed.detail }];
  let policy = input.policy;
  let s = snap;
  let stopped = false;
  let offline = false;
  for (const key of AGENT_ORDER_REFUSALS) {
    let state: GateState;
    let detail: string | undefined;
    if (stopped) state = 'moot';
    else if (offline && BRIDGE_READ.includes(key)) state = 'unknown';
    else {
      const r = guardProposal(proposal, policy, s);
      const refuses = !r.ok && r.reason === key;
      // La quantité et la cadence d'une vraie proposition ne se connaissent qu'à son arrivée : sans elles, la borne seule se dit.
      const perProposal = (key === 'quantity' && input.qty === undefined) || (key === 'rate' && input.recent === undefined);
      state = refuses ? 'refuse' : perProposal ? 'proposal' : 'pass';
      if (refuses) detail = r.detail;
    }
    const distance = distanceOf(key);
    gates.push({ key, state, ...(detail ? { detail } : {}), ...(distance ? { distance } : {}), ...(state === 'pass' && reducing && REDUCTION_PASSES.includes(key) ? { reduction: true as const } : {}) });
    if (state === 'pass') continue;
    // Lever ce critère pour lire le suivant : la garde dit alors ce qui refuserait ensuite. Un critère qui passe reste tel quel.
    if (key === 'disabled') policy = { ...policy, enabled: true };
    if (key === 'not_sim' && state === 'refuse') stopped = true;
    if (key === 'busy') s = { ...s, busy: false };
    if (key === 'link') {
      offline = state === 'refuse';
      s = { ...s, link: 'live' };
    }
    if (key === 'orders_closed') s = { ...s, ordersOpen: true };
    if (key === 'rate') s = { ...s, recent: [] };
    if (key === 'quantity') policy = { ...policy, maxQty: Math.max(policy.maxQty, proposal.qty) };
    if (key === 'position') s = { ...s, position: 0 };
    if (key === 'prop_buffer') s = { ...s, propShare: null };
  }
  gates.push({ key: 'declined', state: stopped ? 'moot' : 'operator', distance: { kind: 'timeout', ms: AGENT_CONFIRM_TIMEOUT_MS } });
  return { proposal, verdict, reducing, first: gates.find((g) => g.state === 'refuse') ?? null, gates };
}

/* ─── En mots, dans la langue du desk ─── */

const pct = (v: number) => `${Math.round(v * 100)} %`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Le nom court de chaque issue. */
export function mirrorIssueName(key: MirrorIssue): string {
  switch (key) {
    case 'invalid':
      return tr('lecture', 'reading', 'lectura');
    case 'disabled':
      return tr('activés', 'enabled', 'activadas');
    case 'not_sim':
      return tr('comptes Sim', 'Sim accounts', 'cuentas Sim');
    case 'busy':
      return tr('une à la fois', 'one at a time', 'una a la vez');
    case 'link':
      return tr('pont', 'bridge', 'puente');
    case 'orders_closed':
      return tr('canal', 'channel', 'canal');
    case 'rate':
      return tr('cadence', 'rate', 'cadencia');
    case 'quantity':
      return tr('contrats', 'contracts', 'contratos');
    case 'position':
      return tr('position', 'position', 'posición');
    case 'prop_buffer':
      return tr('marge datée', 'dated margin', 'margen fechado');
    case 'trader_rule':
      return tr('règle du trader', 'trader rule', 'regla del trader');
    case 'declined':
      return tr('vous', 'you', 'usted');
  }
}

/** Une issue en mots : son état et sa distance à la borne. */
export function gateWords(gate: MirrorGate): string {
  const d = gate.distance;
  if (gate.state === 'moot') return tr('ne s’applique pas : l’agent ne propose que sur les comptes Sim', 'does not apply: the agent only proposes on Sim accounts', 'no se aplica: el agente solo propone en cuentas Sim');
  if (gate.state === 'unknown') return tr('inconnu : pont hors ligne', 'unknown: bridge offline', 'desconocido: puente fuera de línea');
  if (gate.reduction) return tr('réduction de risque : passe toujours', 'risk reduction: always passes', 'reducción de riesgo: siempre pasa');
  switch (gate.key) {
    case 'invalid':
      return gate.state === 'refuse' ? tr(`proposition illisible : ${gate.detail ?? ''}`, `unreadable proposal: ${gate.detail ?? ''}`, `propuesta ilegible: ${gate.detail ?? ''}`) : tr('proposition lisible', 'readable proposal', 'propuesta legible');
    case 'disabled':
      return gate.state === 'refuse' ? tr('ordres de l’agent désactivés', 'agent orders turned off', 'órdenes del agente desactivadas') : tr('ordres de l’agent activés', 'agent orders turned on', 'órdenes del agente activadas');
    case 'not_sim':
      return gate.state === 'refuse' ? tr('compte hors Sim', 'not a Sim account', 'cuenta no Sim') : tr('compte Sim', 'Sim account', 'cuenta Sim');
    case 'busy':
      return gate.state === 'refuse' ? tr('une proposition attend déjà votre réponse', 'a proposal is already waiting for your answer', 'una propuesta ya espera su respuesta') : tr('aucune proposition en attente', 'no proposal waiting', 'ninguna propuesta en espera');
    case 'link':
      return gate.state === 'refuse' ? tr('pont NinjaTrader hors ligne', 'NinjaTrader bridge offline', 'puente NinjaTrader fuera de línea') : tr('pont en ligne', 'bridge online', 'puente en línea');
    case 'orders_closed':
      return gate.state === 'refuse' ? tr('canal d’ordres fermé jusqu’au redémarrage', 'order channel closed until restart', 'canal de órdenes cerrado hasta el reinicio') : tr('canal d’ordres ouvert', 'order channel open', 'canal de órdenes abierto');
    case 'rate':
    case 'quantity': {
      const max = d?.kind === 'bound' ? d.max : 0;
      const bound = gate.key === 'rate' ? tr(`au plus ${max} proposition(s) par minute`, `at most ${max} proposal(s) per minute`, `como máximo ${max} propuesta(s) por minuto`) : tr(`au plus ${max} contrat(s) par ordre`, `at most ${max} contract(s) per order`, `como máximo ${max} contrato(s) por orden`);
      if (gate.state === 'proposal') return tr(`lu à chaque proposition · ${bound}`, `read on each proposal · ${bound}`, `leído en cada propuesta · ${bound}`);
      return gate.state === 'refuse' ? tr(`dépassé · ${bound}`, `exceeded · ${bound}`, `superado · ${bound}`) : bound;
    }
    case 'position': {
      if (d?.kind !== 'position') return '—';
      const move = `${signed(d.position)} → ${signed(d.resulting)}`;
      return gate.state === 'refuse' ? tr(`position ${move} : au-delà de ${d.max}`, `position ${move}: beyond ${d.max}`, `posición ${move}: más allá de ${d.max}`) : tr(`position ${move}, au plus ${d.max}`, `position ${move}, at most ${d.max}`, `posición ${move}, como máximo ${d.max}`);
    }
    case 'prop_buffer': {
      if (d?.kind !== 'margin' || d.share === null) return tr('aucun plan suivi ne borne ce compte', 'no tracked plan bounds this account', 'ningún plan seguido limita esta cuenta');
      return gate.state === 'refuse'
        ? tr(`marge à ${pct(d.share)} du drawdown maximal, sous ${pct(d.floor)}`, `margin at ${pct(d.share)} of the maximum drawdown, below ${pct(d.floor)}`, `margen al ${pct(d.share)} del drawdown máximo, por debajo del ${pct(d.floor)}`)
        : tr(`marge à ${pct(d.share)} du drawdown maximal, plancher ${pct(d.floor)}`, `margin at ${pct(d.share)} of the maximum drawdown, floor ${pct(d.floor)}`, `margen al ${pct(d.share)} del drawdown máximo, piso ${pct(d.floor)}`);
    }
    case 'trader_rule': {
      const rules = d?.kind === 'rules' ? d.rules : [];
      return rules.length ? rules.map((r) => r.detail).join(' · ') : tr('aucune règle du trader enfreinte', 'no trader rule broken', 'ninguna regla del trader incumplida');
    }
    case 'declined': {
      const s = d?.kind === 'timeout' ? Math.round(d.ms / 1000) : 0;
      return tr(`vous décidez dans le dialogue du desk · refus par défaut à ${s} s`, `you decide in the desk dialog · declined by default after ${s} s`, `usted decide en el diálogo del desk · rechazo por defecto a los ${s} s`);
    }
  }
}
