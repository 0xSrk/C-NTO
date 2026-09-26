import { describe, expect, it } from 'vitest';
import { groupIntoSessions } from '@/engine/import/ninjatrader';
import {
  getInstrument,
  hasInstrument,
  listInstruments,
  microCounterpart,
  registerInstrument,
  resolveSymbol,
  standardCounterpart,
  tradingDayOf,
  type InstrumentSpec,
} from '@/engine/instruments';
import { computeTradeStats } from '@/engine/metrics';
import type { Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { replicatedQty } from '@/store/copier';
import type { CopierAccount } from '@/store/db';

const TABLE: { symbol: string; exchange: InstrumentSpec['exchange']; pointValue: number; tickSize: number; tickValue: number; microOf?: string; rth?: [string, string] }[] = [
  { symbol: 'NQ', exchange: 'CME', pointValue: 20, tickSize: 0.25, tickValue: 5, rth: ['09:30', '16:00'] },
  { symbol: 'MNQ', exchange: 'CME', pointValue: 2, tickSize: 0.25, tickValue: 0.5, microOf: 'NQ', rth: ['09:30', '16:00'] },
  { symbol: 'ES', exchange: 'CME', pointValue: 50, tickSize: 0.25, tickValue: 12.5, rth: ['09:30', '16:00'] },
  { symbol: 'MES', exchange: 'CME', pointValue: 5, tickSize: 0.25, tickValue: 1.25, microOf: 'ES', rth: ['09:30', '16:00'] },
  { symbol: 'RTY', exchange: 'CME', pointValue: 50, tickSize: 0.1, tickValue: 5, rth: ['09:30', '16:00'] },
  { symbol: 'M2K', exchange: 'CME', pointValue: 5, tickSize: 0.1, tickValue: 0.5, microOf: 'RTY', rth: ['09:30', '16:00'] },
  { symbol: 'YM', exchange: 'CBOT', pointValue: 5, tickSize: 1, tickValue: 5, rth: ['09:30', '16:00'] },
  { symbol: 'MYM', exchange: 'CBOT', pointValue: 0.5, tickSize: 1, tickValue: 0.5, microOf: 'YM', rth: ['09:30', '16:00'] },
  { symbol: 'CL', exchange: 'NYMEX', pointValue: 1000, tickSize: 0.01, tickValue: 10, rth: ['09:00', '14:30'] },
  { symbol: 'MCL', exchange: 'NYMEX', pointValue: 100, tickSize: 0.01, tickValue: 1, microOf: 'CL', rth: ['09:00', '14:30'] },
  { symbol: 'GC', exchange: 'COMEX', pointValue: 100, tickSize: 0.1, tickValue: 10, rth: ['08:20', '13:30'] },
  { symbol: 'MGC', exchange: 'COMEX', pointValue: 10, tickSize: 0.1, tickValue: 1, microOf: 'GC', rth: ['08:20', '13:30'] },
  { symbol: '6E', exchange: 'CME', pointValue: 125_000, tickSize: 0.00005, tickValue: 6.25 },
  { symbol: 'M6E', exchange: 'CME', pointValue: 12_500, tickSize: 0.0001, tickValue: 1.25, microOf: '6E' },
];

describe('registre d’instruments', () => {
  it('chaque spec CME : tickValue = pointValue × tickSize', () => {
    for (const row of TABLE) {
      const spec = getInstrument(row.symbol);
      expect(spec.exchange).toBe(row.exchange);
      expect(spec.assetClass).toBe('future');
      expect(spec.currency).toBe('USD');
      expect(spec.pointValue).toBe(row.pointValue);
      expect(spec.tickSize).toBe(row.tickSize);
      expect(spec.tickValue).toBeCloseTo(row.tickValue, 9);
      expect(spec.tickValue).toBeCloseTo(spec.pointValue * spec.tickSize, 9);
      expect(spec.session.zone).toBe('America/New_York');
      expect(spec.session.boundary).toBe('18:00');
      expect(spec.session.days).toEqual([0, 1, 2, 3, 4]);
      expect(spec.specRef).toMatch(/^https:\/\/www\.cmegroup\.com\//);
      if (row.microOf) expect(spec.micro).toEqual({ of: row.microOf, ratio: 10 });
      else expect(spec.micro).toBeUndefined();
      if (row.rth) expect(spec.session.rth).toEqual({ open: row.rth[0], close: row.rth[1] });
      else expect(spec.session.rth).toBeUndefined();
    }
    expect(getInstrument('NQ').defaultCommission).toBeCloseTo(5);
    expect(getInstrument('MNQ').defaultCommission).toBeCloseTo(1.48);
    expect(hasInstrument('cl')).toBe(true);
    expect(hasInstrument('ZB')).toBe(false);
    expect(() => getInstrument('ZB')).toThrow(/inconnu : ZB/);
  });

  it('liste et filtre par classe et par bourse', () => {
    expect(listInstruments({ assetClass: 'future' }).length).toBeGreaterThanOrEqual(14);
    expect(listInstruments({ exchange: 'NYMEX' }).map((s) => s.symbol)).toEqual(['CL', 'MCL']);
    expect(listInstruments({ assetClass: 'forex' })).toEqual([]);
  });

  it('resolveSymbol : racines, mois et casse', () => {
    expect(resolveSymbol('MNQ 12-26')).toEqual({ symbol: 'MNQ', contractMonth: '12-26' });
    expect(resolveSymbol('nqz6')).toEqual({ symbol: 'NQ', contractMonth: 'Z6' });
    expect(resolveSymbol('NQZ26')).toEqual({ symbol: 'NQ', contractMonth: 'Z26' });
    expect(resolveSymbol('ES 03-27')).toEqual({ symbol: 'ES', contractMonth: '03-27' });
    expect(resolveSymbol('MES SEP26')).toEqual({ symbol: 'MES', contractMonth: 'SEP26' });
    expect(resolveSymbol('MNQ SEP26')).toEqual({ symbol: 'MNQ', contractMonth: 'SEP26' });
    expect(resolveSymbol('  esz6 ')).toEqual({ symbol: 'ES', contractMonth: 'Z6' });
    expect(resolveSymbol('CL 11-26')).toEqual({ symbol: 'CL', contractMonth: '11-26' });
    expect(resolveSymbol('mcl 11-26')).toEqual({ symbol: 'MCL', contractMonth: '11-26' });
    expect(resolveSymbol('6E')).toEqual({ symbol: '6E' });
    expect(resolveSymbol('M6E H26')).toEqual({ symbol: 'M6E', contractMonth: 'H26' });
    expect(resolveSymbol('NQ')).toEqual({ symbol: 'NQ' });
    expect(resolveSymbol('XYZ')).toBeNull();
    expect(resolveSymbol('')).toBeNull();
    expect(resolveSymbol('   ')).toBeNull();
    expect(resolveSymbol('NQD')).toBeNull();
    expect(resolveSymbol('ZB 12-26')).toBeNull();
  });

  it('tradingDayOf bascule à 18:00 ET, en heure d’été et en heure d’hiver', () => {
    const nq = getInstrument('NQ');
    const cl = getInstrument('CL');
    expect(tradingDayOf(zonedToUtc('2026-07-15', '17:59', ET_ZONE), nq)).toBe('2026-07-15');
    expect(tradingDayOf(zonedToUtc('2026-07-15', '18:00', ET_ZONE), nq)).toBe('2026-07-16');
    expect(tradingDayOf(zonedToUtc('2026-01-15', '17:59', ET_ZONE), cl)).toBe('2026-01-15');
    expect(tradingDayOf(zonedToUtc('2026-01-15', '18:00', ET_ZONE), cl)).toBe('2026-01-16');
  });

  it('la séance d’un instrument connu ignore la bascule civile', () => {
    const exit = zonedToUtc('2026-07-15', '18:00', ET_ZONE);
    const trade: Trade = {
      id: 't',
      sessionId: '',
      instrument: 'ES',
      direction: 'long',
      qty: 1,
      entryTime: exit - 60_000,
      exitTime: exit,
      entryPrice: 5000,
      exitPrice: 5001,
      pnl: 50,
      commission: 0,
    };
    expect(groupIntoSessions([trade], 0, 'csv')[0]!.date).toBe('2026-07-16');
  });

  it('registerInstrument refuse un doublon et recalcule tickValue', () => {
    expect(() => registerInstrument(getInstrument('NQ'))).toThrow(/NQ/);
    const custom = registerInstrument({
      symbol: 'zz',
      name: 'Contrat de test',
      assetClass: 'future',
      exchange: 'OTHER',
      currency: 'USD',
      pointValue: 3,
      tickSize: 0.5,
      tickValue: 999,
      session: { zone: 'America/New_York', boundary: '18:00', days: [0, 1, 2, 3, 4] },
    });
    expect(custom.symbol).toBe('ZZ');
    expect(custom.tickValue).toBeCloseTo(1.5, 9);
    expect(getInstrument('ZZ').pointValue).toBe(3);
    expect(() => registerInstrument(custom)).toThrow(/ZZ/);
  });

  it('micro et standard passent par le ratio du registre', () => {
    expect(microCounterpart('ES')).toEqual({ symbol: 'MES', ratio: 10 });
    expect(standardCounterpart('MES')).toEqual({ symbol: 'ES', ratio: 10 });
    expect(microCounterpart('MNQ')).toBeNull();
    expect(standardCounterpart('NQ')).toBeNull();
    const follower = (mode: CopierAccount['symbolMap']['mode']): CopierAccount => ({
      id: 'a',
      name: 'S',
      role: 'suiveur',
      ntAccount: 'Sim',
      enabled: true,
      sizing: { mode: 'ratio', value: 1, maxContracts: 100 },
      symbolMap: { mode } as CopierAccount['symbolMap'],
      createdAt: 0,
    });
    expect(replicatedQty({ qty: 2, instrument: 'NQ' }, follower('micro'))).toMatchObject({ qty: 20, instrument: 'MNQ' });
    expect(replicatedQty({ qty: 25, instrument: 'MNQ' }, follower('standard'))).toMatchObject({ qty: 2, instrument: 'NQ' });
    expect(replicatedQty({ qty: 1, instrument: 'CL' }, follower('micro'))).toMatchObject({ qty: 10, instrument: 'MCL' });
    expect(replicatedQty({ qty: 3, instrument: 'GC' }, follower('identique'))).toMatchObject({ qty: 3, instrument: 'GC' });
  });

  it('un instrument hors registre garde le PnL déjà calculé', () => {
    const exit = zonedToUtc('2026-03-02', '10:00', ET_ZONE);
    const trade: Trade = {
      id: 'sil',
      sessionId: 's',
      instrument: 'SIL',
      direction: 'long',
      qty: 1,
      entryTime: exit - 60_000,
      exitTime: exit,
      entryPrice: 30,
      exitPrice: 31,
      pnl: 42,
      commission: 1,
    };
    expect(computeTradeStats([trade]).netPnl).toBe(42);
  });
});
