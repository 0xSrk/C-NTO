import { desk } from '@/lib/desk';
import { uid } from '@/lib/id';
import { useSettings, type AgentConfig } from '@/store/settings';

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

export const DEFAULT_LLM_HOSTS = ['127.0.0.1', 'localhost', 'api.openai.com', 'api.anthropic.com', 'openrouter.ai', 'api.moonshot.ai'] as const;

export function llmHostAllowed(baseUrl: string, extra: string[] = []): boolean {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    const allowed = new Set<string>([...DEFAULT_LLM_HOSTS, ...extra.map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h))]);
    return allowed.has(host);
  } catch {
    return false;
  }
}

async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buffer.startsWith('data:')) yield buffer.slice(5).trim();
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return j.error?.message ?? j.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || res.statusText;
  }
}

/* ─── OpenAI-compatible (Ollama, LM Studio, vLLM, OpenAI, OpenRouter…) ─── */

function toOpenAiMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls?.length ? m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })) : undefined,
      };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    return { role: m.role, content: m.content };
  });
}

async function streamOpenAi({ config, messages, tools, onDelta, signal }: StreamArgs): Promise<StreamResult> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toOpenAiMessages(messages),
    stream: true,
    temperature: config.temperature,
  };
  if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const res = await fetch(joinUrl(config.baseUrl, 'chat/completions'), { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`${res.status} — ${await readError(res)}`);

  let text = '';
  const calls = new Map<number, ToolCall>();
  for await (const data of sseLines(res, signal)) {
    if (!data || data === '[DONE]') continue;
    let json: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      text += delta.content;
      onDelta(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const cur = calls.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}`, name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      calls.set(tc.index, cur);
    }
  }
  return { text, toolCalls: [...calls.values()].filter((c) => c.name) };
}

/* ─── Anthropic Messages API ─── */

function toAnthropicMessages(messages: ChatMessage[]) {
  const out: { role: 'user' | 'assistant'; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = tc.args ? JSON.parse(tc.args) : {};
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] });
    } else {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

async function streamAnthropic({ config, messages, tools, onDelta, signal }: StreamArgs): Promise<StreamResult> {
  const system = messages.find((m) => m.role === 'system')?.content;
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: 4096,
    stream: true,
    temperature: Math.max(0, Math.min(1, config.temperature)),
    messages: toAnthropicMessages(messages),
  };
  if (system) body.system = system;
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const res = await fetch(joinUrl(config.baseUrl, 'v1/messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${res.status} — ${await readError(res)}`);

  let text = '';
  const calls: ToolCall[] = [];
  const blocks = new Map<number, ToolCall>();
  for await (const data of sseLines(res, signal)) {
    if (!data) continue;
    let ev: { type: string; index?: number; content_block?: { type: string; id?: string; name?: string }; delta?: { type: string; text?: string; partial_json?: string } };
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    if (ev.type === 'error') {
      const err = (ev as unknown as { error?: { message?: string } }).error;
      throw new Error(err?.message ?? 'Erreur du fournisseur pendant le flux');
    }
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use' && ev.index !== undefined) {
      blocks.set(ev.index, { id: ev.content_block.id ?? `toolu_${ev.index}`, name: ev.content_block.name ?? '', args: '' });
    } else if (ev.type === 'content_block_delta' && ev.delta) {
      if (ev.delta.type === 'text_delta' && ev.delta.text) {
        text += ev.delta.text;
        onDelta(ev.delta.text);
      } else if (ev.delta.type === 'input_json_delta' && ev.index !== undefined) {
        const b = blocks.get(ev.index);
        if (b) b.args += ev.delta.partial_json ?? '';
      }
    } else if (ev.type === 'content_block_stop' && ev.index !== undefined) {
      const b = blocks.get(ev.index);
      if (b) {
        calls.push({ ...b, args: b.args || '{}' });
        blocks.delete(ev.index);
      }
    }
  }
  return { text, toolCalls: calls };
}

export function streamChat(args: StreamArgs): Promise<StreamResult> {
  if (desk?.llm) return streamViaMain(args);
  if (!llmHostAllowed(args.config.baseUrl)) return Promise.reject(new Error('Hôte LLM non autorisé.'));
  return args.config.provider === 'anthropic' ? streamAnthropic(args) : streamOpenAi(args);
}

async function streamViaMain({ config, messages, tools, onDelta, signal }: StreamArgs): Promise<StreamResult> {
  const api = desk?.llm;
  if (!api) throw new Error('Passerelle LLM indisponible');
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
        allowedHosts: useSettings.getState().settings.llmAllowedHosts,
      })
      .catch((e) => {
        stop();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

/** Vérifie la joignabilité du fournisseur (liste des modèles pour OpenAI-compatible). */
export async function probeProvider(config: AgentConfig): Promise<{ ok: boolean; detail: string; models?: string[] }> {
  if (desk?.llm) {
    return desk.llm.probe({
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: config.temperature,
      apiKeyEncrypted: config.apiKeyEncrypted,
      allowedHosts: useSettings.getState().settings.llmAllowedHosts,
    });
  }
  try {
    if (!llmHostAllowed(config.baseUrl)) return { ok: false, detail: 'Hôte LLM non autorisé.' };
    if (config.provider === 'anthropic') {
      if (!config.apiKey) return { ok: false, detail: 'Clé API requise.' };
      const res = await fetch(joinUrl(config.baseUrl, 'v1/models'), { headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' } });
      if (!res.ok) return { ok: false, detail: `${res.status} — ${await readError(res)}` };
      const j = (await res.json()) as { data?: { id: string }[] };
      return { ok: true, detail: `${j.data?.length ?? 0} modèle(s) disponibles`, models: j.data?.map((m) => m.id) };
    }
    const headers: Record<string, string> = {};
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const res = await fetch(joinUrl(config.baseUrl, 'models'), { headers });
    if (!res.ok) return { ok: false, detail: `${res.status} — ${await readError(res)}` };
    const j = (await res.json()) as { data?: { id: string }[] };
    const models = j.data?.map((m) => m.id) ?? [];
    return { ok: true, detail: `${models.length} modèle(s) disponibles`, models };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
