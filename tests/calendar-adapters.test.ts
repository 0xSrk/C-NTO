import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyBlsValues, parseBlsSchedule } from '../electron/calendar/bls';
import { parseBeaSchedule } from '../electron/calendar/bea';
import { parseCmeCalendar } from '../electron/calendar/cme';
import { parseEcbCalendar } from '../electron/calendar/ecb';
import { parseEiaSchedule } from '../electron/calendar/eia';
import { parseFedSchedule } from '../electron/calendar/fed';
import { applyFredPatch, parseFredObservations } from '../electron/calendar/fred';
import { parseTreasuryAuctions } from '../electron/calendar/treasury';
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
