/**
 * Discipline du trader : ses règles chiffrées, sa perte du jour, ses dérives après une perte et ses
 * écarts aux règles. Pur : le desk lit le journal, le pont et le calendrier, puis appelle ces fonctions.
 * Une règle à 0 (ou une liste vide) est inactive : elle ne signale rien.
 */
import { resolveSymbol } from './instruments';

export interface TraderRules {
  /** Perte maximale de la journée CME, en dollars. 0 = inactive. */
  maxDailyLoss: number;
  /** Entrées maximales par journée CME et par compte. 0 = inactive. */
  maxTradesPerDay: number;
  /** Pas d'entrée dans ± ces minutes autour d'un catalyseur majeur. 0 = inactive. */
  catalystBlackoutMin: number;
  /** Racines du registre autorisées (NQ, MNQ…). Vide = toutes. */
  allowedInstruments: string[];
  /** Une entrée dans ces minutes après une sortie perdante, sur le même compte, est une revanche. 0 = inactive. */
  revengeWindowMin: number;
}

export const DEFAULT_TRADER_RULES: TraderRules = {
  maxDailyLoss: 0,
  maxTradesPerDay: 0,
  catalystBlackoutMin: 0,
  allowedInstruments: [],
  revengeWindowMin: 5,
};

/** Bornes de saisie : une valeur hors bornes retombe sur la valeur précédente. */
export const TRADER_RULE_BOUNDS = {
  maxDailyLoss: { min: 0, max: 1_000_000 },
  maxTradesPerDay: { min: 0, max: 200 },
  catalystBlackoutMin: { min: 0, max: 120 },
  revengeWindowMin: { min: 0, max: 120 },
} as const;

const ALLOWED_MAX = 32;

function pick(v: unknown, bounds: { min: number; max: number }, fallback: number, integer: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < bounds.min || v > bounds.max) return fallback;
  if (integer && !Number.isInteger(v)) return fallback;
  return v;
}

/** Racines du registre, sans doublon ; un symbole hors registre est retiré (`NQ 12-26` devient `NQ`). */
export function allowedSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length > 32) continue;
    const symbol = resolveSymbol(item)?.symbol;
    if (symbol && !out.includes(symbol)) out.push(symbol);
    if (out.length >= ALLOWED_MAX) break;
  }
  return out;
}

/** Règles venant du stockage ou d'un coffre : chaque champ typé et borné, sinon celui de `base`. */
export function coerceTraderRules(raw: unknown, base: TraderRules = DEFAULT_TRADER_RULES): TraderRules {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return { ...base, allowedInstruments: [...base.allowedInstruments] };
  return {
    maxDailyLoss: pick(r.maxDailyLoss, TRADER_RULE_BOUNDS.maxDailyLoss, base.maxDailyLoss, false),
    maxTradesPerDay: pick(r.maxTradesPerDay, TRADER_RULE_BOUNDS.maxTradesPerDay, base.maxTradesPerDay, true),
    catalystBlackoutMin: pick(r.catalystBlackoutMin, TRADER_RULE_BOUNDS.catalystBlackoutMin, base.catalystBlackoutMin, true),
    allowedInstruments: Array.isArray(r.allowedInstruments) ? allowedSymbols(r.allowedInstruments) : [...base.allowedInstruments],
    revengeWindowMin: pick(r.revengeWindowMin, TRADER_RULE_BOUNDS.revengeWindowMin, base.revengeWindowMin, true),
  };
}

/** Vrai si au moins une règle chiffrée est active (la fenêtre de revanche est un réglage de détection). */
export function hasActiveRules(rules: TraderRules): boolean {
  return rules.maxDailyLoss > 0 || rules.maxTradesPerDay > 0 || rules.catalystBlackoutMin > 0 || rules.allowedInstruments.length > 0;
}
