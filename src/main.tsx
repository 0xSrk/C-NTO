import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import '@/design/tokens.css';
import { App, bootTimings } from '@/app/App';
import { useAgent } from '@/store/agent';
import { useBridge } from '@/store/bridge';
import { useJournal } from '@/store/journal';
import { useNotes } from '@/store/notes';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

Object.assign(window, { __cantoPerf: bootTimings });

// Un dépôt de fichier hors zone prévue ne doit jamais faire naviguer la fenêtre.
for (const ev of ['dragover', 'drop'] as const) window.addEventListener(ev, (e) => e.preventDefault());
// Les échecs de persistance (quota, base fermée…) remontent au lieu de disparaître en console.
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { message?: string } | undefined;
  useUi.getState().toast(`Opération interrompue : ${reason?.message ?? String(e.reason)}`, 'error');
});
if (import.meta.env.DEV) {
  Object.assign(window, { __canto: { useAgent, useBridge, useJournal, useNotes, useSettings, useUi } });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
