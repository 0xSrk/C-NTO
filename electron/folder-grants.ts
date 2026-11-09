import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const GRANTS_FILE = 'folder-grants.json';
const MAX_GRANTS = 16;

/**
 * Ce qu'un octroi permet (SEC2.5). `write` : y écrire la copie du coffre (`files:write-in-folder`). `watch` : le faire
 * surveiller par le pont (`bridge:configure`). L'un ne vaut pas l'autre.
 */
export type GrantKind = 'write' | 'watch';
const KINDS = ['write', 'watch'] as const;

export interface FolderGrantsOptions {
  /**
   * Dossiers qu'un fichier d'avant la séparation ne rend que surveillables : le dossier par défaut du pont, seul octroi
   * donné sans dialogue. Lu à la première lecture des octrois, pas à la construction.
   */
  legacyWatchOnly?: () => readonly string[];
}

/**
 * Dossiers dans lesquels le renderer a le droit d'écrire, et dossiers que le pont peut surveiller : deux listes.
 *
 * Le renderer ne choisit jamais un chemin lui-même : un dossier n'entre ici qu'après un dialogue système
 * (`files:pick-folder` pour l'écriture, `bridge:pick-folder` pour la surveillance) ou, pour la surveillance seule, via
 * le dossier par défaut du pont (`bridge:default-folder`, sans dialogue). Ce dossier-là porte `bridge.json`, la garde
 * propre de l'AddOn : il n'est pas inscriptible. Les octrois sont persistés dans userData pour que la sauvegarde
 * quotidienne fonctionne au boot suivant sans redemander le dossier.
 *
 * Un fichier d'avant la séparation ne porte qu'une liste, `folders`. Ses dossiers gardent les deux droits qu'ils
 * avaient, sauf ceux de `legacyWatchOnly` : rien ne dit par quel dialogue un dossier était entré.
 */
export class FolderGrants {
  private readonly granted: Record<GrantKind, Set<string>> = { write: new Set(), watch: new Set() };
  private legacy: string[] | null = null;
  private readonly file: string | null;

  constructor(
    userDataDir: string | null,
    private readonly options: FolderGrantsOptions = {},
  ) {
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

  grant(folder: string, kind: GrantKind): string | null {
    const key = FolderGrants.normalize(folder);
    if (!key) return null;
    this.migrate();
    this.add(kind, key);
    this.save();
    return key;
  }

  has(folder: unknown, kind: GrantKind): boolean {
    if (typeof folder !== 'string') return false;
    const key = FolderGrants.normalize(folder);
    if (!key) return false;
    this.migrate();
    return this.granted[kind].has(key);
  }

  list(kind: GrantKind): string[] {
    this.migrate();
    return [...this.granted[kind]];
  }

  private add(kind: GrantKind, key: string): void {
    const set = this.granted[kind];
    set.delete(key);
    set.add(key);
    while (set.size > MAX_GRANTS) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
  }

  /** Range les dossiers d'un fichier d'avant la séparation, une fois, et l'écrit au nouveau format. */
  private migrate(): void {
    const legacy = this.legacy;
    if (!legacy) return;
    this.legacy = null;
    const watchOnly = new Set<string>();
    try {
      for (const folder of this.options.legacyWatchOnly?.() ?? []) {
        const key = FolderGrants.normalize(folder);
        if (key) watchOnly.add(key);
      }
    } catch {
      /* dossier par défaut introuvable sur ce poste : rien à retirer */
    }
    for (const key of legacy) {
      this.add('watch', key);
      if (!watchOnly.has(key)) this.add('write', key);
    }
    this.save();
  }

  private load(): void {
    if (!this.file) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { folders?: unknown; write?: unknown; watch?: unknown };
      if (Array.isArray(raw.write) || Array.isArray(raw.watch)) {
        for (const kind of KINDS) for (const key of keys(raw[kind])) this.granted[kind].add(key);
        return;
      }
      const legacy = keys(raw.folders);
      if (legacy.length > 0) this.legacy = legacy;
    } catch {
      /* premier lancement */
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      writeFileSync(this.file, `${JSON.stringify({ write: [...this.granted.write], watch: [...this.granted.watch] })}\n`, 'utf8');
    } catch {
      /* best-effort : l'octroi vaut pour la session en cours */
    }
  }
}

/** Les chemins valides d'une liste lue du fichier, les seize derniers. */
function keys(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list.slice(-MAX_GRANTS)) {
    const key = typeof entry === 'string' ? FolderGrants.normalize(entry) : null;
    if (key) out.push(key);
  }
  return out;
}

/**
 * Nom de fichier de sauvegarde accepté : celui que le desk écrit, `canto-vault-AAAA-MM-JJ.json`, et lui seul.
 * Tout `*.json` passait : dans le dossier du pont, accordé sans dialogue (`bridge:default-folder`), un renderer compromis
 * réécrivait `bridge.json`, donc la garde propre de l'AddOn (comptes, plafond) et le jeton qu'il attend du desk.
 */
export function isSafeBackupName(name: unknown): name is string {
  return typeof name === 'string' && /^canto-vault-\d{4}-\d{2}-\d{2}\.json$/.test(name);
}
