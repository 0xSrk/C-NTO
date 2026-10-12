import { create } from 'zustand';
import { probeProvider, streamChat } from '@/engine/agent/llm';
import { contextBudget, fitHistory } from '@/engine/agent/context';
import { memoryBudget, memoryDigest, traderMemory, type TraderMemory } from '@/engine/agent/memory';
import { MAX_TOOL_ROUNDS, runAgentTurn, toChatHistory } from '@/engine/agent/loop';
import { renderRoutine } from '@/engine/agent/routines';
import { executeDeskTool } from '@/engine/agent/runner';
import { describedDeskTools, toolKind, toolSchemas } from '@/engine/agent/tools';
import { type DeskPorts } from '@/engine/agent/ports';
import { tradingDayNow } from '@/engine/discipline';
import { findPlan } from '@/engine/propfirm';
import { tr, useI18n } from '@/i18n';
import { dateTimeFormatter, ET_ZONE, etDateKey } from '@/lib/time';
import { desk, type AgentOrderOrigin, type McpStatus, type OrchestratorRequest, type OrchestratorStatus } from '@/lib/desk';
import { uid } from '@/lib/id';
import { APP_VERSION } from '@/lib/version';
import { useAgentOrders } from './agentOrders';
import { useBars } from './bars';
import { bridgeQuotes, useBridge } from './bridge';
import { useCalendar } from './calendar';
import { cryptoDeskPort, useCrypto } from './crypto';
import { deskEventLog } from './deskEvents';
import { db, type AgentMessage } from './db';
import { useJournal } from './journal';
import { PREDICATES, linkId, type Predicate } from '@/engine/ontology/schema';
import { useLinks } from './links';
import { useMacro } from './macro';
import { useNotes } from './notes';
import { usePortfolio } from './portfolio';
import { defaultAgentPrompt, isDefaultAgentPrompt, useSettings, type Settings } from './settings';
import { useUi } from './ui';

/** Identifiant de client des requêtes relayées par la passerelle MCP (`electron/desk-relay.ts`). */
const MCP_CLIENT_ID = 'mcp';

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
  mcp: McpStatus;
  linkLog: LinkLogEntry[];
  load: () => Promise<void>;
  send: (text: string) => Promise<void>;
  /**
   * Lance une routine dans la langue active ; rend vrai si elle part. Faux pendant un flux (rien ne part),
   * outils coupés ou routine invalide (avis).
   */
  runRoutine: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
  stop: () => void;
  newConversation: () => Promise<void>;
  probe: () => Promise<{ ok: boolean; detail: string; models?: string[] }>;
  startOrchestrator: () => Promise<void>;
  stopOrchestrator: () => Promise<void>;
  rotateToken: () => Promise<void>;
  startMcp: () => Promise<void>;
  /** Rouvre la passerelle si le trader l'avait laissée ouverte. Appelé à l'ouverture du desk. */
  resumeMcp: () => Promise<void>;
  stopMcp: () => Promise<void>;
  rotateMcpToken: () => Promise<void>;
  mcpConnection: () => Promise<{ url: string; token: string } | null>;
}

let abortController: AbortController | null = null;
let unsubscribeRequests: (() => void) | null = null;

/** Ports du desk branchés sur les stores. `origin` : qui appelle, pour la trace des ordres proposés. Exporté pour les tests. */
export function livePorts(origin: AgentOrderOrigin = 'llm'): DeskPorts {
  return {
    sessions: () => useJournal.getState().sessions,
    trades: () => useJournal.getState().trades,
    startingBalance: () => useSettings.getState().settings.startingBalance,
    planId: () => useSettings.getState().settings.planId,
    planAccount: () => useSettings.getState().settings.planAccount,
    traderRules: () => useSettings.getState().settings.traderRules,
    riskPerContract: () => useSettings.getState().settings.riskPerContract,
    updateSession: (id, patch) => useJournal.getState().updateSession(id, patch),
    notes: () => useNotes.getState().notes,
    createNote: (title, body, tags) => useNotes.getState().create(title, body, tags, { by: 'agent' }),
    branchNote: async (parentId, ancre, question) => {
      const note = await useNotes.getState().branch(parentId, ancre, question, { by: 'agent' });
      return note ? { id: note.id, title: note.title } : null;
    },
    linkNotes: async (fromId, toId, predicate) => {
      if (!(PREDICATES as readonly string[]).includes(predicate)) return null;
      const known = predicate as Predicate;
      await useLinks.getState().affirm({ type: 'note', id: fromId }, { type: 'note', id: toId }, known, 'agent');
      return { id: linkId({ type: 'note', id: fromId }, known, { type: 'note', id: toId }) };
    },
    calendarEntries: () => useCalendar.getState().entries,
    officialEvents: () => useMacro.getState().events,
    bridge: async () => ({
      nt: (await desk?.ntbridge?.status().catch(() => null)) ?? useBridge.getState().nt,
      copier: desk?.copier ? await desk.copier.status().catch(() => null) : null,
    }),
    workingOrders: async () => (desk?.ntbridge?.orders ? await desk.ntbridge.orders().catch(() => null) : null),
    marketQuotes: () => bridgeQuotes.all(),
    marketFeed: () => useBars.getState().ntFeed,
    portfolio: async () => {
      if (!usePortfolio.getState().ready) await usePortfolio.getState().load();
      const { pockets, positions, cash, fx } = usePortfolio.getState();
      return { pockets, positions, cash, fx, base: useSettings.getState().settings.portfolio.baseCurrency };
    },
    events: (opts) => deskEventLog.read(opts),
    barSeries: async () => {
      if (!useBars.getState().ready) await useBars.getState().load();
      return useBars.getState().series;
    },
    activeSeriesId: () => useBars.getState().activeId,
    regimeRules: () => ({ confirm: useSettings.getState().settings.regimeConfirm, minStay: useSettings.getState().settings.regimeMinSessions }),
    proposeOrder: async (args) => {
      const outcome = await useAgentOrders.getState().propose(args, origin);
      return { ok: outcome.status === 'sent', ...outcome };
    },
    // Module crypto : ce que le trader a ouvert, écrit avec `by: 'agent'` ; éteint, les outils `crypto_*` refusent.
    crypto: () => cryptoDeskPort(),
  };
}

/** Le catalogue des outils suit l'interrupteur crypto du process principal, tel que le store l'a lu : les dix `crypto_*` seulement allumé. */
const toolCatalog = () => ({ crypto: useCrypto.getState().enabled });

/** Mémoire du trader telle que la consigne la résume : réglages et notes du trader, et les notes d'agent qu'il a adoptées. */
export function currentTraderMemory(settings: Settings): TraderMemory {
  return traderMemory({ rules: settings.traderRules, plan: findPlan(settings.planId), planAccount: settings.planAccount, notes: useNotes.getState().notes });
}

/**
 * Horodatage de la consigne : date et heure de New York, journée CME en cours, instant UTC. Un modèle qui
 * ne lit qu'un ISO UTC se trompe de jour le soir à New York (après 20 h, « demain » viserait J+2).
 */
export function deskClock(now: number, callsign: string): string {
  const ny = dateTimeFormatter({ timeZone: ET_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));
  const date = etDateKey(now);
  const cme = tradingDayNow(now);
  const utc = new Date(now).toISOString();
  return tr(
    `Maintenant à New York : ${ny} (${date}). Journée de trading CME en cours : ${cme} (de 18 h la veille à 17 h, heure de New York). « Aujourd’hui » et « demain » s’entendent à New York. Instant UTC, pour lire les horodatages des outils : ${utc}. Opérateur : ${callsign}.`,
    `Now in New York: ${ny} (${date}). Current CME trading day: ${cme} (6 pm the day before to 5 pm, New York time). “Today” and “tomorrow” are New York days. UTC instant, to read tool timestamps: ${utc}. Operator: ${callsign}.`,
    `Ahora en Nueva York: ${ny} (${date}). Jornada de trading CME en curso: ${cme} (de las 18 h del día anterior a las 17 h, hora de Nueva York). «Hoy» y «mañana» se entienden en Nueva York. Instante UTC, para leer las marcas de tiempo de las herramientas: ${utc}. Operador: ${callsign}.`,
  );
}

/** Consigne système d'un tour : consigne du trader (ou par défaut), résumé de sa mémoire au budget du modèle, horodatage. */
export function agentSystemPrompt(settings: Settings, memory: TraderMemory, now: number): string {
  const prompt = isDefaultAgentPrompt(settings.agent.systemPrompt) ? defaultAgentPrompt() : settings.agent.systemPrompt;
  // Outils du desk coupés : le trader n'ouvre pas son desk au fournisseur, sa mémoire non plus.
  const digest = settings.agent.toolsEnabled ? memoryDigest(memory, memoryBudget(settings.agent.baseUrl)) : '';
  return [prompt, digest, deskClock(now, settings.callsign)].filter(Boolean).join('\n\n');
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
  mcp: { running: false, port: 0, calls: 0 },
  linkLog: [],

  async load() {
    const convId = (await db.settings.get('agent.conversation'))?.value as string | undefined;
    const conversationId = convId ?? 'default';
    const messages = await db.agentMessages.where('conversationId').equals(conversationId).sortBy('createdAt');
    set({ conversationId, messages, ready: true });

    const api = desk;
    if (api && !unsubscribeRequests) {
      unsubscribeRequests = api.orchestrator.onRequest(async (req: OrchestratorRequest) => {
        const via = req.clientId === MCP_CLIENT_ID ? `mcp · ${req.method}` : req.method;
        const log = (ok: boolean, detail?: string) => pushLog(set, get, { direction: 'in', method: via, ok, detail });
        if (req.method === 'desk.describe') {
          const tools = describedDeskTools(toolCatalog());
          api.orchestrator.respond(req.id, req.clientId, { artefact: 'CΛNTO', version: APP_VERSION, tools });
          log(true);
          return;
        }
        if (req.method === 'desk.ping') {
          api.orchestrator.respond(req.id, req.clientId, { pong: Date.now() });
          log(true);
          return;
        }
        const name = req.method.replace(/^tool\./, '');
        const result = await executeDeskTool(livePorts(req.clientId === MCP_CLIENT_ID ? 'mcp' : 'orch'), name, (req.params as Record<string, unknown>) ?? {}, {
          source: 'orch',
          allowWrite: useSettings.getState().settings.orchestratorAllowWrite,
        });
        const rec = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
        const reason = rec && typeof rec.reason === 'string' ? rec.reason : undefined;
        const err = rec && typeof rec.error === 'string' ? rec.error : undefined;
        const mcp = req.clientId === MCP_CLIENT_ID;
        const denied =
          reason === 'write_disabled'
            ? tr(
                `Écriture désactivée : activer « écriture autorisée » dans Agent IA › ${mcp ? 'Agents externes · MCP' : 'Orchestrateur externe'}`,
                `Writing disabled: turn on “write allowed” in AI Agent › ${mcp ? 'External agents · MCP' : 'External orchestrator'}`,
                `Escritura desactivada: active « escritura autorizada » en Agente IA › ${mcp ? 'Agentes externos · MCP' : 'Orquestador externo'}`,
              )
            : reason === 'unknown_tool'
              ? tr('Outil inconnu', 'Unknown tool', 'Herramienta desconocida')
              : err;
        api.orchestrator.respond(req.id, req.clientId, result, denied);
        log(!denied, denied);
      });
      api.orchestrator.onStatus((status) => set({ orchestrator: status }));
      set({ orchestrator: await api.orchestrator.status() });
      if (api.mcp) {
        api.mcp.onStatus((status) => set({ mcp: status }));
        set({ mcp: await api.mcp.status() });
      }
    }
  },

  async send(text) {
    // Non réentrant : un seul flux à la fois (abortController global, état de stream partagé).
    // Le verrou se prend avant le premier `await` : de deux envois rapprochés, un seul part.
    if (get().streaming) return;
    set({ streaming: true, streamText: '', error: null, notice: null, pendingTool: null });
    const { settings } = useSettings.getState();
    const { conversationId } = get();
    const userMsg: AgentMessage = { id: uid('m'), conversationId, role: 'user', content: text, createdAt: Date.now() };
    try {
      await db.agentMessages.add(userMsg);
    } catch (e) {
      set({ streaming: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    set({ messages: [...get().messages, userMsg] });

    abortController = new AbortController();
    const signal = abortController.signal;
    const tools = settings.agent.toolsEnabled ? toolSchemas(toolCatalog()) : [];
    const budget = contextBudget(settings.agent.baseUrl);

    try {
      const outcome = await runAgentTurn({
        maxRounds: MAX_TOOL_ROUNDS,
        tools,
        system: () => agentSystemPrompt(settings, currentTraderMemory(settings), Date.now()),
        history: () => fitHistory(toChatHistory(get().messages), budget),
        stream: (req) => streamChat({ config: settings.agent, messages: req.messages, tools: req.tools, toolChoice: req.toolChoice, signal, onDelta: req.onDelta }),
        kindOf: toolKind,
        runTool: (call) =>
          executeDeskTool(livePorts('llm'), call.name, call.args, {
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

  async runRoutine(name, args) {
    // Un flux est en cours : `send` n'est pas réentrant, la routine ne partirait pas.
    if (get().streaming) return false;
    const { settings } = useSettings.getState();
    const locale = useI18n.getState().locale;
    if (!settings.agent.toolsEnabled) {
      set({
        notice: tr(
          'Les outils du desk sont coupés : le brief et le débrief ne partent pas.',
          'Desk tools are off: the brief and the debrief are not sent.',
          'Las herramientas del desk están cortadas: el brief y el debrief no se envían.',
        ),
        error: null,
      });
      return false;
    }
    const rendered = renderRoutine(name, args ?? {}, { locale, allowWrites: settings.agent.toolsEnabled, now: Date.now() });
    if (!rendered.ok) {
      set({ notice: rendered.detail, error: null });
      return false;
    }
    await get().send(rendered.text);
    return true;
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

  async startMcp() {
    if (!desk?.mcp) return;
    const { mcpPort, orchestratorAllowWrite } = useSettings.getState().settings;
    const status = await desk.mcp.start(mcpPort, orchestratorAllowWrite);
    set({ mcp: status });
    if (status.running) await useSettings.getState().update({ mcpEnabled: true });
  },

  async resumeMcp() {
    if (!desk?.mcp || get().mcp.running || !useSettings.getState().settings.mcpEnabled) return;
    const { mcpPort, orchestratorAllowWrite } = useSettings.getState().settings;
    set({ mcp: await desk.mcp.start(mcpPort, orchestratorAllowWrite) });
  },

  async stopMcp() {
    if (!desk?.mcp) return;
    set({ mcp: await desk.mcp.stop() });
    await useSettings.getState().update({ mcpEnabled: false });
  },

  async rotateMcpToken() {
    if (!desk?.mcp) return;
    set({ mcp: await desk.mcp.rotateToken() });
  },

  mcpConnection() {
    return desk?.mcp ? desk.mcp.connection() : Promise.resolve(null);
  },
}));

// L'allowlist d'écriture des agents externes vit côté main : basculer le réglage pendant qu'une passerelle
// tourne re-pousse `start(port, allowWrite)` (le main met son drapeau à jour et renvoie le statut).
useSettings.subscribe((state, prev) => {
  if (!desk || state.settings.orchestratorAllowWrite === prev.settings.orchestratorAllowWrite) return;
  const allow = state.settings.orchestratorAllowWrite;
  const current = useAgent.getState().orchestrator;
  if (current.running) {
    void desk.orchestrator
      .start(current.port || state.settings.orchestratorPort, allow)
      .then((status) => useAgent.setState({ orchestrator: status }))
      .catch(() => undefined);
  }
  // Même drapeau pour la passerelle MCP : le main le met à jour sans fermer les liens.
  const gateway = useAgent.getState().mcp;
  if (gateway.running && desk.mcp) {
    void desk.mcp
      .start(gateway.port || state.settings.mcpPort, allow)
      .then((status) => useAgent.setState({ mcp: status }))
      .catch(() => undefined);
  }
});

