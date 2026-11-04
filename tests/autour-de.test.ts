/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { ObjectDrawer } from '@/app/objects/Fiche';
import { sampleWord } from '@/app/objects/sample';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { entityKey, groupNeighbors, mirror, neighborsOf, sampleOf, setNeighborGroups, type EntityRef, type Link } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.31 — « Autour de… » depuis toute fiche : chaque prédicat de l'objet proposé avec son compte ; les sauts
 * s'enchaînent ; le chemin s'écrit au glacier dans l'ordre du saut et finit sur l'ensemble affiché ; Retour arrière défait
 * le dernier saut, l'état rendu portant l'ensemble ; M.036 met l'ensemble face au reste, l'échantillon de chaque côté.
 */

const NOW = Date.parse('2026-10-27T16:00:00Z');
const CPI = 'bls:cpi-2026-10-14';
const S1: EntityRef = { type: 'session', id: 's1' };
const session = (id: string, date: string, pnl: number): Session => ({ id, date, account: 'Apex-PA-50K', instruments: ['NQ'], source: 'ninjatrader', tradeCount: 1, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 });
const trade = (id: string, sessionId: string, at: string, pnl: number): Trade => ({ id, sessionId, instrument: 'NQ', account: 'Apex-PA-50K', direction: 'long', qty: 1, entryTime: Date.parse(at), exitTime: Date.parse(at) + 60_000, entryPrice: 1, exitPrice: 1, pnl, commission: 0 });
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

const SESSIONS = [session('s1', '2026-10-14', -120), session('s2', '2026-10-14', 300), session('s3', '2026-10-15', 50), session('s4', '2026-10-20', -80)];
const TRADES = [trade('t1', 's1', '2026-10-14T13:40:00Z', -120), trade('t2', 's2', '2026-10-14T14:10:00Z', 300), trade('t3', 's3', '2026-10-15T14:00:00Z', 50), trade('t4', 's4', '2026-10-20T14:00:00Z', -80)];
const LINKS: Link[] = [
  link({ type: 'trade', id: 't1' }, 'de-la-seance', S1),
  link({ type: 'trade', id: 't2' }, 'de-la-seance', { type: 'session', id: 's2' }),
  link({ type: 'trade', id: 't3' }, 'de-la-seance', { type: 'session', id: 's3' }),
  link(S1, 'pendant', { type: 'evenement', id: CPI }),
  link({ type: 'session', id: 's2' }, 'pendant', { type: 'evenement', id: CPI }),
  link({ type: 'trade', id: 't1' }, 'pendant', { type: 'evenement', id: CPI }),
  link({ type: 'trade', id: 't2' }, 'pendant', { type: 'evenement', id: CPI }),
  link({ type: 'note', id: 'n-plan' }, 'mentionne', S1, 'affirme', 'utilisateur'),
  link({ type: 'note', id: 'n-x' }, 'relie', S1, 'rejete', 'utilisateur'),
];

let root: Root | null = null;
let host: HTMLElement | null = null;
const fiche = () => host!.querySelector<HTMLElement>('aside[data-drawer]')!;
const around = () => fiche().querySelector<HTMLElement>('[data-section="around"]')!;
const predicates = () => [...around().querySelectorAll<HTMLElement>('[data-predicate]')].map((row) => [row.dataset.predicate, row.querySelector('[class*="groupCount"]')!.textContent]);
const follow = (id: string) => act(() => around().querySelector<HTMLButtonElement>(`[data-predicate="${id}"]`)!.click());
/** Ce que la section montre : les prédicats de l'objet, ou un ensemble. */
const mode = () => around().querySelector<HTMLElement>('[data-around]')!.dataset.around;
const path = () => [...around().querySelectorAll<HTMLElement>('[data-path] [data-step]')].map((step) => step.textContent);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique' });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useJournal.setState({ sessions: SESSIONS, trades: TRADES });
  useNotes.setState({ notes: [{ id: 'n-plan', title: 'Plan de trading', body: '', tags: [], createdAt: 0, updatedAt: 0 }] });
  useMacro.setState({ events: [{ id: CPI, sourceId: 'bls', date: '2026-10-14', timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: 0 } as CalendarEventRow], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useLinks.setState({ links: LINKS });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ObjectDrawer)));
  act(() => void useObjects.getState().openObject(S1));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('OROS5.31 « Autour de… » à tous les prédicats', () => {
  it('tous les prédicats d’une séance, avec leur compte, tels que le moteur groupe ses liens ; le rejeté n’est pas proposé', () => {
    const expected = groupNeighbors(neighborsOf(S1, LINKS))
      .filter((g) => g.count > 0)
      .map((g) => [g.id, String(g.count)]);
    expect(predicates()).toEqual(expected);
    expect(predicates()).toEqual([
      ['in:de-la-seance:trade', '1'],
      ['out:pendant:evenement', '1'],
      ['in:mentionne:note', '1'],
    ]);
    expect(around().querySelector('[data-predicate="in:mentionne:note"]')!.textContent).toMatch(/← mentionne.*Note.*1/);
    expect(mode()).toBe('object');
  });

  it('deux sauts enchaînés, au glacier dans l’ordre du saut ; deux Retour arrière rendent l’état initial, l’ensemble compris', () => {
    const initial = { open: useObjects.getState().open, set: useObjects.getState().set, history: useObjects.getState().history.length };
    // premier saut : la publication que la séance a « pendant »
    follow('out:pendant:evenement');
    const first = useObjects.getState().set!;
    expect(first).toMatchObject({ from: S1, type: 'evenement', members: [{ type: 'evenement', id: CPI }] });
    expect(mode()).toBe('set');
    expect(path()).toEqual(['14.10 · Apex-PA-50K', '→ pendant', '1 catalyseur']);
    // depuis l'ensemble, ses prédicats : les sauts s'enchaînent (la séance d'origine compte parmi les séances « pendant »)
    const fromSet = setNeighborGroups(first.members, LINKS).filter((g) => g.count > 0);
    expect(predicates()).toEqual(fromSet.map((g) => [g.id, String(new Set(g.items.map((n) => n.ref.id)).size)]));
    follow('in:pendant:session');
    const second = useObjects.getState().set!;
    expect(second.type).toBe('session');
    expect(second.members.map((m) => m.id)).toEqual(['s1', 's2']);
    expect(path()).toEqual(['14.10 · Apex-PA-50K', '→ pendant', '1 catalyseur', '← pendant', '2 séances']);
    // le chemin finit sur l'ensemble affiché, à l'ivoire ; ses arêtes au glacier
    const steps = [...around().querySelectorAll<HTMLElement>('[data-path] [data-step]')];
    expect(steps.at(-1)!.className).toMatch(/pathLast/);
    const edge = cssRules(readFileSync('src/app/objects/fiche.module.css', 'utf8')).find((rule) => rule.selector === '.pathEdge')!.body;
    expect(edge).toMatch(/color: var\(--ice\)/);
    expect([...around().querySelectorAll<HTMLElement>('[data-member]')].map((row) => row.dataset.member)).toEqual(['session:s1', 'session:s2']);
    // deux sauts dans l'historique ; Retour arrière défait le dernier, l'état rendu portant l'ensemble d'avant
    expect(useObjects.getState().history).toHaveLength(initial.history + 2);
    act(() => void useObjects.getState().back());
    expect(useObjects.getState().set).toEqual(first);
    expect(path()).toEqual(['14.10 · Apex-PA-50K', '→ pendant', '1 catalyseur']);
    act(() => void useObjects.getState().back());
    expect({ open: useObjects.getState().open, set: useObjects.getState().set, history: useObjects.getState().history.length }).toEqual(initial);
    expect(mode()).toBe('object');
    expect(around().querySelector('[data-path]')).toBeNull();
  });

  it('M.036 met l’ensemble face au reste, l’échantillon de chaque côté', () => {
    follow('out:pendant:evenement');
    follow('in:pendant:session');
    const reading = mirror(SESSIONS, TRADES, new Set(['s1', 's2']));
    const m = around().querySelector<HTMLElement>('[data-figure="M.036"]')!;
    expect(m.getAttribute('aria-label')).toBe('l’ensemble | le reste');
    expect(m.querySelector('[data-mirror="sessions"]')!.textContent).toBe(`${reading.inside.sessions}Séances${reading.outside.sessions}`);
    expect(m.querySelector('[data-mirror="sample"]')!.textContent).toBe(`${sampleWord(sampleOf(reading.inside.trades))}échantillon${sampleWord(sampleOf(reading.outside.trades))}`);
    // un ensemble de trades se lit par leurs séances ; un ensemble d'un autre type n'a pas de miroir
    act(() => void useObjects.getState().back());
    act(() => void useObjects.getState().back());
    follow('in:de-la-seance:trade');
    expect(around().querySelector('[data-figure="M.036"] [data-mirror="sessions"]')!.textContent).toBe('1Séances3');
    act(() => void useObjects.getState().back());
    follow('out:pendant:evenement');
    expect(around().querySelector('[data-figure="M.036"]')).toBeNull();
  });

  it('un membre de l’ensemble ouvre sa fiche, ↑ ↓ y parcourent l’ensemble ; Retour arrière revient à l’ensemble', () => {
    follow('out:pendant:evenement');
    follow('in:pendant:session');
    const shown = useObjects.getState().set;
    act(() => around().querySelector<HTMLButtonElement>('[data-member="session:s2"]')!.click());
    expect(useObjects.getState().open).toEqual({ type: 'session', id: 's2' });
    expect(useObjects.getState().siblings).toEqual([S1, { type: 'session', id: 's2' }]);
    // la fiche de s2 s'ouvre sans l'ensemble de s1 ; Retour arrière rend s1 et son ensemble
    expect(useObjects.getState().set).toBeNull();
    act(() => void useObjects.getState().back());
    expect(useObjects.getState().open).toEqual(S1);
    expect(useObjects.getState().set).toEqual(shown);
  });

  it('depuis toute fiche : chaque type pose sa section « Autour de… »', () => {
    const refs: EntityRef[] = [S1, { type: 'trade', id: 't1' }, { type: 'evenement', id: CPI }, { type: 'note', id: 'n-plan' }, { type: 'compte', id: 'Apex-PA-50K' }, { type: 'instrument', id: 'NQ' }];
    for (const ref of refs) {
      act(() => void useObjects.getState().openObject(ref));
      expect(fiche().querySelector('[data-section="around"] [data-around]'), ref.type).not.toBeNull();
    }
    // la fiche Catalyseur propose d'abord la famille : les séances « pendant » l'une de ses publications
    act(() => void useObjects.getState().openObject({ type: 'evenement', id: CPI }));
    expect(predicates()[0]).toEqual(['family', '2']);
    follow('family');
    expect(path()).toEqual(['Inflation CPI · 14.10', '← pendant · la famille', '2 séances']);
  });
});
