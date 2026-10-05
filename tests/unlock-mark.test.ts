import { describe, expect, it } from 'vitest';
import { SEAL_DRAW_S, UNLOCK_SEAL, sealFormMs } from '@/app/unlockMark';

describe('sceau d’ouverture', () => {
  it('garde le mot Desk Unlocked et laisse le temps de le lire', () => {
    expect(UNLOCK_SEAL).toBe('DESK UNLOCKED');
    expect(SEAL_DRAW_S).toBeGreaterThan(0.5);
    expect(sealFormMs()).toBeGreaterThan(1200);
    expect(sealFormMs()).toBeLessThan(1800);
  });
});
