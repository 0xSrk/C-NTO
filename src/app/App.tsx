import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { tr, useI18n } from '@/i18n';
import { generateNasdaqEvents } from '@/engine/calendar';
import { isDesk } from '@/lib/desk';
import { plural } from '@/lib/format';
import { useAgent } from '@/store/agent';
import { isBridgeLive, useBridge } from '@/store/bridge';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { useLinks } from '@/store/links';
import { useNotes } from '@/store/notes';
import { scheduleOntologyRecompute } from '@/store/ontology-schedule';
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

function initialSteps(): BootStep[] {
  return [
    { id: 'core', label: tr('Noyau CΛNTO', 'CΛNTO core', 'Núcleo CΛNTO'), status: 'pending' },
    { id: 'vault', label: tr('Persistance', 'Persistence', 'Persistencia'), status: 'pending' },
    { id: 'engine', label: tr('Moteur métrique', 'Metrics engine', 'Motor métrico'), status: 'pending' },
    { id: 'calendar', label: tr('Calendrier Nasdaq', 'Nasdaq calendar', 'Calendario Nasdaq'), status: 'pending' },
    { id: 'notes', label: tr('Coffre de notes', 'Note vault', 'Caja de notas'), status: 'pending' },
    { id: 'agent', label: tr('Passerelle agent', 'Agent gateway', 'Pasarela del agente'), status: 'pending' },
    { id: 'bridge', label: tr('Pont NinjaTrader', 'NinjaTrader bridge', 'Puente NinjaTrader'), status: 'pending' },
  ];
}

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
    mark(id, 'warn', e instanceof Error ? e.message : tr('indisponible', 'unavailable', 'no disponible'));
  }
}

function boot(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootTimings.bootStart = performance.now();
  bootPromise = (async () => {
    mark('core', 'ok', isDesk ? tr('shell Electron', 'Electron shell', 'shell Electron') : tr('navigateur', 'browser', 'navegador'));
    // Précharge le module d'accueil pendant l'écran de chargement.
    void import('@/modules/metrique/Metrique');
    void requestPersistence();
    const year = new Date().getFullYear();
    // Les réglages d'abord (pilotent l'import du pont), puis tous les coffres en parallèle.
    await step('vault', async () => {
      await useSettings.getState().load();
      await useJournal.getState().load();
      const j = useJournal.getState();
      return ['ok', `${plural(j.sessions.length, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))} · ${plural(j.trades.length, 'trade')}`];
    });
    await Promise.all([
      step('engine', async () => ['ok', tr('ratios · Monte Carlo · prop firm', 'ratios · Monte Carlo · prop firm', 'ratios · Monte Carlo · prop firm')]),
      step('calendar', async () => ['ok', `${generateNasdaqEvents(year).length} ${tr('repères', 'markers', 'referencias')} ${year}`]),
      step('notes', async () => {
        await Promise.all([useNotes.getState().load(), useCalendar.getState().load(), useMacro.getState().load(), useLinks.getState().load()]);
        scheduleOntologyRecompute();
        void useMacro.getState().sync();
        return ['ok', plural(useNotes.getState().notes.length, tr('note', 'note', 'nota'), tr('notes', 'notes', 'notas'))];
      }),
      step('agent', async () => {
        await useAgent.getState().load();
        const o = useAgent.getState().orchestrator;
        return [o.running ? 'ok' : 'off', o.running ? `port ${o.port}` : tr('en veille', 'idle', 'en espera')];
      }),
      step('bridge', async () => {
        await useBridge.getState().load();
        const b = useBridge.getState().status;
        if (!isDesk) return ['off', tr('navigateur · import manuel', 'browser · manual import', 'navegador · importación manual')];
        if (b?.enabled && b.folder) return [isBridgeLive(b) ? 'ok' : 'warn', b.error ?? `${tr('dossier surveillé', 'watched folder', 'carpeta vigilada')} · ${plural(b.files, tr('fichier', 'file', 'archivo'), tr('fichiers', 'files', 'archivos'))}`];
        return ['off', tr('non configuré', 'not configured', 'no configurado')];
      }),
    ]);
    bootTimings.bootReady = performance.now();
  })();
  return bootPromise;
}

export function App() {
  const locale = useI18n((s) => s.locale);
  const [steps, setSteps] = useState<BootStep[]>(initialSteps);
  const [ready, setReady] = useState(false);
  const [booted, setBooted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const tab = useUi((u) => u.tab);

  useEffect(() => {
    const apply: Mark = (id, status, detail) => setSteps((prev) => prev.map((st) => (st.id === id ? { ...st, status, detail } : st)));
    for (const m of marks) apply(m.id, m.status, m.detail);
    listeners.add(apply);
    let cancelled = false;
    boot().then(() => !cancelled && setReady(true));
    // Le voile de boot est noir. S'il ne se termine pas (coffre bloqué), le desk
    // doit quand même apparaître au lieu d'une fenêtre muette.
    const watchdog = setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 8000);
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      listeners.delete(apply);
    };
  }, []);

  const reveal = useCallback(() => setRevealed(true), []);
  const finish = useCallback(() => {
    bootTimings.deskShown = performance.now();
    setRevealed(true);
    setBooted(true);
  }, []);

  // Le desk se monte sous l'écran de chargement dès que les coffres sont prêts : le premier
  // rendu lourd se fait masqué et la transition est un fondu, sans écran noir intermédiaire.
  return (
    <>
      {(ready || booted) && (
        <Shell revealed={revealed}>
          <ErrorBoundary resetKey={tab}>
            <Suspense fallback={<div className="micro" style={{ padding: 24 }} data-locale={locale}>{tr('Chargement du module…', 'Loading module…', 'Cargando el módulo…')}</div>}>
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
      {!booted && <Boot steps={steps} ready={ready} onReveal={reveal} onFinished={finish} />}
    </>
  );
}
