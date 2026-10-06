import type { ChatMessage, StreamResult, ToolCall } from '@/engine/agent/llm';
import type { StreamRequest } from '@/engine/agent/loop';

/** Appel d'outil écrit par le script : nom et arguments (sérialisés comme le ferait un fournisseur). */
export interface ScriptedCall {
  name: string;
  args?: Record<string, unknown>;
}

/** Réponse du « modèle » pour un aller-retour : texte, appels d'outils, ou les deux. */
export interface ScriptedReply {
  text?: string;
  calls?: ScriptedCall[];
}

/**
 * Un pas du script. Une fonction reçoit la requête complète (consigne, historique, résultats
 * d'outils déjà rendus) et le numéro du tour : de quoi lire un résultat avant de répondre.
 */
export type ScriptedStep = ScriptedReply | ((req: StreamRequest, turn: number) => ScriptedReply);

export interface ScriptedLlm {
  stream: (req: StreamRequest) => Promise<StreamResult>;
  /** Requêtes reçues, copiées au moment de l'appel (la boucle reconstruit les messages à chaque tour). */
  requests: StreamRequest[];
}

/**
 * Fournisseur scripté : un pas par aller-retour, dans l'ordre. Les identifiants d'appel sont
 * `call_<tour>_<i>`. Un tour sans pas lève une erreur : le scénario a demandé plus que prévu.
 */
export function scripted(steps: readonly ScriptedStep[]): ScriptedLlm {
  const requests: StreamRequest[] = [];
  let turn = 0;
  return {
    requests,
    async stream(req) {
      const index = turn++;
      requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      const step = steps[index];
      if (step === undefined) throw new Error(`script épuisé : aucun pas pour le tour ${index}`);
      const reply = typeof step === 'function' ? step(req, index) : step;
      const text = reply.text ?? '';
      if (text) req.onDelta(text);
      const toolCalls: ToolCall[] = (reply.calls ?? []).map((c, i) => ({ id: `call_${index}_${i}`, name: c.name, args: JSON.stringify(c.args ?? {}) }));
      return { text, toolCalls };
    },
  };
}

/** Messages `tool` de la requête, du plus ancien au plus récent ; filtrés par outil si `name`. */
export function toolMessages(req: StreamRequest, name?: string): Extract<ChatMessage, { role: 'tool' }>[] {
  return req.messages.filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool' && (!name || m.name === name));
}

/** Consigne système de la requête. */
export function systemOf(req: StreamRequest): string {
  const first = req.messages[0];
  return first?.role === 'system' ? first.content : '';
}
