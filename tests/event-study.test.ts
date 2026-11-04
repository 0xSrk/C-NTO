/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { EventStudy, studyFrame } from '@/app/objects/EventStudy';
import { ObjectDrawer } from '@/app/objects/Fiche';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { SAMPLE_FAIBLE } from '@/engine/ontology/confidence';
import type { CalEvent } from '@/engine/calendar';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { COMPARE_AFTER_MIN, COMPARE_BEFORE_MIN, compareEvent, valueAt } from '@/lib/frise';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { catalystSource } from '@/engine/macroMerge';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.37 — l'étude d'événement se lit à côté du miroir (Système 5 « Fiche et Frise » ; repris du prototype C · Frise, d3).
 * Dans la fiche d'un catalyseur, seconde lecture d'« Autour de… » sur sa famille, par `compareEvent` : la fenêtre de
 * t0 − 30 à t0 + 90 min, rebasée à t0 ; la bande min–max et la moyenne en escalier ; la journée choisie à l'or ; la ligne
 * en veille sous SAMPLE_FAIBLE. La table avec / sans lit la même fenêtre, avec son n.
 */

/** Mercredi 14 octobre 2026, 11 h à New York : le CPI du jour (08:30 ET) est publié et sa fenêtre close. */
const NOW = zonedToUtc('2026-10-14', '11:00', ET_ZONE);
const FAMILY_DATES = ['2026-06-10', '2026-07-14', '2026-08-12', '2026-09-10', '2026-10-14'];
/** Le 12 août : une publication sans séance. Les autres en ont une. */
const WITH_DATES = ['2026-06-10', '2026-07-14', '2026-09-10', '2026-10-14'];
/** Douze séances sans publication, à la même heure de New York. */
const WITHOUT_DATES = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-07-06', '2026-07-07', '2026-07-08', '2026-08-03', '2026-08-04', '2026-08-05', '2026-09-14', '2026-09-15', '2026-09-16'];

const at = (date: string, time: string) => zonedToUtc(date, time, ET_ZONE);
const session = (id: string, date: string, pnl: number): Session => ({ id, date, account: 'Apex-PA-50K', instruments: ['NQ'], source: 'ninjatrader', tradeCount: 2, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 });
const trade = (id: string, sessionId: string, exit: number, pnl: number): Trade => ({ id, sessionId, instrument: 'NQ', account: 'Apex-PA-50K', direction: 'long', qty: 1, entryTime: exit - 300_000, exitTime: exit, entryPrice: 1, exitPrice: 1, pnl, commission: 0 });

const SESSIONS: Session[] = [];
const TRADES: Trade[] = [];
WITH_DATES.forEach((date, i) => {
  const id = `w${i}`;
  // Une sortie avant la publication (−10 min), une après (+30 min) : la courbe passe par zéro à t0.
  TRADES.push(trade(`${id}a`, id, at(date, '08:20'), 50 + i * 10), trade(`${id}b`, id, at(date, '09:00'), i % 2 === 0 ? 120 : -80));
  SESSIONS.push(session(id, date, 50 + i * 10 + (i % 2 === 0 ? 120 : -80)));
});
WITHOUT_DATES.forEach((date, i) => {
  const id = `o${i}`;
  TRADES.push(trade(`${id}a`, id, at(date, '08:40'), i % 3 === 0 ? -40 : 30), trade(`${id}b`, id, at(date, '13:00'), 10));
  SESSIONS.push(session(id, date, (i % 3 === 0 ? -40 : 30) + 10));
});

const row = (id: string, date: string): CalendarEventRow => ({ id, sourceId: 'bls', date, timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: 0 }) as CalendarEventRow;
const EVENTS: CalEvent[] = FAMILY_DATES.map((date) => ({ id: `bls:cpi-${date}`, date, timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, source: 'bls' }) as CalEvent);

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: ReactNode): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const study = (chosen = '2026-10-14', sessions = SESSIONS, trades = TRADES) => mount(createElement(EventStudy, { events: EVENTS, family: 'cpi', sessions, trades, now: NOW, chosen }));
const tableRow = (node: HTMLElement, which: 'with' | 'without') => node.querySelector<HTMLElement>(`tr[data-study-row="${which}"]`)!;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('OROS5.37 l’étude d’événement à côté du miroir', () => {
  it('la courbe et la table lisent la même fenêtre : de t0 − 30 à t0 + 90 min, les mêmes séances', async () => {
    const cmp = compareEvent(EVENTS, 'cpi', SESSIONS, TRADES, NOW);
    const frame = studyFrame(cmp);
    // L'axe de la courbe : la fenêtre de la table, ses deux bords aux bords du tracé.
    expect(frame.domain).toEqual([-COMPARE_BEFORE_MIN, COMPARE_AFTER_MIN]);
    expect(frame.x(-COMPARE_BEFORE_MIN)).toBe(frame.left);
    expect(frame.x(COMPARE_AFTER_MIN)).toBe(frame.right);
    // Rebasée à t0 : chaque séance passe par zéro à la publication.
    for (const series of cmp.series) expect(valueAt(series.points, 0), series.date).toBe(0);
    const node = await study();
    const svg = node.querySelector('svg[role="img"]')!;
    expect([...svg.querySelectorAll('[data-tick]')].map((el) => el.textContent)).toEqual(['−30', 't0', '+30', '+60', '+90']);
    const caption = node.querySelector('table caption')!.textContent ?? '';
    expect(caption).toContain('t0 − 30 → t0 + 90');
    // Les mêmes séances : une courbe par publication tombée un jour de séance, la table « avec » sur ces journées.
    const drawn = [...svg.querySelectorAll<SVGPathElement>('path[data-series]')].map((p) => p.dataset.series);
    expect(drawn.sort()).toEqual(cmp.series.map((s) => s.date).sort());
    expect([...new Set(cmp.with.rows.map((r) => r.date))].sort()).toEqual(drawn);
    // La bande min–max et la moyenne en escalier, tracées des valeurs du moteur.
    expect(svg.querySelector('path[data-band]')!.getAttribute('d')).toBe(frame.bandPath);
    expect(svg.querySelector('path[data-mean]')!.getAttribute('d')).toBe(frame.meanPath);
    expect(frame.meanPath).toMatch(/^M[\d.]+ [\d.]+(H[\d.]+V[\d.]+)+$/);
    // La table : le P&L moyen de la fenêtre, la réussite, n.
    expect(tableRow(node, 'with').querySelector('[data-n]')!.textContent).toBe(String(cmp.with.n));
    expect(tableRow(node, 'without').querySelector('[data-n]')!.textContent).toBe(String(cmp.without.n));
  });

  it('n exact : journées alignées sur publications passées, et le n de chaque ligne', async () => {
    const cmp = compareEvent(EVENTS, 'cpi', SESSIONS, TRADES, NOW);
    expect([cmp.series.length, cmp.occurrences.length, cmp.with.n, cmp.without.n]).toEqual([4, 5, 4, 12]);
    const node = await study();
    expect(node.querySelector('[data-study-n]')!.textContent).toBe('n = 4 / 5');
    expect(tableRow(node, 'with').querySelector('[data-n]')!.textContent).toBe('4');
    expect(tableRow(node, 'without').querySelector('[data-n]')!.textContent).toBe('12');
  });

  it('sous SAMPLE_FAIBLE, la ligne est en veille et le dit ; au-delà, elle se lit pleine', async () => {
    expect(SAMPLE_FAIBLE).toBe(10);
    const node = await study();
    const withRow = tableRow(node, 'with');
    const withoutRow = tableRow(node, 'without');
    expect(withRow.hasAttribute('data-weak')).toBe(true);
    expect(withRow.textContent).toContain('échantillon insuffisant');
    expect(withoutRow.hasAttribute('data-weak')).toBe(false);
    // La moyenne, faite des seules séances « avec », se lit en veille elle aussi.
    expect(node.querySelector('path[data-mean]')!.hasAttribute('data-weak')).toBe(true);
    // Aucun signe réservé du châssis ne marque la veille : ni Signal ni C.131.
    expect(node.querySelector('[data-level], [class*="skg-131"]')).toBeNull();
  });

  it('la journée choisie à l’or : la séance du catalyseur ouvert ; sans séance ce jour-là, la légende le dit', async () => {
    const node = await study('2026-09-10');
    const chosen = [...node.querySelectorAll<SVGPathElement>('path[data-chosen]')];
    expect(chosen.map((p) => p.dataset.chosen)).toEqual(['2026-09-10']);
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/app/objects/fiche.module.css', 'utf8').replace(/\r\n/g, '\n');
    expect(css).toMatch(/\.studyChosen\s*\{[^}]*stroke:\s*var\(--gold\)/);
    expect(chosen[0]!.getAttribute('class')).toMatch(/studyChosen/);
    act(() => root?.unmount());
    host?.remove();
    const other = await study('2026-08-12');
    expect(other.querySelector('path[data-chosen]')).toBeNull();
    expect(other.querySelector('[data-study-key="chosen"]')!.textContent).toContain('12.08 · —');
  });

  it('role="img" dit la lecture, en trois langues', async () => {
    const node = await study();
    const label = node.querySelector('svg[role="img"]')!.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/^Inflation CPI : 4 journées alignées sur la publication, de t0 − 30 à t0 \+ 90 min ; moyenne [−+]?[\d\s,]+\s\$ à t0 \+ 90 min$/u);
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(node.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toMatch(/^CPI inflation: 4 days aligned on the release, from t0 − 30 to t0 \+ 90 min; mean /);
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(node.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toMatch(/: 4 jornadas alineadas en la publicación, de t0 − 30 a t0 \+ 90 min; media /);
  });

  it('OROS5.37a l’en-tête compte des journées, la table des séances : chacun nomme son unité, même à plusieurs comptes par jour', async () => {
    // Le Copieur sur trois comptes Sim : chaque publication tombée un jour de séance en porte trois.
    const accounts = ['Sim101', 'Sim102', 'Sim103'];
    const sessions = SESSIONS.flatMap((s) => accounts.map((account) => ({ ...s, id: `${s.id}-${account}`, account })));
    const trades = TRADES.flatMap((t) => accounts.map((account) => ({ ...t, id: `${t.id}-${account}`, sessionId: `${t.sessionId}-${account}`, account })));
    const cmp = compareEvent(EVENTS, 'cpi', sessions, trades, NOW);
    expect([cmp.series.length, cmp.occurrences.length, cmp.with.n]).toEqual([4, 5, 12]);
    const node = await study('2026-10-14', sessions, trades);
    const head = node.querySelector<HTMLElement>('[data-study-n]')!;
    expect(head.textContent).toBe('n = 4 / 5');
    expect(head.getAttribute('title')).toBe('Journées alignées sur la publication, les comptes du jour ensemble / publications passées de la famille');
    expect(node.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toMatch(/^Inflation CPI : 4 journées alignées sur la publication/);
    expect(node.querySelector('[data-study-key="series"]')!.textContent?.trim()).toBe('journées');
    // La table compte les séances, une par compte et par jour, et le dit.
    expect(tableRow(node, 'with').querySelector('[data-n]')!.textContent).toBe('12');
    expect(node.querySelector('th[data-study-unit]')!.getAttribute('title')).toBe('Séances : une par compte et par jour');
    // Plus aucun « séances » pour le nombre de l'en-tête.
    expect(`${head.getAttribute('title')} ${node.querySelector('svg[role="img"]')!.getAttribute('aria-label')}`).not.toMatch(/séances/);
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(head.getAttribute('title')).toBe('Days aligned on the release, the day’s accounts together / past releases of the family');
    expect(node.querySelector('th[data-study-unit]')!.getAttribute('title')).toBe('Sessions: one per account and day');
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(head.getAttribute('title')).toBe('Jornadas alineadas en la publicación, las cuentas del día juntas / publicaciones pasadas de la familia');
    expect(node.querySelector('th[data-study-unit]')!.getAttribute('title')).toBe('Sesiones: una por cuenta y día');
  });

  it('dans la fiche Catalyseur, la seconde lecture d’« Autour de… », après le miroir, dans le périmètre des puces', async () => {
    useObjects.setState(useObjects.getInitialState(), true);
    useUi.setState({ tab: 'calendrier', metricRange: 'tout', metricAccount: null, metricInstrument: null, metricHour: null });
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
    useJournal.setState({ sessions: SESSIONS, trades: TRADES });
    useNotes.setState({ notes: [] });
    useCalendar.setState({ entries: [] });
    useMacro.setState({ events: FAMILY_DATES.map((date) => row(`bls:cpi-${date}`, date)), sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
    useLinks.setState({ links: [] });
    const node = await mount(createElement(ObjectDrawer));
    act(() => void useObjects.getState().openObject({ type: 'evenement', id: 'bls:cpi-2026-10-14' }));
    const around = node.querySelector<HTMLElement>('aside[data-drawer] [data-section="around"]')!;
    const mirror = around.querySelector('[data-figure="M.036"]')!;
    const studied = around.querySelector<HTMLElement>('[data-study]')!;
    expect(studied).not.toBeNull();
    // Après le miroir, dans la même section.
    expect(mirror.compareDocumentPosition(studied) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // La journée du catalyseur ouvert à l'or, et le n des séances du périmètre : la source unique du catalyseur (les
    // repères locaux fusionnés aux lignes officielles, OROS5.13), comme la fiche la lit.
    expect([...studied.querySelectorAll<SVGPathElement>('path[data-chosen]')].map((p) => p.dataset.chosen)).toEqual(['2026-10-14']);
    const expected = compareEvent(catalystSource(useMacro.getState().events, [2026]), 'cpi', SESSIONS, TRADES, NOW);
    expect(expected.series.map((x) => x.date)).toEqual(expect.arrayContaining(WITH_DATES));
    expect(studied.querySelector('[data-study-n]')!.textContent).toBe(`n = ${expected.series.length} / ${expected.occurrences.length}`);
    // Le périmètre des puces : un autre compte, plus aucune séance alignée.
    act(() => useUi.setState({ metricAccount: 'Sim101' }));
    expect(studied.querySelector('[data-study-n]')!.textContent).toMatch(/^n = 0 \/ \d+$/);
    expect(studied.querySelector('path[data-mean]')).toBeNull();
  });
});
