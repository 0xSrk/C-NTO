import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dexie est remplacé par une coquille : `db.<table>` est injecté ci-dessous avec des tables en mémoire.
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
    async transaction(_mode: string, _tables: unknown, fn: () => Promise<void>) {
      return fn();
    }
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});

import { buildVaultV2 } from '@/engine/vault';
import { db, prepareVaultRestore, restoreVault } from '@/store/db';
import { DEFAULT_SETTINGS } from '@/store/settings';

interface FakeTable {
  rows: Map<string, Record<string, unknown>>;
  cleared: number;
  clear: () => Promise<void>;
  bulkPut: (list: Record<string, unknown>[]) => Promise<void>;
  put: (row: Record<string, unknown>) => Promise<void>;
  get: (key: string) => Promise<Record<string, unknown> | undefined>;
  toArray: () => Promise<Record<string, unknown>[]>;
}

function fakeTable(key: 'id' | 'key', seed: Record<string, unknown>[] = []): FakeTable {
  const t: FakeTable = {
    rows: new Map(seed.map((r) => [r[key] as string, r])),
    cleared: 0,
    async clear() {
      t.cleared++;
      t.rows.clear();
    },
    async bulkPut(list) {
      for (const r of list) t.rows.set(r[key] as string, r);
    },
    async put(row) {
      t.rows.set(row[key] as string, row);
    },
    async get(k) {
      return t.rows.get(k);
    },
    async toArray() {
      return [...t.rows.values()];
    },
  };
  return t;
}

const TABLES = ['sessions', 'trades', 'importedExecutions', 'notes', 'calendar', 'settings', 'copierAccounts', 'bots', 'macroReleases', 'barSeries', 'agentMessages'] as const;
type Tables = Record<(typeof TABLES)[number], FakeTable>;

function installFakeDb(): Tables {
  const tables = {} as Tables;
  for (const name of TABLES) tables[name] = fakeTable(name === 'settings' || name === 'importedExecutions' ? 'key' : 'id');
  Object.assign(db as unknown as Record<string, unknown>, tables);
  return tables;
}

const now = 1_760_000_000_000;
const session = (id: string, date: string) => ({ id, date, account: 'Sim', instruments: ['NQ'], source: 'ninjatrader', tradeCount: 1, pnl: 100, grossProfit: 100, grossLoss: 0, commission: 0, tags: [], createdAt: now, updatedAt: now });
const trade = (id: string, sessionId: string, extra: Record<string, unknown> = {}) => ({
  id,
  sessionId,
  instrument: 'NQ',
  direction: 'long',
  qty: 1,
  entryTime: now,
  exitTime: now + 60_000,
  entryPrice: 20_000,
  exitPrice: 20_005,
  pnl: 100,
  commission: 0,
  ...extra,
});

describe('prepareVaultRestore (validation pure)', () => {
  it('applique l’allowlist des réglages : orchestrateur, dossier de sauvegarde, hôtes LLM, secrets ignorés', () => {
    const json = JSON.stringify(
      buildVaultV2({
        appVersion: 't',
        sessions: [],
        trades: [],
        notes: [],
        settings: { callsign: 'OP', orchestratorAllowWrite: true, backupFolder: '/evil', llmAllowedHosts: ['evil'], updateChannel: 'dev', agent: { model: 'm', apiKey: 'sk' } },
      }),
    );
    const v = prepareVaultRestore(json);
    expect(v.settingsPatch).toEqual({ callsign: 'OP', agent: { model: 'm' } });
    expect(v.pendingApiKey).toBeNull();
  });

  it('coffre v1 : autres lignes settings limitées aux clés connues et assainies', () => {
    const v = prepareVaultRestore(
      JSON.stringify({
        artefact: 'CΛNTO',
        sessions: [],
        settings: [
          { key: 'settings', value: { callsign: 'V1', agent: { apiKey: 'sk-plain', model: 'm' } } },
          { key: 'agent.conversation', value: 'conv_1' },
          { key: 'chart.active', value: null },
          { key: 'chart.indicators', value: [{ id: 'i1', definitionId: 'ema', params: { period: 21 }, visible: true }, { id: 'bad' }] },
          { key: 'copier.config', value: { enabled: true, latencyBudgetMs: 999_999, channel: 'gamma', windowStart: '09:30', extra: 'x' } },
          { key: 'evil.key', value: 'dropped' },
          { key: 'agent.conversation', value: 'dup-ignored' },
        ],
      }),
    );
    expect(v.pendingApiKey).toBe('sk-plain');
    expect(v.settingsPatch).toEqual({ callsign: 'V1', agent: { model: 'm' } });
    const keys = v.otherSettings.map((r) => r.key);
    expect(keys).toEqual(['agent.conversation', 'chart.active', 'copier.config']);
    expect(v.otherSettings.find((r) => r.key === 'copier.config')!.value).toEqual({ enabled: true, windowStart: '09:30' });
    expect(v.skipped.settings).toBe(3);
  });

  it('rejette les lignes hors enum / hors bornes sans lever', () => {
    const v = prepareVaultRestore(
      JSON.stringify(
        buildVaultV2({
          appVersion: 't',
          sessions: [
            session('s1', '2026-09-15'),
            { ...session('s2', '2026-09-16'), rating: 9 },
            { ...session('s3', '2026-09-17'), tags: ['x'.repeat(41)] },
            { ...session('s4', '2026-09-18'), source: 'hack' },
            { ...session('s5', 'not-a-date') },
          ],
          trades: [
            trade('t1', 's1'),
            trade('t2', 's1', { qty: Infinity }),
            trade('t3', 's1', { qty: 2.5 }),
            trade('t4', 's1', { entryPrice: 1e300 }),
            trade('t5', 's1', { pnl: 1e8 }),
            trade('t6', 's1', { entryTime: now + 10, exitTime: now }),
            trade('t7', 's1', { commission: -1 }),
            trade('t8', 's1', { tags: [1, 2] }),
            trade('t9', 's2'),
          ],
          notes: [
            { id: 'n1', title: 'ok', body: 'b', tags: [], updatedAt: now },
            { id: 'n2', title: 'x'.repeat(201), body: 'b', tags: [], updatedAt: now },
          ],
          bots: [
            { id: 'b1', name: 'ok', instrument: 'MNQ', status: 'papier', description: '', rules: [{ id: 'r1', kind: 'garde', text: 'ok' }], createdAt: now, updatedAt: now },
            { id: 'b2', name: 'bad status', instrument: 'MNQ', status: 'live', description: '', rules: [], createdAt: now, updatedAt: now },
            { id: 'b3', name: 'bad rule', instrument: 'MNQ', status: 'papier', description: '', rules: [{ id: 'r1', kind: 'explosion', text: 'x' }], createdAt: now, updatedAt: now },
            { id: 'b4', name: 'x'.repeat(121), instrument: 'MNQ', status: 'papier', description: '', rules: [], createdAt: now, updatedAt: now },
          ],
          copier: [
            { id: 'c1', name: 'M', role: 'maitre', ntAccount: 'Sim', enabled: true, sizing: { mode: 'fixe', value: 1, maxContracts: 2 }, symbolMap: 'identique', createdAt: now },
            { id: 'c2', name: 'S', role: 'suiveur', ntAccount: 'Sim', enabled: true, sizing: { mode: 'fixe', value: Infinity, maxContracts: 2 }, symbolMap: 'identique', createdAt: now },
            { id: 'c3', name: 'S', role: 'suiveur', ntAccount: 'Sim', enabled: true, sizing: { mode: 'fixe', value: 1, maxContracts: 2 }, symbolMap: 'ES→NQ', createdAt: now },
          ],
          macroReleases: [
            { id: 'm1', date: '2026-09-16', title: 'FOMC', currency: 'USD', impact: 3, source: 'investing', at: '2026-09-16T18:00:00Z', syncedAt: now },
            { id: 'm2', date: '2026-09-16', title: 'X', currency: 'USD', impact: 5, source: 'investing', at: 'x', syncedAt: now },
            { id: 'm3', date: '2026-09-16', title: 'X', currency: 'USD', impact: 1, source: 'rss', at: 'x', syncedAt: now },
          ],
          includeHeavy: true,
          barSeries: [
            { id: 'bs1', instrument: 'NQ', timeframe: 5, label: 'ok', source: 'csv', createdAt: now, bars: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }] },
            { id: 'bs2', instrument: 'NQ', timeframe: 5, label: 'nan', source: 'csv', createdAt: now, bars: [{ time: 1, open: 'x', high: 2, low: 0.5, close: 1.5, volume: 10 }] },
          ],
          agentMessages: [
            { id: 'a1', conversationId: 'c', role: 'user', content: 'hi', createdAt: now },
            { id: 'a2', conversationId: 'c', role: 'root', content: 'hi', createdAt: now },
            { id: 'a3', conversationId: 'c', role: 'assistant', content: 'hi', createdAt: now, toolCalls: [{ id: 'x', name: 'y', args: 1 }] },
            { id: 'a4', conversationId: 'c', role: 'assistant', content: 'x'.repeat(200_001), createdAt: now },
          ],
        }),
      ),
    );
    expect(v.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(v.trades.map((t) => t.id)).toEqual(['t1']);
    expect(v.notes.map((n) => n.id)).toEqual(['n1']);
    expect(v.bots.map((b) => b.id)).toEqual(['b1']);
    expect(v.copierAccounts.map((c) => c.id)).toEqual(['c1']);
    expect(v.macroReleases.map((m) => m.id)).toEqual(['m1']);
    expect(v.barSeries.map((b) => b.id)).toEqual(['bs1']);
    expect(v.agentMessages.map((a) => a.id)).toEqual(['a1']);
    expect(v.skipped).toEqual({ sessions: 4, trades: 8, notes: 1, bots: 3, copierAccounts: 2, macroReleases: 2, barSeries: 1, agentMessages: 3 });
  });

  it('accepte un instrument hors registre et convertit les anciennes symbolMap', () => {
    const v = prepareVaultRestore(
      JSON.stringify(
        buildVaultV2({
          appVersion: 't',
          sessions: [session('s1', '2026-09-15'), { ...session('s2', '2026-09-16'), instruments: ['SIL'] }],
          trades: [trade('t1', 's1', { instrument: 'SIL', pnl: 42 })],
          notes: [],
          copier: [
            { id: 'cMicro', name: 'S', role: 'suiveur', ntAccount: 'Sim', enabled: true, sizing: { mode: 'ratio', value: 1, maxContracts: 2 }, symbolMap: 'NQ→MNQ', createdAt: now },
            { id: 'cStandard', name: 'S', role: 'suiveur', ntAccount: 'Sim', enabled: true, sizing: { mode: 'ratio', value: 1, maxContracts: 2 }, symbolMap: 'MNQ→NQ', createdAt: now },
            { id: 'cSame', name: 'S', role: 'suiveur', ntAccount: 'Sim', enabled: true, sizing: { mode: 'ratio', value: 1, maxContracts: 2 }, symbolMap: 'identique', createdAt: now },
          ],
        }),
      ),
    );
    expect(v.trades.map((t) => t.id)).toEqual(['t1']);
    expect(v.trades[0]!.instrument).toBe('SIL');
    expect(v.trades[0]!.pnl).toBe(42);
    expect(v.sessions.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(v.copierAccounts.map((c) => c.symbolMap)).toEqual([{ mode: 'micro' }, { mode: 'standard' }, { mode: 'identique' }]);
    expect(v.skipped.trades).toBeUndefined();
  });

  it('erreurs structurelles → exception', () => {
    expect(() => prepareVaultRestore(JSON.stringify({ sessions: 'nope' }))).toThrow(/liste|list/);
    expect(() => prepareVaultRestore(JSON.stringify({ sessions: [], bots: { id: 'x' } }))).toThrow(/liste|list/);
  });
});

describe('restoreVault (tables simulées)', () => {
  let tables: Tables;
  beforeEach(() => {
    tables = installFakeDb();
  });

  it('remplace séances + trades et purge importedExecutions', async () => {
    await tables.sessions.bulkPut([session('old', '2026-01-01')]);
    await tables.trades.bulkPut([trade('told', 'old')]);
    await tables.importedExecutions.bulkPut([{ key: 'Sim\0e1', account: 'Sim', executionId: 'e1', sessionId: 'old', importedAt: now }]);
    const json = JSON.stringify(buildVaultV2({ appVersion: 't', sessions: [session('s1', '2026-09-15')], trades: [trade('t1', 's1'), trade('orphan', 'ghost')], notes: [] }));
    const r = await restoreVault(json);
    expect(r).toMatchObject({ sessions: 1, trades: 1, notes: 0, apiKeyReencrypted: false, skipped: 1 });
    expect(tables.importedExecutions.cleared).toBe(1);
    expect(tables.importedExecutions.rows.size).toBe(0);
    expect([...tables.sessions.rows.keys()]).toEqual(['s1']);
    expect([...tables.trades.rows.keys()]).toEqual(['t1']);
  });

  it('coffre sans séances : journal et exécutions connues intacts', async () => {
    await tables.importedExecutions.bulkPut([{ key: 'k', account: 'Sim', executionId: 'e1', sessionId: 'old', importedAt: now }]);
    await restoreVault(JSON.stringify(buildVaultV2({ appVersion: 't', sessions: [], trades: [], notes: [{ id: 'n1', title: 't', body: 'b', tags: [], updatedAt: now }] })));
    expect(tables.importedExecutions.cleared).toBe(0);
    expect(tables.sessions.cleared).toBe(0);
    expect(tables.notes.rows.size).toBe(1);
  });

  it('réglages : orchestratorAllowWrite / backupFolder / callsign > 40 ignorés, blob local conservé', async () => {
    await tables.settings.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, backupFolder: '/home/op/bk', agent: { ...DEFAULT_SETTINGS.agent, apiKeyEncrypted: 'blob-local' } } });
    const json = JSON.stringify(
      buildVaultV2({
        appVersion: 't',
        sessions: [],
        trades: [],
        notes: [],
        settings: { callsign: 'x'.repeat(41), orchestratorAllowWrite: true, backupFolder: '/evil', orchestratorPort: 1025, startingBalance: 75_000, agent: { model: 'restored' } },
      }),
    );
    await restoreVault(json);
    const stored = (await tables.settings.get('settings'))!.value as typeof DEFAULT_SETTINGS;
    expect(stored.orchestratorAllowWrite).toBe(false);
    expect(stored.orchestratorPort).toBe(DEFAULT_SETTINGS.orchestratorPort);
    expect(stored.backupFolder).toBe('/home/op/bk');
    expect(stored.callsign).toBe(DEFAULT_SETTINGS.callsign);
    expect(stored.startingBalance).toBe(75_000);
    expect(stored.agent.model).toBe('restored');
    expect(stored.agent.apiKeyEncrypted).toBe('blob-local');
    expect(stored.agent.apiKey).toBe('');
  });

  it('coffre v1 avec clé en clair (navigateur) : reprise en clair hors shell', async () => {
    await restoreVault(JSON.stringify({ artefact: 'CΛNTO', sessions: [], settings: [{ key: 'settings', value: { agent: { apiKey: 'sk-plain' } } }, { key: 'evil', value: 1 }] }));
    const stored = (await tables.settings.get('settings'))!.value as { agent: { apiKey: string } };
    expect(stored.agent.apiKey).toBe('sk-plain');
    expect(await tables.settings.get('evil')).toBeUndefined();
  });
});
