/**
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Jauge } from '@/design/primitives';
import s from '@/design/primitives.module.css';
import { groupIntoSessions } from '@/engine/import/ninjatrader';
import type { Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { Dashboard } from '@/modules/metrique/Dashboard';
import { knownLeverage } from '@/modules/portefeuille/Synthese';
import { useCopier } from '@/store/copier';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * OROS5.5 — zéro n'est pas l'absence (brief du Système 5, § 4). `Jauge` accepte `value: null` : ni remplissage ni
 * curseur, « — » à la place de la valeur, et un nom accessible qui le dit. Le levier du Portefeuille, le Copieur et K.04
 * sans plan écrivent « — » là où rien n'est connu.
 */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(element: ReactElement): Promise<HTMLDivElement> {
  act(() => root?.unmount());
  host?.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
  return host;
}

beforeEach(() => {
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
  vi.unstubAllGlobals();
  useI18n.setState({ locale: 'fr' });
});

const TICKS = [
  { value: 0, label: '0×' },
  { value: 4, label: '4×' },
  { value: 5, label: '5×' },
];

/** La tuile dont le code (« K.04 ») ouvre l'en-tête. */
function tile(node: HTMLElement, code: string): HTMLElement {
  const label = [...node.querySelectorAll('span')].find((el) => el.textContent?.trim() === code);
  const found = label?.closest('[data-k]');
  if (!found) throw new Error(`tuile introuvable : ${code}`);
  return found as HTMLElement;
}

describe('OROS5.5 la jauge dit l’absence', () => {
  it('value null : ni remplissage ni curseur, « — », et un nom accessible qui le dit, en trois langues', async () => {
    const said: (string | null)[] = [];
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      const node = await render(createElement(Jauge, { min: 0, max: 5, value: null, marker: 4, hatchFrom: 4, ticks: TICKS }));
      const gauge = node.firstElementChild as HTMLElement;
      expect(gauge.querySelector(`.${s.jaugeCursor}`), locale).toBeNull();
      expect(gauge.querySelector(`.${s.jaugeFill}`), locale).toBeNull();
      expect(gauge.querySelector(`.${s.jaugeNone}`)?.textContent, locale).toBe('—');
      expect(gauge.getAttribute('role'), locale).toBe('img');
      // L'échelle et la borne appartiennent à l'instrument, pas à la valeur : elles restent.
      expect(gauge.querySelector(`.${s.jaugeMark}`), locale).not.toBeNull();
      expect(gauge.querySelector(`.${s.jaugeHatch}`), locale).not.toBeNull();
      said.push(gauge.getAttribute('aria-label'));
    }
    expect(said).toEqual(['Aucune valeur connue', 'No known value', 'Ningún valor conocido']);
  });

  it('value 0 : le curseur se pose à 0 et le remplissage est vide ; zéro est une valeur, rien ne dit « — »', async () => {
    const node = await render(createElement(Jauge, { min: 0, max: 5, value: 0, ticks: TICKS }));
    expect(node.querySelector<HTMLElement>(`.${s.jaugeCursor}`)?.style.left).toBe('0%');
    expect(node.querySelector<HTMLElement>(`.${s.jaugeFill}`)?.style.width).toBe('0%');
    expect(node.querySelector(`.${s.jaugeNone}`)).toBeNull();
    expect(node.firstElementChild?.getAttribute('role')).toBeNull();
    expect(node.firstElementChild?.getAttribute('aria-label')).toBeNull();
  });

  it('le levier du Portefeuille : inconnu sans valeur nette ou quand aucune ligne n’est valorisée, nul avec des liquidités seules', () => {
    const offline = { pocketId: 'p1', text: 'pont hors ligne' };
    // Aucune poche : pas de valeur nette, pas de levier (le moteur rend null).
    expect(knownLeverage({ grossLeverage: null, byInstrument: [], notes: [] })).toBeNull();
    // Une poche prop dont le pont est hors ligne : rien n'est valorisé, le zéro serait faux.
    expect(knownLeverage({ grossLeverage: 0, byInstrument: [], notes: [offline] })).toBeNull();
    // Des liquidités seules : un vrai zéro.
    expect(knownLeverage({ grossLeverage: 0, byInstrument: [], notes: [] })).toBe(0);
    expect(knownLeverage({ grossLeverage: 1.25, byInstrument: [{ key: 'NQ', notional: 62_500 }], notes: [offline] })).toBe(1.25);
  });

  it('K.04 sans plan suivi : la jauge dit l’absence, le drawdown sur clôtures reste écrit', async () => {
    useI18n.setState({ locale: 'fr' });
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount: 'A', startingBalance: 50_000 } });
    useUi.setState({ metricAccount: null });
    const trades: Trade[] = Array.from({ length: 12 }, (_, i) => {
      const date = new Date(Date.parse('2026-07-01T12:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
      const pnl = i < 4 ? 100 : -100;
      const entryTime = Date.parse(`${date}T10:00:00-04:00`);
      return { id: `t${i}`, sessionId: '', instrument: 'NQ', account: 'A', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 3_600_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0 };
    });
    const sessions = groupIntoSessions(trades, 18, 'csv');
    const props = { sessions, trades, range: 'tout' as const, period: { from: null, to: '2026-07-12' }, history: { sessions, trades }, journalEmpty: false, onImport: () => undefined, onDemo: () => undefined, onSessions: () => undefined };
    const node = await render(createElement(Dashboard, props));
    const k4 = tile(node, 'K.04');
    expect(k4.querySelector(`.${s.jaugeCursor}`)).toBeNull();
    expect(k4.querySelector(`.${s.jaugeFill}`)).toBeNull();
    expect(k4.querySelector(`.${s.jaugeNone}`)?.textContent).toBe('—');
    expect(k4.textContent).toMatch(/Drawdown max/);
    expect(k4.textContent).toMatch(/−800/);
    // Les autres jauges K ont une valeur : leur curseur reste.
    expect(tile(node, 'K.02').querySelector(`.${s.jaugeCursor}`)).not.toBeNull();
    // Le plan suivi pour le compte filtré rend sa borne et sa valeur à K.04.
    useUi.setState({ metricAccount: 'A' });
    const tracked = await render(createElement(Dashboard, props));
    expect(tile(tracked, 'K.04').querySelector(`.${s.jaugeCursor}`)).not.toBeNull();
    expect(tile(tracked, 'K.04').querySelector(`.${s.jaugeNone}`)).toBeNull();
  });

  it('le Copieur écrit « — » où rien n’est connu : fills routés sans process principal, maîtres et suiveurs avant le chargement', async () => {
    useI18n.setState({ locale: 'fr' });
    const { default: Copieur } = await import('@/modules/copieur/Copieur');
    const stat = (node: HTMLElement, label: string) => {
      const found = [...node.querySelectorAll('span')].find((el) => el.textContent === label)?.parentElement;
      if (!found) throw new Error(`relevé introuvable : ${label}`);
      return found;
    };
    const value = (el: HTMLElement) => el.children[1]?.textContent;
    useCopier.setState({ ready: false, accounts: [], load: async () => undefined });
    const loading = await render(createElement(Copieur));
    expect(value(stat(loading, 'Maîtres · suiveurs'))).toBe('—');
    expect(value(stat(loading, 'Fills routés'))).toBe('—');
    // Chargé, sans compte : zéro est une valeur. Le process principal manque toujours : les fills restent inconnus.
    useCopier.setState({ ready: true, accounts: [] });
    const loaded = await render(createElement(Copieur));
    expect(value(stat(loaded, 'Maîtres · suiveurs'))).toBe('0 · 0');
    expect(value(stat(loaded, 'Fills routés'))).toBe('—');
  });
});
