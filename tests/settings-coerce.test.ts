import { describe, expect, it } from 'vitest';
import { coerceAgentConfig, coerceSettings, DEFAULT_SETTINGS, mergeRestoredSettings, pickRestorableSettings } from '@/store/settings';

describe('coerceSettings', () => {
  it('objet vide / non-objet → défauts', () => {
    expect(coerceSettings({}, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings(null, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings('x', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings([1, 2], DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('rejette les mauvais types et retombe sur la base', () => {
    const s = coerceSettings(
      {
        callsign: 42,
        startingBalance: '50000',
        planId: { evil: true },
        boundaryHour: 'midnight',
        riskPerContract: null,
        calendarView: 'liste',
        uiZoom: '1.2',
        uiZoomAuto: 'yes',
        backupEncrypted: 1,
        backupDaily: 'true',
        orchestratorAllowWrite: 'true',
        orchestratorPort: '8080',
        updateChannel: 'nightly',
        llmAllowedHosts: 'api.openai.com',
        lastBackupAt: '2026-01-01',
        backupFolder: 12,
      },
      DEFAULT_SETTINGS,
    );
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('applique les bornes numériques et de longueur', () => {
    const base = DEFAULT_SETTINGS;
    expect(coerceSettings({ callsign: 'x'.repeat(41) }, base).callsign).toBe(base.callsign);
    expect(coerceSettings({ callsign: 'x'.repeat(40) }, base).callsign).toBe('x'.repeat(40));
    expect(coerceSettings({ startingBalance: 0 }, base).startingBalance).toBe(base.startingBalance);
    expect(coerceSettings({ startingBalance: -1 }, base).startingBalance).toBe(base.startingBalance);
    expect(coerceSettings({ startingBalance: 1e9 + 1 }, base).startingBalance).toBe(base.startingBalance);
    expect(coerceSettings({ startingBalance: Infinity }, base).startingBalance).toBe(base.startingBalance);
    expect(coerceSettings({ startingBalance: NaN }, base).startingBalance).toBe(base.startingBalance);
    expect(coerceSettings({ startingBalance: 25_000 }, base).startingBalance).toBe(25_000);
    expect(coerceSettings({ boundaryHour: 24 }, base).boundaryHour).toBe(base.boundaryHour);
    expect(coerceSettings({ boundaryHour: 17.5 }, base).boundaryHour).toBe(base.boundaryHour);
    expect(coerceSettings({ boundaryHour: 18 }, base).boundaryHour).toBe(18);
    expect(coerceSettings({ riskPerContract: -5 }, base).riskPerContract).toBe(base.riskPerContract);
    expect(coerceSettings({ uiZoom: 0.4 }, base).uiZoom).toBe(base.uiZoom);
    expect(coerceSettings({ uiZoom: 2.5 }, base).uiZoom).toBe(base.uiZoom);
    expect(coerceSettings({ uiZoom: 1.25 }, base).uiZoom).toBe(1.25);
    expect(coerceSettings({ orchestratorPort: 80 }, base).orchestratorPort).toBe(base.orchestratorPort);
    expect(coerceSettings({ orchestratorPort: 70_000 }, base).orchestratorPort).toBe(base.orchestratorPort);
    expect(coerceSettings({ orchestratorPort: 47118.5 }, base).orchestratorPort).toBe(base.orchestratorPort);
    expect(coerceSettings({ orchestratorPort: 50_000 }, base).orchestratorPort).toBe(50_000);
    expect(coerceSettings({ planId: 'p'.repeat(65) }, base).planId).toBe(base.planId);
    expect(coerceSettings({ planAccount: 'a'.repeat(65) }, base).planAccount).toBe(base.planAccount);
    expect(coerceSettings({ backupFolder: 'f'.repeat(1025) }, base).backupFolder).toBe(base.backupFolder);
    expect(coerceSettings({ backupFolder: '/tmp/x' }, base).backupFolder).toBe('/tmp/x');
    expect(coerceSettings({ backupFolder: null }, { ...base, backupFolder: '/tmp/x' }).backupFolder).toBeNull();
    expect(coerceSettings({ lastBackupAt: 12345 }, base).lastBackupAt).toBe(12345);
    expect(coerceSettings({ lastBackupAt: null }, { ...base, lastBackupAt: 5 }).lastBackupAt).toBeNull();
    expect(coerceSettings({ calendarView: 'flux' }, base).calendarView).toBe('flux');
    expect(coerceSettings({ updateChannel: 'dev' }, base).updateChannel).toBe('dev');
    expect(coerceSettings({ orchestratorAllowWrite: true }, base).orchestratorAllowWrite).toBe(true);
  });

  it('llmAllowedHosts : chaînes seulement, ≤ 16 entrées, ≤ 128 caractères', () => {
    const hosts = coerceSettings({ llmAllowedHosts: ['a.com', 7, '', 'b'.repeat(129), 'c.com'] }, DEFAULT_SETTINGS).llmAllowedHosts;
    expect(hosts).toEqual(['a.com', 'c.com']);
    const many = coerceSettings({ llmAllowedHosts: Array.from({ length: 30 }, (_, i) => `h${i}`) }, DEFAULT_SETTINGS).llmAllowedHosts;
    expect(many.length).toBe(16);
  });

  it('userPlans : seuls les plans utilisateur bien formés sont conservés', () => {
    const s = coerceSettings(
      {
        userPlans: [
          { id: 'u1', source: 'user', firm: 'F', label: 'L', accountSize: 50_000, profitTarget: 3000, maxDrawdown: 2500, drawdownType: 'trailing', phase: 'evaluation' },
          { id: 'b1', source: 'bundled', firm: 'F', label: 'L', accountSize: 50_000, profitTarget: 3000, maxDrawdown: 2500 },
          { id: 'u2', source: 'user', firm: 'F', label: 'L', accountSize: 'big', profitTarget: 3000, maxDrawdown: 2500 },
          'garbage',
          null,
        ],
      },
      DEFAULT_SETTINGS,
    );
    expect(s.userPlans.map((p) => p.id)).toEqual(['u1']);
    expect(s.userPlans[0]!.version).toBe(1);
  });

  it('ignore les clés inconnues et le prototype', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true},"unknownKey":1,"callsign":"OK"}') as Record<string, unknown>;
    const s = coerceSettings(raw, DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    expect(s.callsign).toBe('OK');
    expect('unknownKey' in s).toBe(false);
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});

describe('coerceAgentConfig', () => {
  const base = DEFAULT_SETTINGS.agent;

  it('valide provider, bornes de longueur, température et booléens', () => {
    expect(coerceAgentConfig({ provider: 'gemini' }, base).provider).toBe(base.provider);
    expect(coerceAgentConfig({ provider: 'anthropic' }, base).provider).toBe('anthropic');
    expect(coerceAgentConfig({ baseUrl: 'u'.repeat(2049) }, base).baseUrl).toBe(base.baseUrl);
    expect(coerceAgentConfig({ model: 'm'.repeat(257) }, base).model).toBe(base.model);
    expect(coerceAgentConfig({ temperature: 2.1 }, base).temperature).toBe(base.temperature);
    expect(coerceAgentConfig({ temperature: -0.1 }, base).temperature).toBe(base.temperature);
    expect(coerceAgentConfig({ temperature: 0.7 }, base).temperature).toBe(0.7);
    expect(coerceAgentConfig({ systemPrompt: 'p'.repeat(20_001) }, base).systemPrompt).toBe(base.systemPrompt);
    expect(coerceAgentConfig({ toolsEnabled: 'no' }, base).toolsEnabled).toBe(base.toolsEnabled);
    expect(coerceAgentConfig({ toolsEnabled: false }, base).toolsEnabled).toBe(false);
  });

  it('clé API ≤ 4096, blob chiffré ≤ 8192 ou absent', () => {
    expect(coerceAgentConfig({ apiKey: 'k'.repeat(4097) }, base).apiKey).toBe('');
    expect(coerceAgentConfig({ apiKey: 'sk-1' }, base).apiKey).toBe('sk-1');
    expect(coerceAgentConfig({ apiKeyEncrypted: 'b'.repeat(8193) }, base).apiKeyEncrypted).toBeUndefined();
    expect(coerceAgentConfig({ apiKeyEncrypted: 'blob' }, base).apiKeyEncrypted).toBe('blob');
    expect(coerceAgentConfig({ apiKeyEncrypted: 42 }, base).apiKeyEncrypted).toBeUndefined();
    // Absent du patch : le blob de la base est conservé.
    expect(coerceAgentConfig({ model: 'x' }, { ...base, apiKeyEncrypted: 'keep' }).apiKeyEncrypted).toBe('keep');
    // Présent mais vide : effacé.
    expect(coerceAgentConfig({ apiKeyEncrypted: '' }, { ...base, apiKeyEncrypted: 'keep' }).apiKeyEncrypted).toBeUndefined();
  });
});

describe('allowlist de restauration (coffre)', () => {
  it('pickRestorableSettings ne garde que les clés restaurables', () => {
    const picked = pickRestorableSettings({
      callsign: 'OP',
      orchestratorAllowWrite: true,
      orchestratorPort: 1234,
      backupFolder: '/evil',
      backupEncrypted: false,
      backupDaily: false,
      lastBackupAt: 1,
      updateChannel: 'dev',
      llmAllowedHosts: ['evil.example'],
      uiZoom: 1.1,
      agent: { provider: 'anthropic', model: 'claude', apiKey: 'sk-leak', apiKeyEncrypted: 'blob', baseUrl: 'https://x' },
    });
    expect(Object.keys(picked).sort()).toEqual(['agent', 'callsign', 'uiZoom']);
    expect(Object.keys(picked.agent as object).sort()).toEqual(['baseUrl', 'model', 'provider']);
  });

  it('mergeRestoredSettings ignore orchestratorAllowWrite, backupFolder et un callsign > 40', () => {
    const current = { ...DEFAULT_SETTINGS, backupFolder: '/home/op/backups', agent: { ...DEFAULT_SETTINGS.agent, apiKeyEncrypted: 'blob-local' } };
    const merged = mergeRestoredSettings(current, {
      callsign: 'x'.repeat(41),
      orchestratorAllowWrite: true,
      backupFolder: '/evil',
      llmAllowedHosts: ['evil.example'],
      startingBalance: 100_000,
      agent: { model: 'llama-restored', apiKey: 'sk-from-vault', apiKeyEncrypted: 'blob-from-vault' },
    });
    expect(merged.orchestratorAllowWrite).toBe(false);
    expect(merged.backupFolder).toBe('/home/op/backups');
    expect(merged.llmAllowedHosts).toEqual([]);
    expect(merged.callsign).toBe(DEFAULT_SETTINGS.callsign);
    expect(merged.startingBalance).toBe(100_000);
    expect(merged.agent.model).toBe('llama-restored');
    expect(merged.agent.apiKey).toBe('');
    expect(merged.agent.apiKeyEncrypted).toBe('blob-local');
  });

  it('mergeRestoredSettings : un callsign valide et une consigne système ≤ 20 000 passent', () => {
    const merged = mergeRestoredSettings(DEFAULT_SETTINGS, { callsign: 'SIERRA', agent: { systemPrompt: 'Consigne courte.' } });
    expect(merged.callsign).toBe('SIERRA');
    expect(merged.agent.systemPrompt).toBe('Consigne courte.');
  });
});
