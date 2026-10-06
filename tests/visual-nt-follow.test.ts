import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Bar } from '@/engine/bars';
import { followNt, type FollowPort } from '@/modules/visual/ntFollow';

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });

function port(): { port: FollowPort; log: string[] } {
  const log: string[] = [];
  return {
    log,
    port: {
      history: async (req) => {
        log.push(`h:${req.instrument}:${req.timeframe}`);
        return [bar(1)];
      },
      subscribe: (req) => {
        log.push(`s:${req.instrument}:${req.timeframe}`);
        return () => log.push(`u:${req.instrument}:${req.timeframe}`);
      },
      dispose() {
        log.push('dispose');
      },
    },
  };
}

async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('A13.3 abonnement Visual au pont', () => {
  it('historique puis direct, désabonnement au changement d’instrument et à l’arrêt', async () => {
    const { port: fake, log } = port();
    const seen: Bar[][] = [];
    const follow = followNt(fake, 'MNQ', 5, (bars) => seen.push(bars));
    await settled();
    expect(log).toEqual(['h:MNQ:5', 's:MNQ:5']);
    expect(seen).toEqual([[bar(1)]]);
    follow.retarget('ES', 1);
    await settled();
    expect(log).toEqual(['h:MNQ:5', 's:MNQ:5', 'u:MNQ:5', 'h:ES:1', 's:ES:1']);
    follow.stop();
    expect(log.at(-1)).toBe('u:ES:1');
  });

  it('l’agent ne s’abonne toujours pas', () => {
    const tools = readFileSync('src/engine/agent/tools.ts', 'utf8');
    expect(tools).toMatch(/ne s.abonne pas/);
    expect(tools).not.toContain('followNt');
  });
});
