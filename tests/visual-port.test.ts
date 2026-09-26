import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateDemoBars } from '@/engine/bars';
import { createPort } from '@/engine/marketdata';

describe('Visual et le port', () => {
  it('charge la série démo par createPort, avec le même contenu qu’avant', async () => {
    const src = readFileSync('src/modules/visual/Visual.tsx', 'utf8');
    expect(src).toContain('createPort(');
    expect(src.includes('generateDemoBars')).toBe(false);
    expect(src.includes('importBarsCsv')).toBe(false);

    const port = createPort('demo');
    try {
      const bars = await port.history!({ instrument: 'NQ', timeframe: 5, from: 0, to: Number.MAX_SAFE_INTEGER });
      expect(bars).toEqual(generateDemoBars({ days: 12, timeframe: 5, seed: 42 }));
    } finally {
      port.dispose();
    }
  });
});
