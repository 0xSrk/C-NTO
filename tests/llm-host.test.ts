import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LLM_HOSTS, llmHostAllowed, probeProvider, streamChat } from '@/engine/agent/llm';
import { llmFetch, llmHostOk } from '../electron/llm-host';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

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

describe('redirections des fournisseurs LLM', () => {
  it('une redirection vers un autre hôte est refusée : ni la clé ni le corps n’y arrivent', async () => {
    const received: { auth?: string; apiKey?: string; body: string }[] = [];
    const second = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ auth: req.headers.authorization, apiKey: req.headers['x-api-key'] as string | undefined, body });
        res.end('{"data":[]}');
      });
    });
    const secondPort = await listen(second);
    let status = 307;
    const first = http.createServer((_req, res) => {
      res.writeHead(status, { Location: `http://127.0.0.1:${secondPort}/v1/chat/completions` });
      res.end();
    });
    const firstPort = await listen(first);
    const refusal = (code: number, target: string) => `redirection refusée ${code} ${target}`;
    try {
      for (status of [307, 308, 301, 302]) {
        await expect(
          llmFetch(
            `http://127.0.0.1:${firstPort}/v1/chat/completions`,
            { method: 'POST', headers: { Authorization: 'Bearer sk-test', 'x-api-key': 'sk-test' }, body: '{"messages":[{"role":"user","content":"séances du desk"}]}' },
            refusal,
          ),
        ).rejects.toThrow(`redirection refusée ${status} 127.0.0.1:${secondPort}`);
      }
      expect(received).toEqual([]);
      // Sans redirection, la réponse passe telle quelle.
      const ok = await llmFetch(`http://127.0.0.1:${secondPort}/v1/models`, { headers: { Authorization: 'Bearer sk-test' } }, refusal);
      expect(ok.status).toBe(200);
      expect(received).toHaveLength(1);
    } finally {
      first.close();
      second.close();
    }
  });
});
