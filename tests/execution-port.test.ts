import { describe, expect, it } from 'vitest';
import { MemoryExecutionPort } from '@/engine/execution/adapters/memory';
import type { ExecutionEvent } from '@/engine/execution/port';

describe('ExecutionPort mémoire', () => {
  it('soumet, annule, aplatit, et émet les événements dans l’ordre', async () => {
    const port = new MemoryExecutionPort();
    const events: ExecutionEvent[] = [];
    port.subscribe((event) => events.push(event));
    const ack = await port.submit({ account: 'Sim101', instrument: 'NQ 12-26', side: 'buy', qty: 1, type: 'market', tag: 'canto' });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    port.emitFill({ account: 'Sim101', instrument: 'NQ 12-26', side: 'buy', qty: 1, price: 21000, time: 1_700_000_000_000, executionId: 'ex-1', orderId: ack.orderId });
    const cancelled = await port.cancel('Sim101', ack.orderId);
    expect(cancelled.ok).toBe(true);
    const flat = await port.flatten('Sim101');
    expect(flat.ok).toBe(true);
    if (flat.ok) expect(flat.closed).toBe(0);
    expect(events.map((event) => event.kind)).toEqual(['order', 'fill', 'order', 'accounts']);
    expect(port.status().state).toBe('live');
    expect(port.capabilities.submit).toBe(true);
    port.dispose();
    port.dispose();
  });

  it('refuse un ordre sans tag', async () => {
    const port = new MemoryExecutionPort();
    const ack = await port.submit({ account: 'Sim101', instrument: 'NQ', side: 'sell', qty: 1, type: 'market', tag: '  ' });
    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.code).toBe(-32013);
    port.dispose();
  });
});
