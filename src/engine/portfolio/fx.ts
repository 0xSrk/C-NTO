import { BRIDGE_MAX_AGE_MS, isIsoCurrency, type FxRate } from './types';

export type Converted = { ok: true; value: number } | { ok: false; reason: string };

function usable(rate: FxRate | undefined): rate is FxRate {
  return !!rate && Number.isFinite(rate.rate) && rate.rate > 0;
}

/**
 * Convertit `amount` de `from` vers `to`.
 * Le taux direct (`EURUSD`) est 1 unité de la première devise pour `rate` de la seconde.
 * L'inverse est déduit (`USDEUR = 1 / EURUSD`). Aucune triangulation. Taux manquant : pas de repli à 1.
 */
export function convertAmount(amount: number, from: string, to: string, fx: readonly FxRate[]): Converted {
  const src = from.trim().toUpperCase();
  const dst = to.trim().toUpperCase();
  if (!Number.isFinite(amount)) return { ok: false, reason: 'montant non fini' };
  if (!isIsoCurrency(src) || !isIsoCurrency(dst)) return { ok: false, reason: 'devise invalide' };
  if (src === dst) return { ok: true, value: amount };
  const direct = fx.find((r) => r.pair === `${src}${dst}`);
  if (usable(direct)) return { ok: true, value: amount * direct.rate };
  const inverse = fx.find((r) => r.pair === `${dst}${src}`);
  if (usable(inverse)) return { ok: true, value: amount / inverse.rate };
  return { ok: false, reason: `taux ${src}/${dst} manquant` };
}

export function bridgeIsFresh(at: number, now: number): boolean {
  return Number.isFinite(at) && Number.isFinite(now) && now - at >= 0 && now - at < BRIDGE_MAX_AGE_MS;
}
