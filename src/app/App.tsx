import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { generateNasdaqEvents } from '@/engine/calendar';
import { isDesk } from '@/lib/desk';
import { useAgent } from '@/store/agent';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useNotes } from '@/store/notes';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { Boot, type BootStep } from './Boot';
import { Shell } from './Shell';

const Metrique = lazy(() => import('@/modules/metrique/Metrique'));
const Visual = lazy(() => import('@/modules/visual/Visual'));
const Calendrier = lazy(() => import('@/modules/calendrier/Calendrier'));
const Note = lazy(() => import('@/modules/note/Note'));
const Agent = lazy(() => import('@/modules/agent/Agent'));
const Bot = lazy(() => import('@/modules/bot/Bot'));
const Copieur = lazy(() => import('@/modules/copieur/Copieur'));

const INITIAL_STEPS: BootStep[] = [
  { id: 'core', label: 'Noyau CΛNTO', status: 'pending' },
  { id: 'vault', label: 'Coffre local', status: 'pending' },
  { id: 'engine', label: 'Moteur métrique', status: 'pending' },
  { id: 'calendar', label: 'Calendrier Nasdaq', status: 'pending' },
  { id: 'notes', label: 'Coffre de notes', status: 'pending' },
  { id: 'agent', label: 'Passerelle agent', status: 'pending' },
  { id: 'bridge', label: 'Pont NinjaTrader', status: 'pending' },
];

type Mark = (id: string, status: BootStep['status'], detail?: string) => void;

/** Séquence d'initialisation, exécutée une seule fois par chargement de page. */
let bootPromise: Promise<void> | null = null;
const listeners = new Set<Mark>();
const marks: { id: string; status: BootStep['status']; detail?: string }[] = [];

function mark(id: string, status: BootStep['status'], detail?: string) {
  marks.push({ id, status, detail });
  for (const l of listeners) l(id, status, detail);
}

function boot(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    mark('core', 'ok', isDesk ? 'shell Electron' : 'navigateur');
    try {
      await useSettings.getState().load();
      await useJournal.getState().load();
      const j = useJournal.getState();
      mark('vault', 'ok', `${j.sessions.length} séance(s) · ${j.trades.length} trade(s)`);
    } catch (e) {
      mark('vault', 'warn', e instanceof Error ? e.message : 'indisponible');
    }
    mark('engine', 'ok', 'ratios · Monte Carlo · prop firm');
    const year = new Date().getFullYear();
    mark('calendar', 'ok', `${generateNasdaqEvents(year).length} repères ${year}`);
    try {
      await useNotes.getState().load();
      await useCalendar.getState().load();
      mark('notes', 'ok', `${useNotes.getState().notes.length} note(s)`);
    } catch {
      mark('notes', 'warn', 'indisponible');
    }
    try {
      await useAgent.getState().load();
      const o = useAgent.getState().orchestrator;
      mark('agent', o.running ? 'ok' : 'off', o.running ? `port ${o.port}` : 'en veille');
    } catch {
      mark('agent', 'warn', 'erreur');
    }
    mark('bridge', 'off', 'hors ligne');
  })();
  return bootPromise;
}

export function App() {
  const [steps, setSteps] = useState<BootStep[]>(INITIAL_STEPS);
  const [ready, setReady] = useState(false);
  const [booted, setBooted] = useState(false);
  const tab = useUi((u) => u.tab);

  useEffect(() => {
    const apply: Mark = (id, status, detail) => setSteps((prev) => prev.map((st) => (st.id === id ? { ...st, status, detail } : st)));
    for (const m of marks) apply(m.id, m.status, m.detail);
    listeners.add(apply);
    let cancelled = false;
    boot().then(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
      listeners.delete(apply);
    };
  }, []);

  const finish = useCallback(() => setBooted(true), []);

  return (
    <>
      {booted && (
        <Shell>
          <Suspense fallback={<div className="micro" style={{ padding: 24 }}>Chargement du module…</div>}>
            {tab === 'metrique' && <Metrique />}
            {tab === 'visual' && <Visual />}
            {tab === 'calendrier' && <Calendrier />}
            {tab === 'note' && <Note />}
            {tab === 'agent' && <Agent />}
            {tab === 'bot' && <Bot />}
            {tab === 'copieur' && <Copieur />}
          </Suspense>
        </Shell>
      )}
      {!booted && <Boot steps={steps} ready={ready} onFinished={finish} />}
    </>
  );
}
