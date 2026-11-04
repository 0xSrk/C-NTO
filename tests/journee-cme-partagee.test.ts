import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { etClock } from '@/app/objects/index';
import { tradingDayNow } from '@/engine/discipline';
import * as shared from '@/engine/tradingDay';
import { cmeDay } from '@/lib/frise';
import * as time from '@/lib/time';

/**
 * OROS5.48 — la journée CME du desk, une seule définition, partagée avec le process principal : la garde du process
 * principal fermera la journée de l'agent à la même bascule que le desk (décision 15 de l'ADMIN, 2026-11-03).
 */

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const et = (day: string, hhmm: string) => time.zonedToUtc(day, hhmm, time.ET_ZONE);

/** Des instants qui éprouvent la bascule : chaque quart d'heure autour de 17:00–18:30 ET, et les deux changements d'heure. */
function instants(): number[] {
  const out: number[] = [];
  for (const day of ['2026-03-06', '2026-03-08', '2026-03-09', '2026-10-30', '2026-11-01', '2026-11-02', '2026-11-04']) {
    for (let m = 0; m < 24 * 60; m += 15) out.push(et(day, `${time.pad2(Math.floor(m / 60))}:${time.pad2(m % 60)}`));
    out.push(et(day, '17:59') + 59_000, et(day, '18:00'), et(day, '18:00') - 1);
  }
  return out;
}

describe('OROS5.48 · la journée CME du desk, partagée avec le process principal', () => {
  it('une seule définition : la frise, la discipline et src/lib/time lisent celle du moteur', () => {
    expect(time.tradingDayKey).toBe(shared.tradingDayKey);
    expect(time.pad2).toBe(shared.pad2);
    expect(time.dateKeyLocal).toBe(shared.dateKeyLocal);
    expect(time.ET_ZONE).toBe(shared.ET_ZONE);
    for (const ms of instants()) {
      const day = shared.cmeTradingDay(ms);
      expect(tradingDayNow(ms), new Date(ms).toISOString()).toBe(day);
      expect(cmeDay(ms), new Date(ms).toISOString()).toBe(day);
      expect(time.tradingDayKey(ms, 18, time.ET_ZONE)).toBe(day);
    }
    // la bascule : 17:59:59 ET compte pour le jour, 18:00 ET pour le lendemain ; le dimanche 18:30 pour le lundi
    expect(shared.cmeTradingDay(et('2026-11-03', '17:59') + 59_000)).toBe('2026-11-03');
    expect(shared.cmeTradingDay(et('2026-11-03', '18:00'))).toBe('2026-11-04');
    expect(shared.cmeTradingDay(et('2026-11-01', '18:30'))).toBe('2026-11-02');
    expect(shared.CME_DAY_HOUR).toBe(18);
    const source = read('src/lib/time.ts');
    expect(source).not.toMatch(/function (tradingDayKey|zonedParts|pastBoundary|partsFormatter)\b/);
  });

  it('l’heure de New York que le process principal écrira est celle de la frise (etClock)', () => {
    for (const ms of instants()) expect(shared.cmeClock(ms), new Date(ms).toISOString()).toBe(etClock(ms));
    expect(shared.cmeClock(et('2026-10-06', '10:56'))).toBe('10:56');
  });

  it('module partagé avec le process principal : déclaré aux trois endroits, sans import', () => {
    const config = JSON.parse(read('electron/tsconfig.sources.json')) as { files: string[] };
    expect(config.files).toContain('../src/engine/tradingDay.ts');
    expect(read('vitest.config.mts')).toContain("tradingDay: 'src/engine/tradingDay.ts'");
    const declared = read('electron/tradingDay.d.ts');
    const exported = (text: string) => [...text.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]).sort();
    expect(exported(declared)).toEqual(exported(read('src/engine/tradingDay.ts')));
    expect(declared).toContain('export function cmeTradingDay(ms: number): string;');
    expect(declared).toContain('export function cmeClock(ms: number): string;');
    const source = read('src/engine/tradingDay.ts');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
