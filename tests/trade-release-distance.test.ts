import { describe, expect, it } from 'vitest';
import { materializeBundle } from '@/engine/calendar-bundle';
import { generateDemoJournal } from '@/engine/demo';
import { listInstruments } from '@/engine/instruments';
import { buildMetricsContext, isRelease, RELEASE_REACH_MIN, releaseDistance, releaseInstant, type ContextEvent } from '@/engine/metricsContext';
import { eventTypeOf, linkId, recomputeOntology, releaseLabel, tradeReleaseDistance, type Link } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { ET_ZONE, zonedToUtc } from '@/lib/time';

/** OROS5.7 : la distance d'un trade à sa publication, au moteur, partagée par Analyse et la fiche. */

const INSTRUMENTS = listInstruments().map((spec) => spec.symbol);
const toContext = (e: ContextEvent): ContextEvent => ({ date: e.date, timeET: e.timeET, title: e.title, impact: e.impact, estimated: e.estimated });

describe('OROS5.7 · sur le jeu de démonstration, la fiche lit les minutes d’Analyse', () => {
  const { sessions, trades } = generateDemoJournal({ endDate: new Date('2026-10-31T12:00:00Z') });
  // Les lignes officielles que lit Analyse : l'instantané embarqué de 2026, comme le desk hors réseau.
  const rows = materializeBundle({ from: '2026-01-01', to: '2026-12-31' });
  const context = buildMetricsContext({ root: 'NQ', bars: [], trades, sessions, events: rows.map(toContext) });
  const analyse = new Map(context.trades.map((row) => [row.tradeId, row]));
  const links = recomputeOntology({ notes: [], sessions, trades, events: rows, instruments: INSTRUMENTS }, [], 0);

  it('chaque distance de la fiche est une minute d’Analyse, pour la même publication, et la plus proche quand la publication est liée', () => {
    let read = 0;
    let nearest = 0;
    for (const trade of trades) {
      const row = analyse.get(trade.id)!;
      const own = tradeReleaseDistance(trade, links, rows);
      if (own) {
        read += 1;
        // Analyse range « publication − entrée » ; la fiche, « entrée − publication » : la même minute, signe inversé.
        expect(row.releaseMinutes.map((m) => -m)).toContain(own.minutes);
        expect(Math.abs(own.minutes)).toBeLessThanOrEqual(RELEASE_REACH_MIN);
        expect(own.family).toBe(eventTypeOf(own.title));
      }
      const m = row.minutesToRelease;
      if (m === null || Math.abs(m) > RELEASE_REACH_MIN) {
        // Hors fenêtre pour Analyse : rien pour la fiche, jamais 0.
        expect(own).toBeNull();
        continue;
      }
      const at = trade.entryTime + m * 60_000;
      const event = rows.find((e) => isRelease(e) && releaseInstant(e) === at)!;
      const linked = links.some((l) => l.predicate === 'pendant' && l.from.type === 'trade' && l.from.id === trade.id && l.to.id === event.id);
      if (linked) {
        nearest += 1;
        // `0 - m` et non `-m` : une entrée sur la publication même vaut 0, pas −0
        expect(own?.minutes).toBe(0 - m);
      } else {
        // Seul écart : une publication qui ne concerne pas l'instrument du trade (les stocks pétrole EIA, CL et MCL,
        // pour un trade NQ) entre dans les minutes d'Analyse, pas dans les liens « pendant » de la fiche.
        expect(event.instruments.length).toBeGreaterThan(0);
        expect(event.instruments).not.toContain(trade.instrument);
      }
    }
    expect(read).toBeGreaterThanOrEqual(20);
    expect(nearest).toBe(read);
  });
});

/* ─── Cas posés à la main ─── */

const DAY = '2026-10-14';
const et = (time: string, date = DAY) => zonedToUtc(date, time, ET_ZONE);
const CPI = { id: 'bls:cpi-2026-10', date: DAY, timeET: '08:30', title: 'Inflation CPI', impact: 3 as const, estimated: false, instruments: [] as string[] };
const EIA = { id: 'eia:wpsr-2026-10-14', date: DAY, timeET: '10:30', title: 'Stocks pétrole EIA', impact: 3 as const, estimated: false, instruments: ['CL', 'MCL'] };

function session(id: string, date = DAY): Session {
  return { id, date, account: 'SimApex1', instruments: ['MNQ'], source: 'manuel', tradeCount: 1, pnl: 0, grossProfit: 0, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

function trade(id: string, entry: number, sessionId = 's'): Trade {
  return { id, sessionId, instrument: 'MNQ', direction: 'long', qty: 1, entryTime: entry, exitTime: entry + 60_000, entryPrice: 1, exitPrice: 1, pnl: 0, commission: 0 };
}

function linksFor(trades: Trade[], events: (typeof CPI)[], extra: Link[] = []): Link[] {
  return [...recomputeOntology({ notes: [], sessions: [session('s')], trades, events, instruments: INSTRUMENTS }, [], 0), ...extra];
}

describe('OROS5.7 · un trade hors fenêtre vaut null, jamais 0', () => {
  it('« CPI +69 min » après, « CPI −10 min » avant ; 180 min au plus', () => {
    const rows = [trade('after', et('09:38') + 36_000), trade('before', et('08:20')), trade('edge', et('11:30')), trade('far', et('11:31')), trade('zero', et('08:30'))];
    const links = linksFor(rows, [CPI]);
    const d = (id: string) => tradeReleaseDistance(rows.find((t) => t.id === id)!, links, [CPI]);
    expect(d('after')).toMatchObject({ family: 'CPI', title: 'Inflation CPI', date: DAY, timeET: '08:30' });
    expect(d('after')!.minutes).toBeCloseTo(68.6, 10);
    expect(releaseLabel(d('after'))).toBe('CPI +69 min');
    expect(releaseLabel(d('before'))).toBe('CPI −10 min');
    expect(d('edge')!.minutes).toBe(RELEASE_REACH_MIN);
    // à 181 min de la publication : hors fenêtre, rien — ni 0, ni la publication
    expect(d('far')).toBeNull();
    expect(releaseLabel(d('far'))).toBe('—');
    // sur la publication même, 0 est une valeur : « CPI +0 min »
    expect(d('zero')!.minutes).toBe(0);
    expect(releaseLabel(d('zero'))).toBe('CPI +0 min');
  });

  it('un estimé, un lien rejeté ou un autre jour ne donnent aucune distance', () => {
    const rows = [trade('t', et('09:00'))];
    expect(tradeReleaseDistance(rows[0]!, linksFor(rows, [{ ...CPI, estimated: true }]), [{ ...CPI, estimated: true }])).toBeNull();
    // le lien « pendant » rejeté par le trader n'est plus un lien de la fiche
    const rejected: Link = { id: linkId({ type: 'trade', id: 't' }, 'pendant', { type: 'evenement', id: CPI.id }), from: { type: 'trade', id: 't' }, to: { type: 'evenement', id: CPI.id }, predicate: 'pendant', kind: 'rejete', by: 'utilisateur', createdAt: 0, updatedAt: 0 };
    expect(tradeReleaseDistance(rows[0]!, [rejected], [CPI])).toBeNull();
    // une publication d'un autre jour n'est pas « pendant » la séance
    const other = { ...CPI, id: 'bls:cpi-2026-10-15', date: '2026-10-15', timeET: '08:30' };
    expect(tradeReleaseDistance(rows[0]!, linksFor(rows, [other]), [other])).toBeNull();
  });

  it('Analyse garde ses minutes : une publication d’un autre instrument y entre, la fiche ne la lit pas', () => {
    const rows = [trade('t', et('10:40'))];
    const ctx = buildMetricsContext({ root: 'NQ', bars: [], trades: rows, sessions: [session('s')], events: [toContext(CPI), toContext(EIA)] });
    // publication − entrée, en minutes : la CPI à −130, l'EIA à −10 (la plus proche)
    expect(ctx.trades[0]!.releaseMinutes).toEqual([-130, -10]);
    expect(ctx.trades[0]!.minutesToRelease).toBe(-10);
    // la fiche ne lit que ses liens « pendant » : la CPI, qui concerne MNQ ; l'EIA ne concerne que CL et MCL
    const own = tradeReleaseDistance(rows[0]!, linksFor(rows, [CPI, EIA]), [CPI, EIA]);
    expect(own).toMatchObject({ family: 'CPI', minutes: 130 });
    expect(releaseDistance(rows[0]!.entryTime, [toContext(CPI), toContext(EIA)])).toMatchObject({ family: 'EIA', minutes: 10 });
  });
});
