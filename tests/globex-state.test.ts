import { describe, expect, it } from 'vitest';
import { ET_ZONE, globexState, zonedToUtc } from '@/lib/time';

const at = (date: string, time: string) => zonedToUtc(date, time, ET_ZONE);

describe('globexState', () => {
  it('dimanche 17:59 ET fermé, 18:00 ETH', () => {
    expect(globexState(at('2026-09-27', '17:59'))).toBe('FERMÉ');
    expect(globexState(at('2026-09-27', '18:00'))).toBe('ETH');
  });

  it('mercredi 10:00 RTH, 17:30 fermé (pause), 18:00 ETH', () => {
    expect(globexState(at('2026-09-23', '10:00'))).toBe('RTH');
    expect(globexState(at('2026-09-23', '17:30'))).toBe('FERMÉ');
    expect(globexState(at('2026-09-23', '18:00'))).toBe('ETH');
  });

  it('vendredi 17:00 fermé', () => {
    expect(globexState(at('2026-09-25', '16:59'))).toBe('ETH');
    expect(globexState(at('2026-09-25', '17:00'))).toBe('FERMÉ');
  });

  it('bascule heure d’été (mars) et d’hiver (novembre)', () => {
    expect(globexState(at('2026-03-09', '10:00'))).toBe('RTH');
    expect(globexState(at('2026-03-08', '17:59'))).toBe('FERMÉ');
    expect(globexState(at('2026-03-08', '18:00'))).toBe('ETH');
    expect(globexState(at('2026-11-02', '10:00'))).toBe('RTH');
    expect(globexState(at('2026-11-01', '17:30'))).toBe('FERMÉ');
    expect(globexState(at('2026-11-01', '18:00'))).toBe('ETH');
  });

  it('journée fériée', () => {
    expect(globexState(at('2026-09-23', '10:00'), true)).toBe('FERMÉ · FÉRIÉ');
  });
});
