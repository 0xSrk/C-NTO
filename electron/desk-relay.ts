import { ORDER_TOOLS } from './agent/catalog';
import { uiText, type AppLocale } from './locale';
import type { McpRelay, McpToolInfo } from './mcp-server';

/** Identifiant de client des requêtes MCP sur le canal `orch:request` (les clients WS sont `c1`, `c2`…). */
export const MCP_CLIENT_ID = 'mcp';
/** Un ordre proposé attend la réponse du trader (45 s au plus) : le relais attend un peu plus. */
export const ORDER_RELAY_TIMEOUT_MS = 55_000;

export interface DeskAnswer {
  result: unknown;
  error?: string;
}

/**
 * Pose une question au renderer sur le canal de l'orchestrateur et attend sa réponse
 * (`orch:respond`, même `clientId`). Le renderer exécute l'outil ; le main ne touche pas aux stores.
 */
export class DeskRelay {
  private seq = 0;
  private readonly pending = new Map<string, { resolve: (a: DeskAnswer) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    /** Envoie `orch:request` ; faux si aucune fenêtre du desk n'est ouverte. */
    private readonly send: (req: { id: string; clientId: string; method: string; params: unknown }) => boolean,
    private readonly timeoutMs = 15_000,
    /** Langue du desk, relue à chaque question : le motif d'un desk fermé ou muet part au client MCP. */
    private readonly locale: () => AppLocale = () => 'fr',
  ) {}

  ask(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<DeskAnswer> {
    const id = `m${++this.seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          resolve({ result: null, error: uiText(this.locale(), 'Le desk ne répond pas (délai dépassé).', 'The desk is not responding (timed out).', 'El desk no responde (tiempo agotado).') });
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      if (!this.send({ id, clientId: MCP_CLIENT_ID, method, params })) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ result: null, error: uiText(this.locale(), 'Desk indisponible : la fenêtre de CΛNTO est fermée.', 'Desk unavailable: the CΛNTO window is closed.', 'Desk no disponible: la ventana de CΛNTO está cerrada.') });
      }
    });
  }

  /** Réponse du renderer. Rend faux si l'identifiant est inconnu (déjà expiré, ou pas à nous). */
  settle(id: string, result: unknown, error?: string): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve({ result, error });
    return true;
  }
}

function isToolInfo(v: unknown): v is McpToolInfo {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return typeof t.name === 'string' && typeof t.description === 'string' && !!t.parameters && typeof t.parameters === 'object' && (t.kind === 'read' || t.kind === 'write');
}

/** Relais MCP : catalogue lu par `desk.describe` (gardé quelques secondes), appels par `tool.<nom>`. */
export function mcpRelay(relay: DeskRelay, cacheMs = 5_000, now: () => number = Date.now): McpRelay {
  let cache: { at: number; tools: McpToolInfo[] } | null = null;
  return {
    async tools() {
      if (cache && now() - cache.at < cacheMs) return cache.tools;
      const { result } = await relay.ask('desk.describe', {});
      const list = result && typeof result === 'object' ? (result as { tools?: unknown }).tools : undefined;
      const tools = Array.isArray(list) ? list.filter(isToolInfo) : [];
      if (tools.length) cache = { at: now(), tools };
      return tools;
    },
    call(name, args) {
      return relay.ask(`tool.${name}`, args, ORDER_TOOLS.includes(name) ? ORDER_RELAY_TIMEOUT_MS : undefined);
    },
  };
}
