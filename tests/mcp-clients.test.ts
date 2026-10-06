import { describe, expect, it } from 'vitest';
import { claudeCodeCommand, claudeDesktopConfig, codexConfig, mcpJsonConfig } from '@/modules/agent/mcpClients';

describe('configurations des clients MCP', () => {
  const url = 'http://127.0.0.1:47118/mcp';

  it('Claude Code : transport http, en-tête porteur', () => {
    expect(claudeCodeCommand(url, 'T0K')).toBe('claude mcp add --transport http canto http://127.0.0.1:47118/mcp --header "Authorization: Bearer T0K"');
  });

  it('JSON mcpServers : url et en-tête, JSON valide', () => {
    expect(JSON.parse(mcpJsonConfig(url, 'T0K'))).toEqual({ mcpServers: { canto: { type: 'http', url, headers: { Authorization: 'Bearer T0K' } } } });
  });

  it('Claude Desktop : mcp-remote, jeton dans env', () => {
    expect(JSON.parse(claudeDesktopConfig(url, 'T0K'))).toEqual({
      mcpServers: {
        canto: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${CANTO_AUTH}'],
          env: { CANTO_AUTH: 'Bearer T0K' },
        },
      },
    });
  });

  it('Codex : url et variable d’environnement, jamais le jeton', () => {
    const text = codexConfig(url);
    expect(text).toBe(`[mcp_servers.canto]\nurl = ${JSON.stringify(url)}\nbearer_token_env_var = "CANTO_MCP_TOKEN"\n`);
    expect(text).not.toContain('T0K');
    expect(text).not.toContain('bearer_token =');
  });
});
