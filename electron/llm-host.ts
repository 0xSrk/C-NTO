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
