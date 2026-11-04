import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dexie est remplacé par une coquille : les tables du coffre sont en mémoire.
vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = {
        stores() {
          return chain;
        },
        upgrade() {
          return chain;
        },
      };
      return chain;
    }
    on() {}
    close() {}
    async transaction(_mode: string, _tables: unknown, fn: () => Promise<void>) {
      return fn();
    }
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

import { dayBornes, replayBornes } from '@/engine/bornes';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { DEFAULT_TRADER_RULES, majorCatalysts } from '@/engine/discipline';
import { catalystLabel, catalystSource, estimateMark, familyKey } from '@/engine/macroMerge';
import { ontologyEvents, type Link } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { db, type Note } from '@/store/db';

/** OROS5.13 : une seule source du catalyseur, celle du Calendrier — repères locaux et lignes officielles fusionnés. */

function memTable<T extends { id: string }>() {
  const rows = new Map<string, T>();
  return {
    rows,
    async put(row: T) {
      rows.set(row.id, row);
    },
    async get(id: string) {
      return rows.get(id);
    },
    async delete(id: string) {
      rows.delete(id);
    },
    async bulkPut(list: T[]) {
      for (const row of list) rows.set(row.id, row);
    },
    async bulkDelete(ids: string[]) {
      for (const id of ids) rows.delete(id);
    },
    async toArray() {
      return [...rows.values()];
    },
  };
}

const notes = memTable<Note>();
const sessions = memTable<Session>();
const trades = memTable<Trade>();
const calendarEvents = memTable<CalendarEventRow>();
const links = memTable<Link>();
Object.assign(db as unknown as Record<string, unknown>, { notes, sessions, trades, calendarEvents, links });

const { useLinks } = await import('@/store/links');

const DAY = '2026-10-14';
const et = (time: string, date = DAY) => zonedToUtc(date, time, ET_ZONE);
const SESSION: Session = { id: 's14', date: DAY, account: 'Sim101', instruments: ['MNQ'], source: 'manuel', tradeCount: 1, pnl: -40, grossProfit: 0, grossLoss: -40, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
const TRADE: Trade = { id: 't14', sessionId: 's14', instrument: 'MNQ', account: 'Sim101', direction: 'long', qty: 1, entryTime: et('09:38'), exitTime: et('09:50'), entryPrice: 1, exitPrice: 1, pnl: -40, commission: 0 };

const row = (over: Partial<CalendarEventRow> & Pick<CalendarEventRow, 'id' | 'sourceId' | 'title'>): CalendarEventRow => ({ date: DAY, timeET: '08:30', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: 1, ...over });
/** Le CPI de l'instantané embarqué, et son jumeau publié par le BLS. */
const BUNDLE_CPI = row({ id: 'bundle:bls:cpi-2026-10', sourceId: 'bundle', origin: 'bls', title: 'Inflation CPI (US)' });
const BLS_CPI = row({ id: 'bls:cpi-2026-10-14', sourceId: 'bls', title: 'Consumer Price Index' });
const LOCAL_CPI = 'ev_cpi_2026-10-14';

const pendant = (from: string) => [...links.rows.values()].filter((l) => l.predicate === 'pendant' && `${l.from.type}:${l.from.id}` === from && l.kind !== 'rejete');

async function recompute(rows: CalendarEventRow[]) {
  calendarEvents.rows.clear();
  for (const r of rows) calendarEvents.rows.set(r.id, r);
  await useLinks.getState().recompute();
}

beforeEach(() => {
  for (const table of [notes, sessions, trades, calendarEvents, links]) table.rows.clear();
  sessions.rows.set(SESSION.id, SESSION);
  trades.rows.set(TRADE.id, TRADE);
  useLinks.setState({ links: [], ready: true });
});

describe('OROS5.13 · un catalyseur, un objet', () => {
  it('un CPI embarqué et son jumeau officiel donnent un seul objet et un seul lien « pendant »', async () => {
    await recompute([BUNDLE_CPI, BLS_CPI]);
    // un seul lien de la séance, un seul du trade, vers la ligne officielle qui l'emporte
    expect(pendant('session:s14').map((l) => l.to.id)).toEqual([BLS_CPI.id]);
    expect(pendant('trade:t14').map((l) => l.to.id)).toEqual([BLS_CPI.id]);
    // et la source de l'ontologie n'a qu'un CPI ce jour-là : ni l'embarqué, ni l'estimé local
    const cpis = ontologyEvents([BUNDLE_CPI, BLS_CPI], { notes: [], sessions: [SESSION], trades: [TRADE] }).filter((e) => e.date === DAY && familyKey(e.title) === 'cpi');
    expect(cpis.map((e) => e.id)).toEqual([BLS_CPI.id]);
    // c'est la source du Calendrier : la même fusion, les mêmes objets
    expect(catalystSource([BUNDLE_CPI, BLS_CPI], [2026]).filter((e) => e.date === DAY && familyKey(e.title) === 'cpi').map((e) => e.id)).toEqual([BLS_CPI.id]);
  });

  it('hors ligne, la séance du 14.10 garde son lien : l’estimé local du CPI', async () => {
    await recompute([]);
    expect(pendant('session:s14').map((l) => l.to.id)).toContain(LOCAL_CPI);
    expect(pendant('trade:t14').map((l) => l.to.id)).toContain(LOCAL_CPI);
    // seulement l'instantané embarqué (le desk hors réseau) : il remplace l'estimé, et le lien suit
    await recompute([BUNDLE_CPI]);
    expect(pendant('session:s14').map((l) => l.to.id).filter((id) => id.includes('cpi'))).toEqual([BUNDLE_CPI.id]);
  });

  it('un estimé est marqué « ≈ », jusque dans la borne du prochain catalyseur', () => {
    const offline = ontologyEvents([], { notes: [], sessions: [SESSION], trades: [TRADE] });
    const local = offline.find((e) => e.id === LOCAL_CPI)!;
    expect(local).toMatchObject({ estimated: true, source: 'local', title: 'Inflation CPI' });
    expect(estimateMark(local)).toBe('≈');
    expect(catalystLabel(local)).toBe('≈ Inflation CPI');
    const official = catalystSource([BLS_CPI], [2026]).find((e) => e.id === BLS_CPI.id)!;
    expect(estimateMark(official)).toBe('');
    expect(catalystLabel(official)).toBe('Consumer Price Index');
    // la borne du prochain catalyseur majeur, hors ligne le 14.10 à 07:00 ET : l'estimé, dit tel
    const catalysts = majorCatalysts(catalystSource([], [2026]));
    expect(catalysts.find((c) => c.date === DAY && c.title === 'Inflation CPI')?.estimated).toBe(true);
    const replay = replayBornes({ sessions: [], trades: [], account: '', plan: null, rules: DEFAULT_TRADER_RULES });
    const bornes = dayBornes(replay, { now: et('07:00'), link: 'absent', accounts: [], catalysts, calendarSources: 'offline' });
    expect(bornes.catalyst).toMatchObject({ title: 'Inflation CPI', date: DAY, estimated: true, partial: true });
    const published = dayBornes(replay, { now: et('07:00'), link: 'absent', accounts: [], catalysts: majorCatalysts(catalystSource([BLS_CPI], [2026])) });
    expect(published.catalyst).toMatchObject({ title: 'Consumer Price Index', estimated: false });
  });

  it('le recalcul de l’ontologie reste idempotent, et un lien passe de l’estimé à l’officiel sans doublon', async () => {
    await recompute([]);
    const first = [...links.rows.values()].sort((a, b) => a.id.localeCompare(b.id));
    await recompute([]);
    expect([...links.rows.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual(first);
    expect(useLinks.getState().links).toEqual(first);
    // la publication arrive : le lien quitte l'estimé pour l'officiel, une seule fois
    await recompute([BLS_CPI]);
    const second = [...links.rows.values()].sort((a, b) => a.id.localeCompare(b.id));
    expect(pendant('session:s14').map((l) => l.to.id).filter((id) => id.includes('cpi'))).toEqual([BLS_CPI.id]);
    await recompute([BLS_CPI]);
    expect([...links.rows.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual(second);
  });
});
