import { describe, expect, it } from 'vitest';
import type { ChatMessage, StreamResult, ToolCall } from '@/engine/agent/llm';
import { runAgentTurn, TOOL_PREAMBLE, type AgentTurnDeps, type StreamRequest, type TurnRecord } from '@/engine/agent/loop';

interface Harness {
  deps: AgentTurnDeps;
  records: TurnRecord[];
  requests: StreamRequest[];
  ran: string[];
}

/** Conversation en mémoire : `replies` est consommé dans l'ordre, un élément par aller-retour. */
function harness(replies: StreamResult[], over: Partial<AgentTurnDeps> = {}): Harness {
  const history: ChatMessage[] = [{ role: 'user', content: 'Diagnostic' }];
  const records: TurnRecord[] = [];
  const requests: StreamRequest[] = [];
  const ran: string[] = [];
  const queue = [...replies];
  const deps: AgentTurnDeps = {
    system: () => 'consigne',
    history: () => history,
    tools: [{ name: 'desk_overview', description: '', parameters: {} }],
    stream: async (req) => {
      requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      const next = queue.shift();
      if (!next) throw new Error('réponse non prévue');
      req.onDelta(next.text);
      return next;
    },
    kindOf: (name) => (name.startsWith('create') ? 'write' : 'read'),
    runTool: async (call) => {
      ran.push(call.name);
      return { ok: true, name: call.name };
    },
    append: async (record) => {
      records.push(record);
      if (record.role === 'assistant') history.push({ role: 'assistant', content: record.content, toolCalls: record.toolCalls });
      else history.push({ role: 'tool', content: record.content, toolCallId: record.toolCallId, name: record.toolName });
    },
    isCurrent: () => true,
    ...over,
  };
  return { deps, records, requests, ran };
}

const call = (id: string, name: string): ToolCall => ({ id, name, args: '{}' });

describe('runAgentTurn', () => {
  it('réponse sans outil : un aller-retour, consigne système en tête', async () => {
    const h = harness([{ text: 'Bonjour', toolCalls: [] }]);
    const out = await runAgentTurn(h.deps);
    expect(out).toEqual({ rounds: 1, exhausted: false });
    expect(h.records).toEqual([{ role: 'assistant', content: 'Bonjour', toolCalls: undefined }]);
    expect(h.requests[0]?.messages[0]).toEqual({ role: 'system', content: 'consigne' });
    expect(h.requests[0]?.messages[1]).toEqual({ role: 'user', content: 'Diagnostic' });
  });

  it('un outil puis la réponse : le résultat repart au modèle avec le préambule', async () => {
    const h = harness([
      { text: '', toolCalls: [call('c1', 'desk_overview')] },
      { text: 'Synthèse', toolCalls: [] },
    ]);
    const out = await runAgentTurn(h.deps);
    expect(out).toEqual({ rounds: 2, exhausted: false });
    expect(h.ran).toEqual(['desk_overview']);
    expect(h.records.map((r) => r.role)).toEqual(['assistant', 'tool', 'assistant']);
    const tool = h.records[1];
    expect(tool?.role === 'tool' && tool.toolCallId).toBe('c1');
    expect(tool?.content.startsWith(TOOL_PREAMBLE)).toBe(true);
    const second = h.requests[1]?.messages ?? [];
    expect(second.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'c1', name: 'desk_overview' });
  });

  it('changement de conversation pendant le flux : rien n’est ajouté', async () => {
    const h = harness([{ text: 'tardif', toolCalls: [call('c1', 'desk_overview')] }], { isCurrent: () => false });
    const out = await runAgentTurn(h.deps);
    expect(out.exhausted).toBe(false);
    expect(h.records).toEqual([]);
    expect(h.ran).toEqual([]);
  });

  it('tours épuisés : le résultat le signale', async () => {
    const h = harness(
      [
        { text: '', toolCalls: [call('a', 'desk_overview')] },
        { text: '', toolCalls: [call('b', 'desk_overview')] },
      ],
      { maxRounds: 2 },
    );
    const out = await runAgentTurn(h.deps);
    expect(out).toEqual({ rounds: 2, exhausted: true });
    expect(h.ran).toEqual(['desk_overview', 'desk_overview']);
  });
});
