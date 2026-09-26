import { create } from 'zustand';
import { mapPositionCsv } from '@/engine/portfolio/csvPositions';
import {
  CRYPTO_POCKET_ERROR,
  isCreatableKind,
  isIsoCurrency,
  isTraditionalKind,
  type CashBalance,
  type EquityPoint,
  type FxRate,
  type Pocket,
  type Position,
} from '@/engine/portfolio/types';
import { parseCsv } from '@/lib/csv';
import { tr } from '@/i18n';
import { uid } from '@/lib/id';
import { db } from './db';
import { useUi } from './ui';

function toast(text: string, tone: 'info' | 'ok' | 'warn' | 'error' = 'warn'): void {
  useUi.getState().toast(text, tone);
}

function currencyOf(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return isIsoCurrency(code) ? code : null;
}

interface PortfolioState {
  ready: boolean;
  pockets: Pocket[];
  positions: Position[];
  cash: CashBalance[];
  fx: FxRate[];
  load: () => Promise<void>;
  savePocket: (input: Pocket) => Promise<Pocket | null>;
  archivePocket: (id: string) => Promise<void>;
  reactivatePocket: (id: string) => Promise<void>;
  savePosition: (input: Position) => Promise<Position | null>;
  removePosition: (id: string) => Promise<void>;
  saveCash: (input: CashBalance) => Promise<CashBalance | null>;
  removeCash: (id: string) => Promise<void>;
  saveFx: (pair: string, rate: number) => Promise<void>;
  removeFx: (pair: string) => Promise<void>;
  importPositions: (pocketId: string, text: string) => Promise<{ imported: number; rejected: number }>;
  replaceEquity: (points: EquityPoint[]) => Promise<void>;
}

function remember<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((item) => item.id === row.id);
  if (i < 0) return [...list, row];
  const next = list.slice();
  next[i] = row;
  return next;
}

export const usePortfolio = create<PortfolioState>((set, get) => ({
  ready: false,
  pockets: [],
  positions: [],
  cash: [],
  fx: [],

  async load() {
    const [pockets, positions, cash, fx] = await Promise.all([db.pockets.toArray(), db.positions.toArray(), db.cashBalances.toArray(), db.fxRates.toArray()]);
    set({
      pockets: pockets.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)),
      positions,
      cash,
      fx: fx.sort((a, b) => a.pair.localeCompare(b.pair)),
      ready: true,
    });
  },

  async savePocket(input) {
    if (!isCreatableKind(input.kind)) {
      const message = input.kind === 'crypto' ? CRYPTO_POCKET_ERROR : tr('Type de poche refusé.', 'Pocket type refused.', 'Tipo de bolsa rechazado.');
      toast(message, 'error');
      if (input.kind === 'crypto') throw new Error(CRYPTO_POCKET_ERROR);
      return null;
    }
    const currency = currencyOf(input.currency);
    const name = input.name.trim();
    if (!name || !currency) {
      toast(tr('Nom et devise ISO (3 lettres) requis.', 'Name and a 3-letter ISO currency are required.', 'Nombre y divisa ISO (3 letras) obligatorios.'));
      return null;
    }
    const row: Pocket = {
      id: input.id || uid('poche'),
      name,
      kind: input.kind,
      currency,
      createdAt: input.createdAt || Date.now(),
    };
    if (input.account?.trim()) row.account = input.account.trim();
    if (input.planId?.trim() && input.kind === 'propfirm') row.planId = input.planId.trim();
    if (input.venue?.trim() && isTraditionalKind(input.kind)) row.venue = input.venue.trim();
    if (input.archivedAt) row.archivedAt = input.archivedAt;
    await db.pockets.put(row);
    set({ pockets: remember(get().pockets, row).sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)) });
    return row;
  },

  async archivePocket(id) {
    const cur = get().pockets.find((p) => p.id === id);
    if (!cur || cur.archivedAt) return;
    const row = { ...cur, archivedAt: Date.now() };
    await db.pockets.put(row);
    set({ pockets: remember(get().pockets, row) });
  },

  async reactivatePocket(id) {
    const cur = get().pockets.find((p) => p.id === id);
    if (!cur?.archivedAt) return;
    const row: Pocket = { ...cur };
    delete row.archivedAt;
    await db.pockets.put(row);
    set({ pockets: remember(get().pockets, row) });
  },

  async savePosition(input) {
    const pocket = get().pockets.find((p) => p.id === input.pocketId);
    if (!pocket || !isTraditionalKind(pocket.kind) || pocket.archivedAt) {
      toast(tr('Position réservée à une poche traditionnelle active.', 'A position belongs on an active traditional pocket.', 'La posición va en una bolsa tradicional activa.'));
      return null;
    }
    const currency = currencyOf(input.currency);
    const symbol = input.symbol.trim();
    if (!symbol || symbol.length > 32 || !currency || !Number.isFinite(input.quantity) || !Number.isFinite(input.avgPrice)) {
      toast(tr('Symbole, quantité, prix et devise requis.', 'Symbol, quantity, price and currency are required.', 'Símbolo, cantidad, precio y divisa obligatorios.'));
      return null;
    }
    const row: Position = {
      id: input.id || uid('pos'),
      pocketId: pocket.id,
      symbol,
      quantity: input.quantity,
      avgPrice: input.avgPrice,
      currency,
      openedAt: input.openedAt || Date.now(),
    };
    if (input.label?.trim()) row.label = input.label.trim();
    if (input.lastPrice != null && Number.isFinite(input.lastPrice)) {
      row.lastPrice = input.lastPrice;
      row.lastPriceAt = input.lastPriceAt && Number.isFinite(input.lastPriceAt) ? input.lastPriceAt : Date.now();
    }
    if (input.multiplier != null && Number.isFinite(input.multiplier) && input.multiplier > 0) row.multiplier = input.multiplier;
    if (input.closedAt != null && Number.isFinite(input.closedAt)) row.closedAt = input.closedAt;
    if (input.realizedPnl != null && Number.isFinite(input.realizedPnl)) row.realizedPnl = input.realizedPnl;
    await db.positions.put(row);
    set({ positions: remember(get().positions, row) });
    return row;
  },

  async removePosition(id) {
    await db.positions.delete(id);
    set({ positions: get().positions.filter((p) => p.id !== id) });
  },

  async saveCash(input) {
    const pocket = get().pockets.find((p) => p.id === input.pocketId);
    const currency = currencyOf(input.currency);
    if (!pocket || pocket.archivedAt || !currency || !Number.isFinite(input.amount) || !Number.isFinite(input.at)) {
      toast(tr('Liquidité : poche, montant fini et devise ISO.', 'Cash: pocket, a finite amount and an ISO currency.', 'Liquidez: bolsa, importe finito y divisa ISO.'));
      return null;
    }
    const row: CashBalance = { id: input.id || uid('cash'), pocketId: pocket.id, currency, amount: input.amount, at: input.at };
    await db.cashBalances.put(row);
    set({ cash: remember(get().cash, row) });
    return row;
  },

  async removeCash(id) {
    await db.cashBalances.delete(id);
    set({ cash: get().cash.filter((c) => c.id !== id) });
  },

  async saveFx(pair, rate) {
    const code = pair.trim().toUpperCase();
    if (!/^[A-Z]{6}$/.test(code) || !Number.isFinite(rate) || rate <= 0) {
      toast(tr('Paire de 6 lettres et taux strictement positif.', 'A 6-letter pair and a strictly positive rate.', 'Par de 6 letras y tipo estrictamente positivo.'));
      return;
    }
    const row: FxRate = { pair: code, rate, at: Date.now(), by: 'utilisateur' };
    await db.fxRates.put(row);
    set({ fx: rememberPair(get().fx, row) });
  },

  async removeFx(pair) {
    const code = pair.trim().toUpperCase();
    await db.fxRates.delete(code);
    set({ fx: get().fx.filter((r) => r.pair !== code) });
  },

  async importPositions(pocketId, text) {
    const pocket = get().pockets.find((p) => p.id === pocketId);
    if (!pocket || !isTraditionalKind(pocket.kind)) {
      toast(tr('Import réservé à une poche traditionnelle.', 'Import is for a traditional pocket.', 'La importación es para una bolsa tradicional.'));
      return { imported: 0, rejected: 0 };
    }
    const table = parseCsv(text);
    const mapped = mapPositionCsv(table.headers, table.rows);
    const openedAt = Date.now();
    let imported = 0;
    for (const line of mapped.rows) {
      const row: Position = {
        id: uid('pos'),
        pocketId,
        symbol: line.symbol,
        quantity: line.quantity,
        avgPrice: line.avgPrice,
        currency: line.currency,
        openedAt,
      };
      if (line.lastPrice != null) {
        row.lastPrice = line.lastPrice;
        row.lastPriceAt = openedAt;
      }
      const saved = await get().savePosition(row);
      if (saved) imported++;
    }
    const skipped = mapped.rejected > 0 ? tr(` ${mapped.rejected} ligne(s) écartée(s).`, ` ${mapped.rejected} row(s) skipped.`, ` ${mapped.rejected} fila(s) descartada(s).`) : '';
    if (imported === 0) toast(tr('Aucune position importée.', 'No position imported.', 'Ninguna posición importada.') + skipped, 'warn');
    else toast(tr(`${imported} position(s) importée(s).`, `${imported} position(s) imported.`, `${imported} posición(es) importada(s).`) + skipped, 'ok');
    return { imported, rejected: mapped.rejected };
  },

  async replaceEquity(points) {
    await db.transaction('rw', db.equityPoints, async () => {
      await db.equityPoints.clear();
      if (points.length) await db.equityPoints.bulkPut(points);
    });
  },
}));

function rememberPair(list: FxRate[], row: FxRate): FxRate[] {
  const next = list.filter((r) => r.pair !== row.pair);
  next.push(row);
  next.sort((a, b) => a.pair.localeCompare(b.pair));
  return next;
}
