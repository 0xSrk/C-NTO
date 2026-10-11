import { describe, expect, it, vi } from 'vitest';

// Dexie est remplacé par une coquille, comme dans `vault-restore.test.ts` : `@/store/db` s’importe sans IndexedDB.
vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = {
        stores() {
          return chain;
        },
        upgrade() {
          return chain;
        },
      };
      return chain;
    }
    on() {}
    close() {}
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

import { prepareVaultRestore } from '@/store/db';

/** Le 9 octobre 2026, midi UTC, en millisecondes : l’unité de `createdAt`. */
const NOW = Date.parse('2026-10-09T12:00:00Z');

/** Un coffre v1 : `settings` est la liste des lignes `{ key, value }` de la table, comme l’exportait le navigateur. */
const vaultV1 = (settings: { key: string; value: unknown }[]): string => JSON.stringify({ artefact: 'CΛNTO', sessions: [], settings });

const ema = { id: 'i1', definitionId: 'ema', params: { period: 20, source: 'close' }, visible: true };
/** Les lignes valides de chaque clé ; `over` écrase les champs. */
const chart = (over: Record<string, unknown> = {}) => ({ market: 'coinbase:ONDO-USD', timeframe: 15, indicators: [ema], ...over });
const alert = (over: Record<string, unknown> = {}) => ({ id: 'a1', target: 'coinbase:BTC-USD', kind: 'price_above', level: 82_528, mode: 'once', author: 'trader', state: 'armed', createdAt: NOW, ...over });
const level = (over: Record<string, unknown> = {}) => ({ id: 'd1', market: 'coinbase:BTC-USD', kind: 'level', price: 82_528, author: 'trader', createdAt: NOW, ...over });
const zone = (over: Record<string, unknown> = {}) => ({ id: 'z1', market: 'binance:ONEUSDT', kind: 'zone', from: 0.002163, to: 0.0023, label: 'offre', author: 'agent', createdAt: NOW, ...over });

describe('lignes crypto d’un coffre v1', () => {
  it('garde les valeurs assainies des lignes valides et compte la ligne écartée', () => {
    const v = prepareVaultRestore(
      vaultV1([
        { key: 'crypto.chart', value: chart() },
        { key: 'crypto.watchlist', value: ['coinbase:BTC-USD', 'binance:ONEUSDT'] },
        { key: 'crypto.alerts', value: { a1: alert() } },
        { key: 'crypto.drawings', value: [level(), zone()] },
      ]),
    );
    expect(v.otherSettings).toEqual([
      { key: 'crypto.chart', value: chart() },
      { key: 'crypto.watchlist', value: ['coinbase:BTC-USD', 'binance:ONEUSDT'] },
      { key: 'crypto.drawings', value: [level(), zone()] },
    ]);
    expect(v.skipped.settings).toBe(1);
  });

  it('une ligne que l’assainisseur nettoie en partie garde sa valeur nettoyée, sans compter d’écart', () => {
    const v = prepareVaultRestore(
      vaultV1([
        // Un indicateur sans definitionId et un autre hors du catalogue crypto.
        { key: 'crypto.chart', value: chart({ indicators: [ema, { id: 'bad' }, { id: 'rsi1', definitionId: 'rsi', params: {}, visible: true }] }) },
        // Une source du CVD, un exchange hors registre, un marché répété.
        { key: 'crypto.watchlist', value: ['coinbase:BTC-USD', 'binance:BTCUSDT', 'kraken:BTC-USD', 'coinbase:BTC-USD', 'binance:ONEUSDT'] },
        // Un niveau négatif, un genre de température sur un marché, un id déjà vu.
        { key: 'crypto.alerts', value: [alert(), alert({ id: 'neg', level: -1 }), alert({ id: 'b', kind: 'breadth_above' }), alert({ level: 1 })] },
        // Une zone inversée, un label de 41 caractères.
        { key: 'crypto.drawings', value: [level(), zone({ id: 'inverted', from: 0.0023, to: 0.002163 }), level({ id: 'long', label: 'x'.repeat(41) })] },
      ]),
    );
    expect(v.otherSettings).toEqual([
      { key: 'crypto.chart', value: chart() },
      { key: 'crypto.watchlist', value: ['coinbase:BTC-USD', 'binance:ONEUSDT'] },
      { key: 'crypto.alerts', value: [alert()] },
      { key: 'crypto.drawings', value: [level()] },
    ]);
    expect(v.skipped.settings).toBeUndefined();
  });

  const ROWS: { key: string; wrong: unknown[]; empty: unknown }[] = [
    { key: 'crypto.chart', wrong: [null, 7, 'coinbase:BTC-USD', [], [chart()]], empty: chart({ indicators: [] }) },
    { key: 'crypto.watchlist', wrong: [null, 7, 'coinbase:BTC-USD', {}, { 0: 'coinbase:BTC-USD' }], empty: [] },
    { key: 'crypto.alerts', wrong: [null, 7, 'a1', {}, { a1: alert() }], empty: [] },
    { key: 'crypto.drawings', wrong: [null, 7, 'd1', {}, { d1: level() }], empty: [] },
  ];

  it.each(ROWS)('$key : une valeur de la mauvaise forme écarte la ligne, une valeur vide valide la garde', ({ key, wrong, empty }) => {
    for (const value of wrong) {
      const v = prepareVaultRestore(vaultV1([{ key, value }]));
      expect(v.otherSettings, JSON.stringify(value)).toEqual([]);
      expect(v.skipped.settings, JSON.stringify(value)).toBe(1);
    }
    const v = prepareVaultRestore(vaultV1([{ key, value: empty }]));
    expect(v.otherSettings).toEqual([{ key, value: empty }]);
    expect(v.skipped.settings).toBeUndefined();
  });

  it('écarte les entrées qui portent __proto__ ou constructor comme clé propre, sans rien polluer', () => {
    const entry = (own: string) => `{${own}"id":"evil","target":"coinbase:BTC-USD","kind":"price_above","level":1,"mode":"once","author":"trader","state":"armed","createdAt":1}`;
    const text = `{"artefact":"CΛNTO","sessions":[],"settings":[{"key":"crypto.alerts","value":[${entry('"__proto__":{"polluted":true},')},${entry('"constructor":{"prototype":{"polluted":true}},')},${JSON.stringify(alert())}]}]}`;
    const v = prepareVaultRestore(text);
    expect(v.otherSettings).toEqual([{ key: 'crypto.alerts', value: [alert()] }]);
    expect(v.skipped.settings).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });
});
