/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));
// Le tableau de bord (graphiques sur canevas) n'est pas l'objet du test : Métrique n'y sert qu'à prendre une demande.
vi.mock('@/modules/metrique/Dashboard', () => ({ Dashboard: () => null }));
// Le compteur des rejeux : la fonction même, enveloppée, pour tous les modules qui l'importent.
vi.mock('@/engine/propfirm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/engine/propfirm')>();
  return { ...actual, evaluatePlan: vi.fn(actual.evaluatePlan) };
});

import { Shell } from '@/app/Shell';
import { borneCells } from '@/app/StatusBornes';
import { useDayBornes } from '@/app/useDayBornes';
import { dayBornes, replayBornes, type DayBornes } from '@/engine/bornes';
import { DEFAULT_TRADER_RULES, majorCatalysts, type TraderRules } from '@/engine/discipline';
import { catalystSource } from '@/engine/macroMerge';
import { evaluatePlan, findPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { useI18n, type Locale } from '@/i18n';
import type { NtBridgeStatus } from '@/lib/desk';
import { fmtInt, fmtPct, fmtUsd } from '@/lib/format';
import { etDateKey } from '@/lib/time';
import { useKillLatch } from '@/app/killState';
import { etClock } from '@/app/objects/index';
import { useBridge } from '@/store/bridge';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.22 — les bornes du jour dans la barre d'état (Système 5, décisions 6 et 7). La barre devient la ligne de la
 * journée : le pont et son âge, la perte du jour sur sa limite et sa source, les trades sur leur maximum, la marge datée.
 * Les valeurs sont celles de `src/engine/bornes.ts` ; « — », jamais 0, pour l'absence ; chaque cellule a son nom
 * accessible complet et ouvre sa coupe, sans rien écrire. TYO, PAR et « CME GLOBEX » cèdent leur place, New York reste.
 */

/** Mardi 27 octobre 2026, 11 h à New York : la journée CME du 27. */
const NOW = Date.parse('2026-10-27T15:00:00Z');
const TODAY = '2026-10-27';
const APEX = 'Apex-PA-50K';
const RULES: TraderRules = { ...DEFAULT_TRADER_RULES, maxDailyLoss: 500, maxTradesPerDay: 6, catalystBlackoutMin: 15 };

function session(id: string, date: string, pnl: number, tradeCount = 1, account = APEX): Session {
  return { id, date, account, instruments: ['MNQ'], source: 'demo', tradeCount, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}
function trade(id: string, sessionId: string, at: number, pnl: number, account = APEX): Trade {
  return { id, sessionId, instrument: 'MNQ', account, direction: 'long', qty: 1, entryTime: at, exitTime: at + 60_000, entryPrice: 1, exitPrice: 1, pnl, commission: 0 };
}
function nt(over: Partial<NtBridgeStatus> = {}, unrealized: Record<string, number> = {}): NtBridgeStatus {
  return {
    link: 'live',
    port: 0,
    addonVersion: '2.2.0',
    ntVersion: '8.1',
    accountsAt: NOW - 4_000,
    accounts: Object.entries(unrealized).map(([name, unrealizedPnl]) => ({ name, cashValue: 0, realizedPnl: 0, unrealizedPnl, positions: [] })),
    accountNames: Object.keys(unrealized),
    heartbeatLatencyMs: 12,
    ordersOpen: true,
    ordersClosed: false,
    hasToken: true,
    extraAccounts: [],
    maxContractsPerOrder: 5,
    killSwitchShortcut: 'CommandOrControl+Shift+K',
    ...over,
  } as NtBridgeStatus;
}

/** Les états du banc : hors ligne (journal seul), puis en séance, à 75 % de la limite, puis franchie. */
function bench(state: 'offline' | 'live' | 'warn' | 'breach', planAccount = APEX) {
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount, traderRules: RULES } });
  useJournal.setState({ sessions: [session('s0', '2026-10-26', -63, 4), session('s1', TODAY, -100, 3)], trades: [trade('t1', 's1', Date.parse('2026-10-27T13:00:00Z'), -100)] });
  const unrealized = state === 'breach' ? -423.5 : state === 'warn' ? -286.25 : -24;
  useBridge.setState({ nt: state === 'offline' ? null : nt({}, { Sim101: -40, [APEX]: unrealized }) });
}

/** Les bornes que le calcul unique rend pour les stores du banc : la même entrée que `useDayBornes`. */
function expected(now = NOW): DayBornes {
  const { settings } = useSettings.getState();
  const { sessions, trades } = useJournal.getState();
  const status = useBridge.getState().nt;
  const year = Number(etDateKey(now).slice(0, 4));
  const replay = replayBornes({ sessions, trades, account: settings.planAccount, plan: findPlan(settings.planId) ?? null, rules: settings.traderRules });
  return dayBornes(replay, {
    now,
    link: status?.link ?? 'absent',
    accountsAt: status?.accountsAt ?? null,
    accounts: status?.accounts ?? [],
    catalysts: majorCatalysts(catalystSource(useMacro.getState().events, [year, year + 1])),
    ordersOpen: status?.ordersOpen,
    ordersClosed: status?.ordersClosed,
    killLatched: useKillLatch.getState().engaged,
    maxContractsPerOrder: status?.maxContractsPerOrder ?? null,
  });
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactNode = createElement(Shell, null, createElement('div', null, 'module'))): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const status = () => host!.querySelector<HTMLElement>('[data-chassis="status"]')!;
const cell = (key: string) => status().querySelector<HTMLButtonElement>(`[data-borne="${key}"]`);
const cells = () => [...status().querySelectorAll<HTMLButtonElement>('[data-borne]')];
/** Le texte d'une cellule : la valeur seule (`<b>`), la forme longue quand elle en a deux. */
const valueOf = (key: string) => {
  const b = cell(key)!.querySelector('b')!;
  return (b.querySelector('span') ?? b).textContent;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'note', modalRequest: null });
  useNotes.setState({ notes: [] });
  useLinks.setState({ links: [] });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useKillLatch.setState({ engaged: false });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  useBridge.setState({ nt: null });
  useJournal.setState({ sessions: [], trades: [] });
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useI18n.setState({ locale: 'fr' });
});

describe('OROS5.22 · les bornes du jour dans la barre d’état', () => {
  it('valeurs croisées avec bornes.ts : la perte du jour et sa source, les trades sur le maximum, la marge datée ; la plus proche à l’ivoire', () => {
    for (const state of ['live', 'warn', 'breach', 'offline'] as const) {
      bench(state);
      mount();
      const b = expected();
      const tag = state;
      expect(cells().map((c) => c.dataset.borne), tag).toEqual(['loss', 'trades', 'margin']);
      // la perte du jour : sa valeur, sa limite et sa source, au niveau des bornes (C.012 à 75 %, C.123 au-delà) ; franchie,
      // la journée est fermée (décision 15, OROS5.48b, changement voulu) et la valeur le dit
      const closed = b.loss.closedSince !== null ? ` · journée fermée depuis ${etClock(b.loss.closedSince)} ET` : '';
      expect(b.loss.closedSince !== null, tag).toBe(state === 'breach');
      expect(valueOf('loss'), tag).toBe(`${fmtInt(b.loss.value!)} / ${fmtUsd(500)}${closed}${b.day.today ? '' : ' · 26.10'}`);
      expect(cell('loss')!.dataset.level, tag).toBe(String(b.loss.level));
      expect(cell('loss')!.querySelector('[data-source]')?.getAttribute('data-source'), tag).toBe('trader');
      const signal = cell('loss')!.querySelector<HTMLElement>('[data-level]:not([data-borne])');
      if (b.loss.level === 0) expect(signal, tag).toBeNull();
      else {
        expect(signal?.dataset.level, tag).toBe(String(b.loss.level));
        expect(signal!.classList.contains('sig-l3'), tag).toBe(b.loss.level === 3);
      }
      // les trades et leur matrice C.114
      expect(valueOf('trades'), tag).toBe(`${b.trades.count} / 6${b.day.today ? '' : ' · 26.10'}`);
      const matrix = cell('trades')!.querySelector('svg')!;
      expect(matrix.dataset.shown, tag).toBe('6');
      expect(matrix.dataset.taken, tag).toBe(String(b.trades.count));
      // la marge datée, C.140 : la valeur de la garde et la date de K.04
      const margin = b.margin;
      const date = margin.date ? `${margin.date.slice(8, 10)}.${margin.date.slice(5, 7)}` : '';
      const said = margin.status === 'en-cours' ? fmtUsd(margin.value) : margin.status === 'objectif' ? 'objectif atteint' : 'compte invalidé';
      expect(valueOf('margin'), tag).toBe(`${said}${date ? ` · ${date}` : ''}`);
      expect(cell('margin')!.querySelector('.skg-140'), tag).not.toBeNull();
      // la borne la plus proche passe à l'ivoire ; les autres restent au graphite
      for (const c of cells()) expect(c.hasAttribute('data-nearest'), `${tag} ${c.dataset.borne}`).toBe(c.dataset.borne === b.nearest);
      act(() => root!.unmount());
      host!.remove();
      root = null;
    }
    const css = readFileSync('src/app/shell.module.css', 'utf8');
    expect(css).toMatch(/\.borne \{[^}]*color: var\(--text-2\);/);
    expect(css).toMatch(/\.borneNear \{\s*color: var\(--text-0\);\s*\}/);
  });

  it('OROS5.45 à l’étroit, la date d’une valeur d’un autre jour cède : C.013 la marque, le nom accessible la dit', () => {
    bench('offline');
    // hors ligne, la dernière séance est d'hier : la valeur se date
    useJournal.setState({ sessions: [session('s0', '2026-10-26', -63, 4)], trades: [] });
    mount();
    const b = expected();
    expect(b.day.today).toBe(false);
    for (const key of ['loss', 'trades']) {
      const forms = [...cell(key)!.querySelector('b')!.querySelectorAll('span')].map((el) => el.textContent);
      expect(forms, key).toHaveLength(3);
      // la forme longue et la courte gardent la date ; la plus étroite (sous 1 480 px) la laisse
      expect(forms[0], key).toMatch(/ · 26\.10$/);
      expect(forms[1], key).toBe(forms[0]);
      expect(forms[2], key).toBe(forms[0]!.replace(' · 26.10', ''));
      expect(cell(key)!.querySelector('.skg-13'), key).not.toBeNull();
    }
    const css = readFileSync('src/app/shell.module.css', 'utf8');
    expect(css).toMatch(/@container status \(max-width: 1480px\) \{[^}]*\.valueShort,[^}]*display: none;[^}]*\}\s*\.valueNarrow,/);
  });

  it('« — », jamais 0 : une borne réglée sans valeur ; zéro n’est dit que quand il est lu ; rien de réglé, « Bornes à régler »', () => {
    // une limite et un maximum réglés, aucune séance du compte suivi, pont hors ligne : rien n'est lu
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: APEX, traderRules: RULES } });
    useJournal.setState({ sessions: [], trades: [] });
    mount();
    expect(cells().map((c) => c.dataset.borne)).toEqual(['loss', 'trades']);
    expect(valueOf('loss')).toBe(`— / ${fmtUsd(500)}`);
    expect(valueOf('trades')).toBe('— / 6');
    expect(cell('trades')!.querySelector('svg')!.dataset.taken).toBe('0');
    for (const c of cells()) expect(c.querySelector('b')!.textContent, c.dataset.borne).not.toMatch(/^0\b/);
    expect(cell('loss')!.getAttribute('aria-label')).toMatch(/^Perte du jour non lue, limite /);
    // en séance, sans trade : zéro est une valeur
    act(() => useBridge.setState({ nt: nt({}, { [APEX]: 0 }) }));
    expect(valueOf('loss')).toBe(`0 / ${fmtUsd(500)}`);
    expect(valueOf('trades')).toBe('0 / 6');
    // rien de réglé : une seule cellule, qui le dit
    act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: '', traderRules: DEFAULT_TRADER_RULES } }));
    expect(cells().map((c) => c.dataset.borne)).toEqual(['settings']);
    expect(cell('settings')!.textContent).toContain('Bornes à régler');
    expect(cell('settings')!.querySelector('b')).toBeNull();
  });

  it('chaque cellule porte un nom accessible complet, en trois langues', () => {
    bench('warn');
    mount();
    const said = (locale: Locale) => {
      act(() => useI18n.setState({ locale }));
      return cells().map((c) => c.getAttribute('aria-label'));
    };
    const [loss, trades, margin] = said('fr');
    // l'exemple du plan : la valeur sur sa limite, ce qui reste, la source, le compte, l'âge du pont
    expect(loss).toBe(`Perte du jour 386 sur ${fmtUsd(500)}, reste 114, ${fmtPct(0.7725, 0)} de la limite, règle du trader, compte Apex-PA-50K, pont il y a 4 s`);
    expect(trades).toBe('Trades 3 sur 6, reste 3, règle du trader, compte Apex-PA-50K, pont il y a 4 s');
    expect(margin).toMatch(/^Marge au plancher /);
    expect(margin).toContain('compte Apex-PA-50K');
    for (const c of cells()) expect(c.getAttribute('title')).toBe(c.getAttribute('aria-label'));
    const [lossEn, tradesEn] = said('en');
    expect(lossEn).toBe(`Day loss 386 of ${fmtUsd(500)}, 114 left, ${fmtPct(0.7725, 0)} of the limit, trader rule, account Apex-PA-50K, bridge 4 s ago`);
    expect(tradesEn).toBe('Trades 3 of 6, 3 left, trader rule, account Apex-PA-50K, bridge 4 s ago');
    const [lossEs] = said('es');
    expect(lossEs).toBe(`Pérdida del día 386 de ${fmtUsd(500)}, quedan 114, ${fmtPct(0.7725, 0)} del límite, regla del trader, cuenta Apex-PA-50K, puente hace 4 s`);
    // franchie : ce qui dépasse ; hors ligne : la dernière séance, datée
    act(() => useI18n.setState({ locale: 'fr' }));
    act(() => bench('breach'));
    // OROS5.48b (changement voulu) : franchie, la journée est fermée depuis l'instant lu, et le nom accessible le dit
    expect(cell('loss')!.getAttribute('aria-label')).toBe(`Perte du jour 524 sur ${fmtUsd(500)}, dépassée de 24, journée fermée depuis 11:00 ET, règle du trader, compte Apex-PA-50K, pont il y a 4 s`);
    act(() => bench('offline'));
    act(() => useJournal.setState({ sessions: [session('s0', '2026-10-26', -63, 4)], trades: [] }));
    expect(cell('loss')!.getAttribute('aria-label')).toBe(`Perte du jour 63 sur ${fmtUsd(500)}, reste 437, règle du trader, compte Apex-PA-50K, dernière séance, 26.10`);
    // le pont, son âge, ses comptes et sa latence : lisibles, jamais dans une ellipse
    act(() => bench('live'));
    const bridge = status().querySelector<HTMLElement>('[data-status="bridge"]')!;
    expect(bridge.getAttribute('aria-label')).toBe('Pont NT8 en direct, comptes lus il y a 4 s');
    expect(bridge.textContent).toContain('il y a 4 s');
    expect(status().querySelector('[data-status="accounts"]')!.textContent).toBe(`Sim101 · ${APEX}`);
    expect(status().querySelector('[data-status="latency"]')!.textContent).toBe('LATENCE 12 MS');
    const css = readFileSync('src/app/shell.module.css', 'utf8');
    expect(css).toMatch(/\.statusKeep \{\s*flex: none;\s*white-space: nowrap;\s*\}/);
  });

  it('aucune écriture : chaque cellule ouvre la fiche du compte suivi (OROS5.27), ou sa coupe quand les bornes suivent tous les comptes ; un saut, que Retour arrière défait, et rien d’autre', () => {
    const writes = {
      settings: vi.fn(async () => undefined),
      agent: vi.fn(async () => undefined),
      session: vi.fn(async () => undefined),
      trade: vi.fn(async () => undefined),
      promote: vi.fn(async () => undefined),
      affirm: vi.fn(async () => undefined),
    };
    bench('live');
    useSettings.setState({ update: writes.settings, updateAgent: writes.agent });
    useJournal.setState({ updateSession: writes.session, updateTrade: writes.trade });
    useLinks.setState({ promote: writes.promote, affirm: writes.affirm });
    mount();
    const click = (key: string) => act(() => cell(key)!.click());
    // un compte suivi : chaque cellule ouvre sa fiche Compte, la cellule gardée pour Échap ; Retour arrière la referme
    for (const key of ['loss', 'trades', 'margin']) {
      click(key);
      expect(useObjects.getState().open, key).toEqual({ type: 'compte', id: APEX });
      expect(useObjects.getState().origin, key).toBe(cell(key));
      expect(useObjects.getState().history, key).toHaveLength(1);
      act(() => void useObjects.getState().back());
      expect(useObjects.getState().open, key).toBeNull();
    }
    expect(useUi.getState().tab).toBe('note');
    // tous les comptes agrégés : la coupe existante de Métrique, comme avant
    act(() => bench('live', ''));
    click('loss');
    expect(useUi.getState().tab).toBe('metrique');
    expect(useObjects.getState().views.metrique).toBe('bord');
    expect(useObjects.getState().history).toHaveLength(1);
    act(() => void useObjects.getState().back());
    expect(useUi.getState().tab).toBe('note');
    click('trades');
    expect(useObjects.getState().views.metrique).toBe('bord');
    click('margin');
    expect(useObjects.getState().views.metrique).toBe('prop');
    // rien de réglé : la cellule ouvre les Réglages du desk (Métrique la prend), sans rien écrire
    act(() => useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: '', traderRules: DEFAULT_TRADER_RULES } }));
    click('settings');
    expect(useUi.getState().modalRequest).toEqual({ tab: 'metrique', modal: 'reglages' });
    for (const [name, fn] of Object.entries(writes)) expect(fn, name).not.toHaveBeenCalled();
    // les sources : la barre lit, elle n'appelle aucune méthode d'écriture d'un store ni du process principal
    const source = readFileSync('src/app/StatusBornes.tsx', 'utf8');
    expect(source).not.toMatch(/\.(?:update|updateAgent|enable|disable|setLimits|propose|arm|cut|promote|reject|affirm|remove|recompute|importCsv|loadDemo|updateSession|updateTrade|deleteSession|clearAll)\(/);
    expect(source).not.toMatch(/window\.canto|desk\?*\.\w+\(|from '@\/lib\/desk'/);
  });

  it('« Bornes à régler » ouvre les Réglages du desk : Métrique prend la demande, une fois, et n’écrit rien', async () => {
    const { default: Metrique } = await import('@/modules/metrique/Metrique');
    const update = vi.fn(async () => undefined);
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: '', planAccount: '', traderRules: DEFAULT_TRADER_RULES }, update });
    useJournal.setState({ sessions: [], trades: [] });
    function Desk() {
      return createElement(Shell, null, createElement(Metrique));
    }
    useUi.setState({ tab: 'note' });
    mount(createElement(Desk));
    await act(async () => cell('settings')!.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('Réglages du desk');
    expect(useUi.getState().modalRequest).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('sous le verrou, aucune cellule ne répond', () => {
    bench('live');
    mount(createElement(Shell, { inert: true, children: createElement('div', null, 'module') }));
    act(() => cell('loss')!.click());
    expect(useUi.getState().tab).toBe('note');
    expect(useObjects.getState().history).toEqual([]);
  });

  it('calculées une fois : la barre d’état et un second lecteur des bornes partagent un seul rejeu', () => {
    bench('live');
    const evaluate = vi.mocked(evaluatePlan);
    /** Les rejeux d'un montage, sur un journal neuf : le rejeu partagé ne peut pas venir d'un montage précédent. */
    const replays = (node: ReactNode) => {
      useJournal.setState({ sessions: [...useJournal.getState().sessions], trades: [...useJournal.getState().trades] });
      evaluate.mockClear();
      mount(node);
      const n = evaluate.mock.calls.length;
      act(() => root!.unmount());
      host!.remove();
      root = null;
      return n;
    };
    const alone = replays(createElement(Shell, null, createElement('div', null, 'module')));
    // le plan sur tout l'historique, puis la journée lue (son plus-bas) : un rejeu
    expect(alone).toBeGreaterThan(0);
    let second: DayBornes | null = null;
    function Probe() {
      second = useDayBornes();
      return null;
    }
    // un second lecteur ne rejoue rien : il reçoit le même rejeu
    expect(replays(createElement(Shell, null, createElement(Probe)))).toBe(alone);
    expect(second).not.toBeNull();
    mount(createElement(Shell, null, createElement(Probe)));
    expect(borneCells(second!).map((c) => c.value)).toEqual(cells().map((c) => c.querySelector('b')!.querySelector('span')?.textContent ?? c.querySelector('b')!.textContent));
  });
});

describe('OROS5.22 · la barre d’état selon la décision 7 : TYO, PAR et le libellé de séance cèdent, New York reste', () => {
  it('New York et son cadran 24 / 12 à droite, avant la signature ; ni Tokyo, ni Paris, ni « CME GLOBEX »', () => {
    bench('live');
    const el = mount();
    const bar = status();
    expect(bar.textContent).not.toMatch(/TYO|PAR\b|CME GLOBEX|Tokyo/);
    const clocks = bar.querySelector<HTMLElement>('[aria-label="Heure de New York"]')!;
    expect(clocks.textContent).toMatch(/NYC/);
    expect(clocks.querySelector('time')!.getAttribute('dateTime')).toBe(TODAY);
    expect([...clocks.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['24', '12']);
    // la ligne de la journée à gauche, New York puis la signature à droite
    const [left, right] = [...bar.children] as HTMLElement[];
    expect(left!.querySelector('[data-status="bridge"]')).not.toBeNull();
    expect(left!.querySelector('[data-status="bornes"]')).not.toBeNull();
    expect(right!.contains(clocks)).toBe(true);
    expect(right!.textContent).toContain('SIΞRRΛSKΛ');
    expect(clocks.compareDocumentPosition(right!.querySelector('[class*="sigEnd"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ΟΡΟΣ n'est pas ici : il titre la section Bornes de la fiche Compte (décision 6)
    expect(el.textContent).not.toContain('ΟΡΟΣ');
  });

  it('28 px, pas un de plus ; à l’étroit, les noms passent à leur forme courte puis à leur seul signe', async () => {
    const { cssRules } = await import('./helpers/cssRules');
    const rules = cssRules(readFileSync('src/app/shell.module.css', 'utf8'));
    const status = rules.find((r) => r.selector === '.status' && r.at.length === 0)!;
    expect(status.body).toMatch(/height: 28px;/);
    expect(status.body).toMatch(/container: status \/ inline-size;/);
    const narrow = rules.filter((r) => r.at.some((at) => /^@container status \(max-width: \d+px\)$/.test(at)));
    expect(narrow.length).toBeGreaterThan(0);
    // à l'étroit, rien ne change de place ni de hauteur : seuls des mots s'effacent
    for (const r of narrow) for (const prop of r.props) expect(['display'], `${r.selector} ${prop}`).toContain(prop);
    const hidden = narrow.flatMap((r) => (/display:\s*none/.test(r.body) ? r.selector.split(/\s*,\s*/) : []));
    expect(hidden).toEqual(expect.arrayContaining(['.borneLong', '.statusWord', '.borneName']));
    // jamais les comptes ni la latence
    expect(hidden).not.toContain('.statusKeep');
  });
});
