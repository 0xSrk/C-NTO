import { describe, expect, it } from 'vitest';
import { buildVaultV2, parseVaultJson, stripSecrets } from '@/engine/vault';

describe('coffre canto-vault-v2', () => {
  it('export v2 ne contient aucune des clés apiKey|apiKeyBlob|orchToken|token', () => {
    const vault = buildVaultV2({
      appVersion: '1.1.2',
      exportedAt: 1,
      sessions: [{ id: 's1', date: '2026-09-15' }],
      trades: [],
      notes: [],
      settings: {
        callsign: 'OP',
        agent: { apiKey: 'sk-secret', apiKeyBlob: 'blob', model: 'llama' },
        orchToken: 'orch-secret',
        token: 'plain-token',
      },
    });
    const json = JSON.stringify(vault);
    expect(vault.format).toBe('canto-vault-v2');
    expect(vault.schemaVersion).toBe(2);
    expect(json).not.toMatch(/apiKey/);
    expect(json).not.toMatch(/apiKeyBlob/);
    expect(json).not.toMatch(/orchToken/);
    expect(json).not.toMatch(/"token"/);
    expect(json).not.toContain('sk-secret');
    expect((vault.settings as { callsign: string }).callsign).toBe('OP');
    expect((vault.settings as { agent: { model: string } }).agent.model).toBe('llama');
  });

  it("restore d'un objet v1 minimal sans tags ne lève pas", () => {
    expect(() => parseVaultJson(JSON.stringify({ sessions: [{ id: 's1', date: '2026-09-15', account: 'Sim' }] }))).not.toThrow();
    const parsed = parseVaultJson(JSON.stringify({ sessions: [{ id: 's1', date: '2026-09-15', account: 'Sim' }] }));
    expect(parsed.sessions).toEqual([{ id: 's1', date: '2026-09-15', account: 'Sim' }]);
  });

  it("JSON.parse('null') / tableau racine → rejet", () => {
    expect(() => parseVaultJson('null')).toThrow(/non reconnu/);
    expect(() => parseVaultJson('[1,2]')).toThrow(/non reconnu/);
    expect(() => parseVaultJson('not-json')).toThrow(/illisible/);
  });

  it('stripSecrets enlève les champs sensibles nidés', () => {
    const stripped = stripSecrets({ agent: { apiKeyEncrypted: 'x', temperature: 0.2 }, other: 1 }) as {
      agent: { temperature: number };
      other: number;
    };
    expect(stripped.other).toBe(1);
    expect(stripped.agent.temperature).toBe(0.2);
    expect(stripped.agent).not.toHaveProperty('apiKeyEncrypted');
  });

  it('calendarEvents toujours exportées ; macroReleases seulement si le coffre les porte encore', () => {
    const light = buildVaultV2({
      appVersion: '1.1.2',
      sessions: [],
      trades: [],
      notes: [],
      macroReleases: [{ id: 'm1', date: '2026-09-17', title: 'FOMC' }],
      barSeries: [{ id: 'b1' }],
      agentMessages: [{ id: 'a1' }],
    });
    expect(light.calendarEvents).toEqual([]);
    expect(light.macroReleases).toEqual([{ id: 'm1', date: '2026-09-17', title: 'FOMC' }]);
    expect(light.barSeries).toBeUndefined();
    expect(light.agentMessages).toBeUndefined();
    const heavy = buildVaultV2({
      appVersion: '1.1.2',
      sessions: [],
      trades: [],
      notes: [],
      includeHeavy: true,
      barSeries: [{ id: 'b1' }],
      agentMessages: [{ id: 'a1' }],
    });
    expect(heavy.barSeries).toEqual([{ id: 'b1' }]);
    expect(heavy.agentMessages).toEqual([{ id: 'a1' }]);
  });
});
