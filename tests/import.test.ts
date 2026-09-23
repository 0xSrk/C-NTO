import { describe, expect, it } from 'vitest';
import { detectFormat, detectInstrument, exportTradesCsv, importTradesCsv } from '@/engine/import/ninjatrader';
import { CSV_WORKER_MIN_LINES, csvLineCount } from '@/engine/import';
import { detectDecimalSeparator, parseCsv, parseLocaleNumber } from '@/lib/csv';
import { ET_ZONE, nthWeekdayOfMonth, parseFlexibleDateTime, tradingDayKey, zonedToUtc } from '@/lib/time';

describe('parseLocaleNumber', () => {
  it('lit les formats US et FR', () => {
    expect(parseLocaleNumber('$1,250.50')).toBeCloseTo(1250.5);
    expect(parseLocaleNumber('1 250,50 $', ',')).toBeCloseTo(1250.5);
    expect(parseLocaleNumber('(125.00)')).toBeCloseTo(-125);
    expect(parseLocaleNumber('($125.00)')).toBeCloseTo(-125);
    expect(parseLocaleNumber('-37,5', ',')).toBeCloseTo(-37.5);
    expect(parseLocaleNumber('1.250,50')).toBeCloseTo(1250.5);
    expect(parseLocaleNumber('20125.25')).toBeCloseTo(20125.25);
    expect(parseLocaleNumber('20125,25')).toBeCloseTo(20125.25);
    expect(parseLocaleNumber('$-125.00')).toBeCloseTo(-125);
    expect(parseLocaleNumber('125.00-')).toBeCloseTo(-125);
    expect(parseLocaleNumber('')).toBeNaN();
  });

  it('déduit le séparateur décimal des prix', () => {
    expect(detectDecimalSeparator(['20000.25', '20010.50'])).toBe('.');
    expect(detectDecimalSeparator(['20 000,25', '20 010,50'])).toBe(',');
    expect(detectDecimalSeparator(['1.250,50'])).toBe(',');
    expect(detectDecimalSeparator(['20000', '20010'])).toBeUndefined();
  });
});

describe('parseFlexibleDateTime', () => {
  it('lit les cultures fr-FR, en-US et ISO', () => {
    const fr = parseFlexibleDateTime('15/09/2026 15:31:02', true);
    expect(new Date(fr).getDate()).toBe(15);
    expect(new Date(fr).getMonth()).toBe(8);
    expect(new Date(fr).getHours()).toBe(15);
    const us = parseFlexibleDateTime('9/15/2026 3:31:02 PM', false);
    expect(new Date(us).getDate()).toBe(15);
    expect(new Date(us).getHours()).toBe(15);
    const iso = parseFlexibleDateTime('2026-09-15 09:31:02');
    expect(new Date(iso).getHours()).toBe(9);
    const auto = parseFlexibleDateTime('25/03/2026 10:00:00');
    expect(new Date(auto).getMonth()).toBe(2);
    expect(new Date(parseFlexibleDateTime('2026-09-15 3:31:02 PM')).getHours()).toBe(15);
    expect(new Date(parseFlexibleDateTime('9/15/2026 3:31:02 p.m.', false)).getHours()).toBe(15);
    expect(new Date(parseFlexibleDateTime('9/15/2026 12:05:00 a.m.', false)).getHours()).toBe(0);
    expect(parseFlexibleDateTime('2026-09-15T13:31:02Z')).toBe(Date.UTC(2026, 8, 15, 13, 31, 2));
    expect(parseFlexibleDateTime('2026-09-15T15:31:02+02:00')).toBe(Date.UTC(2026, 8, 15, 13, 31, 2));
    expect(parseFlexibleDateTime('31/13/2026 10:00')).toBeNaN();
  });

  it('bascule la journée de trading à 18:00 heure de New York quand un fuseau est fourni', () => {
    const afternoonEt = zonedToUtc('2026-09-14', '13:00', ET_ZONE);
    const eveningEt = zonedToUtc('2026-09-14', '18:30', ET_ZONE);
    expect(tradingDayKey(afternoonEt, 18, ET_ZONE)).toBe('2026-09-14');
    expect(tradingDayKey(eveningEt, 18, ET_ZONE)).toBe('2026-09-15');
    expect(nthWeekdayOfMonth(2026, 2, 5, 5)).toBe('2026-02-27');
  });
});

describe('parseCsv', () => {
  it('détecte le séparateur et gère les guillemets', () => {
    const t = parseCsv('a;b;c\n1;"x;y";3\n');
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['a', 'b', 'c']);
    expect(t.rows[0]).toEqual(['1', 'x;y', '3']);
    const stray = parseCsv('a,b\n1,5" pouces\n2,x\n');
    expect(stray.rows.length).toBe(2);
    expect(stray.rows[0]![1]).toBe('5" pouces');
  });

  it('csvLineCount déclenche le Worker au-delà de 5000 lignes', () => {
    expect(csvLineCount('a')).toBe(1);
    expect(csvLineCount('a\nb\n')).toBe(3);
    expect(CSV_WORKER_MIN_LINES).toBe(5000);
  });
});

const NT_EN = `Trade-#,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. net profit,Commission,MAE,MFE,ETD,Bars
1,NQ 12-26,Sim101,,Long,1,20000.00,20010.00,9/15/2026 9:35:00 AM,9/15/2026 9:42:00 AM,Entry,Exit,$200.00,$200.00,$4.50,$45.00,$220.00,$20.00,7
2,NQ 12-26,Sim101,,Short,2,20050.00,20060.00,9/15/2026 10:05:00 AM,9/15/2026 10:15:00 AM,Entry,Exit,($400.00),($200.00),$9.00,$400.00,$40.00,$440.00,10
3,MNQ 12-26,Sim101,,Long,5,20100.00,20120.00,9/16/2026 9:40:00 AM,9/16/2026 9:50:00 AM,Entry,Exit,$200.00,$0.00,$3.70,$50.00,$210.00,$10.00,10
4,ES 12-26,Sim101,,Long,1,5000.00,5010.00,9/16/2026 9:40:00 AM,9/16/2026 9:50:00 AM,Entry,Exit,$500.00,$500.00,$4.50,$50.00,$210.00,$10.00,10
`;

const NT_FR = `Trade-#;Instrument;Account;Strategy;Market pos.;Qty;Entry price;Exit price;Entry time;Exit time;Entry name;Exit name;Profit;Cum. net profit;Commission;MAE;MFE;ETD;Bars
1;NQ 12-26;Apex-50K;;Long;1;20 000,00;20 010,00;15/09/2026 15:35:00;15/09/2026 15:42:00;Entry;Exit;200,00 $;200,00 $;4,50 $;45,00 $;220,00 $;20,00 $;7
2;MNQ 12-26;Apex-50K;;Short;3;20 050,00;20 040,00;15/09/2026 16:05:00;15/09/2026 16:15:00;Entry;Exit;60,00 $;260,00 $;2,22 $;30,00 $;66,00 $;6,00 $;10
`;

describe('importTradesCsv', () => {
  it('reconnaît un export NinjaTrader en-US, recalcule le PnL et ignore les instruments hors Nasdaq', () => {
    const r = importTradesCsv(NT_EN);
    expect(r.format).toBe('ninjatrader-trades');
    expect(r.trades.length).toBe(3);
    expect(r.skipped).toBe(1);
    const t1 = r.trades[0]!;
    const t2 = r.trades[1]!;
    const t3 = r.trades[2]!;
    expect(t1.instrument).toBe('NQ');
    expect(t1.direction).toBe('long');
    expect(t1.pnl).toBeCloseTo(200 - 4.5);
    expect(t1.mae).toBeCloseTo(45);
    expect(t2.direction).toBe('short');
    expect(t2.pnl).toBeCloseTo(-400 - 9);
    expect(t3.instrument).toBe('MNQ');
    expect(t3.pnl).toBeCloseTo(20 * 5 * 2 - 3.7);
    expect(r.sessions.length).toBe(2);
    expect(r.sessions[0]!.date).toBe('2026-09-15');
    expect(r.sessions[0]!.tradeCount).toBe(2);
    expect(r.sessions[0]!.pnl).toBeCloseTo(195.5 - 409);
    expect(r.sessions[1]!.date).toBe('2026-09-16');
    expect(new Date(t1.entryTime).getHours()).toBe(9);
  });

  it('reconnaît un export en culture fr-FR (point-virgule, virgule décimale, jj/mm/aaaa)', () => {
    const r = importTradesCsv(NT_FR);
    expect(r.format).toBe('ninjatrader-trades');
    expect(r.trades.length).toBe(2);
    expect(r.trades[0]!.entryPrice).toBe(20000);
    expect(r.trades[0]!.pnl).toBeCloseTo(195.5);
    expect(r.trades[1]!.pnl).toBeCloseTo(10 * 3 * 2 - 2.22);
    expect(r.trades[1]!.account).toBe('Apex-50K');
    expect(new Date(r.trades[0]!.entryTime).getMonth()).toBe(8);
    expect(new Date(r.trades[0]!.entryTime).getDate()).toBe(15);
    expect(r.sessions.length).toBe(1);
  });

  it('rejette un fichier inconnu avec un message clair', () => {
    const r = importTradesCsv('foo,bar\n1,2\n');
    expect(r.format).toBe('inconnu');
    expect(r.warnings[0]).toMatch(/NinjaTrader/);
  });

  it('exporte puis réimporte au format CΛNTO', () => {
    const r = importTradesCsv(NT_EN);
    const csv = exportTradesCsv(r.trades);
    const headers = csv.split('\n')[0]!.split(',');
    expect(detectFormat(headers)).toBe('ninjatrader-trades');
    const again = importTradesCsv(csv, { source: 'csv' });
    expect(again.trades.length).toBe(3);
    expect(again.trades.map((t) => t.pnl)).toEqual(r.trades.map((t) => t.pnl));
    expect(again.sessions[0]!.source).toBe('csv');
  });

  it('préfixe les cellules qui commencent par un caractère de formule', () => {
    const r = importTradesCsv(NT_EN);
    r.trades[0]!.strategy = '=cmd|calc';
    r.trades[0]!.account = '+evil';
    r.trades[1]!.entryName = '@load';
    const csv = exportTradesCsv(r.trades);
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain("'+evil");
    expect(csv).toContain("'@load");
    const plain = importTradesCsv(NT_EN);
    expect(exportTradesCsv(plain.trades)).not.toContain("'NQ");
  });
});

describe('unités et réconciliation', () => {
  it('ne déduit pas deux fois une petite commission quand Profit est net', () => {
    const csv = `Trade-#,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. net profit,Commission,MAE,MFE,ETD,Bars
1,MNQ 12-26,Sim101,,Long,1,20000.00,20010.00,9/15/2026 9:35:00 AM,9/15/2026 9:42:00 AM,Entry,Exit,$19.50,$19.50,$0.50,$5.00,$22.00,$2.50,7
`;
    const r = importTradesCsv(csv);
    expect(r.trades[0]!.pnl).toBeCloseTo(19.5);
    const again = importTradesCsv(exportTradesCsv(r.trades));
    expect(again.trades[0]!.pnl).toBeCloseTo(19.5);
  });

  it('convertit MAE/MFE exprimés en ticks ou en points selon la colonne Profit', () => {
    const ticks = `Trade-#,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. net profit,Commission,MAE,MFE,ETD,Bars
1,NQ 12-26,Sim101,,Long,1,20000.00,20010.00,9/15/2026 9:35:00 AM,9/15/2026 9:42:00 AM,Entry,Exit,40,40,4.50,9,44,4,7
`;
    const t = importTradesCsv(ticks).trades[0]!;
    expect(t.mae).toBeCloseTo(45);
    expect(t.mfe).toBeCloseTo(220);
    const points = ticks.replace(',40,40,4.50,9,44,4,7', ',10,10,4.50,2.25,11,1,7');
    const p = importTradesCsv(points).trades[0]!;
    expect(p.mae).toBeCloseTo(45);
    expect(p.mfe).toBeCloseTo(220);
  });

  it('reconnaît les symbologies NQZ6 / MNQZ26 et ignore les autres racines', () => {
    expect(detectInstrument('NQZ6')).toBe('NQ');
    expect(detectInstrument('MNQZ26')).toBe('MNQ');
    expect(detectInstrument('NQ 12-26')).toBe('NQ');
    expect(detectInstrument('ES 12-26')).toBeNull();
    expect(detectInstrument('NQD')).toBeNull();
  });
});

describe('intégrité import (audit F-02 / F-03 / F-04)', () => {
  it('F-02 : CSV fr-FR avec délimiteur « , » et décimales non quotées → 0 trade + warning', () => {
    const csv = `Trade-#,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. net profit,Commission,MAE,MFE,ETD,Bars
1,NQ 12-26,Sim101,,Long,1,20000,00,19975,50,15/09/2026 15:35:00,15/09/2026 15:42:00,Entry,Exit,-482245,00,-482245,00,4,50,45,00,220,00,20,00,7
`;
    const r = importTradesCsv(csv);
    expect(r.trades.length).toBe(0);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('F-03 : prix entiers + montants quotés en virgule → MAE/MFE/commission corrects (pas ×100)', () => {
    const csv = `Trade-#,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. net profit,Commission,MAE,MFE,ETD,Bars
1,MNQ 12-26,Sim101,,Long,1,24100,24112,15/09/2026 15:35:00,15/09/2026 15:42:00,Entry,Exit,"245,50 $","245,50 $","0,74 $","60,00 $","280,00 $","20,00 $",7
`;
    const r = importTradesCsv(csv);
    expect(r.trades.length).toBe(1);
    // PnL = prix × point MNQ − commission (la colonne Profit divergente est signalée, pas avalée).
    expect(r.trades[0]!.pnl).toBeCloseTo(12 * 2 - 0.74, 1);
    expect(r.trades[0]!.commission).toBeCloseTo(0.74, 2);
    expect(r.trades[0]!.mae).toBeCloseTo(60, 1);
    expect(r.trades[0]!.mfe).toBeCloseTo(280, 1);
  });

  it('F-04 : date ambiguë en-US sans AM/PM → mois/jour (2 janvier)', () => {
    const csv = `Trade-#,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. net profit,Commission,MAE,MFE,ETD,Bars
1,NQ 12-26,Sim101,,Long,1,20000.00,20010.00,01/02/2026 00:00:00,01/02/2026 00:05:00,Entry,Exit,$200.00,$200.00,$4.50,$45.00,$220.00,$20.00,7
`;
    const r = importTradesCsv(csv);
    expect(r.trades.length).toBe(1);
    expect(r.sessions[0]!.date).toBe('2026-01-02');
    const d = new Date(r.trades[0]!.entryTime);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(2);
  });
});
