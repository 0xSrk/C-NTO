export interface CsvTable {
  delimiter: string;
  headers: string[];
  rows: string[][];
}

/** Détecte le délimiteur le plus probable sur la première ligne non vide. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const candidates = [';', ',', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Parseur CSV tolérant (guillemets, retours ligne dans les champs, BOM). */
export function parseCsv(text: string, delimiter?: string): CsvTable {
  const src = text.replace(/^\uFEFF/, '');
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim().length > 0)) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim().length > 0)) rows.push(row);
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { delimiter: delim, headers, rows };
}

/**
 * Convertit une chaîne numérique localisée en nombre.
 * Gère : "$1,250.50", "1 250,50 $", "(125,00)", "-125.00", "€ 12,5", "1.250,50".
 */
export function parseLocaleNumber(raw: string, decimalSeparator?: ',' | '.'): number {
  let s = raw.trim();
  if (!s) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^-/.test(s) || /^\u2212/.test(s)) {
    negative = true;
  }
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;

  let dec = decimalSeparator;
  if (!dec) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma === -1 && lastDot === -1) dec = '.';
    else if (lastComma === -1) dec = '.';
    else if (lastDot === -1) {
      // Une seule virgule suivie de 3 chiffres exactement = probable séparateur de milliers
      const after = s.length - lastComma - 1;
      dec = after === 3 && s.split(',').length === 2 && s.length > 4 ? '.' : ',';
    } else dec = lastComma > lastDot ? ',' : '.';
  }

  const thousands = dec === ',' ? '.' : ',';
  s = s.split(thousands).join('');
  if (dec === ',') s = s.replace(',', '.');
  const n = parseFloat(s);
  if (Number.isNaN(n)) return NaN;
  return negative ? -Math.abs(n) : n;
}
