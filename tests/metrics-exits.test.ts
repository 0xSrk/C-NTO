import { describe, expect, it } from 'vitest';
import { exitReasonOf } from '@/engine/tradeUnits';

describe('motif de sortie', () => {
  it('range le nom NinjaTrader dans stop, objectif, manuel ou autre', () => {
    expect(exitReasonOf('Stop1')).toBe('stop');
    expect(exitReasonOf('Stop loss')).toBe('stop');
    expect(exitReasonOf('Target1')).toBe('objectif');
    expect(exitReasonOf('Profit target')).toBe('objectif');
    expect(exitReasonOf('Objectif')).toBe('objectif');
    expect(exitReasonOf('Close')).toBe('manuel');
    expect(exitReasonOf('Manual')).toBe('manuel');
    expect(exitReasonOf('Flatten')).toBe('manuel');
    expect(exitReasonOf(undefined)).toBe('autre');
    expect(exitReasonOf('Exit')).toBe('autre');
  });
});
