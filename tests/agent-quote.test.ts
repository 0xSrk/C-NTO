import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDeskTool } from '@/engine/agent/runner';
import { toolKind } from '@/engine/agent/tools';
import { findQuote, QUOTE_STALE_MS, QuoteBook, QUOTES_MAX } from '@/engine/marketdata/quotes';
import { fakePorts } from './helpers/deskPorts';

describe('dernière cotation du pont', () => {
  it('garde la dernière par instrument ; 0 = côté pas encore reçu ; charge invalide ignorée', () => {
    const book = new QuoteBook();
    // L'AddOn 2.2.0 envoie bid et ask à 0 tant que le côté n'a pas été reçu.
    expect(book.apply({ instrument: 'MNQ 12-26', time: 1, bid: 0, ask: 0, last: 21_000 }, 10)).toMatchObject({ bid: null, ask: null, last: 21_000 });
    book.apply({ instrument: 'MNQ 12-26', time: 2, bid: 21_000, ask: 21_000.25 }, 20);
    expect(book.all()).toEqual([{ instrument: 'MNQ 12-26', bid: 21_000, ask: 21_000.25, last: null, time: 2, receivedAt: 20 }]);
    expect(book.apply({ instrument: 'ES 12-26', time: 'hier', bid: 1, ask: 2 }, 30)).toBeNull();
    expect(book.apply({ instrument: '', time: 3, bid: 1, ask: 2 }, 30)).toBeNull();
    expect(book.apply(null, 30)).toBeNull();
    expect(book.all()).toHaveLength(1);
    for (let i = 0; i < QUOTES_MAX + 3; i++) book.apply({ instrument: `X${i}`, time: i, bid: 1, ask: 2 }, 100 + i);
    expect(book.all()).toHaveLength(QUOTES_MAX);
    expect(book.all().some((q) => q.instrument === 'MNQ 12-26')).toBe(false);
  });

  it('nom exact, sinon racine du registre (le contrat coté le plus récemment), sinon rien', () => {
    const book = new QuoteBook();
    book.apply({ instrument: 'MNQ 12-26', time: 1, bid: 21_000, ask: 21_000.25 }, 10);
    book.apply({ instrument: 'MNQ 03-27', time: 2, bid: 21_200, ask: 21_200.5 }, 20);
    book.apply({ instrument: 'NQ 12-26', time: 3, bid: 21_001, ask: 21_001.25 }, 30);
    const rows = book.all();
    expect(findQuote(rows, 'mnq  12-26')?.instrument).toBe('MNQ 12-26');
    expect(findQuote(rows, 'MNQ')?.instrument).toBe('MNQ 03-27');
    expect(findQuote(rows, 'NQ')?.instrument).toBe('NQ 12-26');
    expect(findQuote(rows, 'ES')).toBeNull();
    expect(findQuote(rows, 'ZZZ')).toBeNull();
    expect(findQuote(rows, '  ')).toBeNull();
  });
});

describe('market_quote', () => {
  afterEach(() => vi.useRealTimers());

  it('lecture seule ; rien reçu pour l’instrument : available false et la raison', async () => {
    expect(toolKind('market_quote')).toBe('read');
    const out = (await executeDeskTool(fakePorts(), 'market_quote', { instrument: 'MNQ 12-26' }, { source: 'llm' })) as Record<string, unknown>;
    expect(out).toMatchObject({ available: false, instrument: 'MNQ 12-26' });
    expect(out.reason).toMatch(/MNQ 12-26/);
    expect(out.reason).toMatch(/abonne/);
  });

  it('âge depuis la réception, stale au-delà du seuil explicite', async () => {
    vi.useFakeTimers();
    const t = Date.UTC(2026, 9, 6, 14, 30);
    vi.setSystemTime(t);
    const book = new QuoteBook();
    book.apply({ instrument: 'MNQ 12-26', time: t - 1_500, bid: 21_000, ask: 21_000.25, last: 21_000.25 }, t - 1_000);
    const ports = fakePorts({ marketQuotes: () => book.all() });
    const fresh = (await executeDeskTool(ports, 'market_quote', { instrument: 'MNQ' }, { source: 'orch' })) as Record<string, unknown>;
    expect(fresh).toEqual({
      available: true,
      instrument: 'MNQ 12-26',
      bid: 21_000,
      ask: 21_000.25,
      last: 21_000.25,
      time: new Date(t - 1_500).toISOString(),
      ageMs: 1_000,
      stale: false,
      staleAfterMs: QUOTE_STALE_MS,
    });
    vi.setSystemTime(t + QUOTE_STALE_MS);
    const old = (await executeDeskTool(ports, 'market_quote', { instrument: 'MNQ 12-26' }, { source: 'orch' })) as Record<string, unknown>;
    expect(old).toMatchObject({ ageMs: QUOTE_STALE_MS + 1_000, stale: true });
  });
});

describe('le renderer garde les cotations du pont', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('une cotation relayée par le process principal est rangée, sans abonnement du desk', async () => {
    let onMarket: ((event: unknown) => void) | null = null;
    const subscribe = vi.fn();
    vi.stubGlobal('window', {
      location: { search: '' },
      canto: {
        bridge: { status: async () => null, onFile: () => () => {}, onStatus: () => () => {} },
        ntbridge: { status: async () => null, onStatus: () => () => {}, onExecution: () => () => {} },
        marketdata: {
          subscribe,
          onEvent: (cb: (event: unknown) => void) => {
            onMarket = cb;
            return () => (onMarket = null);
          },
        },
      },
    });
    vi.resetModules();
    const { useBridge, bridgeQuotes } = await import('@/store/bridge');
    await useBridge.getState().load();
    expect(onMarket).not.toBeNull();
    const before = Date.now();
    onMarket!({ kind: 'quote', quote: { instrument: 'MNQ 12-26', time: 5, bid: 21_000, ask: 21_000.25, last: 21_000 } });
    onMarket!({ kind: 'tick', tick: { instrument: 'MNQ 12-26', time: 6, price: 21_000.5, size: 1 } });
    const rows = bridgeQuotes.all();
    expect(rows).toEqual([expect.objectContaining({ instrument: 'MNQ 12-26', bid: 21_000, ask: 21_000.25, last: 21_000, time: 5 })]);
    expect(rows[0]!.receivedAt).toBeGreaterThanOrEqual(before);
    expect(subscribe).not.toHaveBeenCalled();
  });
});
