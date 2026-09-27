/**
 * Journal publié avec la Release, lu par le process principal.
 * Même chemin que l'installeur : `net.fetch`, hôte GitHub en https, redirections suivies.
 * Au-delà de 64 Ko, asset absent ou schéma invalide : `null`, sans erreur visible.
 */
import { net } from 'electron';
import { CHANGELOG_MAX_BYTES, isGithubHttpsUrl, parseChangelogPayload, type ChangelogFile } from './changelog';
import { mainLog } from './main-log';
import { fetchLatestReleaseInfo } from './native-update';

async function readCappedText(body: ReadableStream<Uint8Array>, max: number, contentLength: number | null): Promise<string | null> {
  if (contentLength != null && contentLength > max) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const value = step.value;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export async function fetchReleaseChangelog(repo: string): Promise<ChangelogFile | null> {
  const release = await fetchLatestReleaseInfo(repo);
  const asset = release?.assets.find((item) => item.name === 'changelog.json');
  if (!release || !asset || !isGithubHttpsUrl(asset.url)) return null;
  if (asset.size > CHANGELOG_MAX_BYTES) return null;
  try {
    const res = await net.fetch(asset.url, {
      headers: { Accept: 'application/json', 'User-Agent': 'CANTO-Desk' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok || !res.body) return null;
    if (res.url && !isGithubHttpsUrl(res.url)) return null;
    const rawLen = res.headers.get('content-length');
    const contentLength = rawLen && /^\d+$/.test(rawLen) ? Number(rawLen) : null;
    const text = await readCappedText(res.body, CHANGELOG_MAX_BYTES, contentLength);
    if (text == null) return null;
    const doc = parseChangelogPayload(text);
    if (!doc) mainLog('info', 'journal de version indisponible (asset invalide)');
    return doc;
  } catch {
    mainLog('info', 'journal de version indisponible');
    return null;
  }
}
