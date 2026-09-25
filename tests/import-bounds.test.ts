import { describe, expect, it } from 'vitest';
import { exportTradesCsv, importTradesCsv, PRICE_MAX, QTY_MAX } from '@/engine/import/ninjatrader';
import { importExecutionsCsv, parseExecutionsCsv } from '@/engine/import/executions';
import { detectDelimiter, parseCsv, parseLocaleNumber } from '@/lib/csv';

const HEAD = 'Trade-#,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. net profit,Commission,MAE,MFE,ETD,Bars';
const row = (qty: string, entry: string, exit: string, profit = '$200.00', commission = '$4.50') =>
  `1,NQ 12-26,Sim101,,Long,${qty},${entry},${exit},9/15/2026 9:35:00 AM,9/15/2026 9:42:00 AM,Entry,Exit,${profit},$200.00,${commission},$45.00,$220.00,$20.00,7`;
const HUGE = '9'.repeat(400);

describe('bornes import Trades', () => {
  it('quantité Infinity / non entière / > 10 000 → rejet compté', () => {
    for (const qty of [HUGE, '2.5', String(QTY_MAX + 1), '0']) {
      const r = importTradesCsv(`${HEAD}\n${row(qty, '20000.00', '20010.00')}\n`);
      expect(r.trades.length, qty).toBe(0);
      expect(r.skipped, qty).toBe(1);
    }
    const ok = importTradesCsv(`${HEAD}\n${row(String(QTY_MAX), '20000.00', '20010.00')}\n`);
    expect(ok.trades.length).toBe(1);
    expect(importTradesCsv(`${HEAD}\n${row(HUGE, '20000.00', '20010.00')}\n`).warnings.some((w) => /bornes|bounds|límites/.test(w))).toBe(true);
  });

  it('prix hors [0, 1e6] → rejet', () => {
    expect(importTradesCsv(`${HEAD}\n${row('1', HUGE, '20010.00')}\n`).trades.length).toBe(0);
    expect(importTradesCsv(`${HEAD}\n${row('1', '20000.00', String(PRICE_MAX + 1))}\n`).trades.length).toBe(0);
    expect(importTradesCsv(`${HEAD}\n${row('1', '20000.00', '1e300')}\n`).trades.length).toBe(0);
    expect(importTradesCsv(`${HEAD}\n${row('1', '999990.00', String(PRICE_MAX))}\n`).trades.length).toBe(1);
  });

  it('PnL non fini (commission absurde) → rejet, jamais stocké', () => {
    const r = importTradesCsv(`${HEAD}\n${row('1', '20000.00', '20010.00', '$200.00', `$${HUGE}`)}\n`);
    expect(r.trades.length).toBe(0);
    expect(r.skipped).toBe(1);
    const all = importTradesCsv(`${HEAD}\n${row('1', '20000.00', '20010.00')}\n${row('1', '20000.00', '20010.00', '$200.00', `$${HUGE}`)}\n`);
    expect(all.trades.length).toBe(1);
    expect(all.trades.every((t) => Number.isFinite(t.pnl) && Number.isFinite(t.commission))).toBe(true);
  });

  it('MAE / MFE / risque démesurés sont abandonnés plutôt que stockés', () => {
    const csv = `${HEAD}\n1,NQ 12-26,Sim101,,Long,1,20000.00,20010.00,9/15/2026 9:35:00 AM,9/15/2026 9:42:00 AM,Entry,Exit,$200.00,$200.00,$4.50,$${HUGE},$220.00,$20.00,7\n`;
    const t = importTradesCsv(csv).trades[0]!;
    expect(t.mae).toBeUndefined();
    expect(t.mfe).toBeCloseTo(220);
  });
});

describe('bornes import Exécutions', () => {
  const H = 'Instrument,Action,Quantity,Price,Time,ID,Account';
  it('quantité Infinity, non entière, prix 1e300 → exécution rejetée avec avertissement', () => {
    const csv = `${H}\nNQ 12-26,Buy,${HUGE},20000,2026-09-15 15:35:00,a,Apex\nNQ 12-26,Sell,1.5,20010,2026-09-15 15:40:00,b,Apex\nNQ 12-26,Buy,1,${HUGE},2026-09-15 15:41:00,c,Apex\nNQ 12-26,Buy,1,20000,2026-09-15 15:42:00,d,Apex\nNQ 12-26,Sell,1,20010,2026-09-15 15:43:00,e,Apex\n`;
    const p = parseExecutionsCsv(csv);
    expect(p.executions.map((e) => e.executionId)).toEqual(['d', 'e']);
    expect(p.skipped).toBe(3);
    expect(p.warnings.some((w) => /bornes|bounds|límites/.test(w))).toBe(true);
    const r = importExecutionsCsv(csv);
    expect(r.trades.length).toBe(1);
    expect(Number.isFinite(r.trades[0]!.pnl)).toBe(true);
  });

  it('commission non finie → exécution rejetée, PnL toujours fini', () => {
    const csv = `Instrument,Action,Quantity,Price,Time,ID,Commission,Account\nNQ 12-26,Buy,1,20000,2026-09-15 15:35:00,a,${HUGE},Apex\nNQ 12-26,Sell,1,20010,2026-09-15 15:40:00,b,2.25,Apex\n`;
    const r = importExecutionsCsv(csv);
    expect(r.trades.length).toBe(0);
    expect(r.openLots.length).toBe(1);
    expect(r.skipped).toBe(1);
  });
});

describe('lib/csv durci', () => {
  it('parseLocaleNumber refuse la notation scientifique au lieu de la dépouiller', () => {
    expect(parseLocaleNumber('1e5')).toBeNaN();
    expect(parseLocaleNumber('2.5E-3')).toBeNaN();
    expect(parseLocaleNumber('-1e400')).toBeNaN();
    expect(parseLocaleNumber('12,5 EUR', ',')).toBeCloseTo(12.5);
    expect(parseLocaleNumber('$1,250.50')).toBeCloseTo(1250.5);
  });

  it('detectDelimiter lit la première ligne non vide sans découper tout le fichier', () => {
    expect(detectDelimiter('\n\r\n  \na;b;c\n1,2,3\n')).toBe(';');
    expect(detectDelimiter('a\tb\tc\r\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('x|y|z')).toBe('|');
    const big = `a,b\n${'1,2\n'.repeat(200_000)}`;
    expect(detectDelimiter(big)).toBe(',');
  });

  it('guillemet non refermé en fin de fichier → avertissement', () => {
    const t = parseCsv('a,b\n1,"ouvert\n2,3\n');
    expect(t.warnings.length).toBe(1);
    expect(t.warnings[0]).toMatch(/Guillemet|quote|Comillas/);
    expect(parseCsv('a,b\n1,"ferme"\n').warnings).toEqual([]);
    const imported = importTradesCsv(`${HEAD}\n${row('1', '20000.00', '20010.00')}\n"trailing`);
    expect(imported.warnings.some((w) => /Guillemet|quote|Comillas/.test(w))).toBe(true);
  });

  it('export CSV : préfixe tabulation / retour chariot en tête et quote les \\r', () => {
    const r = importTradesCsv(`${HEAD}\n${row('1', '20000.00', '20010.00')}\n`);
    r.trades[0]!.strategy = '\t=cmd';
    r.trades[0]!.entryName = '\r@load';
    r.trades[0]!.exitName = 'a\rb';
    const csv = exportTradesCsv(r.trades);
    expect(csv).toContain(",'\t=cmd,");
    expect(csv).toContain("\"'\r@load\"");
    expect(csv).toContain('"a\rb"');
  });
});
