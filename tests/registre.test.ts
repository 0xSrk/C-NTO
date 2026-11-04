/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { ObjectDrawer } from '@/app/objects/Fiche';
import { RailGates } from '@/app/RailGates';
import { activityOf, closeRegistre, eventTarget, KIND_GLYPH, logEvents, openRegistre, registreScope, useRegistre, type RegistreContext } from '@/app/registre';
import { RegistreDrawer } from '@/app/RegistreDrawer';
import { matchShortcut, SHORTCUTS } from '@/app/shortcuts';
import { GLYPH_ID } from '@/design/Micro';
import { RESERVED_GLYPHS } from '@/design/micro/meaning';
import { DESK_EVENT_KINDS, type DeskEventKind } from '@/engine/agent/catalog';
import { EVENT_LOG_MAX, type DeskEvent } from '@/engine/agent/events';
import type { CalEvent } from '@/engine/calendar';
import type { EntityRef } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { useCalendar } from '@/store/calendar';
import { deskEventLog, recordDeskEvent } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.38 — l'activité de chaque objet (Système 5 « Fiche et Frise » ; repris du prototype D · Porte, d4). `deskEventLog`,
 * filtré sur l'objet, devient la section Activité de chaque fiche ; le registre complet s'ouvre en tiroir bas : mode liste
 * et filtres par genre, portée écrite (« depuis l'ouverture · en mémoire · 500 au plus »), chaque ligne ouvre la fiche de
 * son objet, ↑ ↓ et Entrée, Échap rend le focus. Aucune ligne ne porte un signe réservé.
 */

const NOW = Date.parse('2026-10-14T14:05:00Z');
const APEX = 'Apex-PA-50K';
const CPI = 'bls:cpi-2026-10-14';

const session = (id: string, date: string, account: string): Session => ({ id, date, account, instruments: ['NQ'], source: 'ninjatrader', tradeCount: 1, pnl: 100, grossProfit: 100, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 });
const SESSIONS = [session('s1', '2026-10-14', APEX), session('s2', '2026-10-14', 'Sim101'), session('s3', '2026-10-13', APEX)];
const TRADES: Trade[] = [
  { id: 't1', sessionId: 's1', instrument: 'NQ', account: APEX, direction: 'long', qty: 1, entryTime: Date.parse('2026-10-14T13:39:30Z'), exitTime: Date.parse('2026-10-14T13:55:00Z'), entryPrice: 1, exitPrice: 2, pnl: 100, commission: 0 },
  { id: 't2', sessionId: 's2', instrument: 'MNQ', account: 'Sim101', direction: 'long', qty: 1, entryTime: Date.parse('2026-10-14T13:59:00Z'), exitTime: Date.parse('2026-10-14T14:02:00Z'), entryPrice: 1, exitPrice: 2, pnl: 10, commission: 0 },
];
const CATALYSTS = [{ id: CPI, date: '2026-10-14', timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, source: 'bls' } as CalEvent];
const CTX: RegistreContext = { sessions: SESSIONS, trades: TRADES, catalysts: CATALYSTS };

/** Les événements du lancement, un par genre (et deux exécutions), rangés par le vrai chemin du desk. */
const RECORDED: [DeskEventKind, Record<string, unknown>][] = [
  ['fill', { account: APEX, instrument: 'NQ 12-26', action: 'Buy', quantity: 1, price: 20_000, time: '2026-10-14T13:40:00.000Z', entryExit: 'Entry' }],
  ['fill', { account: 'Sim101', instrument: 'MNQ 12-26', action: 'Sell', quantity: 1, price: 20_010, time: '2026-10-14T14:00:00.000Z', entryExit: 'Exit' }],
  ['order', { account: 'apex-pa-50k ', instrument: 'NQ 12-26', side: 'buy', qty: 1, type: 'limit', state: 'Working', byAgent: false }],
  ['prop_buffer', { planId: 'apex-50', account: APEX, threshold: 0.5, breached: false, remainingShare: 0.42 }],
  ['catalyst', { title: 'Inflation CPI', at: '2026-10-14T12:30:00.000Z', date: '2026-10-14', timeET: '08:30', minutesBefore: 15, impact: 3 }],
  ['bridge_link', { from: 'connecting', to: 'live' }],
  ['agent_order', { by: 'agent', status: 'refused', account: 'SimApex1', instrument: 'MNQ', side: 'buy', qty: 3, reason: 'quantity' }],
  ['daily_loss', { day: '2026-10-14', account: 'Sim101', consumed: 0.8, loss: 400, limit: 500 }],
  ['discipline', { finding: 'over_max_trades', family: 'rule', account: APEX, instrument: 'NQ 12-26', at: '2026-10-14T13:40:00.000Z', day: '2026-10-14', detail: { ordinal: 4, max: 3 } }],
  ['crypto_alert', { alertId: 'a1', target: 'BTC', kind: 'price', level: 70_000 }],
];

let EVENTS: DeskEvent[] = [];
let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: ReactNode): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const kinds = (list: readonly DeskEvent[]) => list.map((ev) => `${ev.kind}${ev.kind === 'fill' ? `:${String(ev.data.account)}` : ''}`);

beforeAll(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  for (const [kind, data] of RECORDED) recordDeskEvent(kind, data);
  vi.useRealTimers();
  EVENTS = logEvents(deskEventLog);
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useRegistre.setState({ open: false, kinds: [], origin: null });
  useUi.setState({ tab: 'metrique', friseOpen: false, metricRange: 'tout', metricAccount: null, metricInstrument: null, metricHour: null });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useJournal.setState({ sessions: SESSIONS, trades: TRADES });
  useNotes.setState({ notes: [{ id: 'n1', title: 'Plan de trading', body: '', tags: [], createdAt: 0, updatedAt: 0 }] });
  useCalendar.setState({ entries: [] });
  useMacro.setState({ events: [{ id: CPI, sourceId: 'bls', date: '2026-10-14', timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: 0 } as never], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useLinks.setState({ links: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('OROS5.38 l’activité de chaque objet, le registre en tiroir', () => {
  it('le registre se lit en entier, du plus ancien au plus récent, sans rien retirer au journal', () => {
    expect(kinds(EVENTS)).toEqual(['fill:Apex-PA-50K', 'fill:Sim101', 'order', 'prop_buffer', 'catalyst', 'bridge_link', 'agent_order', 'daily_loss', 'discipline', 'crypto_alert']);
    expect(logEvents(deskEventLog)).toHaveLength(RECORDED.length);
  });

  it('filtre exact par objet : le compte (la règle de la garde), l’instrument, la séance, le trade, le catalyseur ; rien pour une note', () => {
    const of = (ref: EntityRef) => kinds(activityOf(ref, EVENTS, CTX)).reverse();
    // le compte : le nom exact ou replié (« apex-pa-50k  »), jamais un autre compte ni « tous les comptes »
    expect(of({ type: 'compte', id: APEX })).toEqual(['fill:Apex-PA-50K', 'order', 'prop_buffer', 'discipline']);
    expect(of({ type: 'compte', id: 'Sim101' })).toEqual(['fill:Sim101', 'daily_loss']);
    expect(of({ type: 'compte', id: 'SimApex1' })).toEqual(['agent_order']);
    // l'instrument, par sa racine : NQ n'est pas MNQ
    expect(of({ type: 'instrument', id: 'NQ' })).toEqual(['fill:Apex-PA-50K', 'order', 'discipline']);
    expect(of({ type: 'instrument', id: 'MNQ' })).toEqual(['fill:Sim101', 'agent_order']);
    // la séance : son compte et sa journée CME
    expect(of({ type: 'session', id: 's1' })).toEqual(['fill:Apex-PA-50K', 'order', 'prop_buffer', 'discipline']);
    expect(of({ type: 'session', id: 's3' })).toEqual([]);
    // le trade : son compte, son instrument, entre son entrée et sa sortie
    expect(of({ type: 'trade', id: 't1' })).toEqual(['fill:Apex-PA-50K', 'discipline']);
    expect(of({ type: 'trade', id: 't2' })).toEqual(['fill:Sim101']);
    // le catalyseur : sa journée, sa famille
    expect(of({ type: 'evenement', id: CPI })).toEqual(['catalyst']);
    expect(of({ type: 'note', id: 'n1' })).toEqual([]);
    // du plus récent au plus ancien
    expect(activityOf({ type: 'compte', id: APEX }, EVENTS, CTX).map((ev) => ev.seq)).toEqual([...activityOf({ type: 'compte', id: APEX }, EVENTS, CTX).map((ev) => ev.seq)].sort((a, b) => b - a));
  });

  it('chaque ligne ouvre la fiche de son objet ; le lien du pont et une alerte crypto n’en ont pas', () => {
    const targets = EVENTS.map((ev) => eventTarget(ev, CTX));
    expect(targets).toEqual([
      { type: 'session', id: 's1' },
      { type: 'session', id: 's2' },
      { type: 'compte', id: APEX },
      { type: 'compte', id: APEX },
      { type: 'evenement', id: CPI },
      null,
      { type: 'compte', id: 'SimApex1' },
      { type: 'compte', id: 'Sim101' },
      { type: 'session', id: 's1' },
      null,
    ]);
  });

  it('aucun signe réservé dans la table genre → glyphe ; chaque genre a le sien, de la bibliothèque unique', () => {
    const reserved = Object.keys(RESERVED_GLYPHS).map(Number);
    expect(Object.keys(KIND_GLYPH).sort()).toEqual([...DESK_EVENT_KINDS].sort());
    for (const kind of DESK_EVENT_KINDS) {
      const n = GLYPH_ID[KIND_GLYPH[kind]];
      expect(n, kind).toBeTypeOf('number');
      expect(reserved, `${kind} → C.${n}`).not.toContain(n);
    }
  });

  it('portée écrite, en trois langues : « depuis l’ouverture · en mémoire · 500 au plus »', async () => {
    expect(EVENT_LOG_MAX).toBe(500);
    expect(registreScope()).toBe('depuis l’ouverture · en mémoire · 500 au plus');
    const node = await mount(createElement(RegistreDrawer));
    act(() => void openRegistre(null));
    const drawer = node.querySelector<HTMLElement>('[data-registre]')!;
    expect(drawer).not.toBeNull();
    expect(drawer.querySelector('[data-registre-scope]')!.textContent).toBe('depuis l’ouverture · en mémoire · 500 au plus');
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(drawer.querySelector('[data-registre-scope]')!.textContent).toBe('since opening · in memory · 500 at most');
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(drawer.querySelector('[data-registre-scope]')!.textContent).toBe('desde la apertura · en memoria · 500 como máximo');
  });

  it('le tiroir : mode liste, du plus récent au plus ancien ; filtres par genre ; aucune ligne ne porte un signe réservé', async () => {
    const node = await mount(createElement(RegistreDrawer));
    act(() => void openRegistre(null));
    const rows = () => [...node.querySelectorAll<HTMLElement>('[data-registre] li[data-seq]')];
    expect(rows().map((li) => li.dataset.kind)).toEqual([...EVENTS].reverse().map((ev) => ev.kind));
    const reserved = Object.keys(RESERVED_GLYPHS).map(Number);
    for (const li of rows()) for (const n of reserved) expect(li.querySelector(`.skg-${n}`), `${li.dataset.kind} C.${n}`).toBeNull();
    // un genre retenu : ses seules lignes ; un second s'y ajoute ; retirés, toutes reviennent
    const chip = (kind: string) => node.querySelector<HTMLButtonElement>(`[data-registre] button[data-kind-filter="${kind}"]`)!;
    expect([...node.querySelectorAll<HTMLElement>('[data-registre] button[data-kind-filter]')].map((b) => b.dataset.kindFilter)).toEqual([...DESK_EVENT_KINDS]);
    await act(async () => chip('fill').click());
    expect(rows().map((li) => li.dataset.kind)).toEqual(['fill', 'fill']);
    expect(chip('fill').getAttribute('aria-pressed')).toBe('true');
    await act(async () => chip('catalyst').click());
    expect(rows().map((li) => li.dataset.kind)).toEqual(['catalyst', 'fill', 'fill']);
    await act(async () => chip('fill').click());
    await act(async () => chip('catalyst').click());
    expect(rows()).toHaveLength(RECORDED.length);
  });

  it('↑ ↓ et Entrée : Entrée ouvre la bonne fiche ; une ligne sans objet n’ouvre rien ; Échap ferme et rend le focus', async () => {
    const node = await mount(createElement('div', null, createElement('button', { id: 'origine' }, 'Registre'), createElement(RegistreDrawer), createElement(ObjectDrawer)));
    const origin = node.querySelector<HTMLButtonElement>('#origine')!;
    origin.focus();
    act(() => void openRegistre(origin));
    const list = node.querySelector<HTMLElement>('[data-registre] [role="listbox"]')!;
    expect(document.activeElement).toBe(list);
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => void list.dispatchEvent(event));
      return event.defaultPrevented;
    };
    const active = () => list.querySelector<HTMLElement>(`#${list.getAttribute('aria-activedescendant')}`)!;
    // la première ligne : la plus récente, l'alerte crypto, sans objet
    expect(active().dataset.kind).toBe('crypto_alert');
    expect(press('Enter')).toBe(true);
    expect(useObjects.getState().open).toBeNull();
    // ↓ : l'écart, qui ouvre la séance du 14 sur Apex-PA-50K
    expect(press('ArrowDown')).toBe(true);
    expect(active().dataset.kind).toBe('discipline');
    expect(press('Enter')).toBe(true);
    expect(useObjects.getState().open).toEqual({ type: 'session', id: 's1' });
    expect(node.querySelector('aside[data-drawer="session"]')).not.toBeNull();
    // ↓ ↓ ↑ : la perte du jour, le compte Sim101
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowUp');
    expect(active().dataset.kind).toBe('daily_loss');
    press('Enter');
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: 'Sim101' });
    // le gestionnaire lit le registre des raccourcis
    expect(SHORTCUTS.filter((x) => x.scope === 'registre').map((x) => x.id)).toEqual(['registreChoose', 'registreOpen', 'registreClose']);
    expect(matchShortcut('registre', new KeyboardEvent('keydown', { key: 'Escape' }))?.id).toBe('registreClose');
    const source = readFileSync('src/app/RegistreDrawer.tsx', 'utf8');
    expect(source).toMatch(/matchShortcut\('registre', event\)/);
    expect(source).not.toMatch(/\.key\s*[!=]==/);
    // Échap ferme le tiroir et rend le focus à ce qui l'a ouvert
    expect(press('Escape')).toBe(true);
    expect(useRegistre.getState().open).toBe(false);
    expect(node.querySelector('[data-registre]')).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it('un clic sur une ligne ouvre sa fiche ; sous le verrou, le registre ne s’ouvre pas', async () => {
    const node = await mount(createElement(RegistreDrawer));
    act(() => void openRegistre(null));
    const row = [...node.querySelectorAll<HTMLElement>('[data-registre] li[data-seq]')].find((li) => li.dataset.kind === 'catalyst')!;
    await act(async () => row.click());
    expect(useObjects.getState().open).toEqual({ type: 'evenement', id: CPI });
    act(() => closeRegistre(false));
    act(() => useObjects.getState().setLocked(true));
    expect(openRegistre(null)).toBe(false);
    expect(useRegistre.getState().open).toBe(false);
  });

  it('la section Activité de chaque fiche : l’activité filtrée sur l’objet, chaque ligne ouvre sa fiche', async () => {
    const node = await mount(createElement(ObjectDrawer));
    act(() => void useObjects.getState().openObject({ type: 'compte', id: APEX }));
    const activity = () => node.querySelector<HTMLElement>('aside[data-drawer] [data-section="activity"]')!;
    expect(activity()).not.toBeNull();
    const lines = () => [...activity().querySelectorAll<HTMLElement>('[data-seq]')];
    expect(lines().map((el) => el.dataset.kind)).toEqual(['discipline', 'prop_buffer', 'order', 'fill']);
    expect(activity().textContent).toContain('depuis l’ouverture · en mémoire · 500 au plus');
    // une ligne ouvre la fiche de son objet : l'exécution, sa séance
    await act(async () => lines().find((el) => el.dataset.kind === 'fill')!.querySelector('button')!.click());
    expect(useObjects.getState().open).toEqual({ type: 'session', id: 's1' });
    expect(lines().map((el) => el.dataset.kind)).toEqual(['discipline', 'prop_buffer', 'order', 'fill']);
    // chaque type a sa section, vide quand rien ne le touche
    for (const ref of [{ type: 'instrument', id: 'NQ' }, { type: 'trade', id: 't1' }, { type: 'evenement', id: CPI }, { type: 'note', id: 'n1' }] as EntityRef[]) {
      act(() => void useObjects.getState().openObject(ref));
      expect(activity(), ref.type).not.toBeNull();
    }
    expect(activity().textContent).toContain('Rien depuis l’ouverture');
    // et le registre entier s'ouvre de là
    await act(async () => activity().querySelector<HTMLButtonElement>('button[data-registre-open]')!.click());
    expect(useRegistre.getState().open).toBe(true);
  });

  it('au rail, « Registre n » ouvre le registre, son nom accessible le dit', async () => {
    const node = await mount(createElement('div', null, createElement(RailGates), createElement(RegistreDrawer)));
    const link = node.querySelector<HTMLButtonElement>('button[data-registry]')!;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain(`Registre${RECORDED.length}`);
    expect(link.getAttribute('aria-label')).toBe(`Registre du lancement : ${RECORDED.length} événement(s), en mémoire — ouvrir le registre`);
    await act(async () => link.click());
    expect(useRegistre.getState().open).toBe(true);
    expect(useRegistre.getState().origin).toBe(link);
    expect(node.querySelector('[data-registre]')).not.toBeNull();
  });
});
