/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules, HOVER_LIGHT } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

// Le canevas n'existe pas sous jsdom : la courbe A.02 est un enregistreur qui garde l'abonnement au clic.
const charts = vi.hoisted(() => ({ click: null as null | ((param: { time?: number; point?: { x: number; y: number } }) => void), dbl: null as null | ((param: { time?: number; point?: { x: number; y: number } }) => void), fits: 0 }));
vi.mock('lightweight-charts', () => ({
  customSeriesDefaultOptions: { color: '#000' },
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Magnet: 3 },
  LineStyle: { Dotted: 1, SparseDotted: 4 },
  createChart: () => ({
    addCustomSeries: () => ({ setData: () => undefined, applyOptions: () => undefined }),
    panes: () => [0, 1, 2].map(() => ({ setHeight: () => undefined })),
    subscribeCrosshairMove: () => undefined,
    subscribeClick: (cb: (param: { time?: number; point?: { x: number; y: number } }) => void) => {
      charts.click = cb;
    },
    subscribeDblClick: (cb: (param: { time?: number; point?: { x: number; y: number } }) => void) => {
      charts.dbl = cb;
    },
    timeScale: () => ({
      fitContent: () => {
        charts.fits++;
      },
      getVisibleLogicalRange: () => ({ from: 0, to: 10 }),
      setVisibleLogicalRange: () => undefined,
      coordinateToLogical: () => 5,
    }),
    applyOptions: () => undefined,
    remove: () => undefined,
  }),
}));

import { ObjectDrawer } from '@/app/objects/Fiche';
import e from '@/design/etat.module.css';
import { entityKey, releaseLabel, tradeReleaseDistance, type EntityRef, type Link } from '@/engine/ontology';
import type { CalendarEventRow } from '@/engine/calendarEvents';
import { equityCurve } from '@/engine/equityCurve';
import { findPlan } from '@/engine/propfirm';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { replayDiscipline } from '@/lib/frise';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.26 — la fiche Séance, ouverte depuis A.04 et A.02. Elle se pose sur le cadre commun et ne fait que lire : M.057
 * (le P&L net au numéral, le compte en lien, la date, les instruments, les étiquettes, les trades et gagnants, la
 * commission), M.016 en deux arcs (l'hypothèse au halo tireté), les liens par prédicat et leur compte, les trades sur un
 * axe en R commun et leur distance à la publication lue au moteur, les écarts rejoués, la provenance par genre. Le survol
 * passe par un seul crochet, `useHoverLight`.
 */

const NOW = Date.parse('2026-10-27T16:00:00Z');
const S1: EntityRef = { type: 'session', id: 'ses_7f3a9c21d4e8' };
const S2: EntityRef = { type: 'session', id: 'ses_b02e' };
const CPI = 'bls:cpi-2026-10-14';

const session = (id: string, date: string, pnl: number): Session => ({
  id,
  date,
  account: 'Apex-PA-50K',
  instruments: ['NQ'],
  source: 'ninjatrader',
  tradeCount: 3,
  pnl,
  grossProfit: 200,
  grossLoss: -440,
  commission: 7.62,
  tags: ['orb', 'news'],
  rating: 3,
  note: 'Entrée sur la publication.',
  createdAt: Date.parse('2026-10-14T21:02:00Z'),
  updatedAt: Date.parse('2026-10-14T21:05:00Z'),
});

const trade = (id: string, sessionId: string, entry: string, minutes: number, pnl: number, risk = 100): Trade => ({
  id,
  sessionId,
  instrument: 'NQ',
  account: 'Apex-PA-50K',
  direction: 'long',
  qty: 2,
  entryTime: Date.parse(entry),
  exitTime: Date.parse(entry) + minutes * 60_000,
  entryPrice: 20_000,
  exitPrice: 19_990,
  pnl,
  commission: 2.54,
  risk,
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

// Le CPI officiel du 14.10, publié à 08:30 ET (12:30 UTC) : la distance d'un trade s'y lit, à la minute.
const cpiRow: CalendarEventRow = { id: CPI, sourceId: 'bls', date: '2026-10-14', timeET: '08:30', title: 'Inflation CPI', category: 'inflation', impact: 3, instruments: [], estimated: false, syncedAt: 0, actual: '0.3%' } as CalendarEventRow;

// t2 entre à 09:38 ET (69 min après le CPI) et perd ; t1 entre 17 min après sa sortie (revanche) ; t3, l'après-midi, hors fenêtre.
const trades = [trade('t1', S1.id, '2026-10-14T14:05:00Z', 10, -150), trade('t2', S1.id, '2026-10-14T13:39:00Z', 10, -97.62, 200), trade('t3', S1.id, '2026-10-14T18:40:00Z', 15, 0, 0)];
const links: Link[] = [
  link({ type: 'trade', id: 't1' }, 'de-la-seance', S1),
  link({ type: 'trade', id: 't2' }, 'de-la-seance', S1),
  link({ type: 'trade', id: 't3' }, 'de-la-seance', S1),
  link(S1, 'pendant', { type: 'evenement', id: CPI }),
  link({ type: 'trade', id: 't1' }, 'pendant', { type: 'evenement', id: CPI }),
  link({ type: 'trade', id: 't2' }, 'pendant', { type: 'evenement', id: CPI }),
  link({ type: 'note', id: 'n-plan' }, 'mentionne', S1, 'affirme', 'utilisateur'),
  link({ type: 'note', id: 'n-idee' }, 'relie', S1, 'hypothese', 'moteur', 0.62),
  link({ type: 'note', id: 'n-x' }, 'relie', S1, 'rejete', 'utilisateur'),
];

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const drawer = () => host!.querySelector<HTMLElement>('aside[data-drawer]')!;
const open = (ref: EntityRef = S1) => act(() => void useObjects.getState().openObject(ref, { siblings: [S1, S2] }));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique' });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, riskPerContract: 0, planId: '', planAccount: '', traderRules: { ...DEFAULT_SETTINGS.traderRules, revengeWindowMin: 30 } } });
  useJournal.setState({ sessions: [session(S1.id, '2026-10-14', -247.62), session(S2.id, '2026-10-20', 410)], trades });
  useNotes.setState({
    notes: [
      { id: 'n-plan', title: 'Plan de trading', body: '', tags: [], createdAt: 0, updatedAt: 0 },
      { id: 'n-idee', title: 'Idée CPI', body: '', tags: [], createdAt: 0, updatedAt: 0 },
    ],
  });
  useMacro.setState({ events: [cpiRow], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useLinks.setState({ links });
  charts.click = null;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OROS5.26 la fiche Séance', () => {
  it('M.057, les liens par prédicat et leur compte, les propriétés et la provenance par genre', () => {
    mount(createElement(ObjectDrawer));
    open();
    const fiche = drawer();
    expect(fiche.dataset.drawer).toBe('session');
    // la section Activité de chaque fiche (OROS5.38), avant la provenance
    expect([...fiche.querySelectorAll('section')].map((sec) => sec.dataset.section)).toEqual(['identity', 'links', 'around', 'drifts', 'properties', 'activity', 'provenance']);
    // M.057 : le P&L net au numéral, le compte en lien (C.065), la date, les instruments, les étiquettes, les trades, la commission
    const ident = fiche.querySelector<HTMLElement>('[data-section="identity"]')!;
    expect(ident.querySelector('[data-ident="numeral"] b')!.textContent).toBe('−247,62');
    const account = ident.querySelector<HTMLButtonElement>('button[data-object="compte:Apex-PA-50K"]')!;
    expect(account.textContent).toBe('Apex-PA-50K');
    expect(account.querySelector('svg.skg-65')).not.toBeNull();
    expect(ident.textContent).toMatch(/mer\. 14 oct\. 2026/);
    expect(ident.textContent).toContain('NQ');
    expect(ident.textContent).toContain('orb · news');
    expect(ident.textContent).toContain('3 trades · 0/3 gagnants');
    expect(ident.textContent).toContain('comm. −7,62');
    // le compte en lien ouvre sa fiche par un saut
    act(() => account.click());
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: 'Apex-PA-50K' });
    expect(useObjects.getState().history).toHaveLength(1);
    act(() => void useObjects.getState().back());
    // les liens par prédicat, chacun avec son compte ; le rejeté n'est pas un voisin
    const groups = [...drawer().querySelectorAll<HTMLElement>('[data-group]')];
    expect(groups.map((g) => [g.dataset.group, g.querySelector('[class*="groupCount"]')!.textContent])).toEqual([
      ['in:de-la-seance:trade', '3'],
      ['out:pendant:evenement', '1'],
      ['in:mentionne:note', '1'],
      ['in:relie:note', '1'],
    ]);
    expect(drawer().querySelector('[data-section="links"] header')!.textContent).toContain('6 liens');
    // les propriétés : ce que M.057 ne dit pas
    const props = [...drawer().querySelectorAll('[data-section="properties"] dt')].map((dt) => dt.textContent);
    expect(props).toEqual(['Éval.', 'Note de séance', 'Gains · pertes bruts', 'Contrat', 'Modifiée']);
    expect(drawer().querySelector('[data-section="properties"]')!.textContent).toContain('3 / 5');
    // la provenance : la source de la séance, puis les liens par genre et par auteur
    const prov = drawer().querySelector('[data-section="provenance"]')!.textContent!;
    expect(prov).toContain('Séance · NinjaTrader · écrite au coffre');
    // les liens qui touchent la séance : trois trades, la publication ; ceux des trades vers la publication sont aux trades
    expect(prov).toContain('4 structurels, calculés par le moteur · 1 affirmés · 1 hypothèses · 1 rejetés');
    expect(prov).toContain('Auteurs : moteur 5 · vous 2 · agent 0');
  });

  it('l’identifiant en clair en tête, jamais la clé interne ni une clé tronquée ; la copie seule la porte', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    mount(createElement(ObjectDrawer));
    open();
    expect(drawer().querySelector('h2')!.textContent).toBe('Séance · 14.10 · Apex-PA-50K');
    expect(drawer().textContent).not.toContain(S1.id);
    // aucune clé tronquée : le seul « … » est celui du titre « Autour de… » (OROS5.31)
    expect(drawer().textContent!.replaceAll('Autour de…', '')).not.toMatch(/ses_|…/);
    expect([...drawer().querySelectorAll<HTMLElement>('header button')].map((b) => b.dataset.action)).toEqual(['calendar', 'visual', 'copy', 'close']);
    await act(async () => drawer().querySelector<HTMLButtonElement>('[data-action="copy"]')!.click());
    expect(writeText).toHaveBeenCalledWith(S1.id);
  });

  it('les trades sur un axe en R commun, et leur distance à la publication égale au moteur, à la minute, sans ellipse', () => {
    mount(createElement(ObjectDrawer));
    open();
    const rows = [...drawer().querySelectorAll<HTMLElement>('[data-group="in:de-la-seance:trade"] button[data-trade]')];
    // dans l'ordre du temps ; l'entrée et la sortie à l'heure de New York
    expect(rows.map((row) => row.dataset.trade)).toEqual(['t2', 't1', 't3']);
    expect(rows.map((row) => row.querySelector('b')!.textContent)).toEqual(['09:39 → 09:49 ET', '10:05 → 10:15 ET', '14:40 → 14:55 ET']);
    // la distance, lue au moteur sur les liens « pendant » : t2 à +69 min, t1 à +95 min ; t3 n'est lié à aucune publication
    const catalysts = useMacro.getState().events.map((row) => ({ id: row.id, date: row.date, timeET: row.timeET, title: row.title.replace(/^U\.S\.\s+/i, ''), impact: row.impact, estimated: row.estimated }));
    for (const row of rows) {
      const t = trades.find((x) => x.id === row.dataset.trade)!;
      const expected = releaseLabel(tradeReleaseDistance(t, links, catalysts));
      const shown = row.querySelector('[data-release]')?.textContent ?? '—';
      expect(shown, t.id).toBe(expected);
    }
    expect(rows.map((row) => row.querySelector('[data-release]')?.textContent ?? null)).toEqual(['CPI +69 min', 'CPI +95 min', null]);
    // sans ellipse : la feuille ne coupe jamais la distance
    const sheet = cssRules(readFileSync('src/app/objects/fiche.module.css', 'utf8'));
    const release = sheet.find((rule) => rule.selector === '.release')!.body;
    expect(release).toMatch(/white-space: nowrap/);
    for (const selector of ['.release', '.tradeTime small', '.tradeTime']) expect(sheet.find((rule) => rule.selector === selector)?.body ?? '', selector).not.toMatch(/ellipsis|overflow: hidden/);
    // M.022 : un seul axe ; −1 (le stop, un simple trait) et 0 tombent au même endroit sur chaque ligne ; sans risque, « R — »
    const scales = rows.map((row) => row.querySelector('svg[data-rscale]'));
    expect(scales.map((svg) => !!svg)).toEqual([true, true, false]);
    expect(rows[2]!.querySelector('[data-rscale="absent"]')!.textContent).toBe('R —');
    const xOf = (svg: Element | null, part: string) => svg!.querySelector(`[data-r="${part}"]`)!.getAttribute('x1');
    expect(xOf(scales[0]!, 'stop')).toBe(xOf(scales[1]!, 'stop'));
    expect(xOf(scales[0]!, 'entry')).toBe(xOf(scales[1]!, 'entry'));
    expect(scales[0]!.querySelector('[data-r="stop"]')!.tagName.toLowerCase()).toBe('line');
    expect(scales[0]!.innerHTML).not.toMatch(/skg-126/);
  });

  it('M.016 en deux arcs, rayons au glacier par la table d’états, l’hypothèse au halo tireté', () => {
    mount(createElement(ObjectDrawer));
    open();
    const figure = drawer().querySelector<SVGSVGElement>('figure[data-figure="M.016"] svg')!;
    expect(figure.getAttribute('aria-label')).toBe('Graphe d’ego de la séance : 6 liens, 1 hypothèse');
    const nodes = [...figure.querySelectorAll<SVGGElement>('g[data-node]')];
    const cy = Number(figure.querySelector('circle')!.getAttribute('cy'));
    const yOf = (key: string) => Number(figure.querySelector(`g[data-node="${key}"] circle`)!.getAttribute('cy'));
    // ce qui compose la séance (les trades) en bas, ce qui l'encadre en haut
    for (const id of ['t1', 't2', 't3']) expect(yOf(`trade:${id}`), id).toBeGreaterThan(cy);
    for (const key of [`evenement:${CPI}`, 'note:n-plan', 'note:n-idee']) expect(yOf(key), key).toBeLessThan(cy);
    expect(nodes).toHaveLength(6);
    // les trades de gauche à droite dans l'ordre du temps, nommés par leur heure (ET) et leur R
    const xOfNode = (key: string) => Number(figure.querySelector(`g[data-node="${key}"] circle`)!.getAttribute('cx'));
    expect(xOfNode('trade:t2')).toBeLessThan(xOfNode('trade:t1'));
    expect(xOfNode('trade:t1')).toBeLessThan(xOfNode('trade:t3'));
    expect(figure.querySelector('g[data-node="trade:t2"] text')!.textContent).toBe('09:39 ET · −0,5 R');
    // le trait de chaque rayon vient de la table d'états : plein, et tireté pour l'hypothèse ; son halo, tireté
    const rays = [...figure.querySelectorAll<SVGLineElement>('line[data-ray]')];
    expect(rays.filter((ray) => ray.classList.contains(e.tirete!)).map((ray) => ray.dataset.ray)).toEqual(['hypothese']);
    expect(rays.filter((ray) => ray.classList.contains(e.plein!))).toHaveLength(5);
    const halo = figure.querySelector('g[data-node="note:n-idee"] [data-halo="tirete"]')!;
    expect(halo.classList.contains(e.tirete!)).toBe(true);
    expect(figure.querySelectorAll('[data-halo]')).toHaveLength(1);
    // les glyphes viennent de la bibliothèque unique : C.094 au cœur, C.035 pour un trade, C.090 pour la publication
    expect(figure.querySelector('svg.skg-94')).not.toBeNull();
    expect(figure.querySelectorAll('g[data-node^="trade:"] svg.skg-35')).toHaveLength(3);
    expect(figure.querySelector(`g[data-node="evenement:${CPI}"] svg.skg-90`)).not.toBeNull();
    // un nœud ouvre son objet par un saut
    act(() => void figure.querySelector<SVGGElement>(`g[data-node="evenement:${CPI}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useObjects.getState().open).toEqual({ type: 'evenement', id: CPI });
  });

  it('le survol relie un nœud à sa ligne par un seul crochet, qui ne pose que data-lit, et seulement là où le pointeur survole', () => {
    mount(createElement(ObjectDrawer));
    open();
    const row = () => drawer().querySelector<HTMLElement>('button[data-trade="t1"]')!;
    const node = () => drawer().querySelector<SVGGElement>('g[data-node="trade:t1"]')!;
    // sans survol (écran tactile) : rien ne s'allume
    act(() => void row().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(node().hasAttribute('data-lit')).toBe(false);
    act(() => void row().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(hover: hover)', media: query, addEventListener() {}, removeEventListener() {} }));
    act(() => void row().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(row().hasAttribute('data-lit')).toBe(true);
    expect(node().hasAttribute('data-lit')).toBe(true);
    expect(drawer().querySelector('line[data-lit]')).not.toBeNull();
    act(() => void row().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(drawer().querySelectorAll('[data-lit]')).toHaveLength(0);
    // et l'inverse : le nœud allume sa ligne
    act(() => void node().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(row().hasAttribute('data-lit')).toBe(true);
    // les règles de [data-lit] vivent sous @media (hover: hover) et ne changent que la lumière
    const lit = cssRules(readFileSync('src/app/objects/fiche.module.css', 'utf8')).filter((rule) => /\[data-lit\]/.test(rule.selector));
    expect(lit.length).toBeGreaterThan(0);
    for (const rule of lit) {
      expect(rule.at.some((head) => /^@media\s*\(hover:\s*hover\)/.test(head)), rule.selector).toBe(true);
      for (const prop of rule.props) expect(HOVER_LIGHT.has(prop), `${rule.selector} : ${prop}`).toBe(true);
    }
  });

  it('les écarts rejoués : ceux du couloir Desk de la frise, sur les trades de la séance', () => {
    mount(createElement(ObjectDrawer));
    open();
    const settings = useSettings.getState().settings;
    const own = trades.filter((t) => t.sessionId === S1.id);
    const expected = replayDiscipline(own, [], settings.traderRules, findPlan(settings.planId), settings.planAccount);
    const shown = [...drawer().querySelectorAll<HTMLElement>('[data-section="drifts"] [data-finding]')];
    expect(expected.length).toBeGreaterThan(0);
    expect(shown.map((row) => row.dataset.finding)).toEqual(expected.map((f) => f.kind));
    expect(shown[0]!.textContent).toContain('Revanche · 10:05 ET');
    expect(shown[0]!.textContent).toMatch(/entrée 16 min après une perte de −97,62\s\$ \(fenêtre 30 min\)/u);
    expect(shown[0]!.querySelector('svg.skg-24')).not.toBeNull();
    // l'écart ouvre son trade
    act(() => shown[0]!.click());
    expect(useObjects.getState().open).toEqual({ type: 'trade', id: 't1' });
  });

  it('aucune écriture : la fiche lit et navigue, rien d’autre', () => {
    const writes = {
      update: vi.fn(async () => undefined),
      updateSession: vi.fn(async () => undefined),
      updateTrade: vi.fn(async () => undefined),
      deleteSessions: vi.fn(async () => undefined),
      promote: vi.fn(async () => undefined),
      reject: vi.fn(async () => undefined),
      affirm: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      recompute: vi.fn(async () => undefined),
    };
    useSettings.setState({ update: writes.update });
    useJournal.setState({ updateSession: writes.updateSession, updateTrade: writes.updateTrade, deleteSessions: writes.deleteSessions });
    useLinks.setState({ promote: writes.promote, reject: writes.reject, affirm: writes.affirm, remove: writes.remove, recompute: writes.recompute });
    mount(createElement(ObjectDrawer));
    open();
    // chaque bouton de la fiche, sauf la fermeture, la copie et la décision d'une hypothèse (OROS5.30, le seul chemin
    // d'écriture, par links.promote et links.reject) : chacun ouvre un objet ou un module
    const navigation = () => [...drawer().querySelectorAll<HTMLElement>('button, g[role="button"]')].filter((b) => !['close', 'copy'].includes(b.dataset.action ?? '') && !b.dataset.decide);
    expect(navigation().length).toBeGreaterThan(8);
    for (const index of navigation().keys()) {
      act(() => void useObjects.getState().openObject(S1, { siblings: [S1, S2] }));
      act(() => void navigation()[index]!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      act(() => useUi.setState({ tab: 'metrique' }));
    }
    for (const [name, fn] of Object.entries(writes)) expect(fn, name).not.toHaveBeenCalled();
    // les sources : la fiche Séance et ses instruments n'appellent aucune méthode d'écriture d'un store ni du process principal
    for (const path of ['src/app/objects/SessionFiche.tsx', 'src/app/objects/Instruments.tsx', 'src/app/objects/useHoverLight.ts']) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/\.(?:update|updateAgent|updateSession|updateTrade|deleteSessions?|promote|reject|affirm|remove|recompute|put|add|bulkPut|delete|setActive)\(/);
      expect(source, path).not.toMatch(/window\.canto|desk\?*\.\w+\(|from '@\/lib\/desk'|from '@\/store\/db'/);
    }
  });
});

describe('OROS5.26 A.04 et A.02 ouvrent la fiche de leur séance', () => {
  const size = { clientWidth: 800, clientHeight: 300 };

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    for (const [key, value] of Object.entries(size)) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  });

  afterEach(() => {
    for (const key of Object.keys(size)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  });

  async function dashboard() {
    const { Dashboard } = await import('@/modules/metrique/Dashboard');
    const { sessions, trades: rows } = useJournal.getState();
    mount(
      createElement(Dashboard, {
        sessions,
        trades: rows,
        range: 'tout',
        period: { from: null, to: '2026-10-27' },
        history: { sessions, trades: rows },
        journalEmpty: false,
        onImport: () => undefined,
        onDemo: () => undefined,
        onSessions: () => undefined,
      }),
    );
    await act(async () => undefined);
  }

  it('une ligne de A.04 est une séance C.094 : elle ouvre sa fiche, ↑ ↓ passent aux lignes voisines, l’ouverte se marque', async () => {
    await dashboard();
    const rows = [...host!.querySelectorAll<HTMLTableRowElement>('tr[data-session]')];
    expect(rows.map((row) => row.dataset.session)).toEqual([S2.id, S1.id]);
    const button = rows[1]!.querySelector<HTMLButtonElement>('button')!;
    expect(button.getAttribute('aria-label')).toBe('Ouvrir la fiche de la séance du 14.10');
    expect(button.querySelector('svg.skg-94')).not.toBeNull();
    act(() => button.click());
    expect(useObjects.getState().open).toEqual(S1);
    expect(useObjects.getState().origin).toBe(button);
    expect(useObjects.getState().siblings).toEqual([S2, S1]);
    expect(button.getAttribute('aria-current')).toBe('true');
    // la ligne entière y mène aussi
    act(() => void useObjects.getState().close(false));
    act(() => rows[0]!.querySelector('td:last-child')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useObjects.getState().open).toEqual(S2);
  });

  it('un pas de A.02 cliqué, hors glisser, ouvre la fiche de sa séance ; le départ n’en ouvre aucune', async () => {
    await dashboard();
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { DOUBLE_CLICK_MS } = await import('@/modules/metrique/EquityChart');
    expect(charts.click).not.toBeNull();
    const curve = equityCurve(useJournal.getState().sessions, useJournal.getState().trades, 'session');
    const click = (time?: number) => {
      act(() => charts.click!({ time, point: { x: 1, y: 1 } }));
      act(() => void vi.advanceTimersByTime(DOUBLE_CLICK_MS));
    };
    click(curve.steps[0]!.time);
    expect(useObjects.getState().open).toBeNull();
    click(curve.steps[1]!.time);
    expect(useObjects.getState().open).toEqual(S1);
    expect(useObjects.getState().siblings).toEqual([S1, S2]);
    click(curve.steps[2]!.time);
    expect(useObjects.getState().open).toEqual(S2);
    // un clic hors de tout pas ne fait rien
    click(undefined);
    expect(useObjects.getState().open).toEqual(S2);
  });

  it('OROS5.45c le double-clic sur A.02 recadre la courbe et n’ouvre rien : le clic d’un pas attend la fenêtre du double-clic', async () => {
    await dashboard();
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { DOUBLE_CLICK_MS } = await import('@/modules/metrique/EquityChart');
    const curve = equityCurve(useJournal.getState().sessions, useJournal.getState().trades, 'session');
    const chart = [...host!.querySelectorAll<HTMLElement>('[role="img"]')].find((el) => /cumulé/.test(el.getAttribute('aria-label') ?? ''))!;
    expect(chart).toBeDefined();
    const fits = charts.fits;
    // le premier clic d'un double-clic : rien ne s'ouvre avant la fin de la fenêtre
    act(() => charts.click!({ time: curve.steps[1]!.time, point: { x: 1, y: 1 } }));
    act(() => void vi.advanceTimersByTime(DOUBLE_CLICK_MS - 1));
    expect(useObjects.getState().open).toBeNull();
    // le second clic, puis le double-clic : la courbe se recadre, et la fiche ne s'ouvre jamais
    act(() => charts.click!({ time: curve.steps[1]!.time, point: { x: 1, y: 1 } }));
    act(() => void chart.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    act(() => void vi.advanceTimersByTime(DOUBLE_CLICK_MS * 3));
    expect(useObjects.getState().open).toBeNull();
    expect(charts.fits).toBe(fits + 1);
    // le double-clic seul, sans clic sur un pas, recadre aussi
    act(() => charts.click!({ time: curve.steps[2]!.time, point: { x: 1, y: 1 } }));
    act(() => void chart.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    act(() => void vi.advanceTimersByTime(DOUBLE_CLICK_MS * 3));
    expect(useObjects.getState().open).toBeNull();
    expect(charts.fits).toBe(fits + 2);
  });

  it('OROS5.45j un double-clic lent (300 à 500 ms) n’ouvre rien : la fenêtre est celle de la bibliothèque et de Windows', async () => {
    await dashboard();
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { DOUBLE_CLICK_MS } = await import('@/modules/metrique/EquityChart');
    // lightweight-charts compte le double-clic sur 500 ms depuis le premier appui (Delay.ResetClick), Windows aussi
    expect(DOUBLE_CLICK_MS).toBeGreaterThanOrEqual(500);
    const curve = equityCurve(useJournal.getState().sessions, useJournal.getState().trades, 'session');
    const chart = [...host!.querySelectorAll<HTMLElement>('[role="img"]')].find((el) => /cumulé/.test(el.getAttribute('aria-label') ?? ''))!;
    const step = { time: curve.steps[1]!.time, point: { x: 1, y: 1 } };
    const fits = charts.fits;
    // Dans la fenêtre, la bibliothèque rend le second clic à son double-clic, jamais à subscribeClick.
    act(() => charts.click!(step));
    act(() => void vi.advanceTimersByTime(350));
    expect(useObjects.getState().open).toBeNull();
    act(() => charts.dbl!(step));
    act(() => void chart.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    act(() => void vi.advanceTimersByTime(DOUBLE_CLICK_MS * 3));
    expect(useObjects.getState().open).toBeNull();
    expect(charts.fits).toBe(fits + 1);
    // le double-clic de la bibliothèque seul, sans dblclick du DOM ni second appui vu de l'hôte (une fenêtre du système
    // plus courte que 500 ms), de même : subscribeDblClick annule (OROS5.45n)
    act(() => charts.click!(step));
    act(() => void vi.advanceTimersByTime(350));
    act(() => charts.dbl!(step));
    act(() => void vi.advanceTimersByTime(DOUBLE_CLICK_MS * 3));
    expect(useObjects.getState().open).toBeNull();
    // le double-clic du DOM seul, à 450 ms, de même
    act(() => charts.click!(step));
    act(() => void vi.advanceTimersByTime(450));
    act(() => void chart.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    act(() => void vi.advanceTimersByTime(DOUBLE_CLICK_MS * 3));
    expect(useObjects.getState().open).toBeNull();
    // un second appui dans la fenêtre l'annule dès qu'il commence, même tenu
    act(() => charts.click!(step));
    act(() => void vi.advanceTimersByTime(450));
    act(() => void chart.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => void vi.advanceTimersByTime(DOUBLE_CLICK_MS * 3));
    expect(useObjects.getState().open).toBeNull();
    // un clic seul ouvre la fiche, une fois la fenêtre passée
    act(() => charts.click!(step));
    act(() => void vi.advanceTimersByTime(DOUBLE_CLICK_MS - 1));
    expect(useObjects.getState().open).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(useObjects.getState().open).not.toBeNull();
  });
});
