import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultNinjaExportFolder } from '../electron/bridge-folder';
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
    expect(g.has(target, 'write')).toBe(false);
    expect(g.has(target, 'watch')).toBe(false);
    expect(g.has(42, 'write')).toBe(false);
    g.grant(target, 'write');
    expect(g.has(target, 'write')).toBe(true);
  });

  it('refuse un chemin relatif et normalise les `..`', () => {
    const g = new FolderGrants(null);
    expect(g.grant('relative/path', 'write')).toBeNull();
    const base = path.resolve(os.homedir(), 'a', 'b');
    g.grant(base, 'write');
    expect(g.has(path.join(base, 'c', '..'), 'write')).toBe(true);
    expect(g.has(path.join(base, '..'), 'write')).toBe(false);
  });

  it('persiste les octrois dans userData et les relit', () => {
    const dir = scratch();
    const g = new FolderGrants(dir);
    const target = path.resolve(dir, 'backup');
    const watched = path.resolve(dir, 'pont');
    g.grant(target, 'write');
    g.grant(watched, 'watch');
    const raw = JSON.parse(readFileSync(path.join(dir, GRANTS_FILE), 'utf8')) as Record<string, unknown>;
    expect(raw).toEqual({ write: [target], watch: [watched] });
    const again = new FolderGrants(dir);
    expect(again.has(target, 'write')).toBe(true);
    expect(again.has(target, 'watch')).toBe(false);
    expect(again.has(watched, 'watch')).toBe(true);
    expect(again.has(watched, 'write')).toBe(false);
  });

  it('borne chaque liste à 16 entrées (les plus anciennes sortent)', () => {
    const g = new FolderGrants(null);
    for (let i = 0; i < 20; i++) g.grant(path.resolve(os.homedir(), `f${i}`), 'write');
    g.grant(path.resolve(os.homedir(), 'pont'), 'watch');
    expect(g.list('write')).toHaveLength(16);
    expect(g.list('watch')).toEqual([path.resolve(os.homedir(), 'pont')]);
    expect(g.has(path.resolve(os.homedir(), 'f0'), 'write')).toBe(false);
    expect(g.has(path.resolve(os.homedir(), 'f19'), 'write')).toBe(true);
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
    // Sous Windows, la copie de travail porte des fins de ligne \r\n : les sources se lisent sans elles (les deux
    // expressions qui suivent traversent des lignes).
    const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const settings = read('src/store/settings.ts');
    // Deux écritures, le même nom : la copie quotidienne et l'export à la demande.
    const names = [...settings.matchAll(/`canto-vault-\$\{todayUtc\(\)\}\.json`/g)];
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(settings).toMatch(/function todayUtc\(ms = Date\.now\(\)\): string \{\n  return new Date\(ms\)\.toISOString\(\)\.slice\(0, 10\);/);
    expect(isSafeBackupName(`canto-vault-${new Date().toISOString().slice(0, 10)}.json`)).toBe(true);
    // Le process principal borne l'écriture par ce contrôle, avant l'octroi du dossier.
    const main = read('electron/main.ts');
    expect(main).toMatch(/ipcMain\.handle\('files:write-in-folder'[\s\S]{0,200}!isSafeBackupName\(name\)/);
  });
});

/**
 * SEC2.5 — écrire et surveiller sont deux octrois. Une seule liste servait aux deux : le dossier du pont, accordé sans
 * dialogue par `bridge:default-folder` et où vit `bridge.json`, la garde propre de l'AddOn, était du même coup
 * inscriptible par `files:write-in-folder`. SEC1.3 y fermait l'écriture de `bridge.json` par le nom ; le dossier
 * lui-même n'est plus inscriptible.
 */
describe('SEC2.5 écrire et surveiller sont deux octrois', () => {
  const documents = path.resolve(os.homedir(), 'Documents');
  const bridgeFolder = defaultNinjaExportFolder(documents);

  it('le dossier surveillé n’est pas inscriptible, le dossier de sauvegarde n’est pas surveillable', () => {
    const g = new FolderGrants(null);
    const backup = path.resolve(os.homedir(), 'Sauvegardes');
    g.grant(bridgeFolder, 'watch');
    g.grant(backup, 'write');
    expect(g.has(bridgeFolder, 'watch')).toBe(true);
    expect(g.has(bridgeFolder, 'write')).toBe(false);
    expect(g.has(backup, 'write')).toBe(true);
    expect(g.has(backup, 'watch')).toBe(false);
    // Le même dossier choisi dans les deux dialogues porte les deux droits : c'est le trader qui l'a voulu.
    g.grant(backup, 'watch');
    expect(g.has(backup, 'write')).toBe(true);
    expect(g.has(backup, 'watch')).toBe(true);
  });

  it('un fichier d’avant la séparation : le dossier par défaut du pont n’est plus que surveillé, les autres gardent leurs deux droits', () => {
    const dir = scratch();
    const backup = path.resolve(dir, 'backup');
    const picked = path.resolve(dir, 'pont-choisi');
    writeFileSync(path.join(dir, GRANTS_FILE), `${JSON.stringify({ folders: [backup, bridgeFolder, picked] })}\n`, 'utf8');
    const g = new FolderGrants(dir, { legacyWatchOnly: () => [bridgeFolder] });
    expect(g.has(bridgeFolder, 'watch')).toBe(true);
    expect(g.has(bridgeFolder, 'write')).toBe(false);
    // Rien ne dit par quel dialogue ces deux-là étaient entrés : la sauvegarde quotidienne ne casse pas.
    for (const folder of [backup, picked]) {
      expect(g.has(folder, 'write'), folder).toBe(true);
      expect(g.has(folder, 'watch'), folder).toBe(true);
    }
    // Rangé une fois, écrit au nouveau format : la lecture suivante n'a plus besoin de la règle.
    const raw = JSON.parse(readFileSync(path.join(dir, GRANTS_FILE), 'utf8')) as Record<string, unknown>;
    expect(raw).toEqual({ write: [backup, picked], watch: [backup, bridgeFolder, picked] });
    const again = new FolderGrants(dir);
    expect(again.has(bridgeFolder, 'write')).toBe(false);
    expect(again.has(backup, 'write')).toBe(true);
  });

  it('un fichier d’avant la séparation, sans dossier par défaut connu : rien n’est perdu, rien ne lève', () => {
    const dir = scratch();
    const backup = path.resolve(dir, 'backup');
    writeFileSync(path.join(dir, GRANTS_FILE), `${JSON.stringify({ folders: [backup, 'relatif', 42] })}\n`, 'utf8');
    const g = new FolderGrants(dir, {
      legacyWatchOnly: () => {
        throw new Error('documents introuvable');
      },
    });
    expect(g.has(backup, 'write')).toBe(true);
    expect(g.list('watch')).toEqual([backup]);
  });

  it('un fichier illisible ou d’une autre forme n’accorde rien', () => {
    const dir = scratch();
    for (const body of ['{', '[]', '{"write":"/tmp","watch":7}', '{"folders":"/tmp"}']) {
      writeFileSync(path.join(dir, GRANTS_FILE), body, 'utf8');
      const g = new FolderGrants(dir);
      expect(g.list('write'), body).toEqual([]);
      expect(g.list('watch'), body).toEqual([]);
    }
  });

  it('le process principal : l’écriture demande un octroi d’écriture, le pont un octroi de surveillance', () => {
    const main = readFileSync('electron/main.ts', 'utf8').replace(/\r\n/g, '\n');
    const handler = (channel: string) => {
      const start = main.indexOf(`ipcMain.handle('${channel}'`);
      expect(start, channel).toBeGreaterThan(-1);
      return main.slice(start, main.indexOf('\n});', start));
    };
    expect(handler('files:pick-folder')).toContain("grants.grant(picked, 'write')");
    expect(handler('files:write-in-folder')).toContain("if (!grants.has(folder, 'write')) return { ok: false, encrypted: false, reason: 'not_granted' };");
    expect(handler('bridge:pick-folder')).toContain("grants.grant(picked, 'watch')");
    expect(handler('bridge:default-folder')).toContain("grants.grant(folder, 'watch')");
    expect(handler('bridge:configure')).toContain("grants.has(c.folder, 'watch')");
    // Aucun octroi ni contrôle sans son usage, et un seul point d'entrée en écriture : le dialogue de sauvegarde.
    const calls = [...main.matchAll(/grants\.(?:grant|has)\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toHaveLength(5);
    for (const args of calls) expect(args).toMatch(/, '(?:write|watch)'$/);
    expect([...main.matchAll(/grants\.grant\([^)]*'write'\)/g)]).toHaveLength(1);
    // Le dossier par défaut du pont, seul octroi sans dialogue, est celui qu'un ancien fichier ne rend que surveillable.
    expect(main).toContain("new FolderGrants(gpuDir, { legacyWatchOnly: () => [defaultNinjaExportFolder(app.getPath('documents'))] })");
  });
});
