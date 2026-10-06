import { TOOL_PREAMBLE } from './catalog';
import type { ChatMessage, StreamResult, ToolCall, ToolSchema } from './llm';
import { MAX_CALLS_PER_ROUND, takeToolCalls } from './ports';

/** Préfixe des résultats d'outils renvoyés au modèle : défini au catalogue, partagé avec la passerelle MCP. */
export { TOOL_PREAMBLE };
export const MAX_TOOL_ROUNDS = 6;

/** Ce que la boucle ajoute à la conversation ; le store y met l'id, la conversation et l'horodatage. */
export type TurnRecord =
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string };

export interface StreamRequest {
  messages: ChatMessage[];
  tools: ToolSchema[];
  /** `none` au dernier aller-retour : le modèle conclut avec ce qu'il a lu. */
  toolChoice: 'auto' | 'none';
  onDelta: (text: string) => void;
}

export interface AgentTurnDeps {
  /** Consigne système du tour (relue à chaque aller-retour : l'horodatage avance). */
  system: () => string;
  /** Historique courant sans la consigne système, message de l'opérateur compris. */
  history: () => ChatMessage[];
  tools: ToolSchema[];
  stream: (req: StreamRequest) => Promise<StreamResult>;
  kindOf: (name: string) => 'read' | 'write';
  runTool: (call: ToolCall) => Promise<unknown>;
  /** Persiste puis ajoute à l'historique : `history()` le rend au tour suivant. */
  append: (record: TurnRecord) => Promise<void>;
  /** Faux si l'opérateur a changé de conversation pendant le flux. */
  isCurrent: () => boolean;
  onDelta?: (text: string) => void;
  onRoundStart?: () => void;
  onToolStart?: (name: string) => void;
  onToolDone?: (name: string, ok: boolean) => void;
  maxRounds?: number;
}

export interface TurnOutcome {
  rounds: number;
  /** Le modèle demandait encore des outils au dernier tour : sa réponse n'est pas finale. */
  exhausted: boolean;
}

/** Message tel que le coffre le garde (forme de `AgentMessage`, sans dépendre du store). */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/**
 * Historique pour le fournisseur. Un message `tool` répond à `toolCallId` ; dans les messages
 * enregistrés avant ce champ, l'`id` du message était l'identifiant d'appel et sert encore.
 */
export function toChatHistory(messages: readonly StoredMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') out.push({ role: 'assistant', content: m.content, toolCalls: m.toolCalls });
    else if (m.role === 'tool') out.push({ role: 'tool', content: m.content, toolCallId: m.toolCallId ?? m.id, name: m.toolName ?? '' });
  }
  return out;
}

function isErrorResult(output: unknown): boolean {
  return !!output && typeof output === 'object' && 'error' in output;
}

/**
 * Un tour de l'agent : le modèle répond, les outils demandés s'exécutent, leurs résultats repartent
 * au modèle, jusqu'à une réponse sans outil ou `maxRounds` allers-retours. Aucun accès aux stores :
 * tout passe par `deps`.
 */
export async function runAgentTurn(deps: AgentTurnDeps): Promise<TurnOutcome> {
  const maxRounds = deps.maxRounds ?? MAX_TOOL_ROUNDS;
  let rounds = 0;
  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    const last = round === maxRounds - 1;
    deps.onRoundStart?.();
    const messages: ChatMessage[] = [{ role: 'system', content: deps.system() }, ...deps.history()];
    const result = await deps.stream({ messages, tools: deps.tools, toolChoice: last ? 'none' : 'auto', onDelta: (d) => deps.onDelta?.(d) });
    if (!deps.isCurrent()) return { rounds, exhausted: false };
    await deps.append({ role: 'assistant', content: result.text, toolCalls: result.toolCalls.length ? result.toolCalls : undefined });
    if (result.toolCalls.length === 0) return { rounds, exhausted: false };

    if (last) {
      // Un fournisseur qui ignore `tool_choice` peut encore demander des outils : chaque appel est
      // refusé pour que l'historique reste valide, et l'opérateur est prévenu.
      for (const call of result.toolCalls) {
        await deps.append({ role: 'tool', content: TOOL_PREAMBLE + JSON.stringify({ ok: false, reason: 'round_limit' }), toolCallId: call.id, toolName: call.name });
        deps.onToolDone?.(call.name, false);
      }
      return { rounds, exhausted: true };
    }

    // Chaque appel reçoit un résultat, exécuté ou refusé : un appel sans résultat rend l'historique
    // invalide pour OpenAI comme pour Anthropic, et la conversation entière échouerait ensuite.
    const taken = new Set(takeToolCalls(result.toolCalls, deps.kindOf));
    for (const [index, call] of result.toolCalls.entries()) {
      if (!taken.has(call)) {
        const reason = index >= MAX_CALLS_PER_ROUND ? 'call_limit' : 'write_limit';
        await deps.append({ role: 'tool', content: TOOL_PREAMBLE + JSON.stringify({ ok: false, reason }), toolCallId: call.id, toolName: call.name });
        deps.onToolDone?.(call.name, false);
        continue;
      }
      deps.onToolStart?.(call.name);
      const output = await deps.runTool(call);
      await deps.append({ role: 'tool', content: TOOL_PREAMBLE + JSON.stringify(output), toolCallId: call.id, toolName: call.name });
      deps.onToolDone?.(call.name, !isErrorResult(output));
    }
  }
  return { rounds, exhausted: false };
}
