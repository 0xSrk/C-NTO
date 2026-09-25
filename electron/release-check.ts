/**
 * Contrôle de version de la voie « installeur » (sans `.git`).
 *
 * On lit la dernière Release GitHub publiée, pas `package.json` sur `main` : le numéro de
 * `main` peut avancer avant qu'un installeur soit publié, et l'utilisateur d'un binaire
 * serait envoyé vers une page de versions qui ne contient pas encore la version annoncée.
 */
export interface ReleaseInfo {
  version: string;
  url: string;
}

/** Extrait la version d'une réponse `releases/latest` (tag `v2.0.0` → `2.0.0`). */
export function parseLatestRelease(body: unknown): ReleaseInfo | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
  if (r.draft === true || r.prerelease === true) return null;
  if (typeof r.tag_name !== 'string') return null;
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(r.tag_name.trim());
  if (!m || !m[1]) return null;
  const url = typeof r.html_url === 'string' && r.html_url.startsWith('https://github.com/') ? r.html_url : '';
  return { version: m[1], url };
}
