import { create } from 'zustand';
import { AGENT_ORDER_DEFAULTS, AGENT_REASON_MAX } from '@/engine/agent/orders';
import { desk, type AgentOrderOrigin, type AgentOrderOutcome, type AgentOrderStatus } from '@/lib/desk';
import { recordDeskEvent, trackedPropShare } from './deskEvents';
import { useSettings } from './settings';

/** Statut hors desk (navigateur) ou avant la première lecture : désactivé. */
export const AGENT_ORDERS_OFF: AgentOrderStatus = { ...AGENT_ORDER_DEFAULTS, enabled: false, pending: false };

/** Trace d'une proposition : ce que l'agent a demandé et ce que le desk en a fait. */
export interface AgentOrderTrace {
  at: number;
  origin: AgentOrderOrigin;
  account: string;
  instrument: string;
  side: string;
  qty: number | null;
  type: string;
  outcome: AgentOrderOutcome;
}

interface AgentOrdersState {
  status: AgentOrderStatus;
  /** Faux hors desk : le panneau le dit, l'outil refuse. */
  available: boolean;
  last: AgentOrderTrace | null;
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

const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Marge du plan suivi pour le compte proposé. Le process principal lit le pont sans tenir compte de la casse
 * ni des espaces (`SimAPEX1` y désigne `SimApex1`) : le compte du plan est reconnu de même, sinon la garde
 * de marge sauterait.
 */
function propShareFor(account: string): number | null {
  const { planAccount } = useSettings.getState().settings;
  return trackedPropShare(planAccount && fold(planAccount) === fold(account) ? planAccount : account);
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
  if (outcome.status === 'failed' && outcome.code !== undefined) data.code = outcome.code;
  if (outcome.status !== 'sent') data.detail = text(outcome.detail, AGENT_REASON_MAX);
  return data;
}

export const useAgentOrders = create<AgentOrdersState>((set, get) => ({
  status: AGENT_ORDERS_OFF,
  available: !!desk?.agentOrders,
  last: null,

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
    let outcome: AgentOrderOutcome;
    if (!api) {
      outcome = { status: 'refused', reason: 'disabled', detail: 'desk indisponible : les ordres de l’agent passent par l’application de bureau' };
    } else {
      set({ status: { ...get().status, pending: true } });
      try {
        outcome = await api.propose(args, origin, propShareFor(text(args.account, 128)));
      } catch (e) {
        outcome = { status: 'failed', detail: e instanceof Error ? e.message : String(e) };
      }
      set({ status: await api.status().catch(() => ({ ...get().status, pending: false })) });
    }
    const trace: AgentOrderTrace = {
      at: Date.now(),
      origin,
      account: text(args.account, 128),
      instrument: text(args.instrument, 64),
      side: text(args.side, 8),
      qty: typeof args.qty === 'number' ? args.qty : null,
      type: text(args.type, 16) || 'market',
      outcome,
    };
    set({ last: trace });
    recordDeskEvent('agent_order', agentOrderEventData(args, origin, outcome));
    return outcome;
  },
}));
