/**
 * Contrat NinjaTrader que Visual demande au pont. L'AddOn 2.2.0 résout le nom par
 * `Instrument.GetInstrument(nom)` (`SubscribeMarket`, `History` de `ninjatrader/CantoBridge.cs`) et répond
 * « instrument inconnu » quand NinjaTrader ne le trouve pas : un future s'y nomme racine et échéance
 * (`NQ 12-26`), la racine seule n'est pas un contrat. Les barres reviennent sous `Instrument.FullName`.
 */

import { resolveSymbol } from '@/engine/instruments';
import { addDays, etDateKey, nthWeekdayOfMonth, pad2 } from '@/lib/time';

/** Racines du registre au cycle trimestriel (mars, juin, septembre, décembre) : indices et change. CL et GC suivent d'autres cycles. */
const QUARTERLY_ROOTS: ReadonlySet<string> = new Set(['NQ', 'MNQ', 'ES', 'MES', 'RTY', 'M2K', 'YM', 'MYM', '6E', 'M6E']);

/** Nom écrit comme NinjaTrader l'écrit : majuscules, un seul espace. */
export function normalizeContract(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Contrat complet au format NinjaTrader (`NQ 12-26`) : racine du registre et échéance `MM-AA`. */
export function isNtContract(name: string): boolean {
  const got = resolveSymbol(normalizeContract(name));
  return !!got?.contractMonth && /^\d{2}-\d{2}$/.test(got.contractMonth);
}

/**
 * Échéance trimestrielle active à `now` (epoch ms), au format `MM-AA`. On passe à la suivante le jour de
 * bascule, jeudi 8 jours avant le 3e vendredi du mois d'échéance, heure de New York : la règle des repères
 * « Rollover » du Calendrier (`generateNasdaqEvents`). Estimée, comme eux.
 */
export function quarterlyMonth(now: number): string {
  const today = etDateKey(now);
  let year = Number(today.slice(0, 4));
  let month = Math.ceil(Number(today.slice(5, 7)) / 3) * 3;
  for (;;) {
    const roll = addDays(nthWeekdayOfMonth(year, month, 5, 3), -8);
    if (today < roll) return `${pad2(month)}-${String(year).slice(-2)}`;
    month += 3;
    if (month > 12) {
      month = 3;
      year += 1;
    }
  }
}

/** Contrats vus sur le pont, du plus sûr au moins sûr : positions ouvertes, puis exécutions (la plus récente d'abord). */
export function contractsSeen(accounts: readonly { positions: readonly { instrument: string; quantity: number }[] }[], fills: readonly string[]): string[] {
  const held = accounts.flatMap((account) => account.positions.filter((position) => position.quantity !== 0).map((position) => position.instrument));
  return [...new Set([...held, ...fills].map(normalizeContract).filter(isNtContract))];
}

/**
 * Contrat complet à demander pour `instrument`, `null` s'il faut le saisir :
 * 1. un contrat déjà complet est gardé ;
 * 2. pour une racine, le premier contrat de même racine vu sur le pont (`seen`, voir `contractsSeen`) ;
 * 3. sinon l'échéance trimestrielle estimée, pour les racines de ce cycle.
 */
export function ntContract(instrument: string, seen: readonly string[], now: number): string | null {
  const asked = resolveSymbol(normalizeContract(instrument));
  if (!asked) return null;
  if (isNtContract(instrument)) return normalizeContract(instrument);
  for (const name of seen) {
    if (isNtContract(name) && resolveSymbol(normalizeContract(name))?.symbol === asked.symbol) return normalizeContract(name);
  }
  return QUARTERLY_ROOTS.has(asked.symbol) ? `${asked.symbol} ${quarterlyMonth(now)}` : null;
}
