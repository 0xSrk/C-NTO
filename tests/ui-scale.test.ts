import { describe, expect, it } from 'vitest';
import {
  computeAutoZoom,
  formatZoomPercent,
  resolveZoom,
  snapZoom,
  stepZoom,
  suggestWindowSize,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
} from '@/engine/uiScale';

describe('uiScale', () => {
  it('calibre ~1.0 sur un bureau 1080p', () => {
    expect(computeAutoZoom(1920, 1040, 1)).toBe(1);
  });

  it('augmente progressivement sur 2K / 3K sans exploser', () => {
    const k2 = computeAutoZoom(2560, 1400, 1);
    const k3 = computeAutoZoom(3200, 1800, 1);
    const k4 = computeAutoZoom(3840, 2100, 1);
    expect(k2).toBeGreaterThan(1);
    expect(k2).toBeLessThanOrEqual(1.25);
    expect(k3).toBeGreaterThanOrEqual(k2);
    expect(k4).toBeGreaterThanOrEqual(k3);
    expect(k4).toBeLessThanOrEqual(1.35);
  });

  it('atténue le boost si le scaleFactor OS est déjà élevé', () => {
    const plain = computeAutoZoom(3840, 2160, 1);
    const hidpi = computeAutoZoom(2560, 1440, 1.5);
    expect(hidpi).toBeLessThanOrEqual(plain);
  });

  it('respecte le mode auto (multiplicateur) vs manuel (absolu)', () => {
    expect(resolveZoom(1.2, 1, 'auto')).toBe(1.2);
    expect(resolveZoom(1.2, 0.9, 'auto')).toBe(snapZoom(1.08));
    expect(resolveZoom(1.2, 1.1, 'manual')).toBe(1.1);
  });

  it('borne les pas de zoom', () => {
    expect(stepZoom(UI_ZOOM_MIN, -1)).toBe(UI_ZOOM_MIN);
    expect(stepZoom(UI_ZOOM_MAX, 1)).toBe(UI_ZOOM_MAX);
    expect(stepZoom(1, 1)).toBe(1.05);
    expect(formatZoomPercent(1.1)).toBe('110 %');
  });

  it('propose une fenêtre adaptée à la zone utile', () => {
    const small = suggestWindowSize(1366, 768, 0.9);
    expect(small.width).toBeLessThanOrEqual(Math.round(1366 * 0.92));
    expect(small.height).toBeLessThanOrEqual(Math.round(768 * 0.9));
    const big = suggestWindowSize(3840, 2160, 1.2);
    expect(big.width).toBeGreaterThanOrEqual(1560);
    expect(big.height).toBeGreaterThanOrEqual(980);
  });
});
