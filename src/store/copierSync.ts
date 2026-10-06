import type { CalendarEventRow } from '@/engine/calendarEvents';
import { packCopierSync } from '@/engine/copier/sync';
import { findPlan } from '@/engine/propfirm';
import { desk } from '@/lib/desk';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { useBridge } from './bridge';
import { useCopier } from './copier';
import { useJournal } from './journal';
import { useMacro } from './macro';

/** Catalyseurs majeurs (impact 3, heure connue), en epoch ms : le blackout du Copieur. */
export function copierCatalysts(events: readonly CalendarEventRow[]): { at: number }[] {
  return events.filter((event) => event.impact === 3 && event.timeET).map((event) => ({ at: zonedToUtc(event.date, event.timeET ?? '00:00', ET_ZONE) }));
}

let stop: (() => void) | null = null;

/**
 * Tient le process principal à jour, onglet Copieur ouvert ou non : comptes et réglages du Copieur, séances et
 * trades du journal (le pont y importe chaque exécution), catalyseurs, plafond du pont. Le plancher prop des
 * suiveurs se rejoue sur ces séances : sa marge datée suit la journée en cours. Rien ne part avant le chargement
 * des comptes du Copieur. Un seul abonnement ; rend la fonction d'arrêt.
 */
export function startCopierSync(): () => void {
  if (stop) return stop;
  const api = desk?.copier;
  if (!api) return () => {};
  let live = true;
  let queued = false;
  const send = () => {
    queued = false;
    const copier = useCopier.getState();
    if (!live || !copier.ready) return;
    const { sessions, trades } = useJournal.getState();
    const payload = packCopierSync({
      accounts: copier.accounts,
      config: copier.config,
      sessions,
      trades,
      planById: findPlan,
      catalysts: copierCatalysts(useMacro.getState().events),
      maxContractsPerOrder: useBridge.getState().nt?.maxContractsPerOrder ?? 20,
    });
    void api.configure(payload).catch(() => false);
  };
  // Plusieurs changements dans la même tâche (un import pose séances puis trades) : un seul envoi.
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(send);
  };
  const disposers = [
    useCopier.subscribe((s, prev) => {
      if (s.ready !== prev.ready || s.accounts !== prev.accounts || s.config !== prev.config) schedule();
    }),
    useJournal.subscribe((s, prev) => {
      if (s.sessions !== prev.sessions || s.trades !== prev.trades) schedule();
    }),
    useMacro.subscribe((s, prev) => {
      if (s.events !== prev.events) schedule();
    }),
    useBridge.subscribe((s, prev) => {
      if (s.nt?.maxContractsPerOrder !== prev.nt?.maxContractsPerOrder) schedule();
    }),
  ];
  stop = () => {
    live = false;
    for (const dispose of disposers) dispose();
    stop = null;
  };
  schedule();
  return stop;
}
