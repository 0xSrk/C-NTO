/** Hôtes LLM épinglés dans le process main. Le payload IPC ne peut pas élargir la liste. */
const LLM_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', 'api.openai.com', 'api.anthropic.com', 'openrouter.ai', 'api.moonshot.ai']);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * `extra` est ignoré : un renderer compromis ne choisit pas l'hôte.
 * `https:` est obligatoire hors loopback.
 */
export function llmHostOk(baseUrl: string, extra?: unknown): boolean {
  void extra;
  try {
    const u = new URL(baseUrl);
    const host = u.hostname.toLowerCase();
    if (LOOPBACK.has(host)) {
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    } else if (u.protocol !== 'https:') {
      return false;
    }
    return LLM_HOSTS.has(host);
  } catch {
    return false;
  }
}

/** Hôte (et port) d'une URL de base, en minuscules : celui auquel une clé API est liée. '' si illisible. */
export function llmKeyHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * La clé part-elle vers `baseUrl` ? Seulement vers l'hôte pour lequel elle a été saisie (`keyHost`),
 * jamais vers un autre fournisseur ni vers un serveur local. Sans hôte enregistré (coffre ancien), elle
 * suit l'URL de base courante, comme avant.
 */
export function keyFor(baseUrl: string, keyHost: unknown): boolean {
  const host = llmKeyHost(baseUrl);
  if (!host) return false;
  if (keyHost === undefined || keyHost === null) return true;
  return typeof keyHost === 'string' && keyHost.toLowerCase() === host;
}

/** Serveur LLM local : il peut répondre sans clé. */
export function llmLoopback(baseUrl: string): boolean {
  try {
    return LOOPBACK.has(new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Appel au fournisseur LLM, sans suivre de redirection : un 307/308 renverrait la clé (`Authorization`,
 * `x-api-key`) et le corps (données du desk) vers un hôte hors de la liste épinglée. Toute réponse 3xx
 * est refusée ; `refusal` rend le message (statut, hôte visé).
 */
export async function llmFetch(url: string, init: RequestInit, refusal: (status: number, target: string) => string, fetchImpl: FetchLike = fetch): Promise<Response> {
  const res = await fetchImpl(url, { ...init, redirect: 'manual' });
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    await res.body?.cancel().catch(() => undefined);
    const location = res.headers.get('location');
    let target = '';
    try {
      if (location) target = new URL(location, url).host;
    } catch {
      /* Location illisible */
    }
    throw new Error(refusal(res.status, target));
  }
  return res;
}
