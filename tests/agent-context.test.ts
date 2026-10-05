import { describe, expect, it } from 'vitest';
import { contextBudget, fitHistory, type ContextBudget } from '@/engine/agent/context';
import type { ChatMessage } from '@/engine/agent/llm';
import { TOOL_PREAMBLE } from '@/engine/agent/loop';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const ask = (...ids: string[]): ChatMessage => ({ role: 'assistant', content: '', toolCalls: ids.map((id) => ({ id, name: 'list_sessions', args: '{}' })) });
const answer = (content: string): ChatMessage => ({ role: 'assistant', content });
const result = (id: string, chars: number): ChatMessage => ({ role: 'tool', content: TOOL_PREAMBLE + 'x'.repeat(chars), toolCallId: id, name: 'list_sessions' });

const omitted = (m: ChatMessage | undefined) => m?.role === 'tool' && m.content.includes('"omitted"');

/** Aucun résultat sans son appel, aucun appel sans son résultat. */
function paired(msgs: ChatMessage[]): boolean {
  const asked = msgs.flatMap((m) => (m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.id) : []));
  const answered = msgs.flatMap((m) => (m.role === 'tool' ? [m.toolCallId] : []));
  return asked.length === answered.length && asked.every((id) => answered.includes(id));
}

/** Deux échanges anciens de ~3 000 caractères chacun, puis l'échange courant. */
function conversation(): ChatMessage[] {
  return [
    user('Q1'),
    ask('a'),
    result('a', 3000),
    answer('R1'),
    user('Q2'),
    ask('b'),
    result('b', 3000),
    answer('R2'),
    user('Q3'),
    ask('c'),
    result('c', 1000),
    ask('d'),
    result('d', 1000),
  ];
}

describe('fitHistory', () => {
  it('sous le budget : l’historique est rendu tel quel', () => {
    const h = conversation();
    expect(fitHistory(h, { historyChars: 100_000, toolResultChars: 100_000 })).toEqual(h);
  });

  it('plafonne un résultat d’outil géant et le dit', () => {
    const [, , big] = fitHistory([user('Q'), ask('a'), result('a', 50_000)], { historyChars: 100_000, toolResultChars: 2_000 });
    expect(big?.content.length).toBeLessThan(2_200);
    expect(big?.content).toMatch(/tronqué : \d+ caractères retirés/);
  });

  it('compacte d’abord les résultats des échanges précédents, le texte reste', () => {
    const fitted = fitHistory(conversation(), { historyChars: 6_000, toolResultChars: 100_000 });
    expect(fitted.length).toBe(conversation().length);
    expect(omitted(fitted[2])).toBe(true);
    expect(fitted.map((m) => m.content)).toContain('R1');
    expect(omitted(fitted[10])).toBe(false);
    expect(omitted(fitted[12])).toBe(false);
    expect(paired(fitted)).toBe(true);
  });

  it('retire ensuite les échanges précédents entiers, jamais l’échange courant', () => {
    const budget: ContextBudget = { historyChars: 2_400, toolResultChars: 100_000 };
    const fitted = fitHistory(conversation(), budget);
    expect(fitted[0]).toEqual(user('Q3'));
    expect(paired(fitted)).toBe(true);
    // Le dernier aller-retour garde son résultat entier ; l'antérieur est compacté si besoin.
    expect(omitted(fitted.at(-1))).toBe(false);
  });

  it('échange courant trop gros : seul le dernier aller-retour reste entier', () => {
    const fitted = fitHistory([user('Q'), ask('a'), result('a', 5_000), ask('b'), result('b', 5_000), ask('c'), result('c', 1_000)], { historyChars: 4_000, toolResultChars: 100_000 });
    expect(omitted(fitted[2])).toBe(true);
    expect(omitted(fitted[4])).toBe(true);
    expect(omitted(fitted[6])).toBe(false);
    expect(paired(fitted)).toBe(true);
  });

  it('ne modifie pas l’historique reçu', () => {
    const h = conversation();
    const before = JSON.stringify(h);
    fitHistory(h, { historyChars: 1_000, toolResultChars: 500 });
    expect(JSON.stringify(h)).toBe(before);
  });
});

describe('contextBudget', () => {
  it('un modèle local reçoit une fenêtre plus étroite qu’un fournisseur cloud', () => {
    const local = contextBudget('http://localhost:11434/v1');
    const cloud = contextBudget('https://api.anthropic.com');
    expect(local.historyChars).toBeLessThan(cloud.historyChars);
    expect(local.toolResultChars).toBeLessThan(cloud.toolResultChars);
    expect(contextBudget('http://127.0.0.1:1234/v1')).toEqual(local);
    expect(contextBudget('pas une url')).toEqual(cloud);
  });
});
