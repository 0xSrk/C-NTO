/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { ObjectDrawer } from '@/app/objects/Fiche';
import e from '@/design/etat.module.css';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { catalystSource, familyKey } from '@/engine/macroMerge';
import { mirror, ENTITY_TYPES, type EntityRef, type EntityType, type Link } from '@/engine/ontology';
import { STROKE_ETAT } from '@/app/objects/index';
import { strokeOf } from '@/lib/calendarMarks';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.29 — la colonne de droite du Calendrier devient la vue du Jour : toutes les séances de la date et leur total à
 * partir de deux, les publications (attendu, précédent, publié), les trois notes du jour avec leur source. Un repère ouvre
 * la fiche Catalyseur : l'heure de New York au numéral, celle du poste dessous, l'impact, l'état par le trait, les
 * occurrences, « Autour de… » et M.036. Plus aucun type ne tombe sur une fiche générique.
 */

/** Mercredi 14 octobre 2026, 11 h à New York. */
const NOW = zonedToUtc('2026-10-14', '11:00', ET_ZONE);
const DAY = '2026-10-14';
const CPI = 'bls:cpi-2026-10-14';
const CPI_NEXT = 'bls:cpi-2026-11-12';

const session = (id: string, date: string, account: string, pnl: number, note?: string): Session => ({ id, date, account, instruments: ['NQ'], source: 'ninjatrader', tradeCount: 2, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], ...(note ? { note } : {}), createdAt: 0, updatedAt: 0 });
const trade = (id: string, sessionId: string, at: string, pnl: number): Trade => ({ id, sessionId, instrument: 'NQ', account: 'Apex-PA-50K', direction: 'long', qty: 1, entryTime: Date.parse(at), exitTime: Date.parse(at) + 60_000, entryPrice: 1, exitPrice: 1, pnl, commission: 0 });
const row = (id: string, date: string, title: string, actual?: string): CalendarEventRow => ({ id, sourceId: 'bls', date, timeET: '08:30', title, category: 'inflation', impact: 3, instruments: [], forecast: '0.3%', previous: '0.4%', ...(actual ? { actual } : {}), estimated: false, syncedAt: 0 }) as CalendarEventRow;
const link = (from: EntityRef, predicate: Link['predicate'], to: EntityRef): Link => ({ id: `${from.type}:${from.id}|${predicate}|${to.type}:${to.id}`, from, to, predicate, kind: 'structurel', by: 'moteur', createdAt: 0, updatedAt: 0 });

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: ReactNode): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}
async function calendrier(): Promise<HTMLElement> {
  const { default: Calendrier } = await import('@/modules/calendrier/Calendrier');
  return mount(createElement(Calendrier));
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'calendrier', focusDate: DAY });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, calendarView: 'flux' } });
  useJournal.setState({
    sessions: [session('s1', DAY, 'Apex-PA-50K', -120, 'Entrée sur la publication, trop tôt.'), session('s2', DAY, 'Sim101', 300), session('s3', '2026-09-10', 'Apex-PA-50K', 80)],
    trades: [trade('t1', 's1', '2026-10-14T13:40:00Z', -120), trade('t2', 's2', '2026-10-14T14:00:00Z', 300), trade('t3', 's3', '2026-09-10T14:00:00Z', 80)],
  });
  useNotes.setState({
    notes: [
      { id: 'n-day', title: `${DAY} Journal`, body: '', tags: [], createdAt: 0, updatedAt: 0 },
      { id: 'n-other', title: 'Plan de trading', body: '', tags: [], createdAt: 0, updatedAt: 0 },
    ],
  });
  useCalendar.setState({ entries: [{ id: 'c1', date: DAY, kind: 'note', body: 'Biais vendeur avant le CPI.', createdAt: 0, updatedAt: 0 } as never] });
  useMacro.setState({ events: [row(CPI, DAY, 'Inflation CPI', '0.2%'), row('bls:cpi-2026-09-10', '2026-09-10', 'Inflation CPI', '0.4%'), row(CPI_NEXT, '2026-11-12', 'Inflation CPI')], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useLinks.setState({ links: [link({ type: 'session', id: 's1' }, 'pendant', { type: 'evenement', id: CPI }), link({ type: 'session', id: 's3' }, 'pendant', { type: 'evenement', id: 'bls:cpi-2026-09-10' })] });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('OROS5.29 la vue du Jour', () => {
  it('le Jour liste toutes les séances de la date, leur total à partir de deux ; la case et le flux disent le total', async () => {
    const node = await calendrier();
    const view = node.querySelector<HTMLElement>(`[data-day-view="${DAY}"]`)!;
    expect(view).not.toBeNull();
    // les deux séances, plus seulement la première (le panneau prenait `sessions.find`)
    expect([...view.querySelectorAll<HTMLElement>('[data-day-session]')].map((b) => b.dataset.daySession)).toEqual(['s1', 's2']);
    expect(view.querySelector('[data-day-total]')!.textContent).toMatch(/\+180,00.*total des 2 séances/);
    expect(view.querySelector('header')!.textContent).toContain('2 séances');
    // une séance ouvre sa fiche, ↑ ↓ passant à l'autre séance du jour
    act(() => view.querySelector<HTMLButtonElement>('[data-day-session="s2"]')!.click());
    expect(useObjects.getState().open).toEqual({ type: 'session', id: 's2' });
    expect(useObjects.getState().siblings).toEqual([
      { type: 'session', id: 's1' },
      { type: 'session', id: 's2' },
    ]);
    act(() => void useObjects.getState().close(false));
    // le flux dit le total du jour et ses deux séances
    expect(node.querySelector(`[data-day="${DAY}"]`)!.textContent).toMatch(/\+180.*2 séances/);
    // une seule séance : pas de total, son P&L est sur sa ligne
    act(() => useJournal.setState({ sessions: useJournal.getState().sessions.filter((x) => x.id !== 's2') }));
    expect(node.querySelector(`[data-day-view="${DAY}"] [data-day-total]`)).toBeNull();
    expect(node.querySelectorAll(`[data-day-view="${DAY}"] [data-day-session]`)).toHaveLength(1);
  });

  it('les publications du jour avec l’attendu, le précédent et le publié, chacune son trait de la table d’états', async () => {
    const node = await calendrier();
    const cpi = node.querySelector<HTMLElement>(`[data-day-view="${DAY}"] [data-day-event="${CPI}"]`)!;
    expect(cpi.textContent).toContain('Inflation CPI');
    expect(cpi.textContent).toContain('08:30 ET');
    expect(cpi.textContent).toContain('att. 0.3% · préc. 0.4% · publ. 0.2%');
    expect(cpi.querySelector('[data-stroke="publie"]')!.classList.contains(e.plein!)).toBe(true);
    expect(cpi.querySelector('svg.skg-90')).not.toBeNull();
  });

  it('les trois notes du jour, réunies, chacune avec sa source', async () => {
    const node = await calendrier();
    const view = node.querySelector<HTMLElement>(`[data-day-view="${DAY}"]`)!;
    const notes = [...view.querySelectorAll<HTMLElement>('[data-day-note]')];
    expect(notes.map((n) => n.dataset.dayNote)).toEqual(['seance', 'coffre', 'calendrier']);
    expect(notes[0]!.textContent).toBe('séance · Apex-PA-50KEntrée sur la publication, trop tôt.');
    expect(notes[1]!.textContent).toBe(`coffre · Note${DAY} Journal`);
    expect(notes[2]!.textContent).toContain('calendrier · personnel');
    expect(notes[2]!.querySelector('textarea')!.value).toBe('Biais vendeur avant le CPI.');
    // la note du coffre ouvre sa fiche
    act(() => notes[1]!.click());
    expect(useObjects.getState().open).toEqual({ type: 'note', id: 'n-day' });
  });

  it('un repère ouvre la fiche Catalyseur, depuis le Jour comme depuis le flux ; la fiche prend la place de la colonne', async () => {
    const node = await calendrier();
    act(() => node.querySelector<HTMLButtonElement>(`[data-day-event="${CPI}"]`)!.click());
    expect(useObjects.getState().open).toEqual({ type: 'evenement', id: CPI });
    expect(node.querySelector('[data-day-view]')).toBeNull();
    expect(node.querySelector('[data-legend="trait"]')).toBeNull();
    act(() => void useObjects.getState().close(false));
    const flux = node.querySelector<HTMLElement>(`[data-event="${CPI}"]`)!;
    act(() => flux.click());
    expect(useObjects.getState().open).toEqual({ type: 'evenement', id: CPI });
    expect(useObjects.getState().origin).toBe(flux);
    act(() => void useObjects.getState().close(false));
    act(() => void flux.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(useObjects.getState().open).toEqual({ type: 'evenement', id: CPI });
    // L.01 et L.02 en tête de la colonne, une ligne chacune
    act(() => void useObjects.getState().close(false));
    const legends = node.querySelector('aside')!.firstElementChild!;
    expect([...legends.querySelectorAll<HTMLElement>('[data-legend]')].map((l) => l.dataset.legend)).toEqual(['trait', 'impact']);
    // la source du Calendrier est celle de la fiche et de l'ontologie
    expect(readFileSync('src/modules/calendrier/Calendrier.tsx', 'utf8')).toMatch(/catalystSource\(eventsMacro/);
    expect(readFileSync('src/modules/calendrier/Calendrier.tsx', 'utf8')).not.toMatch(/mergeCalendarEvents|generateNasdaqEvents/);
  });
});

describe('OROS5.29 la fiche Catalyseur', () => {
  it('08:30 ET au numéral, l’heure du poste dessous ; l’impact, l’état par le trait, les occurrences, « Autour de… » et M.036', async () => {
    // OROS5.32 : le périmètre de la lecture est celui des puces de la sélection partagée ; la lecture sur tout l'historique
    // que tient ce test est la puce Période à TOUT (trente jours au démarrage écarteraient la séance du 10.09).
    useUi.setState({ metricRange: 'tout', metricAccount: null, metricInstrument: null });
    const node = await mount(createElement(ObjectDrawer));
    act(() => void useObjects.getState().openObject({ type: 'evenement', id: CPI }));
    const fiche = node.querySelector<HTMLElement>('aside[data-drawer] div[data-fiche="evenement"]')!;
    expect(fiche).not.toBeNull();
    expect(node.querySelector('aside[data-drawer] h2')!.textContent).toBe('Catalyseur · Inflation CPI · 14.10');
    const numeral = fiche.querySelector('[data-ident="numeral"]')!;
    expect(numeral.querySelector('b')!.textContent).toBe('08:30 ET');
    expect(numeral.querySelector(':scope > span')!.textContent).toMatch(/^\d{2}:30 poste$/);
    const ident = fiche.querySelector('[data-section="identity"]')!;
    expect(ident.textContent).toContain('impact 3/3');
    expect(ident.querySelector('[data-state="publie"]')!.textContent).toContain('publiée');
    expect(ident.querySelector('[data-state="publie"] [data-etat]')!.classList.contains(e.plein!)).toBe(true);
    // les occurrences de la famille, de la source unique (les estimés locaux marqués « ≈ ») : chacune son trait et la
    // séance du jour
    const occ = [...fiche.querySelectorAll<HTMLElement>('[data-occurrence]')];
    const family = catalystSource(useMacro.getState().events, [2026]).filter((x) => familyKey(x.title) === 'cpi' && x.date >= '2026-09-10' && x.date <= '2026-12-13');
    expect(occ.map((o) => o.dataset.occurrence)).toEqual(family.map((x) => x.id));
    expect(occ.map((o) => o.dataset.occurrence ?? '').filter((id) => id.startsWith('bls:'))).toEqual(['bls:cpi-2026-09-10', CPI, CPI_NEXT]);
    expect(occ.map((o) => o.dataset.stroke)).toEqual(family.map((x) => strokeOf(x, NOW)));
    const next = occ.find((o) => o.dataset.occurrence === CPI_NEXT)!;
    expect(next.querySelector('[data-etat]')!.classList.contains(e[STROKE_ETAT[strokeOf(family.find((x) => x.id === CPI_NEXT)!, NOW)]]!)).toBe(true);
    for (const o of occ) expect(o.textContent!.startsWith('≈'), o.dataset.occurrence).toBe(!o.dataset.occurrence!.startsWith('bls:'));
    expect(occ.find((o) => o.dataset.occurrence === CPI)!.querySelector('button')!.textContent).toContain('+180,00');
    // « Autour de… » : les séances « pendant » la famille face au reste, par le moteur ; l'échantillon de chaque côté
    const { sessions, trades } = useJournal.getState();
    const reading = mirror(sessions, trades, new Set(['s1', 's3']));
    const around = fiche.querySelector('[data-section="around"]')!;
    expect(around.textContent).toContain('2 séances · 2 trades');
    const m = around.querySelector('[data-figure="M.036"]')!;
    expect(m.querySelector('[data-mirror="sessions"]')!.textContent).toBe(`${reading.inside.sessions}Séances${reading.outside.sessions}`);
    expect(m.querySelector('[data-mirror="sample"]')!.textContent).toBe('insuffisantéchantilloninsuffisant');
    // l'attendu, le précédent, le publié
    expect(fiche.querySelector('[data-section="properties"]')!.textContent).toMatch(/Attendu0\.3%Précédent0\.4%Publié0\.2%/);
  });

  it('plus aucun type ne tombe sur une fiche générique ; un objet absent garde le cadre seul', async () => {
    const node = await mount(createElement(ObjectDrawer));
    const refs: Record<EntityType, EntityRef> = {
      session: { type: 'session', id: 's1' },
      trade: { type: 'trade', id: 't1' },
      note: { type: 'note', id: 'n-other' },
      strategie: { type: 'strategie', id: 'n-other' },
      instrument: { type: 'instrument', id: 'NQ' },
      evenement: { type: 'evenement', id: CPI },
      compte: { type: 'compte', id: 'Apex-PA-50K' },
    };
    expect(Object.keys(refs).sort()).toEqual([...ENTITY_TYPES].sort());
    for (const type of ENTITY_TYPES) {
      act(() => void useObjects.getState().openObject(refs[type]));
      expect(node.querySelector('aside[data-drawer] div[data-fiche]')!.getAttribute('data-fiche'), type).toBe(type);
    }
    act(() => void useObjects.getState().openObject({ type: 'session', id: 'gone' }));
    expect(node.querySelector('aside[data-drawer] div[data-fiche]')!.getAttribute('data-fiche')).toBe('missing');
    expect(node.querySelector('aside[data-drawer]')!.textContent).toContain('Cet objet n’est plus au coffre.');
    const source = readFileSync('src/app/objects/Fiche.tsx', 'utf8');
    expect(source).not.toMatch(/function describe\(|data-fiche="common"/);
  });
});
