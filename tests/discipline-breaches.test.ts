import { describe, expect, it } from 'vitest';
import type { CalEvent } from '@/engine/calendar';
import { DEFAULT_TRADER_RULES, detectRuleBreaches, entryOfTrade, majorCatalysts, type DisciplineEntry, type RuleCheckContext, type TraderRules } from '@/engine/discipline';
import type { Trade } from '@/engine/types';

const ET = (hhmm: string, date = '2026-10-14') => Date.parse(`${date}T${hhmm}:00-04:00`);
const entry = (id: string, at: string, instrument = 'MNQ 12-26', account = 'PA-1'): DisciplineEntry => ({ id, account, instrument, qty: 1, time: ET(at) });

function trade(id: string, entry: string, exit: string, pnl: number, account = 'PA-1'): Trade {
  return { id, sessionId: 's', instrument: 'MNQ', account, direction: 'long', qty: 1, entryTime: ET(entry), exitTime: ET(exit), entryPrice: 20_000, exitPrice: 20_000, pnl, commission: 0 };
}

const cal = (over: Partial<CalEvent>): CalEvent => ({ id: 'cpi', date: '2026-10-14', timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, estimated: false, description: '', ...over });

function ctx(rules: Partial<TraderRules>, over: Partial<RuleCheckContext> = {}): RuleCheckContext {
  return { rules: { ...DEFAULT_TRADER_RULES, ...rules }, closed: [], catalysts: majorCatalysts([cal({})]), limit: null, limitAccount: '', ...over };
}

describe('écarts aux règles du trader', () => {
  it('fenêtre de catalyseur : CPI 08:30, fenêtre 10 min, entrée 08:25 signalée, 08:45 non', () => {
    const found = detectRuleBreaches([entry('a', '08:25'), entry('b', '08:45'), entry('c', '08:40')], ctx({ catalystBlackoutMin: 10 }));
    expect(found.map((f) => f.id)).toEqual(['catalyst_window:a', 'catalyst_window:c']);
    expect(found[0]).toMatchObject({ family: 'rule', day: '2026-10-14', detail: { title: 'Inflation CPI', timeET: '08:30', minutesFromCatalyst: -5, windowMin: 10 } });
    expect(detectRuleBreaches([entry('a', '08:25')], ctx({ catalystBlackoutMin: 0 }))).toEqual([]);
  });

  it('seuls les catalyseurs majeurs datés comptent, et ceux de l’instrument', () => {
    const catalysts = majorCatalysts([
      cal({ id: 'ppi', impact: 2, title: 'PPI' }),
      cal({ id: 'mega', allDay: true, timeET: undefined, title: 'Résultats' }),
      cal({ id: 'eia', timeET: '10:30', title: 'EIA', instruments: ['CL'] }),
      cal({ id: 'nq', timeET: '11:00', title: 'Rééquilibrage', instruments: ['NQ'] }),
    ]);
    expect(catalysts.map((c) => c.title)).toEqual(['EIA', 'Rééquilibrage']);
    const found = detectRuleBreaches([entry('cl', '10:31'), entry('mnq', '11:02'), entry('m6e', '11:02', 'M6E')], ctx({ catalystBlackoutMin: 5 }, { catalysts }));
    expect(found.map((f) => f.id)).toEqual(['catalyst_window:mnq']);
  });

  it('trop de trades : au-delà du maximum dans la journée CME, compte par compte', () => {
    const closed = [trade('t1', '09:31', '09:40', 10), trade('t2', '09:45', '09:50', -10), trade('t3', '10:00', '10:05', 5), trade('o1', '09:32', '09:33', 5, 'Sim101')];
    const found = detectRuleBreaches(closed.map(entryOfTrade), ctx({ maxTradesPerDay: 2 }, { closed }));
    expect(found.map((f) => [f.id, f.detail.ordinal])).toEqual([['over_max_trades:t3', 3]]);
    // Un fill d'entrée en direct, après trois trades clos : la quatrième entrée.
    expect(detectRuleBreaches([entry('fill', '10:30')], ctx({ maxTradesPerDay: 2 }, { closed }))[0]?.detail).toMatchObject({ ordinal: 4, max: 2 });
    // La journée suivante repart de zéro.
    expect(detectRuleBreaches([{ ...entry('next', '09:31'), time: ET('09:31', '2026-10-15') }], ctx({ maxTradesPerDay: 2 }, { closed }))).toEqual([]);
    expect(detectRuleBreaches(closed.map(entryOfTrade), ctx({ maxTradesPerDay: 0 }, { closed }))).toEqual([]);
  });

  it('après la limite du jour : entrée quand la perte avait atteint la limite, latent négatif compris', () => {
    const closed = [trade('l1', '09:31', '10:00', -300), trade('l2', '10:20', '10:30', -250), trade('x', '09:31', '09:35', -900, 'Sim101')];
    const limit = { amount: 500, source: 'trader' as const, trader: 500, plan: null };
    const c = ctx({ maxDailyLoss: 500 }, { closed, limit, limitAccount: 'PA-1' });
    expect(detectRuleBreaches([entry('early', '10:15'), entry('late', '10:45'), entry('sim', '10:45', 'MNQ', 'Sim101')], c).map((f) => [f.id, f.detail.loss])).toEqual([['after_daily_limit:late', 550]]);
    expect(detectRuleBreaches([entry('early', '10:15')], { ...c, unrealized: -250 }).map((f) => f.id)).toEqual(['after_daily_limit:early']);
    expect(detectRuleBreaches([entry('early', '10:15')], { ...c, unrealized: 400 })).toEqual([]);
    expect(detectRuleBreaches([entry('late', '10:45')], { ...c, limit: null })).toEqual([]);
  });

  it('instrument hors liste : racine du registre, contrat daté compris ; liste vide, rien', () => {
    const found = detectRuleBreaches([entry('ok', '10:00', 'MNQ 12-26'), entry('nq', '10:00', 'NQ 12-26'), entry('btc', '10:00', 'BTC')], ctx({ allowedInstruments: ['MNQ'] }));
    expect(found.map((f) => [f.id, f.detail.symbol])).toEqual([
      ['instrument_not_allowed:nq', 'NQ'],
      ['instrument_not_allowed:btc', null],
    ]);
    expect(detectRuleBreaches([entry('nq', '10:00', 'NQ 12-26')], ctx({}))).toEqual([]);
  });

  it('règles par défaut : rien n’est signalé', () => {
    const closed = [trade('l1', '08:20', '08:29', -5_000), trade('l2', '08:31', '08:35', -100)];
    expect(detectRuleBreaches([...closed.map(entryOfTrade), entry('f', '08:30', 'BTC')], ctx({}, { closed }))).toEqual([]);
  });
});
