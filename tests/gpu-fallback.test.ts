import { describe, expect, it } from 'vitest';
import { hardwareAccelerationEnabled, hasDrmRenderNode } from '../electron/gpu-fallback';

const base = {
  platform: 'linux',
  renderNode: true,
  openAttempt: false,
  softwareMarker: false,
  envDisabled: false,
};

describe('accélération GPU du desk', () => {
  it('garde le GPU sur macOS et Windows', () => {
    expect(hardwareAccelerationEnabled({ ...base, platform: 'darwin', renderNode: false })).toBe(true);
    expect(hardwareAccelerationEnabled({ ...base, platform: 'win32', renderNode: false })).toBe(true);
  });

  it('passe en logiciel sans nœud DRM Linux, ou après un crash', () => {
    expect(hardwareAccelerationEnabled({ ...base, renderNode: false })).toBe(false);
    expect(hardwareAccelerationEnabled({ ...base, openAttempt: true })).toBe(false);
    expect(hardwareAccelerationEnabled({ ...base, softwareMarker: true })).toBe(false);
    expect(hardwareAccelerationEnabled({ ...base, envDisabled: true })).toBe(false);
  });

  it('détecte un nœud de rendu', () => {
    expect(hasDrmRenderNode((p) => p.endsWith('renderD128'))).toBe(true);
    expect(hasDrmRenderNode(() => false)).toBe(false);
  });
});
