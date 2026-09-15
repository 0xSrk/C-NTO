const usd0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function fmtUsd(v: number | undefined | null, opts: { cents?: boolean; sign?: boolean } = {}): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  const f = (opts.cents ? usd2 : usd0).format(v);
  if (opts.sign && v > 0) return `+${f}`;
  return f;
}

export function fmtNum(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

export function fmtInt(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return num.format(Math.round(v));
}

export function fmtPct(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits).replace('.', ',')} %`;
}

export function fmtRatio(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return '∞';
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
