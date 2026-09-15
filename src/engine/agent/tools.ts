import { generateNasdaqEvents } from '@/engine/calendar';
import { computeDailyStats, computeTradeStats } from '@/engine/metrics';
import { evaluatePlan, findPlan } from '@/engine/propfirm';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useNotes } from '@/store/notes';
import { useSettings } from '@/store/settings';
import type { ToolSchema } from './llm';

export interface DeskTool extends ToolSchema {
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

const round = (v: number, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Outils natifs exposés à l'agent IA et à l'orchestrateur externe (même contrat). */
export const DESK_TOOLS: DeskTool[] = [
  {
    name: 'desk_overview',
    description: 'Vue d’ensemble du journal : nombre de séances, PnL net, taux de réussite, profit factor, espérance, Sharpe, drawdown max, statut du plan prop firm suivi.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const { sessions, trades } = useJournal.getState();
      const { settings } = useSettings.getState();
      const t = computeTradeStats(trades);
      const d = computeDailyStats(sessions, settings.startingBalance);
      const plan = findPlan(settings.planId);
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
      const list = useJournal
        .getState()
        .sessions.filter((s) => (!from || s.date >= from) && (!to || s.date <= to))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit)
        .map((s) => ({ id: s.id, date: s.date, account: s.account, pnl: round(s.pnl), trades: s.tradeCount, tags: s.tags, rating: s.rating, note: s.note }));
      return { count: list.length, sessions: list };
    },
  },
  {
    name: 'get_session',
    description: 'Détail d’une séance et de ses trades (par id ou par date YYYY-MM-DD).',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, date: { type: 'string' } },
      additionalProperties: false,
    },
    async run(args) {
      const { sessions, trades } = useJournal.getState();
      const id = str(args.id);
      const date = str(args.date);
      const s = sessions.find((x) => x.id === id) ?? sessions.find((x) => x.date === date);
      if (!s) return { error: 'Séance introuvable' };
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
      await useJournal.getState().updateSession(id, patch);
      return { ok: true };
    },
  },
  {
    name: 'search_notes',
    description: 'Recherche plein texte dans le coffre de notes (titre, corps, tags). Retourne des extraits.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'], additionalProperties: false },
    async run(args) {
      const q = str(args.query).toLowerCase();
      const limit = Math.min(50, Math.max(1, num(args.limit, 10)));
      const hits = useNotes
        .getState()
        .notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)))
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
    description: 'Lit une note complète par titre exact ou id.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, additionalProperties: false },
    async run(args) {
      const { notes } = useNotes.getState();
      const id = str(args.id);
      const title = str(args.title).toLowerCase();
      const n = notes.find((x) => x.id === id) ?? notes.find((x) => x.title.toLowerCase() === title);
      return n ? { id: n.id, title: n.title, tags: n.tags, body: n.body, updatedAt: new Date(n.updatedAt).toISOString() } : { error: 'Note introuvable' };
    },
  },
  {
    name: 'create_note',
    description: 'Crée une note Markdown dans le coffre (les [[liens]] et #tags sont reconnus).',
    parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['title', 'body'], additionalProperties: false },
    async run(args) {
      const n = await useNotes.getState().create(str(args.title, 'Note'), str(args.body), Array.isArray(args.tags) ? args.tags.map(String) : []);
      return { id: n.id, title: n.title };
    },
  },
  {
    name: 'calendar_events',
    description: 'Événements Nasdaq (FOMC, NFP, CPI, expirations, fériés…) et entrées personnelles entre deux dates.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'], additionalProperties: false },
    async run(args) {
      const from = str(args.from);
      const to = str(args.to);
      const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
      const events = [...years].flatMap((y) => generateNasdaqEvents(y)).filter((e) => e.date >= from && e.date <= to);
      const perso = useCalendar.getState().entries.filter((e) => e.date >= from && e.date <= to);
      return {
        events: events.map((e) => ({ date: e.date, timeET: e.timeET, title: e.title, impact: e.impact, category: e.category, estimated: e.estimated })),
        personal: perso.map((e) => ({ date: e.date, time: e.time, kind: e.kind, title: e.title, body: e.body })),
      };
    },
  },
  {
    name: 'propfirm_status',
    description: 'Rejoue le journal contre le plan prop firm suivi : solde, plancher, marge, progression vers l’objectif, règle de consistance.',
    parameters: { type: 'object', properties: { planId: { type: 'string', description: 'Identifiant de plan (défaut : plan suivi dans les réglages)' } }, additionalProperties: false },
    async run(args) {
      const { sessions, trades } = useJournal.getState();
      const { settings } = useSettings.getState();
      const plan = findPlan(str(args.planId) || settings.planId);
      if (!plan) return { error: 'Plan inconnu' };
      const r = evaluatePlan(plan, sessions, trades);
      return { plan, status: r.status, reason: r.reason, failedOn: r.failedOn, balance: round(r.balance), highWater: round(r.highWater), floor: round(r.floor), buffer: round(r.buffer), targetProgress: round(r.targetProgress, 4), remainingToTarget: round(r.remainingToTarget), daysTraded: r.daysTraded, consistency: r.consistency, dailyLossBreaches: r.dailyLossBreaches };
    },
  },
];

export function toolSchemas(): ToolSchema[] {
  return DESK_TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

export async function runTool(name: string, rawArgs: string | Record<string, unknown>): Promise<unknown> {
  const tool = DESK_TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Outil inconnu : ${name}` };
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === 'string') {
    try {
      args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      return { error: 'Arguments JSON invalides' };
    }
  } else args = rawArgs ?? {};
  try {
    return await tool.run(args);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
