import { useEffect, useMemo, useState } from 'react';
import { calendarSourcesState, dayBornes, replayBornes, type BornesReplay, type BornesReplayInput, type DayBornes } from '@/engine/bornes';
import { majorCatalysts } from '@/engine/discipline';
import { catalystSource } from '@/engine/macroMerge';
import { findPlan } from '@/engine/propfirm';
import { etDateKey } from '@/lib/time';
import { useBridge } from '@/store/bridge';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { useSettings } from '@/store/settings';
import { useKillLatch } from './killState';

/** L'horloge des bornes : l'âge d'une valeur vive et la fenêtre d'un catalyseur avancent avec elle. */
export const BORNES_TICK_MS = 15_000;

let shared: (BornesReplayInput & { replay: BornesReplay }) | null = null;

/**
 * Le rejeu partagé (OROS5.22) : chaque lecteur des bornes — la barre d'état, la réponse du temps, la fiche Compte —
 * reçoit le même, calculé une fois pour un même journal, plan, compte suivi et jeu de règles. Les entrées se comparent
 * par identité : les stores rendent de nouveaux tableaux à chaque écriture, et `findPlan` un plan du registre.
 */
export function sharedReplay(input: BornesReplayInput): BornesReplay {
  const hit = shared;
  if (hit && hit.sessions === input.sessions && hit.trades === input.trades && hit.account === input.account && hit.plan === input.plan && hit.rules === input.rules) return hit.replay;
  const replay = replayBornes(input);
  shared = { ...input, replay };
  return replay;
}

/**
 * Les bornes de la journée, calculées une fois pour tout le desk (OROS5.11) : la barre d'état et la fiche Compte lisent
 * ce même calcul, le rejeu étant partagé entre eux (`sharedReplay`, OROS5.22). Le rejeu (`replayBornes` : le plan sur
 * tout l'historique, la journée lue et ses écarts) ne tourne qu'à un changement de journal, de plan, de compte suivi ou
 * de règles ; chaque statut du pont et chaque tic de 15 s ne relisent que le vif : le latent, l'âge, le canal et
 * l'horloge du catalyseur.
 */
export function useDayBornes(): DayBornes {
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const rules = useSettings((st) => st.settings.traderRules);
  const planId = useSettings((st) => st.settings.planId);
  const planAccount = useSettings((st) => st.settings.planAccount);
  const userPlans = useSettings((st) => st.settings.userPlans);
  const nt = useBridge((b) => b.nt);
  const killLatched = useKillLatch((k) => k.engaged);
  const official = useMacro((m) => m.events);
  const sources = useMacro((m) => m.sources);
  const lastError = useMacro((m) => m.lastError);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), BORNES_TICK_MS);
    return () => clearInterval(id);
  }, []);
  // `userPlans` : un plan saisi change ce que rend `findPlan`.
  const plan = useMemo(() => findPlan(planId) ?? null, [planId, userPlans]);
  const replay = useMemo(() => sharedReplay({ sessions, trades, account: planAccount, plan, rules }), [sessions, trades, planAccount, plan, rules]);
  // Chaque statut du pont relit aussi l'heure : l'âge d'une valeur vive est juste entre deux tics.
  const now = Math.max(tick, Date.now());
  const year = Number(etDateKey(now).slice(0, 4));
  // La source unique du catalyseur (OROS5.13) : celle du Calendrier et de l'ontologie, estimés marqués.
  const catalysts = useMemo(() => majorCatalysts(catalystSource(official, [year, year + 1])), [year, official]);
  const calendarSources = calendarSourcesState(sources, lastError, official.length);
  return useMemo(
    () =>
      dayBornes(replay, {
        now,
        link: nt?.link ?? 'absent',
        accountsAt: nt?.accountsAt ?? null,
        accounts: nt?.accounts ?? [],
        catalysts,
        calendarSources,
        ordersOpen: nt?.ordersOpen,
        ordersClosed: nt?.ordersClosed,
        killLatched,
        maxContractsPerOrder: nt?.maxContractsPerOrder ?? null,
      }),
    [replay, now, nt, catalysts, calendarSources, killLatched],
  );
}
