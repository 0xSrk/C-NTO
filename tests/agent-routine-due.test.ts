import { describe, expect, it } from 'vitest';
import { cmeSession } from '@/lib/cmeClosed';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { routineDue, type RoutineDueContext } from '@/engine/agent/routineDue';

const at = (date: string, time: string) => zonedToUtc(date, time, ET_ZONE);
const ctx = (over: Partial<RoutineDueContext> = {}): RoutineDueContext => ({ tradesToday: 0, dailyLossFull: false, ...over });

describe('A12.1 quand proposer le brief et le débrief', () => {
  const tuesday = '2026-10-06';

  it('propose le brief un matin de séance, entre 8 h 30 et 9 h 30, heure de New York', () => {
    expect(cmeSession(tuesday).closed).toBe(false);
    expect(routineDue(at(tuesday, '08:29'), ctx()).brief).toBe(false);
    expect(routineDue(at(tuesday, '08:30'), ctx())).toMatchObject({ day: tuesday, brief: true, debrief: false });
    expect(routineDue(at(tuesday, '09:30'), ctx()).brief).toBe(true);
    expect(routineDue(at(tuesday, '09:31'), ctx()).brief).toBe(false);
  });

  it('ne propose rien le samedi, le dimanche matin, ni un jour fermé', () => {
    expect(routineDue(at('2026-10-10', '08:45'), ctx({ tradesToday: 3, dailyLossFull: true }))).toMatchObject({ brief: false, debrief: false });
    expect(routineDue(at('2026-10-11', '08:45'), ctx({ tradesToday: 3, dailyLossFull: true }))).toMatchObject({ brief: false, debrief: false });
    expect(cmeSession('2026-12-25').closed).toBe(true);
    expect(routineDue(at('2026-12-25', '08:45'), ctx({ tradesToday: 2, dailyLossFull: true }))).toMatchObject({ brief: false, debrief: false });
  });

  it('propose le débrief après 16 h 15 s’il y a des trades, ou dès un daily_loss à 100 %', () => {
    expect(routineDue(at(tuesday, '16:14'), ctx({ tradesToday: 4 }))).toMatchObject({ debrief: false, brief: false });
    expect(routineDue(at(tuesday, '16:15'), ctx({ tradesToday: 4 }))).toMatchObject({ day: tuesday, debrief: true, brief: false });
    expect(routineDue(at(tuesday, '16:40'), ctx()).debrief).toBe(false);
    expect(routineDue(at(tuesday, '11:02'), ctx({ dailyLossFull: true }))).toMatchObject({ debrief: true, brief: false });
    expect(routineDue(at(tuesday, '16:20'), ctx({ tradesToday: 1, dailyLossFull: true })).debrief).toBe(true);
  });

  it('une seule proposition par routine et par journée CME', () => {
    const morning = routineDue(at(tuesday, '08:45'), ctx());
    expect(morning.brief).toBe(true);
    expect(routineDue(at(tuesday, '09:00'), ctx({ seen: { brief: morning.day } })).brief).toBe(false);
    const close = routineDue(at(tuesday, '16:20'), ctx({ tradesToday: 2 }));
    expect(close.debrief).toBe(true);
    expect(routineDue(at(tuesday, '16:50'), ctx({ tradesToday: 2, seen: { debrief: close.day } })).debrief).toBe(false);
    const next = routineDue(at('2026-10-07', '08:40'), ctx({ seen: { brief: tuesday } }));
    expect(next.day).toBe('2026-10-07');
    expect(next.brief).toBe(true);
  });

  it('A12.7 minutes entamées, pas arrondies : 8 h 29 min 30 s n’ouvre pas le brief, 16 h 14 min 30 s pas le débrief', () => {
    expect(routineDue(at(tuesday, '08:29') + 30_000, ctx()).brief).toBe(false);
    expect(routineDue(at(tuesday, '08:29') + 59_999, ctx()).brief).toBe(false);
    expect(routineDue(at(tuesday, '08:30'), ctx()).brief).toBe(true);
    expect(routineDue(at(tuesday, '09:30') + 59_000, ctx()).brief).toBe(true);
    expect(routineDue(at(tuesday, '09:31'), ctx()).brief).toBe(false);
    expect(routineDue(at(tuesday, '16:14') + 30_000, ctx({ tradesToday: 2 })).debrief).toBe(false);
    expect(routineDue(at(tuesday, '16:15'), ctx({ tradesToday: 2 })).debrief).toBe(true);
  });

  it('A12.7 garde du soir : à 20 h ET la journée CME a basculé, des trades du jour ne proposent pas le débrief à l’horloge', () => {
    expect(routineDue(at(tuesday, '17:30'), ctx({ tradesToday: 3 }))).toEqual({ day: tuesday, brief: false, debrief: true });
    expect(routineDue(at(tuesday, '20:00'), ctx({ tradesToday: 3 }))).toEqual({ day: '2026-10-07', brief: false, debrief: false });
    expect(routineDue(at(tuesday, '23:59'), ctx({ tradesToday: 3 })).debrief).toBe(false);
    // La perte du jour atteinte le propose encore, pour la journée CME en cours.
    expect(routineDue(at(tuesday, '20:00'), ctx({ tradesToday: 3, dailyLossFull: true }))).toEqual({ day: '2026-10-07', brief: false, debrief: true });
  });
});
