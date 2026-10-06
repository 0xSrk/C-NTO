import { desk } from '@/lib/desk';
import { uid } from '@/lib/id';
import type { AgentConfig } from '@/store/settings';

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export interface StreamResult {
  text: string;
  toolCalls: ToolCall[];
}

interface StreamArgs {
  config: AgentConfig;
  messages: ChatMessage[];
  tools: ToolSchema[];
  /** `none` : réponse sans appel d'outil (dernier tour de la boucle). */
  toolChoice?: 'auto' | 'none';
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

export const DEFAULT_LLM_HOSTS = ['127.0.0.1', 'localhost', '::1', 'api.openai.com', 'api.anthropic.com', 'openrouter.ai', 'api.moonshot.ai'] as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** Pré-contrôle renderer. L'hôte réel est réévalué dans le main (`llmHostOk`), qui ignore `extra`. */
export function llmHostAllowed(baseUrl: string, extra: string[] = []): boolean {
  void extra;
  try {
    const u = new URL(baseUrl);
    const host = u.hostname.toLowerCase();
    if (LOOPBACK_HOSTS.has(host)) {
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    } else if (u.protocol !== 'https:') {
      return false;
    }
    return (DEFAULT_LLM_HOSTS as readonly string[]).includes(host);
  } catch {
    return false;
  }
}

/** Hôte (et port) auquel une clé API est liée. Miroir de `llmKeyHost` du process principal. */
export function llmKeyHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Pré-contrôle renderer, miroir de `keyFor` (`electron/llm-host.ts`) : la clé n'est envoyée qu'à l'hôte
 * pour lequel elle a été saisie. Sans hôte enregistré (coffre ancien), elle suit l'URL de base courante.
 */
export function llmKeyBound(baseUrl: string, keyHost: unknown): boolean {
  const host = llmKeyHost(baseUrl);
  if (!host) return false;
  if (keyHost === undefined || keyHost === null) return true;
  return typeof keyHost === 'string' && keyHost.toLowerCase() === host;
}

export function streamChat(args: StreamArgs): Promise<StreamResult> {
  if (desk?.llm) return streamViaMain(args);
  return Promise.reject(new Error('Passerelle LLM indisponible : le shell Electron est requis.'));
}

async function streamViaMain({ config, messages, tools, toolChoice, onDelta, signal }: StreamArgs): Promise<StreamResult> {
  const api = desk?.llm;
  if (!api) throw new Error('Passerelle LLM indisponible : le shell Electron est requis.');
  const requestId = uid('llm');
  return new Promise((resolve, reject) => {
    const stop = () => {
      unsubDelta();
      unsubDone();
      unsubErr();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      api.abort(requestId);
      stop();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const unsubDelta = api.onDelta((p) => {
      if (p.requestId === requestId) onDelta(p.text);
    });
    const unsubDone = api.onDone((p) => {
      if (p.requestId !== requestId) return;
      stop();
      resolve(p.result);
    });
    const unsubErr = api.onError((p) => {
      if (p.requestId !== requestId) return;
      stop();
      reject(new Error(p.error));
    });
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    void api
      .start({
        requestId,
        config: {
          provider: config.provider,
          baseUrl: config.baseUrl,
          model: config.model,
          temperature: config.temperature,
          apiKeyEncrypted: config.apiKeyEncrypted,
          apiKeyHost: config.apiKeyHost,
        },
        messages,
        tools,
        ...(toolChoice === 'none' ? { toolChoice } : {}),
      })
      .catch((e) => {
        stop();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

/** Vérifie la joignabilité du fournisseur (liste des modèles pour OpenAI-compatible). */
export async function probeProvider(config: AgentConfig): Promise<{ ok: boolean; detail: string; models?: string[] }> {
  if (!desk?.llm) return { ok: false, detail: 'Passerelle LLM indisponible : le shell Electron est requis.' };
  return desk.llm.probe({
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    apiKeyEncrypted: config.apiKeyEncrypted,
    apiKeyHost: config.apiKeyHost,
  });
}
