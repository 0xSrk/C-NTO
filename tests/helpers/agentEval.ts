import type { ChatMessage } from '@/engine/agent/llm';
import { runAgentTurn, TOOL_PREAMBLE, type StreamRequest, type TurnOutcome, type TurnRecord } from '@/engine/agent/loop';
import type { DeskPorts } from '@/engine/agent/ports';
import { executeDeskTool } from '@/engine/agent/runner';
import { toolKind, toolSchemas } from '@/engine/agent/tools';
import { defaultAgentPrompt } from '@/store/settings';
import { scripted, type ScriptedStep } from './scriptedLlm';

export interface ToolResult {
  id: string;
  name: string;
  /** Contenu tel que le modèle le reçoit, préambule compris. */
  content: string;
}

export interface ConfirmRequest {
  title: string;
  detail: string;
  answer: boolean;
}

export interface ScenarioResult {
  outcome: TurnOutcome;
  /** Résultats d'outils, dans l'ordre où ils sont partis vers le modèle. */
  results: ToolResult[];
  /** Confirmations demandées par le renderer (écritures hors ordres), avec la réponse donnée. */
  confirms: ConfirmRequest[];
  /** Ce que la boucle a ajouté à la conversation. */
  transcript: TurnRecord[];
  /** Requêtes reçues par le fournisseur scripté. */
  requests: StreamRequest[];
}

export interface Scenario {
  script: readonly ScriptedStep[];
  ports: DeskPorts;
  /** Réponse de l'opérateur au dialogue de confirmation du renderer ; défaut : Refuser. */
  confirm?: (title: string, detail: string) => boolean;
  /** Instant de la consigne (« Date locale »), epoch ms ; défaut : fin du jeu de démo. */
  now?: number;
  /** Message de l'opérateur. */
  question?: string;
  maxRounds?: number;
}

export const SCENARIO_NOW = Date.parse('2026-10-01T12:00:00Z');

/**
 * Un tour complet de l'agent embarqué : la vraie boucle (`runAgentTurn`), les vrais schémas
 * (`toolSchemas`) et le vrai point d'entrée des outils (`executeDeskTool`, source `llm`, confirmation
 * du renderer), sur un fournisseur scripté. La consigne est celle du desk, horodatée comme dans le store.
 */
export async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const llm = scripted(s.script);
  const now = s.now ?? SCENARIO_NOW;
  const history: ChatMessage[] = [{ role: 'user', content: s.question ?? 'Diagnostic du desk' }];
  const transcript: TurnRecord[] = [];
  const results: ToolResult[] = [];
  const confirms: ConfirmRequest[] = [];
  const outcome = await runAgentTurn({
    system: () => `${defaultAgentPrompt()}\n\nDate locale : ${new Date(now).toISOString()}. Opérateur : TEST.`,
    history: () => history,
    tools: toolSchemas(),
    stream: llm.stream,
    kindOf: toolKind,
    runTool: (call) =>
      executeDeskTool(s.ports, call.name, call.args, {
        source: 'llm',
        confirmFn: async (title, detail) => {
          const answer = s.confirm?.(title, detail) ?? false;
          confirms.push({ title, detail, answer });
          return answer;
        },
      }),
    append: async (record) => {
      transcript.push(record);
      if (record.role === 'assistant') history.push({ role: 'assistant', content: record.content, toolCalls: record.toolCalls });
      else {
        history.push({ role: 'tool', content: record.content, toolCallId: record.toolCallId, name: record.toolName });
        results.push({ id: record.toolCallId, name: record.toolName, content: record.content });
      }
    },
    isCurrent: () => true,
    maxRounds: s.maxRounds,
  });
  return { outcome, results, confirms, transcript, requests: llm.requests };
}

/** Corps JSON d'un résultat d'outil : le préfixe `TOOL_PREAMBLE` est exigé. */
export function readTool<T = Record<string, unknown>>(r: string | { content: string } | undefined): T {
  const content = typeof r === 'string' ? r : r?.content;
  if (content === undefined) throw new Error('résultat d’outil absent');
  if (!content.startsWith(TOOL_PREAMBLE)) throw new Error(`résultat sans préambule : ${content.slice(0, 80)}`);
  return JSON.parse(content.slice(TOOL_PREAMBLE.length)) as T;
}

/** Dernier résultat de l'outil `name` dans une requête du fournisseur, lu par `readTool`. */
export function lastResult<T = Record<string, unknown>>(req: StreamRequest, name: string): T {
  const found = [...req.messages].reverse().find((m) => m.role === 'tool' && m.name === name);
  return readTool<T>(found?.content);
}

/** Un appel, par le harnais complet : le modèle demande l'outil, puis conclut. Rend le résultat lu. */
export async function callTool<T = Record<string, unknown>>(ports: DeskPorts, name: string, args: Record<string, unknown> = {}, now?: number): Promise<T> {
  const run = await runScenario({ ports, now, script: [{ calls: [{ name, args }] }, { text: 'fin' }] });
  return readTool<T>(run.results[0]);
}
