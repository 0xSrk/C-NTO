import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import '@/design/tokens.css';
import { App, bootTimings } from '@/app/App';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { logLine } from '@/lib/log';
import { useAgent } from '@/store/agent';
import { useBridge } from '@/store/bridge';
import { useJournal } from '@/store/journal';
import { useNotes } from '@/store/notes';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

Object.assign(window, { __cantoPerf: bootTimings });

function paintFatal(message: string): void {
  if (document.getElementById('canto-fatal')) return;
  const el = document.createElement('div');
  el.id = 'canto-fatal';
  el.setAttribute('role', 'alert');
  el.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:#0a0a0a;color:#f2f2f2;padding:32px;font:14px/1.5 ui-sans-serif,sans-serif;white-space:pre-wrap';
  el.textContent = `CΛNTO — affichage interrompu\n\n${message}\n\nLes données du coffre ne sont pas modifiées. Relancez le desk.`;
  document.body.appendChild(el);
}

window.addEventListener('error', (event) => {
  if (event.target !== window) return;
  const message = event.message || 'Erreur de rendu';
  if (message.includes('ResizeObserver')) return;
  paintFatal(message);
});

// Un dépôt de fichier hors zone prévue ne doit jamais faire naviguer la fenêtre.
for (const ev of ['dragover', 'drop'] as const) window.addEventListener(ev, (e) => e.preventDefault());
// Les échecs de persistance (quota, base fermée…) remontent au lieu de disparaître en console.
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { message?: string } | undefined;
  const detail = reason?.message ?? String(e.reason);
  logLine('error', `unhandledrejection: ${detail}`);
  useUi.getState().toast(`Opération interrompue : ${detail}`, 'error');
});
if (import.meta.env.DEV) {
  Object.assign(window, { __canto: { useAgent, useBridge, useJournal, useNotes, useSettings, useUi } });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
