import { getInstrument, hasInstrument } from '@/engine/instruments';
import { computeTradeStats, mean } from '@/engine/metrics';
import type { Session, Trade } from '@/engine/types';
import type { EntityRef, Link } from './schema';

/**
 * Seuils d'échantillon, en nombre de trades.
 * En dessous de 10 le chiffre est affiché mais marqué insuffisant : il ne soutient pas une affirmation.
 */
export const SAMPLE_FAIBLE = 10;
export const SAMPLE_MOYEN = 30;
export const SAMPLE_SOLIDE = 100;

/**
 * Risque de repli quand le trade n'a pas de risque planifié :
 * 4 ticks × valeur du tick (pointValue × tickSize, fiche CME du registre).
 */
export const APPROX_RISK_TICKS = 4;

const KNOWN_EVENT_TYPES = ['FOMC', 'NFP', 'CPI', 'PPI', 'PCE', 'GDP', 'PIB', 'EIA', 'ISM', 'PMI'] as const;

export interface ClaimEvent {
  id: string;
  title: string;
}

export interface ClaimConfidence {
  n: number;
  expectancyR: number;
  winRate: number;
  profitFactor: number;
  sample: 'insuffisant' | 'faible' | 'moyen' | 'solide';
  rMode: 'risque' | 'approx';
}

export function sampleOf(n: number): ClaimConfidence['sample'] {
  if (n < SAMPLE_FAIBLE) return 'insuffisant';
  if (n < SAMPLE_MOYEN) return 'faible';
  if (n < SAMPLE_SOLIDE) return 'moyen';
  return 'solide';
}

/** Type d'événement : jeton connu dans le titre (FOMC, CPI…), sinon le titre normalisé. */
export function eventTypeOf(titleOrId: string): string {
  const up = titleOrId.toUpperCase();
  for (const key of KNOWN_EVENT_TYPES) if (up.includes(key)) return key;
  return titleOrId.trim().toLowerCase();
}

function live(link: Link): boolean {
  return link.kind === 'structurel' || link.kind === 'affirme';
}

function tradeR(trade: Trade): { r: number; mode: 'risque' | 'approx' } | null {
  if (typeof trade.risk === 'number' && trade.risk > 0 && Number.isFinite(trade.risk)) {
    return { r: trade.pnl / trade.risk, mode: 'risque' };
  }
  if (!hasInstrument(trade.instrument)) return null;
  const spec = getInstrument(trade.instrument);
  const denom = spec.pointValue * spec.tickSize * APPROX_RISK_TICKS;
  if (!(denom > 0) || !Number.isFinite(denom)) return null;
  return { r: trade.pnl / denom, mode: 'approx' };
}

/**
 * Chiffres d'une affirmation. `null` s'il n'y a aucun `soutient`, `contredit` ou `applique` sortant.
 * `contredit` ne change pas le signe : le chiffre décrit l'échantillon relié, pas un verdict.
 * Un `pendant` vers un type d'événement (FOMC…) ne garde que les trades `pendant` ce type.
 */
export function claimConfidence(claim: EntityRef, links: readonly Link[], trades: readonly Trade[], sessions: readonly Session[], events: readonly ClaimEvent[] = []): ClaimConfidence | null {
  if (claim.type !== 'note') return null;
  const fromNote = links.filter((l) => live(l) && l.from.type === 'note' && l.from.id === claim.id);
  const epistemic = fromNote.filter((l) => l.predicate === 'soutient' || l.predicate === 'contredit' || l.predicate === 'applique');
  if (epistemic.length === 0) return null;

  const strategyIds = new Set<string>();
  const sessionIds = new Set<string>();
  const tradeIds = new Set<string>();
  for (const link of epistemic) {
    if (link.to.type === 'strategie') strategyIds.add(link.to.id);
    else if (link.to.type === 'session') sessionIds.add(link.to.id);
    else if (link.to.type === 'trade') tradeIds.add(link.to.id);
  }
  for (const link of links) {
    if (!live(link) || link.predicate !== 'applique' || link.to.type !== 'strategie' || !strategyIds.has(link.to.id)) continue;
    if (link.from.type === 'session') sessionIds.add(link.from.id);
    if (link.from.type === 'trade') tradeIds.add(link.from.id);
  }

  const knownSessions = new Set(sessions.map((s) => s.id));
  let scoped = trades.filter((t) => tradeIds.has(t.id) || (sessionIds.has(t.sessionId) && knownSessions.has(t.sessionId)));

  const pendant = fromNote.filter((l) => l.predicate === 'pendant' && l.to.type === 'evenement');
  if (pendant.length > 0) {
    const titleOf = new Map(events.map((e) => [e.id, e.title]));
    const types = new Set(pendant.map((l) => eventTypeOf(titleOf.get(l.to.id) ?? l.to.id)));
    const tradeTypes = new Map<string, Set<string>>();
    for (const link of links) {
      if (!live(link) || link.predicate !== 'pendant' || link.from.type !== 'trade' || link.to.type !== 'evenement') continue;
      const key = eventTypeOf(titleOf.get(link.to.id) ?? link.to.id);
      let set = tradeTypes.get(link.from.id);
      if (!set) {
        set = new Set();
        tradeTypes.set(link.from.id, set);
      }
      set.add(key);
    }
    scoped = scoped.filter((t) => {
      const set = tradeTypes.get(t.id);
      if (!set) return false;
      for (const type of types) if (set.has(type)) return true;
      return false;
    });
  }

  const finite = scoped.filter((t) => Number.isFinite(t.pnl));
  const stats = computeTradeStats(finite);
  const parts: { r: number; mode: 'risque' | 'approx' }[] = [];
  for (const trade of finite) {
    const part = tradeR(trade);
    if (part) parts.push(part);
  }
  const expectancyR = parts.length ? mean(parts.map((p) => p.r)) : 0;
  const allRisk = parts.length > 0 && parts.length === finite.length && parts.every((p) => p.mode === 'risque');
  return {
    n: finite.length,
    expectancyR,
    winRate: stats.winRate,
    profitFactor: stats.profitFactor,
    sample: sampleOf(finite.length),
    rMode: allRisk || finite.length === 0 ? 'risque' : 'approx',
  };
}
