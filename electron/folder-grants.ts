import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const GRANTS_FILE = 'folder-grants.json';
const MAX_GRANTS = 16;

/**
 * Dossiers dans lesquels le renderer a le droit d'écrire ou que le pont peut surveiller.
 *
 * Le renderer ne choisit jamais un chemin lui-même : un dossier n'entre ici qu'après un
 * dialogue système (`files:pick-folder`, `bridge:pick-folder`) ou via le dossier par défaut
 * du pont. Les octrois sont persistés dans userData pour que la sauvegarde quotidienne
 * fonctionne au boot suivant sans redemander le dossier.
 */
export class FolderGrants {
  private granted = new Set<string>();
  private readonly file: string | null;

  constructor(userDataDir: string | null) {
    this.file = userDataDir ? path.join(userDataDir, GRANTS_FILE) : null;
    this.load();
  }

  /** Normalise un chemin absolu (résolution `..`, séparateurs, séparateur final). */
  static normalize(folder: string): string | null {
    if (typeof folder !== 'string' || !folder || folder.length > 1024) return null;
    if (!path.isAbsolute(folder)) return null;
    const resolved = path.resolve(folder);
    return resolved;
  }

  grant(folder: string): string | null {
    const key = FolderGrants.normalize(folder);
    if (!key) return null;
    this.granted.delete(key);
    this.granted.add(key);
    while (this.granted.size > MAX_GRANTS) {
      const oldest = this.granted.values().next().value;
      if (oldest === undefined) break;
      this.granted.delete(oldest);
    }
    this.save();
    return key;
  }

  has(folder: unknown): boolean {
    if (typeof folder !== 'string') return false;
    const key = FolderGrants.normalize(folder);
    return !!key && this.granted.has(key);
  }

  list(): string[] {
    return [...this.granted];
  }

  private load(): void {
    if (!this.file) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { folders?: unknown };
      if (Array.isArray(raw.folders)) {
        for (const f of raw.folders.slice(-MAX_GRANTS)) {
          const key = typeof f === 'string' ? FolderGrants.normalize(f) : null;
          if (key) this.granted.add(key);
        }
      }
    } catch {
      /* premier lancement */
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      writeFileSync(this.file, `${JSON.stringify({ folders: this.list() })}\n`, 'utf8');
    } catch {
      /* best-effort : l'octroi vaut pour la session en cours */
    }
  }
}

/** Nom de fichier de sauvegarde accepté : un seul segment, charset sûr, extension `.json`. */
export function isSafeBackupName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name) && !name.includes('..');
}
