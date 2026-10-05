/**
 * Lecture des flux SSE des fournisseurs LLM, sans Electron ni réseau : le process main pousse
 * chaque ligne `data:` et relaie le texte rendu au renderer.
 */

export interface StreamedCall {
  id: string;
  name: string;
  args: string;
}

export interface StreamOutcome {
  text: string;
  toolCalls: StreamedCall[];
}

/**
 * Identifiant d'appel quand le fournisseur n'en donne pas. Il porte la requête : deux tours de la
 * même conversation ne produisent jamais le même identifiant.
 */
export function fallbackCallId(prefix: 'call' | 'toolu', requestId: string, index: number): string {
  const safe = requestId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'req';
  return `${prefix}_${safe}_${index}`;
}

/** Flux `chat/completions` (OpenAI et compatibles). */
export class OpenAiStreamParser {
  private text = '';
  private readonly calls = new Map<number, StreamedCall>();

  constructor(private readonly requestId: string) {}

  /** Rend le texte à relayer ('' si la ligne n'en porte pas). */
  push(data: string): string {
    if (!data || data === '[DONE]') return '';
    let json: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
    try {
      json = JSON.parse(data);
    } catch {
      return '';
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return '';
    for (const tc of delta.tool_calls ?? []) {
      const cur = this.calls.get(tc.index) ?? { id: tc.id || fallbackCallId('call', this.requestId, tc.index), name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      this.calls.set(tc.index, cur);
    }
    if (!delta.content) return '';
    this.text += delta.content;
    return delta.content;
  }

  result(): StreamOutcome {
    return { text: this.text, toolCalls: [...this.calls.values()].filter((c) => c.name) };
  }
}

/** Flux `v1/messages` d'Anthropic. Un événement `error` lève. */
export class AnthropicStreamParser {
  private text = '';
  private readonly calls: StreamedCall[] = [];
  private readonly blocks = new Map<number, StreamedCall>();

  constructor(
    private readonly requestId: string,
    private readonly streamErrorText = 'Erreur du fournisseur pendant le flux',
  ) {}

  push(data: string): string {
    if (!data) return '';
    let ev: { type: string; index?: number; content_block?: { type: string; id?: string; name?: string }; delta?: { type: string; text?: string; partial_json?: string }; error?: { message?: string } };
    try {
      ev = JSON.parse(data);
    } catch {
      return '';
    }
    if (ev.type === 'error') throw new Error(ev.error?.message ?? this.streamErrorText);
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use' && ev.index !== undefined) {
      this.blocks.set(ev.index, { id: ev.content_block.id || fallbackCallId('toolu', this.requestId, ev.index), name: ev.content_block.name ?? '', args: '' });
    } else if (ev.type === 'content_block_delta' && ev.delta) {
      if (ev.delta.type === 'text_delta' && ev.delta.text) {
        this.text += ev.delta.text;
        return ev.delta.text;
      }
      if (ev.delta.type === 'input_json_delta' && ev.index !== undefined) {
        const b = this.blocks.get(ev.index);
        if (b) b.args += ev.delta.partial_json ?? '';
      }
    } else if (ev.type === 'content_block_stop' && ev.index !== undefined) {
      const b = this.blocks.get(ev.index);
      if (b) {
        this.calls.push({ ...b, args: b.args || '{}' });
        this.blocks.delete(ev.index);
      }
    }
    return '';
  }

  result(): StreamOutcome {
    return { text: this.text, toolCalls: [...this.calls] };
  }
}

/** Message tel que le renderer l'envoie (`ChatMessage` de src/engine/agent/llm.ts). */
interface WireMessage {
  role?: string;
  content?: string;
  toolCalls?: StreamedCall[];
  toolCallId?: string;
  name?: string;
}

interface WireTool {
  name: string;
  description: string;
  parameters: unknown;
}

export type ToolChoice = 'auto' | 'none';

export interface RequestInput {
  model: string;
  temperature: number;
  messages: unknown[];
  tools: unknown[];
  /** `none` : le modèle doit répondre sans appeler d'outil (dernier tour de la boucle). */
  toolChoice?: ToolChoice;
}

/** Corps `chat/completions`. `tool_choice` n'est envoyé qu'avec des outils (OpenAI le refuse seul). */
export function openAiRequestBody({ model, temperature, messages, tools, toolChoice }: RequestInput): Record<string, unknown> {
  const oaMessages = (messages as WireMessage[]).map((m) => {
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
  const body: Record<string, unknown> = { model, messages: oaMessages, stream: true, temperature };
  if (tools.length) {
    body.tools = (tools as WireTool[]).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    if (toolChoice === 'none') body.tool_choice = 'none';
  }
  return body;
}

/** Corps `v1/messages`. Les résultats d'outils consécutifs partagent un seul tour `user`. */
export function anthropicRequestBody({ model, temperature, messages, tools, toolChoice }: RequestInput): Record<string, unknown> {
  const msgs = messages as WireMessage[];
  const system = msgs.find((m) => m.role === 'system')?.content;
  const converted: { role: 'user' | 'assistant'; content: unknown }[] = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'user') converted.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
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
      converted.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] });
    } else {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = converted[converted.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block);
      else converted.push({ role: 'user', content: [block] });
    }
  }
  const body: Record<string, unknown> = { model, max_tokens: 4096, stream: true, temperature: Math.max(0, Math.min(1, temperature)), messages: converted };
  if (system) body.system = system;
  if (tools.length) {
    body.tools = (tools as WireTool[]).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    if (toolChoice === 'none') body.tool_choice = { type: 'none' };
  }
  return body;
}
