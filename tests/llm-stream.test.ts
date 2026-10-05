import { describe, expect, it } from 'vitest';
import { toChatHistory } from '@/engine/agent/loop';
import { AnthropicStreamParser, anthropicRequestBody, fallbackCallId, OpenAiStreamParser, openAiRequestBody } from '../electron/llm-stream';

const oaChunk = (delta: unknown) => JSON.stringify({ choices: [{ delta }] });

/** Un appel d'outil sans identifiant, en deux morceaux d'arguments, comme certains serveurs locaux. */
function openAiWithoutIds(requestId: string) {
  const p = new OpenAiStreamParser(requestId);
  const relayed = [
    p.push(oaChunk({ content: 'Je lis ' })),
    p.push(oaChunk({ content: 'le desk.' })),
    p.push(oaChunk({ tool_calls: [{ index: 0, function: { name: 'desk_overview', arguments: '{"a"' } }] })),
    p.push(oaChunk({ tool_calls: [{ index: 0, function: { arguments: ':1}' } }] })),
    p.push('[DONE]'),
  ];
  return { relayed, result: p.result() };
}

describe('flux OpenAI-compatible', () => {
  it('relaie le texte et assemble les arguments', () => {
    const { relayed, result } = openAiWithoutIds('llm_A');
    expect(relayed.filter(Boolean)).toEqual(['Je lis ', 'le desk.']);
    expect(result.text).toBe('Je lis le desk.');
    expect(result.toolCalls).toEqual([{ id: 'call_llm_A_0', name: 'desk_overview', args: '{"a":1}' }]);
  });

  it('sans identifiant du fournisseur : deux requêtes ne donnent jamais le même appel', () => {
    const first = openAiWithoutIds('llm_A').result.toolCalls[0]?.id;
    const second = openAiWithoutIds('llm_B').result.toolCalls[0]?.id;
    expect(first).not.toBe(second);
  });

  it('garde l’identifiant du fournisseur quand il existe', () => {
    const p = new OpenAiStreamParser('llm_A');
    p.push(oaChunk({ tool_calls: [{ index: 0, id: 'call_xyz', function: { name: 'list_sessions', arguments: '{}' } }] }));
    expect(p.result().toolCalls[0]?.id).toBe('call_xyz');
  });

  it('ignore une ligne illisible', () => {
    const p = new OpenAiStreamParser('llm_A');
    expect(p.push('{pas du json')).toBe('');
    expect(p.result()).toEqual({ text: '', toolCalls: [] });
  });
});

describe('flux Anthropic', () => {
  it('assemble un tool_use, arguments vides → {}', () => {
    const p = new AnthropicStreamParser('llm_C');
    p.push(JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }));
    expect(p.push(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Analyse' } }))).toBe('Analyse');
    p.push(JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'desk_overview' } }));
    p.push(JSON.stringify({ type: 'content_block_stop', index: 1 }));
    expect(p.result()).toEqual({ text: 'Analyse', toolCalls: [{ id: 'toolu_llm_C_1', name: 'desk_overview', args: '{}' }] });
  });

  it('un événement error lève', () => {
    const p = new AnthropicStreamParser('llm_C');
    expect(() => p.push(JSON.stringify({ type: 'error', error: { message: 'overloaded' } }))).toThrow('overloaded');
  });

  it('identifiant de repli : seuls lettres, chiffres, _ et - passent', () => {
    expect(fallbackCallId('toolu', 'llm:<x>', 2)).toBe('toolu_llmx_2');
  });
});

describe('historique de la conversation', () => {
  it('le message outil répond à toolCallId ; deux tours peuvent répondre au même identifiant de fournisseur', () => {
    const chat = toChatHistory([
      { id: 'm1', role: 'assistant', content: '', toolCalls: [{ id: 'call_0', name: 'desk_overview', args: '{}' }] },
      { id: 'm2', role: 'tool', content: 'r1', toolCallId: 'call_0', toolName: 'desk_overview' },
      { id: 'm3', role: 'assistant', content: '', toolCalls: [{ id: 'call_0', name: 'list_sessions', args: '{}' }] },
      { id: 'm4', role: 'tool', content: 'r2', toolCallId: 'call_0', toolName: 'list_sessions' },
    ]);
    expect(chat.filter((m) => m.role === 'tool')).toEqual([
      { role: 'tool', content: 'r1', toolCallId: 'call_0', name: 'desk_overview' },
      { role: 'tool', content: 'r2', toolCallId: 'call_0', name: 'list_sessions' },
    ]);
  });

  it('conversation enregistrée en 3.3.4 : l’id du message tient lieu d’identifiant d’appel', () => {
    const chat = toChatHistory([{ id: 'call_legacy', role: 'tool', content: 'r', toolName: 'desk_overview' }]);
    expect(chat).toEqual([{ role: 'tool', content: 'r', toolCallId: 'call_legacy', name: 'desk_overview' }]);
  });
});

describe('corps des requêtes', () => {
  const tools = [{ name: 'desk_overview', description: 'vue', parameters: { type: 'object', properties: {} } }];
  const messages = [
    { role: 'system', content: 'consigne' },
    { role: 'user', content: 'Diagnostic' },
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'desk_overview', args: '{}' }, { id: 't2', name: 'desk_overview', args: 'pas du json' }] },
    { role: 'tool', content: 'r1', toolCallId: 't1', name: 'desk_overview' },
    { role: 'tool', content: 'r2', toolCallId: 't2', name: 'desk_overview' },
  ];

  it('OpenAI : tool_choice none seulement avec des outils', () => {
    expect(openAiRequestBody({ model: 'm', temperature: 0.3, messages, tools, toolChoice: 'none' }).tool_choice).toBe('none');
    expect(openAiRequestBody({ model: 'm', temperature: 0.3, messages, tools, toolChoice: 'auto' })).not.toHaveProperty('tool_choice');
    expect(openAiRequestBody({ model: 'm', temperature: 0.3, messages, tools: [], toolChoice: 'none' })).not.toHaveProperty('tool_choice');
  });

  it('OpenAI : appels et résultats gardent leurs identifiants', () => {
    const body = openAiRequestBody({ model: 'm', temperature: 0.3, messages, tools });
    const sent = body.messages as { role: string; tool_calls?: { id: string }[]; tool_call_id?: string }[];
    expect(sent[2]?.tool_calls?.map((c) => c.id)).toEqual(['t1', 't2']);
    expect(sent.slice(3).map((m) => m.tool_call_id)).toEqual(['t1', 't2']);
  });

  it('Anthropic : tool_choice { type: none }, consigne à part, résultats réunis dans un seul tour user', () => {
    const body = anthropicRequestBody({ model: 'm', temperature: 1.4, messages, tools, toolChoice: 'none' });
    expect(body.tool_choice).toEqual({ type: 'none' });
    expect(body.system).toBe('consigne');
    expect(body.temperature).toBe(1);
    const sent = body.messages as { role: string; content: unknown }[];
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const assistant = sent[1]?.content as { type: string; input?: unknown }[];
    expect(assistant.map((b) => b.input)).toEqual([{}, {}]);
    expect((sent[2]?.content as { tool_use_id: string }[]).map((b) => b.tool_use_id)).toEqual(['t1', 't2']);
    expect(anthropicRequestBody({ model: 'm', temperature: 0.3, messages, tools })).not.toHaveProperty('tool_choice');
  });
});
