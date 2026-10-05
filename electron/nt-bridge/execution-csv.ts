/**
 * Rejoue une exécution WebSocket dans le même CSV que l'export « Executions »,
 * culture invariante. `Time` (epoch ms) est écrit en ISO `Z` pour que le parseur
 * le lise en UTC, pas en heure locale du poste.
 */
import type { ExecutionPayload } from './protocol';

export const EXECUTION_HEADER = 'Instrument,Action,Quantity,Price,Time,ID,E/X,Position,Order ID,Name,Commission,Rate,Account,Connection';

function cell(value: string): string {
  if (!value) return '';
  let v = value;
  const lead = v[0];
  if (lead === '=' || lead === '+' || lead === '-' || lead === '@') v = `'${v}`;
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

export function executionPayloadToCsv(rows: ExecutionPayload[]): string {
  const lines = [EXECUTION_HEADER];
  for (const row of rows) {
    lines.push(
      [
        cell(row.instrument),
        cell(row.action),
        String(row.quantity),
        String(row.price),
        isoUtc(row.time),
        cell(row.id),
        cell(row.entryExit),
        cell(row.position),
        cell(row.orderId),
        cell(row.name),
        String(row.commission),
        String(row.rate),
        cell(row.account),
        cell(row.connection),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** Champs d'une exécution lus par le journal d'événements des agents (`fill`). Pas d'identifiant d'ordre ni de connexion. */
export function executionFill(row: ExecutionPayload): { account: string; instrument: string; action: string; quantity: number; price: number; time: number; entryExit?: string } {
  return {
    account: row.account,
    instrument: row.instrument,
    action: row.action,
    quantity: row.quantity,
    price: row.price,
    time: row.time,
    ...(row.entryExit ? { entryExit: row.entryExit } : {}),
  };
}
