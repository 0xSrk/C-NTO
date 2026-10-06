import { AGENT_ORDER_DEFAULTS, guardProposal, parseProposal, type AgentOrderPolicy, type AgentOrderProposal } from '@/engine/agent/orders';
import type { DeskCalendarEntry, DeskNote, DeskPorts } from '@/engine/agent/ports';
import { bundleCoverage, materializeBundle } from '@/engine/calendar-bundle';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { generateDemoJournal } from '@/engine/demo';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import { linkId, PREDICATES, type Predicate } from '@/engine/ontology/schema';
import type { Session, Trade } from '@/engine/types';

/** Jeu de démo du cahier (AUDIT 3.5.0) : 140 séances, graine 2052, fin le 1er octobre 2026 à midi UTC. */
export const DEMO_SESSIONS = 140;
export const DEMO_SEED = 2052;
export const DEMO_END = '2026-10-01T12:00:00Z';
/** Compte et plan de la démo : `generateDemoJournal` écrit `Apex-PA-50K`, le réglage par défaut suit `apex-50`. */
export const DEMO_ACCOUNT = 'Apex-PA-50K';
export const DEMO_PLAN = 'apex-50';

/** Écriture reçue par un port du desk, dans l'ordre d'appel. */
export type DeskWrite =
  | { port: 'updateSession'; id: string; patch: { note?: string; tags?: string[] } }
  | { port: 'createNote'; title: string; body: string; tags: string[] }
  | { port: 'branchNote'; parentId: string; ancre: string; question: string }
  | { port: 'linkNotes'; fromId: string; toId: string; predicate: string }
  | { port: 'proposeOrder'; args: Record<string, unknown>; outcome: Record<string, unknown> };

export interface DemoDeskOptions {
  sessions?: number;
  seed?: number;
  /** Fin du journal de démo (ISO). */
  end?: string;
  /** Séances et trades remplaçant la démo (cas construits). */
  journal?: { sessions: Session[]; trades: Trade[] };
  /** Séances et trades ajoutés au journal (un vrai journal mêlé à la démo, un second compte…). */
  extra?: { sessions: Session[]; trades: Trade[] };
  planId?: string;
  planAccount?: string;
  startingBalance?: number;
  notes?: DeskNote[];
  calendarEntries?: DeskCalendarEntry[];
  /** Lignes officielles ; défaut : l'instantané embarqué matérialisé sur toute sa couverture. */
  officialEvents?: CalendarEventRow[];
  /** Politique d'ordres de l'agent tenue par le process principal ; défaut : désactivée. */
  orderPolicy?: AgentOrderPolicy;
  /** Réponse de l'opérateur au dialogue d'ordre du process principal ; défaut : Refuser. */
  confirmOrder?: (p: AgentOrderProposal) => boolean;
  /** Horloge du desk (epoch ms) ; défaut : fin du jeu de démo. */
  now?: number;
}

export interface DemoDesk {
  ports: DeskPorts;
  sessions: Session[];
  trades: Trade[];
  notes: DeskNote[];
  officialEvents: CalendarEventRow[];
  planId: string;
  planAccount: string;
  startingBalance: number;
  /** Chaque appel d'un port d'écriture (`updateSession`, `createNote`, `branchNote`, `linkNotes`, `proposeOrder`). */
  writes: DeskWrite[];
  /** Ordres réellement soumis : garde du process principal passée et opérateur d'accord. */
  submitted: AgentOrderProposal[];
}

const NOTE_AT = Date.parse('2026-09-30T20:00:00Z');

const DEFAULT_NOTES: DeskNote[] = [
  { id: 'n_plan', title: 'Plan de trading', body: 'Pas plus de deux pertes par séance. Pas de trade dans les 15 minutes autour du NFP.', tags: ['plan'], updatedAt: NOTE_AT },
  { id: 'n_revue', title: 'Revue de septembre', body: 'Les séances en dérive commencent après une perte en ouverture.', tags: ['revue'], updatedAt: NOTE_AT },
];

/**
 * Desk de démonstration branché sur les moteurs : le journal de `generateDemoJournal`, le plan et
 * le compte de la démo, le calendrier officiel de l'instantané embarqué. Les ports d'écriture
 * enregistrent chaque appel ; `proposeOrder` rejoue la garde du process principal (`guardProposal`)
 * puis sa confirmation : rien n'est soumis tant que la politique est désactivée.
 */
export function demoDesk(opts: DemoDeskOptions = {}): DemoDesk {
  const base = opts.journal ?? generateDemoJournal({ sessions: opts.sessions ?? DEMO_SESSIONS, seed: opts.seed ?? DEMO_SEED, endDate: new Date(opts.end ?? DEMO_END) });
  const sessions = [...base.sessions, ...(opts.extra?.sessions ?? [])];
  const trades = [...base.trades, ...(opts.extra?.trades ?? [])];
  const notes = [...DEFAULT_NOTES, ...(opts.notes ?? [])];
  const officialEvents = opts.officialEvents ?? materializeBundle(bundleCoverage());
  const policy = opts.orderPolicy ?? AGENT_ORDER_DEFAULTS;
  const writes: DeskWrite[] = [];
  const submitted: AgentOrderProposal[] = [];
  const proposedAt: number[] = [];
  const planId = opts.planId ?? DEMO_PLAN;
  const planAccount = opts.planAccount ?? DEMO_ACCOUNT;
  const startingBalance = opts.startingBalance ?? 50_000;
  let noteSeq = 0;

  const ports: DeskPorts = {
    sessions: () => sessions,
    trades: () => trades,
    startingBalance: () => startingBalance,
    planId: () => planId,
    planAccount: () => planAccount,
    traderRules: () => DEFAULT_TRADER_RULES,
    async updateSession(id, patch) {
      writes.push({ port: 'updateSession', id, patch });
      const row = sessions.find((s) => s.id === id);
      if (row) Object.assign(row, patch);
    },
    notes: () => notes,
    async createNote(title, body, tags) {
      writes.push({ port: 'createNote', title, body, tags });
      const note: DeskNote = { id: `n_agent_${++noteSeq}`, title, body, tags, updatedAt: NOTE_AT, by: 'agent' };
      notes.push(note);
      return { id: note.id, title: note.title };
    },
    async branchNote(parentId, ancre, question) {
      writes.push({ port: 'branchNote', parentId, ancre, question });
      if (!notes.some((n) => n.id === parentId)) return null;
      const note: DeskNote = { id: `n_agent_${++noteSeq}`, title: question, body: '', tags: [], updatedAt: NOTE_AT, parentId, ancre, question, by: 'agent' };
      notes.push(note);
      return { id: note.id, title: note.title };
    },
    async linkNotes(fromId, toId, predicate) {
      writes.push({ port: 'linkNotes', fromId, toId, predicate });
      if (!(PREDICATES as readonly string[]).includes(predicate)) return null;
      return { id: linkId({ type: 'note', id: fromId }, predicate as Predicate, { type: 'note', id: toId }) };
    },
    calendarEntries: () => opts.calendarEntries ?? [],
    officialEvents: () => officialEvents,
    bridge: async () => ({ nt: null, copier: null }),
    workingOrders: async () => null,
    marketQuotes: () => [],
    marketFeed: () => 'closed',
    portfolio: async () => ({ pockets: [], positions: [], cash: [], fx: [], base: 'USD' }),
    barSeries: async () => [],
    events: () => ({ cursor: '', events: [], more: false, dropped: 0, reset: false }),
    now: () => opts.now ?? Date.parse(opts.end ?? DEMO_END),
    async proposeOrder(args) {
      // Même ordre que le process principal : lecture, garde, dialogue de l'opérateur, soumission.
      const outcome = ((): Record<string, unknown> => {
        const parsed = parseProposal(args);
        if (!parsed.ok) return { ok: false, status: 'refused', reason: 'invalid', detail: parsed.detail };
        const now = opts.now ?? Date.parse(opts.end ?? DEMO_END);
        const verdict = guardProposal(parsed.proposal, policy, { now, link: 'live', ordersOpen: true, position: 0, recent: proposedAt, busy: false, propShare: null });
        proposedAt.push(now);
        if (!verdict.ok) return { ok: false, status: 'refused', reason: verdict.reason, detail: verdict.detail };
        if (!(opts.confirmOrder?.(parsed.proposal) ?? false)) return { ok: false, status: 'declined', detail: 'refusé par le trader' };
        submitted.push(parsed.proposal);
        return { ok: true, status: 'sent', orderId: `o${submitted.length}`, resulting: verdict.resulting };
      })();
      writes.push({ port: 'proposeOrder', args, outcome });
      return outcome;
    },
  };

  return { ports, sessions, trades, notes, officialEvents, planId, planAccount, startingBalance, writes, submitted };
}
