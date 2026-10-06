import { describe, expect, it } from 'vitest';
import { canAdopt } from '@/store/notes';

describe('A15.2 bouton Adopter', () => {
  it('existe pour une note d’agent, pas pour une note du trader ni une note déjà adoptée', () => {
    expect(canAdopt({ by: 'agent' })).toBe(true);
    expect(canAdopt({})).toBe(false);
    expect(canAdopt({ by: 'agent', adoptedAt: 1_700_000_000_000 })).toBe(false);
  });
});
