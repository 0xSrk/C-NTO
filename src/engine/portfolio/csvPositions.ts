import { isIsoCurrency } from './types';

export interface PositionCsvRow {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currency: string;
  lastPrice?: number;
}

function col(headers: readonly string[], name: string): number {
  return headers.findIndex((h) => h.trim().toLowerCase() === name);
}

function num(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Colonnes `symbol, quantity, avgPrice, currency` et `lastPrice` optionnel.
 * Le découpage du fichier reste celui de `parseCsv` : ici on ne fait que lire le tableau.
 */
export function mapPositionCsv(headers: readonly string[], rows: readonly (readonly string[])[]): { rows: PositionCsvRow[]; rejected: number } {
  const iSymbol = col(headers, 'symbol');
  const iQty = col(headers, 'quantity');
  const iAvg = col(headers, 'avgprice');
  const iCcy = col(headers, 'currency');
  const iLast = col(headers, 'lastprice');
  if (iSymbol < 0 || iQty < 0 || iAvg < 0 || iCcy < 0) return { rows: [], rejected: rows.length };
  const out: PositionCsvRow[] = [];
  let rejected = 0;
  for (const row of rows) {
    const symbol = (row[iSymbol] ?? '').trim();
    const quantity = num(row[iQty]);
    const avgPrice = num(row[iAvg]);
    const currency = (row[iCcy] ?? '').trim().toUpperCase();
    const lastRaw = iLast >= 0 ? (row[iLast] ?? '').trim() : '';
    const lastPrice = lastRaw === '' ? undefined : num(lastRaw);
    if (!symbol || symbol.length > 32 || quantity == null || avgPrice == null || !isIsoCurrency(currency) || (lastRaw !== '' && lastPrice == null)) {
      rejected++;
      continue;
    }
    const item: PositionCsvRow = { symbol, quantity, avgPrice, currency };
    if (lastPrice != null) item.lastPrice = lastPrice;
    out.push(item);
  }
  return { rows: out, rejected };
}
