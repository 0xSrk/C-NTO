import { create } from 'zustand';
import type { DeskEventKind } from '@/engine/agent/catalog';
import { DeskEventLog, dueCatalysts, fillData, linkTransition, propBufferAlert, propLiveBuffer, type DeskEvent, type PropBufferInput } from '@/engine/agent/events';
import { dailyLossAlert, ThresholdWatch, type DailyLossInput } from '@/engine/agent/events';
import { dailyLimit, dayLoss, detectDrifts, detectRuleBreaches, majorCatalysts, tradingDayNow, type DisciplineEntry } from '@/engine/discipline';
import { generateNasdaqEvents, type CalEvent } from '@/engine/calendar';
import { mergeCalendarEvents } from '@/engine/macroMerge';
import { evaluatePlan, findPlan } from '@/engine/propfirm';
import { desk } from '@/lib/desk';
import { addDays, etDateKey } from '@/lib/time';
import { useBridge } from './bridge';
import { useJournal } from './journal';
import { useMacro } from './macro';
import { useSettings } from './settings';

/** Cadence du contrôle des catalyseurs proches. */
export const CATALYST_TICK_MS = 30_000;
/** Le rejeu du plan suit le journal et le latent du pont, au plus une fois par période. */
export const PROP_THROTTLE_MS = 2_000;
/** Après un fill d'entrée, le journal a ce délai pour ranger la sortie qui le précède. */
export const DISCIPLINE_SETTLE_MS = 1_500;
/** Fills d'entrée du même compte, instrument et sens à moins de 2 s : une seule entrée (remplissage partiel). */
export const ENTRY_GROUP_MS = 2_000;

/** Journal du lancement en cours. L'époque distingue deux lancements dans les curseurs. */
export const deskEventLog = new DeskEventLog(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);

interface DeskEventsState {
  /** Événements rangés depuis le lancement. */
  count: number;
  last: DeskEvent | null;
  running: boolean;
  /** Abonne le desk aux sources (pont, journal, plan, calendrier). Idempotent ; rend l'arrêt. */
  start: () => () => void;
}

let stop: (() => void) | null = null;

/** Range un événement, le compte et le pousse aux clients de l'orchestrateur. */
export function recordDeskEvent(kind: DeskEventKind, data: Record<string, unknown>): void {
  const event = deskEventLog.push(kind, data);
  useDeskEvents.setState((s) => ({ count: s.count + 1, last: event }));
  // L'orchestrateur ne pousse qu'à ses clients authentifiés ; le main borne type et taille.
  desk?.orchestrator?.broadcast(kind, { seq: event.seq, cursor: `${deskEventLog.epoch}.${event.seq}`, data });
}

/** Plan suivi, rejoué sur le journal, avec le latent du pont : `null` sans plan. */
function trackedPlan(): { input: PropBufferInput; key: string } | null {
  const { planId, planAccount } = useSettings.getState().settings;
  const plan = findPlan(planId);
  if (!plan) return null;
  const { sessions, trades } = useJournal.getState();
  const ev = evaluatePlan(plan, sessions, trades, planAccount || undefined);
  const nt = useBridge.getState().nt;
  const live = nt?.link === 'live' ? nt.accounts.filter((a) => !planAccount || a.name === planAccount) : [];
  const unrealized = live.reduce((sum, a) => sum + (Number.isFinite(a.unrealizedPnl) ? a.unrealizedPnl : 0), 0);
  return {
    input: { planId: plan.id, account: planAccount, maxDrawdown: plan.maxDrawdown, buffer: ev.buffer, floor: ev.floor, balance: ev.balance, unrealized },
    key: `${plan.id}|${plan.version}|${planAccount}`,
  };
}

/**
 * Part restante du drawdown maximal du plan suivi, si `account` est le sien (ou si le plan suit tous les
 * comptes) ; `null` sinon. Lue par le process principal avant chaque ordre proposé par l'agent.
 */
export function trackedPropShare(account: string): number | null {
  const { planAccount } = useSettings.getState().settings;
  if (planAccount && planAccount !== account) return null;
  const tracked = trackedPlan();
  return tracked ? (propLiveBuffer(tracked.input)?.share ?? null) : null;
}

/** Marge du plan suivi : niveau par plan et compte ; le premier rejeu pose le niveau sans alerter. */
function propWatcher(): { check: () => void; dispose: () => void } {
  let key = '';
  let level = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    const tracked = trackedPlan();
    if (!tracked) return;
    const { input, key: nextKey } = tracked;
    if (nextKey !== key) {
      key = nextKey;
      level = propBufferAlert(0, input).level;
      return;
    }
    const r = propBufferAlert(level, input);
    level = r.level;
    if (r.data) recordDeskEvent('prop_buffer', r.data);
  };
  return {
    check: () => {
      if (!timer) timer = setTimeout(run, PROP_THROTTLE_MS);
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Latent du compte suivi ('' = tous), d'après le pont vivant ; 0 hors pont. */
function liveUnrealized(account: string): number {
  const nt = useBridge.getState().nt;
  if (nt?.link !== 'live') return 0;
  return nt.accounts.filter((a) => !account || a.name === account).reduce((sum, a) => sum + (Number.isFinite(a.unrealizedPnl) ? a.unrealizedPnl : 0), 0);
}

/** Perte de la journée CME sur le compte suivi, face à la limite retenue : `null` sans règle ni limite du plan. */
function trackedDailyLoss(now = Date.now()): { input: DailyLossInput; key: string } | null {
  const { planId, planAccount, traderRules } = useSettings.getState().settings;
  const plan = findPlan(planId);
  const limit = dailyLimit(traderRules, plan);
  if (!limit) return null;
  const day = tradingDayNow(now);
  const { sessions, trades } = useJournal.getState();
  const loss = dayLoss({ sessions, trades, day, account: planAccount, unrealized: liveUnrealized(planAccount) });
  return {
    input: { day, account: planAccount, loss: loss.loss, limit: limit.amount, source: limit.source, realized: loss.realized, unrealized: loss.unrealized, ...(plan ? { planId: plan.id } : {}) },
    key: `${day}|${planAccount}|${limit.amount}|${limit.source}`,
  };
}

/** Perte du jour : un niveau par journée, compte et limite ; le premier calcul pose le niveau sans alerter. */
function dailyLossWatcher(): { check: () => void; dispose: () => void } {
  const watch = new ThresholdWatch(dailyLossAlert);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    const tracked = trackedDailyLoss();
    if (!tracked) return;
    const data = watch.step(tracked.key, tracked.input);
    if (data) recordDeskEvent('daily_loss', data);
  };
  return {
    check: () => {
      if (!timer) timer = setTimeout(run, PROP_THROTTLE_MS);
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Catalyseurs majeurs autour d'un instant (veille, jour et lendemain à New York). */
function catalystsAround(at: number) {
  const today = etDateKey(at);
  const days = new Set([addDays(today, -1), today, addDays(today, 1)]);
  const years = new Set([...days].map((d) => Number(d.slice(0, 4))));
  const local = [...years].flatMap((y) => localEvents(y)).filter((e) => days.has(e.date));
  const official = useMacro.getState().events.filter((r) => days.has(r.date));
  return majorCatalysts(mergeCalendarEvents(local, official));
}

/**
 * Discipline à chaque fill d'entrée rangé : dérives après une perte et écarts aux règles, un événement
 * `discipline` par constat. Lecture seule : rien n'est bloqué ni envoyé au pont.
 */
function disciplineWatcher(): { onEvent: (event: DeskEvent) => void; dispose: () => void } {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const lastEntry = new Map<string, number>();
  const seen = new Set<string>();
  const judge = (event: DeskEvent, entry: DisciplineEntry, price: unknown, action: string) => {
    const { traderRules, planId, planAccount } = useSettings.getState().settings;
    const { trades } = useJournal.getState();
    const limit = dailyLimit(traderRules, findPlan(planId));
    const findings = [
      ...detectDrifts([entry], trades, traderRules),
      ...detectRuleBreaches([entry], { rules: traderRules, closed: trades, catalysts: catalystsAround(entry.time), limit, limitAccount: planAccount, unrealized: liveUnrealized(planAccount) }),
    ];
    for (const f of findings) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      recordDeskEvent('discipline', { id: f.id, finding: f.kind, family: f.family, account: f.account, instrument: f.instrument, action, quantity: entry.qty, ...(typeof price === 'number' ? { price } : {}), at: f.at, day: f.day, fillSeq: event.seq, detail: f.detail });
    }
    if (seen.size > 2000) seen.clear();
  };
  return {
    onEvent(event) {
      if (event.kind !== 'fill' || event.data.entryExit !== 'Entry') return;
      const { account, instrument, action, quantity, price } = event.data as { account: string; instrument: string; action: string; quantity: number; price?: number };
      const time = Date.parse(String(event.data.time));
      if (!Number.isFinite(time)) return;
      const group = `${account}|${instrument}|${action}`;
      const prev = lastEntry.get(group);
      lastEntry.set(group, time);
      if (prev !== undefined && Math.abs(time - prev) < ENTRY_GROUP_MS) return;
      const entry: DisciplineEntry = { id: `${deskEventLog.epoch}.${event.seq}`, account, instrument, qty: quantity, time };
      const timer = setTimeout(() => {
        timers.delete(timer);
        judge(event, entry, price, action);
      }, DISCIPLINE_SETTLE_MS);
      timers.add(timer);
    },
    dispose() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}

const localYears = new Map<number, CalEvent[]>();
function localEvents(year: number): CalEvent[] {
  let rows = localYears.get(year);
  if (!rows) {
    rows = generateNasdaqEvents(year);
    localYears.set(year, rows);
  }
  return rows;
}

function checkCatalysts(seen: Set<string>, now = Date.now()): void {
  // Préavis de 15 minutes : le jour et le lendemain (New York) suffisent, inutile de fusionner l'année.
  const today = etDateKey(now);
  const days = new Set([today, addDays(today, 1)]);
  const years = new Set([...days].map((d) => Number(d.slice(0, 4))));
  const local = [...years].flatMap((y) => localEvents(y)).filter((e) => days.has(e.date));
  const official = useMacro.getState().events.filter((r) => days.has(r.date));
  const merged = mergeCalendarEvents(local, official);
  for (const due of dueCatalysts(merged, now, seen)) {
    seen.add(due.id);
    recordDeskEvent('catalyst', due.data);
  }
  if (seen.size > 2000) seen.clear();
}

export const useDeskEvents = create<DeskEventsState>((set) => ({
  count: 0,
  last: null,
  running: false,

  start() {
    if (stop) return stop;
    const disposers: (() => void)[] = [];

    const offExecution = desk?.ntbridge?.onExecution((payload) => {
      const data = fillData(payload.fill);
      if (data) recordDeskEvent('fill', data);
    });
    if (offExecution) disposers.push(offExecution);

    let link = useBridge.getState().nt?.link ?? null;
    const prop = propWatcher();
    disposers.push(prop.dispose);
    disposers.push(
      useBridge.subscribe((s, prev) => {
        const next = s.nt?.link ?? null;
        if (next !== null && next !== link) {
          const data = linkTransition(link, next, s.nt?.addonVersion ?? null);
          if (data) recordDeskEvent('bridge_link', data);
        }
        link = next;
        if (s.nt !== prev.nt) prop.check();
      }),
    );
    disposers.push(
      useJournal.subscribe((s, prev) => {
        if (s.sessions !== prev.sessions || s.trades !== prev.trades) prop.check();
      }),
    );
    disposers.push(
      useSettings.subscribe((s, prev) => {
        if (s.settings.planId !== prev.settings.planId || s.settings.planAccount !== prev.settings.planAccount) prop.check();
      }),
    );
    prop.check();

    // Perte du jour : mêmes déclencheurs que la marge du plan, plus les règles du trader.
    const daily = dailyLossWatcher();
    disposers.push(daily.dispose);
    disposers.push(
      useBridge.subscribe((s, prev) => {
        if (s.nt !== prev.nt) daily.check();
      }),
    );
    disposers.push(
      useJournal.subscribe((s, prev) => {
        if (s.sessions !== prev.sessions || s.trades !== prev.trades) daily.check();
      }),
    );
    disposers.push(
      useSettings.subscribe((s, prev) => {
        const a = s.settings;
        const b = prev.settings;
        if (a.planId !== b.planId || a.planAccount !== b.planAccount || a.traderRules !== b.traderRules) daily.check();
      }),
    );
    daily.check();

    // Discipline : chaque fill d'entrée rangé est jugé une fois le journal à jour.
    const discipline = disciplineWatcher();
    disposers.push(discipline.dispose);
    disposers.push(
      useDeskEvents.subscribe((s, prev) => {
        if (s.last && s.last !== prev.last) discipline.onEvent(s.last);
      }),
    );

    const seen = new Set<string>();
    checkCatalysts(seen);
    const tick = setInterval(() => checkCatalysts(seen), CATALYST_TICK_MS);
    disposers.push(() => clearInterval(tick));

    set({ running: true });
    stop = () => {
      for (const d of disposers.splice(0)) d();
      stop = null;
      set({ running: false });
    };
    return stop;
  },
}));
