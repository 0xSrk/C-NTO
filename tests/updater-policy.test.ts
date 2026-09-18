import { describe, expect, it } from 'vitest';
import { canApplyGitUpdate, canStash, resolveUpdateChannel } from '@/engine/updatePolicy';

describe('politique de mise à jour', () => {
  it('un checkout git propre autorise le pull, même si le réglage dit release', () => {
    expect(canApplyGitUpdate({ channel: 'release', isGitCheckout: true, dirty: false })).toEqual({ ok: true });
    expect(resolveUpdateChannel(true, 'release')).toBe('dev');
    expect(resolveUpdateChannel(true, undefined)).toBe('dev');
  });

  it('sans dépôt git, refuse le pull (installeur → page GitHub)', () => {
    expect(canApplyGitUpdate({ channel: 'dev', isGitCheckout: false, dirty: false })).toEqual({ ok: false, reason: 'not_git' });
    expect(resolveUpdateChannel(false, 'dev')).toBe('release');
  });

  it('working tree dirty refuse le pull tant que le stash n’est pas confirmé', () => {
    expect(canApplyGitUpdate({ channel: 'dev', isGitCheckout: true, dirty: true })).toEqual({ ok: false, reason: 'dirty' });
    expect(canStash({ channel: 'dev', confirmStash: false })).toBe(false);
    expect(canStash({ channel: 'release', confirmStash: true })).toBe(true);
  });
});
