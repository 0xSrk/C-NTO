import { describe, expect, it } from 'vitest';
import {
  CLOSE,
  ERR,
  MAX_FRAME_BYTES,
  frameExceedsCap,
  parseFrame,
  rpcError,
  rpcResult,
  validateAddonCall,
  validateOrderSubmit,
} from '../electron/nt-bridge/protocol';

const hello = {
  kind: 'ninjatrader',
  ntVersion: '8.1.5',
  addonVersion: '2.1.0',
  accounts: ['Sim101'],
  protocol: 1,
};

describe('protocole du pont NT8', () => {
  it('accepte bridge.hello et refuse un protocole incorrect', () => {
    const ok = validateAddonCall('bridge.hello', hello, false);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.call.params).toMatchObject({ kind: 'ninjatrader', protocol: 1 });
    const bad = validateAddonCall('bridge.hello', { ...hello, protocol: 2 }, false);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.close).toBe(CLOSE.NO_HELLO);
  });

  it('refuse toute méthode avant bridge.hello', () => {
    const rejected = validateAddonCall('bridge.heartbeat', { at: 1 }, false);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.close).toBe(CLOSE.NO_HELLO);
  });

  it('valide les charges bonnes et mauvaises', () => {
    expect(validateAddonCall('bridge.heartbeat', { at: 1_700_000_000_000 }, true).ok).toBe(true);
    expect(validateAddonCall('bridge.heartbeat', { at: 'hier' }, true).ok).toBe(false);

    expect(validateAddonCall('bridge.accounts', { accounts: [{ name: 'Sim101', cashValue: 1, realizedPnl: 0, unrealizedPnl: 0, positions: [] }] }, true).ok).toBe(true);
    expect(validateAddonCall('bridge.accounts', { accounts: [{ name: 1 }] }, true).ok).toBe(false);

    const execution = { Instrument: 'MNQ 12-26', Action: 'Buy', Quantity: 1, Price: 21000.25, Time: 1_700_000_000_000, ID: 'ex1', Account: 'Sim101' };
    const execOk = validateAddonCall('bridge.execution', execution, true);
    expect(execOk.ok).toBe(true);
    if (execOk.ok && execOk.call.method === 'bridge.execution') expect(execOk.call.params.time).toBe(1_700_000_000_000);
    expect(validateAddonCall('bridge.execution', { ...execution, Price: 'x' }, true).ok).toBe(false);

    expect(validateAddonCall('bridge.order', { account: 'Sim101', orderId: 'o1', instrument: 'MNQ 12-26', action: 'Buy', type: 'Market', quantity: 1, state: 'Working' }, true).ok).toBe(true);
    expect(validateAddonCall('bridge.order', { account: 'Sim101' }, true).ok).toBe(false);

    const bar = { instrument: 'MNQ 12-26', timeframe: 5, bar: { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }, final: false };
    expect(validateAddonCall('marketdata.bar', bar, true).ok).toBe(true);
    expect(validateAddonCall('marketdata.bar', { ...bar, final: 'oui' }, true).ok).toBe(false);

    expect(validateAddonCall('marketdata.tick', { instrument: 'MNQ 12-26', time: 1_700_000_000_000, price: 1, size: 1, side: 'buy' }, true).ok).toBe(true);
    expect(validateAddonCall('marketdata.tick', { instrument: 'MNQ 12-26', time: 1, price: 1, size: 1, side: 'hold' }, true).ok).toBe(false);

    expect(validateAddonCall('marketdata.quote', { instrument: 'MNQ 12-26', time: 1_700_000_000_000, bid: 1, ask: 2 }, true).ok).toBe(true);
    expect(validateAddonCall('marketdata.quote', { instrument: 'MNQ 12-26', bid: 1 }, true).ok).toBe(false);
  });

  it('refuse une trame au-delà de 256 Ko', () => {
    expect(frameExceedsCap(MAX_FRAME_BYTES)).toBe(false);
    expect(frameExceedsCap(MAX_FRAME_BYTES + 1)).toBe(true);
    const huge = JSON.stringify({ jsonrpc: '2.0', method: 'bridge.heartbeat', params: { at: 1, pad: 'x'.repeat(MAX_FRAME_BYTES) } });
    const parsed = parseFrame(huge);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.close).toBe(CLOSE.TOO_BIG);
  });

  it('conserve l’id dans la réponse et dans l’erreur', () => {
    const result = JSON.parse(rpcResult(12, { ok: true })) as { id: number };
    const error = JSON.parse(rpcError('abc', ERR.TAG, 'tag obligatoire')) as { id: string; error: { code: number } };
    expect(result.id).toBe(12);
    expect(error.id).toBe('abc');
    expect(error.error.code).toBe(ERR.TAG);
    const frame = parseFrame(JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'bridge.hello', params: hello }));
    expect(frame.ok).toBe(true);
    if (frame.ok && frame.kind === 'call') expect(frame.id).toBe(12);
  });

  it('refuse un ordre sans tag', () => {
    const missing = validateOrderSubmit({ account: 'Sim101', instrument: 'MNQ 12-26', action: 'Buy', quantity: 1, type: 'Market' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe(ERR.TAG);
  });
});
