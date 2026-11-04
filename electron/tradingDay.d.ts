/**
 * Types du module émis vers `dist-electron/tradingDay.js` (`electron/tsconfig.sources.json`).
 * L'implémentation est `src/engine/tradingDay.ts` : la journée CME du desk, une seule définition (OROS5.48).
 */
export const ET_ZONE: string;
export const CME_DAY_HOUR: number;
export function pad2(n: number): string;
export function dateKeyLocal(d: Date): string;
export function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number };
export function tradingDayKey(ms: number, boundaryHour?: number, zone?: string, minute?: number): string;
export function cmeTradingDay(ms: number): string;
export function cmeClock(ms: number): string;
