import { describe, expect, it } from 'vitest';
import { TABS } from '@/app/tabs';

describe('rail', () => {
  it('ordonne les modules et laisse le copieur hors rail', () => {
    expect(TABS.map((tab) => tab.id)).toEqual(['metrique', 'visual', 'calendrier', 'note', 'portefeuille', 'agent', 'bot']);
    expect(TABS.map((tab) => tab.index)).toEqual(['01', '02', '03', '04', '05', '06', '07']);
    expect(TABS.some((tab) => tab.id === 'copieur')).toBe(false);
  });

  it('le raccourci 5 mène à Portefeuille', () => {
    const digit = 5;
    expect(TABS[digit - 1]?.id).toBe('portefeuille');
    expect(TABS[4]?.index.slice(-1)).toBe('5');
  });
});
