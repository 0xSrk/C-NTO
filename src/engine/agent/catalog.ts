/**
 * Noms et types des outils du desk : la seule liste. Le moteur (`tools.ts`) la vérifie, le process
 * principal l'importe pour l'allowlist de l'orchestrateur (émis vers `dist-electron/agent/catalog.js`
 * par `electron/tsconfig.sources.json`). Aucun import : ce module tourne des deux côtés.
 */
export const DESK_TOOL_KINDS = {
  desk_overview: 'read',
  list_sessions: 'read',
  get_session: 'read',
  search_notes: 'read',
  read_note: 'read',
  calendar_events: 'read',
  journal_breakdown: 'read',
  monte_carlo: 'read',
  bridge_status: 'read',
  portfolio_snapshot: 'read',
  market_levels: 'read',
  propfirm_status: 'read',
  desk_events: 'read',
  annotate_session: 'write',
  create_note: 'write',
  branch_note: 'write',
  link_notes: 'write',
  propose_order: 'write',
} as const satisfies Record<string, 'read' | 'write'>;

/**
 * Outils d'ordre : écritures que le process principal fait confirmer à l'opérateur dans son propre
 * dialogue (pas de confirmation du renderer en plus), avec un délai de réponse plus long.
 */
export const ORDER_TOOLS: readonly string[] = ['propose_order'];

export type DeskToolName = keyof typeof DESK_TOOL_KINDS;

/** Indications d'un outil pour un client MCP (`annotations` de `tools/list`). */
export interface DeskToolHints {
  /** Ne modifie rien. */
  readOnly: boolean;
  /** Peut remplacer ou effacer ce qui existe (sens seulement pour une écriture). */
  destructive: boolean;
  /** Le même appel répété ne change rien de plus. */
  idempotent: boolean;
  /** Agit hors du desk (pont NinjaTrader, marché). */
  openWorld: boolean;
}

const READ_HINTS: DeskToolHints = { readOnly: true, destructive: false, idempotent: true, openWorld: false };
const ADD_HINTS: DeskToolHints = { readOnly: false, destructive: false, idempotent: false, openWorld: false };

/** Indications de chaque outil : le process principal en tire les `annotations` MCP. */
export const DESK_TOOL_HINTS: Record<DeskToolName, DeskToolHints> = {
  desk_overview: READ_HINTS,
  list_sessions: READ_HINTS,
  get_session: READ_HINTS,
  search_notes: READ_HINTS,
  read_note: READ_HINTS,
  calendar_events: READ_HINTS,
  journal_breakdown: READ_HINTS,
  monte_carlo: READ_HINTS,
  bridge_status: READ_HINTS,
  portfolio_snapshot: READ_HINTS,
  market_levels: READ_HINTS,
  propfirm_status: READ_HINTS,
  desk_events: READ_HINTS,
  // Remplace la note et les tags de la séance : le même appel répété laisse le même état.
  annotate_session: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
  create_note: ADD_HINTS,
  branch_note: ADD_HINTS,
  link_notes: ADD_HINTS,
  // Un ordre confirmé part au pont NinjaTrader : hors du desk, et chaque appel en propose un nouveau.
  propose_order: { readOnly: false, destructive: true, idempotent: false, openWorld: true },
};

/** Méthodes du protocole de l'orchestrateur, hors outils. */
export const ORCH_PROTOCOL_METHODS = ['desk.auth', 'desk.describe', 'desk.ping'] as const;

const names = Object.keys(DESK_TOOL_KINDS) as DeskToolName[];
export const ORCH_READ_METHODS: readonly string[] = [...ORCH_PROTOCOL_METHODS, ...names.filter((n) => DESK_TOOL_KINDS[n] === 'read')];
export const ORCH_WRITE_METHODS: readonly string[] = names.filter((n) => DESK_TOOL_KINDS[n] === 'write');

/** `tool.<nom>` ou `<nom>` ; écritures seulement si l'opérateur les autorise. */
export function orchMethodAllowed(method: string, allowWrites: boolean): boolean {
  const name = method.replace(/^tool\./, '');
  if (ORCH_READ_METHODS.includes(method) || ORCH_READ_METHODS.includes(name)) return true;
  return allowWrites && ORCH_WRITE_METHODS.includes(name);
}

/** Événements que le desk pousse aux agents (`desk.event` de l'orchestrateur) et range pour `desk_events`. */
export const DESK_EVENT_KINDS = ['fill', 'prop_buffer', 'catalyst', 'bridge_link', 'agent_order'] as const;
export type DeskEventKind = (typeof DESK_EVENT_KINDS)[number];

export function isDeskEventKind(kind: unknown): kind is DeskEventKind {
  return typeof kind === 'string' && (DESK_EVENT_KINDS as readonly string[]).includes(kind);
}
