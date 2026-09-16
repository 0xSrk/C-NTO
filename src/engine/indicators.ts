import { ET_ZONE } from '@/lib/time';
import type { Bar } from './bars';

export interface IndicatorParam {
  key: string;
  label: string;
  type: 'number' | 'select';
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export interface IndicatorLine {
  key: string;
  label: string;
  color: string;
  lineWidth?: 1 | 2 | 3 | 4;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  /** 'price' = superposé au graphique ; 'pane' = panneau séparé */
  pane: 'price' | 'pane';
  /** Un point sans `value` est un blanc (rupture de ligne entre deux séances). */
  data: { time: number; value?: number }[];
}

export interface IndicatorOutput {
  id: string;
  lines: IndicatorLine[];
}

export interface IndicatorDefinition {
  id: string;
  name: string;
  short: string;
  description: string;
  family: 'tendance' | 'volume' | 'volatilité' | 'niveaux';
  params: IndicatorParam[];
  compute: (bars: Bar[], params: Record<string, number | string>) => IndicatorOutput;
}

export interface IndicatorInstance {
  id: string;
  definitionId: string;
  params: Record<string, number | string>;
  visible: boolean;
}

const etDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

/** Clé de séance Globex (bascule 18:00 ET) pour ancrer les indicateurs de séance. */
export function sessionKeyOf(timeSec: number): string {
  const parts = etDayFormatter.formatToParts(new Date(timeSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour'));
  const d = new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))));
  if (hour >= 18) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const etTimeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: ET_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function etTimeOf(timeSec: number): { hour: number; minute: number } {
  const parts = etTimeFormatter.formatToParts(new Date(timeSec * 1000));
  return { hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24, minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0) };
}

const sessionKeyCache = new WeakMap<Bar[], string[]>();

/** Clés de séance de chaque barre, calculées une fois par tableau (partagées entre indicateurs). */
export function sessionKeys(bars: Bar[]): string[] {
  let keys = sessionKeyCache.get(bars);
  if (!keys) {
    keys = bars.map((b) => sessionKeyOf(b.time));
    sessionKeyCache.set(bars, keys);
  }
  return keys;
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      seed += values[i];
      continue;
    }
    if (i === period - 1) {
      seed += values[i];
      prev = seed / period;
    } else {
      prev = values[i] * k + (prev as number) * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

function toLine(bars: Bar[], values: (number | null)[]): { time: number; value?: number }[] {
  const data: { time: number; value?: number }[] = [];
  let started = false;
  for (let i = 0; i < bars.length; i++) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) {
      data.push({ time: bars[i].time, value: v });
      started = true;
    } else if (started) {
      data.push({ time: bars[i].time });
    }
  }
  return data;
}

const PALETTE = {
  ice: '#8fc7e8',
  gold: '#ffffff',
  mint: '#7fcf9a',
  ember: '#e0776c',
  violet: '#a996e0',
  steel: '#6c6c6c',
};

export const INDICATORS: IndicatorDefinition[] = [
  {
    id: 'ema',
    name: 'Moyenne mobile exponentielle',
    short: 'EMA',
    description: 'Tendance court/moyen terme. Les scalpers Nasdaq surveillent souvent EMA 9 / 21 sur 1–5 min.',
    family: 'tendance',
    params: [{ key: 'period', label: 'Période', type: 'number', default: 21, min: 2, max: 500, step: 1 }],
    compute: (bars, p) => ({
      id: 'ema',
      lines: [{ key: 'ema', label: `EMA ${p.period}`, color: PALETTE.ice, pane: 'price', data: toLine(bars, ema(bars.map((b) => b.close), Number(p.period))) }],
    }),
  },
  {
    id: 'sma',
    name: 'Moyenne mobile simple',
    short: 'SMA',
    description: 'Moyenne arithmétique des clôtures. SMA 200 = référence de tendance long terme.',
    family: 'tendance',
    params: [{ key: 'period', label: 'Période', type: 'number', default: 50, min: 2, max: 500, step: 1 }],
    compute: (bars, p) => ({
      id: 'sma',
      lines: [{ key: 'sma', label: `SMA ${p.period}`, color: PALETTE.gold, pane: 'price', data: toLine(bars, sma(bars.map((b) => b.close), Number(p.period))) }],
    }),
  },
  {
    id: 'vwap',
    name: 'VWAP de séance',
    short: 'VWAP',
    description: 'Prix moyen pondéré par le volume, réinitialisé à chaque séance Globex (18:00 ET). Bandes ±1σ / ±2σ.',
    family: 'volume',
    params: [{ key: 'bands', label: 'Bandes', type: 'select', default: '2', options: [{ value: '0', label: 'Aucune' }, { value: '1', label: '±1σ' }, { value: '2', label: '±1σ et ±2σ' }] }],
    compute: (bars, p) => {
      const vwap: (number | null)[] = [];
      const up1: (number | null)[] = [];
      const dn1: (number | null)[] = [];
      const up2: (number | null)[] = [];
      const dn2: (number | null)[] = [];
      let key = '';
      let pv = 0;
      let vol = 0;
      let pv2 = 0;
      const keys = sessionKeys(bars);
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const k = keys[i];
        if (k !== key) {
          key = k;
          pv = 0;
          vol = 0;
          pv2 = 0;
        }
        const typical = (b.high + b.low + b.close) / 3;
        const v = Math.max(1, b.volume);
        pv += typical * v;
        pv2 += typical * typical * v;
        vol += v;
        const m = pv / vol;
        const variance = Math.max(0, pv2 / vol - m * m);
        const sd = Math.sqrt(variance);
        vwap.push(m);
        up1.push(m + sd);
        dn1.push(m - sd);
        up2.push(m + 2 * sd);
        dn2.push(m - 2 * sd);
      }
      const bands = Number(p.bands);
      const lines: IndicatorLine[] = [{ key: 'vwap', label: 'VWAP', color: PALETTE.gold, lineWidth: 2, pane: 'price', data: toLine(bars, vwap) }];
      if (bands >= 1) {
        lines.push({ key: 'up1', label: '+1σ', color: PALETTE.steel, lineStyle: 'dotted', pane: 'price', data: toLine(bars, up1) });
        lines.push({ key: 'dn1', label: '−1σ', color: PALETTE.steel, lineStyle: 'dotted', pane: 'price', data: toLine(bars, dn1) });
      }
      if (bands >= 2) {
        lines.push({ key: 'up2', label: '+2σ', color: PALETTE.steel, lineStyle: 'dashed', pane: 'price', data: toLine(bars, up2) });
        lines.push({ key: 'dn2', label: '−2σ', color: PALETTE.steel, lineStyle: 'dashed', pane: 'price', data: toLine(bars, dn2) });
      }
      return { id: 'vwap', lines };
    },
  },
  {
    id: 'opening-range',
    name: 'Opening Range (RTH)',
    short: 'OR',
    description: 'Plus haut / plus bas des premières minutes après 9:30 ET. Cassure = signal directionnel classique sur NQ.',
    family: 'niveaux',
    params: [{ key: 'minutes', label: 'Durée (min)', type: 'number', default: 15, min: 5, max: 60, step: 5 }],
    compute: (bars, p) => {
      const minutes = Number(p.minutes);
      const hi: (number | null)[] = [];
      const lo: (number | null)[] = [];
      let key = '';
      let orHigh = -Infinity;
      let orLow = Infinity;
      let orDone = false;
      const keys = sessionKeys(bars);
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const k = keys[i];
        if (k !== key) {
          key = k;
          orHigh = -Infinity;
          orLow = Infinity;
          orDone = false;
        }
        const { hour, minute } = etTimeOf(b.time);
        const minsFromOpen = (hour - 9) * 60 + (minute - 30);
        if (minsFromOpen >= 0 && minsFromOpen < minutes) {
          orHigh = Math.max(orHigh, b.high);
          orLow = Math.min(orLow, b.low);
          hi.push(null);
          lo.push(null);
          continue;
        }
        if (minsFromOpen >= minutes && Number.isFinite(orHigh)) orDone = true;
        if (orDone && hour < 16) {
          hi.push(orHigh);
          lo.push(orLow);
        } else {
          hi.push(null);
          lo.push(null);
        }
      }
      return {
        id: 'opening-range',
        lines: [
          { key: 'orh', label: `OR High ${minutes}m`, color: PALETTE.mint, lineWidth: 1, pane: 'price', data: toLine(bars, hi) },
          { key: 'orl', label: `OR Low ${minutes}m`, color: PALETTE.ember, lineWidth: 1, pane: 'price', data: toLine(bars, lo) },
        ],
      };
    },
  },
  {
    id: 'prev-session',
    name: 'Niveaux séance précédente',
    short: 'PDH/PDL',
    description: 'Plus haut, plus bas et clôture de la séance précédente : supports/résistances suivis par la majorité des intervenants.',
    family: 'niveaux',
    params: [],
    compute: (bars) => {
      const pdh: (number | null)[] = [];
      const pdl: (number | null)[] = [];
      const pdc: (number | null)[] = [];
      let key = '';
      let curHigh = -Infinity;
      let curLow = Infinity;
      let curClose = NaN;
      let prev: { h: number; l: number; c: number } | null = null;
      const keys = sessionKeys(bars);
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const k = keys[i];
        if (k !== key) {
          if (key) prev = { h: curHigh, l: curLow, c: curClose };
          key = k;
          curHigh = -Infinity;
          curLow = Infinity;
        }
        curHigh = Math.max(curHigh, b.high);
        curLow = Math.min(curLow, b.low);
        curClose = b.close;
        pdh.push(prev ? prev.h : null);
        pdl.push(prev ? prev.l : null);
        pdc.push(prev ? prev.c : null);
      }
      return {
        id: 'prev-session',
        lines: [
          { key: 'pdh', label: 'PDH', color: PALETTE.mint, lineStyle: 'dashed', pane: 'price', data: toLine(bars, pdh) },
          { key: 'pdl', label: 'PDL', color: PALETTE.ember, lineStyle: 'dashed', pane: 'price', data: toLine(bars, pdl) },
          { key: 'pdc', label: 'PDC', color: PALETTE.steel, lineStyle: 'dotted', pane: 'price', data: toLine(bars, pdc) },
        ],
      };
    },
  },
  {
    id: 'atr',
    name: 'Average True Range',
    short: 'ATR',
    description: 'Volatilité moyenne par bougie, en points. Sert à dimensionner stops et objectifs.',
    family: 'volatilité',
    params: [{ key: 'period', label: 'Période', type: 'number', default: 14, min: 2, max: 200, step: 1 }],
    compute: (bars, p) => {
      const period = Number(p.period);
      const tr: number[] = bars.map((b, i) => {
        if (i === 0) return b.high - b.low;
        const pc = bars[i - 1].close;
        return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
      });
      const out: (number | null)[] = new Array(bars.length).fill(null);
      let prev: number | null = null;
      let seed = 0;
      for (let i = 0; i < tr.length; i++) {
        if (i < period) {
          seed += tr[i];
          if (i === period - 1) {
            prev = seed / period;
            out[i] = prev;
          }
          continue;
        }
        prev = ((prev as number) * (period - 1) + tr[i]) / period;
        out[i] = prev;
      }
      return { id: 'atr', lines: [{ key: 'atr', label: `ATR ${period}`, color: PALETTE.violet, pane: 'pane', data: toLine(bars, out) }] };
    },
  },
  {
    id: 'volume-ma',
    name: 'Volume relatif',
    short: 'RVOL',
    description: 'Volume de la bougie rapporté à sa moyenne mobile : > 1,5 signale une participation inhabituelle.',
    family: 'volume',
    params: [{ key: 'period', label: 'Période', type: 'number', default: 20, min: 2, max: 200, step: 1 }],
    compute: (bars, p) => {
      const avg = sma(bars.map((b) => b.volume), Number(p.period));
      const rel = bars.map((b, i) => (avg[i] && (avg[i] as number) > 0 ? b.volume / (avg[i] as number) : null));
      return { id: 'volume-ma', lines: [{ key: 'rvol', label: `RVOL ${p.period}`, color: PALETTE.ice, pane: 'pane', data: toLine(bars, rel) }] };
    },
  },
];

export function indicatorById(id: string): IndicatorDefinition | undefined {
  return INDICATORS.find((i) => i.id === id);
}

export function defaultParams(def: IndicatorDefinition): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}
