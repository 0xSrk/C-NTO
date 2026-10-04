import { describe, expect, it } from 'vitest';
import { opens } from '@/engine/gate';

describe('ouverture du desk', () => {
  it('reste fermé sans la phrase, et pour une phrase quelconque', async () => {
    expect(await opens('')).toBe(false);
    expect(await opens(' ')).toBe(false);
    expect(await opens('canto')).toBe(false);
    expect(await opens('password')).toBe(false);
    expect(await opens('a'.repeat(64))).toBe(false);
  });
});
