/**
 * Tri des changements locaux avant une mise à jour git.
 *
 * `npm install --legacy-peer-deps` (première installation via CANTO.cmd, puis après
 * chaque mise à jour) réécrit `package-lock.json` : le clone paraissait alors modifié
 * et le lanceur refusait toute mise à jour. Ce fichier est régénéré par l'outillage,
 * jamais édité à la main : on le restaure au lieu de bloquer.
 */
export const GENERATED_FILES = ['package-lock.json'] as const;

/** Chemins touchés d'après `git status --porcelain` (renommage : les deux côtés). */
export function porcelainPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.trim().length < 4) continue;
    const rest = line.slice(3).trim();
    for (const part of rest.split(' -> ')) paths.push(part.replace(/^"|"$/g, ''));
  }
  return paths;
}

export interface DirtyState {
  /** Fichiers générés modifiés, à restaurer sans demander. */
  generated: string[];
  /** Fichiers suivis modifiés par l'utilisateur : stash confirmé obligatoire. */
  user: string[];
  /**
   * Fichiers non suivis (capture, export, note posée dans le dossier) : ils ne bloquent
   * pas un `git pull`, sauf collision avec un fichier entrant — git le signale alors lui-même.
   */
  untracked: string[];
}

export function classifyDirty(porcelain: string): DirtyState {
  const state: DirtyState = { generated: [], user: [], untracked: [] };
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.trim().length < 4) continue;
    const bucket = line.startsWith('??') ? state.untracked : null;
    for (const p of porcelainPaths(line)) {
      if (bucket) bucket.push(p);
      else ((GENERATED_FILES as readonly string[]).includes(p) ? state.generated : state.user).push(p);
    }
  }
  return state;
}

/** Résumé court pour l'interface : trois chemins, puis « +N ». */
export function summarizePaths(paths: readonly string[], max = 3): string {
  const head = paths.slice(0, max).join(', ');
  return paths.length > max ? `${head} +${paths.length - max}` : head;
}
