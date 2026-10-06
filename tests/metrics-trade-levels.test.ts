/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readTradeLevel } from '@/engine/riskConsole';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { Sessions } from '@/modules/metrique/Sessions';
import { useJournal } from '@/store/journal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const long = { direction: 'long' as const, entryPrice: 20_000 };
const short = { direction: 'short' as const, entryPrice: 20_000 };

describe('lecture du stop et de l’objectif saisis', () => {
  it('accepte la virgule, le point et les espaces de groupe ; vide efface', () => {
    expect(readTradeLevel('19990,5', 'stopPrice', long)).toEqual({ ok: true, value: 19_990.5 });
    expect(readTradeLevel('19 990,25', 'stopPrice', long)).toEqual({ ok: true, value: 19_990.25 });
    expect(readTradeLevel(' 20010.75 ', 'targetPrice', long)).toEqual({ ok: true, value: 20_010.75 });
    expect(readTradeLevel('  ', 'stopPrice', long)).toEqual({ ok: true, value: null });
  });

  it('refuse un prix illisible ou hors de ]0 ; 1e6]', () => {
    for (const raw of ['abc', '1e5', '19,990.5', '12-5', 'Infinity']) expect(readTradeLevel(raw, 'stopPrice', long), raw).toEqual({ ok: false, issue: 'format' });
    for (const raw of ['-5', '0', '0,0', '1000000,5']) expect(readTradeLevel(raw, 'targetPrice', short), raw).toEqual({ ok: false, issue: 'range' });
    expect(readTradeLevel('1000000', 'stopPrice', short)).toEqual({ ok: true, value: 1_000_000 });
  });

  it('refuse le mauvais côté : achat, stop < entrée < objectif ; vente, l’inverse', () => {
    expect(readTradeLevel('20010', 'stopPrice', long)).toEqual({ ok: false, issue: 'side' });
    expect(readTradeLevel('20000', 'stopPrice', long)).toEqual({ ok: false, issue: 'side' });
    expect(readTradeLevel('19990', 'targetPrice', long)).toEqual({ ok: false, issue: 'side' });
    expect(readTradeLevel('19990', 'stopPrice', short)).toEqual({ ok: false, issue: 'side' });
    expect(readTradeLevel('20010', 'targetPrice', short)).toEqual({ ok: false, issue: 'side' });
    expect(readTradeLevel('20010', 'stopPrice', short)).toEqual({ ok: true, value: 20_010 });
    expect(readTradeLevel('19990', 'targetPrice', short)).toEqual({ ok: true, value: 19_990 });
  });
});

const session: Session = { id: 's1', date: '2026-09-01', account: 'Sim101', instruments: ['NQ'], source: 'csv', tradeCount: 1, pnl: 200, grossProfit: 200, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
const trade: Trade = {
  id: 't1',
  sessionId: 's1',
  instrument: 'NQ',
  account: 'Sim101',
  direction: 'long',
  qty: 1,
  entryTime: Date.parse('2026-09-01T14:00:00Z'),
  exitTime: Date.parse('2026-09-01T14:05:00Z'),
  entryPrice: 20_000,
  exitPrice: 20_010,
  pnl: 200,
  commission: 0,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Séances › saisie du stop et de l’objectif', () => {
  async function mount() {
    const updateTrade = vi.fn(async () => undefined);
    useI18n.setState({ locale: 'fr' });
    useJournal.setState({ sessions: [session], trades: [trade], updateTrade });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(Sessions)));
    await act(async () => (host!.querySelector('tbody tr.clickable') as HTMLElement).click());
    const field = (label: string) => host!.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    const type = async (label: string, value: string) => {
      const input = field(label);
      input.value = value;
      await act(async () => void input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    };
    const alerts = () => [...host!.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? '');
    return { updateTrade, type, alerts, field };
  }

  it('enregistre un stop à la virgule française', async () => {
    const { updateTrade, type, alerts } = await mount();
    await type('Stop initial', '19 990,5');
    expect(updateTrade).toHaveBeenCalledWith('t1', { stopPrice: 19_990.5 });
    expect(alerts()).toEqual([]);
  });

  it('refuse visiblement un stop au-dessus de l’entrée d’un achat, puis un prix négatif', async () => {
    const { updateTrade, type, alerts, field } = await mount();
    await type('Stop initial', '20010');
    expect(updateTrade).not.toHaveBeenCalled();
    expect(alerts()).toEqual(['Stop refusé : sur un achat, il se place sous l’entrée (20\u202f000,00).']);
    expect(field('Stop initial').getAttribute('aria-invalid')).toBe('true');
    await type('Objectif initial', '-5');
    expect(updateTrade).not.toHaveBeenCalled();
    expect(alerts()).toContain('Objectif refusé : prix hors de ]0 ; 1 000 000].');
    await type('Stop initial', '19990');
    expect(updateTrade).toHaveBeenCalledWith('t1', { stopPrice: 19_990 });
    expect(alerts()).toEqual(['Objectif refusé : prix hors de ]0 ; 1 000 000].']);
  });

  it('dit le refus dans la langue du desk', async () => {
    const { type, alerts } = await mount();
    await act(async () => useI18n.setState({ locale: 'en' }));
    await type('Initial target', '19990');
    expect(alerts()).toEqual(['Target refused: on a long, it sits above the entry (20,000.00).']);
    await act(async () => useI18n.setState({ locale: 'es' }));
    expect(alerts()).toEqual(['Objetivo rechazado: en una compra, va por encima de la entrada (20.000,00).']);
  });
});
