import { describe, expect, it } from 'vitest';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { mergeOfficialRows } from '@/engine/macroMerge';

function row(partial: Partial<CalendarEventRow> & Pick<CalendarEventRow, 'id' | 'sourceId' | 'title' | 'date'>): CalendarEventRow {
  return {
    category: 'emploi',
    impact: 3,
    instruments: [],
    estimated: false,
    syncedAt: 1,
    ...partial,
  };
}

describe('fusion calendrier', () => {
  it('même NFP vu par BLS et Forex Factory : une ligne, actual officiel, forecast FF', () => {
    const merged = mergeOfficialRows([
      row({
        id: 'forexfactory:nfp',
        sourceId: 'forexfactory',
        date: '2026-04-03',
        timeET: '08:30',
        title: 'Nonfarm Payrolls',
        forecast: '180K',
        previous: '1',
        actual: '999K',
      }),
      row({
        id: 'bls:nfp-2026-04-03',
        sourceId: 'bls',
        date: '2026-04-03',
        timeET: '08:30',
        title: 'Rapport emploi US (NFP)',
        actual: '175K',
        previous: '150K',
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('bls:nfp-2026-04-03');
    expect(merged[0]?.actual).toBe('175K');
    expect(merged[0]?.previous).toBe('150K');
    expect(merged[0]?.forecast).toBe('180K');
  });

  it('même NFP vu par le bundle et par BLS : la ligne BLS gagne', () => {
    const merged = mergeOfficialRows([
      row({
        id: 'bundle:bls:nfp-2026-04-03',
        sourceId: 'bundle',
        origin: 'bls',
        date: '2026-04-03',
        timeET: '08:30',
        title: 'Rapport emploi US (NFP)',
        previous: '1',
      }),
      row({
        id: 'bls:nfp-2026-04-03',
        sourceId: 'bls',
        date: '2026-04-03',
        timeET: '08:30',
        title: 'Rapport emploi US (NFP)',
        actual: '175K',
        previous: '150K',
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('bls:nfp-2026-04-03');
    expect(merged[0]?.actual).toBe('175K');
    expect(merged[0]?.sourceId).toBe('bls');
  });

  it('un NFP seulement embarqué est servi tel quel', () => {
    const merged = mergeOfficialRows([
      row({
        id: 'bundle:bls:nfp-2026-04-03',
        sourceId: 'bundle',
        origin: 'bls',
        date: '2026-04-03',
        timeET: '08:30',
        title: 'Rapport emploi US (NFP)',
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('bundle:bls:nfp-2026-04-03');
    expect(merged[0]?.sourceId).toBe('bundle');
    expect(merged[0]?.origin).toBe('bls');
  });

  it('un consensus Forex Factory seul ne crée pas d’événement', () => {
    const merged = mergeOfficialRows([
      row({
        id: 'forexfactory:seul',
        sourceId: 'forexfactory',
        date: '2026-04-03',
        title: 'Nonfarm Payrolls',
        forecast: '180K',
      }),
    ]);
    expect(merged).toEqual([]);
  });
});
