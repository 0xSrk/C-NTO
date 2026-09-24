/**
 * Décide si le processus Chromium doit accélérer le compositing.
 * Un échec GPU (processus mort avant la première frame, ou marqueur posé
 * après un crash) bascule en rendu logiciel. macOS et Windows avec un GPU
 * sain restent accélérés : le marqueur n'existe que si une frame n'a pas abouti.
 */
export interface GpuDecisionInput {
  platform: string;
  /** Linux : au moins un nœud DRM. Ignoré ailleurs. */
  renderNode: boolean;
  /** Dernier lancement hardware mort avant d'accuser réception d'une frame. */
  openAttempt: boolean;
  /** Échec déjà enregistré (crash GPU). */
  softwareMarker: boolean;
  envDisabled: boolean;
}

export function hardwareAccelerationEnabled(input: GpuDecisionInput): boolean {
  if (input.envDisabled || input.softwareMarker || input.openAttempt) return false;
  if (input.platform === 'linux' && !input.renderNode) return false;
  return true;
}

export function hasDrmRenderNode(exists: (file: string) => boolean): boolean {
  return exists('/dev/dri/renderD128') || exists('/dev/dri/card0');
}
