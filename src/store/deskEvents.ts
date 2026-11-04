import { create } from 'zustand';
import type { DeskEventKind } from '@/engine/agent/catalog';
import { DeskEventLog, dueCatalysts, fillData, linkTransition, orderData, propBufferAlert, propLiveBuffer, type DeskEvent, type PropBufferInput } from '@/engine/agent/events';
import { dailyLossAlert, ThresholdWatch, type DailyLossInput } from '@/engine/agent/events';
import { matchAccount, sameAccount } from '@/engine/accounts';
import { dayCloseFor } from '@/engine/agent/dayClose';
import { AGENT_TRADER_RULES, type AgentTraderRuleBlock } from '@/engine/agent/orders';
import { dailyLimit, dayLoss, detectDrifts, detectRuleBreaches, limitReachedAt, majorCatalysts, tradingDayNow, type DailyLimit, type DisciplineEntry, type DisciplineFinding } from '@/engine/discipline';
import { generateNasdaqEvents, type CalEvent } from '@/engine/calendar';
import { mergeCalendarEvents } from '@/engine/macroMerge';
import { evaluatePlan, findPlan, planMargin } from '@/engine/propfirm';
import { tr } from '@/i18n';
import { desk, type NtBridgeStatus } from '@/lib/desk';
import { cmeClock } from '@/engine/tradingDay';
import { addDays, etDateKey } from '@/lib/time';
import { useBridge } from './bridge';
import { useDayClose } from './dayClose';
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

/** Range un événement, le compte et le pousse aux clients de l'orchestrateur ; rend l'événement rangé (son numéro). */
export function recordDeskEvent(kind: DeskEventKind, data: Record<string, unknown>): DeskEvent {
  const event = deskEventLog.push(kind, data);
  useDeskEvents.setState((s) => ({ count: s.count + 1, last: event }));
  // L'orchestrateur ne pousse qu'à ses clients authentifiés ; le main borne type et taille.
  desk?.orchestrator?.broadcast(kind, { seq: event.seq, cursor: `${deskEventLog.epoch}.${event.seq}`, data });
  return event;
}

/** Plan suivi, rejoué sur le journal, avec le latent du pont : `null` sans plan. */
function trackedPlan(): { input: PropBufferInput; key: string } | null {
  const { planId, planAccount } = useSettings.getState().settings;
  const plan = findPlan(planId);
  if (!plan) return null;
  const { sessions, trades } = useJournal.getState();
  const ev = evaluatePlan(plan, sessions, trades, planAccount || undefined);
  const live = liveAccounts(planAccount);
  const unrealized = live.reduce((sum, a) => sum + (Number.isFinite(a.unrealizedPnl) ? a.unrealizedPnl : 0), 0);
  // Marge datée de la jauge K.04 : la garde de l'agent et l'alerte la lisent comme l'écran (décision 2 de l'ADMIN).
  const dated = planMargin(ev);
  return {
    input: { planId: plan.id, account: planAccount, maxDrawdown: plan.maxDrawdown, buffer: ev.buffer, margin: dated?.margin ?? null, marginDate: dated?.date ?? null, floor: ev.floor, balance: ev.balance, unrealized },
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

/**
 * Comptes du pont vivant que désigne `account` ('' = tous) ; aucun hors pont. Le nom exact d'abord, sinon le nom
 * replié (`matchAccount`) : la règle de `heldPosition` dans le process principal, pour que la marge et la perte du jour
 * transmises à la garde portent le latent du compte qu'elle juge (A18). Les bornes du jour lisent de même.
 */
function liveAccounts(account: string): NtBridgeStatus['accounts'] {
  const nt = useBridge.getState().nt;
  if (nt?.link !== 'live') return [];
  if (!account) return nt.accounts;
  const match = matchAccount(nt.accounts.map((a) => a.name), account);
  const row = match ? nt.accounts.find((a) => a.name === match.name) : undefined;
  return row ? [row] : [];
}

/** Latent du compte suivi ('' = tous), d'après le pont vivant ; 0 hors pont. */
function liveUnrealized(account: string): number {
  return liveAccounts(account).reduce((sum, a) => sum + (Number.isFinite(a.unrealizedPnl) ? a.unrealizedPnl : 0), 0);
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

/**
 * La journée fermée qui vaut pour `account` à `now` (décision 15 de l'ADMIN, 2026-11-03 : « On ferme la journée une fois
 * la limite touchée ») : depuis quand, ou `null`. La plus ancienne de trois lectures : la fermeture retenue au coffre
 * (`useDayClose`, une perte vue au latent comprise), la première sortie de la journée CME qui a porté la perte réalisée à la
 * limite (`limitReachedAt`, sur le compte de la limite), et la perte relue à l'instant (`current`, latent négatif compris).
 * Un gain qui ramène ensuite la perte sous la limite n'y change rien ; la journée CME suivante la lève.
 */
function dayClosedSince(account: string, now: number, current: boolean): number | null {
  const { traderRules, planId, planAccount } = useSettings.getState().settings;
  const since: number[] = [];
  const stored = dayCloseFor(useDayClose.getState().closes, account, now);
  if (stored) since.push(stored.at);
  const limit = dailyLimit(traderRules, findPlan(planId));
  if (limit && (!planAccount || planAccount === account)) {
    const reached = limitReachedAt(useJournal.getState().trades, { day: tradingDayNow(now), account: planAccount, limit: limit.amount, until: now });
    if (reached !== null) since.push(reached);
    if (current) since.push(now);
  }
  return since.length ? Math.min(...since) : null;
}

/** La perte du jour relue à l'instant sur le compte suivi, latent négatif du pont compris, au moins à la limite. */
function dailyLossNow(now: number): boolean {
  const tracked = trackedDailyLoss(now);
  return !!tracked && tracked.input.loss >= tracked.input.limit;
}

/**
 * Depuis quand la journée CME est fermée sur le compte suivi (décision 15), d'après la fermeture retenue et le journal ;
 * `null` : rien de tel. La perte relue à l'instant n'y est pas : la barre d'état la lit d'elle-même (`dayBornes`), sans
 * rejouer la journée à chaque statut du pont.
 */
export function trackedDayClosedSince(now = Date.now()): number | null {
  return dayClosedSince(useSettings.getState().settings.planAccount, now, false);
}

/**
 * Perte de la journée CME à 100 % de la limite retenue, sur le compte suivi : le seuil de l'événement
 * `daily_loss` à 100 %, recalculé du journal, des réglages et du pont (`dayLoss`, `dailyLimit`). Il tient
 * après un redémarrage du desk, quand l'anneau d'événements repart vide. Une fois atteinte, la journée reste fermée
 * jusqu'à la journée CME suivante (décision 15, `dayClosedSince`).
 */
export function dailyLossReached(now = Date.now()): boolean {
  return dailyLossNow(now) || trackedDayClosedSince(now) !== null;
}

/**
 * Retient la journée fermée du compte suivi dès que la perte du jour atteint la limite (décision 15) : au coffre, et au
 * process principal (`useDayClose`, `closeDay`). Depuis la sortie qui l'a portée à la limite, ou depuis maintenant quand le
 * latent l'y porte. Rien ne rouvre ; la veille du desk l'appelle à chaque statut du pont, journal ou réglage, et chaque
 * proposition de l'agent avant de lire la règle.
 */
export function recordDayClose(now = Date.now()): void {
  const { planAccount } = useSettings.getState().settings;
  const tracked = trackedDailyLoss(now);
  if (!tracked) return;
  const since: number[] = [];
  const reached = limitReachedAt(useJournal.getState().trades, { day: tracked.input.day, account: planAccount, limit: tracked.input.limit, until: now });
  if (reached !== null) since.push(reached);
  if (tracked.input.loss >= tracked.input.limit) since.push(now);
  if (since.length) useDayClose.getState().close({ day: tracked.input.day, account: planAccount, at: Math.min(...since) });
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

/** Motif d'une règle enfreinte par une ouverture proposée, dans la langue du desk. */
function ruleDetail(finding: DisciplineFinding): string {
  const d = finding.detail;
  if (finding.kind === 'after_daily_limit') {
    const source = d.source === 'plan' ? tr('plan prop', 'prop plan', 'plan prop') : tr('règle du trader', 'trader rule', 'regla del trader');
    return tr(`perte du jour ${d.loss} $ ≥ limite ${d.limit} $ (${source})`, `day loss ${d.loss} $ ≥ limit ${d.limit} $ (${source})`, `pérdida del día ${d.loss} $ ≥ límite ${d.limit} $ (${source})`);
  }
  if (finding.kind === 'catalyst_window') {
    return tr(`${d.title} à ${d.timeET} ET : pas d’entrée à ± ${d.windowMin} min`, `${d.title} at ${d.timeET} ET: no entry within ± ${d.windowMin} min`, `${d.title} a las ${d.timeET} ET: ninguna entrada a ± ${d.windowMin} min`);
  }
  const allowed = Array.isArray(d.allowed) ? d.allowed.join(', ') : '';
  const symbol = typeof d.symbol === 'string' ? d.symbol : finding.instrument;
  return tr(`${symbol} hors des instruments autorisés (${allowed})`, `${symbol} is not an allowed instrument (${allowed})`, `${symbol} fuera de los instrumentos autorizados (${allowed})`);
}

/**
 * « journée fermée depuis hh:mm ET » (décision 15), à l'heure de New York : la garde, la frise, la barre d'état et le miroir
 * de la garde le disent ainsi, dans la langue du desk.
 */
export function dayClosedText(since: number): string {
  const at = cmeClock(since);
  return tr(`journée fermée depuis ${at} ET`, `day closed since ${at} ET`, `jornada cerrada desde ${at} ET`);
}

/**
 * Le motif de la journée fermée (décision 15) : depuis quand, puis la perte relue si elle tient encore à la limite, sinon
 * la limite atteinte.
 */
function closedDetail(since: number, found: DisciplineFinding | undefined, limit: DailyLimit | null): string {
  const head = `${dayClosedText(since)}${tr(' : ', ': ', ': ')}`;
  if (found) return `${head}${ruleDetail(found)}`;
  if (!limit) return `${head}${tr('perte du jour atteinte', 'day loss reached', 'pérdida del día alcanzada')}`;
  const source = limit.source === 'plan' ? tr('plan prop', 'prop plan', 'plan prop') : tr('règle du trader', 'trader rule', 'regla del trader');
  return `${head}${tr(`limite ${limit.amount} $ atteinte (${source})`, `limit ${limit.amount} $ reached (${source})`, `límite ${limit.amount} $ alcanzado (${source})`)}`;
}

/**
 * Règles du trader qu'une ouverture proposée par l'agent enfreindrait à `now`, toutes, dans l'ordre de la garde
 * (`AGENT_TRADER_RULES`) : perte du jour atteinte, fenêtre d'un catalyseur majeur, instrument hors de la liste
 * (décision 1 de l'ADMIN, 2026-10-06). Même lecture que la veille discipline au fill d'entrée (`detectRuleBreaches`). La
 * perte du jour atteinte ferme la journée CME jusqu'à la suivante, même si un gain la ramène ensuite sous la limite
 * (décision 15, `dayClosedSince`) : la règle dit depuis quand.
 */
export function traderRuleBlocks(proposal: { account: string; instrument: string; qty: number }, now = Date.now()): AgentTraderRuleBlock[] {
  const { traderRules, planId, planAccount } = useSettings.getState().settings;
  const { trades } = useJournal.getState();
  const limit = dailyLimit(traderRules, findPlan(planId));
  const entry: DisciplineEntry = { id: 'proposition', account: proposal.account, instrument: proposal.instrument, qty: proposal.qty, time: now };
  const findings = detectRuleBreaches([entry], { rules: traderRules, closed: trades, catalysts: catalystsAround(now), limit, limitAccount: planAccount, unrealized: liveUnrealized(planAccount) });
  const out: AgentTraderRuleBlock[] = [];
  for (const rule of AGENT_TRADER_RULES) {
    const found = findings.find((f) => f.kind === rule);
    if (rule === 'after_daily_limit') {
      const since = dayClosedSince(proposal.account, now, !!found);
      if (since !== null) out.push({ rule, detail: closedDetail(since, found, limit) });
      continue;
    }
    if (found) out.push({ rule, detail: ruleDetail(found) });
  }
  return out;
}

/**
 * Règle du trader qu'une ouverture proposée par l'agent enfreindrait à `now` : la première de `traderRuleBlocks`.
 * Le process principal la relit (`parseTraderRule`) et refuse l'ouverture.
 */
export function traderRuleFor(proposal: { account: string; instrument: string; qty: number }, now = Date.now()): AgentTraderRuleBlock | null {
  return traderRuleBlocks(proposal, now)[0] ?? null;
}

/* ─── Ce que le renderer transmet à la garde du process principal à chaque proposition (OROS5.9) ─── */

function clip(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Le compte du plan suivi, s'il est celui que désigne `account` (règle de la garde, `sameAccount`) ; sinon `account`. */
function trackedName(account: string): string {
  const { planAccount } = useSettings.getState().settings;
  return planAccount && sameAccount(planAccount, account) ? planAccount : account;
}

/**
 * Marge du plan suivi pour le compte proposé, telle que le renderer la transmet au process principal. Le process
 * principal lit le pont sans tenir compte de la casse ni des espaces (`SimAPEX1` y désigne `SimApex1`) : le compte du
 * plan est reconnu de même (`sameAccount`), sinon la garde de marge sauterait.
 */
export function propShareFor(account: string): number | null {
  return trackedPropShare(trackedName(account));
}

/** La proposition telle que la règle du trader la lit : compte reconnu comme pour la marge, noms bornés, quantité finie. */
function ruleProposal(args: Record<string, unknown>): { account: string; instrument: string; qty: number } {
  const qty = typeof args.qty === 'number' && Number.isFinite(args.qty) ? args.qty : 0;
  return { account: trackedName(clip(args.account, 128)), instrument: clip(args.instrument, 64), qty };
}

/** Règle du trader que l'ouverture enfreindrait, telle que le renderer la transmet au process principal. */
export function traderRuleOf(args: Record<string, unknown>, now = Date.now()): AgentTraderRuleBlock | null {
  return traderRuleFor(ruleProposal(args), now);
}

/** Toutes les règles que l'ouverture enfreindrait, du même calcul que `traderRuleOf` : le miroir de la garde les lit. */
export function traderRulesOf(args: Record<string, unknown>, now = Date.now()): AgentTraderRuleBlock[] {
  return traderRuleBlocks(ruleProposal(args), now);
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

    // Le process principal ne pousse un ordre qu'à un changement d'état (livre des ordres en cours).
    const offOrder = desk?.ntbridge?.onOrder?.((change) => {
      const data = orderData(change);
      if (data) recordDeskEvent('order', data);
    });
    if (offOrder) disposers.push(offOrder);

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

    // La journée fermée (décision 15) : retenue dès que la perte du jour atteint la limite, à chaque statut du pont, journal
    // ou réglage, sans attendre la cadence de l'alerte : un latent qui la touche un instant la ferme.
    const closeDay = () => recordDayClose();
    disposers.push(useBridge.subscribe((s, prev) => s.nt !== prev.nt && closeDay()));
    disposers.push(useJournal.subscribe((s, prev) => (s.sessions !== prev.sessions || s.trades !== prev.trades) && closeDay()));
    disposers.push(
      useSettings.subscribe((s, prev) => {
        const a = s.settings;
        const b = prev.settings;
        if (a.planId !== b.planId || a.planAccount !== b.planAccount || a.traderRules !== b.traderRules || a.userPlans !== b.userPlans) closeDay();
      }),
    );
    closeDay();

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
