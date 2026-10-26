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
  it('la plaque A.02 lit le journal filtré et les statistiques du tableau de bord', async () => {
    const node = await dashboard();
    const text = node.querySelector('svg.mg-equity')?.textContent ?? '';
    expect(text).toContain('A.02 — EQUITY — CSV');
    expect(text).toContain('CUMUL −1 000,00 // DD −2 000,00');
    // 30 séances, 30 trades, 10 gagnants (33,3 %), profit factor 1 000 / 2 000.
    expect(text).toContain('– 30 – 30 – 33,3 – 0,50');
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
