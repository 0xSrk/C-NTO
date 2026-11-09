import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dexie est remplacé par une coquille : `db.<table>` est injecté ci-dessous avec des tables en mémoire.
vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = {
        stores() {
          return chain;
        },
        upgrade() {
          return chain;
        },
      };
      return chain;
    }
    on() {}
    close() {}
    async transaction(_mode: string, _tables: unknown, fn: () => Promise<void>) {
      return fn();
    }
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

import { SESSION_CAPACITY, type Session } from '@/engine/types';
import { db } from '@/store/db';
import { useJournal } from '@/store/journal';
import { executionPayloadToCsv } from '../electron/nt-bridge/execution-csv';
import type { ExecutionPayload } from '../electron/nt-bridge/protocol';

/**
 * SEC1.10 — le journal ne perd jamais une exécution. Une séance vaut un compte et un jour : au-delà de
 * `SESSION_CAPACITY` (1 000, soit ≈ 200 jours de bourse à cinq comptes), l'import refusait toute séance nouvelle, y
 * compris celles que le pont NinjaTrader apporte, sans message à l'écran. Le trade n'était pas écrit, alors que ses lots
 * d'entrée étaient consommés : le journal — donc la marge prop de la jauge K.04 et les gardes qui la lisent — s'arrêtait
 * sans le dire. Une exécution est maintenant toujours écrite ; le dépassement est signalé. Un export « Trades » importé à
 * la main reste borné, comme avant.
 */

type Row = Record<string, unknown>;
interface FakeTable {
  rows: Map<string, Row>;
  clear: () => Promise<void>;
  bulkAdd: (list: Row[]) => Promise<void>;
  bulkPut: (list: Row[]) => Promise<void>;
  toArray: () => Promise<Row[]>;
}

function fakeTable(key: (row: Row) => string): FakeTable {
  const table: FakeTable = {
    rows: new Map(),
    async clear() {
      table.rows.clear();
    },
    async bulkAdd(list) {
      for (const row of list) {
        if (table.rows.has(key(row))) throw new Error(`ConstraintError : ${key(row)}`);
        table.rows.set(key(row), row);
      }
    },
    async bulkPut(list) {
      for (const row of list) table.rows.set(key(row), row);
    },
    async toArray() {
      return [...table.rows.values()];
    },
  };
  return table;
}

const tables = {
  sessions: fakeTable((row) => String(row.id)),
  trades: fakeTable((row) => String(row.id)),
  importedExecutions: fakeTable((row) => String(row.key)),
  openLots: fakeTable((row) => String(row.key)),
};

/** Mille séances déjà au journal : cinq comptes sur deux cents jours, les plus anciennes d'abord. */
function fullJournal(): Session[] {
  const sessions: Session[] = [];
  for (let i = 0; i < SESSION_CAPACITY; i += 1) {
    const day = new Date(Date.UTC(2025, 0, 1 + Math.floor(i / 5))).toISOString().slice(0, 10);
    sessions.push({ id: `old-${i}`, date: day, account: `Sim${100 + (i % 5)}`, instruments: ['MNQ'], source: 'ninjatrader', tradeCount: 0, pnl: 0, grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 1, updatedAt: 1 } as Session);
  }
  return sessions;
}

function fill(partial: Pick<ExecutionPayload, 'id' | 'action' | 'price' | 'time'>): ExecutionPayload {
  return { instrument: 'MNQ 12-26', quantity: 1, entryExit: partial.action === 'Buy' ? 'Entry' : 'Exit', position: '-', orderId: `ord-${partial.id}`, name: 'canto', commission: 0.5, rate: 1, account: 'Sim101', connection: 'Simulated', ...partial };
}

const TRADES_HEAD = 'Trade-#,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. net profit,Commission,MAE,MFE,ETD,Bars';
const TRADES_ROW = '1,NQ 12-26,Sim101,,Long,1,25000.00,25010.00,11/6/2026 9:35:00 AM,11/6/2026 9:42:00 AM,Entry,Exit,$200.00,$200.00,$4.50,$45.00,$220.00,$20.00,7';

describe('SEC1.10 le journal ne perd pas une exécution au-delà de sa capacité', () => {
  beforeEach(async () => {
    Object.assign(db as unknown as Record<string, unknown>, tables);
    for (const table of Object.values(tables)) await table.clear();
    await tables.sessions.bulkAdd(fullJournal() as unknown as Row[]);
    await useJournal.getState().load();
    expect(useJournal.getState().sessions).toHaveLength(SESSION_CAPACITY);
  });

  it('un aller-retour reçu du pont est écrit, lots soldés, et le dépassement est dit', async () => {
    const entry = fill({ id: 'ex-buy', action: 'Buy', price: 25_000.25, time: Date.parse('2026-11-06T15:31:02.000Z') });
    const exit = fill({ id: 'ex-sell', action: 'Sell', price: 25_010.25, time: Date.parse('2026-11-06T15:33:02.000Z') });
    // Comme le pont : une exécution par message. L'entrée ouvre un lot, la sortie le solde et fait le trade.
    const first = await useJournal.getState().importCsv(executionPayloadToCsv([entry]), { source: 'ninjatrader' });
    expect(first.newTrades).toBe(0);
    expect(tables.openLots.rows.size).toBe(1);
    const second = await useJournal.getState().importCsv(executionPayloadToCsv([exit]), { source: 'ninjatrader' });

    expect(second.newTrades).toBe(1);
    expect(second.added).toBe(1);
    expect(second.overCapacity).toBe(true);
    expect(second.warnings.some((line) => line.includes(String(SESSION_CAPACITY)))).toBe(true);
    // Le trade est au journal, sa séance aussi, et le lot d'entrée n'est soldé que parce que le trade existe.
    expect(tables.trades.rows.size).toBe(1);
    expect(tables.sessions.rows.size).toBe(SESSION_CAPACITY + 1);
    expect(tables.openLots.rows.size).toBe(0);
    expect(useJournal.getState().trades).toHaveLength(1);
    expect(useJournal.getState().trades[0]).toMatchObject({ account: 'Sim101', direction: 'long', qty: 1 });
    // Rejoué (rattrapage par le CSV de l'AddOn) : rien en double.
    const replay = await useJournal.getState().importCsv(executionPayloadToCsv([entry, exit]), { source: 'ninjatrader' });
    expect(replay.newTrades).toBe(0);
    expect(tables.trades.rows.size).toBe(1);
  });

  it('sous la capacité, rien n’est signalé', async () => {
    await tables.sessions.clear();
    await useJournal.getState().load();
    const r = await useJournal.getState().importCsv(
      executionPayloadToCsv([fill({ id: 'a', action: 'Buy', price: 25_000, time: Date.parse('2026-11-06T15:31:02.000Z') }), fill({ id: 'b', action: 'Sell', price: 25_004, time: Date.parse('2026-11-06T15:32:02.000Z') })]),
      { source: 'ninjatrader' },
    );
    expect(r.newTrades).toBe(1);
    expect(r.overCapacity).toBeFalsy();
    expect(r.warnings.some((line) => line.includes(String(SESSION_CAPACITY)))).toBe(false);
  });

  it('un export « Trades » importé à la main reste borné à la capacité, avec son message', async () => {
    const r = await useJournal.getState().importCsv(`${TRADES_HEAD}\n${TRADES_ROW}\n`, { source: 'csv' });
    expect(r.format).not.toBe('ninjatrader-executions');
    expect(r.newTrades).toBe(0);
    expect(r.added).toBe(0);
    expect(r.overCapacity).toBeFalsy();
    expect(r.warnings.some((line) => line.includes(`${SESSION_CAPACITY}`))).toBe(true);
    expect(tables.sessions.rows.size).toBe(SESSION_CAPACITY);
    expect(tables.trades.rows.size).toBe(0);
  });
});
