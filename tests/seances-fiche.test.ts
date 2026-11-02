/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLYPH_ID } from '@/design/Micro';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import m from '@/modules/metrique/metrique.module.css';
import { Sessions } from '@/modules/metrique/Sessions';
import { useJournal } from '@/store/journal';
import { useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * OROS5.33 — B · Séances ouvre la fiche sans toucher l'édition (décision 12). Le clic sur une ligne garde l'édition
 * d'aujourd'hui ; le glyphe C.094 en tête de ligne, un bouton nommé « Ouvrir la fiche », ouvre la fiche. Sous 1 000 px,
 * la grille resserre ses cellules sans couper Éval. ni Source.
 */

const session = (id: string, date: string, pnl: number): Session => ({ id, date, account: 'Sim101', instruments: ['NQ'], source: 'csv', tradeCount: 1, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], rating: 4, createdAt: 0, updatedAt: 0 });
const trade = (id: string, sessionId: string, date: string, pnl: number): Trade => ({ id, sessionId, instrument: 'NQ', account: 'Sim101', direction: 'long', qty: 1, entryTime: Date.parse(`${date}T14:00:00Z`), exitTime: Date.parse(`${date}T14:05:00Z`), entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0 });

const SESSIONS = [session('s1', '2026-09-01', 200), session('s2', '2026-09-02', -80), session('s3', '2026-09-03', 120)];
const TRADES = [trade('t1', 's1', '2026-09-01', 200), trade('t2', 's2', '2026-09-02', -80), trade('t3', 's3', '2026-09-03', 120)];

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(async () => {
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique', metricAccount: null, metricRange: 'tout', metricInstrument: null });
  useJournal.setState({ sessions: SESSIONS, trades: TRADES });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(Sessions)));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const rows = () => [...host!.querySelectorAll<HTMLTableRowElement>('tbody tr.clickable')];
const glyph = (row: HTMLElement) => row.querySelector<HTMLButtonElement>('button[data-open-fiche]')!;
/** Le panneau d'édition est ouvert : le détail de la séance a remplacé l'invite. */
const editing = () => !(host!.textContent ?? '').includes('sélectionnez une séance');

describe('OROS5.33 B · Séances ouvre la fiche par le glyphe, la ligne garde l’édition', () => {
  it('le glyphe C.094 en tête de ligne, un bouton nommé « Ouvrir la fiche », ouvre la fiche, et seulement elle', async () => {
    const [first] = rows();
    const button = glyph(first!);
    // en tête de ligne : la première cellule après la coche, devant la date
    expect(button.closest('td')).toBe(first!.cells[1]);
    expect(button.getAttribute('aria-label')).toBe('Ouvrir la fiche');
    expect(button.querySelector(`svg.skg-${GLYPH_ID.session}`)).not.toBeNull();
    expect(rows().map((row) => glyph(row).getAttribute('aria-label'))).toEqual(['Ouvrir la fiche', 'Ouvrir la fiche', 'Ouvrir la fiche']);

    await act(async () => button.click());
    // la fiche de la séance, ↑ ↓ passant aux voisines de la liste, dans son ordre (la plus récente d'abord)
    expect(useObjects.getState().open).toEqual({ type: 'session', id: 's3' });
    expect(useObjects.getState().siblings.map((ref) => ref.id)).toEqual(['s3', 's2', 's1']);
    expect(useObjects.getState().origin).toBe(button);
    // l'édition n'a pas bougé
    expect(editing()).toBe(false);
    // l'objet ouvert : son glyphe passe à l'or (décision 1)
    expect(glyph(rows()[0]!).getAttribute('aria-current')).toBe('true');
    expect(cssRules(readFileSync('src/modules/metrique/metrique.module.css', 'utf8')).find((rule) => rule.selector === ".openFiche[aria-current='true']" && rule.at.length === 0)?.body).toMatch(/--k: var\(--gold\)/);

    // au clavier : Entrée sur le glyphe n'atteint pas la ligne, qui ouvrirait l'édition
    act(() => void useObjects.getState().close(false));
    const second = glyph(rows()[1]!);
    await act(async () => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      second.click();
    });
    expect(useObjects.getState().open).toEqual({ type: 'session', id: 's2' });
    expect(editing()).toBe(false);

    // en anglais, le même bouton se nomme dans la langue du desk
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(glyph(rows()[0]!).getAttribute('aria-label')).toBe('Open the record');
  });

  it('le clic sur une ligne ouvre l’édition d’aujourd’hui, sans ouvrir la fiche', async () => {
    await act(async () => rows()[1]!.click());
    expect(editing()).toBe(true);
    expect(rows()[1]!.classList.contains('selected')).toBe(true);
    expect(useObjects.getState().open).toBeNull();
    // Entrée sur la ligne aussi
    await act(async () => rows()[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(rows()[2]!.classList.contains('selected')).toBe(true);
    expect(useObjects.getState().open).toBeNull();
  });

  it('sous 1 000 px, la grille resserre ses cellules et abrège la date et deux en-têtes, sans couper Éval. ni Source', () => {
    const css = cssRules(readFileSync('src/modules/metrique/metrique.module.css', 'utf8'));
    const inGrille = (head: string) => css.filter((rule) => rule.at.some((at) => at.replace(/\s+/g, ' ') === head));
    // la grille se mesure elle-même
    expect(css.find((rule) => rule.selector === '.grille')?.body).toMatch(/container: grille \/ inline-size/);
    const narrow = inGrille('@container grille (max-width: 1000px)');
    expect(narrow.find((rule) => rule.selector.includes('.grilleTable th'))?.body).toMatch(/padding-left: 6px;[\s\S]*padding-right: 6px;/);
    expect(narrow.find((rule) => rule.selector === '.grilleTable .long')?.body).toMatch(/display: none/);
    expect(narrow.find((rule) => rule.selector === '.grilleTable .short')?.body).toMatch(/display: inline/);
    expect(inGrille('@container grille (max-width: 800px)').length).toBeGreaterThan(0);
    // rien d'autre ne disparaît : seules les formes longues se cachent, aucune colonne
    for (const rule of css.filter((r) => /display: none/.test(r.body))) expect(rule.selector, rule.selector).toMatch(/^(\.short|\.grilleTable \.long)$/);
    // la grille garde ses dix colonnes, Éval. et Source comprises ; la date et deux en-têtes ont leur forme courte
    const heads = [...host!.querySelectorAll<HTMLTableCellElement>('thead th')];
    expect(heads).toHaveLength(10);
    expect(heads.slice(-2).map((th) => th.textContent)).toEqual(['Éval.', 'Source']);
    expect([...host!.querySelectorAll(`thead .${m.short}`)].map((el) => el.textContent)).toEqual(['Tr.', 'Réus.']);
    const date = rows()[0]!.cells[1]!;
    expect(date.querySelector(`.${m.long}`)!.textContent).toBe('jeu. 3 sept. 2026');
    expect(date.querySelector(`.${m.short}`)!.textContent).toBe('03.09');
    expect(rows()[0]!.cells).toHaveLength(10);
    // à l'étroit, l'édition passe sous la grille, qui prend toute la zone
    const stack = css.find((rule) => rule.selector === '.seancesSplit' && rule.at.some((at) => /^@container main \(max-width: \d+px\)$/.test(at)));
    expect(stack?.body).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
  });
});
