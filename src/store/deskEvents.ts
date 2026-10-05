import { create } from 'zustand';
import type { DeskEventKind } from '@/engine/agent/catalog';
import { DeskEventLog, dueCatalysts, fillData, linkTransition, propBufferAlert, type DeskEvent } from '@/engine/agent/events';
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

function record(kind: DeskEventKind, data: Record<string, unknown>): void {
  const event = deskEventLog.push(kind, data);
  useDeskEvents.setState((s) => ({ count: s.count + 1, last: event }));
  // L'orchestrateur ne pousse qu'à ses clients authentifiés ; le main borne type et taille.
  desk?.orchestrator?.broadcast(kind, { seq: event.seq, cursor: `${deskEventLog.epoch}.${event.seq}`, data });
}

/** Marge du plan suivi : niveau par plan et compte ; le premier rejeu pose le niveau sans alerter. */
function propWatcher(): { check: () => void; dispose: () => void } {
  let key = '';
  let level = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    const { planId, planAccount } = useSettings.getState().settings;
    const plan = findPlan(planId);
    if (!plan) return;
    const { sessions, trades } = useJournal.getState();
    const ev = evaluatePlan(plan, sessions, trades, planAccount || undefined);
    const nt = useBridge.getState().nt;
    const live = nt?.link === 'live' ? nt.accounts.filter((a) => !planAccount || a.name === planAccount) : [];
    const unrealized = live.reduce((sum, a) => sum + (Number.isFinite(a.unrealizedPnl) ? a.unrealizedPnl : 0), 0);
    const input = { planId: plan.id, account: planAccount, maxDrawdown: plan.maxDrawdown, buffer: ev.buffer, floor: ev.floor, balance: ev.balance, unrealized };
    const nextKey = `${plan.id}|${plan.version}|${planAccount}`;
    if (nextKey !== key) {
      key = nextKey;
      level = propBufferAlert(0, input).level;
      return;
    }
    const r = propBufferAlert(level, input);
    level = r.level;
    if (r.data) record('prop_buffer', r.data);
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
    record('catalyst', due.data);
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
      if (data) record('fill', data);
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
          if (data) record('bridge_link', data);
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
