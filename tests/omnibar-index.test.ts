import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildObjectIndex,
  catalystWindow,
  dayWithYear,
  objectLabel,
  OMNI_GROUPS,
  OMNI_PER_GROUP,
  OMNIBAR_COMMANDS,
  parseDayQuery,
  searchObjectIndex,
  type IndexSources,
  type OmniItem,
} from '@/app/objects/index';
import { TABS } from '@/app/tabs';
import type { CalEvent } from '@/engine/calendar';
import { ENTITY_TYPES, type Link } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';

/**
 * OROS5.15 — l'index de Ctrl+J (`src/app/objects/index.ts`) : huit groupes, trades et stratégies compris (correction du
 * juge Palantir, GROUPS) ; une liste de commandes fermée, qui ne fait que naviguer ; un tri par proximité de date ; des
 * catalyseurs bornés à la fenêtre de la fiche.
 */

/** Le 27.10.2026 à midi, heure de New York. */
const NOW = Date.parse('2026-10-27T16:00:00Z');

const session = (id: string, date: string, account: string, pnl: number, over: Partial<Session> = {}): Session => ({
  id,
  date,
  account,
  instruments: ['NQ'],
  source: 'ninjatrader',
  tradeCount: 1,
  pnl,
  grossProfit: Math.max(0, pnl),
  grossLoss: Math.min(0, pnl),
  commission: 4,
  tags: ['orb'],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const trade = (id: string, sessionId: string, entry: string, pnl: number): Trade => ({
  id,
  sessionId,
  instrument: 'NQ',
  account: 'Apex-PA-50K',
  direction: 'long',
  qty: 2,
  entryTime: Date.parse(entry),
  exitTime: Date.parse(entry) + 600_000,
  entryPrice: 20_000,
  exitPrice: 20_010,
  pnl,
  commission: 4,
  tags: ['orb'],
});

const event = (id: string, date: string, title: string, over: Partial<CalEvent> = {}): CalEvent => ({
  id,
  date,
  timeET: '08:30',
  title,
  category: 'inflation',
  impact: 3,
  description: '',
  estimated: false,
  source: 'bls',
  ...over,
});

const link = (from: Link['from'], predicate: Link['predicate'], to: Link['to']): Link => ({
  id: `${from.type}:${from.id}|${predicate}|${to.type}:${to.id}`,
  from,
  to,
  predicate,
  kind: 'structurel',
  by: 'moteur',
  createdAt: 0,
  updatedAt: 0,
});

function sources(over: Partial<IndexSources> = {}): IndexSources {
  return {
    sessions: [
      session('s1', '2026-10-14', 'Apex-PA-50K', -247.62),
      session('s2', '2026-10-20', 'Apex-PA-50K', 410),
      session('s3', '2026-03-27', 'SimApex1', 120, { instruments: ['ES'], tags: [] }),
    ],
    trades: [trade('t1', 's1', '2026-10-14T13:38:00Z', -150), trade('t2', 's2', '2026-10-20T14:05:00Z', 410)],
    notes: [
      { id: 'n1', title: 'Leçons du CPI', body: 'date: 2026-10-14\nNQ a cassé le plus bas.', tags: ['cpi'], updatedAt: 0 },
      { id: 'n2', title: 'ORB 15 min', body: 'tag: orb\nOuverture des quinze premières minutes.', tags: ['strategie'], updatedAt: 0 },
      { id: 'n3', title: 'Synthèse de l’agent', body: 'Le CPI pèse sur NQ.', tags: [], by: 'agent', updatedAt: 0 },
    ],
    catalysts: [
      event('cpi-oct', '2026-10-14', 'Inflation CPI'),
      event('gdp', '2026-10-29', 'PIB US (première estimation)', { estimated: true, source: 'local', category: 'croissance' }),
      event('cpi-nov', '2026-11-12', 'Inflation CPI', { estimated: true, source: 'local' }),
      event('ppi-next', '2027-10-14', 'Prix à la production (PPI)', { estimated: true, source: 'local' }),
      event('cpi-dec', '2026-12-10', 'Inflation CPI', { estimated: true, source: 'local' }),
      event('cpi-mar', '2026-03-11', 'Inflation CPI'),
      event('ism', '2026-10-20', 'ISM Manufacturier', { impact: 1, category: 'croissance', timeET: '10:00' }),
    ],
    links: [
      link({ type: 'session', id: 's1' }, 'applique', { type: 'strategie', id: 'n2' }),
      link({ type: 'session', id: 's2' }, 'applique', { type: 'strategie', id: 'n2' }),
      link({ type: 'note', id: 'n3' }, 'mentionne', { type: 'instrument', id: 'MNQ' }),
    ],
    cryptoEnabled: false,
    ...over,
  };
}

afterEach(() => {
  useI18n.setState({ locale: 'fr' });
});

const keys = (items: readonly OmniItem[]) => items.map((item) => item.key);

describe('OROS5.15 l’index de Ctrl+J', () => {
  it('huit groupes : modules, séances, trades, notes, catalyseurs, instruments, stratégies et comptes', () => {
    useI18n.setState({ locale: 'fr' });
    expect(OMNI_GROUPS).toEqual(['module', 'session', 'trade', 'note', 'evenement', 'instrument', 'strategie', 'compte']);
    const index = buildObjectIndex(sources(), NOW, 'fr');
    for (const group of OMNI_GROUPS) expect(index.some((item) => item.group === group), group).toBe(true);
    expect(index.every((item) => (OMNI_GROUPS as readonly string[]).includes(item.group))).toBe(true);
    // Les neuf modules du rail, dans l'ordre des raccourcis.
    expect(index.filter((item) => item.group === 'module').map((item) => item.meta)).toEqual(TABS.map((tab) => `Ctrl+${tab.index.slice(-1)}`));
    // Les trades : l'instrument, le sens, la quantité, le jour et l'heure de New York (09:38 ET : 13:38 UTC en heure d'été).
    const t1 = index.find((item) => item.key === 'trade:t1')!;
    expect(t1.title).toBe('NQ L 2 · 14.10 09:38 ET');
    expect(t1.target).toEqual({ kind: 'object', ref: { type: 'trade', id: 't1' } });
    expect(t1.tone).toBe('neg');
    // La stratégie : une note étiquetée `strategie`, objet de l'ontologie à part entière, et les séances qui l'appliquent.
    const orb = index.find((item) => item.key === 'strategie:n2')!;
    expect(orb.target).toEqual({ kind: 'object', ref: { type: 'strategie', id: 'n2' } });
    expect(orb.meta).toBe('2 séances');
    expect(orb.date).toBe('2026-10-20');
    // Les instruments du journal et des liens ; les comptes du journal, avec leurs séances.
    expect(index.filter((item) => item.group === 'instrument').map((item) => item.title).sort()).toEqual(['ES', 'MNQ', 'NQ']);
    expect(index.filter((item) => item.group === 'compte').map((item) => [item.title, item.meta])).toEqual([
      ['Apex-PA-50K', '2 séances'],
      ['SimApex1', '1 séance'],
    ]);
    // Une recherche rend ses groupes dans l'ordre de lecture.
    // Une note de stratégie est aussi une note : elle répond dans les deux groupes, chacun son objet.
    const found = searchObjectIndex(index, 'orb', NOW, 'fr').map((g) => g.group);
    expect(found).toEqual(['session', 'trade', 'note', 'strategie']);
  });

  it('le trait d’état ouvre chaque ligne : la table d’états, jamais une couleur', () => {
    const index = buildObjectIndex(sources(), NOW, 'fr');
    const stroke = (key: string) => index.find((item) => item.key === key)?.stroke;
    // publiée : plein ; prévue dans la fenêtre du desk (sept jours) : tireté ; au-delà de l'horizon : pointillé
    expect(stroke('evenement:cpi-oct')).toBe('plein');
    expect(stroke('evenement:gdp')).toBe('tirete');
    expect(stroke('evenement:cpi-nov')).toBe('pointille');
    expect(stroke('evenement:cpi-dec')).toBe('pointille');
    // Une note d'agent que le trader n'a pas adoptée est proposée ; adoptée, elle est en service.
    expect(stroke('note:n3')).toBe('tirete');
    expect(buildObjectIndex(sources({ notes: [{ id: 'n3', title: 'x', body: '', tags: [], by: 'agent', adoptedAt: 1, updatedAt: 0 }] }), NOW, 'fr').find((item) => item.key === 'note:n3')?.stroke).toBe('plein');
    // Crypto, éteint par défaut : le filet graphite ; activé, en service.
    expect(stroke('module:crypto')).toBe('eteint');
    expect(buildObjectIndex(sources({ cryptoEnabled: true }), NOW, 'fr').find((item) => item.key === 'module:crypto')?.stroke).toBe('plein');
    for (const item of index) expect(['plein', 'tirete', 'pointille', 'eteint'], item.key).toContain(item.stroke);
  });

  it('la liste des commandes est fermée : chaque ligne ouvre un module ou une fiche, rien n’écrit', () => {
    expect(Object.isFrozen(OMNIBAR_COMMANDS)).toBe(true);
    expect([...OMNIBAR_COMMANDS]).toEqual(['tab', 'object']);
    const tabs = new Set(TABS.map((tab) => tab.id));
    for (const item of buildObjectIndex(sources(), NOW, 'fr')) {
      expect(OMNIBAR_COMMANDS, item.key).toContain(item.target.kind);
      if (item.target.kind === 'tab') expect(tabs.has(item.target.tab), item.key).toBe(true);
      else expect(ENTITY_TYPES, item.key).toContain(item.target.ref.type);
      // Seules les données : aucune fonction dans une ligne, rien à exécuter.
      expect(Object.values(item).some((value) => typeof value === 'function'), item.key).toBe(false);
    }
    // Le module ne lit les stores que par leurs données, et ne joint ni le process principal ni le coffre.
    const src = readFileSync('src/app/objects/index.ts', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // La langue se lit hors du rendu (`useI18n.getState().locale`) ; rien d'autre ne passe par getState.
    expect(code).not.toMatch(/getState\(\)\.(?!locale\b)|setState\(|\bdesk\b|window\.canto|\bdb\.|localStorage|indexedDB/);
    const picked = [...code.matchAll(/\buse[A-Z]\w*\(\((\w+)\) => \1\.(\w+)\)/g)].map((m) => m[2]);
    expect(picked.length).toBeGreaterThan(0);
    expect([...new Set(picked)].sort()).toEqual(['enabled', 'events', 'links', 'locale', 'notes', 'sessions', 'trades']);
  });

  it('cinq résultats par groupe, triés par proximité de la date cherchée, sinon d’aujourd’hui', () => {
    const many = Array.from({ length: 8 }, (_, i) => session(`d${i}`, `2026-10-${String(13 + i).padStart(2, '0')}`, 'Apex-PA-50K', 10));
    const index = buildObjectIndex(sources({ sessions: [...many, session('old', '2025-10-14', 'Apex-PA-50K', 5)], trades: [] }), NOW, 'fr');
    // « 14.10 » : le 14.10 de l'année en cours, puis celui d'avant
    const day = searchObjectIndex(index, '14.10', NOW, 'fr').find((g) => g.group === 'session')!;
    expect(keys(day.items)).toEqual(['session:d1', 'session:old']);
    // l'année se dit quand elle n'est pas l'année en cours
    expect(day.items[1]!.title).toBe('14.10.2025 · Apex-PA-50K');
    // sans date tapée, la proximité d'aujourd'hui (27.10) : le 20.10 d'abord, puis le 19.10…
    const near = searchObjectIndex(index, 'apex', NOW, 'fr').find((g) => g.group === 'session')!;
    expect(near.total).toBe(9);
    expect(near.items).toHaveLength(OMNI_PER_GROUP);
    expect(keys(near.items)).toEqual(['session:d7', 'session:d6', 'session:d5', 'session:d4', 'session:d3']);
    // tous ceux qui répondent restent dans l'ordre : ↑ ↓ y passent d'une fiche à l'autre
    expect(keys(near.hits).slice(-2)).toEqual(['session:d0', 'session:old']);
    // « 18.10 apex » : chaque mot répond, et la proximité est celle du 18.10
    expect(keys(searchObjectIndex(index, '18.10 apex', NOW, 'fr')[0]!.items)).toEqual(['session:d5']);
    // « cpi » : la publication la plus proche d'aujourd'hui (14.10, à 13 jours) en tête, puis l'estimé du 12.11 (16 jours) ;
    // celle du 11.03 précède le journal, hors de la fenêtre
    const cpi = searchObjectIndex(buildObjectIndex(sources(), NOW, 'fr'), 'cpi', NOW, 'fr').find((g) => g.group === 'evenement')!;
    expect(keys(cpi.items)).toEqual(['evenement:cpi-oct', 'evenement:cpi-nov', 'evenement:cpi-dec']);
    // sans rien de tapé, les modules seuls
    expect(searchObjectIndex(index, '  ', NOW, 'fr').map((g) => [g.group, g.items.length])).toEqual([['module', 9]]);
  });

  it('les catalyseurs sont bornés à la fenêtre : un estimé de l’an prochain reste dehors, « ≈ » marque un estimé', () => {
    const index = buildObjectIndex(sources(), NOW, 'fr');
    const catalysts = index.filter((item) => item.group === 'evenement');
    // du début du journal (27.03) à aujourd'hui + 60 jours (26.12) ; impact 2 ou plus
    expect(catalystWindow(sources().sessions, '2026-10-27')).toEqual({ from: '2026-03-27', to: '2026-12-26' });
    expect(keys(catalysts).sort()).toEqual(['evenement:cpi-dec', 'evenement:cpi-nov', 'evenement:cpi-oct', 'evenement:gdp']);
    expect(catalysts.some((item) => item.key === 'evenement:ppi-next')).toBe(false);
    expect(searchObjectIndex(index, 'ppi', NOW, 'fr').some((g) => g.group === 'evenement')).toBe(false);
    const nov = catalysts.find((item) => item.key === 'evenement:cpi-nov')!;
    expect(nov.title).toBe('≈ Inflation CPI');
    expect(nov.meta).toBe('12.11 · 08:30 ET');
    expect(catalysts.find((item) => item.key === 'evenement:cpi-oct')!.title).toBe('Inflation CPI');
    // sans journal, la fenêtre part d'aujourd'hui
    expect(catalystWindow([], '2026-10-27')).toEqual({ from: '2026-10-27', to: '2026-12-26' });
  });

  it('les dates se lisent et s’écrivent dans la langue du desk', () => {
    expect(parseDayQuery('14.10', 2026, 'fr')).toBe('2026-10-14');
    expect(parseDayQuery('14/10/2027', 2026, 'fr')).toBe('2027-10-14');
    expect(parseDayQuery('2026-10-14', 2026, 'fr')).toBe('2026-10-14');
    expect(parseDayQuery('10/14', 2026, 'en')).toBe('2026-10-14');
    expect(parseDayQuery('cpi', 2026, 'fr')).toBeNull();
    expect(dayWithYear('2026-10-14', NOW, 'fr')).toBe('14.10');
    expect(dayWithYear('2027-10-14', NOW, 'es')).toBe('14.10.2027');
    expect(dayWithYear('2027-10-14', NOW, 'en')).toBe('10/14/2027');
    // le nom en clair d'un objet, tel que la fiche et le fil d'Ariane l'écrivent
    useI18n.setState({ locale: 'en' });
    const ctx = sources();
    expect(objectLabel({ type: 'session', id: 's1' }, ctx, NOW, 'en')).toBe('10/14 · Apex-PA-50K');
    expect(objectLabel({ type: 'evenement', id: 'cpi-nov' }, ctx, NOW, 'en')).toBe('≈ CPI inflation · 11/12');
    expect(objectLabel({ type: 'trade', id: 't2' }, ctx, NOW, 'en')).toBe('NQ L 2 · 10/20 10:05 ET');
    expect(objectLabel({ type: 'strategie', id: 'n2' }, ctx, NOW, 'en')).toBe('ORB 15 min');
    expect(objectLabel({ type: 'compte', id: 'SimApex1' }, ctx, NOW, 'en')).toBe('SimApex1');
    expect(objectLabel({ type: 'session', id: 'disparue' }, ctx, NOW, 'en')).toBeNull();
  });
});
