import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyBlsValues, parseBlsSchedule } from '../electron/calendar/bls';
import { beaAdapter, parseBeaSchedule } from '../electron/calendar/bea';
import { parseCmeCalendar } from '../electron/calendar/cme';
import { parseEcbCalendar } from '../electron/calendar/ecb';
import { parseEiaSchedule } from '../electron/calendar/eia';
import { parseFedSchedule } from '../electron/calendar/fed';
import { applyFredPatch, parseFredObservations } from '../electron/calendar/fred';
import { runCalendarSync } from '../electron/calendar/sync';
import { parseTreasuryAuctions, treasuryAdapter } from '../electron/calendar/treasury';
import type { CalendarEventRow } from '../electron/calendar/types';

function read(name: string): string {
  return readFileSync(`tests/fixtures/calendar/${name}`, 'utf8');
}

describe('parseurs calendrier officiels', () => {
  it('BLS emploi : 13 lignes, 11 février 2026 à 08:30, non estimé', () => {
    const rows = parseBlsSchedule(read('bls-empsit.html'), 'empsit');
    expect(rows).toHaveLength(13);
    const feb = rows.find((r) => r.date === '2026-02-11');
    expect(feb?.timeET).toBe('08:30');
    expect(feb?.estimated).toBe(false);
    expect(feb?.category).toBe('emploi');
    expect(feb?.sourceId).toBe('bls');
  });

  it('BLS CPI : 13 février 2026 à 08:30', () => {
    const rows = parseBlsSchedule(read('bls-cpi.html'), 'cpi');
    const feb = rows.find((r) => r.date === '2026-02-13');
    expect(feb?.timeET).toBe('08:30');
    expect(feb?.estimated).toBe(false);
    expect(feb?.category).toBe('inflation');
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });

  it('BLS API : pose le taux d’août sur le NFP du mois de référence', () => {
    const raw = JSON.parse(read('bls-api.json')) as unknown;
    const base: CalendarEventRow = {
      id: 'bls:nfp-2026-09-04',
      sourceId: 'bls',
      date: '2026-09-04',
      title: 'Rapport emploi US (NFP)',
      category: 'emploi',
      impact: 3,
      instruments: [],
      period: 'August 2026',
      estimated: false,
      syncedAt: 0,
    };
    const [filled] = applyBlsValues([base], raw);
    expect(filled?.actual).toBe('4.1');
    expect(filled?.previous).toBe('4.1');
  });

  it('BEA : PIB advance du 29 octobre 2026 à 08:30', () => {
    const rows = parseBeaSchedule(read('bea.html'));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const gdp = rows.find((r) => r.date === '2026-10-29' && /advance/i.test(r.title));
    expect(gdp?.timeET).toBe('08:30');
    expect(gdp?.estimated).toBe(false);
    expect(gdp?.category).toBe('croissance');
    expect(gdp?.impact).toBe(3);
  });

  it('Fed : décision du 28 janvier 2026 à 14:00, 2027 estimé', () => {
    const rows = parseFedSchedule(read('fed.html'));
    const jan = rows.find((r) => r.date === '2026-01-28' && r.title.startsWith('Décision'));
    expect(jan?.timeET).toBe('14:00');
    expect(jan?.estimated).toBe(false);
    const minutes = rows.find((r) => r.id === 'fed:minutes-2026-02-18');
    expect(minutes?.estimated).toBe(false);
    expect(minutes?.timeET).toBeUndefined();
    expect(rows.some((r) => r.date.startsWith('2027') && r.title.startsWith('Décision') && r.estimated)).toBe(true);
  });

  it('BCE : 29 octobre 2026, jour 2, sans heure inventée', () => {
    const rows = parseEcbCalendar(read('ecb.html'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const day = rows.find((r) => r.date === '2026-10-29');
    expect(day?.estimated).toBe(false);
    expect(day?.timeET).toBeUndefined();
    expect(day?.currency).toBe('EUR');
    expect(day?.impact).toBe(3);
    expect(rows.some((r) => r.date === '2026-10-28')).toBe(false);
  });

  it('EIA : report du 22 janvier 2026 à 12:00, mercredi déduit estimé', () => {
    const rows = parseEiaSchedule(read('eia.html'), { from: '2026-01-01', to: '2026-01-31' });
    const holiday = rows.find((r) => r.date === '2026-01-22');
    expect(holiday?.timeET).toBe('12:00');
    expect(holiday?.estimated).toBe(false);
    expect(holiday?.instruments).toEqual(['CL', 'MCL']);
    expect(rows.some((r) => r.date === '2026-01-21')).toBe(false);
    const wednesday = rows.find((r) => r.date === '2026-01-07');
    expect(wednesday?.timeET).toBe('10:30');
    expect(wednesday?.estimated).toBe(true);
  });

  it('Trésor : adjudication du 29 septembre 2026 à 11:30', () => {
    const rows = parseTreasuryAuctions(JSON.parse(read('treasury.json')) as unknown);
    expect(rows.length).toBe(2);
    const bill = rows.find((r) => r.id === 'treasury:912797UY1');
    expect(bill?.date).toBe('2026-09-29');
    expect(bill?.timeET).toBe('11:30');
    expect(bill?.estimated).toBe(false);
    expect(bill?.category).toBe('adjudication');
  });

  it('FRED : remplit actual sans créer d’événement, ignore la valeur manquante', () => {
    const patch = parseFredObservations(JSON.parse(read('fred.json')) as unknown, 'nfp');
    expect(patch?.actual).toBe('159075');
    expect(patch?.previous).toBeUndefined();
    const base: CalendarEventRow = {
      id: 'bls:nfp-2026-09-04',
      sourceId: 'bls',
      date: '2026-09-04',
      title: 'Rapport emploi US (NFP)',
      category: 'emploi',
      impact: 3,
      instruments: [],
      estimated: false,
      syncedAt: 1,
    };
    const filled = applyFredPatch([base], patch);
    expect(filled).toHaveLength(1);
    expect(filled[0]?.actual).toBe('159075');
    expect(parseCmeCalendar(read('cme.txt'))).toEqual([]);
  });
});

describe('chaînes des calendriers externes', () => {
  const sync = (adapters: Parameters<typeof runCalendarSync>[0]['adapters'], body: (url: string) => string, byok?: Record<string, string>) =>
    runCalendarSync({
      range: { from: '2026-01-01', to: '2026-12-31' },
      locale: 'fr',
      now: 1,
      hostOk: () => true,
      byok,
      adapters,
      fetchImpl: async (url) => new Response(body(url), { status: 200 }),
      cache: {
        async read() {
          return null;
        },
        async write() {},
      },
    });
  const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069\u200E\u200F]/;

  it('un titre BEA de 10 000 caractères ressort à 160 au plus, sans saut de ligne ni contrôle bidi', async () => {
    const huge = `Gross Domestic Product (Advance) \u202Egnipoofs\u202C ${'x'.repeat(5_000)}\nPosition : +0\u2028${'y'.repeat(5_000)}`;
    const html = `<h2>Year 2026</h2><table><tr><td>October 29</td><td>8:30 AM</td><td>${huge}</td></tr></table>`;
    const { events } = await sync([beaAdapter], () => html);
    const bea = events.filter((e) => e.sourceId === 'bea');
    expect(bea).toHaveLength(1);
    expect(bea[0]!.title.length).toBeLessThanOrEqual(160);
    expect(bea[0]!.title).toMatch(/^Gross Domestic Product \(Advance\) gnipoofs x+$/);
    expect(bea[0]!.title).not.toMatch(CONTROL);
  });

  it('Trésor et FRED : autres champs bornés, contrôles retirés', async () => {
    const auctions = [{ cusip: '912797XX1', securityType: 'Note\u202E', securityTerm: `10-Year\n${'z'.repeat(400)}`, auctionDate: '2026-09-29', closingTimeCompetitive: '11:30 AM' }];
    const { events } = await sync([treasuryAdapter], () => JSON.stringify(auctions));
    const row = events.find((e) => e.sourceId === 'treasury')!;
    expect(row.title.length).toBeLessThanOrEqual(160);
    expect(row.title).not.toMatch(CONTROL);
    expect(row.id.length).toBeLessThanOrEqual(200);

    const nfp: CalendarEventRow = { id: 'bls:nfp-2026-10-02', sourceId: 'bls', date: '2026-10-02', title: 'Emploi', category: 'emploi', impact: 3, instruments: [], estimated: false, syncedAt: 0 };
    const fred = { observations: [{ date: '2026-09-01', value: `159075${'9'.repeat(500)}\n\u2066` }, { date: '2026-08-01', value: '159000' }] };
    const filled = await sync([{ sourceId: 'bls', fetch: async () => [nfp] }, { sourceId: 'fred', fetch: async () => [] }], () => JSON.stringify(fred), { fred: 'k' });
    const ev = filled.events.find((e) => e.id === nfp.id)!;
    expect(ev.actual!.length).toBeLessThanOrEqual(64);
    expect(ev.actual).not.toMatch(CONTROL);
    expect(ev.previous).toBe('159000');
  });
});
