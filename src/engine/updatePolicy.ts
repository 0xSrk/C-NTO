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

/** Clone git → pull. Installeur sans `.git` → page GitHub. Le réglage `release` n’empêche plus un checkout de se mettre à jour. */
export function resolveUpdateChannel(isGitCheckout: boolean, _setting?: string): UpdateChannel {
  return isGitCheckout ? 'dev' : 'release';
}

export function canApplyGitUpdate(input: GitUpdateInput): { ok: true } | { ok: false; reason: string } {
  if (!input.isGitCheckout) return { ok: false, reason: 'not_git' };
  if (input.dirty) return { ok: false, reason: 'dirty' };
  return { ok: true };
}

export function canStash(input: StashInput): boolean {
  return input.confirmStash === true;
}
