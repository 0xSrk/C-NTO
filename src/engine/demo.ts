import { uid } from '@/lib/id';
import { gaussian, mulberry32 } from '@/lib/rng';
import { dateKeyLocal, zonedToUtc, ET_ZONE } from '@/lib/time';
import { summarizeTrades } from './metrics';
import { INSTRUMENTS, type Instrument, type Session, type Trade } from './types';

const STRATEGIES = ['ORB 15m', 'VWAP reclaim', 'Liquidity sweep', 'Trend pullback', 'Range fade'];
const TAGS = ['A+', 'discipline', 'FOMO', 'revenge', 'news', 'plan respecté', 'sur-trading', 'patience'];

/**
 * Jeu de démonstration : ~7 mois de séances plausibles d'un trader NQ/MNQ en évaluation prop,
 * avec une légère espérance positive, des séries et une dérive de discipline.
 */
export function generateDemoJournal(opts: { sessions?: number; seed?: number; endDate?: Date } = {}): { sessions: Session[]; trades: Trade[] } {
  const target = opts.sessions ?? 140;
  const rand = mulberry32(opts.seed ?? 2052);
  const end = opts.endDate ?? new Date();
  const days: string[] = [];
  const cursor = new Date(end);
  cursor.setDate(cursor.getDate() - 1);
  while (days.length < target) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6 && rand() < 0.86) days.unshift(dateKeyLocal(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }

  const sessions: Session[] = [];
  const trades: Trade[] = [];
  const now = Date.now();
  let price = 21_900;
  let edge = 0.015;

  for (let di = 0; di < days.length; di++) {
    const date = days[di];
    price += gaussian(rand) * 120 + 9;
    edge += (0.03 - edge) * 0.1 + gaussian(rand) * 0.008;
    edge = Math.max(-0.06, Math.min(0.06, edge));
    const tilt = rand() < 0.12;
    const nTrades = tilt ? 5 + Math.floor(rand() * 4) : 1 + Math.floor(rand() * 5);
    const sessionId = uid('s');
    const dayTrades: Trade[] = [];
    const rthOpen = zonedToUtc(date, '09:30', ET_ZONE);
    let cursorMs = rthOpen + (rand() < 0.25 ? -60 : 2 + rand() * 20) * 60_000;
    const instrument: Instrument = rand() < 0.65 ? 'MNQ' : 'NQ';
    const spec = INSTRUMENTS[instrument];

    for (let i = 0; i < nTrades; i++) {
      const qty = instrument === 'MNQ' ? 2 + Math.floor(rand() * 4) : 1;
      const direction = rand() < 0.55 ? 'long' : 'short';
      const durationMin = 2 + Math.floor(Math.pow(rand(), 1.6) * 55);
      const entryTime = cursorMs;
      const exitTime = entryTime + durationMin * 60_000;
      cursorMs = exitTime + (3 + rand() * 25) * 60_000;
      const win = rand() < 0.515 + edge - (tilt ? 0.1 : 0);
      const riskPts = 8 + rand() * 14;
      const rewardPts = riskPts * (1.0 + rand() * 1.2);
      const movePts = win ? rewardPts * (0.5 + rand() * 0.6) : -riskPts * (0.8 + Math.pow(rand(), 2) * 1.1);
      const entryPrice = Math.round((price + gaussian(rand) * 40) / 0.25) * 0.25;
      const exitPrice = Math.round((entryPrice + (direction === 'long' ? movePts : -movePts)) / 0.25) * 0.25;
      const commission = qty * (instrument === 'MNQ' ? 0.74 : 2.5) * 2;
      const gross = (exitPrice - entryPrice) * (direction === 'long' ? 1 : -1) * qty * spec.pointValue;
      const pnl = Math.round((gross - commission) * 100) / 100;
      const mae = Math.round((win ? riskPts * rand() * 0.7 : Math.abs(movePts) * (1 + rand() * 0.2)) * spec.pointValue * qty * 100) / 100;
      const mfe = Math.round((win ? Math.abs(movePts) * (1 + rand() * 0.35) : rewardPts * rand() * 0.5) * spec.pointValue * qty * 100) / 100;
      const tags: string[] = [];
      if (tilt && rand() < 0.6) tags.push(rand() < 0.5 ? 'FOMO' : 'revenge');
      if (!tilt && win && rand() < 0.4) tags.push('A+');
      if (rand() < 0.2) tags.push(TAGS[Math.floor(rand() * TAGS.length)]);
      dayTrades.push({
        id: uid('t'),
        sessionId,
        instrument,
        account: 'Apex-PA-50K',
        direction,
        qty,
        entryTime,
        exitTime,
        entryPrice,
        exitPrice,
        pnl,
        commission,
        mae,
        mfe,
        strategy: STRATEGIES[Math.floor(rand() * STRATEGIES.length)],
        tags: tags.length ? [...new Set(tags)] : undefined,
        risk: Math.round(riskPts * spec.pointValue * qty),
      });
    }
    const summary = summarizeTrades(dayTrades);
    const sessionTags: string[] = [];
    if (tilt) sessionTags.push('sur-trading');
    else if (summary.pnl > 0 && rand() < 0.5) sessionTags.push('plan respecté');
    sessions.push({
      id: sessionId,
      date,
      account: 'Apex-PA-50K',
      source: 'demo',
      tags: sessionTags,
      rating: tilt ? 1 + Math.floor(rand() * 2) : 3 + Math.floor(rand() * 3),
      note: tilt ? 'Séance en dérive : enchaînement après une perte, sizing non respecté.' : undefined,
      createdAt: now,
      updatedAt: now,
      ...summary,
    });
    trades.push(...dayTrades);
  }
  return { sessions, trades };
}
