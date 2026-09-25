import { generateNasdaqEvents } from '@/engine/calendar';
import { tr } from '@/i18n';
import { computeDailyStats, computeTradeStats } from '@/engine/metrics';
import { evaluatePlan, findPlan } from '@/engine/propfirm';
import type { ToolSchema } from './llm';
import { clampToolArgs, type DeskPorts } from './ports';

export interface DeskTool extends ToolSchema {
  kind: 'read' | 'write';
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const round = (v: number, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Propriétés déclarées dans le schéma d'un outil (tout autre argument est retiré avant exécution). */
function declaredKeys(tool: DeskTool | undefined): readonly string[] {
  const props = (tool?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties;
  return props ? Object.keys(props) : [];
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Outils natifs exposés à l'agent IA et à l'orchestrateur externe (même contrat). */
function createDeskTools(ports: DeskPorts): DeskTool[] {
  return [
    {
      name: 'desk_overview',
      kind: 'read',
      description: 'Vue d’ensemble du journal : nombre de séances, PnL net, taux de réussite, profit factor, espérance, Sharpe, drawdown max, statut du plan prop firm suivi.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const sessions = ports.sessions();
        const trades = ports.trades();
        const t = computeTradeStats(trades);
        const d = computeDailyStats(sessions, ports.startingBalance());
        const plan = findPlan(ports.planId());
        const evalr = plan ? evaluatePlan(plan, sessions, trades) : null;
        return {
          sessions: sessions.length,
          trades: t.count,
          netPnl: round(t.netPnl),
          winRate: round(t.winRate, 4),
          profitFactor: round(t.profitFactor),
          expectancy: round(t.expectancy),
          payoffRatio: round(t.payoffRatio),
          sqn: round(t.sqn),
          maxDrawdownTrades: round(t.maxDrawdown),
          sharpeDaily: round(d.sharpe),
          sortinoDaily: round(d.sortino),
          maxDrawdownDaily: round(d.maxDrawdown),
          winDayRate: round(d.winDayRate, 4),
          bestDay: round(d.bestDay),
          worstDay: round(d.worstDay),
          consistencyShare: round(d.consistency, 4),
          plan: plan ? { id: plan.id, firm: plan.firm, label: plan.label, status: evalr?.status, balance: round(evalr?.balance ?? 0), floor: round(evalr?.floor ?? 0), buffer: round(evalr?.buffer ?? 0), targetProgress: round(evalr?.targetProgress ?? 0, 4) } : null,
        };
      },
    },
    {
      name: 'list_sessions',
      kind: 'read',
      description: 'Liste les séances de trading (date, PnL, nombre de trades, tags, note), les plus récentes d’abord. Filtre optionnel par bornes de dates YYYY-MM-DD.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Date de début incluse (YYYY-MM-DD)' },
          to: { type: 'string', description: 'Date de fin incluse (YYYY-MM-DD)' },
          limit: { type: 'number', description: 'Nombre max de séances (défaut 30)' },
        },
        additionalProperties: false,
      },
      async run(args) {
        const from = str(args.from);
        const to = str(args.to);
        const limit = Math.min(200, Math.max(1, num(args.limit, 30)));
        const list = ports
          .sessions()
          .filter((s) => (!from || s.date >= from) && (!to || s.date <= to))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, limit)
          .map((s) => ({ id: s.id, date: s.date, account: s.account, pnl: round(s.pnl), trades: s.tradeCount, tags: s.tags, rating: s.rating, note: s.note }));
        return { count: list.length, sessions: list };
      },
    },
    {
      name: 'get_session',
      kind: 'read',
      description: 'Détail d’une séance et de ses trades (par id ou par date YYYY-MM-DD).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, date: { type: 'string' } },
        additionalProperties: false,
      },
      async run(args) {
        const sessions = ports.sessions();
        const trades = ports.trades();
        const id = str(args.id);
        const date = str(args.date);
        const s = sessions.find((x) => x.id === id) ?? sessions.find((x) => x.date === date);
        if (!s) return { error: tr('Séance introuvable', 'Session not found', 'Sesión no encontrada') };
        const own = trades.filter((t) => t.sessionId === s.id).sort((a, b) => a.exitTime - b.exitTime);
        const stats = computeTradeStats(own);
        return {
          session: s,
          stats: { winRate: round(stats.winRate, 4), profitFactor: round(stats.profitFactor), expectancy: round(stats.expectancy), maxDrawdown: round(stats.maxDrawdown), avgDurationMin: round(stats.avgDurationMs / 60000, 1) },
          trades: own.map((t) => ({ id: t.id, instrument: t.instrument, direction: t.direction, qty: t.qty, entry: new Date(t.entryTime).toISOString(), exit: new Date(t.exitTime).toISOString(), entryPrice: t.entryPrice, exitPrice: t.exitPrice, pnl: round(t.pnl), mae: t.mae, mfe: t.mfe, strategy: t.strategy, tags: t.tags })),
        };
      },
    },
    {
      name: 'annotate_session',
      kind: 'write',
      description: 'Ajoute ou remplace la note d’une séance et/ou ses tags.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, note: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
        required: ['id'],
        additionalProperties: false,
      },
      async run(args) {
        const id = str(args.id);
        const patch: { note?: string; tags?: string[] } = {};
        if (typeof args.note === 'string') patch.note = args.note;
        if (Array.isArray(args.tags)) patch.tags = args.tags.map(String);
        await ports.updateSession(id, patch);
        return { ok: true };
      },
    },
    {
      name: 'search_notes',
      kind: 'read',
      description: 'Recherche plein texte dans le coffre de notes (titre, corps, tags). Retourne des extraits.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'], additionalProperties: false },
      async run(args) {
        const q = str(args.query).toLowerCase();
        const limit = Math.min(50, Math.max(1, num(args.limit, 10)));
        const hits = ports
          .notes()
          .filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)))
          .slice(0, limit)
          .map((n) => {
            const i = n.body.toLowerCase().indexOf(q);
            return { id: n.id, title: n.title, tags: n.tags, excerpt: i >= 0 ? n.body.slice(Math.max(0, i - 80), i + 160) : n.body.slice(0, 200) };
          });
        return { count: hits.length, notes: hits };
      },
    },
    {
      name: 'read_note',
      kind: 'read',
      description: 'Lit une note complète par titre exact ou id.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, additionalProperties: false },
      async run(args) {
        const notes = ports.notes();
        const id = str(args.id);
        const title = str(args.title).toLowerCase();
        const n = notes.find((x) => x.id === id) ?? notes.find((x) => x.title.toLowerCase() === title);
        return n ? { id: n.id, title: n.title, tags: n.tags, body: n.body, updatedAt: new Date(n.updatedAt).toISOString() } : { error: tr('Note introuvable', 'Note not found', 'Nota no encontrada') };
      },
    },
    {
      name: 'create_note',
      kind: 'write',
      description: 'Crée une note Markdown dans le coffre (les [[liens]] et #tags sont reconnus).',
      parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title', 'body'], additionalProperties: false },
      async run(args) {
        const n = await ports.createNote(str(args.title, 'Note'), str(args.body), Array.isArray(args.tags) ? args.tags.map(String) : []);
        return { id: n.id, title: n.title };
      },
    },
    {
      name: 'calendar_events',
      kind: 'read',
      description: 'Événements Nasdaq (FOMC, NFP, CPI, expirations, fériés…) et entrées personnelles entre deux dates.',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'], additionalProperties: false },
      async run(args) {
        const from = str(args.from);
        const to = str(args.to);
        if (!DATE_RE.test(from) || !DATE_RE.test(to)) return { error: tr('Dates attendues au format YYYY-MM-DD', 'Dates expected in YYYY-MM-DD format', 'Fechas esperadas en formato YYYY-MM-DD') };
        const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
        const events = [...years].flatMap((y) => generateNasdaqEvents(y)).filter((e) => e.date >= from && e.date <= to);
        const perso = ports.calendarEntries().filter((e) => e.date >= from && e.date <= to);
        return {
          events: events.map((e) => ({ date: e.date, timeET: e.timeET, title: e.title, impact: e.impact, category: e.category, estimated: e.estimated })),
          personal: perso.map((e) => ({ date: e.date, time: e.time, kind: e.kind, title: e.title, body: e.body })),
        };
      },
    },
    {
      name: 'propfirm_status',
      kind: 'read',
      description: 'Rejoue le journal contre le plan prop firm suivi : solde, plancher, marge, progression vers l’objectif, règle de consistance.',
      parameters: { type: 'object', properties: { planId: { type: 'string', description: 'Identifiant de plan (défaut : plan suivi dans les réglages)' } }, additionalProperties: false },
      async run(args) {
        const sessions = ports.sessions();
        const trades = ports.trades();
        const plan = findPlan(str(args.planId) || ports.planId());
        if (!plan) return { error: tr('Plan inconnu', 'Unknown plan', 'Plan desconocido') };
        const r = evaluatePlan(plan, sessions, trades);
        return { plan, status: r.status, reason: r.reason, failedOn: r.failedOn, balance: round(r.balance), highWater: round(r.highWater), floor: round(r.floor), buffer: round(r.buffer), targetProgress: round(r.targetProgress, 4), remainingToTarget: round(r.remainingToTarget), daysTraded: r.daysTraded, consistency: r.consistency, dailyLossBreaches: r.dailyLossBreaches };
      },
    },
  ];
}

const EMPTY_PORTS: DeskPorts = {
  sessions: () => [],
  trades: () => [],
  startingBalance: () => 0,
  planId: () => '',
  updateSession: async () => undefined,
  notes: () => [],
  createNote: async () => ({ id: '', title: '' }),
  calendarEntries: () => [],
};

/** Catalogue (affichage UI) — les `run` de ce tableau ne touchent pas les stores. */
export const DESK_TOOLS: DeskTool[] = createDeskTools(EMPTY_PORTS);

/** Description d'outil dans la langue active (le catalogue stocke le français). */
export function toolBlurb(name: string, fallback: string): string {
  switch (name) {
    case 'desk_overview':
      return tr(fallback, 'Journal overview: session count, net PnL, win rate, profit factor, expectancy, Sharpe, max drawdown, tracked prop-firm plan status.', 'Vista del diario: número de sesiones, PnL neto, tasa de acierto, profit factor, esperanza, Sharpe, drawdown máx., estado del plan prop firm seguido.');
    case 'list_sessions':
      return tr(fallback, 'Lists trading sessions (date, PnL, trade count, tags, note), newest first. Optional YYYY-MM-DD date bounds.', 'Lista las sesiones (fecha, PnL, número de trades, etiquetas, nota), las más recientes primero. Filtro opcional por fechas YYYY-MM-DD.');
    case 'get_session':
      return tr(fallback, 'Detail of a session and its trades (by id or YYYY-MM-DD date).', 'Detalle de una sesión y sus trades (por id o por fecha YYYY-MM-DD).');
    case 'annotate_session':
      return tr(fallback, 'Adds or replaces a session note and/or its tags.', 'Añade o sustituye la nota de una sesión y/o sus etiquetas.');
    case 'search_notes':
      return tr(fallback, 'Full-text search in the note vault (title, body, tags). Returns excerpts.', 'Búsqueda de texto en la caja de notas (título, cuerpo, etiquetas). Devuelve extractos.');
    case 'read_note':
      return tr(fallback, 'Reads a full note by exact title or id.', 'Lee una nota completa por título exacto o id.');
    case 'create_note':
      return tr(fallback, 'Creates a Markdown note in the vault ([[links]] and #tags are recognized).', 'Crea una nota Markdown en la caja (se reconocen [[enlaces]] y #tags).');
    case 'calendar_events':
      return tr(fallback, 'Nasdaq events (FOMC, NFP, CPI, expirations, holidays…) and personal entries between two dates.', 'Eventos Nasdaq (FOMC, NFP, CPI, vencimientos, festivos…) y entradas personales entre dos fechas.');
    case 'propfirm_status':
      return tr(fallback, 'Replays the journal against the tracked prop-firm plan: balance, floor, buffer, progress to target, consistency rule.', 'Rejuega el diario contra el plan prop firm seguido: saldo, suelo, margen, progreso hacia el objetivo, regla de consistencia.');
    default:
      return fallback;
  }
}

export function toolSchemas(): ToolSchema[] {
  return DESK_TOOLS.map(({ name, description, parameters }) => ({ name, description: toolBlurb(name, description), parameters }));
}

export function toolKind(name: string): 'read' | 'write' {
  return DESK_TOOLS.find((t) => t.name === name)?.kind ?? 'read';
}

async function runTool(ports: DeskPorts, name: string, rawArgs: string | Record<string, unknown>): Promise<unknown> {
  const tool = createDeskTools(ports).find((t) => t.name === name);
  if (!tool) return { error: tr(`Outil inconnu : ${name}`, `Unknown tool: ${name}`, `Herramienta desconocida: ${name}`) };
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === 'string') {
    try {
      args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      return { error: tr('Arguments JSON invalides', 'Invalid JSON arguments', 'Argumentos JSON inválidos') };
    }
  } else args = rawArgs ?? {};
  const clamped = clampToolArgs(args, declaredKeys(tool));
  if (!clamped.ok) return { ok: false, reason: clamped.reason };
  try {
    return await tool.run(clamped.args);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export type ToolSource = 'llm' | 'orch';

export interface ExecuteCtx {
  source: ToolSource;
  allowWrite?: boolean;
  confirmFn?: (title: string, detail: string) => Promise<boolean>;
}

const KNOWN_TOOLS = new Set(DESK_TOOLS.map((t) => t.name));

const PREVIEW_BODY_MAX = 2000;
const PREVIEW_KNOWN = new Set(['title', 'id', 'tags', 'body', 'note']);

/** Aperçu lisible pour la confirmation d'écriture : titre, tags, séance cible, corps (≤ 2000 car., tronqué explicitement). */
function previewArgs(args: Record<string, unknown>): string {
  const truncated = tr('(tronqué)', '(truncated)', '(truncado)');
  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}… ${truncated}` : s);
  const parts: string[] = [];
  if (typeof args.title === 'string') parts.push(`${tr('Titre', 'Title', 'Título')} : ${clip(args.title, 200)}`);
  if (typeof args.id === 'string') parts.push(`${tr('Séance cible', 'Target session', 'Sesión objetivo')} : ${clip(args.id, 64)}`);
  if (Array.isArray(args.tags)) parts.push(`Tags : ${clip(args.tags.map(String).join(', '), 400)}`);
  const body = typeof args.body === 'string' ? args.body : typeof args.note === 'string' ? args.note : undefined;
  if (body !== undefined) {
    const label = typeof args.body === 'string' ? tr('Corps', 'Body', 'Cuerpo') : tr('Note', 'Note', 'Nota');
    parts.push(`${label} (${body.length} ${tr('caractères', 'characters', 'caracteres')}) :\n${clip(body, PREVIEW_BODY_MAX)}`);
  }
  const rest = Object.fromEntries(Object.entries(args).filter(([k]) => !PREVIEW_KNOWN.has(k)));
  if (Object.keys(rest).length) {
    try {
      parts.push(clip(JSON.stringify(rest), 400));
    } catch {
      /* argument non sérialisable : ignoré dans l'aperçu */
    }
  }
  return parts.join('\n');
}

function parseArgs(args: string | Record<string, unknown>): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof args === 'string') {
    try {
      const parsed = args ? (JSON.parse(args) as unknown) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: tr('Arguments JSON invalides', 'Invalid JSON arguments', 'Argumentos JSON inválidos') };
      return { ok: true, args: parsed as Record<string, unknown> };
    } catch {
      return { ok: false, error: tr('Arguments JSON invalides', 'Invalid JSON arguments', 'Argumentos JSON inválidos') };
    }
  }
  return { ok: true, args: args ?? {} };
}

/** Seul point d’entrée public : confirm LLM, allowWrite orch, allowlist, cap body/note. */
export async function executeDeskTool(ports: DeskPorts, name: string, args: string | Record<string, unknown>, ctx: ExecuteCtx): Promise<unknown> {
  if (!KNOWN_TOOLS.has(name)) return { ok: false, reason: 'unknown_tool' };
  const parsed = parseArgs(args);
  if (!parsed.ok) return { error: parsed.error };
  const clamped = clampToolArgs(parsed.args, declaredKeys(DESK_TOOLS.find((t) => t.name === name)));
  if (!clamped.ok) return { ok: false, reason: clamped.reason };
  if (toolKind(name) === 'write') {
    if (ctx.source === 'orch' && ctx.allowWrite !== true) return { ok: false, reason: 'write_disabled' };
    if (ctx.source === 'llm') {
      const ok = ctx.confirmFn
        ? await ctx.confirmFn(
            tr(`L’agent veut exécuter « ${name} »`, `The agent wants to run “${name}”`, `El agente quiere ejecutar « ${name} »`),
            `${tr('Arguments', 'Arguments', 'Argumentos')} :\n${previewArgs(clamped.args)}`,
          )
        : false;
      if (!ok) return { ok: false, reason: 'operator_denied' };
    }
  }
  return runTool(ports, name, clamped.args);
}
