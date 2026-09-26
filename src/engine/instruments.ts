import { tradingDayKey } from '@/lib/time';

export type AssetClass = 'future' | 'forex' | 'equity' | 'index' | 'commodity' | 'cfd' | 'crypto';
export type Exchange = 'CME' | 'CBOT' | 'NYMEX' | 'COMEX' | 'OTC' | 'OTHER';

export interface SessionTemplate {
  /** Fuseau de référence de la session (IANA) */
  zone: string;
  /** Heure murale (HH:mm, dans `zone`) où la journée de trading bascule */
  boundary: string;
  /** Heures régulières, optionnelles (HH:mm, dans `zone`) */
  rth?: { open: string; close: string };
  /** Jours ouvrés 0..6 (dimanche = 0) où la session ouvre */
  days: number[];
}

export interface InstrumentSpec {
  /** Identifiant canonique : racine sans mois (NQ, MNQ, ES, 6E…) */
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: Exchange;
  /** Devise de règlement des PnL */
  currency: string;
  /** Valeur d'un point entier de prix pour 1 contrat, en `currency` */
  pointValue: number;
  tickSize: number;
  /** = pointValue × tickSize ; calculé, jamais saisi */
  tickValue: number;
  session: SessionTemplate;
  /** Racine du contrat standard si celui-ci est un micro, et ratio (MNQ → { of: 'NQ', ratio: 10 }) */
  micro?: { of: string; ratio: number };
  /** Alias de symboles tels que NinjaTrader les écrit */
  aliases?: string[];
  /** Commission aller-retour indicative par contrat (démo et estimation uniquement) */
  defaultCommission?: number;
  /** Référence de la fiche contrat (URL CME Group) */
  specRef?: string;
}

/** Racine par défaut du desk (séance manuelle, série synthétique). */
export const DEFAULT_FUTURE = 'NQ';

/**
 * Globex : ouverture dimanche 18:00 America/New_York, bascule de journée à cette heure.
 * `days` = jours où la session ouvre (dimanche → jeudi), pas les journées de trading qui en découlent.
 */
const GLOBEX: SessionTemplate = {
  zone: 'America/New_York',
  boundary: '18:00',
  days: [0, 1, 2, 3, 4],
};

const MONTH_CODES = 'FGHJKMNQUVXZ';
const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

const registry = new Map<string, InstrumentSpec>();

function roundTick(pointValue: number, tickSize: number): number {
  return Math.round(pointValue * tickSize * 1e9) / 1e9;
}

/** Enregistre une spec. `tickValue` est recalculé. Refuse un doublon de symbole. */
export function registerInstrument(spec: InstrumentSpec): InstrumentSpec {
  const symbol = spec.symbol.trim().toUpperCase();
  if (!symbol) throw new Error('Instrument sans symbole.');
  if (registry.has(symbol)) throw new Error(`Instrument déjà enregistré : ${symbol}`);
  const stored: InstrumentSpec = { ...spec, symbol, tickValue: roundTick(spec.pointValue, spec.tickSize) };
  registry.set(symbol, stored);
  return stored;
}

function future(spec: Omit<InstrumentSpec, 'assetClass' | 'currency' | 'tickValue' | 'session'> & { rth?: SessionTemplate['rth'] }): void {
  const { rth, ...rest } = spec;
  const session: SessionTemplate = rth ? { ...GLOBEX, rth } : { ...GLOBEX };
  registerInstrument({
    ...rest,
    assetClass: 'future',
    currency: 'USD',
    tickValue: 0,
    session,
  });
}

// Multiplicateurs et ticks : fiches contrat CME Group (voir specRef). tickValue recalculé à l'enregistrement.
// RTH equity 09:30–16:00 ET ; CL/MCL 09:00–14:30 ET ; GC/MGC 08:20–13:30 ET. 6E/M6E : pas de RTH equity.
future({
  symbol: 'NQ',
  name: 'E-mini Nasdaq-100',
  exchange: 'CME',
  pointValue: 20,
  tickSize: 0.25,
  rth: { open: '09:30', close: '16:00' },
  defaultCommission: 2.5 * 2,
  specRef: 'https://www.cmegroup.com/markets/equities/nasdaq/e-mini-nasdaq-100.contractSpecs.html',
});
future({
  symbol: 'MNQ',
  name: 'Micro E-mini Nasdaq-100',
  exchange: 'CME',
  pointValue: 2,
  tickSize: 0.25,
  micro: { of: 'NQ', ratio: 10 },
  rth: { open: '09:30', close: '16:00' },
  defaultCommission: 0.74 * 2,
  specRef: 'https://www.cmegroup.com/markets/equities/nasdaq/micro-e-mini-nasdaq-100.contractSpecs.html',
});
future({
  symbol: 'ES',
  name: 'E-mini S&P 500',
  exchange: 'CME',
  pointValue: 50,
  tickSize: 0.25,
  rth: { open: '09:30', close: '16:00' },
  specRef: 'https://www.cmegroup.com/markets/equities/us-index/e-mini-sandp500.contractSpecs.html',
});
future({
  symbol: 'MES',
  name: 'Micro E-mini S&P 500',
  exchange: 'CME',
  pointValue: 5,
  tickSize: 0.25,
  micro: { of: 'ES', ratio: 10 },
  rth: { open: '09:30', close: '16:00' },
  specRef: 'https://www.cmegroup.com/markets/equities/us-index/micro-e-mini-sandp500.contractSpecs.html',
});
future({
  symbol: 'RTY',
  name: 'E-mini Russell 2000',
  exchange: 'CME',
  pointValue: 50,
  tickSize: 0.1,
  rth: { open: '09:30', close: '16:00' },
  specRef: 'https://www.cmegroup.com/markets/equities/us-index/e-mini-russell-2000.contractSpecs.html',
});
future({
  symbol: 'M2K',
  name: 'Micro E-mini Russell 2000',
  exchange: 'CME',
  pointValue: 5,
  tickSize: 0.1,
  micro: { of: 'RTY', ratio: 10 },
  rth: { open: '09:30', close: '16:00' },
  specRef: 'https://www.cmegroup.com/markets/equities/us-index/micro-e-mini-russell-2000.contractSpecs.html',
});
future({
  symbol: 'YM',
  name: 'E-mini Dow',
  exchange: 'CBOT',
  pointValue: 5,
  tickSize: 1,
  rth: { open: '09:30', close: '16:00' },
  specRef: 'https://www.cmegroup.com/markets/equities/us-index/e-mini-dow.contractSpecs.html',
});
future({
  symbol: 'MYM',
  name: 'Micro E-mini Dow',
  exchange: 'CBOT',
  pointValue: 0.5,
  tickSize: 1,
  micro: { of: 'YM', ratio: 10 },
  rth: { open: '09:30', close: '16:00' },
  specRef: 'https://www.cmegroup.com/markets/equities/us-index/micro-e-mini-dow.contractSpecs.html',
});
future({
  symbol: 'CL',
  name: 'Crude Oil',
  exchange: 'NYMEX',
  pointValue: 1000,
  tickSize: 0.01,
  rth: { open: '09:00', close: '14:30' },
  specRef: 'https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.contractSpecs.html',
});
future({
  symbol: 'MCL',
  name: 'Micro WTI Crude Oil',
  exchange: 'NYMEX',
  pointValue: 100,
  tickSize: 0.01,
  micro: { of: 'CL', ratio: 10 },
  rth: { open: '09:00', close: '14:30' },
  specRef: 'https://www.cmegroup.com/markets/energy/crude-oil/micro-wti-crude-oil.contractSpecs.html',
});
future({
  symbol: 'GC',
  name: 'Gold',
  exchange: 'COMEX',
  pointValue: 100,
  tickSize: 0.1,
  rth: { open: '08:20', close: '13:30' },
  specRef: 'https://www.cmegroup.com/markets/metals/precious/gold.contractSpecs.html',
});
future({
  symbol: 'MGC',
  name: 'Micro Gold',
  exchange: 'COMEX',
  pointValue: 10,
  tickSize: 0.1,
  micro: { of: 'GC', ratio: 10 },
  rth: { open: '08:20', close: '13:30' },
  specRef: 'https://www.cmegroup.com/markets/metals/precious/e-micro-gold.contractSpecs.html',
});
future({
  symbol: '6E',
  name: 'Euro FX',
  exchange: 'CME',
  pointValue: 125_000,
  tickSize: 0.00005,
  specRef: 'https://www.cmegroup.com/markets/fx/g10/euro-fx.contractSpecs.html',
});
future({
  symbol: 'M6E',
  name: 'Micro Euro FX',
  exchange: 'CME',
  pointValue: 12_500,
  tickSize: 0.0001,
  micro: { of: '6E', ratio: 10 },
  specRef: 'https://www.cmegroup.com/markets/fx/g10/e-micro-euro.contractSpecs.html',
});

/** Spec canonique. Erreur explicite si le symbole est absent du registre. */
export function getInstrument(symbol: string): InstrumentSpec {
  const spec = registry.get(symbol.trim().toUpperCase());
  if (!spec) throw new Error(`Instrument inconnu : ${symbol}`);
  return spec;
}

export function hasInstrument(symbol: string): boolean {
  return registry.has(symbol.trim().toUpperCase());
}

export function listInstruments(filter?: { assetClass?: AssetClass; exchange?: Exchange }): InstrumentSpec[] {
  let list = [...registry.values()];
  if (filter?.assetClass) list = list.filter((s) => s.assetClass === filter.assetClass);
  if (filter?.exchange) list = list.filter((s) => s.exchange === filter.exchange);
  return list;
}

function symbolsByLength(): string[] {
  return [...registry.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Mois de contrat tel qu'écrit après la racine : `12-26`, `SEP26`, `Z6`. */
function parseContractMonth(rest: string): string | null {
  const s = rest.trim().toUpperCase();
  if (!s) return null;
  const code = new RegExp(`^([${MONTH_CODES}])(\\d{1,2})$`).exec(s);
  if (code) return `${code[1]}${code[2]}`;
  const num = /^(\d{2})-(\d{2}|\d{4})$/.exec(s);
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= 12) return `${num[1]}-${num[2]}`;
  const name = new RegExp(`^(${MONTH_NAMES.join('|')})\\s?(\\d{2}|\\d{4})$`).exec(s);
  if (name) return `${name[1]}${name[2]}`;
  return null;
}

/**
 * Racine + mois optionnel. Accepte `NQ`, `MNQ 12-26`, `NQZ6`, `NQZ26`, `MNQ SEP26`, `ES 03-27`.
 * Insensible à la casse et aux espaces. `null` si la racine n'est pas au registre.
 */
export function resolveSymbol(raw: string): { symbol: string; contractMonth?: string } | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return null;
  for (const symbol of symbolsByLength()) {
    if (s !== symbol && !s.startsWith(symbol)) continue;
    const rest = s.slice(symbol.length);
    if (!rest) return { symbol };
    if (/^[\s\-_/]/.test(rest)) {
      const month = parseContractMonth(rest.replace(/^[\s\-_/]+/, ''));
      if (month) return { symbol, contractMonth: month };
      continue;
    }
    const month = parseContractMonth(rest);
    if (month) return { symbol, contractMonth: month };
  }
  return null;
}

/** Journée de trading de l'instrument (bascule et fuseau de sa session). */
export function tradingDayOf(ms: number, spec: InstrumentSpec): string {
  const hour = Number(spec.session.boundary.slice(0, 2));
  return tradingDayKey(ms, Number.isFinite(hour) ? hour : 0, spec.session.zone);
}

/** Micro listé pour un contrat standard (`NQ` → MNQ ×10). `null` si déjà micro ou sans micro. */
export function microCounterpart(symbol: string): { symbol: string; ratio: number } | null {
  if (!hasInstrument(symbol)) return null;
  const spec = getInstrument(symbol);
  if (spec.micro) return null;
  const child = listInstruments().find((s) => s.micro?.of === spec.symbol);
  if (!child?.micro) return null;
  return { symbol: child.symbol, ratio: child.micro.ratio };
}

/** Contrat standard d'un micro (`MNQ` → NQ, ratio 10). */
export function standardCounterpart(symbol: string): { symbol: string; ratio: number } | null {
  if (!hasInstrument(symbol)) return null;
  const spec = getInstrument(symbol);
  if (!spec.micro) return null;
  return { symbol: spec.micro.of, ratio: spec.micro.ratio };
}
