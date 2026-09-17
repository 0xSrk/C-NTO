import { useCallback, useEffect, useState } from 'react';
import { computeAutoZoom, formatZoomPercent, UI_ZOOM_MAX, UI_ZOOM_MIN } from '@/engine/uiScale';
import { desk, isDesk, type ZoomSnapshot } from '@/lib/desk';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './shell.module.css';

/** Contrôles zoom + calibrage écran (barre d’état). */
export function ZoomControls() {
  const uiZoom = useSettings((st) => st.settings.uiZoom);
  const uiZoomAuto = useSettings((st) => st.settings.uiZoomAuto);
  const update = useSettings((st) => st.update);
  const ready = useSettings((st) => st.ready);
  const toast = useUi((u) => u.toast);
  const [snap, setSnap] = useState<ZoomSnapshot | null>(null);

  const applyBrowser = useCallback((user: number, auto: boolean) => {
    const autoZ = computeAutoZoom(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    const factor = auto ? Math.round(autoZ * user * 20) / 20 : user;
    const clamped = Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, factor));
    document.documentElement.style.zoom = String(clamped);
    setSnap({
      factor: clamped,
      auto: autoZ,
      user,
      mode: auto ? 'auto' : 'manual',
      display: {
        width: window.innerWidth,
        height: window.innerHeight,
        scaleFactor: window.devicePixelRatio || 1,
        label: `${window.innerWidth}×${window.innerHeight}`,
      },
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      if (desk?.zoom) {
        await desk.zoom.set({ user: uiZoom, auto: uiZoomAuto });
        const g = await desk.zoom.get();
        if (!cancelled && g) setSnap(g);
      } else {
        applyBrowser(uiZoom, uiZoomAuto);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, uiZoom, uiZoomAuto, applyBrowser]);

  useEffect(() => {
    if (!desk?.zoom) return;
    return desk.zoom.onChange((next) => setSnap(next));
  }, []);

  const step = useCallback(
    async (dir: 1 | -1) => {
      if (desk?.zoom) {
        const next = await desk.zoom.step(dir);
        if (next) {
          setSnap(next);
          await update({ uiZoom: next.user, uiZoomAuto: false });
          toast(`Zoom ${formatZoomPercent(next.factor)}`, 'info');
        }
        return;
      }
      const base = snap?.factor ?? uiZoom;
      const next = Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Math.round((base + dir * 0.05) * 20) / 20));
      await update({ uiZoom: next, uiZoomAuto: false });
      applyBrowser(next, false);
      toast(`Zoom ${formatZoomPercent(next)}`, 'info');
    },
    [applyBrowser, snap?.factor, toast, uiZoom, update],
  );

  const reset = useCallback(async () => {
    if (desk?.zoom) {
      const next = await desk.zoom.reset();
      if (next) {
        setSnap(next);
        await update({ uiZoom: 1, uiZoomAuto: true });
        toast(`Calibrage auto · ${next.display.label} · ${formatZoomPercent(next.factor)}`, 'ok');
      }
      return;
    }
    await update({ uiZoom: 1, uiZoomAuto: true });
    applyBrowser(1, true);
    toast('Calibrage automatique', 'ok');
  }, [applyBrowser, toast, update]);

  const toggleAuto = useCallback(async () => {
    if (uiZoomAuto) {
      const factor = snap?.factor ?? uiZoom;
      await update({ uiZoom: factor, uiZoomAuto: false });
      if (desk?.zoom) {
        const next = await desk.zoom.set({ user: factor, auto: false });
        if (next) setSnap(next);
      } else applyBrowser(factor, false);
      toast(`Zoom manuel · ${formatZoomPercent(factor)}`, 'info');
    } else {
      await update({ uiZoom: 1, uiZoomAuto: true });
      if (desk?.zoom) {
        const next = await desk.zoom.set({ user: 1, auto: true });
        if (next) setSnap(next);
      } else applyBrowser(1, true);
      toast('Calibrage automatique', 'ok');
    }
  }, [applyBrowser, snap?.factor, toast, uiZoom, uiZoomAuto, update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        void step(1);
      } else if (e.key === '-') {
        e.preventDefault();
        void step(-1);
      } else if (e.key === '0') {
        e.preventDefault();
        void reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reset, step]);

  const factor = snap?.factor ?? uiZoom;
  const mode = snap?.mode ?? (uiZoomAuto ? 'auto' : 'manual');
  const label = formatZoomPercent(factor);
  const tip = snap
    ? `${mode === 'auto' ? 'Auto' : 'Manuel'} · écran ${snap.display.label} · OS ×${snap.display.scaleFactor} · Ctrl+± / Ctrl+0`
    : 'Zoom interface · Ctrl+± / Ctrl+0';

  return (
    <div className={s.zoom} title={tip}>
      <button type="button" className={s.zoomBtn} onClick={() => void step(-1)} aria-label="Réduire le zoom" disabled={factor <= UI_ZOOM_MIN + 0.001}>
        −
      </button>
      <button type="button" className={s.zoomPct} onClick={() => void toggleAuto()} onDoubleClick={() => void reset()} aria-label="Basculer auto / manuel">
        <span className={s.zoomMode}>{mode === 'auto' ? 'AUTO' : 'FIXE'}</span>
        {label}
      </button>
      <button type="button" className={s.zoomBtn} onClick={() => void step(1)} aria-label="Augmenter le zoom" disabled={factor >= UI_ZOOM_MAX - 0.001}>
        +
      </button>
      {!isDesk && <span className={s.zoomHint}>nav</span>}
    </div>
  );
}
