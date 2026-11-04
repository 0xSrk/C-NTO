/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Butterfly, BUTTERFLY_FROM, BUTTERFLY_TO, butterflyGeometry, butterflyRows } from '@/design/instruments/Butterfly';
import { groupIntoSessions } from '@/engine/import/ninjatrader';
import { computeTradeStats } from '@/engine/metrics';
import { byEntryHour, entryHourET, selectJournal } from '@/engine/selection';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { Dashboard } from '@/modules/metrique/Dashboard';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * OROS5.35 — M.003 occupe le vide de A.03 (Système 5 « Fiche et Frise » ; repris du prototype C · Frise, d3). Il lit
 * `TradeStats.byHour` à l'heure de New York, de 08 à 16 h : perdants à gauche, gagnants à droite, à angle droit et à
 * l'ivoire des deux côtés ; « — » pour une heure sans trade ; gagnants / n à droite ; l'heure du curseur à l'or. Un clic
 * sur une heure pose la puce Heure de la sélection partagée. La géométrie est pure ; `role="img"` dit la valeur.
 */

/** Un trade entré à `hour`:`min` heure de New York (EDT, UTC−4, en juillet). */
function trade(id: string, date: string, hour: number, pnl: number, min = 10, instrument = 'NQ'): Trade {
  const entryTime = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-04:00`);
  return { id, sessionId: '', instrument, account: 'A', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 600_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0 };
}

/** 09 h : 3 gagnants sur 5 ; 10 h : 1 sur 2 ; 14 h : 0 sur 1 ; 11 h, 12 h, 13 h, 08 h et 15–16 h : rien. */
const TRADES: Trade[] = [
  trade('a1', '2026-07-06', 9, 100),
  trade('a2', '2026-07-06', 9, -50, 40),
  trade('a3', '2026-07-07', 9, 80, 20),
  trade('a4', '2026-07-07', 10, -30),
  trade('a5', '2026-07-08', 9, 60, 5),
  trade('a6', '2026-07-08', 9, -20, 50),
  trade('a7', '2026-07-08', 10, 40, 30, 'ES'),
  trade('a8', '2026-07-09', 14, -70),
];
/** Les séances du journal : le regroupement range chaque trade dans la sienne (`sessionId`). */
const SESSIONS: Session[] = groupIntoSessions(TRADES, 18, 'csv');
const JOURNAL_TRADES: Trade[] = TRADES;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  useI18n.setState({ locale: 'fr' });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, startingBalance: 50_000 } });
  useUi.setState({ metricAccount: null, metricInstrument: null, metricHour: null, timeCursor: null });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useUi.setState({ metricHour: null, timeCursor: null });
  vi.unstubAllGlobals();
});

async function render(el: ReturnType<typeof createElement>): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(el));
  return host;
}

const dashboard = () =>
  render(
    createElement(Dashboard, {
      sessions: SESSIONS,
      trades: JOURNAL_TRADES,
      range: 'tout',
      period: { from: null, to: '2026-07-09' },
      history: { sessions: SESSIONS, trades: JOURNAL_TRADES },
      journalEmpty: false,
      onImport: () => undefined,
      onDemo: () => undefined,
      onSessions: () => undefined,
    }),
  );

describe('OROS5.35 M.003 : gagnants et perdants par heure de New York', () => {
  it('les barres égalent byHour, de 08 à 16 h : gagnants à droite, perdants à gauche, à la même échelle', () => {
    const stats = computeTradeStats(JOURNAL_TRADES);
    const rows = butterflyRows(stats.byHour);
    expect([BUTTERFLY_FROM, BUTTERFLY_TO]).toEqual([8, 16]);
    expect(rows.map((r) => r.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
    for (const r of rows) {
      const bucket = stats.byHour.find((b) => Number(b.key) === r.hour)!;
      expect([r.winners, r.losers, r.n], `${r.hour} h`).toEqual([bucket.wins, bucket.count - bucket.wins, bucket.count]);
    }
    expect(rows.find((r) => r.hour === 9)).toMatchObject({ winners: 3, losers: 2, n: 5 });
    // L'heure est celle de New York, comme byHour : la même règle sert la puce (entryHourET).
    expect(JOURNAL_TRADES.map(entryHourET)).toEqual([9, 9, 9, 10, 9, 9, 10, 14]);
    // La géométrie : un axe au milieu, une demi-portée commune ; le plus grand côté touche le bord de la portée.
    const g = butterflyGeometry(rows);
    const nine = g.bars.find((b) => b.hour === 9)!;
    expect(nine.win!.x).toBe(g.axis);
    expect(nine.win!.w).toBeCloseTo(g.span, 6);
    expect(nine.loss!.x + nine.loss!.w).toBeCloseTo(g.axis, 6);
    expect(nine.loss!.w).toBeCloseTo((2 / 3) * g.span, 6);
    const ten = g.bars.find((b) => b.hour === 10)!;
    expect([ten.win!.w, ten.loss!.w].map((w) => w / g.span)).toEqual([1 / 3, 1 / 3]);
    const two = g.bars.find((b) => b.hour === 14)!;
    expect(two.win).toBeNull();
    expect(two.loss!.w / g.span).toBeCloseTo(1 / 3, 6);
    // Une rangée par heure, de haut en bas, à pas constant.
    expect(g.bars.map((b) => b.y)).toEqual(rows.map((_, i) => i * g.row));
  });

  it('une heure sans trade : ni barre ni zéro, « — » ; une heure hors de 08–16 h élargit la plage, rien n’est caché', () => {
    const rows = butterflyRows(computeTradeStats(JOURNAL_TRADES).byHour);
    const g = butterflyGeometry(rows);
    for (const hour of [8, 11, 12, 13, 15, 16]) {
      const bar = g.bars.find((b) => b.hour === hour)!;
      expect([bar.win, bar.loss, bar.none, bar.count], `${hour} h`).toEqual([null, null, true, '—']);
    }
    expect(g.bars.find((b) => b.hour === 9)!.count).toBe('3/5');
    const late = [...JOURNAL_TRADES, { ...JOURNAL_TRADES[0]!, id: 'late', entryTime: Date.parse('2026-07-06T17:30:00-04:00') }];
    expect(butterflyRows(computeTradeStats(late).byHour).map((r) => r.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('OROS5.35a un trade nul n’est ni gagnant ni perdant : il compte dans n, sans barre, comme les statistiques du moteur', () => {
    // Un scratch à 10:05 ET sur un compte Sim sans commission : pnl 0. Et à 11 h, un perdant et un nul.
    const scratch = [trade('z1', '2026-07-06', 10, 0, 5), trade('z2', '2026-07-06', 11, -40), trade('z3', '2026-07-06', 11, 0, 40)];
    const stats = computeTradeStats(scratch);
    expect([stats.wins, stats.losses, stats.breakeven]).toEqual([0, 1, 2]);
    const rows = butterflyRows(stats.byHour);
    expect(rows.find((r) => r.hour === 10)).toEqual({ hour: 10, winners: 0, losers: 0, n: 1 });
    expect(rows.find((r) => r.hour === 11)).toEqual({ hour: 11, winners: 0, losers: 1, n: 2 });
    const g = butterflyGeometry(rows);
    const ten = g.bars.find((b) => b.hour === 10)!;
    // Ni barre à gauche sous « PERDANTS », ni « — » : l'heure a un trade.
    expect([ten.win, ten.loss, ten.none, ten.count]).toEqual([null, null, false, '0/1']);
    expect(g.bars.find((b) => b.hour === 11)!.loss!.w).toBeCloseTo(g.span, 6);
  });

  it('role="img" dit la valeur, en trois langues ; gagnants / n à droite ; l’heure du curseur à l’or', async () => {
    const rows = butterflyRows(computeTradeStats(JOURNAL_TRADES).byHour);
    const node = await render(createElement(Butterfly, { rows, cursorHour: 10, hour: null, onHour: () => undefined }));
    const img = node.querySelector('[role="img"]')!;
    expect(img.getAttribute('aria-label')).toBe(
      'Trades par heure d’entrée à New York : 08 h aucun ; 09 h 3 gagnants sur 5 ; 10 h 1 gagnant sur 2 ; 11 h aucun ; 12 h aucun ; 13 h aucun ; 14 h 0 gagnant sur 1 ; 15 h aucun ; 16 h aucun',
    );
    // Les comptes à droite, ligne à ligne : « — » sans trade.
    expect([...node.querySelectorAll('[data-hour-count]')].map((el) => el.textContent)).toEqual(['—', '3/5', '1/2', '—', '—', '—', '0/1', '—', '—']);
    // Les barres à angle droit, à l'ivoire des deux côtés : des rectangles sans rayon, de la même classe.
    const rects = [...node.querySelectorAll('svg rect')];
    expect(rects).toHaveLength(5);
    for (const rect of rects) {
      expect(rect.getAttribute('rx')).toBeNull();
      expect(rect.getAttribute('class')).toBe(rects[0]!.getAttribute('class'));
    }
    // L'heure du curseur, à l'or : une seule.
    expect([...node.querySelectorAll('[data-cursor]')].map((el) => el.getAttribute('data-hour'))).toEqual(['10']);
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/design/instruments/instruments.module.css', 'utf8').replace(/\r\n/g, '\n');
    expect(css).toMatch(/\.bar\s*\{[^}]*fill:\s*var\(--text-0\)/);
    expect(css).toMatch(/\.hour\[data-cursor\][^{]*\{[^}]*color:\s*var\(--gold\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    await act(async () => useI18n.setState({ locale: 'en' }));
    expect(img.getAttribute('aria-label')).toMatch(/^Trades by New York entry hour: 08:00 none; 09:00 3 winners out of 5;/);
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(img.getAttribute('aria-label')).toMatch(/^Trades por hora de entrada en Nueva York: 08 h ninguno; 09 h 3 ganadores de 5;/);
  });

  it('dans A.03, un clic sur une heure pose la puce Heure de la sélection partagée ; un second clic la retire', async () => {
    const node = await dashboard();
    const a03 = [...node.querySelectorAll('span')].find((el) => el.textContent?.trim() === 'A.03')!.closest('section')!;
    expect(a03.querySelector('[data-instrument-figure="M.003"]')).not.toBeNull();
    const nine = a03.querySelector<HTMLButtonElement>('button[data-hour="9"]')!;
    expect(nine.getAttribute('aria-pressed')).toBe('false');
    await act(async () => nine.click());
    expect(useUi.getState().metricHour).toBe(9);
    expect(nine.getAttribute('aria-pressed')).toBe('true');
    // Les autres heures restent, atténuées : rien ne disparaît.
    expect(a03.querySelectorAll('button[data-hour][data-out]')).toHaveLength(8);
    await act(async () => nine.click());
    expect(useUi.getState().metricHour).toBeNull();
  });

  it('la puce Heure est une puce de la sélection : le moteur garde les trades de l’heure et réduit chaque séance à sa part', () => {
    const nine = byEntryHour({ sessions: SESSIONS, trades: JOURNAL_TRADES }, 9);
    expect(nine.trades.map((t) => t.id)).toEqual(['a1', 'a2', 'a3', 'a5', 'a6']);
    expect(nine.sessions.map((s) => [s.date, s.pnl, s.tradeCount])).toEqual([
      ['2026-07-06', 50, 2],
      ['2026-07-07', 80, 1],
      ['2026-07-08', 40, 2],
    ]);
    const both = selectJournal(SESSIONS, JOURNAL_TRADES, { account: null, range: 'tout', instrument: 'NQ', hour: 10 }, '2026-07-09');
    expect(both.trades.map((t) => t.id)).toEqual(['a4']);
    // Sans puce Heure, la sélection d'avant : rien ne change.
    expect(selectJournal(SESSIONS, JOURNAL_TRADES, { account: null, range: 'tout', instrument: null }, '2026-07-09').trades).toHaveLength(8);
  });
});
