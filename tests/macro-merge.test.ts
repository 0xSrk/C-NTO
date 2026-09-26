import { describe, expect, it } from 'vitest';
import { generateNasdaqEvents, type CalEvent } from '@/engine/calendar';
import { categoryFromTitle, mergeCalendarEvents, surpriseTone } from '@/engine/macroMerge';
import type { CalendarEventRow } from '@/engine/calendarEvents';

describe('macroMerge', () => {
  it('classe les titres vers les catégories', () => {
    expect(categoryFromTitle('U.S. Nonfarm Payrolls')).toBe('emploi');
    expect(categoryFromTitle('U.S. Consumer Price Index (CPI) YoY')).toBe('inflation');
    expect(categoryFromTitle('Fed Interest Rate Decision')).toBe('banque-centrale');
    expect(categoryFromTitle('U.S. ISM Manufacturing PMI')).toBe('croissance');
  });

  it('calcule la surprise actual vs forecast', () => {
    expect(surpriseTone('55.6', '54')).toBe('mint');
    expect(surpriseTone('49', '50')).toBe('ember');
    expect(surpriseTone('50', '50')).toBe('amber');
    expect(surpriseTone(undefined, '50')).toBeUndefined();
  });

  it('ajoute la publication officielle à côté des repères locaux', () => {
    const local = generateNasdaqEvents(2026).filter((e) => e.date === '2026-09-16');
    const macros: CalendarEventRow[] = [
      {
        id: 'fed:fomc-2026-09-16',
        sourceId: 'fed',
        date: '2026-09-16',
        timeET: '14:00',
        title: 'Décision FOMC · taux directeurs',
        category: 'banque-centrale',
        impact: 3,
        instruments: [],
        previous: '3.75%',
        actual: '4.00%',
        estimated: false,
        syncedAt: 1,
      },
    ];
    const merged = mergeCalendarEvents(local, macros);
    expect(merged.some((e) => e.id === 'fed:fomc-2026-09-16' && e.actual === '4.00%')).toBe(true);
  });

  it('remplace le CPI estimé du même jour par la ligne officielle', () => {
    const local: CalEvent[] = [
      {
        id: 'ev_cpi_2026-04-10',
        date: '2026-04-10',
        timeET: '08:30',
        title: 'Inflation CPI',
        category: 'inflation',
        impact: 3,
        estimated: true,
        description: 'estimé',
      },
    ];
    const macros: CalendarEventRow[] = [
      {
        id: 'bls:cpi-2026-04-10',
        sourceId: 'bls',
        date: '2026-04-10',
        timeET: '08:30',
        title: 'Inflation CPI',
        category: 'inflation',
        impact: 3,
        instruments: [],
        actual: '0.3%',
        estimated: false,
        syncedAt: 1,
      },
    ];
    const merged = mergeCalendarEvents(local, macros);
    const cpi = merged.filter((e) => e.category === 'inflation');
    expect(cpi).toHaveLength(1);
    expect(cpi[0]!.id).toBe('bls:cpi-2026-04-10');
    expect(cpi[0]!.estimated).toBe(false);
  });
});
