import { describe, expect, it } from 'vitest';
import { toolBlurb, toolSchemas } from '@/engine/agent/tools';
import { computeTradeStats, sessionDates } from '@/engine/metrics';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { callTool } from './helpers/agentEval';
import { fakePorts } from './helpers/deskPorts';

const AT = Date.parse('2026-09-30T20:00:00Z');
const session = (id: string, date: string, account: string, pnl: number, over: Partial<Session> = {}): Session => ({
  id,
  date,
  account,
  instruments: ['NQ'],
  source: 'ninjatrader',
  tradeCount: 1,
  pnl,
  grossProfit: Math.max(0, pnl),
  grossLoss: Math.min(0, pnl),
  commission: 0,
  tags: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const trade = (id: string, sessionId: string, entry: number, exit: number, pnl: number, over: Partial<Trade> = {}): Trade => ({
  id,
  sessionId,
  instrument: 'NQ',
  account: 'Sim101',
  direction: 'long',
  qty: 1,
  entryTime: entry,
  exitTime: exit,
  entryPrice: 20_000,
  exitPrice: 20_000 + pnl / 20,
  pnl,
  commission: 0,
  ...over,
});

type Bucket = { key: string; trades: number; pnl: number };

describe('A6.1 journal_breakdown : le jour est la journée CME de la séance, comme l’onglet Analyse', () => {
  // Séance du vendredi 18/09 (import avec une frontière à 19 h) : sa sortie, 18 h 20 ET, tombe
  // après la frontière CME de 18 h, donc sur la journée du samedi si l'on ne lit que l'heure.
  const sessions = [session('s_ven', '2026-09-18', 'Sim101', 300), session('s_mer', '2026-09-16', 'Sim101', -100)];
  const trades = [
    trade('t_ven', 's_ven', zonedToUtc('2026-09-18', '16:40', ET_ZONE), zonedToUtc('2026-09-18', '18:20', ET_ZONE), 300),
    trade('t_mer', 's_mer', zonedToUtc('2026-09-16', '10:00', ET_ZONE), zonedToUtc('2026-09-16', '10:30', ET_ZONE), -100),
  ];

  it('une séance du vendredi dont la sortie tombe un autre jour est comptée le vendredi', async () => {
    const out = await callTool<{ byWeekday: Bucket[]; byHour: Bucket[]; dayBasis: string; timezone: string }>(fakePorts({ sessions: () => sessions, trades: () => trades }), 'journal_breakdown');
    const screen = computeTradeStats(trades, sessionDates(sessions));
    expect(out.byWeekday.map((b) => b.key)).toEqual(screen.byWeekday.filter((b) => b.count > 0).map((b) => b.key));
    expect(out.byWeekday).toEqual([
      { key: 'mer', trades: 1, pnl: -100, winRate: 0 },
      { key: 'ven', trades: 1, pnl: 300, winRate: 1 },
    ]);
    expect(out.dayBasis).toBe('cme_session');
    // L'heure reste l'heure d'entrée à New York.
    expect(out.timezone).toBe('America/New_York');
    expect(out.byHour.map((b) => b.key)).toEqual(['10', '16']);
  });

  it('les trois descriptions disent la journée CME de la séance, plus « heure de New York » pour le jour', () => {
    const fr = toolSchemas().find((t) => t.name === 'journal_breakdown')!.description;
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      const text = toolBlurb('journal_breakdown', fr);
      expect(text, locale).toMatch(/CME/);
      expect(text, locale).not.toMatch(/jour de semaine \(heure de New York\)|weekday \(New York time\)|día de la semana \(hora de Nueva York\)/);
    }
    useI18n.setState({ locale: 'fr' });
  });
});
