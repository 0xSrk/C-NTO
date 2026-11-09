import type { CalEvent } from '@/engine/calendar';
import { coverageEstimates } from '@/engine/calendarCoverage';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { packCopierSync } from '@/engine/copier/sync';
import { findPlan } from '@/engine/propfirm';
import { desk } from '@/lib/desk';
import { ET_ZONE, etDateKey, zonedToUtc } from '@/lib/time';
import { useBridge } from './bridge';
import { useCopier } from './copier';
import { useJournal } from './journal';
import { useMacro } from './macro';

/** Un catalyseur passé depuis plus longtemps ne ferme plus rien : le blackout tient quinze minutes, un fill en retard une minute au plus. */
const CATALYST_KEEP_MS = 60 * 60 * 1000;

/**
 * Catalyseurs majeurs (impact 3, heure connue), en epoch ms : le blackout du Copieur. Les lignes officielles, plus les
 * NFP et CPI estimés par règle quand le calendrier officiel ne couvre plus (`estimates`, SEC2.2). Les plus proches
 * d'abord, sans doublon ni catalyseur passé depuis plus d'une heure : le process principal n'en garde que 64
 * (`coerceCopierSync`), et ce sont ceux-là qui comptent.
 */
export function copierCatalysts(events: readonly CalendarEventRow[], estimates: readonly CalEvent[] = [], now = Date.now()): { at: number }[] {
  const instants = [...events, ...estimates].filter((event) => event.impact === 3 && event.timeET).map((event) => zonedToUtc(event.date, event.timeET ?? '00:00', ET_ZONE));
  return [...new Set(instants)]
    .filter((at) => Number.isFinite(at) && at >= now - CATALYST_KEEP_MS)
    .sort((a, b) => a - b)
    .map((at) => ({ at }));
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
      catalysts: copierCatalysts(useMacro.getState().events, coverageEstimates(useMacro.getState().events, etDateKey(Date.now()))),
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
