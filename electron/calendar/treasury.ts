/**
 * TreasuryDirect — adjudications annoncées.
 *
 * URL vérifiée le 2026-09-26 :
 * https://www.treasurydirect.gov/TA_WS/securities/announced?format=json
 * HTTP 200, tableau JSON. Champs utilisés : cusip, securityType, securityTerm,
 * auctionDate (date civile, l'heure du champ est T00:00:00), closingTimeCompetitive
 * (« 11:30 AM », heure de l'Est). Pas de clé.
 * Fiscal Data (api.fiscaldata.treasury.gov) n'est pas appelée : ce n'est pas l'API des adjudications.
 */

import type { AppLocale } from '../locale';
import { inRange, parseClock } from './dates';
import { calendarRow, type CalendarEventRow } from './types';

export const TREASURY_ANNOUNCED_URL = 'https://www.treasurydirect.gov/TA_WS/securities/announced?format=json&pagesize=200';

interface Auction {
  cusip?: string;
  securityType?: string;
  securityTerm?: string;
  auctionDate?: string;
  closingTimeCompetitive?: string;
}

export function parseTreasuryAuctions(raw: unknown): CalendarEventRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CalendarEventRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Auction;
    const date = typeof row.auctionDate === 'string' ? row.auctionDate.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const cusip = (row.cusip ?? '').trim();
    if (!cusip) continue;
    const term = (row.securityTerm ?? row.securityType ?? 'titre').trim();
    const type = (row.securityType ?? '').trim();
    const timeET = row.closingTimeCompetitive ? parseClock(row.closingTimeCompetitive) : undefined;
    out.push(calendarRow('treasury', cusip, {
      date,
      timeET,
      title: `Adjudication ${term}${type ? ` ${type}` : ''}`.replace(/\s+/g, ' ').trim(),
      category: 'adjudication',
      impact: type === 'Bill' ? 1 : 2,
      currency: 'USD',
      estimated: false,
    }));
  }
  return out;
}

export const treasuryAdapter = {
  sourceId: 'treasury' as const,
  async fetch(range: { from: string; to: string }, ctx: { fetch: (input: string, init?: RequestInit) => Promise<Response>; locale: AppLocale }): Promise<CalendarEventRow[]> {
    const res = await ctx.fetch(TREASURY_ANNOUNCED_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Trésor HTTP ${res.status}`);
    const text = await res.text();
    return parseTreasuryAuctions(JSON.parse(text) as unknown).filter((e) => inRange(e.date, range));
  },
};
