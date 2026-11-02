/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { ObjectDrawer } from '@/app/objects/Fiche';
import { buildObjectIndex, useIndexSources } from '@/app/objects/index';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { computeTradeStats } from '@/engine/metrics';
import { entityKey, mirror, releaseLabel, tradeReleaseDistance, type EntityRef, type Link } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import type { Note } from '@/store/db';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.28 — le trade, la note, la stratégie et l'instrument ont chacun leur fiche, propriétés et liens, ouvertes par
 * Ctrl+J (l'index de l'omnibar) comme par les lignes des fiches. MAE et MFE inconnus se lisent « — », jamais zéro.
 */

const NOW = Date.parse('2026-10-27T16:00:00Z');
const S1 = { type: 'session', id: 's1' } as const;
const S2 = { type: 'session', id: 's2' } as const;
const CPI = 'bls:cpi-2026-10-14';

const session = (id: string, date: string, pnl: number, instruments = ['NQ']): Session => ({ id, date, account: 'Apex-PA-50K', instruments, source: 'ninjatrader', tradeCount: 1, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 2, tags: [], createdAt: 0, updatedAt: 0 });
const trade = (id: string, sessionId: string, entry: string, pnl: number, over: Partial<Trade> = {}): Trade => ({
  id,
  sessionId,
  instrument: 'NQ',
  account: 'Apex-PA-50K',
  direction: 'long',
  qty: 1,
  entryTime: Date.parse(entry),
  exitTime: Date.parse(entry) + 12 * 60_000,
  entryPrice: 20_000,
  exitPrice: 20_010,
  pnl,
  commission: 2.04,
  ...over,
});
const link = (from: EntityRef, predicate: Link['predicate'], to: EntityRef, kind: Link['kind'] = 'structurel', by: Link['by'] = 'moteur', score?: number): Link => ({
  id: `${entityKey(from)}|${predicate}|${entityKey(to)}`,
  from,
  to,
  predicate,
  kind,
  by,
  createdAt: 0,
  updatedAt: 0,
  ...(score !== undefined ? { score } : {}),
});
const note = (id: string, title: string, over: Partial<Note> = {}): Note => ({ id, title, body: '', tags: [], createdAt: 0, updatedAt: Date.parse('2026-10-20T10:00:00Z'), ...over });

const trades = [
  trade('t1', 's1', '2026-10-14T13:39:00Z', 196, { risk: 100, mae: 45.5, mfe: 260, strategy: 'ORB 15m', tags: ['A+'] }),
  trade('t2', 's2', '2026-10-20T14:00:00Z', -80),
  trade('t3', 's2', '2026-10-20T15:00:00Z', 40, { instrument: 'MNQ' }),
];
const STRAT = { type: 'strategie', id: 'n-orb' } as const;
const links: Link[] = [
  link({ type: 'trade', id: 't1' }, 'de-la-seance', S1),
  link({ type: 'trade', id: 't2' }, 'de-la-seance', S2),
  link({ type: 'trade', id: 't3' }, 'de-la-seance', S2),
  link({ type: 'trade', id: 't1' }, 'pendant', { type: 'evenement', id: CPI }),
  link(S1, 'applique', STRAT),
  link(S2, 'applique', STRAT, 'affirme', 'utilisateur'),
  link({ type: 'note', id: 'n-orb' }, 'mentionne', { type: 'instrument', id: 'NQ' }),
  link({ type: 'note', id: 'n-agent' }, 'relie', { type: 'note', id: 'n-orb' }, 'hypothese', 'moteur', 0.48),
];

let root: Root | null = null;
let host: HTMLElement | null = null;
const drawer = () => host!.querySelector<HTMLElement>('aside[data-drawer]')!;
/** Les espaces insécables des nombres (U+202F, U+00A0) lus comme des espaces. */
const norm = (text: string | null | undefined) => (text ?? '').replace(/[\u202f\u00a0]/g, ' ');
const props = () => Object.fromEntries([...drawer().querySelectorAll('[data-section="properties"] [class*="prop"]')].filter((row) => row.querySelector('dt')).map((row) => [row.querySelector('dt')!.textContent, norm(row.querySelector('dd')!.textContent)]));
const groups = () => [...drawer().querySelectorAll<HTMLElement>('[data-group]')].map((g) => g.dataset.group);
const open = (ref: EntityRef) => act(() => void useObjects.getState().openObject(ref));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique' });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, riskPerContract: 0 } });
  useJournal.setState({ sessions: [session('s1', '2026-10-14', 194), session('s2', '2026-10-20', -44, ['NQ', 'MNQ'])], trades });
  useNotes.setState({
    notes: [
      note('n-orb', 'ORB 15 minutes', { tags: ['strategie'], body: '---\ntag: orb\nstatut: modele\n---\nOuverture de range.' }),
      note('n-agent', 'Lecture de l’agent', { by: 'agent', parentId: 'n-orb' }),
    ],
  });
  useMacro.setState({
    events: [{ id: CPI, sourceId: 'bls', date: '2026-10-14', timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: 0 } as CalendarEventRow],
    sources: [],
    syncing: false,
    lastError: undefined,
    load: async () => undefined,
    sync: async () => undefined,
  });
  useLinks.setState({ links });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ObjectDrawer)));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('OROS5.28 une fiche par type', () => {
  it('le trade : entrée, sortie, R, MAE et MFE, la distance à la publication du moteur, ses liens', () => {
    open({ type: 'trade', id: 't1' });
    expect(drawer().querySelector('div[data-fiche]')!.getAttribute('data-fiche')).toBe('trade');
    expect(drawer().querySelector('h2')!.textContent).toBe('Trade · NQ L 1 · 14.10 09:39 ET');
    expect(drawer().querySelector('[data-ident="numeral"] b')!.textContent).toBe('+196,00');
    const p = props();
    expect(p['Entrée']).toBe('09:39 ET · 20 000,00');
    expect(p['Sortie']).toBe('09:51 ET · 20 010,00');
    expect(p['R réalisé']).toBe('+1,96 R');
    expect(p['MAE']).toBe('45,50 $');
    expect(p['MFE']).toBe('260,00 $');
    expect(p['Stratégie']).toBe('ORB 15m');
    // la distance à la publication, lue au moteur, sans ellipse
    const catalysts = [{ id: CPI, date: '2026-10-14', timeET: '08:30', title: 'Inflation CPI', impact: 3 as const, estimated: false }];
    expect(p['Publication']).toBe(releaseLabel(tradeReleaseDistance(trades[0]!, links, catalysts)));
    expect(p['Publication']).toBe('CPI +69 min');
    // son échelle en R, sa séance en lien, ses liens par prédicat
    expect(drawer().querySelector('[data-section="rscale"] svg[data-rscale]')).not.toBeNull();
    expect(drawer().querySelector('[data-section="identity"] button[data-object="session:s1"]')).not.toBeNull();
    expect(groups()).toEqual(['out:de-la-seance:session', 'out:pendant:evenement']);
  });

  it('MAE et MFE inconnus : « — », jamais zéro ; sans risque connu, ni R ni échelle', () => {
    open({ type: 'trade', id: 't2' });
    const p = props();
    expect(p['MAE']).toBe('—');
    expect(p['MFE']).toBe('—');
    expect(p['R réalisé']).toBe('—');
    expect(p['Risque']).toBe('—');
    expect(p['Publication']).toBe('—');
    expect(drawer().querySelector('[data-section="identity"]')!.textContent).toContain('MAE —');
    expect(drawer().querySelector('[data-rscale="absent"]')!.textContent).toBe('R —');
  });

  it('la note : sa source, son auteur, son statut, sa suite et ses liens (l’hypothèse comprise)', () => {
    open({ type: 'note', id: 'n-agent' });
    expect(drawer().querySelector('div[data-fiche]')!.getAttribute('data-fiche')).toBe('note');
    const p = props();
    expect(p['Source']).toBe('coffre de notes');
    expect(p['Auteur']).toBe('agent · non adoptée');
    expect(p['Statut']).toBe('opinion');
    expect(p['Suite de']).toContain('ORB 15 minutes');
    expect(groups()).toEqual(['out:relie:note']);
    expect(drawer().querySelector('[data-group="out:relie:note"] [data-link="hypothese"]')).not.toBeNull();
    // la note de stratégie dit son statut et mène à sa stratégie
    open({ type: 'note', id: 'n-orb' });
    expect(props()['Statut']).toBe('modèle');
    expect(drawer().querySelector('button[data-object="strategie:n-orb"]')!.textContent).toBe('#orb');
  });

  it('la stratégie : les séances qui l’appliquent et leur résultat, lu par le moteur', () => {
    open(STRAT);
    expect(drawer().querySelector('div[data-fiche]')!.getAttribute('data-fiche')).toBe('strategie');
    const { sessions, trades: rows } = useJournal.getState();
    const inside = mirror(sessions, rows, new Set(['s1', 's2'])).inside;
    expect(props()['Séances qui l’appliquent']).toBe(String(inside.sessions));
    expect(inside.net).toBe(150);
    expect(drawer().querySelector('[data-ident="numeral"] b')!.textContent).toBe('+150,00');
    expect(norm(drawer().querySelector('[data-section="identity"]')!.textContent)).toContain('67 %');
    expect(drawer().querySelector('[data-section="identity"]')!.textContent).toContain('3 trades');
    // l'objet stratégie est `strategie:n-orb` : les liens de la note elle-même restent à la fiche Note
    expect(groups()).toEqual(['in:applique:session']);
    expect(drawer().querySelectorAll('[data-group="in:applique:session"] button')).toHaveLength(2);
  });

  it('l’instrument : ses séances, ses trades, leur réussite, lus par le moteur', () => {
    open({ type: 'instrument', id: 'NQ' });
    expect(drawer().querySelector('div[data-fiche]')!.getAttribute('data-fiche')).toBe('instrument');
    const nq = computeTradeStats(trades.filter((t) => t.instrument === 'NQ'));
    const p = props();
    expect(p['Séances']).toBe('2');
    expect(p['Trades · gagnants']).toBe(`${nq.count} · ${nq.wins}`);
    expect(norm(drawer().querySelector('[data-ident="numeral"] b')!.textContent)).toBe('50 %');
    expect(p['Nom']).not.toBe('—');
    expect(groups()).toEqual(['in:mentionne:note']);
  });

  it('chaque type s’ouvre par Ctrl+J et par les lignes des fiches, jamais sur la fiche commune ; describe ne les dit plus', () => {
    let index: ReturnType<typeof buildObjectIndex> = [];
    function Probe() {
      const sources = useIndexSources(NOW);
      index = buildObjectIndex(sources, NOW, 'fr');
      return null;
    }
    const probe = document.createElement('div');
    const probeRoot = createRoot(probe);
    act(() => probeRoot.render(createElement(Probe)));
    for (const type of ['trade', 'note', 'strategie', 'instrument'] as const) {
      const items = index.filter((item) => item.group === type);
      expect(items.length, type).toBeGreaterThan(0);
      for (const item of items) {
        const target = item.target;
        if (target.kind !== 'object') continue;
        const ref = target.ref;
        act(() => void useObjects.getState().openObject(ref, { jump: true, focus: true }));
        expect(drawer().querySelector('div[data-fiche]')!.getAttribute('data-fiche'), item.key).toBe(type);
      }
    }
    act(() => probeRoot.unmount());
    // depuis une ligne de lien : la séance mène au trade, le trade à sa séance
    open(STRAT);
    act(() => drawer().querySelector<HTMLButtonElement>('[data-group="in:applique:session"] button')!.click());
    expect(drawer().querySelector('div[data-fiche]')!.getAttribute('data-fiche')).toBe('session');
    const source = readFileSync('src/app/objects/Fiche.tsx', 'utf8');
    const describeBody = source.slice(source.indexOf('function describe('), source.indexOf("/** La source d'une publication"));
    expect(describeBody.length).toBeGreaterThan(100);
    for (const type of ['trade', 'note', 'strategie', 'instrument', 'session', 'compte']) expect(describeBody, type).not.toContain(`case '${type}'`);
    expect(source).not.toMatch(/OtherFiche|TradeRow/);
  });
});
