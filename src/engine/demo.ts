import { uid } from '@/lib/id';
import { gaussian, mulberry32 } from '@/lib/rng';
import { dateKeyLocal, zonedToUtc, ET_ZONE } from '@/lib/time';
import { summarizeTrades } from './metrics';
import { getInstrument } from './instruments';
import { linkId, type Link } from './ontology/schema';
import type { TraderRules } from './discipline';
import type { Pocket } from './portfolio/types';
import type { Instrument, Session, Trade } from './types';

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
    if (!date) continue;
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
    const spec = getInstrument(instrument);

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
      const entryPrice = Math.round((price + gaussian(rand) * 40) / spec.tickSize) * spec.tickSize;
      const exitPrice = Math.round((entryPrice + (direction === 'long' ? movePts : -movePts)) / spec.tickSize) * spec.tickSize;
      const commission = qty * (spec.defaultCommission ?? 0);
      const gross = (exitPrice - entryPrice) * (direction === 'long' ? 1 : -1) * qty * spec.pointValue;
      const pnl = Math.round((gross - commission) * 100) / 100;
      const mae = Math.round((win ? riskPts * rand() * 0.7 : Math.abs(movePts) * (1 + rand() * 0.2)) * spec.pointValue * qty * 100) / 100;
      const mfe = Math.round((win ? Math.abs(movePts) * (1 + rand() * 0.35) : rewardPts * rand() * 0.5) * spec.pointValue * qty * 100) / 100;
      const tags: string[] = [];
      if (tilt && rand() < 0.6) tags.push(rand() < 0.5 ? 'FOMO' : 'revenge');
      if (!tilt && win && rand() < 0.4) tags.push('A+');
      if (rand() < 0.2) {
        const extra = TAGS[Math.floor(rand() * TAGS.length)];
        if (extra) tags.push(extra);
      }
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
        strategy: STRATEGIES[Math.floor(rand() * STRATEGIES.length)] ?? 'ORB 15m',
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

/**
 * Le compte Sim du jeu de démonstration (décision 14 de l'ADMIN, OROS5.30a) : le plan y est suivi, encore en cours ; c'est
 * le seul genre de compte où l'agent peut agir (`AGENT_SIM_PREFIX`), et la fiche Compte, M.011 et le miroir de la garde y
 * disent leur effet réel.
 */
export const SIM_DEMO = {
  account: 'Sim101',
  /** Le plan que le jeu suit sur ce compte. */
  planId: 'apex-50',
  /** Sa perte du jour (règle du trader), en dollars. */
  dailyLoss: 500,
} as const;

/**
 * Les séances Sim du jeu, de la plus ancienne à la plus récente : l'écart en points de chaque trade MNQ (2 contrats). Un
 * plan en cours, loin de l'objectif comme du drawdown ; aucune séance n'atteint la perte du jour.
 */
const SIM_MOVES: readonly (readonly number[])[] = [[30, -12], [-20], [52, -15, 9], [-28, 15], [38]];

/**
 * Les dernières séances d'un compte Sim (OROS5.30a), sur les derniers jours ouvrés avant `endDate`, à côté du tirage
 * d'Apex-PA-50K, qui ne change pas. Pur et déterministe : le même écart chaque fois, quel que soit le jour.
 */
export function generateDemoSimJournal(opts: { endDate?: Date } = {}): { sessions: Session[]; trades: Trade[] } {
  const days: string[] = [];
  const cursor = new Date(opts.endDate ?? new Date());
  cursor.setDate(cursor.getDate() - 1);
  while (days.length < SIM_MOVES.length) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) days.unshift(dateKeyLocal(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  const spec = getInstrument('MNQ');
  const qty = 2;
  const now = Date.now();
  const sessions: Session[] = [];
  const trades: Trade[] = [];
  days.forEach((date, di) => {
    const sessionId = uid('s');
    const dayTrades: Trade[] = [];
    let at = zonedToUtc(date, '09:42', ET_ZONE);
    let price = 21_950 + di * 35;
    (SIM_MOVES[di] ?? []).forEach((move, i) => {
      const direction = i % 2 === 0 ? 'long' : 'short';
      const entryPrice = price;
      const exitPrice = entryPrice + (direction === 'long' ? move : -move);
      const commission = qty * (spec.defaultCommission ?? 0);
      const pnl = Math.round((move * qty * spec.pointValue - commission) * 100) / 100;
      dayTrades.push({ id: uid('t'), sessionId, instrument: 'MNQ', account: SIM_DEMO.account, direction, qty, entryTime: at, exitTime: at + 14 * 60_000, entryPrice, exitPrice, pnl, commission, strategy: 'ORB 15m', risk: Math.round(12 * spec.pointValue * qty) });
      at += 38 * 60_000;
      price = exitPrice;
    });
    sessions.push({ id: sessionId, date, account: SIM_DEMO.account, source: 'demo', tags: [], createdAt: now, updatedAt: now, ...summarizeTrades(dayTrades) });
    trades.push(...dayTrades);
  });
  return { sessions, trades };
}

/**
 * Les réglages que le jeu pose (OROS5.30a) : le plan suit le compte Sim, et la perte du jour est réglée. Un réglage du
 * trader n'est jamais remplacé : seul ce qui est encore à son défaut (aucun compte suivi, aucun plan, aucune limite) change.
 * Aucun compte suivi ('') veut dire tous les comptes (OROS5.30b) : ce n'est un défaut que si rien de ce que le trader a
 * réglé ne le lit — ni perte du jour, ni plan autre que celui du jeu, celui d'un desk neuf. Sinon, poser le compte Sim
 * restreindrait sa limite ou son plan au seul compte du jeu.
 */
export function demoSettingsPatch(current: { planAccount: string; planId: string; traderRules: TraderRules }): { planAccount?: string; planId?: string; traderRules?: TraderRules } {
  const patch: { planAccount?: string; planId?: string; traderRules?: TraderRules } = {};
  const scopeRead = current.traderRules.maxDailyLoss > 0 || (!!current.planId.trim() && current.planId !== SIM_DEMO.planId);
  if (!current.planAccount.trim() && !scopeRead) patch.planAccount = SIM_DEMO.account;
  if (!current.planId.trim()) patch.planId = SIM_DEMO.planId;
  if (!(current.traderRules.maxDailyLoss > 0)) patch.traderRules = { ...current.traderRules, maxDailyLoss: SIM_DEMO.dailyLoss };
  return patch;
}

/** La poche prop du jeu (OROS5.30a), rattachée au compte Sim et à son plan ; aucune si le compte en a déjà une. */
export function demoPocket(existing: readonly Pick<Pocket, 'kind' | 'account'>[], now = Date.now()): Pocket | null {
  const fold = (name: string | undefined) => (name ?? '').trim().toLowerCase();
  if (existing.some((p) => fold(p.account) === fold(SIM_DEMO.account))) return null;
  return { id: uid('poche'), name: `Apex 50K · ${SIM_DEMO.account}`, kind: 'propfirm', currency: 'USD', account: SIM_DEMO.account, planId: SIM_DEMO.planId, createdAt: now };
}

/** Une note du jeu de démonstration, telle que le coffre de notes la range. */
export interface DemoNote {
  id: string;
  title: string;
  body: string;
  tags: string[];
  /** `agent` : écrite par un agent IA, non adoptée. */
  by?: 'agent';
  createdAt: number;
  updatedAt: number;
}

/**
 * Ce que le jeu de démonstration ajoute à l'ontologie (OROS5.30, décision 14 de l'ADMIN) : deux notes que le moteur
 * rapproche — l'hypothèse naît de la similarité du moteur au recalcul, elle n'est pas posée à la main — et un lien écrit
 * par l'agent, de sa lecture vers la dernière séance en dérive. Aucune trace d'ordre : ni proposition, ni garde, ni
 * dialogue. Pur et déterministe à `now` près ; le journal n'est pas touché (son tirage reste celui de
 * `generateDemoJournal`).
 */
export function generateDemoOntology(journal: { sessions: readonly Session[] }, now = Date.now()): { notes: DemoNote[]; links: Link[] } {
  const rule: DemoNote = {
    id: uid('n'),
    title: 'Règle anti-revanche',
    body: 'Après une perte, aucune entrée pendant vingt minutes. La revanche après une perte et le sizing relevé font les séances en dérive.\n\n#discipline',
    tags: ['discipline'],
    createdAt: now - 2,
    updatedAt: now - 2,
  };
  const reading: DemoNote = {
    id: uid('n'),
    title: 'Revanche après une perte : lecture de l’agent',
    body: 'Les séances en dérive commencent par une entrée de revanche après une perte, puis un sizing relevé. La règle des vingt minutes les aurait évitées.\n\n#discipline',
    tags: ['discipline'],
    by: 'agent',
    createdAt: now - 1,
    updatedAt: now - 1,
  };
  const drifted = [...journal.sessions].filter((s) => s.tags.includes('sur-trading')).sort((a, b) => b.date.localeCompare(a.date))[0];
  const links: Link[] = [];
  if (drifted) {
    const from = { type: 'note' as const, id: reading.id };
    const to = { type: 'session' as const, id: drifted.id };
    links.push({ id: linkId(from, 'relie', to), from, to, predicate: 'relie', kind: 'affirme', by: 'agent', createdAt: now, updatedAt: now });
  }
  return { notes: [rule, reading], links };
}
