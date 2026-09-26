/**
 * Dates et heures des calendriers officiels. Fuseau traité comme une date civile,
 * sans heure locale du poste.
 */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** 0 = dimanche … 6 = samedi, sur la date civile. */
export function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

export function monthIndex(name: string): number | null {
  return MONTHS[name.trim().toLowerCase().replace(/\./g, '')] ?? null;
}

/** « Feb. 11, 2026 », « February 18, 2026 », « September 30 » (année fournie). */
export function parseUsDate(text: string, yearHint?: number): string | null {
  const s = text.trim();
  const full = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(s);
  if (full) {
    const month = monthIndex(full[1] ?? '');
    const year = Number(full[3]);
    if (!month) return null;
    return isoDate(year, month, Number(full[2]));
  }
  const bare = /^([A-Za-z]+)\.?\s+(\d{1,2})$/.exec(s);
  if (bare && yearHint) {
    const month = monthIndex(bare[1] ?? '');
    if (!month) return null;
    return isoDate(yearHint, month, Number(bare[2]));
  }
  return null;
}

/** « 08:30 AM », « 8:30 AM », « 12:00 p.m. », « 11:30 AM ». */
export function parseClock(text: string): string | undefined {
  const m = /(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i.exec(text.trim());
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ?? '00';
  const ap = (m[3] ?? '').replace(/\./g, '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23) return undefined;
  return `${pad2(h)}:${min}`;
}

export function htmlRows(html: string): string[][] {
  const out: string[][] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const cells = [...tr[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      (c[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length) out.push(cells);
  }
  return out;
}

export function inRange(date: string, range: { from: string; to: string }): boolean {
  return date >= range.from && date <= range.to;
}
