import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/design/tokens.css';
import { App } from '@/app/App';
import { useJournal } from '@/store/journal';
import { useNotes } from '@/store/notes';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

if (import.meta.env.DEV) {
  Object.assign(window, { __canto: { useJournal, useNotes, useSettings, useUi } });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
