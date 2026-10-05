import { create } from 'zustand';
import { probeProvider, streamChat } from '@/engine/agent/llm';
import { contextBudget, fitHistory } from '@/engine/agent/context';
import { MAX_TOOL_ROUNDS, runAgentTurn, toChatHistory } from '@/engine/agent/loop';
import { executeDeskTool } from '@/engine/agent/runner';
import { toolKind, toolSchemas } from '@/engine/agent/tools';
import { type DeskPorts } from '@/engine/agent/ports';
import { tr } from '@/i18n';
import { desk, type OrchestratorRequest, type OrchestratorStatus } from '@/lib/desk';
import { uid } from '@/lib/id';
import { APP_VERSION } from '@/lib/version';
import { useCalendar } from './calendar';
import { db, type AgentMessage } from './db';
import { useJournal } from './journal';
import { PREDICATES, linkId, type Predicate } from '@/engine/ontology/schema';
import { useLinks } from './links';
import { useNotes } from './notes';
import { defaultAgentPrompt, isDefaultAgentPrompt, useSettings } from './settings';
import { useUi } from './ui';

export interface LinkLogEntry {
  id: string;
  at: number;
  direction: 'in' | 'out';
  method: string;
  ok: boolean;
  detail?: string;
}

interface AgentState {
  ready: boolean;
  conversationId: string;
  messages: AgentMessage[];
  streaming: boolean;
  streamText: string;
  pendingTool: string | null;
  error: string | null;
  /** Avis non bloquant sur le dernier tour (limite d'allers-retours atteinte). */
  notice: string | null;
  orchestrator: OrchestratorStatus;
  linkLog: LinkLogEntry[];
  load: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  newConversation: () => Promise<void>;
  probe: () => Promise<{ ok: boolean; detail: string; models?: string[] }>;
  startOrchestrator: () => Promise<void>;
  stopOrchestrator: () => Promise<void>;
  rotateToken: () => Promise<void>;
}

let abortController: AbortController | null = null;
let unsubscribeRequests: (() => void) | null = null;

function livePorts(): DeskPorts {
  return {
    sessions: () => useJournal.getState().sessions,
    trades: () => useJournal.getState().trades,
    startingBalance: () => useSettings.getState().settings.startingBalance,
    planId: () => useSettings.getState().settings.planId,
    updateSession: (id, patch) => useJournal.getState().updateSession(id, patch),
    notes: () => useNotes.getState().notes,
    createNote: (title, body, tags) => useNotes.getState().create(title, body, tags),
    branchNote: async (parentId, ancre, question) => {
      const note = await useNotes.getState().branch(parentId, ancre, question);
      return note ? { id: note.id, title: note.title } : null;
    },
    linkNotes: async (fromId, toId, predicate) => {
      if (!(PREDICATES as readonly string[]).includes(predicate)) return null;
      const known = predicate as Predicate;
      await useLinks.getState().affirm({ type: 'note', id: fromId }, { type: 'note', id: toId }, known);
      return { id: linkId({ type: 'note', id: fromId }, known, { type: 'note', id: toId }) };
    },
    calendarEntries: () => useCalendar.getState().entries,
  };
}

function pushLog(set: (p: Partial<AgentState>) => void, get: () => AgentState, entry: Omit<LinkLogEntry, 'id' | 'at'>): void {
  const item: LinkLogEntry = { id: uid('l'), at: Date.now(), ...entry };
  set({ linkLog: [item, ...get().linkLog].slice(0, 80) });
}

export const useAgent = create<AgentState>((set, get) => ({
  ready: false,
  conversationId: 'default',
  messages: [],
  streaming: false,
  streamText: '',
  pendingTool: null,
  error: null,
  notice: null,
  orchestrator: { running: false, port: 0, clients: 0 },
  linkLog: [],

  async load() {
    const convId = (await db.settings.get('agent.conversation'))?.value as string | undefined;
    const conversationId = convId ?? 'default';
    const messages = await db.agentMessages.where('conversationId').equals(conversationId).sortBy('createdAt');
    set({ conversationId, messages, ready: true });

    const api = desk;
    if (api && !unsubscribeRequests) {
      unsubscribeRequests = api.orchestrator.onRequest(async (req: OrchestratorRequest) => {
        const log = (ok: boolean, detail?: string) => pushLog(set, get, { direction: 'in', method: req.method, ok, detail });
        if (req.method === 'desk.describe') {
          api.orchestrator.respond(req.id, req.clientId, { artefact: 'CΛNTO', version: APP_VERSION, tools: toolSchemas() });
          log(true);
          return;
        }
        if (req.method === 'desk.ping') {
          api.orchestrator.respond(req.id, req.clientId, { pong: Date.now() });
          log(true);
          return;
        }
        if (req.method.startsWith('bridge.')) {
          api.orchestrator.respond(req.id, req.clientId, null, 'Transport WebSocket du pont non disponible : utiliser le transport fichier (Métrique › Pont NinjaTrader, docs/PONT-NINJATRADER.md)');
          log(false, 'pont non disponible');
          return;
        }
        const name = req.method.replace(/^tool\./, '');
        const result = await executeDeskTool(livePorts(), name, (req.params as Record<string, unknown>) ?? {}, {
          source: 'orch',
          allowWrite: useSettings.getState().settings.orchestratorAllowWrite,
        });
        const rec = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
        const reason = rec && typeof rec.reason === 'string' ? rec.reason : undefined;
        const err = rec && typeof rec.error === 'string' ? rec.error : undefined;
        const denied = reason === 'write_disabled' ? 'Écriture désactivée : activer « écriture autorisée » dans Agent IA › Orchestrateur externe' : reason === 'unknown_tool' ? 'Outil inconnu' : err;
        api.orchestrator.respond(req.id, req.clientId, result, denied);
        log(!denied, denied);
      });
      api.orchestrator.onStatus((status) => set({ orchestrator: status }));
      set({ orchestrator: await api.orchestrator.status() });
    }
  },

  async send(text) {
    // Non réentrant : un seul flux à la fois (abortController global, état de stream partagé).
    if (get().streaming) return;
    const { settings } = useSettings.getState();
    const { conversationId } = get();
    const userMsg: AgentMessage = { id: uid('m'), conversationId, role: 'user', content: text, createdAt: Date.now() };
    await db.agentMessages.add(userMsg);
    set({ messages: [...get().messages, userMsg], streaming: true, streamText: '', error: null, notice: null, pendingTool: null });

    abortController = new AbortController();
    const signal = abortController.signal;
    const tools = settings.agent.toolsEnabled ? toolSchemas() : [];
    const prompt = isDefaultAgentPrompt(settings.agent.systemPrompt) ? defaultAgentPrompt() : settings.agent.systemPrompt;
    const budget = contextBudget(settings.agent.baseUrl);

    try {
      const outcome = await runAgentTurn({
        maxRounds: MAX_TOOL_ROUNDS,
        tools,
        system: () => {
          const stamp = tr(
            `Date locale : ${new Date().toISOString()}. Opérateur : ${settings.callsign}.`,
            `Local date: ${new Date().toISOString()}. Operator: ${settings.callsign}.`,
            `Fecha local: ${new Date().toISOString()}. Operador: ${settings.callsign}.`,
          );
          return `${prompt}\n\n${stamp}`;
        },
        history: () => fitHistory(toChatHistory(get().messages), budget),
        stream: (req) => streamChat({ config: settings.agent, messages: req.messages, tools: req.tools, toolChoice: req.toolChoice, signal, onDelta: req.onDelta }),
        kindOf: toolKind,
        runTool: (call) =>
          executeDeskTool(livePorts(), call.name, call.args, {
            source: 'llm',
            confirmFn: (title, detail) => useUi.getState().confirm(title, detail, false),
          }),
        append: async (record) => {
          const msg: AgentMessage =
            record.role === 'assistant'
              ? { id: uid('m'), conversationId, role: 'assistant', content: record.content, toolCalls: record.toolCalls, createdAt: Date.now() }
              : { id: uid('m'), conversationId, role: 'tool', toolCallId: record.toolCallId, toolName: record.toolName, content: record.content, createdAt: Date.now() };
          await db.agentMessages.add(msg);
          set({ messages: [...get().messages, msg], ...(record.role === 'assistant' ? { streamText: '' } : {}) });
        },
        isCurrent: () => get().conversationId === conversationId,
        onRoundStart: () => set({ streamText: '', pendingTool: null }),
        onDelta: (d) => set({ streamText: get().streamText + d }),
        onToolStart: (name) => set({ pendingTool: name }),
        onToolDone: (name, ok) => pushLog(set, get, { direction: 'out', method: name, ok }),
      });
      if (outcome.exhausted && get().conversationId === conversationId) {
        set({
          notice: tr(
            `Limite de ${MAX_TOOL_ROUNDS} allers-retours atteinte : le modèle demandait encore des outils, sa réponse n’est pas finale. Relancez ou précisez la question.`,
            `Limit of ${MAX_TOOL_ROUNDS} round trips reached: the model still wanted tools, so its answer is not final. Ask again or narrow the question.`,
            `Límite de ${MAX_TOOL_ROUNDS} idas y vueltas alcanzado: el modelo aún pedía herramientas, su respuesta no es final. Vuelva a preguntar o precise la pregunta.`,
          ),
        });
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ streaming: false, pendingTool: null });
      abortController = null;
    }
  },

  stop() {
    abortController?.abort();
  },

  async newConversation() {
    get().stop();
    const conversationId = uid('conv');
    await db.settings.put({ key: 'agent.conversation', value: conversationId });
    set({ conversationId, messages: [], streamText: '', error: null, notice: null });
  },

  probe() {
    return probeProvider(useSettings.getState().settings.agent);
  },

  async startOrchestrator() {
    if (!desk) return;
    const status = await desk.orchestrator.start(useSettings.getState().settings.orchestratorPort, useSettings.getState().settings.orchestratorAllowWrite);
    set({ orchestrator: status });
  },

  async stopOrchestrator() {
    if (!desk) return;
    const status = await desk.orchestrator.stop();
    set({ orchestrator: status });
  },

  async rotateToken() {
    if (!desk) return;
    set({ orchestrator: await desk.orchestrator.rotateToken() });
  },
}));

// L'allowlist d'écriture de l'orchestrateur vit côté main : basculer le réglage pendant qu'il tourne
// re-pousse `start(port, allowWrite)` (le main met son drapeau à jour et renvoie le statut s'il tourne déjà).
useSettings.subscribe((state, prev) => {
  if (!desk || state.settings.orchestratorAllowWrite === prev.settings.orchestratorAllowWrite) return;
  const current = useAgent.getState().orchestrator;
  if (!current.running) return;
  void desk.orchestrator
    .start(current.port || state.settings.orchestratorPort, state.settings.orchestratorAllowWrite)
    .then((status) => useAgent.setState({ orchestrator: status }))
    .catch(() => undefined);
});

