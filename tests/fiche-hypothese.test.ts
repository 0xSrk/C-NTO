/**
 * @vitest-environment jsdom
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Le coffre des liens, en mémoire : `promote` et `reject` du store tournent tels quels, sur cette table.
const table = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));
vi.mock('@/store/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/store/db')>();
  const links = {
    get: async (id: string) => table.rows.get(id),
    delete: async (id: string) => void table.rows.delete(id),
    toArray: async () => [...table.rows.values()],
    put: async (row: { id: string }) => void table.rows.set(row.id, row),
  };
  return {
    ...real,
    getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
    setSetting: vi.fn(async () => undefined),
    db: { links, transaction: async (_mode: string, _tables: unknown, run: () => Promise<unknown>) => run() },
  };
});

import { ObjectDrawer } from '@/app/objects/Fiche';
import e from '@/design/etat.module.css';
import { generateDemoJournal, generateDemoOntology } from '@/engine/demo';
import { listInstruments } from '@/engine/instruments';
import { entityKey, recomputeOntology, unorderedPairKey, type EntityRef, type Link } from '@/engine/ontology';
import { useI18n } from '@/i18n';
import { useAgentOrders } from '@/store/agentOrders';
import { useBridge } from '@/store/bridge';
import { useCopier } from '@/store/copier';
import { useCrypto } from '@/store/crypto';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.30 — chaque ligne de lien dit son auteur (moteur, vous, agent) et son genre par le trait. Sur une hypothèse,
 * Promouvoir et Rejeter passent par `promote` et `reject` du store des liens, inchangés : le seul chemin d'écriture de la
 * fiche. Les liens rejetés sont comptés et masqués par défaut, sous C.042. Le jeu de démonstration gagne une hypothèse et
 * un lien écrit par l'agent, sans aucune trace d'ordre.
 */

const NOW = Date.parse('2026-10-27T16:00:00Z');
const AGENT = { type: 'note', id: 'n-agent' } as const;
const RULE = { type: 'note', id: 'n-rule' } as const;
const PLAN = { type: 'note', id: 'n-plan' } as const;

const link = (from: EntityRef, predicate: Link['predicate'], to: EntityRef, kind: Link['kind'], by: Link['by'], score?: number): Link => ({
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

const LINKS: Link[] = [
  link(AGENT, 'relie', RULE, 'hypothese', 'moteur', 0.62),
  link(AGENT, 'relie', PLAN, 'hypothese', 'moteur', 0.41),
  link(AGENT, 'relie', { type: 'session', id: 's1' }, 'affirme', 'agent'),
  link({ type: 'note', id: 'n-old' }, 'relie', AGENT, 'rejete', 'utilisateur'),
];

let root: Root | null = null;
let host: HTMLElement | null = null;
const drawer = () => host!.querySelector<HTMLElement>('aside[data-drawer]')!;
/** La ligne d'un lien vivant, par le nom en clair de l'objet visé. */
const row = (text: string) => [...drawer().querySelectorAll<HTMLElement>('[data-group] button[data-link]')].find((b) => b.textContent?.includes(text));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'note' });
  useJournal.setState({ sessions: [{ id: 's1', date: '2026-10-14', account: 'Sim101', instruments: ['NQ'], source: 'demo', tradeCount: 1, pnl: -40, grossProfit: 0, grossLoss: -40, commission: 0, tags: ['sur-trading'], createdAt: 0, updatedAt: 0 }], trades: [] });
  useNotes.setState({
    notes: [
      { id: 'n-agent', title: 'Revanche après une perte : lecture de l’agent', body: '', tags: [], by: 'agent', createdAt: 0, updatedAt: 0 },
      { id: 'n-rule', title: 'Règle anti-revanche', body: '', tags: [], createdAt: 0, updatedAt: 0 },
      { id: 'n-plan', title: 'Plan de trading', body: '', tags: [], createdAt: 0, updatedAt: 0 },
      { id: 'n-old', title: 'Ancienne idée', body: '', tags: [], createdAt: 0, updatedAt: 0 },
    ],
  });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  table.rows = new Map(LINKS.map((l) => [l.id, l]));
  useLinks.setState({ links: [...LINKS] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ObjectDrawer)));
  act(() => void useObjects.getState().openObject(AGENT));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('OROS5.30 l’auteur de chaque lien, et la décision d’une hypothèse', () => {
  it('chaque ligne dit son auteur et son genre par le trait ; les rejetés sont comptés et masqués, sous C.042', () => {
    const rows = [...drawer().querySelectorAll<HTMLElement>('[data-group] button[data-link]')];
    // dans l'ordre du moteur : les deux notes (même instant, puis l'identifiant), puis la séance
    expect(rows.map((r) => [r.dataset.link, r.dataset.by, r.querySelector('[data-author]')!.textContent])).toEqual([
      ['hypothese', 'moteur', '0,41moteur'],
      ['hypothese', 'moteur', '0,62moteur'],
      ['affirme', 'agent', 'agent'],
    ]);
    // le genre par le trait : l'hypothèse tiretée, l'affirmé plein
    expect(rows[0]!.querySelector('[data-etat]')!.classList.contains(e.tirete!)).toBe(true);
    expect(rows[2]!.querySelector('[data-etat]')!.classList.contains(e.plein!)).toBe(true);
    // les rejetés : comptés, masqués par défaut, C.042, au filet graphite, leur auteur dit
    const rejected = drawer().querySelector<HTMLDetailsElement>('details[data-rejected]')!;
    expect(rejected.dataset.rejected).toBe('1');
    expect(rejected.open).toBe(false);
    expect(rejected.querySelector('summary')!.textContent).toBe('1 lien rejeté · masqués');
    expect(rejected.querySelector('summary svg.skg-42')).not.toBeNull();
    expect(rejected.querySelector('[data-etat]')!.classList.contains(e.eteint!)).toBe(true);
    expect(rejected.querySelector('[data-author]')!.textContent).toBe('vous');
    // en anglais, l'auteur suit la langue
    act(() => useI18n.setState({ locale: 'en' }));
    expect([...drawer().querySelectorAll('[data-group] [data-author]')].map((a) => a.textContent)).toEqual(['0.41engine', '0.62engine', 'agent']);
  });

  it('l’hypothèse se rend au halo tireté, puis au plein une fois promue, par links.promote inchangé', async () => {
    const hypo = drawer().querySelector<HTMLElement>(`[data-hypothesis="${LINKS[0]!.id}"]`)!;
    expect(hypo.querySelector('[data-etat]')!.classList.contains(e.tirete!)).toBe(true);
    // le halo tireté : le second contour de la table d'états
    expect(readFileSync('src/design/etat.module.css', 'utf8')).toMatch(/\.tirete::after \{\s*border: 1px dashed var\(--k\);/);
    await act(async () => hypo.querySelector<HTMLButtonElement>('[data-decide="promote"]')!.click());
    expect(useLinks.getState().links.find((l) => l.from.id === 'n-agent' && l.to.id === 'n-rule')).toMatchObject({ kind: 'affirme', by: 'utilisateur', predicate: 'relie' });
    const promoted = row('Règle anti-revanche')!;
    expect(promoted.dataset.link).toBe('affirme');
    expect(promoted.querySelector('[data-etat]')!.classList.contains(e.plein!)).toBe(true);
    expect(promoted.querySelector('[data-author]')!.textContent).toBe('vous');
    expect(promoted.closest('[data-hypothesis]')).toBeNull();
    // la table du coffre porte le lien promu, et plus d'hypothèse sur la paire
    const pair = unorderedPairKey(AGENT, RULE);
    expect([...table.rows.values()].filter((l) => unorderedPairKey((l as Link).from, (l as Link).to) === pair).map((l) => (l as Link).kind)).toEqual(['affirme']);
    // le store des liens est celui du dépôt : la fiche lui passe l'identifiant et le prédicat de l'hypothèse, rien d'autre
    expect(readFileSync('src/app/objects/Fiche.tsx', 'utf8')).toMatch(/promote\(n\.link\.id, n\.link\.predicate\)/);
  });

  it('Rejeter range l’hypothèse parmi les rejetés, par links.reject inchangé', async () => {
    const hypo = drawer().querySelector<HTMLElement>(`[data-hypothesis="${LINKS[1]!.id}"]`)!;
    await act(async () => hypo.querySelector<HTMLButtonElement>('[data-decide="reject"]')!.click());
    expect(useLinks.getState().links.find((l) => l.id === LINKS[1]!.id)).toMatchObject({ kind: 'rejete', by: 'utilisateur' });
    expect(drawer().querySelector(`[data-hypothesis="${LINKS[1]!.id}"]`)).toBeNull();
    expect(drawer().querySelector<HTMLElement>('details[data-rejected]')!.dataset.rejected).toBe('2');
    expect(row('Plan de trading')).toBeUndefined();
    expect(readFileSync('src/app/objects/Fiche.tsx', 'utf8')).toMatch(/reject\(n\.link\.id\)/);
  });

  it('un balayage des sources : la fiche n’appelle que links.promote et links.reject, et des gestes de navigation', () => {
    const dir = 'src/app/objects';
    const files = readdirSync(dir).filter((name) => /\.tsx?$/.test(name));
    const stores = { useObjects, useUi, useNotes, useLinks, useJournal, useSettings, useMacro, useCrypto, useCopier, useBridge, useAgentOrders } as unknown as Record<string, { getState: () => Record<string, unknown> }>;
    /**
     * Les gestes permis : naviguer (ouvrir un objet, fermer, revenir, passer au voisin, sauter vers un module et sa vue,
     * poser le jour ou la séance qu'un module montre, la note active de Note, le filtre de compte de Métrique, ouvrir ou
     * fermer l'omnibar, afficher ou retirer l'ensemble d'« Autour de… » — OROS5.31 —, changer une puce de la sélection
     * partagée, en mémoire — OROS5.32), dire qu'une copie est faite (le toast) ; écrire : Promouvoir et Rejeter une
     * hypothèse, seulement.
     */
    const NAVIGATION = new Set(['openObject', 'close', 'back', 'step', 'jumpTo', 'setTab', 'focusOnDate', 'focusSession', 'setActive', 'setMetricAccount', 'setMetricRange', 'setMetricInstrument', 'setOmnibar', 'openSet', 'clearSet', 'toast']);
    const WRITES = new Set(['promote', 'reject']);
    const used = new Map<string, Set<string>>();
    const note = (file: string, name: string) => used.set(name, (used.get(name) ?? new Set()).add(file));
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const [, store, method] of source.matchAll(/\b(use[A-Z]\w*)\.getState\(\)\.(\w+)\(/g)) {
        expect(stores[store!], `${file} : ${store}`).toBeDefined();
        note(file, method!);
      }
      for (const [, store, prop] of source.matchAll(/\b(use[A-Z]\w*)\(\(\w+\) => \w+\.(\w+)\)/g)) {
        const state = stores[store!]?.getState();
        if (state && typeof state[prop!] === 'function') note(file, prop!);
      }
      // ni le coffre, ni le process principal, ni une écriture d'un store hors des deux décisions
      expect(source, file).not.toMatch(/^import (?!type )[^;]*from '@\/store\/db'|from '@\/lib\/desk'|window\.canto|\bdb\.\w+/m);
    }
    const methods = [...used.keys()].sort();
    expect(methods.filter((name) => !NAVIGATION.has(name) && !WRITES.has(name))).toEqual([]);
    expect([...WRITES].map((name) => [name, [...(used.get(name) ?? [])]])).toEqual([
      ['promote', ['Fiche.tsx']],
      ['reject', ['Fiche.tsx']],
    ]);
    // la copie au presse-papiers, seule autre sortie
    const clipboard = files.filter((file) => /navigator\.clipboard/.test(readFileSync(join(dir, file), 'utf8')));
    expect(clipboard).toEqual(['Fiche.tsx']);
  });

  it('l’omnibar n’écrit toujours rien : elle ouvre un module ou un objet, et se ferme', () => {
    const source = readFileSync('src/app/objects/Omnibar.tsx', 'utf8') + readFileSync('src/app/objects/index.ts', 'utf8');
    expect(source).not.toMatch(/\.(?:promote|reject|affirm|remove|recompute|update|setActive|setMetricAccount|toast)\b/);
    expect(source).toMatch(/OMNIBAR_COMMANDS = Object\.freeze\(\['tab', 'object'\] as const\)/);
  });
});

describe('OROS5.30 le jeu de démonstration gagne une hypothèse et un lien écrit par l’agent, sans ordre', () => {
  const journal = generateDemoJournal({ endDate: new Date('2026-10-31T12:00:00Z') });
  const { notes, links } = generateDemoOntology(journal, NOW);
  // Le coffre de notes tel que le desk le sème à la première ouverture : l'accueil et le plan de trading.
  const seeds = readFileSync('src/store/notes.ts', 'utf8');
  const body = (name: string) => new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(seeds)![1]!;
  const corpus = [{ id: 'seed-welcome', title: 'Bienvenue dans le coffre', body: body('WELCOME_BODY'), tags: [] }, { id: 'seed-plan', title: 'Plan de trading', body: body('PLAN_BODY'), tags: [] }, ...notes];

  it('deux notes, dont une de l’agent non adoptée, et un lien affirmé par l’agent vers la dernière séance en dérive', () => {
    expect(notes).toHaveLength(2);
    expect(notes.filter((n) => n.by === 'agent')).toHaveLength(1);
    expect(links).toHaveLength(1);
    const drifted = [...journal.sessions].filter((s) => s.tags.includes('sur-trading')).sort((a, b) => b.date.localeCompare(a.date))[0]!;
    expect(links[0]).toMatchObject({ kind: 'affirme', by: 'agent', predicate: 'relie', from: { type: 'note', id: notes[1]!.id }, to: { type: 'session', id: drifted.id } });
    // le journal reste celui d'avant : le tirage des séances n'a pas bougé
    expect(generateDemoJournal({ endDate: new Date('2026-10-31T12:00:00Z') }).sessions.map((s) => [s.date, s.pnl])).toEqual(journal.sessions.map((s) => [s.date, s.pnl]));
  });

  it('l’hypothèse naît du moteur au recalcul, et le lien de l’agent y survit', () => {
    const out = recomputeOntology({ notes: corpus, sessions: journal.sessions, trades: journal.trades, events: [], instruments: listInstruments().map((spec) => spec.symbol) }, links, NOW);
    const pair = unorderedPairKey({ type: 'note', id: notes[0]!.id }, { type: 'note', id: notes[1]!.id });
    const hypothesis = out.find((l) => l.kind === 'hypothese' && unorderedPairKey(l.from, l.to) === pair);
    expect(hypothesis).toMatchObject({ by: 'moteur', predicate: 'relie' });
    // au-dessus du plancher du moteur avec de la marge : les deux notes partagent leurs mots et leur étiquette
    expect(hypothesis!.score).toBeGreaterThanOrEqual(0.5);
    expect(out.find((l) => l.id === links[0]!.id)).toMatchObject({ kind: 'affirme', by: 'agent' });
  });

  it('aucune trace d’ordre de démonstration : ni dans le moteur du jeu, ni dans son chargement, ni dans le renderer', () => {
    for (const path of ['src/engine/demo.ts', 'src/store/journal.ts']) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/propose|agentOrders|AgentOrder|DEMO_|ntbridge|placeOrder/);
    }
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
    const traces = walk('src').filter((path) => /\.(tsx?|css)$/.test(path) && /\bDEMO_[A-Z]/.test(readFileSync(path, 'utf8')));
    expect(traces).toEqual([]);
  });
});
