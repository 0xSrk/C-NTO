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
});
