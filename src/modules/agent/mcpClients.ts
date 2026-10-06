/** Configurations prêtes à coller pour brancher un agent externe sur la passerelle MCP du desk. */

export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http canto ${url} --header "Authorization: Bearer ${token}"`;
}

/** Bloc `mcpServers` (Claude Code `.mcp.json`, Cursor, et clients qui lisent ce format). */
export function mcpJsonConfig(url: string, token: string): string {
  return JSON.stringify({ mcpServers: { canto: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

/** Claude Desktop : stdio via `mcp-remote`. Le jeton est dans `env`, pas dans les arguments. */
export function claudeDesktopConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        canto: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${CANTO_AUTH}'],
          env: { CANTO_AUTH: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

/**
 * Codex (`~/.codex/config.toml`). Syntaxe vérifiée dans la référence officielle :
 * `mcp_servers.<id>.url` et `bearer_token_env_var` (le nom de la variable, pas le jeton).
 */
export function codexConfig(url: string): string {
  return `[mcp_servers.canto]\nurl = ${JSON.stringify(url)}\nbearer_token_env_var = "CANTO_MCP_TOKEN"\n`;
}
