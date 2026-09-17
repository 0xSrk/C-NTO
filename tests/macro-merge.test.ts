import { describe, expect, it } from 'vitest';
import { generateNasdaqEvents } from '@/engine/calendar';
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

  it('remplace les estimations locales par les publications Investing du même jour', () => {
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
    expect(merged.filter((e) => e.date === '2026-09-16' && e.category === 'fed' && e.source !== 'investing').length).toBe(0);
  });
});
