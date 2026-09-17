/** Échelle UI — côté process principal Electron (miroir de src/engine/uiScale.ts). */

export const UI_ZOOM_MIN = 0.75;
export const UI_ZOOM_MAX = 1.5;
export const UI_ZOOM_STEP = 0.05;

export function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, n));
}

export function snapZoom(n: number): number {
  return clampZoom(Number((Math.round(n / UI_ZOOM_STEP) * UI_ZOOM_STEP).toFixed(2)));
}

export function computeAutoZoom(workAreaWidth: number, workAreaHeight: number, scaleFactor = 1): number {
  const w = Math.max(800, workAreaWidth);
  const h = Math.max(600, workAreaHeight);
  const raw = Math.sqrt((w / 1920) * (h / 1040));
  let z = 1 + (raw - 1) * 0.5;
  const sf = scaleFactor > 0 ? scaleFactor : 1;
  if (sf >= 1.5) z *= 0.94;
  if (sf >= 2) z *= 0.92;
  return snapZoom(Math.min(1.35, Math.max(0.85, z)));
}

export type UiZoomMode = 'auto' | 'manual';

export function resolveZoom(auto: number, userFactor: number, mode: UiZoomMode): number {
  const u = clampZoom(userFactor);
  if (mode === 'manual') return snapZoom(u);
  return snapZoom(auto * u);
}

export function stepZoom(current: number, direction: 1 | -1): number {
  return snapZoom(current + direction * UI_ZOOM_STEP);
}

export function suggestWindowSize(
  workAreaWidth: number,
  workAreaHeight: number,
  zoom: number,
): { width: number; height: number } {
  const z = clampZoom(zoom);
  const targetW = Math.round(1560 * Math.min(z, 1.2));
  const targetH = Math.round(980 * Math.min(z, 1.2));
  const maxW = Math.max(800, Math.round(workAreaWidth * 0.92));
  const maxH = Math.max(600, Math.round(workAreaHeight * 0.9));
  return {
    width: Math.min(Math.max(targetW, Math.min(1180, maxW)), maxW),
    height: Math.min(Math.max(targetH, Math.min(720, maxH)), maxH),
  };
}
