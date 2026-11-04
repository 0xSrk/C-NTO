/**
 * Types du module émis vers `dist-electron/agent/dayClose.js`.
 * L'implémentation est `src/engine/agent/dayClose.ts` : la journée fermée de l'agent (décision 15 de l'ADMIN, OROS5.48a).
 */
export interface AgentDayClose {
  day: string;
  account: string;
  at: number;
}
export const AGENT_DAY_CLOSE_MAX: number;
export function foldDayAccount(name: string): string;
export function parseDayClose(raw: unknown): AgentDayClose | null;
export function withDayClose(list: readonly AgentDayClose[], close: AgentDayClose): AgentDayClose[];
export function coerceDayCloses(raw: unknown): AgentDayClose[];
export function mergeDayCloses(a: unknown, b: unknown): AgentDayClose[];
export function dayClosesFor(list: readonly AgentDayClose[], account: string): AgentDayClose[];
export function dayCloseFor(list: readonly AgentDayClose[], account: string, now: number): AgentDayClose | null;
