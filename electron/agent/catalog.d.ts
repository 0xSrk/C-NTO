/**
 * Types du module émis vers `dist-electron/agent/catalog.js`.
 * L'implémentation est `src/engine/agent/catalog.ts`.
 */
export const DESK_TOOL_KINDS: Readonly<Record<string, 'read' | 'write'>>;
export const ORCH_PROTOCOL_METHODS: readonly ['desk.auth', 'desk.describe', 'desk.ping'];
export const ORCH_READ_METHODS: readonly string[];
export const ORCH_WRITE_METHODS: readonly string[];
export function orchMethodAllowed(method: string, allowWrites: boolean): boolean;
export const DESK_EVENT_KINDS: readonly ['fill', 'order', 'prop_buffer', 'catalyst', 'bridge_link', 'agent_order'];
export type DeskEventKind = (typeof DESK_EVENT_KINDS)[number];
export function isDeskEventKind(kind: unknown): kind is DeskEventKind;
export const ORDER_TOOLS: readonly string[];
export interface DeskToolHints {
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  openWorld: boolean;
}
export const DESK_TOOL_HINTS: Readonly<Record<string, DeskToolHints>>;
export const DESK_TOOL_TITLES: Readonly<Record<string, readonly [fr: string, en: string, es: string]>>;
export const TOOL_PREAMBLE: string;
