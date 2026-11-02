/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));
// Le tableau de bord (graphiques sur canevas) n'est pas l'objet du test.
vi.mock('@/modules/metrique/Dashboard', () => ({ Dashboard: () => null }));

import { Shell } from '@/app/Shell';
import { GLYPH_ID } from '@/design/Micro';
import e from '@/design/etat.module.css';
import type { Link } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';

/**
 * OROS5.16 — la fiche est la troisième colonne du châssis : enfant du châssis, hors de `main`, posée seulement quand un
 * objet est ouvert (220 | 1fr | 400), inerte avec lui sous le verrou. Le cadre commun (en-tête, Propriétés, Liens par
 * prédicat, Provenance) s'y vérifie de bout en bout sur une séance, et le fil d'Ariane va jusqu'à l'objet.
 */

const NOW = Date.parse('2026-10-27T16:00:00Z');
const CPI = 'ev_cpi_2026-10-14';

const session = (id: string, date: string, account: string, pnl: number): Session => ({
  id,
  date,
  account,
  instruments: ['NQ'],
  source: 'ninjatrader',
  tradeCount: 2,
  pnl,
  grossProfit: 200,
  grossLoss: -440,
  commission: 7.62,
  tags: ['orb'],
  rating: 3,
  createdAt: Date.parse('2026-10-14T21:02:00Z'),
  updatedAt: 0,
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
  exitPrice: 19_990,
  pnl,
  commission: 3.81,
});

const link = (from: Link['from'], predicate: Link['predicate'], to: Link['to'], kind: Link['kind'] = 'structurel'): Link => ({
  id: `${from.type}:${from.id}|${predicate}|${to.type}:${to.id}`,
  from,
  to,
  predicate,
  kind,
  by: 'moteur',
  createdAt: 0,
  updatedAt: 0,
});

const S1 = { type: 'session', id: 'ses_7f3a9c21d4' } as const;
const S2 = { type: 'session', id: 'ses_b02e' } as const;

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
const shell = (inert = false, children: ReactNode = createElement('div', null, 'module')) => createElement(Shell, { inert, children });
const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique', crumb: { tab: 'metrique', label: 'TABLEAU DE BORD' } });
  useJournal.setState({
    sessions: [session(S1.id, '2026-10-14', 'Apex-PA-50K', -247.62), session(S2.id, '2026-10-20', 'Apex-PA-50K', 410)],
    // l'ordre du coffre n'est pas celui du temps : t2 entre avant t1
    trades: [trade('t1', S1.id, '2026-10-14T14:05:00Z', -150), trade('t2', S1.id, '2026-10-14T13:38:00Z', -97.62)],
  });
  useNotes.setState({ notes: [] });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useLinks.setState({
    links: [
      link({ type: 'trade', id: 't1' }, 'de-la-seance', S1),
      link({ type: 'trade', id: 't2' }, 'de-la-seance', S1),
      link(S1, 'pendant', { type: 'evenement', id: CPI }),
      link({ type: 'trade', id: 't1' }, 'pendant', { type: 'evenement', id: CPI }),
      link({ type: 'note', id: 'n-x' }, 'relie', S1, 'rejete'),
    ],
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

const shellCss = cssRules(readFileSync('src/app/shell.module.css', 'utf8'));
const ficheCss = cssRules(readFileSync('src/app/objects/fiche.module.css', 'utf8'));
const bodyOf = (rules: ReturnType<typeof cssRules>, selector: string, at: (heads: string[]) => boolean = (heads) => heads.length === 0) =>
  rules.find((rule) => rule.selector === selector && at(rule.at))?.body ?? '';

describe('OROS5.16 la fiche, troisième colonne du châssis', () => {
  it('le tiroir est un enfant du châssis, hors de main ; trois colonnes avec un objet ouvert, deux sans', () => {
    const el = mount(shell());
    const chassis = el.firstElementChild as HTMLElement;
    expect(el.querySelector('[data-drawer]')).toBeNull();
    expect(chassis.className).not.toMatch(/withDrawer/);
    act(() => void useObjects.getState().openObject(S1, { siblings: [S1, S2] }));
    const drawer = el.querySelector<HTMLElement>('aside[data-drawer="session"]')!;
    expect(drawer).not.toBeNull();
    expect(drawer.parentElement).toBe(chassis);
    expect(drawer.closest('main')).toBeNull();
    expect(chassis.className).toMatch(/withDrawer/);
    // la fiche suit la zone de travail dans l'ordre du document : main, la fiche, puis la barre d'état
    expect(chassis.querySelector('main')!.nextElementSibling).toBe(drawer);
    expect(drawer.nextElementSibling?.getAttribute('data-chassis')).toBe('status');
    // la grille : deux colonnes sans objet, 220 | 1fr | 400 avec ; 400 px reste une mesure locale
    expect(bodyOf(shellCss, '.shell')).toMatch(/grid-template-columns: var\(--rail-w\) minmax\(0, 1fr\);/);
    expect(bodyOf(shellCss, '.shell')).toMatch(/'rail main'/);
    expect(bodyOf(shellCss, '.shell.withDrawer')).toMatch(/grid-template-columns: var\(--rail-w\) minmax\(0, 1fr\) 400px;/);
    expect(bodyOf(shellCss, '.shell.withDrawer')).toMatch(/'title title title'[\s\S]*'band band band'[\s\S]*'rail main drawer'[\s\S]*'status status status'/);
    expect(readFileSync('src/design/tokens.css', 'utf8')).not.toMatch(/--drawer-w|400px/);
    // la fiche n'est posée sur rien : sa colonne, et l'opacité seule pour entrer
    const drawerCss = bodyOf(ficheCss, '.drawer');
    expect(drawerCss).toMatch(/grid-area: drawer/);
    expect(drawerCss).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(drawerCss).toMatch(/animation: ficheIn var\(--t-med\) linear both/);
    expect(bodyOf(ficheCss, 'from', (heads) => heads.includes('@keyframes ficheIn'))).toMatch(/opacity: 0/);
    // la zone de travail se mesure elle-même : sous 1 100 px, A.01 prend la largeur et la bande K passe dessous
    expect(bodyOf(shellCss, '.main')).toMatch(/container: main \/ inline-size/);
    const dash = cssRules(readFileSync('src/modules/metrique/dashboard.module.css', 'utf8'));
    const inMain = (heads: string[]) => heads.includes('@container main (max-width: 1100px)');
    expect(dash.find((r) => r.selector.includes('.span7') && inMain(r.at))?.body).toMatch(/grid-column: 1 \/ -1/);
    expect(bodyOf(dash, '.kpis', inMain)).toMatch(/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    // fermée, la colonne s'en va
    act(() => void useObjects.getState().close(false));
    expect(el.querySelector('[data-drawer]')).toBeNull();
    expect(chassis.className).not.toMatch(/withDrawer/);
  });

  it('le cadre commun, de bout en bout sur une séance : glyphe à l’or, identifiant en clair, trois actions, Propriétés, Liens par prédicat, Provenance', () => {
    const el = mount(shell());
    act(() => void useObjects.getState().openObject(S1, { siblings: [S1, S2] }));
    const drawer = el.querySelector<HTMLElement>('aside[data-drawer]')!;
    const head = drawer.querySelector('header')!;
    // le glyphe de la séance (C.094), seul à l'or : l'objet ouvert (décision 1)
    const glyph = head.querySelector(`svg.skg-${GLYPH_ID.session}`)!;
    expect(glyph).not.toBeNull();
    expect(glyph.closest('[class*="headGlyph"]')).not.toBeNull();
    expect(bodyOf(ficheCss, '.headGlyph')).toMatch(/--k: var\(--gold\)/);
    const gold = ficheCss.filter((rule) => /var\(--gold/.test(rule.body)).map((rule) => rule.selector);
    expect(gold).toEqual(['.headGlyph']);
    // l'identifiant en clair ; la clé interne ne sert qu'au geste « copier »
    expect(head.querySelector('h2')!.textContent).toBe('Séance · 14.10 · Apex-PA-50K');
    expect(drawer.textContent).not.toContain(S1.id);
    expect(drawer.textContent).not.toMatch(/ses_7f3a…|…/);
    // trois actions au plus, puis la fermeture
    expect([...head.querySelectorAll('button')].map((b) => b.dataset.action)).toEqual(['calendar', 'visual', 'copy', 'close']);
    // les sections du cadre, dans l'ordre
    expect([...drawer.querySelectorAll('section')].map((sec) => sec.dataset.section)).toEqual(['properties', 'links', 'provenance']);
    const props = [...drawer.querySelectorAll('[data-section="properties"] dt')].map((dt) => dt.textContent);
    expect(props.slice(0, 5)).toEqual(['Jour', 'Compte', 'Instruments', 'P&L net', 'Trades']);
    expect(drawer.querySelector('[data-section="properties"]')!.textContent).toContain('2 · 0 gagnants');
    // les liens par prédicat : les trades de la séance, puis le catalyseur « pendant » ; le rejeté n'est pas un voisin
    const groups = [...drawer.querySelectorAll<HTMLElement>('[data-group]')];
    expect(groups.map((g) => g.dataset.group)).toEqual(['in:de-la-seance:trade', 'out:pendant:evenement']);
    expect(groups.map((g) => g.querySelectorAll('button').length)).toEqual([2, 1]);
    // chaque groupe dans l'ordre du temps, l'heure de New York (13:38 UTC : 09:38 ET)
    expect([...groups[0]!.querySelectorAll('button')].map((b) => b.textContent?.replace('→', '').trim())).toEqual(['NQ L 2 · 14.10 09:38 ET', 'NQ L 2 · 14.10 10:05 ET']);
    expect(groups[0]!.textContent).toContain('de la séance');
    expect(groups[1]!.textContent).toContain('≈ Inflation CPI · 14.10');
    // le trait de chaque lien vient de la table d'états
    const marks = [...drawer.querySelectorAll<HTMLElement>('[data-link] [data-etat]')];
    expect(marks).toHaveLength(3);
    for (const mark of marks) expect(mark.classList.contains(e.plein!)).toBe(true);
    // la provenance : la source de la séance, le genre et l'auteur des liens (le rejeté compris)
    const prov = drawer.querySelector('[data-section="provenance"]')!.textContent!;
    expect(prov).toContain('NinjaTrader');
    expect(prov).toContain('3 structurels');
    expect(prov).toContain('1 rejetés');
    expect(prov).toContain('moteur 4');
  });

  it('le fil d’Ariane va jusqu’à l’objet et porte l’objet d’avant ; Retour arrière le rend, Échap rend le focus à la ligne', () => {
    const el = mount(shell());
    const row = document.createElement('button');
    document.body.append(row);
    try {
      row.focus();
      act(() => void useObjects.getState().openObject(S1, { origin: row, siblings: [S1, S2] }));
      const crumb = () => el.querySelector('header [data-crumb="object"]')?.textContent ?? null;
      const crumbs = () => [...el.querySelector('header')!.querySelectorAll('button[class*="crumb"]')].map((b) => b.textContent);
      expect(crumb()).toBe('14.10 · Apex-PA-50K');
      expect(crumbs()).toEqual(['14.10 · Apex-PA-50K']);
      // le module et sa vue restent dans le fil, avant l'objet
      expect(el.querySelector('header')!.textContent).toMatch(/01\/MÉTRIQUE\/TABLEAU DE BORD\/14\.10 · Apex-PA-50K/);
      // un lien suivi : un saut, le fil porte la séance d'où l'on vient
      const cpi = [...el.querySelectorAll<HTMLButtonElement>('[data-group="out:pendant:evenement"] button')][0]!;
      act(() => cpi.click());
      expect(el.querySelector('aside[data-drawer]')!.getAttribute('data-drawer')).toBe('evenement');
      expect(crumbs()).toEqual(['14.10 · Apex-PA-50K', '≈ Inflation CPI · 14.10']);
      // Retour arrière : la séance revient, le fil ne prétend plus de chemin
      key('Backspace');
      expect(el.querySelector('aside[data-drawer]')!.getAttribute('data-drawer')).toBe('session');
      expect(crumbs()).toEqual(['14.10 · Apex-PA-50K']);
      // ↑ ↓, la fiche ayant le focus : l'objet voisin, sans fermer
      const drawer = el.querySelector<HTMLElement>('aside[data-drawer]')!;
      act(() => drawer.focus());
      act(() => void drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
      expect(useObjects.getState().open).toEqual(S2);
      expect(crumb()).toBe('20.10 · Apex-PA-50K');
      // Échap ferme et rend le focus à la ligne d'origine
      key('Escape');
      expect(el.querySelector('aside[data-drawer]')).toBeNull();
      expect(document.activeElement).toBe(row);
      expect(el.querySelector('header [data-crumb="object"]')).toBeNull();
    } finally {
      row.remove();
    }
  });

  it('inerte sous le verrou : la fiche suit le châssis, ni Échap, ni Retour arrière, ni ouverture', () => {
    const el = mount(shell());
    act(() => void useObjects.getState().openObject(S1, { siblings: [S1] }));
    act(() => void useObjects.getState().openObject({ type: 'evenement', id: CPI }, { jump: true }));
    act(() => root!.render(shell(true)));
    const chassis = el.firstElementChild as HTMLElement;
    expect(chassis.hasAttribute('inert')).toBe(true);
    expect(useObjects.getState().locked).toBe(true);
    const drawer = el.querySelector<HTMLElement>('aside[data-drawer]')!;
    expect(drawer.closest('[inert]')).toBe(chassis);
    key('Escape');
    key('Backspace');
    expect(useObjects.getState().open).toEqual({ type: 'evenement', id: CPI });
    expect(useObjects.getState().history).toHaveLength(1);
    act(() => void useObjects.getState().openObject(S2, { jump: true }));
    expect(useObjects.getState().open).toEqual({ type: 'evenement', id: CPI });
    // le verrou passé, la fiche répond
    act(() => root!.render(shell(false)));
    expect(useObjects.getState().locked).toBe(false);
    key('Backspace');
    expect(useObjects.getState().open).toEqual(S1);
    key('Escape');
    expect(useObjects.getState().open).toBeNull();
  });

  it('un champ et un dialogue ouverts gardent leurs touches : ni Échap ni Retour arrière ne touchent la fiche', () => {
    const el = mount(shell());
    act(() => void useObjects.getState().openObject(S1, { siblings: [S1] }));
    act(() => void useObjects.getState().openObject({ type: 'evenement', id: CPI }, { jump: true }));
    const input = document.createElement('input');
    el.querySelector('main')!.append(input);
    input.focus();
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })));
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(useObjects.getState().open).toEqual({ type: 'evenement', id: CPI });
    input.remove();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    key('Escape');
    expect(useObjects.getState().open).toEqual({ type: 'evenement', id: CPI });
    dialog.remove();
  });

  it('Retour arrière rend la vue de Métrique : la vue est confiée au store, quitter l’onglet l’oublie', async () => {
    const { default: Metrique } = await import('@/modules/metrique/Metrique');
    const el = mount(createElement(Metrique));
    const tab = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.includes(name))!;
    act(() => tab('Séances').click());
    expect(useObjects.getState().views.metrique).toBe('seances');
    expect(tab('Séances').getAttribute('aria-selected')).toBe('true');
    // une action de la fiche quitte Métrique pour le Calendrier : un saut ; le module se démonte
    act(() => void useObjects.getState().openObject(S1, { siblings: [S1] }));
    act(() => void useObjects.getState().jumpTo('calendrier'));
    act(() => root!.render(createElement('div')));
    expect(useUi.getState().tab).toBe('calendrier');
    expect(useObjects.getState().views.metrique).toBeUndefined();
    // Retour arrière : Métrique revient sur B · Séances, et la fiche de la séance
    act(() => void useObjects.getState().back());
    act(() => root!.render(createElement(Metrique)));
    expect(useUi.getState().tab).toBe('metrique');
    expect(tab('Séances').getAttribute('aria-selected')).toBe('true');
    expect(useObjects.getState().open).toEqual(S1);
    // revenir par le rail, après l'avoir quitté : le Tableau de bord, comme avant
    act(() => useUi.getState().setTab('visual'));
    act(() => root!.render(createElement('div')));
    act(() => useUi.getState().setTab('metrique'));
    act(() => root!.render(createElement(Metrique)));
    expect(tab('Tableau de bord').getAttribute('aria-selected')).toBe('true');
  });

  it('au Calendrier, la fiche prend la place de la colonne du Jour', async () => {
    const { default: Calendrier } = await import('@/modules/calendrier/Calendrier');
    const el = mount(createElement(Calendrier));
    await act(async () => undefined);
    expect(el.querySelector('[data-legend="trait"]')).not.toBeNull();
    act(() => void useObjects.getState().openObject(S1, { siblings: [S1] }));
    expect(el.querySelector('[data-legend="trait"]')).toBeNull();
    const layout = el.querySelector('[class*="layout"]')!;
    expect(layout.className).toMatch(/solo/);
    const cal = cssRules(readFileSync('src/modules/calendrier/calendrier.module.css', 'utf8'));
    expect(bodyOf(cal, '.layout.solo')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    act(() => void useObjects.getState().close(false));
    expect(el.querySelector('[data-legend="trait"]')).not.toBeNull();
  });
});
