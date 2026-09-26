import { describe, expect, it } from 'vitest';
import { importCsvAuto, takeNewExecutionTrades } from '@/engine/import';
import { executionPayloadToCsv } from '../electron/nt-bridge/execution-csv';
import { omitKnownExecutionRows } from '../electron/nt-bridge/csv-fallback';
import type { ExecutionPayload } from '../electron/nt-bridge/protocol';

function fill(partial: Partial<ExecutionPayload> & Pick<ExecutionPayload, 'id' | 'action' | 'price' | 'time'>): ExecutionPayload {
  return {
    instrument: 'MNQ 12-26',
    quantity: 1,
    entryExit: partial.action === 'Buy' ? 'Entry' : 'Exit',
    position: '-',
    orderId: 'ord-1',
    name: 'canto',
    commission: 0.5,
    rate: 1,
    account: 'Sim101',
    connection: 'Simulated',
    ...partial,
  };
}

describe('journal du pont NT8', () => {
  it('une exécution vue par le WebSocket puis par le CSV ne crée qu’un trade', () => {
    const rows = [
      fill({ id: 'ex-buy', action: 'Buy', price: 21000.25, time: Date.parse('2026-09-26T15:31:02.000Z') }),
      fill({ id: 'ex-sell', action: 'Sell', price: 21010.25, time: Date.parse('2026-09-26T15:33:02.000Z') }),
    ];
    const wsCsv = executionPayloadToCsv(rows);
    const first = importCsvAuto(wsCsv, { source: 'ninjatrader' });
    expect(first.format).toBe('ninjatrader-executions');
    expect(first.trades).toHaveLength(1);
    const known = new Set((first.tradeExecutionKeys ?? []).flat());
    const replay = importCsvAuto(wsCsv, { source: 'ninjatrader' });
    const second = takeNewExecutionTrades(replay.trades, replay.tradeExecutionKeys ?? [], known);
    expect(second.trades).toHaveLength(0);

    const file = omitKnownExecutionRows(wsCsv, new Set(['ex-buy', 'ex-sell']));
    expect(file).toBeNull();
    const partial = omitKnownExecutionRows(wsCsv, new Set(['ex-buy']));
    expect(partial).toContain('ex-sell');
    expect(partial).not.toContain('ex-buy');
  });
});
