import { describe, expect, it } from 'vitest';
import { canApplyGitUpdate, canStash, resolveUpdateChannel } from '@/engine/updatePolicy';

describe('politique de mise à jour', () => {
  it('release refuse tout git pull', () => {
    expect(canApplyGitUpdate({ channel: 'release', isGitCheckout: true, dirty: false })).toEqual({ ok: false, reason: 'channel_release' });
    expect(canStash({ channel: 'release', confirmStash: true })).toBe(false);
    expect(resolveUpdateChannel(true, undefined)).toBe('release');
    expect(resolveUpdateChannel(false, 'dev')).toBe('release');
  });

  it('dev + checkout propre autorise le pull ff-only', () => {
    expect(canApplyGitUpdate({ channel: 'dev', isGitCheckout: true, dirty: false })).toEqual({ ok: true });
    expect(resolveUpdateChannel(true, 'dev')).toBe('dev');
  });

  it('dev + dirty sans confirm refuse le stash', () => {
    expect(canApplyGitUpdate({ channel: 'dev', isGitCheckout: true, dirty: true })).toEqual({ ok: false, reason: 'dirty' });
    expect(canStash({ channel: 'dev', confirmStash: false })).toBe(false);
  });

  it('dev + dirty avec confirm autorise le stash', () => {
    expect(canStash({ channel: 'dev', confirmStash: true })).toBe(true);
    expect(canApplyGitUpdate({ channel: 'dev', isGitCheckout: true, dirty: true }).ok).toBe(false);
  });
});
