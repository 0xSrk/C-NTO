import { describe, expect, it } from 'vitest';
import { DEFAULT_LLM_HOSTS, llmHostAllowed, probeProvider, streamChat } from '@/engine/agent/llm';
import { llmHostOk } from '../electron/llm-host';

describe('hôtes LLM', () => {
  it('autorise la liste courte y compris api.moonshot.ai', () => {
    expect(DEFAULT_LLM_HOSTS).toContain('api.moonshot.ai');
    expect(llmHostAllowed('https://api.moonshot.ai/v1')).toBe(true);
    expect(llmHostAllowed('https://api.openai.com/v1')).toBe(true);
    expect(llmHostAllowed('http://127.0.0.1:11434/v1')).toBe(true);
    expect(llmHostAllowed('https://evil.example/v1')).toBe(false);
    expect(llmHostAllowed('http://api.openai.com/v1')).toBe(false);
    expect(llmHostAllowed('https://evil.example/v1', ['evil.example'])).toBe(false);
    expect(llmHostOk('https://evil.example/v1', ['evil.example'])).toBe(false);
    expect(llmHostOk('http://api.openai.com/v1')).toBe(false);
    expect(llmHostOk('https://api.openai.com/v1')).toBe(true);
    expect(llmHostOk('http://127.0.0.1:11434/v1', ['evil.example'])).toBe(true);
  });

  it('refuse le fetch renderer hors shell Electron', async () => {
    const r = await probeProvider({
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'llama3.1',
      apiKey: 'sk-test',
      systemPrompt: '',
      temperature: 0.2,
      toolsEnabled: false,
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Electron/);
    await expect(
      streamChat({
        config: {
          provider: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:11434/v1',
          model: 'llama3.1',
          apiKey: 'sk-test',
          systemPrompt: '',
          temperature: 0.2,
          toolsEnabled: false,
        },
        messages: [],
        tools: [],
        onDelta: () => undefined,
      }),
    ).rejects.toThrow(/Electron/);
  });
});
