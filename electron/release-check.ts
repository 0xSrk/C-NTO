/**
 * Contrôle de version de la voie « installeur » (sans `.git`).
 *
 * On lit la dernière Release GitHub publiée, pas `package.json` sur `main` : le numéro de
 * `main` peut avancer avant qu'un installeur soit publié, et l'utilisateur d'un binaire
 * serait envoyé vers une page de versions qui ne contient pas encore la version annoncée.
 */
export interface ReleaseAsset {
  name: string;
  /** URL de téléchargement GitHub (https uniquement). */
  url: string;
  size: number;
}

export interface ReleaseInfo {
  version: string;
  url: string;
  assets: ReleaseAsset[];
}

/** Extrait la version d'une réponse `releases/latest` (tag `v2.0.0` → `2.0.0`). */
export function parseLatestRelease(body: unknown): ReleaseInfo | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  if (r.draft === true || r.prerelease === true) return null;
  if (typeof r.tag_name !== 'string') return null;
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(r.tag_name.trim());
  if (!m || !m[1]) return null;
  const url = typeof r.html_url === 'string' && r.html_url.startsWith('https://github.com/') ? r.html_url : '';
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(r.assets)) {
    for (const raw of r.assets) {
      const x = raw as { name?: unknown; browser_download_url?: unknown; size?: unknown };
      if (typeof x.name !== 'string' || typeof x.browser_download_url !== 'string') continue;
      if (!x.browser_download_url.startsWith('https://github.com/')) continue;
      assets.push({ name: x.name, url: x.browser_download_url, size: typeof x.size === 'number' ? x.size : 0 });
    }
  }
  return { version: m[1], url, assets };
}

export type InstallKind = 'nsis' | 'dmg' | 'appimage' | 'deb';

/**
 * Installeur de la release adapté à ce poste (noms produits par electron-builder, cf. package.json) :
 * Windows `-win-<arch>-setup.exe` (puis le setup universel), macOS `-mac-universal.dmg`,
 * Linux AppImage si l'app tourne en AppImage, sinon `.deb`.
 */
export function pickInstallerAsset(
  assets: readonly ReleaseAsset[],
  env: { platform: string; arch: string; appImage?: boolean },
): { asset: ReleaseAsset; kind: InstallKind } | null {
  const find = (suffix: string) => assets.find((a) => a.name.endsWith(suffix));
  const hit = (asset: ReleaseAsset | undefined, kind: InstallKind) => (asset ? { asset, kind } : null);
  if (env.platform === 'win32') {
    const arch = env.arch === 'arm64' ? 'arm64' : 'x64';
    return hit(find(`-win-${arch}-setup.exe`) ?? find('-win-setup.exe'), 'nsis');
  }
  if (env.platform === 'darwin') return hit(find('-mac-universal.dmg'), 'dmg');
  if (env.platform === 'linux') {
    if (env.appImage) return hit(find(`-linux-${env.arch === 'arm64' ? 'arm64' : 'x86_64'}.AppImage`), 'appimage');
    return hit(find(`-linux-${env.arch === 'arm64' ? 'arm64' : 'amd64'}.deb`), 'deb');
  }
  return null;
}

/** Lit `SHA256SUMS.txt` (sortie de sha256sum : « <hash>  ./<fichier> »). */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(?:\.\/)?(.+?)\s*$/i.exec(line.trim());
    if (m && m[1] && m[2]) sums.set(m[2], m[1].toLowerCase());
  }
  return sums;
}
