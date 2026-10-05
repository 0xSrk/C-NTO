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
