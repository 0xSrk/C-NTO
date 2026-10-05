import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NtBridgeHost, writeAddonConfig } from '../electron/nt-bridge/index';
import { ERR } from '../electron/nt-bridge/protocol';

const SRC = readFileSync('ninjatrader/CantoBridge.cs', 'utf8');

function body(start: string, end: string): string {
  const i = SRC.indexOf(start);
  const j = SRC.indexOf(end, i + start.length);
  expect(i, start).toBeGreaterThan(0);
  expect(j, end).toBeGreaterThan(i);
  return SRC.slice(i, j);
}

describe('AddOn · garde propre de order.submit', () => {
  it('relit bridge.json puis applique la garde avant de toucher au compte', () => {
    const submit = body('private JObject SubmitOrder(', 'private void GuardSubmit(');
    const read = submit.indexOf('ReadBridgeConfig();');
    const guard = submit.indexOf('GuardSubmit(accountName, requested, tag);');
    expect(read).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(read);
    expect(guard).toBeLessThan(submit.indexOf('FindAccount('));
    expect(guard).toBeLessThan(submit.indexOf('account.CreateOrder('));
  });

  it('comptes Sim ou autorisés, plafond, tag : mêmes codes que le desk', () => {
    const guard = body('private void GuardSubmit(', 'private sealed class GuardException');
    expect(guard).toContain('StartsWith("Sim", StringComparison.Ordinal)');
    expect(guard).toContain('extraAccounts.Contains(accountName)');
    expect(guard).toMatch(/quantity != Math\.Floor\(quantity\) \|\| quantity < 1 \|\| quantity > cap/);
    expect(guard).toContain(`GuardException(${ERR.TAG},`);
    expect(guard).toContain(`GuardException(${ERR.ACCOUNT},`);
    expect(guard).toContain(`GuardException(${ERR.QUANTITY},`);
    const dispatch = body('private void DispatchDesk(', 'private JObject SubscribeMarket(');
    expect(dispatch).toMatch(/catch \(GuardException ex\)[\s\S]*ReplyError\(id, ex\.Code, ex\.Message\)/);
  });

  it('lit comptes et plafond dans bridge.json ; absents : Sim seulement, 20 contrats', () => {
    const read = body('private void ReadBridgeConfig(', 'private void StartSocket(');
    expect(read).toContain('obj["extraAccounts"] as JArray');
    expect(read).toContain('obj["maxContractsPerOrder"]');
    expect(read).toMatch(/n >= 1 && n <= 1000/);
    expect(SRC).toContain('private const int DefaultMaxContracts = 20;');
  });
});

describe('bridge.json porte la politique d’ordres', () => {
  const hosts: NtBridgeHost[] = [];
  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((host) => host.dispose()));
  });

  it('écrit comptes autorisés et plafond à côté du port et du jeton', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-addon-'));
    const written = await writeAddonConfig(dir, { port: 48231, token: 'jeton-xyz', extraAccounts: ['APEX-50K'], maxContractsPerOrder: 7 });
    expect(JSON.parse(readFileSync(written.path, 'utf8'))).toEqual({ port: 48231, token: 'jeton-xyz', extraAccounts: ['APEX-50K'], maxContractsPerOrder: 7 });
  });

  it('un changement de politique réécrit un bridge.json existant, n’en crée jamais', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'canto-host-'));
    const exportDir = mkdtempSync(path.join(tmpdir(), 'canto-export-'));
    const host = new NtBridgeHost(userData, () => exportDir);
    hosts.push(host);
    await host.start();
    const file = path.join(exportDir, 'bridge.json');

    await host.setMaxContracts(5);
    expect(existsSync(file)).toBe(false);

    writeFileSync(file, JSON.stringify({ port: 48231, token: 'ancien' }));
    await host.setMaxContracts(3);
    await host.allowAccount('APEX-50K');
    const synced = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(synced).toMatchObject({ extraAccounts: ['APEX-50K'], maxContractsPerOrder: 3 });
    expect(typeof synced.token).toBe('string');
    expect(synced.token).not.toBe('ancien');
  });
});
