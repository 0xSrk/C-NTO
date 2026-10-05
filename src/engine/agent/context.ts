import type { ChatMessage } from './llm';
import { TOOL_PREAMBLE } from './loop';

/** Bornes de l'historique envoyé au modèle, en caractères (≈ 4 caractères par jeton). */
export interface ContextBudget {
  historyChars: number;
  toolResultChars: number;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Un modèle local tourne souvent avec une petite fenêtre (Ollama tronque le début sans prévenir,
 * consigne système comprise) ; un fournisseur cloud en accepte bien plus.
 */
export function contextBudget(baseUrl: string): ContextBudget {
  let host = '';
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    host = '';
  }
  return LOOPBACK.has(host) ? { historyChars: 24_000, toolResultChars: 8_000 } : { historyChars: 400_000, toolResultChars: 60_000 };
}

function size(m: ChatMessage): number {
  const calls = m.role === 'assistant' ? (m.toolCalls ?? []).reduce((n, c) => n + c.name.length + c.args.length, 0) : 0;
  return m.content.length + calls;
}

const total = (msgs: readonly ChatMessage[]) => msgs.reduce((n, m) => n + size(m), 0);

function capped(content: string, max: number): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}… [tronqué : ${content.length - max} caractères retirés, affiner la requête]`;
}

function compacted(m: Extract<ChatMessage, { role: 'tool' }>): ChatMessage {
  const omitted = { omitted: 'résultat retiré du contexte pour tenir la fenêtre du modèle ; relancer l’outil si besoin', chars: m.content.length };
  return { ...m, content: TOOL_PREAMBLE + JSON.stringify(omitted) };
}

const isCompacted = (m: ChatMessage) => m.role === 'tool' && m.content.startsWith(`${TOOL_PREAMBLE}{"omitted"`);

/**
 * Ajuste l'historique (sans consigne système) au budget, sans jamais séparer un appel d'outil de
 * son résultat. Ordre de dégradation :
 * 1. chaque résultat d'outil est plafonné ;
 * 2. les résultats des échanges précédents sont remplacés par un témoin, du plus ancien au plus récent ;
 * 3. les échanges précédents sont retirés entiers, du plus ancien au plus récent ;
 * 4. dans l'échange courant, les résultats des allers-retours antérieurs au dernier sont remplacés.
 * Un échange commence à un message de l'opérateur ; l'échange courant n'est jamais retiré.
 */
export function fitHistory(history: readonly ChatMessage[], budget: ContextBudget): ChatMessage[] {
  const msgs: ChatMessage[] = history.map((m) => (m.role === 'tool' ? { ...m, content: capped(m.content, budget.toolResultChars) } : m));
  if (total(msgs) <= budget.historyChars) return msgs;

  // Bornes des échanges : index de chaque message de l'opérateur.
  const starts: number[] = [];
  msgs.forEach((m, i) => {
    if (m.role === 'user') starts.push(i);
  });
  const currentStart = starts.length ? starts[starts.length - 1]! : 0;

  // 2. Résultats des échanges précédents.
  for (let i = 0; i < currentStart && total(msgs) > budget.historyChars; i++) {
    const m = msgs[i]!;
    if (m.role === 'tool' && !isCompacted(m)) msgs[i] = compacted(m);
  }

  // 3. Échanges précédents entiers : couper à un message de l'opérateur ne sépare jamais un appel de son résultat.
  let from = 0;
  while (from < currentStart && total(msgs.slice(from)) > budget.historyChars) {
    from = starts.find((s) => s > from) ?? currentStart;
  }
  const kept = msgs.slice(from);

  // 4. Échange courant : tout résultat avant le dernier message assistant.
  let lastAssistant = -1;
  kept.forEach((m, i) => {
    if (m.role === 'assistant') lastAssistant = i;
  });
  for (let i = 0; i < lastAssistant && total(kept) > budget.historyChars; i++) {
    const m = kept[i]!;
    if (m.role === 'tool' && !isCompacted(m)) kept[i] = compacted(m);
  }
  return kept;
}
