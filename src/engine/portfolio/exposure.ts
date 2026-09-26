import { convertAmount } from './fx';
import { bridgeIsFresh } from './fx';
import { instrumentMultiplier, positionMultiplier } from './price';
import type { BridgeSnapshot, FxRate, Pocket, Position } from './types';
import { isTraditionalKind } from './types';

export interface ExposureBucket {
  key: string;
  notional: number;
}

export interface Exposure {
  byClass: ExposureBucket[];
  byInstrument: ExposureBucket[];
  byCurrency: ExposureBucket[];
  /** Part de la plus grosse ligne d'instrument dans le notionnel total. 0 si rien n'est exposé. */
  concentration: number;
  /** Notionnel total / valeur nette. Null si la valeur nette n'est pas strictement positive. */
  grossLeverage: number | null;
  totalNotional: number;
  notes: { pocketId: string; text: string }[];
}

export interface ExposureInput {
  pockets: readonly Pocket[];
  positions: readonly Position[];
  /** Un instantané par compte, ou aucun si le pont n'est pas vivant. */
  snapshots: readonly BridgeSnapshot[];
  fx: readonly FxRate[];
  base: string;
  now: number;
  netValue: number;
  quotes?: ReadonlyMap<string, number>;
}

function add(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function buckets(map: Map<string, number>): ExposureBucket[] {
  return [...map.entries()]
    .filter(([, n]) => n !== 0)
    .map(([key, notional]) => ({ key, notional }))
    .sort((a, b) => b.notional - a.notional || a.key.localeCompare(b.key));
}

function lineNotional(quantity: number, price: number, multiplier: number, currency: string, base: string, fx: readonly FxRate[]): { ok: true; value: number } | { ok: false; reason: string } {
  const native = Math.abs(quantity) * price * multiplier;
  return convertAmount(native, currency, base, fx);
}

/**
 * Notionnel en devise de base. Les séances futures et prop sont clôturées :
 * l'exposition intrajournalière vient du pont vivant, sinon 0 et la mention « pont hors ligne ».
 */
export function exposure(input: ExposureInput): Exposure {
  const byClass = new Map<string, number>();
  const byInstrument = new Map<string, number>();
  const byCurrency = new Map<string, number>();
  const notes: Exposure['notes'] = [];
  let total = 0;

  const push = (kind: string, symbol: string, currency: string, value: number) => {
    add(byClass, kind, value);
    add(byInstrument, symbol, value);
    add(byCurrency, currency, value);
    total += value;
  };

  for (const pocket of input.pockets) {
    if (pocket.archivedAt) continue;
    if (pocket.kind === 'propfirm' || pocket.kind === 'futures') {
      const snap = input.snapshots.find((s) => s.account === (pocket.account ?? '') && bridgeIsFresh(s.at, input.now));
      if (!snap) {
        notes.push({ pocketId: pocket.id, text: 'pont hors ligne' });
        continue;
      }
      for (const pos of snap.positions) {
        const mult = instrumentMultiplier(pos.instrument);
        const price = Number.isFinite(pos.avgPrice) ? pos.avgPrice : 0;
        const n = lineNotional(pos.quantity, price, mult, pocket.currency, input.base, input.fx);
        if (!n.ok) {
          notes.push({ pocketId: pocket.id, text: n.reason });
          continue;
        }
        push(pocket.kind, pos.instrument, pocket.currency, n.value);
      }
      continue;
    }
    if (!isTraditionalKind(pocket.kind)) continue;
    for (const pos of input.positions) {
      if (pos.pocketId !== pocket.id || pos.closedAt != null) continue;
      const quote = input.quotes?.get(pos.symbol);
      const px = quote != null && Number.isFinite(quote) ? quote : pos.lastPrice != null && Number.isFinite(pos.lastPrice) ? pos.lastPrice : pos.avgPrice;
      const n = lineNotional(pos.quantity, px, positionMultiplier(pos), pos.currency, input.base, input.fx);
      if (!n.ok) {
        notes.push({ pocketId: pocket.id, text: n.reason });
        continue;
      }
      push(pocket.kind, pos.symbol, pos.currency, n.value);
    }
  }

  let largest = 0;
  for (const n of byInstrument.values()) if (n > largest) largest = n;
  const concentration = total > 0 ? largest / total : 0;
  const grossLeverage = input.netValue > 0 ? total / input.netValue : null;
  return {
    byClass: buckets(byClass),
    byInstrument: buckets(byInstrument),
    byCurrency: buckets(byCurrency),
    concentration,
    grossLeverage,
    totalNotional: total,
    notes,
  };
}
