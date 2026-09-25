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
  /** Vrais changements de l'utilisateur : stash confirmé obligatoire. */
  user: string[];
}

export function classifyDirty(porcelain: string): DirtyState {
  const generated: string[] = [];
  const user: string[] = [];
  for (const p of porcelainPaths(porcelain)) {
    ((GENERATED_FILES as readonly string[]).includes(p) ? generated : user).push(p);
  }
  return { generated, user };
}
