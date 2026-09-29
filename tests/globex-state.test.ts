import { describe, expect, it } from 'vitest';
import { cmeSession } from '@/lib/cmeClosed';
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

  it('jour férié fermé jusqu’à 18:00 ET seulement', () => {
    expect(globexState(at('2026-09-23', '10:00'), true)).toBe('FERMÉ · FÉRIÉ');
    expect(globexState(at('2026-09-23', '17:59'), true)).toBe('FERMÉ · FÉRIÉ');
    expect(globexState(at('2026-09-23', '18:00'), true)).toBe('ETH');
    expect(globexState(at('2026-09-25', '18:00'), true)).toBe('FERMÉ');
  });

  it('demi-séance : plus de RTH après la clôture anticipée', () => {
    const close = 13 * 60;
    expect(globexState(at('2026-09-23', '12:59'), false, close)).toBe('RTH');
    expect(globexState(at('2026-09-23', '13:00'), false, close)).toBe('ETH');
    expect(globexState(at('2026-11-27', '13:14'), false, 13 * 60 + 15)).toBe('RTH');
    expect(globexState(at('2026-11-27', '13:15'), false, 13 * 60 + 15)).toBe('ETH');
  });

  it('le calendrier local distingue fermeture et clôture anticipée', () => {
    expect(cmeSession('2026-12-25')).toMatchObject({ closed: true });
    expect(globexState(at('2026-12-25', '12:00'), true)).toBe('FERMÉ · FÉRIÉ');
    expect(globexState(at('2026-12-25', '18:00'), true)).toBe('FERMÉ');
    expect(cmeSession('2026-11-26')).toMatchObject({ closed: false, earlyCloseMinute: 13 * 60 });
    expect(cmeSession('2026-11-27')).toMatchObject({ closed: false, earlyCloseMinute: 13 * 60 + 15 });
    const shortened = cmeSession('2026-11-26');
    expect(globexState(at('2026-11-26', '12:00'), shortened.closed, shortened.earlyCloseMinute)).toBe('RTH');
    expect(globexState(at('2026-11-26', '13:00'), shortened.closed, shortened.earlyCloseMinute)).toBe('ETH');
  });
});
