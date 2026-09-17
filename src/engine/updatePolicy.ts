export type UpdateChannel = 'release' | 'dev';

export interface GitUpdateInput {
  channel: UpdateChannel;
  isGitCheckout: boolean;
  dirty: boolean;
}

export interface StashInput {
  channel: UpdateChannel;
  confirmStash: boolean;
}

export function resolveUpdateChannel(isGitCheckout: boolean, setting: string | undefined): UpdateChannel {
  if (isGitCheckout && setting === 'dev') return 'dev';
  return 'release';
}

export function canApplyGitUpdate(input: GitUpdateInput): { ok: true } | { ok: false; reason: string } {
  if (input.channel !== 'dev') return { ok: false, reason: 'channel_release' };
  if (!input.isGitCheckout) return { ok: false, reason: 'not_git' };
  if (input.dirty) return { ok: false, reason: 'dirty' };
  return { ok: true };
}

export function canStash(input: StashInput): boolean {
  return input.channel === 'dev' && input.confirmStash === true;
}
