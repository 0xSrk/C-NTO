import { describe, expect, it } from 'vitest';
import { importCsvAuto } from '@/engine/import';
import { importExecutionsCsv, pairExecutions, parseExecutionsCsv } from '@/engine/import/executions';
import { takeNewExecutionTrades } from '@/engine/import/identity';
import { detectFormat } from '@/engine/import/ninjatrader';

const NT_EXEC = `Instrument,Action,Quantity,Price,Time,ID,E/X,Position,Order ID,Name,Commission,Rate,Account,Connection
NQ 12-26,Buy,2,20000.00,9/15/2026 9:35:00 AM,e1,Entry,2 L,o1,Entry,4.50,1,Sim101,Playback
NQ 12-26,Sell,1,20010.00,9/15/2026 9:40:00 AM,e2,Exit,1 L,o2,Target1,2.25,1,Sim101,Playback
NQ 12-26,Sell,1,20005.00,9/15/2026 9:42:00 AM,e3,Exit,-,o3,Stop1,2.25,1,Sim101,Playback
MNQ 12-26,Sell,5,20100.00,9/15/2026 10:05:00 AM,e4,Entry,5 S,o4,Short,3.70,1,Sim101,Playback
MNQ 12-26,Buy,5,20090.00,9/15/2026 10:15:00 AM,e5,Exit,-,o5,Cover,3.70,1,Sim101,Playback
ES 12-26,Buy,1,5000.00,9/15/2026 10:20:00 AM,e6,Entry,1 L,o6,Entry,2.00,1,Sim101,Playback
NQ 12-26,Sell,1,20200.00,9/16/2026 9:31:00 AM,e7,Entry,1 S,o7,Short,2.25,1,Sim101,Playback
`;

describe('exécutions NinjaTrader', () => {
  it('reconnaît le format Executions', () => {
    const headers = NT_EXEC.split('\n')[0]!.split(',');
    expect(detectFormat(headers)).toBe('ninjatrader-executions');
  });

  it('parse les exécutions et ignore les instruments hors Nasdaq', () => {
    const { executions, skipped } = parseExecutionsCsv(NT_EXEC);
    expect(executions.length).toBe(6);
    expect(skipped).toBe(1);
    expect(executions[0]).toMatchObject({ account: 'Sim101', instrument: 'NQ', action: 'buy', quantity: 2, price: 20000, executionId: 'e1', commission: 4.5 });
  });

  it('apparie en FIFO avec fractionnement, commissions réparties et position ouverte restante', () => {
    const { executions } = parseExecutionsCsv(NT_EXEC);
    const { trades, openLots } = pairExecutions(executions);
    expect(trades.length).toBe(3);
    const t1 = trades[0]!;
    const t2 = trades[1]!;
    const t3 = trades[2]!;
    // 2 NQ achetés à 20000 : 1 vendu à 20010 (+200 brut), 1 vendu à 20005 (+100 brut)
    expect(t1).toMatchObject({ instrument: 'NQ', direction: 'long', qty: 1, entryPrice: 20000, exitPrice: 20010, entryName: 'Entry', exitName: 'Target1' });
    expect(t1.executionIds).toEqual(['e1', 'e2']);
    expect(t1.orderIds).toEqual(['o1', 'o2']);
    expect(t1.commission).toBeCloseTo(2.25 + 2.25);
    expect(t1.pnl).toBeCloseTo(200 - 4.5);
    expect(t2).toMatchObject({ direction: 'long', qty: 1, exitPrice: 20005, exitName: 'Stop1' });
    expect(t2.executionIds).toEqual(['e1', 'e3']);
    expect(t2.orderIds).toEqual(['o1', 'o3']);
    expect(t2.pnl).toBeCloseTo(100 - 4.5);
    // 5 MNQ short 20100 → cover 20090 : +10 pts × 2 $ × 5 = +100 brut
    expect(t3).toMatchObject({ instrument: 'MNQ', direction: 'short', qty: 5, entryPrice: 20100, exitPrice: 20090 });
    expect(t3.pnl).toBeCloseTo(100 - 7.4);
    expect(openLots).toEqual([expect.objectContaining({ instrument: 'NQ', direction: 'short', quantity: 1, price: 20200 })]);
    expect(new Set(trades.map((t) => t.id)).size).toBe(3);
  });

  it('produit des identifiants stables et des séances par journée', () => {
    const a = importExecutionsCsv(NT_EXEC);
    const b = importExecutionsCsv(NT_EXEC);
    expect(a.trades.map((t) => t.id)).toEqual(b.trades.map((t) => t.id));
    expect(a.sessions.length).toBe(1);
    expect(a.sessions[0]!.tradeCount).toBe(3);
    expect(a.sessions[0]!.pnl).toBeCloseTo(195.5 + 95.5 + 92.6);
    expect(a.warnings.some((w) => w.includes('ouverte'))).toBe(true);
    expect(a.format).toBe('ninjatrader-executions');
  });

  it('gère un retournement de position en une seule exécution', () => {
    const csv = `Instrument,Action,Quantity,Price,Time,ID,Account
NQ 12-26,Buy,1,20000,2026-09-15 15:35:00,a,Apex
NQ 12-26,Sell,3,20010,2026-09-15 15:40:00,b,Apex
NQ 12-26,Buy,2,20000,2026-09-15 15:50:00,c,Apex
`;
    const { trades, openLots } = pairExecutions(parseExecutionsCsv(csv).executions);
    expect(trades.length).toBe(2);
    expect(trades[0]).toMatchObject({ direction: 'long', qty: 1, pnl: 200 });
    expect(trades[1]).toMatchObject({ direction: 'short', qty: 2, entryPrice: 20010, exitPrice: 20000, pnl: 400 });
    expect(openLots.length).toBe(0);
  });

  it('rejette une quantité Infinity ou un prix hors bornes (PnL toujours fini)', () => {
    const csv = `Instrument,Action,Quantity,Price,Time,ID,Account
NQ 12-26,Buy,${'9'.repeat(400)},20000,2026-09-15 15:35:00,a,Apex
NQ 12-26,Sell,1,1e300,2026-09-15 15:40:00,b,Apex
NQ 12-26,Buy,1,20000,2026-09-15 15:41:00,c,Apex
NQ 12-26,Sell,1,20010,2026-09-15 15:42:00,d,Apex
`;
    const r = importExecutionsCsv(csv);
    expect(r.skipped).toBe(2);
    expect(r.trades.length).toBe(1);
    expect(r.trades[0]!.pnl).toBe(200);
    expect(r.trades.every((t) => Number.isFinite(t.pnl))).toBe(true);
  });

  it('importCsvAuto dispatche selon le format', () => {
    expect(importCsvAuto(NT_EXEC).format).toBe('ninjatrader-executions');
    expect(importCsvAuto('foo,bar\n1,2\n').format).toBe('inconnu');
  });

  it('lit le journal temps réel du pont (culture invariante, point-virgule)', () => {
    const csv = `Instrument;Action;Quantity;Price;Time;ID;E/X;Position;Order ID;Name;Commission;Rate;Account;Connection
MNQ 12-26;Buy;3;21000.25;2026-09-16 15:31:02;x1;Entry;3 L;o1;Entry;2.22;1;APEX-50K;Rithmic
MNQ 12-26;Sell;3;21012.75;2026-09-16 15:39:40;x2;Exit;-;o2;Exit;2.22;1;APEX-50K;Rithmic
`;
    const r = importExecutionsCsv(csv);
    expect(r.trades.length).toBe(1);
    expect(r.trades[0]!.entryPrice).toBeCloseTo(21000.25);
    expect(r.trades[0]!.pnl).toBeCloseTo(12.5 * 2 * 3 - 4.44);
    expect(r.trades[0]!.account).toBe('APEX-50K');
  });

  it('importe une fixture au format exact de l’AddOn CantoBridge (virgule, point décimal, ISO)', () => {
    const csv = `Instrument,Action,Quantity,Price,Time,ID,E/X,Position,Order ID,Name,Commission,Rate,Account,Connection
MNQ 12-26,Buy,3,21000.25,2026-09-16 15:31:02,3f2a1111,Entry,3 L,7c1aaaaa,Entry,2.22,1,APEX-50K,Rithmic
MNQ 12-26,Sell,3,21012.75,2026-09-16 15:39:40,3f2a2222,Exit,-,7c1bbbbb,Exit,2.22,1,APEX-50K,Rithmic
`;
    const r = importExecutionsCsv(csv);
    expect(r.format).toBe('ninjatrader-executions');
    expect(r.warnings.filter((w) => !w.includes('ouverte')).length).toBe(0);
    expect(r.trades.length).toBe(1);
    expect(r.trades[0]!.pnl).toBeCloseTo(12.5 * 2 * 3 - 4.44);
  });
});

function applyExecutions(csv: string, known: Set<string>) {
  const r = importExecutionsCsv(csv);
  const picked = takeNewExecutionTrades(r.trades, r.tradeExecutionKeys, known);
  for (const keys of picked.tradeKeys) for (const k of keys) known.add(k);
  return picked.trades;
}

describe('idempotence import exécutions', () => {
  it('import is idempotent when the same executions CSV is applied three times', () => {
    const known = new Set<string>();
    const acc: ReturnType<typeof importExecutionsCsv>['trades'] = [];
    for (let n = 0; n < 3; n++) acc.push(...applyExecutions(NT_EXEC, known));
    expect(acc.length).toBe(importExecutionsCsv(NT_EXEC).trades.length);
    expect(acc.length).toBe(3);
  });

  it('import adds only the new execution id when the file grows', () => {
    const known = new Set<string>();
    const first = applyExecutions(NT_EXEC, known);
    expect(first.length).toBe(3);
    const grown = `${NT_EXEC}NQ 12-26,Buy,1,20190.00,9/16/2026 9:50:00 AM,e8,Exit,-,o8,Cover,2.25,1,Sim101,Playback\n`;
    const added = applyExecutions(grown, known);
    expect(added.length).toBe(1);
    expect(added[0]).toMatchObject({ instrument: 'NQ', direction: 'short', qty: 1, entryPrice: 20200, exitPrice: 20190 });
    expect(applyExecutions(grown, known).length).toBe(0);
  });

  it('import uses fallback hash when execution ID is empty and still idempotent', () => {
    const csv = `Instrument,Action,Quantity,Price,Time,ID,Account
NQ 12-26,Buy,1,20000,2026-09-15 15:35:00,,Apex
NQ 12-26,Sell,1,20010,2026-09-15 15:40:00,,Apex
`;
    const known = new Set<string>();
    const first = applyExecutions(csv, known);
    expect(first.length).toBe(1);
    expect(parseExecutionsCsv(csv).executions[0]!.executionId).toBe('');
    expect(parseExecutionsCsv(csv).executions[0]!.identityKey).toMatch(/^[0-9a-f]{8}$/);
    expect(applyExecutions(csv, known).length).toBe(0);
    expect(applyExecutions(csv, known).length).toBe(0);
  });
});

