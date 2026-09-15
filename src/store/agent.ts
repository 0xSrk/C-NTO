import { create } from 'zustand';
import { probeProvider, streamChat, type ChatMessage } from '@/engine/agent/llm';
import { runTool, toolSchemas } from '@/engine/agent/tools';
import { desk, type OrchestratorRequest, type OrchestratorStatus } from '@/lib/desk';
import { uid } from '@/lib/id';
import { db, type AgentMessage } from './db';
import { useSettings } from './settings';

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
  orchestrator: OrchestratorStatus;
  linkLog: LinkLogEntry[];
  load: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  newConversation: () => Promise<void>;
  probe: () => Promise<{ ok: boolean; detail: string; models?: string[] }>;
  startOrchestrator: () => Promise<void>;
  stopOrchestrator: () => Promise<void>;
}

const MAX_TOOL_ROUNDS = 6;
let abortController: AbortController | null = null;
let unsubscribeRequests: (() => void) | null = null;
let unsubscribeStatus: (() => void) | null = null;

function pushLog(set: (p: Partial<AgentState>) => void, get: () => AgentState, entry: Omit<LinkLogEntry, 'id' | 'at'>): void {
  const item: LinkLogEntry = { id: uid('l'), at: Date.now(), ...entry };
  set({ linkLog: [item, ...get().linkLog].slice(0, 80) });
}

function toChat(messages: AgentMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') out.push({ role: 'assistant', content: m.content, toolCalls: m.toolCalls });
    else if (m.role === 'tool') out.push({ role: 'tool', content: m.content, toolCallId: m.id, name: m.toolName ?? '' });
  }
  return out;
}

export const useAgent = create<AgentState>((set, get) => ({
  ready: false,
  conversationId: 'default',
  messages: [],
  streaming: false,
  streamText: '',
  pendingTool: null,
  error: null,
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
          api.orchestrator.respond(req.id, req.clientId, { artefact: 'CΛNTO', version: '0.1.0', tools: toolSchemas() });
          log(true);
          return;
        }
        if (req.method === 'desk.ping') {
          api.orchestrator.respond(req.id, req.clientId, { pong: Date.now() });
          log(true);
          return;
        }
        if (req.method.startsWith('bridge.')) {
          api.orchestrator.respond(req.id, req.clientId, null, 'Pont NinjaTrader non disponible dans ce prototype (voir docs/PONT-NINJATRADER.md)');
          log(false, 'pont non disponible');
          return;
        }
        const name = req.method.replace(/^tool\./, '');
        const result = await runTool(name, (req.params as Record<string, unknown>) ?? {});
        const failed = typeof result === 'object' && result !== null && 'error' in (result as Record<string, unknown>);
        api.orchestrator.respond(req.id, req.clientId, result, failed ? String((result as { error: string }).error) : undefined);
        log(!failed, failed ? String((result as { error: string }).error) : undefined);
      });
      unsubscribeStatus = api.orchestrator.onStatus((status) => set({ orchestrator: status }));
      set({ orchestrator: await api.orchestrator.status() });
    }
  },

  async send(text) {
    const { settings } = useSettings.getState();
    const { conversationId } = get();
    const userMsg: AgentMessage = { id: uid('m'), conversationId, role: 'user', content: text, createdAt: Date.now() };
    await db.agentMessages.add(userMsg);
    set({ messages: [...get().messages, userMsg], streaming: true, streamText: '', error: null, pendingTool: null });

    abortController = new AbortController();
    const signal = abortController.signal;
    const tools = settings.agent.toolsEnabled ? toolSchemas() : [];

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const history: ChatMessage[] = [{ role: 'system', content: `${settings.agent.systemPrompt}\n\nDate locale : ${new Date().toISOString()}. Opérateur : ${settings.callsign}.` }, ...toChat(get().messages)];
        set({ streamText: '' });
        const result = await streamChat({
          config: settings.agent,
          messages: history,
          tools,
          signal,
          onDelta: (d) => set({ streamText: get().streamText + d }),
        });
        const assistant: AgentMessage = {
          id: uid('m'),
          conversationId,
          role: 'assistant',
          content: result.text,
          toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
          createdAt: Date.now(),
        };
        await db.agentMessages.add(assistant);
        set({ messages: [...get().messages, assistant], streamText: '' });
        if (result.toolCalls.length === 0) break;

        for (const call of result.toolCalls) {
          set({ pendingTool: call.name });
          const output = await runTool(call.name, call.args);
          const toolMsg: AgentMessage = { id: call.id, conversationId, role: 'tool', toolName: call.name, content: JSON.stringify(output), createdAt: Date.now() };
          await db.agentMessages.add(toolMsg);
          set({ messages: [...get().messages, toolMsg] });
          pushLog(set, get, { direction: 'out', method: call.name, ok: !(output && typeof output === 'object' && 'error' in output) });
        }
        set({ pendingTool: null });
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
    const conversationId = uid('conv');
    await db.settings.put({ key: 'agent.conversation', value: conversationId });
    set({ conversationId, messages: [], streamText: '', error: null });
  },

  probe() {
    return probeProvider(useSettings.getState().settings.agent);
  },

  async startOrchestrator() {
    if (!desk) return;
    const status = await desk.orchestrator.start(useSettings.getState().settings.orchestratorPort);
    set({ orchestrator: status });
  },

  async stopOrchestrator() {
    if (!desk) return;
    const status = await desk.orchestrator.stop();
    set({ orchestrator: status });
  },
}));

export function disposeAgentBridge(): void {
  unsubscribeRequests?.();
  unsubscribeStatus?.();
  unsubscribeRequests = null;
  unsubscribeStatus = null;
}
