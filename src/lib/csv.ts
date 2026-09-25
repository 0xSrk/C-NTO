import { tr } from '@/i18n';

export interface CsvTable {
  delimiter: string;
  headers: string[];
  rows: string[][];
  /** Anomalies structurelles non bloquantes (ex. guillemet non refermé en fin de fichier). */
  warnings: string[];
}

/** Première ligne non vide, sans découper tout le texte (fichiers de plusieurs Mo). */
function firstNonEmptyLine(text: string): string {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    let line = text.slice(start, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.trim().length > 0) return line;
    start = end + 1;
  }
  return '';
}

/** Détecte le délimiteur le plus probable sur la première ligne non vide. */
export function detectDelimiter(text: string): string {
  const firstLine = firstNonEmptyLine(text);
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
    if (c === '"' && field.length === 0) {
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
  const warnings: string[] = [];
  if (inQuotes) {
    warnings.push(tr(
      'Guillemet non refermé en fin de fichier : la dernière ligne peut être incomplète.',
      'Unterminated quote at end of file: the last row may be incomplete.',
      'Comillas sin cerrar al final del archivo: la última fila puede estar incompleta.',
    ));
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { delimiter: delim, headers, rows, warnings };
}

/**
 * Déduit le séparateur décimal d'un échantillon de valeurs numériques (prix de préférence) :
 * une valeur contenant les deux signes tranche par le dernier rencontré ; sinon le seul signe présent.
 */
export function detectDecimalSeparator(samples: string[]): ',' | '.' | undefined {
  let sawDot = false;
  let sawComma = false;
  for (const raw of samples) {
    const s = raw.replace(/[^\d.,]/g, '');
    if (!s) continue;
    const dot = s.lastIndexOf('.');
    const comma = s.lastIndexOf(',');
    if (dot !== -1 && comma !== -1) return comma > dot ? ',' : '.';
    if (dot !== -1) sawDot = true;
    if (comma !== -1) sawComma = true;
  }
  if (sawDot && !sawComma) return '.';
  if (sawComma && !sawDot) return ',';
  return undefined;
}

/** Compte les champs (souvent quotés) qui portent une virgule décimale claire (ex. `"245,50"`). */
export function countCommaDecimals(samples: string[]): number {
  let n = 0;
  for (const raw of samples) {
    const s = raw.trim();
    if (!s) continue;
    // Virgule suivie de 1–2 décimales, sans point : montant fr-FR typique.
    if (/^\(?-?\s*[$€£]?\s*\d{1,3}(?:[ .]\d{3})*,\d{1,2}\s*[$€£]?\s*\)?$/.test(s) || /^\(?-?\d+,\d{1,2}\)?$/.test(s.replace(/\s/g, ''))) n++;
  }
  return n;
}

/**
 * Infère le séparateur décimal en croisant prix et montants (Profit/MAE/MFE/Commission).
 * Si les prix sont entiers mais ≥2 montants quotés portent une virgule, on tranche vers `,`.
 */
export function inferDecimalSeparator(prices: string[], amounts: string[], delimiter: string): ',' | '.' | undefined {
  const fromPrices = detectDecimalSeparator(prices);
  const fromAmounts = detectDecimalSeparator(amounts);
  if (fromPrices === ',' || fromAmounts === ',') {
    if (fromPrices === '.' && fromAmounts === ',' && countCommaDecimals(amounts) >= 2) return ',';
    if (fromPrices === '.') return fromPrices;
    return fromAmounts ?? fromPrices ?? (delimiter === ';' ? ',' : undefined);
  }
  if (fromPrices) return fromPrices;
  if (fromAmounts) return fromAmounts;
  if (countCommaDecimals(amounts) >= 2) return ',';
  return delimiter === ';' ? ',' : undefined;
}

/**
 * Convertit une chaîne numérique localisée en nombre.
 * Gère : "$1,250.50", "1 250,50 $", "(125,00)", "-125.00", "€ 12,5", "1.250,50".
 */
export function parseLocaleNumber(raw: string, decimalSeparator?: ',' | '.'): number {
  let s = raw.trim();
  if (!s) return NaN;
  // Notation scientifique (1e5, 2.5E-3) : refusée plutôt que dépouillée en silence de son exposant.
  if (/\d\s*[eE]\s*[+-]?\d/.test(s)) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Signe en tête, après le symbole monétaire ($-125.00) ou en fin (125.00-)
  if (/^[^\d(]*[-\u2212]/.test(s) || /[-\u2212]\s*[^\d]*$/.test(s)) negative = true;
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
