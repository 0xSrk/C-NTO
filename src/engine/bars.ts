import { detectDecimalSeparator, parseCsv, parseLocaleNumber } from '@/lib/csv';
import { gaussian, mulberry32 } from '@/lib/rng';
import { detectDayFirst, parseFlexibleDateTime, zonedToUtc, ET_ZONE } from '@/lib/time';
import type { Instrument } from './types';

export interface Bar {
  /** epoch secondes (UTC) */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarSeries {
  id: string;
  instrument: Instrument;
  /** en minutes */
  timeframe: number;
  label: string;
  source: 'demo' | 'csv';
  bars: Bar[];
  createdAt: number;
}

/**
 * Génère des bougies synthétiques réalistes du Nasdaq (E-mini) : séance Globex 18:00→17:00 ET,
 * volatilité accrue sur RTH (9:30–16:00 ET) et pics à l'ouverture / clôture, dérive faible.
 */
export function generateDemoBars(opts: { days?: number; timeframe?: number; seed?: number; startPrice?: number; endDate?: string } = {}): Bar[] {
  const days = opts.days ?? 12;
  const tf = opts.timeframe ?? 5;
  const rand = mulberry32(opts.seed ?? 42);
  let price = opts.startPrice ?? 24_180;
  const tick = 0.25;
  const bars: Bar[] = [];
  const end = opts.endDate ? new Date(`${opts.endDate}T12:00:00`) : new Date();
  const dayKeys: string[] = [];
  const cursor = new Date(end);
  while (dayKeys.length < days) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      dayKeys.unshift(`${y}-${m}-${d}`);
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  for (const key of dayKeys) {
    const rthOpen = zonedToUtc(key, '09:30', ET_ZONE) / 1000;
    const rthClose = zonedToUtc(key, '16:00', ET_ZONE) / 1000;
    const sessionStart = rthOpen - 15.5 * 3600;
    const sessionEnd = rthClose + 1 * 3600;
    const dayDrift = gaussian(rand) * 0.0015;
    for (let t = sessionStart; t < sessionEnd; t += tf * 60) {
      const inRth = t >= rthOpen && t < rthClose;
      const minutesFromOpen = (t - rthOpen) / 60;
      const minutesToClose = (rthClose - t) / 60;
      let vol = inRth ? 0.00075 : 0.00025;
      if (inRth && minutesFromOpen < 45) vol *= 1.9;
      if (inRth && minutesToClose < 30) vol *= 1.4;
      const sigma = price * vol * Math.sqrt(tf / 5);
      const open = price;
      const move = gaussian(rand) * sigma + price * (dayDrift / 78);
      const close = Math.round((open + move) / tick) * tick;
      const wick1 = Math.abs(gaussian(rand)) * sigma * 0.6;
      const wick2 = Math.abs(gaussian(rand)) * sigma * 0.6;
      const high = Math.round((Math.max(open, close) + wick1) / tick) * tick;
      const low = Math.round((Math.min(open, close) - wick2) / tick) * tick;
      const baseVolume = inRth ? 9000 : 1200;
      const volume = Math.max(10, Math.round(baseVolume * (0.5 + rand()) * (inRth && minutesFromOpen < 45 ? 1.8 : 1)));
      bars.push({ time: t, open, high, low, close, volume });
      price = close;
    }
  }
  return bars;
}

/** Import de barres OHLCV depuis un CSV (export NinjaTrader « Historical Data » ou générique). */
export function importBarsCsv(text: string): { bars: Bar[]; warnings: string[] } {
  const table = parseCsv(text);
  const warnings: string[] = [];
  const norm = table.headers.map((h) => h.trim().toLowerCase());
  const find = (...names: string[]) => {
    for (const n of names) {
      const i = norm.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  let iTime = find('time', 'date', 'datetime', 'timestamp', 'heure');
  let iOpen = find('open', 'ouverture');
  let iHigh = find('high', 'haut');
  let iLow = find('low', 'bas');
  let iClose = find('close', 'last', 'clôture', 'cloture');
  let iVol = find('volume', 'vol');
  let rows = table.rows;
  // Export NinjaTrader sans en-tête : yyyyMMdd HHmmss;open;high;low;close;volume (ou yyyyMMdd;… en journalier)
  if (iTime === -1 && /^\d{8}(\s\d{6})?$/.test(table.headers[0] ?? '')) {
    rows = [table.headers, ...table.rows];
    iTime = 0;
    iOpen = 1;
    iHigh = 2;
    iLow = 3;
    iClose = 4;
    iVol = 5;
  }
  if (iTime === -1 || iOpen === -1 || iHigh === -1 || iLow === -1 || iClose === -1) {
    return { bars: [], warnings: ['Colonnes attendues : Time/Date, Open, High, Low, Close, (Volume).'] };
  }
  const dec = detectDecimalSeparator(rows.slice(0, 80).map((r) => r[iClose] ?? '')) ?? (table.delimiter === ';' ? ',' : undefined);
  const dayFirst = detectDayFirst(rows.slice(0, 50).map((r) => r[iTime] ?? ''));
  const bars: Bar[] = [];
  let skipped = 0;
  for (const r of rows) {
    const raw = (r[iTime] ?? '').trim();
    let ms: number;
    const nt = /^(\d{4})(\d{2})(\d{2})(?:\s(\d{2})(\d{2})(\d{2}))?$/.exec(raw);
    if (nt) ms = new Date(+(nt[1] ?? 0), +(nt[2] ?? 1) - 1, +(nt[3] ?? 1), +(nt[4] ?? '0'), +(nt[5] ?? '0'), +(nt[6] ?? '0')).getTime();
    else ms = parseFlexibleDateTime(raw, dayFirst);
    const o = parseLocaleNumber(r[iOpen] ?? '', dec);
    const h = parseLocaleNumber(r[iHigh] ?? '', dec);
    const l = parseLocaleNumber(r[iLow] ?? '', dec);
    const c = parseLocaleNumber(r[iClose] ?? '', dec);
    const v = iVol !== -1 ? parseLocaleNumber(r[iVol] ?? '', dec) : 0;
    if (![ms, o, h, l, c].every(Number.isFinite)) {
      skipped++;
      continue;
    }
    bars.push({ time: Math.floor(ms / 1000), open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 });
  }
  bars.sort((a, b) => a.time - b.time);
  const dedup: Bar[] = [];
  for (const b of bars) {
    const last = dedup[dedup.length - 1];
    if (last && last.time === b.time) dedup[dedup.length - 1] = b;
    else dedup.push(b);
  }
  if (skipped) warnings.push(`${skipped} ligne(s) ignorée(s).`);
  return { bars: dedup, warnings };
}
