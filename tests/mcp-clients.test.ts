import { describe, expect, it } from 'vitest';
import { claudeCodeCommand, mcpJsonConfig } from '@/modules/agent/mcpClients';

describe('configurations des clients MCP', () => {
  const url = 'http://127.0.0.1:47118/mcp';

  it('Claude Code : transport http, en-tête porteur', () => {
    expect(claudeCodeCommand(url, 'T0K')).toBe('claude mcp add --transport http canto http://127.0.0.1:47118/mcp --header "Authorization: Bearer T0K"');
  });

  it('JSON mcpServers : url et en-tête, JSON valide', () => {
    expect(JSON.parse(mcpJsonConfig(url, 'T0K'))).toEqual({ mcpServers: { canto: { type: 'http', url, headers: { Authorization: 'Bearer T0K' } } } });
  });
});
