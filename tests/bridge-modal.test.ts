import { describe, expect, it } from 'vitest';
import { ceilingDisplay, nextCeilingDraft } from '@/modules/metrique/BridgeModal';

describe('plafond du pont', () => {
  it('saisir 5000 ramène l’affichage à la valeur persistée', () => {
    const persisted = 20;
    const refused = nextCeilingDraft('5000');
    expect(refused.draft).toBeNull();
    expect(refused.error).toContain('1');
    expect(refused.error).toContain('1000');
    expect(ceilingDisplay(persisted, '5000')).toBe('20');
    expect(ceilingDisplay(persisted, '500')).toBe('500');
    expect(nextCeilingDraft('1').draft).toBe('1');
    expect(nextCeilingDraft('1000').draft).toBe('1000');
    expect(nextCeilingDraft('0').draft).toBeNull();
  });
});
