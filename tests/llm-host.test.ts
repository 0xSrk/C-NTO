import { describe, expect, it } from 'vitest';
import { DEFAULT_LLM_HOSTS, llmHostAllowed } from '@/engine/agent/llm';

describe('hôtes LLM', () => {
  it('autorise la liste courte y compris api.moonshot.ai', () => {
    expect(DEFAULT_LLM_HOSTS).toContain('api.moonshot.ai');
    expect(llmHostAllowed('https://api.moonshot.ai/v1')).toBe(true);
    expect(llmHostAllowed('https://api.openai.com/v1')).toBe(true);
    expect(llmHostAllowed('http://127.0.0.1:11434/v1')).toBe(true);
    expect(llmHostAllowed('https://evil.example/v1')).toBe(false);
  });
});
