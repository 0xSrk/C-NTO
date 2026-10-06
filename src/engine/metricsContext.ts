import { eventTypeOf } from '@/engine/ontology/confidence';
import { zonedToUtc, ET_ZONE } from '@/lib/time';
import { atrSeries } from './atr';
import type { Bar } from './bars';
import { sessionKeyOf } from './indicators';
import { cmeSession } from '@/lib/cmeClosed';
import { standardEquivalentQty, standardRoot, exitReasonOf, pointsPerContract } from './tradeUnits';
import type { Session, Trade } from './types';

export type VolCycle = 'expansion' | 'compression' | 'choc' | 'decrue';
export type VolBand = 'basse' | 'moyenne' | 'haute';

export interface DayContext {
  date: string;
  root: string;
  account?: string;
  traded: boolean;
  trades: number;
  contracts: number;
  volCT?: number;
  volMT?: number;
  volLT?: number;
  hv30?: number;
  hv60?: number;
  hv90?: number;
  volCycle?: VolCycle;
  volBand?: VolBand;
  atr14?: number;
  prevClose?: number;
  events: { family: string; timeET: string; impact: 1 | 2 | 3; estimated: boolean }[];
  halfDay: boolean;
  gapAtr?: number;
  dayRange?: number;
  highVsPrevClose?: number;
  lowVsPrevClose?: number;
  openToClose?: number;
}

export interface TradeContext {
  tradeId: string;
  minutesToRelease: number | null;
  straddlesRelease: boolean;
  rankInDay: number;
  afterLoss: boolean;
  sizeVsMedian: number;
  exitReason: 'stop' | 'objectif' | 'manuel' | 'autre';
  pointsPerContract: number;
  rAtr?: number;
}

export interface ContextEvent {
  date: string;
  timeET?: string;
  title: string;
  impact: 1 | 2 | 3;
  estimated: boolean;
}

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Unité, en minutes, à partir de laquelle une barre porte une date civile (barre journalière ou plus). */
export const DAILY_TIMEFRAME = 1440;

/**
 * Date civile d'une barre journalière. Un CSV journalier est lu à minuit **local** (`importBarsCsv`),
 * soit de 11 h UTC la veille (poste à UTC+13) à 11 h UTC le jour même (UTC−11, exclu) : avancer de 13 h
 * puis lire la date UTC rend la date du fichier, quel que soit le fuseau du poste qui relit la série.
 * Une barre datée de l'ouverture de la séance (18 h ET la veille) tombe aussi sur sa séance.
 */
export function dailyBarDate(timeSec: number): string {
  return new Date((timeSec + 13 * 3600) * 1000).toISOString().slice(0, 10);
}

/**
 * Une bougie journalière par séance, dans l'ordre. Les barres intrajournalières sont repliées sur la
 * séance CME (bascule 18 h ET) ; à partir de 1 440 min (`timeframe`), chaque barre garde sa date civile.
 */
export function toDailyBars(bars: readonly Bar[], timeframe?: number): DailyBar[] {
  const dayOf = timeframe != null && timeframe >= DAILY_TIMEFRAME ? dailyBarDate : sessionKeyOf;
  const ordered = [...bars].filter((bar) => Number.isFinite(bar.time)).sort((a, b) => a.time - b.time);
  const map = new Map<string, DailyBar>();
  const dates: string[] = [];
  for (const bar of ordered) {
    const date = dayOf(bar.time);
    const current = map.get(date);
    if (!current) {
      map.set(date, { date, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
      dates.push(date);
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
    }
  }
  return dates.map((date) => map.get(date)!);
}

/** Variance de Garman-Klass d'une séance. Négative ramenée à zéro. */
export function garmanKlassVariance(bar: Pick<DailyBar, 'open' | 'high' | 'low' | 'close'>): number | null {
  if (!(bar.open > 0) || !(bar.high > 0) || !(bar.low > 0) || !(bar.close > 0) || bar.high < bar.low) return null;
  const hl = Math.log(bar.high / bar.low);
  const co = Math.log(bar.close / bar.open);
  const variance = 0.5 * hl * hl - (2 * Math.log(2) - 1) * co * co;
  return Number.isFinite(variance) ? Math.max(0, variance) : null;
}

/**
 * Volatilité annualisée sur les `window` séances qui précèdent `index` (clôture de la veille).
 * Une séance invalide (prix ≤ 0, plus-haut sous le plus-bas) est écartée de la moyenne au lieu d'effacer
 * la fenêtre : elle ne gèle pas le régime. Moins de la moitié de séances valides : pas de volatilité.
 */
export function garmanKlassAnnualized(days: readonly DailyBar[], index: number, window: number): number | undefined {
  if (index < window || window < 1) return undefined;
  let sum = 0;
  let valid = 0;
  for (let i = index - window; i < index; i++) {
    const variance = garmanKlassVariance(days[i]!);
    if (variance == null) continue;
    sum += variance;
    valid += 1;
  }
  if (valid === 0 || valid * 2 < window) return undefined;
  return Math.sqrt((sum / valid) * 252);
}

/** Régime brut, sans délai. Égalité : CT ≤ MT et MT ≤ LT. */
export function rawVolCycle(volCT: number, volMT: number, volLT: number): VolCycle {
  const ctAbove = volCT > volMT;
  const mtAbove = volMT > volLT;
  if (ctAbove && !mtAbove) return 'choc';
  if (ctAbove && mtAbove) return 'expansion';
  if (!ctAbove && mtAbove) return 'decrue';
  return 'compression';
}

/**
 * Un régime nouveau n'est retenu qu'après `confirm` séances consécutives
 * et le régime en place reste au moins `minStay` séances.
 */
export function stabilizeVolCycles(raw: readonly (VolCycle | null)[], confirm = 2, minStay = 5): (VolCycle | null)[] {
  const need = Math.max(1, Math.floor(confirm));
  const stay = Math.max(1, Math.floor(minStay));
  const out: (VolCycle | null)[] = [];
  let current: VolCycle | null = null;
  let held = 0;
  let pending: VolCycle | null = null;
  let pendingN = 0;
  for (const next of raw) {
    if (next == null) {
      out.push(current);
      if (current) held += 1;
      pending = null;
      pendingN = 0;
      continue;
    }
    if (current == null) {
      if (pending === next) pendingN += 1;
      else {
        pending = next;
        pendingN = 1;
      }
      if (pendingN >= need) {
        current = pending;
        held = pendingN;
        pending = null;
        pendingN = 0;
      }
      out.push(current);
      continue;
    }
    if (next === current) {
      held += 1;
      pending = null;
      pendingN = 0;
      out.push(current);
      continue;
    }
    if (pending === next) pendingN += 1;
    else {
      pending = next;
      pendingN = 1;
    }
    if (pendingN >= need && held >= stay) {
      current = next;
      held = pendingN;
      pending = null;
      pendingN = 0;
    } else held += 1;
    out.push(current);
  }
  return out;
}

function average(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null || b == null) return undefined;
  return (a + b) / 2;
}

/** Écart maximal d'entrée et de sortie entre un trade et sa copie sur un autre compte. */
export const COPY_WINDOW_MS = 2_000;

/**
 * Une décision par groupe de copies. Une copie est un trade d'un **autre** compte, même racine, même sens,
 * entrée et sortie à `COPY_WINDOW_MS` au plus du premier trade du groupe : un suiveur en micros ou rempli
 * une seconde plus tard est fusionné. Deux trades d'un même compte ne se fusionnent jamais. Le groupe garde
 * son premier trade (entrée la plus tôt), compté ensuite en équivalent standard.
 */
export function mergeCopies(trades: readonly Trade[]): Trade[] {
  const ordered = [...trades].sort((a, b) => a.entryTime - b.entryTime || a.exitTime - b.exitTime || (a.account ?? '').localeCompare(b.account ?? '') || a.id.localeCompare(b.id));
  const groups: { lead: Trade; root: string; accounts: Set<string> }[] = [];
  for (const trade of ordered) {
    const account = trade.account ?? '';
    const root = standardRoot(trade.instrument);
    const group = groups.find(
      (row) =>
        !row.accounts.has(account) &&
        row.root === root &&
        row.lead.direction === trade.direction &&
        Math.abs(row.lead.entryTime - trade.entryTime) <= COPY_WINDOW_MS &&
        Math.abs(row.lead.exitTime - trade.exitTime) <= COPY_WINDOW_MS,
    );
    if (group) group.accounts.add(account);
    else groups.push({ lead: trade, root, accounts: new Set([account]) });
  }
  return groups.map((row) => row.lead);
}

function releaseMs(date: string, timeET: string | undefined): number | null {
  if (!timeET || !/^\d{2}:\d{2}$/.test(timeET)) return null;
  return zonedToUtc(date, timeET, ET_ZONE);
}

function tertile(value: number, history: readonly number[]): VolBand | undefined {
  if (history.length < 30) return undefined;
  const sorted = [...history].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length / 3)] ?? value;
  const high = sorted[Math.floor((2 * sorted.length) / 3)] ?? value;
  if (value < low) return 'basse';
  if (value < high) return 'moyenne';
  return 'haute';
}

/** Séances d'historique qu'une fiche demande avant d'avoir ses volatilités. */
export const CONTEXT_HISTORY = 90;

export interface MetricsContext {
  /** La dernière fiche a ses `CONTEXT_HISTORY` séances d'historique. */
  sufficient: boolean;
  days: DayContext[];
  trades: TradeContext[];
}

/**
 * Fiche par journée de cotation et par racine, jours sans trade compris.
 * Le seuil se juge fiche par fiche : une fiche précédée de moins de 90 séances a ses volatilités vides,
 * et la longueur de la série ne change jamais une fiche antérieure.
 * Les volatilités et l'ATR utilisés comme cause s'arrêtent à la clôture de la veille.
 */
export function buildMetricsContext(input: {
  root: string;
  bars: readonly Bar[];
  /** Unité des barres, en minutes (`BarSeries.timeframe`). À partir de 1 440 : date civile de chaque barre. */
  timeframe?: number;
  trades: readonly Trade[];
  sessions?: readonly Session[];
  events?: readonly ContextEvent[];
  confirm?: number;
  minStay?: number;
}): MetricsContext {
  const confirm = input.confirm ?? 2;
  const minStay = input.minStay ?? 5;
  const root = standardRoot(input.root);
  const daily = toDailyBars(input.bars, input.timeframe);
  const sufficient = daily.length > CONTEXT_HISTORY;
  const sessionDate = new Map((input.sessions ?? []).map((session) => [session.id, session.date]));
  const mine = input.trades.filter((trade) => standardRoot(trade.instrument) === root && Number.isFinite(trade.pnl));
  const dayOf = (trade: Trade) => sessionDate.get(trade.sessionId) ?? sessionKeyOf(trade.entryTime / 1000);
  const byDate = new Map<string, Trade[]>();
  for (const trade of mine) {
    const date = dayOf(trade);
    const list = byDate.get(date) ?? [];
    list.push(trade);
    byDate.set(date, list);
  }
  const atr = atrSeries(
    daily.map((day, index) => ({ time: index, open: day.open, high: day.high, low: day.low, close: day.close, volume: 0 })),
    14,
  );
  const events = input.events ?? [];
  const volMTHistory: number[] = [];
  const rawCycles: (VolCycle | null)[] = [];
  const drafts: DayContext[] = daily.map((day, index) => {
    const previous = index > 0 ? daily[index - 1] : undefined;
    const enough = index >= CONTEXT_HISTORY;
    const hv5 = enough ? garmanKlassAnnualized(daily, index, 5) : undefined;
    const hv10 = enough ? garmanKlassAnnualized(daily, index, 10) : undefined;
    const hv15 = enough ? garmanKlassAnnualized(daily, index, 15) : undefined;
    const hv30 = enough ? garmanKlassAnnualized(daily, index, 30) : undefined;
    const hv60 = enough ? garmanKlassAnnualized(daily, index, 60) : undefined;
    const hv90 = enough ? garmanKlassAnnualized(daily, index, 90) : undefined;
    const volCT = average(hv5, hv10);
    const volMT = average(hv15, hv30);
    const volLT = average(hv60, hv90);
    const copies = mergeCopies(byDate.get(day.date) ?? []);
    let contracts = 0;
    for (const trade of copies) contracts += standardEquivalentQty(trade);
    const atr14 = atr[index] ?? undefined;
    const prevAtr = index > 0 ? (atr[index - 1] ?? undefined) : undefined;
    const prevClose = previous?.close;
    rawCycles.push(volCT != null && volMT != null && volLT != null ? rawVolCycle(volCT, volMT, volLT) : null);
    const band = volMT != null ? tertile(volMT, volMTHistory.slice(-250)) : undefined;
    if (volMT != null) volMTHistory.push(volMT);
    const session = cmeSession(day.date);
    return {
      date: day.date,
      root,
      traded: copies.length > 0,
      trades: copies.length,
      contracts,
      ...(volCT != null ? { volCT } : {}),
      ...(volMT != null ? { volMT } : {}),
      ...(volLT != null ? { volLT } : {}),
      ...(hv30 != null ? { hv30 } : {}),
      ...(hv60 != null ? { hv60 } : {}),
      ...(hv90 != null ? { hv90 } : {}),
      ...(band != null ? { volBand: band } : {}),
      ...(atr14 != null ? { atr14 } : {}),
      ...(prevClose != null ? { prevClose } : {}),
      events: events
        .filter((event) => event.date === day.date)
        .map((event) => ({ family: eventTypeOf(event.title), timeET: event.timeET ?? '', impact: event.impact, estimated: event.estimated })),
      halfDay: session.earlyCloseMinute != null && !session.closed,
      ...(prevClose != null && prevAtr != null && prevAtr > 0 ? { gapAtr: (day.open - prevClose) / prevAtr } : {}),
      dayRange: day.high - day.low,
      ...(prevClose != null ? { highVsPrevClose: day.high - prevClose, lowVsPrevClose: day.low - prevClose } : {}),
      openToClose: day.close - day.open,
    };
  });
  const cycles = stabilizeVolCycles(rawCycles, confirm, minStay);
  const days = drafts.map((day, index) => {
    const cycle = cycles[index];
    return cycle ? { ...day, volCycle: cycle } : day;
  });
  const dayByDate = new Map(days.map((day, index) => [day.date, { day, index }]));
  const sizes = mine.map((trade) => standardEquivalentQty(trade)).filter((qty) => qty > 0).sort((a, b) => a - b);
  const medianSize = sizes.length === 0 ? 0 : sizes.length % 2 ? sizes[(sizes.length - 1) / 2]! : ((sizes[sizes.length / 2 - 1] ?? 0) + (sizes[sizes.length / 2] ?? 0)) / 2;
  // « Après une perte » : le dernier trade du même compte sorti au plus tard à l'entrée. Un trade encore
  // ouvert à l'entrée ne compte pas, même s'il sort avant le trade lu.
  const exitsByAccount = new Map<string, Trade[]>();
  for (const trade of mine) {
    const account = trade.account ?? '';
    const list = exitsByAccount.get(account) ?? [];
    list.push(trade);
    exitsByAccount.set(account, list);
  }
  for (const list of exitsByAccount.values()) list.sort((a, b) => a.exitTime - b.exitTime || a.id.localeCompare(b.id));
  const afterLoss = new Map<string, boolean>();
  for (const trade of mine) {
    const list = exitsByAccount.get(trade.account ?? '') ?? [];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.exitTime <= trade.entryTime) lo = mid + 1;
      else hi = mid;
    }
    let index = lo - 1;
    while (index >= 0 && list[index]!.id === trade.id) index -= 1;
    const previous = index >= 0 ? list[index] : undefined;
    afterLoss.set(trade.id, previous != null && previous.pnl < 0);
  }
  const ranked = new Map<string, number>();
  const byAccountDay = new Map<string, Trade[]>();
  for (const trade of mine) {
    const key = `${trade.account ?? ''}|${dayOf(trade)}`;
    const list = byAccountDay.get(key) ?? [];
    list.push(trade);
    byAccountDay.set(key, list);
  }
  for (const list of byAccountDay.values()) {
    list.sort((a, b) => a.entryTime - b.entryTime || a.id.localeCompare(b.id));
    list.forEach((trade, index) => ranked.set(trade.id, index + 1));
  }
  const releases = events.filter((event) => !event.estimated && event.impact >= 2);
  const tradesOut: TradeContext[] = mine.map((trade) => {
    const date = dayOf(trade);
    const sheet = dayByDate.get(date);
    const prevAtr = sheet && sheet.index > 0 ? atr[sheet.index - 1] : undefined;
    const points = pointsPerContract(trade);
    let nearest: number | null = null;
    let straddles = false;
    for (const event of releases) {
      const at = releaseMs(event.date, event.timeET);
      if (at == null) continue;
      const minutes = (at - trade.entryTime) / 60_000;
      if (nearest == null || Math.abs(minutes) < Math.abs(nearest)) nearest = minutes;
      if (trade.entryTime < at && at < trade.exitTime) straddles = true;
    }
    const size = standardEquivalentQty(trade);
    return {
      tradeId: trade.id,
      minutesToRelease: nearest,
      straddlesRelease: straddles,
      rankInDay: ranked.get(trade.id) ?? 1,
      afterLoss: afterLoss.get(trade.id) ?? false,
      sizeVsMedian: medianSize > 0 ? size / medianSize : 0,
      exitReason: exitReasonOf(trade.exitName),
      pointsPerContract: points ?? 0,
      ...(points != null && prevAtr != null && prevAtr > 0 ? { rAtr: points / prevAtr } : {}),
    };
  });
  return { sufficient, days, trades: tradesOut };
}
