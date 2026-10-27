/**
 * Journal publié avec la Release, lu par le process principal.
 * `net.request` plutôt que `net.fetch` : sous Electron 43, `net.fetch` ne donne ni l'URL finale (`url` vide) ni la
 * cible d'une redirection (`redirect: 'manual'` l'annule). Ici, chaque saut est vérifié avant d'être suivi : GitHub
 * en https, trois au plus (UPD2). Sans cookie (UPD1).
 * Au-delà de 64 Ko, asset absent, redirection refusée ou schéma invalide : `null`, sans erreur visible.
 */
import { net } from 'electron';
import { CHANGELOG_MAX_BYTES, isGithubHttpsUrl, parseChangelogPayload, type ChangelogFile } from './changelog';
import { mainLog } from './main-log';
import { fetchLatestReleaseInfo } from './native-update';

/** GitHub sert un asset par une redirection vers son CDN : une suffit, trois au plus. */
export const CHANGELOG_MAX_REDIRECTS = 3;

/** GET d'un texte sur GitHub, borné à `max` octets. `null` à tout échec ; jamais d'exception. */
function getGithubText(url: string, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let hops = 0;
    const req = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit', headers: { Accept: 'application/json', 'User-Agent': 'CANTO-Desk' } });
    const finish = (text: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(text);
    };
    const stop = () => {
      if (settled) return;
      finish(null);
      try {
        req.abort();
      } catch {
        /* déjà terminée */
      }
    };
    const timer = setTimeout(stop, 12_000);
    // `redirect: 'manual'` : un saut que ce rappel ne suit pas de façon synchrone est annulé.
    req.on('redirect', (_status, _method, target) => {
      hops += 1;
      if (hops > CHANGELOG_MAX_REDIRECTS || !isGithubHttpsUrl(target)) {
        mainLog('warn', 'journal de version refusé (redirection hors de GitHub)');
        stop();
        return;
      }
      req.followRedirect();
    });
    req.on('response', (res) => {
      const raw = res.headers['content-length'];
      const announced = Array.isArray(raw) ? raw[0] : raw;
      if (res.statusCode < 200 || res.statusCode >= 300 || (announced && /^\d+$/.test(announced) && Number(announced) > max)) {
        stop();
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > max) stop();
        else chunks.push(chunk);
      });
      res.on('end', () => finish(new TextDecoder().decode(Buffer.concat(chunks))));
      res.on('error', () => finish(null));
    });
    req.on('abort', () => finish(null));
    req.on('error', () => finish(null));
    req.end();
  });
}

export async function fetchReleaseChangelog(repo: string): Promise<ChangelogFile | null> {
  const release = await fetchLatestReleaseInfo(repo);
  const asset = release?.assets.find((item) => item.name === 'changelog.json');
  if (!release || !asset || !isGithubHttpsUrl(asset.url)) return null;
  if (asset.size > CHANGELOG_MAX_BYTES) return null;
  try {
    const text = await getGithubText(asset.url, CHANGELOG_MAX_BYTES);
    if (text == null) return null;
    const doc = parseChangelogPayload(text);
    if (!doc) mainLog('info', 'journal de version indisponible (asset invalide)');
    return doc;
  } catch {
    mainLog('info', 'journal de version indisponible');
    return null;
  }
}
