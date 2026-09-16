const usd0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const fixedCache = new Map<number, Intl.NumberFormat>();

/** Évite « -0 » : les zéros signés issus des graduations sont ramenés à 0. */
const unsignZero = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);

export function fmtUsd(v: number | undefined | null, opts: { cents?: boolean; sign?: boolean } = {}): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
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
  let f = fixedCache.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
    fixedCache.set(digits, f);
  }
  return f.format(unsignZero(v));
}

export function fmtInt(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return num.format(unsignZero(Math.round(v)));
}

export function fmtPct(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return `${unsignZero(v * 100).toFixed(digits).replace('.', ',')}\u202f%`;
}

export function fmtRatio(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || Number.isNaN(v) || !Number.isFinite(v)) return '—';
  return v.toFixed(digits).replace('.', ',');
}

export function fmtPoints(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')} pts`;
}

export function fmtPrice(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

export function signClass(v: number | undefined | null): 'pos' | 'neg' | 'flat' {
  if (v === undefined || v === null || !Number.isFinite(v) || v === 0) return 'flat';
  return v > 0 ? 'pos' : 'neg';
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
