/**
 * @vitest-environment jsdom
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupIntoSessions } from '@/engine/import/ninjatrader';
import type { Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { Lecteur, Montant } from '@/design/primitives';
import primitives from '@/design/primitives.module.css';
import { decimalMark, fmtPoints, montantAria, montantParts } from '@/lib/format';
import Bot from '@/modules/bot/Bot';
import s from '@/modules/bot/bot.module.css';
import { Dashboard } from '@/modules/metrique/Dashboard';
import Metrique from '@/modules/metrique/Metrique';
import Portefeuille from '@/modules/portefeuille/Portefeuille';
import { useBots } from '@/store/bots';
import { useJournal } from '@/store/journal';
import { usePortfolio } from '@/store/portfolio';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Lundi 26 octobre 2026, midi UTC. */
const NOW = Date.parse('2026-10-26T12:00:00Z');

/** Dix séances à +100, vingt à −100 : profit factor 1 000 / 2 000 = 0,50, réussite 33,3 %. */
const TRADES: Trade[] = Array.from({ length: 30 }, (_, i) => {
  const date = new Date(Date.parse('2026-07-01T12:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
  const pnl = i < 10 ? 100 : -100;
  const entryTime = Date.parse(`${date}T10:00:00-04:00`);
  return { id: `t${i}`, sessionId: '', instrument: 'NQ', account: 'A', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 3_600_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0 };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useI18n.setState({ locale: 'fr' });
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  act(() => root?.unmount());
  host?.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
  return host;
}

/** Libellés des boutons du sélecteur de période (`Segmented`). */
const pressable = (node: HTMLElement) => [...node.querySelectorAll('button[aria-pressed]')].map((el) => el.textContent?.trim() ?? '');

/** La tuile dont le code (« K.03 ») ouvre l'en-tête. */
function tile(node: HTMLElement, code: string): HTMLElement {
  const label = [...node.querySelectorAll('span')].find((el) => el.textContent?.trim() === code);
  const found = label?.parentElement?.parentElement?.parentElement;
  if (!found) throw new Error(`tuile introuvable : ${code}`);
  return found;
}

/** Tous les fichiers sources de l'interface. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? sources(file) : /\.tsx?$/.test(name) ? [file] : [];
  });
}

describe('R3.7h l’interface anglaise parle anglais : libellés de période, jours, décimales, montants', () => {
  it('les points suivent la langue : point décimal en anglais, virgule en français et en espagnol', () => {
    useI18n.setState({ locale: 'en' });
    expect(fmtPoints(3.5)).toBe('+3.50 pts');
    expect(fmtPoints(-0.25)).toBe('-0.25 pts');
    useI18n.setState({ locale: 'fr' });
    expect(fmtPoints(3.5)).toBe('+3,50 pts');
    useI18n.setState({ locale: 'es' });
    expect(fmtPoints(3.5)).toBe('+3,50 pts');
  });

  it('aucune virgule décimale en dur dans les modules', () => {
    const hard = sources('src').filter((file) => /replace\(\s*'\.'\s*,\s*','\s*\)/.test(readFileSync(file, 'utf8')));
    expect(hard).toEqual([]);
  });

  it('Métrique : 7D · 30D · 90D, et le profit factor de K.03 et de la plaque A.02 au point décimal', async () => {
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
    useUi.setState({ metricAccount: null });
    useJournal.setState({ sessions: [], trades: [] });
    useI18n.setState({ locale: 'en' });
    expect(pressable(await render(createElement(Metrique)))).toEqual(['7D', '30D', '90D', 'ALL']);
    useI18n.setState({ locale: 'fr' });
    expect(pressable(await render(createElement(Metrique)))).toEqual(['7J', '30J', '90J', 'TOUT']);

    useI18n.setState({ locale: 'en' });
    const sessions = groupIntoSessions(TRADES, 18, 'csv');
    const node = await render(
      createElement(Dashboard, {
        sessions,
        trades: TRADES,
        range: 'tout',
        period: { from: null, to: '2026-07-30' },
        history: { sessions, trades: TRADES },
        journalEmpty: false,
        onImport: () => undefined,
        onDemo: () => undefined,
        onSessions: () => undefined,
      }),
    );
    const k3 = tile(node, 'K.03').textContent ?? '';
    expect(k3).toContain('0.50');
    expect(k3).toContain('BEFORE FEES 0.50');
    expect(k3).not.toContain('0,50');
    expect(node.querySelector('svg.mg-equity')?.textContent ?? '').toContain('– 30 – 30 – 33.3 – 0.50');
  }, 15_000);

  it('Portefeuille : 7D · 30D, « 0 / 0 D » en K.01, levier au point décimal en K.02', async () => {
    usePortfolio.setState({ ready: true, pockets: [], positions: [], cash: [], fx: [], load: async () => undefined, replaceEquity: async () => undefined });
    useI18n.setState({ locale: 'en' });
    const node = await render(createElement(Portefeuille));
    expect(pressable(node).slice(0, 2)).toEqual(['7D', '30D']);
    // « 0 / 0 D », puis le montant de `Montant`.
    expect(tile(node, 'K.01').textContent).toMatch(/0 \/ 0 D/);
    expect(tile(node, 'K.01').textContent).not.toMatch(/\d J/);
    expect(tile(node, 'K.02').textContent).toContain('0.00×');
  });

  it('Bot : les montants des garde-fous au format de la langue (« $750 », « −$1,000 »)', async () => {
    useBots.setState({ ready: true, bots: [], activeId: null, load: async () => undefined });
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
    const guards = (node: HTMLElement) => [...node.querySelectorAll(`.${s.guard}`)].map((el) => el.textContent ?? '').join('\n');
    useI18n.setState({ locale: 'en' });
    const en = guards(await render(createElement(Bot)));
    expect(en).toContain('of max DD ($750)');
    expect(en).toContain('Internal daily loss: −$1,000 (');
    expect(en).not.toMatch(/\d \$/);
    useI18n.setState({ locale: 'fr' });
    const fr = guards(await render(createElement(Bot)));
    expect(fr).toMatch(/du DD max \(750\s\$\)/u);
    expect(fr).toMatch(/Perte journalière interne : −1\s000\s\$ \(/u);
  });
});

describe('R3.7k les montants prennent le séparateur décimal de la langue : point en anglais, virgule en français et en espagnol', () => {
  it('`decimalMark` et `montantAria` suivent la langue ; le groupement reste U+202F', () => {
    const parts = montantParts(4812.5, 2);
    for (const [locale, mark] of [['fr', ','], ['en', '.'], ['es', ',']] as const) {
      useI18n.setState({ locale });
      expect(decimalMark(), locale).toBe(mark);
      expect(montantAria(parts), locale).toBe(`+4 812${mark}50`);
    }
  });

  it('`Montant` et `Lecteur` écrivent le séparateur de la langue, et le reprennent quand elle change', async () => {
    useI18n.setState({ locale: 'en' });
    const amount = await render(createElement('div', null, createElement(Montant, { value: -2897.62 }), createElement(Lecteur, { value: 93508.84, sign: false })));
    const montant = amount.querySelector(`.${primitives.montant}`)!;
    const ink = amount.querySelector(`.${primitives.lecteurInk}`)!;
    expect(montant.textContent).toBe('−2897.62');
    expect(montant.getAttribute('aria-label')).toBe('−2 897.62');
    expect(ink.textContent).toBe('93508.84');
    expect(amount.querySelector(`.${primitives.lecteurGhost}`)?.textContent).toBe('88888.88');
    await act(async () => useI18n.setState({ locale: 'fr' }));
    expect(montant.textContent).toBe('−2897,62');
    expect(ink.textContent).toBe('93508,84');
  });

  it('la plaque A.02 de Métrique écrit ses montants au point en anglais', async () => {
    useI18n.setState({ locale: 'en' });
    const sessions = groupIntoSessions(TRADES, 18, 'csv');
    const node = await render(
      createElement(Dashboard, {
        sessions,
        trades: TRADES,
        range: 'tout',
        period: { from: null, to: '2026-07-30' },
        history: { sessions, trades: TRADES },
        journalEmpty: false,
        onImport: () => undefined,
        onDemo: () => undefined,
        onSessions: () => undefined,
      }),
    );
    expect(node.querySelector('svg.mg-equity')?.textContent ?? '').toContain('CUMUL −1 000.00 // DD −2 000.00');
  }, 15_000);
});
