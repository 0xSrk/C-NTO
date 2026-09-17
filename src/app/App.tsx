import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { generateNasdaqEvents } from '@/engine/calendar';
import { isDesk } from '@/lib/desk';
import { plural } from '@/lib/format';
import { useAgent } from '@/store/agent';
import { useBridge } from '@/store/bridge';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { requestPersistence } from '@/store/db';
import { Boot, type BootStep } from './Boot';
import { ErrorBoundary } from './ErrorBoundary';
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
  { id: 'vault', label: 'Persistance', status: 'pending' },
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

export interface BootTimings {
  /** ms depuis l'origine de navigation */
  bootStart: number;
  bootReady: number;
  deskShown: number | null;
}
export const bootTimings: BootTimings = { bootStart: 0, bootReady: 0, deskShown: null };

async function step(id: string, run: () => Promise<[BootStep['status'], string | undefined]>): Promise<void> {
  try {
    const [status, detail] = await run();
    mark(id, status, detail);
  } catch (e) {
    mark(id, 'warn', e instanceof Error ? e.message : 'indisponible');
  }
}

function boot(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootTimings.bootStart = performance.now();
  bootPromise = (async () => {
    mark('core', 'ok', isDesk ? 'shell Electron' : 'navigateur');
    // Précharge le module d'accueil pendant l'écran de chargement.
    void import('@/modules/metrique/Metrique');
    void requestPersistence();
    const year = new Date().getFullYear();
    // Les réglages d'abord (pilotent l'import du pont), puis tous les coffres en parallèle.
    await step('vault', async () => {
      await useSettings.getState().load();
      await useJournal.getState().load();
      const j = useJournal.getState();
      return ['ok', `${plural(j.sessions.length, 'séance')} · ${plural(j.trades.length, 'trade')}`];
    });
    await Promise.all([
      step('engine', async () => ['ok', 'ratios · Monte Carlo · prop firm']),
      step('calendar', async () => ['ok', `${generateNasdaqEvents(year).length} repères ${year}`]),
      step('notes', async () => {
        await Promise.all([useNotes.getState().load(), useCalendar.getState().load(), useMacro.getState().load()]);
        void useMacro.getState().sync();
        return ['ok', plural(useNotes.getState().notes.length, 'note')];
      }),
      step('agent', async () => {
        await useAgent.getState().load();
        const o = useAgent.getState().orchestrator;
        return [o.running ? 'ok' : 'off', o.running ? `port ${o.port}` : 'en veille'];
      }),
      step('bridge', async () => {
        await useBridge.getState().load();
        const b = useBridge.getState().status;
        if (!isDesk) return ['off', 'navigateur · import manuel'];
        if (b?.enabled && b.folder) return [b.error ? 'warn' : 'ok', b.error ?? `dossier surveillé · ${plural(b.files, 'fichier')}`];
        return ['off', 'non configuré'];
      }),
    ]);
    bootTimings.bootReady = performance.now();
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

  const finish = useCallback(() => {
    bootTimings.deskShown = performance.now();
    setBooted(true);
  }, []);

  // Le desk se monte sous l'écran de chargement dès que les coffres sont prêts : le premier
  // rendu lourd se fait masqué et la transition est un fondu, sans écran noir intermédiaire.
  return (
    <>
      {(ready || booted) && (
        <Shell>
          <ErrorBoundary resetKey={tab}>
            <Suspense fallback={<div className="micro" style={{ padding: 24 }}>Chargement du module…</div>}>
              {tab === 'metrique' && <Metrique />}
              {tab === 'visual' && <Visual />}
              {tab === 'calendrier' && <Calendrier />}
              {tab === 'note' && <Note />}
              {tab === 'agent' && <Agent />}
              {tab === 'bot' && <Bot />}
              {tab === 'copieur' && <Copieur />}
            </Suspense>
          </ErrorBoundary>
        </Shell>
      )}
      {!booted && <Boot steps={steps} ready={ready} onFinished={finish} />}
    </>
  );
}
