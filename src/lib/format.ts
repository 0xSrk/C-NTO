import { intlTag } from '@/i18n';

let cacheTag = '';
let usd0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
let usd2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 });
let num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const fixedCache = new Map<string, Intl.NumberFormat>();

function formats(): void {
  const tag = intlTag();
  if (tag === cacheTag) return;
  cacheTag = tag;
  usd0 = new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
  usd2 = new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  num = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
  fixedCache.clear();
}

/** Formateur à décimales fixes, mis en cache par langue et précision (construire un Intl.NumberFormat coûte ~50 µs). */
function fixedFormatter(digits: number): Intl.NumberFormat {
  formats();
  const key = `${cacheTag}|${digits}`;
  let f = fixedCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(cacheTag, { maximumFractionDigits: digits, minimumFractionDigits: digits });
    fixedCache.set(key, f);
  }
  return f;
}

/** Évite « -0 » : les zéros signés issus des graduations sont ramenés à 0. */
const unsignZero = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);

export function fmtUsd(v: number | undefined | null, opts: { cents?: boolean; sign?: boolean } = {}): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  formats();
  const n = unsignZero(opts.cents ? v : Math.round(v));
  const f = (opts.cents ? usd2 : usd0).format(n);
  if (opts.sign && n > 0) return `+${f}`;
  return f;
}

/** « 1 séance », « 12 séances » — accord automatique. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${Math.abs(n) >= 2 ? many : one}`;
}

export function fmtNum(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return fixedFormatter(digits).format(unsignZero(v));
}

export function fmtInt(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  formats();
  return num.format(unsignZero(Math.round(v)));
}

export function fmtPct(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  const body = fixedFormatter(digits).format(unsignZero(v * 100));
  return `${body} %`;
}

export function fmtRatio(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || Number.isNaN(v) || !Number.isFinite(v)) return '—';
  return fixedFormatter(digits).format(v);
}

export function fmtPoints(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')} pts`;
}

export function fmtPrice(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return fixedFormatter(2).format(v);
}

/** Identité du formateur en cache — exposé pour les tests (vérifie la réutilisation). */
export function fixedFormatterForTest(digits: number): Intl.NumberFormat {
  return fixedFormatter(digits);
}

export function signClass(v: number | undefined | null): 'pos' | 'neg' | 'flat' {
  if (v === undefined || v === null || !Number.isFinite(v) || v === 0) return 'flat';
  return v > 0 ? 'pos' : 'neg';
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
