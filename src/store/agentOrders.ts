import { create } from 'zustand';
import { EVENT_LOG_MAX } from '@/engine/agent/events';
import { AGENT_ORDER_DEFAULTS, AGENT_RATE_WINDOW_MS, AGENT_REASON_MAX, parseProposal } from '@/engine/agent/orders';
import { desk, type AgentOrderOrigin, type AgentOrderOutcome, type AgentOrderStatus, type AgentOrderStep } from '@/lib/desk';
// Ce que le renderer transmet à la garde du process principal vit dans `deskEvents` (OROS5.9) : le miroir de la garde le relit.
import { propShareFor, recordDayClose, recordDeskEvent, traderRuleOf } from './deskEvents';

/** Statut hors desk (navigateur) ou avant la première lecture : désactivé. */
export const AGENT_ORDERS_OFF: AgentOrderStatus = { ...AGENT_ORDER_DEFAULTS, enabled: false, pending: false };

/**
 * Une proposition de l'agent, objet de la fiche (OROS5.39) : ce que l'agent a demandé, lu comme le process principal le lit
 * (`parseProposal`) quand elle est bien formée, et ce que le desk en a fait. Elle naît à l'envoi au process principal, sans
 * issue, et la reçoit à son retour. En mémoire seulement (décision 13) : rien n'est écrit au coffre.
 */
export interface AgentProposal {
  /** L'identifiant que le renderer lui donne à l'envoi (`p1`, `p2`…) : le même de l'envoi à l'issue. */
  id: string;
  at: number;
  origin: AgentOrderOrigin;
  account: string;
  instrument: string;
  side: string;
  qty: number | null;
  type: string;
  /** Prix d'un ordre limite ou stop, tel que l'agent l'a proposé. */
  limit?: number;
  stop?: number;
  /** La raison donnée par l'agent : une citation, sur une ligne, jamais un fait vérifié. */
  reason: string;
  /**
   * Ce que la garde du process principal a lu en la laissant passer (OROS5.40) : les noms du pont et la position avant et
   * après, ceux du dialogue ; `null` tant qu'il ne l'a pas dit.
   */
  held?: { account: string; instrument: string; position: number; resulting: number } | null;
  /** Le dialogue du process principal : ouvert à, refus par défaut à (OROS5.40) ; `null` tant qu'il ne s'est pas ouvert. */
  dialog?: { opened: number; deadline: number } | null;
  /** `null` tant que le process principal n'a pas répondu. */
  outcome: AgentOrderOutcome | null;
  /** Le numéro de son événement `agent_order` au registre du desk ; `null` tant qu'il n'y est pas, ou quand la cadence l'a tu. */
  seq: number | null;
}

/** Trace d'une proposition décidée : ce que l'agent a demandé et ce que le desk en a fait. */
export interface AgentOrderTrace extends AgentProposal {
  outcome: AgentOrderOutcome;
}

/** Les propositions gardées en mémoire : au plus autant que le registre du desk (décision 13). */
export const PROPOSALS_MAX = EVENT_LOG_MAX;

interface AgentOrdersState {
  status: AgentOrderStatus;
  /** Faux hors desk : le panneau le dit, l'outil refuse. */
  available: boolean;
  last: AgentOrderTrace | null;
  /** Les propositions du lancement, de la plus récente à la plus ancienne, en cours comprises (OROS5.39). */
  proposals: readonly AgentProposal[];
  refresh: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  setLimits: (raw: Partial<Pick<AgentOrderStatus, 'maxQty' | 'maxPosition' | 'perMinute'>>) => Promise<void>;
  /** Appelé par l'outil `propose_order` : le process principal garde, demande et soumet. */
  propose: (args: Record<string, unknown>, origin: AgentOrderOrigin) => Promise<AgentOrderOutcome>;
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Contrôles, formats (bidi, largeur nulle) et séparateurs : un texte de l'agent se lit sur une ligne, tel qu'il s'écrit. */
const UNSAFE_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;

/** Un texte de l'agent que le desk affiche : une ligne, sans contrôle ni bidi, borné. */
function line(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(UNSAFE_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

const price = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

let proposalCount = 0;

/** L'identifiant de la prochaine proposition du lancement : `p1`, `p2`… */
export function nextProposalId(): string {
  proposalCount += 1;
  return `p${proposalCount}`;
}

/**
 * Une proposition telle que l'agent l'a demandée, lue comme le process principal la lit (`parseProposal`) quand elle est
 * bien formée ; sinon ses champs bornés, sur une ligne. Rien de ce que l'agent écrit n'est exécuté : tout est texte.
 */
export function proposalOf(id: string, at: number, args: Record<string, unknown>, origin: AgentOrderOrigin): AgentProposal {
  const parsed = parseProposal(args);
  const p = parsed.ok ? parsed.proposal : null;
  const limit = price(p ? p.limit : args.limit);
  const stop = price(p ? p.stop : args.stop);
  return {
    id,
    at,
    origin,
    account: p?.account ?? line(args.account, 128),
    instrument: p?.instrument ?? line(args.instrument, 64),
    side: p?.side ?? line(args.side, 8),
    qty: p?.qty ?? (typeof args.qty === 'number' && Number.isFinite(args.qty) ? args.qty : null),
    type: p?.type ?? (line(args.type, 16) || 'market'),
    ...(limit !== undefined ? { limit } : {}),
    ...(stop !== undefined ? { stop } : {}),
    reason: p?.reason ?? line(args.reason, AGENT_REASON_MAX),
    held: null,
    dialog: null,
    outcome: null,
    seq: null,
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * L'étape d'une proposition, poussée par le process principal en lecture seule (OROS5.40), relue avant d'être crue : un
 * ticket, une étape connue, des instants et des positions finis, des noms bornés sur une ligne. Sinon rien.
 */
export function parseStep(raw: unknown): AgentOrderStep | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const ticket = typeof r.ticket === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(r.ticket) ? r.ticket : null;
  if (!ticket || !finite(r.at)) return null;
  if (r.stage === 'guarded') {
    if (!finite(r.position) || !finite(r.resulting)) return null;
    return { ticket, stage: 'guarded', at: r.at, account: line(r.account, 128), instrument: line(r.instrument, 64), position: r.position, resulting: r.resulting };
  }
  if (r.stage === 'dialog' && finite(r.deadline) && r.deadline >= r.at) return { ticket, stage: 'dialog', at: r.at, deadline: r.deadline };
  return null;
}

/** Une proposition en cours, avec son étape ; une proposition décidée, ou inconnue, ne bouge plus. */
export function withStep(p: AgentProposal, step: AgentOrderStep): AgentProposal {
  if (p.id !== step.ticket || p.outcome) return p;
  if (step.stage === 'guarded') return { ...p, held: { account: step.account || p.account, instrument: step.instrument || p.instrument, position: step.position, resulting: step.resulting } };
  return { ...p, dialog: { opened: step.at, deadline: step.deadline } };
}

/** Données de l'événement `agent_order` : bornées, sans rien que l'agent n'ait déjà vu. */
export function agentOrderEventData(args: Record<string, unknown>, origin: AgentOrderOrigin, outcome: AgentOrderOutcome): Record<string, unknown> {
  const data: Record<string, unknown> = {
    by: 'agent',
    origin,
    status: outcome.status,
    account: text(args.account, 128),
    instrument: text(args.instrument, 64),
    side: args.side === 'buy' || args.side === 'sell' ? args.side : null,
    qty: typeof args.qty === 'number' && Number.isFinite(args.qty) ? args.qty : null,
    type: typeof args.type === 'string' ? text(args.type, 16) : 'market',
    why: text(args.reason, 200),
  };
  if (outcome.status === 'sent') Object.assign(data, { orderId: outcome.orderId, resulting: outcome.resulting });
  if (outcome.status === 'refused') data.reason = outcome.reason;
  // L'issue `declined` est typée par le process principal (OROS5.40) : sans réponse dans le délai, ou refusée.
  if (outcome.status === 'declined') data.timeout = outcome.timeout === true;
  if (outcome.status === 'failed' && outcome.code !== undefined) data.code = outcome.code;
  if (outcome.status !== 'sent') data.detail = text(outcome.detail, AGENT_REASON_MAX);
  return data;
}

/**
 * Événements `agent_order` rangés dans le journal du desk (500 au plus). Un ordre envoyé l'est toujours ;
 * les autres issues, au plus 10 par minute et 60 par heure : une rafale de propositions ne vide pas le
 * journal. Le premier événement rangé ensuite dit combien n'ont pas été rangées (`suppressed`).
 */
export const AGENT_ORDER_EVENT_LIMITS = { perMinute: 10, perHour: 60 } as const;
const HOUR_MS = 3_600_000;
let journaled: number[] = [];
let suppressed = 0;

/** Range l'événement d'une proposition ; rend son numéro au registre, ou `null` quand la cadence du journal l'a tu. */
function journalProposal(data: Record<string, unknown>, status: AgentOrderOutcome['status'], now = Date.now()): number | null {
  journaled = journaled.filter((t) => now - t < HOUR_MS);
  const lastMinute = journaled.filter((t) => now - t < AGENT_RATE_WINDOW_MS).length;
  if (status !== 'sent' && (lastMinute >= AGENT_ORDER_EVENT_LIMITS.perMinute || journaled.length >= AGENT_ORDER_EVENT_LIMITS.perHour)) {
    suppressed += 1;
    return null;
  }
  journaled.push(now);
  if (suppressed) {
    data.suppressed = suppressed;
    suppressed = 0;
  }
  return recordDeskEvent('agent_order', data).seq;
}

/** Remplace une proposition de la liste par sa version suivante, sans changer sa place. */
function replaceProposal(list: readonly AgentProposal[], next: AgentProposal): AgentProposal[] {
  return list.map((p) => (p.id === next.id ? next : p));
}

export const useAgentOrders = create<AgentOrdersState>((set, get) => ({
  status: AGENT_ORDERS_OFF,
  available: !!desk?.agentOrders,
  last: null,
  proposals: [],

  async refresh() {
    if (!desk?.agentOrders) return;
    set({ status: await desk.agentOrders.status(), available: true });
  },

  async enable() {
    if (!desk?.agentOrders) return;
    set({ status: await desk.agentOrders.enable() });
  },

  async disable() {
    if (!desk?.agentOrders) return;
    set({ status: await desk.agentOrders.disable() });
  },

  async setLimits(raw) {
    if (!desk?.agentOrders) return;
    set({ status: await desk.agentOrders.limits(raw) });
  },

  async propose(args, origin) {
    const api = desk?.agentOrders;
    // La proposition devient un objet dès l'envoi : la colonne Propositions et sa fiche la suivent jusqu'à l'issue.
    const proposal = proposalOf(nextProposalId(), Date.now(), args, origin);
    set({ proposals: [proposal, ...get().proposals].slice(0, PROPOSALS_MAX) });
    let outcome: AgentOrderOutcome;
    if (!api) {
      outcome = { status: 'refused', reason: 'disabled', detail: 'desk indisponible : les ordres de l’agent passent par l’application de bureau' };
    } else {
      set({ status: { ...get().status, pending: true } });
      try {
        // La journée fermée d'abord (décision 15) : une perte du jour vue à cet instant la ferme avant que la règle se lise.
        recordDayClose();
        // L'identifiant de la proposition part comme ticket : le process principal le renvoie avec chaque étape (OROS5.40).
        outcome = await api.propose(args, origin, propShareFor(text(args.account, 128)), traderRuleOf(args), proposal.id);
      } catch (e) {
        outcome = { status: 'failed', detail: e instanceof Error ? e.message : String(e) };
      }
      set({ status: await api.status().catch(() => ({ ...get().status, pending: false })) });
    }
    const seq = journalProposal(agentOrderEventData(args, origin, outcome), outcome.status);
    // L'étape reçue en chemin (gardée, dialogue ouvert) reste à la proposition décidée.
    const current = get().proposals.find((p) => p.id === proposal.id) ?? proposal;
    const trace: AgentOrderTrace = { ...current, outcome, seq };
    set({ last: trace, proposals: replaceProposal(get().proposals, trace) });
    return outcome;
  },
}));

/**
 * L'étape de chaque proposition, telle que le process principal la pousse (OROS5.40) : la carte la suit sans relire le
 * statut, ni minuterie ni relecture. Hors desk, rien ne s'abonne.
 */
desk?.agentOrders?.onStep?.((raw) => {
  const step = parseStep(raw);
  if (!step) return;
  const { proposals } = useAgentOrders.getState();
  if (!proposals.some((p) => p.id === step.ticket && !p.outcome)) return;
  useAgentOrders.setState({ proposals: proposals.map((p) => withStep(p, step)) });
});
