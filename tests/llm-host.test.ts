import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LLM_HOSTS, llmHostAllowed, llmKeyBound, probeProvider, streamChat } from '@/engine/agent/llm';
import { keyFor, llmFetch, llmHostOk, llmKeyHost, llmLoopback } from '../electron/llm-host';

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

describe('clé API liée à son hôte', () => {
  const cases: [string, unknown, boolean][] = [
    ['https://api.openai.com/v1', 'api.openai.com', true],
    ['https://API.OpenAI.com/v1/', 'api.openai.com', true],
    ['https://openrouter.ai/api/v1', 'api.openai.com', false],
    ['https://api.anthropic.com', 'api.openai.com', false],
    // Clé OpenAI vers un serveur local en HTTP clair : non.
    ['http://localhost:11434/v1', 'api.openai.com', false],
    // Le port compte : une clé saisie pour LM Studio ne part pas vers Ollama.
    ['http://localhost:11434/v1', 'localhost:1234', false],
    ['http://localhost:1234/v1', 'localhost:1234', true],
    // Coffre ancien, sans le champ : la clé suit l'hôte de l'URL de base courante.
    ['https://api.openai.com/v1', undefined, true],
    ['https://api.openai.com/v1', null, true],
    ['https://api.openai.com/v1', '', false],
    ['https://api.openai.com/v1', 42, false],
    ['pas une url', 'api.openai.com', false],
  ];

  it('keyFor : la clé ne part que vers l’hôte pour lequel elle a été saisie', () => {
    for (const [baseUrl, keyHost, expected] of cases) {
      expect(keyFor(baseUrl, keyHost), `${baseUrl} ← ${String(keyHost)}`).toBe(expected);
      // Le renderer annonce la même chose que le process principal décide.
      expect(llmKeyBound(baseUrl, keyHost), `renderer ${baseUrl} ← ${String(keyHost)}`).toBe(expected);
    }
  });

  it('llmKeyHost : hôte et port, en minuscules', () => {
    expect(llmKeyHost('https://API.OpenAI.com/v1')).toBe('api.openai.com');
    expect(llmKeyHost('http://localhost:11434/v1')).toBe('localhost:11434');
    expect(llmKeyHost('http://[::1]:8080/v1')).toBe('[::1]:8080');
    expect(llmKeyHost('pas une url')).toBe('');
  });
});

describe('R3.7i la boucle locale IPv6 [::1] est un hôte épinglé comme les autres', () => {
  it('`URL.hostname` garde les crochets : les deux contrôles les retirent, comme `llmLoopback`', () => {
    for (const url of ['http://[::1]:11434/v1', 'https://[::1]:8443/v1', 'http://[::1]/v1']) {
      expect(llmHostOk(url), url).toBe(true);
      expect(llmHostAllowed(url), url).toBe(true);
      expect(llmLoopback(url), url).toBe(true);
    }
    // Ni un autre schéma, ni une autre adresse IPv6, ni un renderer qui voudrait élargir la liste.
    for (const url of ['ftp://[::1]:11434/v1', 'https://[2001:db8::1]/v1', 'http://[::2]:11434/v1']) {
      expect(llmHostOk(url, ['[2001:db8::1]', '2001:db8::1']), url).toBe(false);
      expect(llmHostAllowed(url, ['[2001:db8::1]', '2001:db8::1']), url).toBe(false);
    }
  });
});
