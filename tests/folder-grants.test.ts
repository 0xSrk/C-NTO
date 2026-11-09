import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FolderGrants, GRANTS_FILE, isSafeBackupName } from '../electron/folder-grants';

const tmp: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'canto-grants-'));
  tmp.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('dossiers autorisés (écriture coffre, pont)', () => {
  it('refuse tout dossier tant qu’un dialogue ne l’a pas accordé', () => {
    const g = new FolderGrants(null);
    const target = path.resolve(os.homedir(), 'Documents');
    expect(g.has(target)).toBe(false);
    expect(g.has(42)).toBe(false);
    g.grant(target);
    expect(g.has(target)).toBe(true);
  });

  it('refuse un chemin relatif et normalise les `..`', () => {
    const g = new FolderGrants(null);
    expect(g.grant('relative/path')).toBeNull();
    const base = path.resolve(os.homedir(), 'a', 'b');
    g.grant(base);
    expect(g.has(path.join(base, 'c', '..'))).toBe(true);
    expect(g.has(path.join(base, '..'))).toBe(false);
  });

  it('persiste les octrois dans userData et les relit', () => {
    const dir = scratch();
    const g = new FolderGrants(dir);
    const target = path.resolve(dir, 'backup');
    g.grant(target);
    const raw = JSON.parse(readFileSync(path.join(dir, GRANTS_FILE), 'utf8')) as { folders: string[] };
    expect(raw.folders).toEqual([target]);
    const again = new FolderGrants(dir);
    expect(again.has(target)).toBe(true);
  });

  it('borne la liste à 16 entrées (les plus anciennes sortent)', () => {
    const g = new FolderGrants(null);
    for (let i = 0; i < 20; i++) g.grant(path.resolve(os.homedir(), `f${i}`));
    expect(g.list()).toHaveLength(16);
    expect(g.has(path.resolve(os.homedir(), 'f0'))).toBe(false);
    expect(g.has(path.resolve(os.homedir(), 'f19'))).toBe(true);
  });

  it('n’accepte qu’un nom de sauvegarde sûr', () => {
    expect(isSafeBackupName('canto-vault-2026-09-25.json')).toBe(true);
    expect(isSafeBackupName('../evil.json')).toBe(false);
    expect(isSafeBackupName('.bashrc')).toBe(false);
    expect(isSafeBackupName('vault.json\n')).toBe(false);
    expect(isSafeBackupName('a/b.json')).toBe(false);
    expect(isSafeBackupName('notes.txt')).toBe(false);
    expect(isSafeBackupName(undefined)).toBe(false);
  });

  it('SEC1.3 n’accepte que le nom que le desk écrit, `canto-vault-AAAA-MM-JJ.json` : ni `bridge.json`, ni un autre fichier du dossier', () => {
    // Le dossier du pont est accordé sans dialogue (`bridge:default-folder`) : la garde de l'AddOn y vit, dans `bridge.json`.
    for (const name of ['bridge.json', 'folder-grants.json', 'nt-bridge.json', 'package.json', 'settings.json', 'a.json']) {
      expect(isSafeBackupName(name), name).toBe(false);
    }
    for (const name of ['canto-vault.json', 'canto-vault-latest.json', 'canto-vault-2026-11-09.json.tmp', 'canto-vault-2026-11-09.json.json', 'canto-vault-2026-11-9.json', 'canto-vault-20261109.json', 'Canto-Vault-2026-11-09.json', 'x-canto-vault-2026-11-09.json', ' canto-vault-2026-11-09.json', 'canto-vault-2026-11-09.JSON']) {
      expect(isSafeBackupName(name), name).toBe(false);
    }
    expect(isSafeBackupName('canto-vault-2026-11-09.json')).toBe(true);
    expect(isSafeBackupName('canto-vault-2027-01-01.json')).toBe(true);
  });

  it('SEC1.3 le nom que le renderer donne à sa sauvegarde est celui que le process principal accepte', () => {
    const settings = readFileSync('src/store/settings.ts', 'utf8');
    // Deux écritures, le même nom : la copie quotidienne et l'export à la demande.
    const names = [...settings.matchAll(/`canto-vault-\$\{todayUtc\(\)\}\.json`/g)];
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(settings).toMatch(/function todayUtc\(ms = Date\.now\(\)\): string \{\n  return new Date\(ms\)\.toISOString\(\)\.slice\(0, 10\);/);
    expect(isSafeBackupName(`canto-vault-${new Date().toISOString().slice(0, 10)}.json`)).toBe(true);
    // Le process principal borne l'écriture par ce contrôle, avant l'octroi du dossier.
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(main).toMatch(/ipcMain\.handle\('files:write-in-folder'[\s\S]{0,200}!isSafeBackupName\(name\)/);
  });
});
