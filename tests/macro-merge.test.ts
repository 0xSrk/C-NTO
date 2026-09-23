import { describe, expect, it } from 'vitest';
import { generateNasdaqEvents, type CalEvent } from '@/engine/calendar';
import { categoryFromTitle, mergeCalendarEvents, surpriseTone } from '@/engine/macroMerge';
import type { MacroReleaseRow } from '@/store/db';

describe('macroMerge', () => {
  it('classe les titres Investing vers les catégories Lab', () => {
    expect(categoryFromTitle('U.S. Nonfarm Payrolls')).toBe('emploi');
    expect(categoryFromTitle('U.S. Consumer Price Index (CPI) YoY')).toBe('inflation');
    expect(categoryFromTitle('Fed Interest Rate Decision')).toBe('fed');
    expect(categoryFromTitle('U.S. ISM Manufacturing PMI')).toBe('croissance');
  });

  it('calcule la surprise actual vs forecast', () => {
    expect(surpriseTone('55.6', '54')).toBe('mint');
    expect(surpriseTone('49', '50')).toBe('ember');
    expect(surpriseTone('50', '50')).toBe('amber');
    expect(surpriseTone(undefined, '50')).toBeUndefined();
  });

  it('conserve les FOMC bundled et ajoute les publications Investing', () => {
    const local = generateNasdaqEvents(2026).filter((e) => e.date === '2026-09-16' && /FOMC|emploi|CPI/i.test(e.title));
    const macros: MacroReleaseRow[] = [
      {
        id: 'inv_1',
        date: '2026-09-16',
        timeET: '14:00',
        title: 'Fed Interest Rate Decision',
        currency: 'USD',
        impact: 3,
        forecast: '4.00%',
        previous: '3.75%',
        actual: '4.00%',
        source: 'investing',
        at: '2026-09-16T18:00:00Z',
        syncedAt: 1,
      },
    ];
    const merged = mergeCalendarEvents(local, macros);
    expect(merged.some((e) => e.id === 'inv_1' && e.actual === '4.00%')).toBe(true);
    expect(merged.filter((e) => e.date === '2026-09-16' && e.category === 'fed' && e.source !== 'investing').length).toBeGreaterThan(0);
  });

  it('remplace le NFP estimé par la ligne Investing du même jour', () => {
    const local: CalEvent[] = [
      {
        id: 'ev_nfp_2026-04-03',
        date: '2026-04-03',
        timeET: '08:30',
        title: 'Rapport emploi US (NFP)',
        category: 'emploi',
        impact: 3,
        estimated: true,
        description: 'estimé',
      },
    ];
    const macros: MacroReleaseRow[] = [
      {
        id: 'inv_nfp',
        date: '2026-04-03',
        timeET: '08:30',
        title: 'U.S. Nonfarm Payrolls',
        currency: 'USD',
        impact: 3,
        forecast: '180K',
        previous: '150K',
        actual: '175K',
        source: 'investing',
        at: '2026-04-03T12:30:00Z',
        syncedAt: 1,
      },
    ];
    const merged = mergeCalendarEvents(local, macros);
    const nfp = merged.filter((e) => e.category === 'emploi');
    expect(nfp).toHaveLength(1);
    expect(nfp[0]!.id).toBe('inv_nfp');
    expect(nfp[0]!.estimated).toBe(false);
  });
});
