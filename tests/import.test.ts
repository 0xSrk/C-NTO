import { describe, expect, it } from 'vitest';
import { detectFormat, exportTradesCsv, importTradesCsv } from '@/engine/import/ninjatrader';
import { parseCsv, parseLocaleNumber } from '@/lib/csv';
import { parseFlexibleDateTime } from '@/lib/time';

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
    expect(parseLocaleNumber('')).toBeNaN();
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
  });
});

describe('parseCsv', () => {
  it('détecte le séparateur et gère les guillemets', () => {
    const t = parseCsv('a;b;c\n1;"x;y";3\n');
    expect(t.delimiter).toBe(';');
    expect(t.headers).toEqual(['a', 'b', 'c']);
    expect(t.rows[0]).toEqual(['1', 'x;y', '3']);
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
    const [t1, t2, t3] = r.trades;
    expect(t1.instrument).toBe('NQ');
    expect(t1.direction).toBe('long');
    expect(t1.pnl).toBeCloseTo(200 - 4.5);
    expect(t1.mae).toBeCloseTo(45);
    expect(t2.direction).toBe('short');
    expect(t2.pnl).toBeCloseTo(-400 - 9);
    expect(t3.instrument).toBe('MNQ');
    expect(t3.pnl).toBeCloseTo(20 * 5 * 2 - 3.7);
    expect(r.sessions.length).toBe(2);
    expect(r.sessions[0].date).toBe('2026-09-15');
    expect(r.sessions[0].tradeCount).toBe(2);
    expect(r.sessions[0].pnl).toBeCloseTo(195.5 - 409);
    expect(r.sessions[1].date).toBe('2026-09-16');
    expect(new Date(t1.entryTime).getHours()).toBe(9);
  });

  it('reconnaît un export en culture fr-FR (point-virgule, virgule décimale, jj/mm/aaaa)', () => {
    const r = importTradesCsv(NT_FR);
    expect(r.format).toBe('ninjatrader-trades');
    expect(r.trades.length).toBe(2);
    expect(r.trades[0].entryPrice).toBe(20000);
    expect(r.trades[0].pnl).toBeCloseTo(195.5);
    expect(r.trades[1].pnl).toBeCloseTo(10 * 3 * 2 - 2.22);
    expect(r.trades[1].account).toBe('Apex-50K');
    expect(new Date(r.trades[0].entryTime).getMonth()).toBe(8);
    expect(new Date(r.trades[0].entryTime).getDate()).toBe(15);
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
    const headers = csv.split('\n')[0].split(',');
    expect(detectFormat(headers)).toBe('ninjatrader-trades');
    const again = importTradesCsv(csv, { source: 'csv' });
    expect(again.trades.length).toBe(3);
    expect(again.trades.map((t) => t.pnl)).toEqual(r.trades.map((t) => t.pnl));
    expect(again.sessions[0].source).toBe('csv');
  });
});
