/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupIntoSessions } from '@/engine/import/ninjatrader';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { Dashboard } from '@/modules/metrique/Dashboard';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Jours ouvrés depuis `from`, à midi UTC. */
function businessDays(from: string, count: number): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); out.length < count; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Compte A, plan Apex 50K suivi (drawdown 2 500, intraday trailing) : dix séances à +100, vingt à −100. Plus-haut
 * 51 000, plancher 48 500, dernier solde 49 000 : 2 000 des 2 500 consommés, 80 % de la borne.
 */
const DAYS = businessDays('2026-07-01', 30);
const pnlOf = (i: number) => (i < 10 ? 100 : -100);
const TRADES: Trade[] = DAYS.map((date, i) => {
  const pnl = pnlOf(i);
  const entryTime = Date.parse(`${date}T10:00:00-04:00`);
  return { id: `t${i}`, sessionId: '', instrument: 'NQ', account: 'A', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 3_600_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0, mae: Math.max(0, -pnl) };
});
const SESSIONS: Session[] = groupIntoSessions(TRADES, 18, 'csv');

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
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount: 'A', startingBalance: 50_000 } });
  useUi.setState({ metricAccount: 'A' });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

async function dashboard(sessions: Session[] = SESSIONS, trades: Trade[] = TRADES): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(Dashboard, {
        sessions,
        trades,
        range: 'tout',
        period: { from: null, to: DAYS.at(-1)! },
        history: { sessions, trades },
        journalEmpty: false,
        onImport: () => undefined,
        onDemo: () => undefined,
        onSessions: () => undefined,
      }),
    );
  });
  return host;
}

describe('OROS3.2b le tableau de bord lie la carte A.02 à l’état réel', () => {
  it('OROS4.10 la carte A.02 n’a plus de plaque : les statistiques du journal filtré sont dites une fois, par leurs cartes', async () => {
    const node = await dashboard();
    expect(node.querySelector('svg.mg-equity')).toBeNull();
    // 30 trades, 10 gagnants (33,3 %), profit factor 1 000 / 2 000 : dits par les cartes K du tableau de bord. Le total
    // n'est dit qu'une fois, en tête de la bande (OROS5.34) : K.02 dit ses gagnants.
    const text = node.textContent ?? '';
    expect(textOf(tile(node, 'K.02'))).toContain('10 gagnants');
    expect(text).not.toContain('10 / 30');
    expect(text).toMatch(/33,3\s?%/);
    expect(text).toContain('0,50');
  });

  it('le plan suivi pour le compte filtré pose sa borne sur la courbe ; « tous les comptes », aucune', async () => {
    const node = await dashboard();
    expect(node.textContent).toContain('Plancher · borne');
    act(() => root?.unmount());
    host?.remove();
    useUi.setState({ metricAccount: null });
    const all = await dashboard();
    expect(all.textContent).not.toContain('Plancher · borne');
  });
});

/** Texte lisible d'un élément : sans les styles embarqués des composants de la planche. */
const textOf = (el: Element) => {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('svg').forEach((svg) => svg.remove());
  return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
};

/** La tuile K.n du tableau de bord. */
function tile(node: HTMLElement, code: string): HTMLElement {
  const label = [...node.querySelectorAll('span')].find((el) => el.textContent?.trim() === code);
  const found = label?.closest('[data-k]');
  if (!found) throw new Error(`tuile introuvable : ${code}`);
  return found as HTMLElement;
}

/** Même compte, une séance de plus en perte : la dernière descend sous le plancher. */
function crossing(): { sessions: Session[]; trades: Trade[] } {
  const days = businessDays('2026-07-01', 38);
  const trades: Trade[] = days.map((date, i) => {
    const pnl = i < 10 ? 100 : -100;
    const entryTime = Date.parse(`${date}T10:00:00-04:00`);
    return { id: `x${i}`, sessionId: '', instrument: 'NQ', account: 'A', direction: 'long', qty: 1, entryTime, exitTime: entryTime + 3_600_000, entryPrice: 20_000, exitPrice: 20_000 + pnl / 20, pnl, commission: 0, mae: Math.max(0, -pnl) };
  });
  return { sessions: groupIntoSessions(trades, 18, 'csv'), trades };
}

describe('OROS3.2c jauges K graduées, borne du plan sur K.04 et son signal', () => {
  it('chaque jauge K porte la règle graduée de la planche : appui tous les 25 %, trait tous les 5 %', async () => {
    const node = await dashboard();
    for (const code of ['K.02', 'K.03', 'K.04']) expect(tile(node, code).querySelectorAll('[data-ruler]'), code).toHaveLength(1);
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/modules/metrique/dashboard.module.css', 'utf8');
    const rule = /\.ruler\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/25%/);
    expect(rule).toMatch(/5%/);
  });

  it('K.04 : la borne est le drawdown maximal du plan suivi ; à 84 % consommés, signal d’attention', async () => {
    const days = TRADES.slice();
    // Dernière séance : un plus-bas de −200 dans la journée (MAE), clôture à −100 : 2 100 des 2 500 consommés.
    days[days.length - 1] = { ...days[days.length - 1]!, mae: 200 };
    const node = await dashboard(groupIntoSessions(days, 18, 'csv'), days);
    const k4 = tile(node, 'K.04');
    expect(k4.textContent).toContain('PLANCHER −2');
    const signal = k4.querySelector('[data-level]');
    expect(signal?.getAttribute('data-level')).toBe('2');
    expect(signal?.textContent).toMatch(/84\s%\s?de la borne consommée/u);
    expect(signal?.classList.contains('sig-l3')).toBe(false);
  });

  it('K.04 : borne franchie, signal critique (niveau 3) ; le texte reste à l’encre, seul le glyphe est rouge', async () => {
    const { sessions, trades } = crossing();
    const node = await dashboard(sessions, trades);
    const signal = tile(node, 'K.04').querySelector('[data-level]');
    expect(signal?.getAttribute('data-level')).toBe('3');
    expect(signal?.classList.contains('sig-l3')).toBe(true);
    expect(signal?.textContent).toMatch(/Borne franchie/);
  });

  it('K.04 sans plan suivi (tous les comptes) : ni borne ni signal', async () => {
    useUi.setState({ metricAccount: null });
    const node = await dashboard();
    const k4 = tile(node, 'K.04');
    expect(k4.querySelector('[data-level]')).toBeNull();
    expect(k4.textContent).not.toContain('PLANCHER −');
  });
});

/** La carte A.04 : la section que son code ouvre. */
function a04(node: HTMLElement): HTMLElement {
  const code = [...node.querySelectorAll('span')].find((el) => el.textContent?.trim() === 'A.04');
  const found = code?.closest('section');
  if (!found) throw new Error('carte A.04 introuvable');
  return found as HTMLElement;
}

describe('OROS3.2d la carte A.04 renvoie aux séances par la flèche de la planche', () => {
  it('« Les N séances » compte le journal filtré et porte la flèche « suivant »', async () => {
    const { GLYPH_ID } = await import('@/design/micro/assets');
    const node = await dashboard();
    // Son propre bouton, dans sa carte : l'échantillon de K.04, qui dit aussi des séances, n'est pas lui (OROS5.34).
    const button = [...a04(node).querySelectorAll('button')].find((el) => /séances/i.test(textOf(el)))!;
    expect(textOf(button)).toBe('Les 30 séances');
    const svg = button.querySelector('svg[class*="skg-"]');
    expect(svg?.classList.contains(`skg-${GLYPH_ID.arrowNext}`)).toBe(true);
  });
});

/** Le bouton d'échantillon : celui de la bande (`band`) ou celui de K.04 (`k04`). */
const sampleButton = (node: HTMLElement, which: 'band' | 'k04') => node.querySelector<HTMLButtonElement>(`button[data-sample="${which}"]`);

describe('OROS5.34 l’échantillon se dit une fois, en tête de la bande K', () => {
  it('« n = 30 trades · échantillon moyen » en tête de la bande, une seule fois, et un clic ouvre l’ensemble', async () => {
    let opened = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        createElement(Dashboard, {
          sessions: SESSIONS,
          trades: TRADES,
          range: 'tout',
          period: { from: null, to: DAYS.at(-1)! },
          history: { sessions: SESSIONS, trades: TRADES },
          journalEmpty: false,
          onImport: () => undefined,
          onDemo: () => undefined,
          onSessions: () => opened++,
        }),
      );
    });
    const node = host;
    const band = sampleButton(node, 'band')!;
    expect(band).not.toBeNull();
    // En tête de la bande : son premier enfant, avant les quatre cartes.
    expect(band.closest('section')?.firstElementChild?.contains(band)).toBe(true);
    expect(textOf(band)).toBe('n = 30 trades · échantillon moyen');
    // Les seuils du moteur (SAMPLE_FAIBLE / MOYEN / SOLIDE) : 30 trades, c'est moyen.
    expect(band.getAttribute('data-level')).toBe('moyen');
    // Dit une fois : aucune carte ne redit le n de la bande.
    expect((node.textContent ?? '').match(/n = 30 trades/g)).toHaveLength(1);
    for (const code of ['K.01', 'K.02', 'K.03', 'K.04']) expect(textOf(tile(node, code)), code).not.toMatch(/\b30 trades\b|\/ 30\b/);
    await act(async () => band.click());
    expect(opened).toBe(1);
  });

  it('les seuils suivent le moteur : sous SAMPLE_FAIBLE, insuffisant ; de 10 à 29, faible', async () => {
    const few = TRADES.slice(0, 9);
    const node = await dashboard(groupIntoSessions(few, 18, 'csv'), few);
    expect(textOf(sampleButton(node, 'band')!)).toBe('n = 9 trades · échantillon insuffisant');
    act(() => root?.unmount());
    host?.remove();
    const some = TRADES.slice(0, 12);
    const other = await dashboard(groupIntoSessions(some, 18, 'csv'), some);
    expect(textOf(sampleButton(other, 'band')!)).toBe('n = 12 trades · échantillon faible');
  });

  it('K.04 ne dit son n qu’avec un plan : tout l’historique du compte, son propre bouton et un nom accessible distinct', async () => {
    const { useObjects } = await import('@/store/objects');
    useObjects.setState(useObjects.getInitialState(), true);
    const node = await dashboard();
    const k04 = sampleButton(node, 'k04')!;
    expect(k04).not.toBeNull();
    expect(tile(node, 'K.04').contains(k04)).toBe(true);
    expect(textOf(k04)).toBe('n = 30 séances · tout l’historique');
    // Trois boutons, trois noms : l'échantillon de la bande, celui de K.04, et « Les N séances » de A.04.
    const band = sampleButton(node, 'band')!.getAttribute('aria-label') ?? '';
    const mine = k04.getAttribute('aria-label') ?? '';
    const more = [...a04(node).querySelectorAll('button')].find((el) => /séances/i.test(textOf(el)))!;
    const moreName = more.getAttribute('aria-label') ?? textOf(more);
    expect(mine).toMatch(/K\.04/);
    expect(mine).toMatch(/30 séances/);
    expect(band).toMatch(/bande K/);
    expect(new Set([band, mine, moreName]).size).toBe(3);
    // Il ouvre le compte que le plan suit, d'où la marge se lit sur tout l'historique : une fiche, aucune écriture.
    await act(async () => k04.click());
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: 'A' });
    useObjects.setState(useObjects.getInitialState(), true);
  });

  it('K.04 sans plan : ni n ni bouton, « creux sur N séances »', async () => {
    useUi.setState({ metricAccount: null });
    const node = await dashboard();
    expect(sampleButton(node, 'k04')).toBeNull();
    // Le creux le plus long : vingt séances à −100 après dix à +100.
    expect(textOf(tile(node, 'K.04'))).toMatch(/creux sur 20 séances/);
  });

  it('le plan de K.04 se desserre, et les titres K tiennent sur une ligne (le complément passe dessous)', async () => {
    const { readFileSync } = await import('node:fs');
    const { cssRules } = await import('./helpers/cssRules');
    const rules = cssRules(readFileSync('src/modules/metrique/dashboard.module.css', 'utf8').replace(/\r\n/g, '\n'));
    const body = (selector: string) => rules.filter((rule) => rule.selector === selector && rule.at.length === 0).map((rule) => rule.body).join(';');
    expect(body('.kTitle')).toMatch(/white-space:\s*nowrap/);
    expect(body('.kHead')).toMatch(/flex-wrap:\s*wrap/);
    // Le plan suivi : une ligne par lecture (plancher et plus-haut, puis le plus-bas), plus deux colonnes serrées.
    expect(body('.planLines')).toMatch(/flex-direction:\s*column/);
    const node = await dashboard();
    const k4 = tile(node, 'K.04');
    expect(k4.querySelector('[data-plan-lines]')?.children.length).toBe(2);
    for (const code of ['K.01', 'K.02', 'K.03', 'K.04']) expect(tile(node, code).querySelector('[class*="kTitle"]'), code).not.toBeNull();
  });
});
