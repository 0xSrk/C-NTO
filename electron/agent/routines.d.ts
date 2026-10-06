/**
 * Types du module émis vers `dist-electron/agent/routines.js`.
 * L'implémentation est `src/engine/agent/routines.ts`.
 */
export type RoutineLocale = 'fr' | 'en' | 'es';
export const ROUTINE_NAMES: readonly ['pre_session_brief', 'session_debrief', 'prop_plan_review'];
export type RoutineName = (typeof ROUTINE_NAMES)[number];
export type RoutineArgName = 'date' | 'instrument' | 'account' | 'planId';
export interface RoutineArgument {
  name: RoutineArgName;
  description: readonly [fr: string, en: string, es: string];
}
export interface RoutineDef {
  name: RoutineName;
  title: readonly [fr: string, en: string, es: string];
  description: readonly [fr: string, en: string, es: string];
  arguments: readonly RoutineArgument[];
  reads: readonly string[];
  writes: readonly string[];
}
export interface RoutineContext {
  locale: RoutineLocale;
  allowWrites: boolean;
  now: number;
}
export type RoutineRender = { ok: true; name: RoutineName; title: string; description: string; text: string } | { ok: false; detail: string };
export const ROUTINES: readonly RoutineDef[];
export function nyDate(now: number): string;
export function isRoutineName(name: unknown): name is RoutineName;
export function renderRoutine(name: unknown, rawArgs: unknown, ctx: RoutineContext): RoutineRender;
