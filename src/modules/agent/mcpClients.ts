/** Configurations prêtes à coller pour brancher un agent externe sur la passerelle MCP du desk. */

export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http canto ${url} --header "Authorization: Bearer ${token}"`;
}

/** Bloc `mcpServers` (Claude Code `.mcp.json`, Cursor, et clients qui lisent ce format). */
export function mcpJsonConfig(url: string, token: string): string {
  return JSON.stringify({ mcpServers: { canto: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}
