import { desk } from '@/lib/desk';
import { uid } from '@/lib/id';
import { type AgentConfig } from '@/store/settings';

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

export function streamChat(args: StreamArgs): Promise<StreamResult> {
  if (desk?.llm) return streamViaMain(args);
  return Promise.reject(new Error('Passerelle LLM indisponible : le shell Electron est requis.'));
}

async function streamViaMain({ config, messages, tools, onDelta, signal }: StreamArgs): Promise<StreamResult> {
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
        },
        messages,
        tools,
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
  });
}
