import { generateNasdaqEvents } from '@/engine/calendar';
import { defaultParams, indicatorById } from '@/engine/indicators';
import { resolveSymbol } from '@/engine/instruments';
import { mergeCalendarEvents } from '@/engine/macroMerge';
import { PREDICATES, linkId, type Predicate } from '@/engine/ontology/schema';
import { tr } from '@/i18n';
import { aggregateByDate, computeDailyStats, computeTradeStats, sessionDates, type Bucket } from '@/engine/metrics';
import { monteCarlo } from '@/engine/montecarlo';
import { bridgeSnapshots, portfolioView } from '@/engine/portfolio/view';
import { evaluatePlan, findPlan, planMargin, type PropEvaluation } from '@/engine/propfirm';
import type { Bar, BarSeries } from '@/engine/bars';
import type { Session, Trade } from '@/engine/types';
import type { ToolSchema } from './llm';
import { DESK_EVENT_KINDS, isDeskEventKind, ORDER_TOOLS } from './catalog';
import { EVENTS_PAGE_DEFAULT, EVENTS_PAGE_MAX } from './events';
import { clampToolArgs, type DeskPorts } from './ports';

export interface DeskTool extends ToolSchema {
  kind: 'read' | 'write';
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Une plage de dates longue produirait des milliers de lignes : le modèle n'en lit pas autant. */
const CALENDAR_MAX_YEARS = 3;
const CALENDAR_MAX_EVENTS = 300;
/** Projection bornée : l'outil s'exécute dans le renderer, sans worker (≤ 500 000 tirages). */
const MC_MAX_RUNS = 2000;
const MC_MAX_HORIZON = 250;
const MC_MIN_DAYS = 10;
const MC_SEED = 1337;
/** Indicateurs calculés sur les dernières barres seulement (≈ 17 jours en 1 min). */
const LEVELS_MAX_BARS = 25_000;

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

/** Séances d'une plage de dates et d'un compte ('' = tous), et leurs trades. */
function journalSlice(ports: DeskPorts, args: Record<string, unknown>): { sessions: Session[]; trades: Trade[]; account: string } {
  const from = str(args.from);
  const to = str(args.to);
  const account = str(args.account);
  const sessions = ports.sessions().filter((s) => (!from || s.date >= from) && (!to || s.date <= to) && (!account || (s.account ?? '') === account));
  const ids = new Set(sessions.map((s) => s.id));
  return { sessions, trades: ports.trades().filter((t) => ids.has(t.sessionId)), account };
}

/** Comptes nommés d'une liste de séances, triés : la liste du sélecteur de l'écran Métrique. */
function accountsOf(sessions: readonly Session[]): string[] {
  return [...new Set(sessions.map((s) => s.account).filter((name): name is string => !!name))].sort();
}

/** Dernière valeur d'une ligne d'indicateur, ou null. */
function lastLine(bars: Bar[], id: string, key: string, params: Record<string, number | string> = {}): number | null {
  const def = indicatorById(id);
  if (!def || !bars.length) return null;
  const line = def.compute(bars, { ...defaultParams(def), ...params }).lines.find((l) => l.key === key);
  for (let i = (line?.data.length ?? 0) - 1; i >= 0; i--) {
    const v = line?.data[i]?.value;
    if (v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

/** Pont vivant d'abord, puis CSV, puis démo ; à unité égale, la plus fine. */
const SOURCE_RANK: Record<string, number> = { 'nt8-bridge': 0, csv: 1, demo: 2 };
function pickSeries(all: BarSeries[], symbol: string | null, timeframe: number | null): BarSeries | undefined {
  return all
    .filter((s) => s.bars.length > 0 && (!symbol || s.instrument === symbol) && (!timeframe || s.timeframe === timeframe))
    .sort((a, b) => (SOURCE_RANK[a.source] ?? 1) - (SOURCE_RANK[b.source] ?? 1) || a.timeframe - b.timeframe)[0];
}

const SLICE_PARAMS = {
  from: { type: 'string', description: 'Date de début incluse (YYYY-MM-DD)' },
  to: { type: 'string', description: 'Date de fin incluse (YYYY-MM-DD)' },
  account: { type: 'string', description: 'Compte (défaut : tous les comptes)' },
} as const;

/**
 * Marge datée de la jauge K.04 (`planMargin`) : plus-bas de la dernière séance rejouée, excursions
 * défavorables comprises, moins le plancher. Plus prudente que `buffer` (clôture − plancher).
 */
function datedMargin(ev: PropEvaluation): { date: string; lastLow: number | null; floor: number | null; margin: number | null } | null {
  const m = planMargin(ev);
  return m ? { date: m.date, lastLow: round(m.lastLow), floor: round(m.floor), margin: round(m.margin) } : null;
}

function buckets(list: Bucket[]) {
  return list.filter((b) => b.count > 0).map((b) => ({ key: b.key, trades: b.count, pnl: round(b.pnl), winRate: round(b.winRate, 4) }));
}

/** Outils natifs exposés à l'agent IA et à l'orchestrateur externe (même contrat). */
function createDeskTools(ports: DeskPorts): DeskTool[] {
  return [
    {
      name: 'desk_overview',
      kind: 'read',
      description:
        'Vue d’ensemble du journal : nombre de séances, PnL net, taux de réussite, profit factor, espérance, Sharpe, drawdown max, statut du plan prop firm suivi (sur le compte suivi par l’écran Métrique). Filtres optionnels de période et de compte, comme le Tableau de bord : Sharpe et Sortino s’annualisent sur les journées de cotation de la période (`tradingDays`, jours sans séance à 0) ; sans `to`, la période s’arrête à la dernière séance. Le plan suivi est toujours rejoué sur tout l’historique de son compte. Pour le plan : `buffer` = solde de clôture − plancher ; `margin` = plus-bas de la dernière séance rejouée (excursions comprises) − plancher, daté (`margin.date`), la marge de la jauge K.04, plus prudente ; le rejeu s’arrête à l’objectif atteint (`passedOn`) ou à l’échec.',
      parameters: { type: 'object', properties: { ...SLICE_PARAMS }, additionalProperties: false },
      async run(args) {
        const from = str(args.from);
        const to = str(args.to);
        const sliced = !!(from || to || str(args.account));
        // Sans tranche : tout le journal tel quel (trades sans séance compris), comme avant les filtres.
        const slice = sliced ? journalSlice(ports, args) : null;
        const sessions = slice?.sessions ?? ports.sessions();
        const trades = slice?.trades ?? ports.trades();
        const t = computeTradeStats(trades);
        const d = computeDailyStats(sessions, ports.startingBalance(), undefined, { from: from || undefined, to: to || undefined });
        const plan = findPlan(ports.planId());
        const planAccount = ports.planAccount();
        // Le plancher dépend de tout l'historique du compte : jamais la tranche.
        const evalr = plan ? evaluatePlan(plan, ports.sessions(), ports.trades(), planAccount || undefined) : null;
        return {
          ...(slice ? { slice: { from: from || null, to: to || null, account: slice.account || null } } : {}),
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
          tradingDays: d.tradingDays,
          plan: plan
            ? {
                id: plan.id,
                firm: plan.firm,
                label: plan.label,
                account: planAccount || null,
                status: evalr?.status,
                balance: round(evalr?.balance ?? 0),
                floor: round(evalr?.floor ?? 0),
                buffer: round(evalr?.buffer ?? 0),
                margin: evalr ? datedMargin(evalr) : null,
                passedOn: evalr?.passedOn ?? null,
                targetProgress: round(evalr?.targetProgress ?? 0, 4),
              }
            : null,
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
            return { id: n.id, title: n.title, tags: n.tags, ...(n.by ? { by: n.by } : {}), excerpt: i >= 0 ? n.body.slice(Math.max(0, i - 80), i + 160) : n.body.slice(0, 200) };
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
        if (!n) return { error: tr('Note introuvable', 'Note not found', 'Nota no encontrada') };
        const children = notes.filter((x) => x.parentId === n.id).map((x) => x.title);
        return {
          id: n.id,
          title: n.title,
          tags: n.tags,
          body: n.body,
          updatedAt: new Date(n.updatedAt).toISOString(),
          ...(n.by ? { by: n.by } : {}),
          ...(n.parentId ? { parentId: n.parentId } : {}),
          ...(n.ancre ? { ancre: n.ancre } : {}),
          ...(n.question ? { question: n.question } : {}),
          ...(children.length ? { children } : {}),
        };
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
      name: 'branch_note',
      kind: 'write',
      description: 'Ouvre une note enfant : question, ancre du passage, lien vers le parent. Le corps du parent n’est pas copié.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' }, ancre: { type: 'string' }, question: { type: 'string' } },
        required: ['ancre', 'question'],
        additionalProperties: false,
      },
      async run(args) {
        const notes = ports.notes();
        const id = str(args.id);
        const title = str(args.title).toLowerCase();
        const parent = notes.find((x) => x.id === id) ?? notes.find((x) => x.title.toLowerCase() === title);
        if (!parent) return { error: tr('Note introuvable', 'Note not found', 'Nota no encontrada') };
        const child = await ports.branchNote(parent.id, str(args.ancre), str(args.question));
        if (!child) return { error: tr('Note introuvable', 'Note not found', 'Nota no encontrada') };
        return { id: child.id, title: child.title };
      },
    },
    {
      name: 'link_notes',
      kind: 'write',
      description: 'Relie deux notes par un prédicat déjà connu. N’invente pas de relation.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' }, predicate: { type: 'string' } },
        required: ['from', 'to', 'predicate'],
        additionalProperties: false,
      },
      async run(args) {
        const predicate = str(args.predicate);
        if (!(PREDICATES as readonly string[]).includes(predicate)) return { error: tr('Prédicat refusé', 'Predicate refused', 'Predicado rechazado') };
        const notes = ports.notes();
        const find = (key: string) => notes.find((x) => x.id === key) ?? notes.find((x) => x.title.toLowerCase() === key.toLowerCase());
        const from = find(str(args.from));
        const to = find(str(args.to));
        if (!from || !to || from.id === to.id) return { error: tr('Note introuvable', 'Note not found', 'Nota no encontrada') };
        const linked = await ports.linkNotes(from.id, to.id, predicate);
        if (!linked) return { error: tr('Prédicat refusé', 'Predicate refused', 'Predicado rechazado') };
        return { id: linked.id || linkId({ type: 'note', id: from.id }, predicate as Predicate, { type: 'note', id: to.id }) };
      },
    },
    {
      name: 'calendar_events',
      kind: 'read',
      description:
        'Catalyseurs entre deux dates (au plus trois années civiles) : sources officielles synchronisées (BLS, BEA, Federal Reserve, BCE, EIA, Treasury, instantané embarqué) fusionnées avec les repères locaux (fériés, séances, expirations CME estimées), puis entrées personnelles. Chaque événement porte sa source et `estimated` quand la date est déduite.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Date de début incluse (YYYY-MM-DD)' },
          to: { type: 'string', description: 'Date de fin incluse (YYYY-MM-DD)' },
          minImpact: { type: 'number', description: 'Impact minimal 1 (mineur) à 3 (majeur), défaut 1' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
      async run(args) {
        const from = str(args.from);
        const to = str(args.to);
        if (!DATE_RE.test(from) || !DATE_RE.test(to)) return { error: tr('Dates attendues au format YYYY-MM-DD', 'Dates expected in YYYY-MM-DD format', 'Fechas esperadas en formato YYYY-MM-DD') };
        if (to < from) return { error: tr('La date de fin précède la date de début', 'The end date is before the start date', 'La fecha final es anterior a la inicial') };
        const fromYear = Number(from.slice(0, 4));
        const toYear = Number(to.slice(0, 4));
        if (toYear - fromYear > CALENDAR_MAX_YEARS - 1) return { error: tr(`Plage limitée à ${CALENDAR_MAX_YEARS} années civiles`, `Range limited to ${CALENDAR_MAX_YEARS} calendar years`, `Rango limitado a ${CALENDAR_MAX_YEARS} años civiles`) };
        const minImpact = Math.min(3, Math.max(1, Math.round(num(args.minImpact, 1))));
        const local: ReturnType<typeof generateNasdaqEvents> = [];
        for (let y = fromYear; y <= toYear; y++) local.push(...generateNasdaqEvents(y));
        const all = mergeCalendarEvents(local, ports.officialEvents()).filter((e) => e.date >= from && e.date <= to && e.impact >= minImpact);
        const events = all.slice(0, CALENDAR_MAX_EVENTS);
        const perso = ports.calendarEntries().filter((e) => e.date >= from && e.date <= to);
        return {
          count: all.length,
          ...(all.length > events.length ? { truncated: true } : {}),
          events: events.map((e) => ({
            date: e.date,
            timeET: e.timeET,
            title: e.title,
            impact: e.impact,
            category: e.category,
            estimated: e.estimated,
            source: e.source ?? 'local',
            ...(e.forecast != null ? { forecast: e.forecast } : {}),
            ...(e.previous != null ? { previous: e.previous } : {}),
            ...(e.actual != null ? { actual: e.actual } : {}),
            ...(e.period ? { period: e.period } : {}),
            ...(e.instruments?.length ? { instruments: e.instruments } : {}),
          })),
          personal: perso.map((e) => ({ date: e.date, time: e.time, kind: e.kind, title: e.title, body: e.body })),
        };
      },
    },
    {
      name: 'journal_breakdown',
      kind: 'read',
      description:
        'Ventilations du journal, comme l’onglet Analyse : par heure d’entrée (heure de New York), par jour de semaine de la séance (journée de cotation CME, 18 h → 17 h ET : un trade du dimanche soir compte le lundi), par instrument, long / short. Filtres optionnels de dates et de compte. Seuls les créneaux qui portent des trades sont rendus.',
      parameters: { type: 'object', properties: { ...SLICE_PARAMS }, additionalProperties: false },
      async run(args) {
        const { sessions, trades, account } = journalSlice(ports, args);
        // Même clé de jour que l'onglet Analyse : la date de la séance de chaque trade.
        const t = computeTradeStats(trades, sessionDates(sessions));
        const dir = (d: typeof t.long) => ({ trades: d.count, pnl: round(d.pnl), winRate: round(d.winRate, 4), avgPnl: round(d.avgPnl) });
        return {
          timezone: 'America/New_York',
          dayBasis: 'cme_session',
          account: account || null,
          trades: t.count,
          netPnl: round(t.netPnl),
          winRate: round(t.winRate, 4),
          byHour: buckets(t.byHour),
          byWeekday: buckets(t.byWeekday),
          byInstrument: buckets(t.byInstrument),
          direction: { long: dir(t.long), short: dir(t.short) },
        };
      },
    },
    {
      name: 'monte_carlo',
      kind: 'read',
      description:
        'Projection Monte Carlo par bootstrap i.i.d. des PnL journaliers (ignore l’autocorrélation) : percentiles du PnL final et du drawdown max, probabilité de ruine et d’objectif. Échantillon de l’onglet Monte-Carlo : un compte, une valeur par journée. Si la tranche couvre plusieurs comptes (comptes copiés), `account` est exigé : sans lui, l’outil rend `account_required` et la liste des comptes ; un seul compte est pris d’office. Par défaut, la ruine est le drawdown max du plan prop suivi et l’objectif son objectif de profit. Graine fixe : résultat reproductible.',
      parameters: {
        type: 'object',
        properties: {
          ...SLICE_PARAMS,
          account: { type: 'string', description: 'Compte simulé (exigé si la tranche en couvre plusieurs)' },
          runs: { type: 'number', description: `Nombre de simulations (défaut 1000, au plus ${MC_MAX_RUNS})` },
          horizon: { type: 'number', description: `Journées simulées (défaut 60, au plus ${MC_MAX_HORIZON})` },
          ruinDrawdown: { type: 'number', description: 'Drawdown ($) qui vaut ruine (défaut : celui du plan suivi)' },
          target: { type: 'number', description: 'Objectif de profit ($) (défaut : celui du plan suivi)' },
        },
        additionalProperties: false,
      },
      async run(args) {
        // Comme l'onglet E : un échantillon ne mélange pas des comptes (copiés, ils compteraient double).
        let chosen = str(args.account);
        if (!chosen) {
          const accounts = accountsOf(journalSlice(ports, { from: args.from, to: args.to }).sessions);
          if (accounts.length > 1) {
            return {
              error: 'account_required',
              message: tr(
                `La période couvre ${accounts.length} comptes : précisez \`account\` (un échantillon ne mélange pas des comptes copiés).`,
                `The range covers ${accounts.length} accounts: set \`account\` (a sample does not mix copied accounts).`,
                `El período abarca ${accounts.length} cuentas: indique \`account\` (una muestra no mezcla cuentas copiadas).`,
              ),
              accounts,
            };
          }
          chosen = accounts[0] ?? '';
        }
        const { sessions, account } = journalSlice(ports, { ...args, account: chosen });
        // Une valeur par journée (séances du même jour réunies) : `monteCarloSample` de l'écran.
        const daily = aggregateByDate(sessions).map((d) => d.pnl);
        if (daily.length < MC_MIN_DAYS) {
          return { error: tr(`Échantillon trop court : ${daily.length} journée(s), ${MC_MIN_DAYS} au moins`, `Sample too short: ${daily.length} day(s), at least ${MC_MIN_DAYS}`, `Muestra demasiado corta: ${daily.length} día(s), al menos ${MC_MIN_DAYS}`) };
        }
        const plan = findPlan(ports.planId());
        const runs = Math.min(MC_MAX_RUNS, Math.max(100, Math.round(num(args.runs, 1000))));
        const horizon = Math.min(MC_MAX_HORIZON, Math.max(5, Math.round(num(args.horizon, 60))));
        const ruinDrawdown = num(args.ruinDrawdown, plan?.maxDrawdown ?? Number.NaN);
        const target = num(args.target, plan?.profitTarget ?? Number.NaN);
        const r = monteCarlo(daily, { runs, horizon, seed: MC_SEED, ruinDrawdown: Number.isFinite(ruinDrawdown) ? ruinDrawdown : undefined, target: Number.isFinite(target) ? target : undefined });
        if (!r) return { error: tr('Projection impossible', 'Projection unavailable', 'Proyección imposible') };
        const pct = (q: typeof r.finalPnl) => ({ p5: round(q.p5), p25: round(q.p25), p50: round(q.p50), p75: round(q.p75), p95: round(q.p95), mean: round(q.mean) });
        return {
          method: 'bootstrap i.i.d. des PnL journaliers',
          account: account || null,
          sampleDays: daily.length,
          runs: r.runs,
          horizon: r.horizon,
          seed: MC_SEED,
          finalPnl: pct(r.finalPnl),
          maxDrawdown: pct(r.maxDrawdown),
          ruinDrawdown: Number.isFinite(ruinDrawdown) ? ruinDrawdown : null,
          ruinProbability: r.ruinProbability === null ? null : round(r.ruinProbability, 4),
          target: Number.isFinite(target) ? target : null,
          targetProbability: r.targetProbability === null ? null : round(r.targetProbability, 4),
        };
      },
    },
    {
      name: 'bridge_status',
      kind: 'read',
      description:
        'État en direct du pont NinjaTrader 8 et du Copieur : lien, latence, canal d’ordres ouvert ou fermé, plafond, comptes (cash, PnL réalisé et latent, positions), Copieur armé ou non, ordres routés, dernier refus. Lecture seule ; pour proposer un ordre au trader : propose_order.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const { nt, copier } = await ports.bridge();
        if (!nt) return { link: 'absent', note: tr('Pont NinjaTrader indisponible dans ce desk.', 'NinjaTrader bridge unavailable in this desk.', 'Puente NinjaTrader no disponible en este desk.'), copier };
        const live = nt.link === 'live';
        return {
          link: nt.link,
          ...(live ? {} : { note: tr('Pont hors ligne : comptes et positions peuvent être périmés.', 'Bridge offline: accounts and positions may be stale.', 'Puente fuera de línea: cuentas y posiciones pueden estar desactualizadas.') }),
          addonVersion: nt.addonVersion,
          heartbeatLatencyMs: nt.heartbeatLatencyMs,
          ordersOpen: nt.ordersOpen,
          maxContractsPerOrder: nt.maxContractsPerOrder,
          accounts: nt.accounts.map((a) => ({
            name: a.name,
            cash: round(a.cashValue),
            realizedPnl: round(a.realizedPnl),
            unrealizedPnl: round(a.unrealizedPnl),
            positions: a.positions.filter((p) => p.quantity !== 0).map((p) => ({ instrument: p.instrument, quantity: p.quantity, avgPrice: p.avgPrice })),
          })),
          copier: copier ? { armed: copier.armed, routed: copier.routed, lastRefusal: copier.lastRefusal } : null,
        };
      },
    },
    {
      name: 'portfolio_snapshot',
      kind: 'read',
      description:
        'Portefeuille consolidé, comme l’écran Portefeuille : valeur nette en devise de base, chaque poche (valeur, latent, marque, raison d’exclusion, distance au plan prop), exposition (notionnel, levier brut, concentration, par classe et par instrument). Les positions futures viennent du pont quand il est vivant.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async run() {
        const [book, { nt }] = await Promise.all([ports.portfolio(), ports.bridge()]);
        const now = Date.now();
        const { valuations, coeur, exposure: expo } = portfolioView({
          ...book,
          sessions: ports.sessions(),
          trades: ports.trades(),
          snapshots: bridgeSnapshots(nt, now),
          now,
        });
        const names = new Map(book.pockets.map((p) => [p.id, p.name]));
        const top = (list: { key: string; notional: number }[]) => list.slice(0, 10).map((b) => ({ key: b.key, notional: round(b.notional) }));
        return {
          base: coeur.currency,
          netValue: round(coeur.netValue),
          bridge: nt?.link ?? 'absent',
          pockets: valuations.map((v) => ({
            name: names.get(v.pocketId) ?? v.pocketId,
            kind: v.kind,
            currency: v.currency,
            equity: v.nativeEquity === null ? null : round(v.nativeEquity),
            equityBase: v.equityBase === null ? null : round(v.equityBase),
            unrealized: v.unrealized === null ? null : round(v.unrealized),
            mark: v.mark,
            ...(v.reason ? { excluded: v.reason } : {}),
            ...(v.prop
              ? { prop: { status: v.prop.status, toDrawdown: round(v.prop.toDrawdown), toDailyLoss: v.prop.toDailyLoss === null ? null : round(v.prop.toDailyLoss), toTarget: round(v.prop.toTarget), alert: v.prop.alert } }
              : {}),
          })),
          exposure: {
            totalNotional: round(expo.totalNotional),
            grossLeverage: expo.grossLeverage === null ? null : round(expo.grossLeverage, 3),
            concentration: round(expo.concentration, 4),
            byClass: top(expo.byClass),
            byInstrument: top(expo.byInstrument),
            notes: expo.notes.map((n) => ({ pocket: names.get(n.pocketId) ?? n.pocketId, text: n.text })),
          },
        };
      },
    },
    {
      name: 'market_levels',
      kind: 'read',
      description:
        'Niveaux de marché d’un instrument du registre à partir des barres du desk (pont NinjaTrader, sinon CSV, sinon démo) : dernier prix, PDH / PDL / PDC, Opening Range RTH, VWAP de séance et ±1σ, ATR 14. La source est nommée ; une série de démo est marquée synthetic : ses prix ne sont pas réels.',
      parameters: {
        type: 'object',
        properties: {
          instrument: { type: 'string', description: 'Racine ou contrat (NQ, MNQ 12-26, ES…). Défaut : la première série disponible' },
          timeframe: { type: 'number', description: 'Unité en minutes (défaut : la plus fine disponible)' },
          openingRangeMinutes: { type: 'number', description: 'Durée de l’Opening Range (5 à 60, défaut 15)' },
        },
        additionalProperties: false,
      },
      async run(args) {
        const raw = str(args.instrument);
        const symbol = raw ? resolveSymbol(raw)?.symbol ?? null : null;
        if (raw && !symbol) return { error: tr(`Instrument hors registre : ${raw}`, `Instrument not in the registry: ${raw}`, `Instrumento fuera del registro: ${raw}`) };
        const tf = typeof args.timeframe === 'number' && Number.isFinite(args.timeframe) ? Math.round(args.timeframe) : null;
        const series = pickSeries(await ports.barSeries(), symbol, tf);
        if (!series) return { error: tr('Aucune barre pour cet instrument dans le desk', 'No bars for this instrument in the desk', 'No hay barras para este instrumento en el desk') };
        const bars = series.bars.slice(-LEVELS_MAX_BARS);
        const last = bars[bars.length - 1]!;
        const orMinutes = Math.min(60, Math.max(5, Math.round(num(args.openingRangeMinutes, 15) / 5) * 5));
        const level = (v: number | null) => (v === null ? null : round(v, 2));
        return {
          instrument: series.instrument,
          series: { label: series.label, source: series.source, timeframe: series.timeframe, bars: bars.length, synthetic: series.source === 'demo' },
          last: { time: new Date(last.time * 1000).toISOString(), close: last.close },
          prevSession: { high: level(lastLine(bars, 'prev-session', 'pdh')), low: level(lastLine(bars, 'prev-session', 'pdl')), close: level(lastLine(bars, 'prev-session', 'pdc')) },
          openingRange: { minutes: orMinutes, high: level(lastLine(bars, 'opening-range', 'orh', { minutes: orMinutes })), low: level(lastLine(bars, 'opening-range', 'orl', { minutes: orMinutes })) },
          vwap: { value: level(lastLine(bars, 'vwap', 'vwap')), up1: level(lastLine(bars, 'vwap', 'up1')), dn1: level(lastLine(bars, 'vwap', 'dn1')) },
          atr14: level(lastLine(bars, 'atr', 'atr', { period: 14 })),
          timezone: 'America/New_York',
        };
      },
    },
    {
      name: 'propose_order',
      kind: 'write',
      description:
        'Propose un ordre au trader, sur un compte Sim seulement. Le desk le montre dans son dialogue (ordre, compte, position avant et après, ta raison) et ne l’envoie qu’après sa confirmation, 45 s au plus, Refuser par défaut. Gardes avant le dialogue : compte Sim, contrats par ordre, position atteinte, propositions par minute, marge du plan prop, canal d’ordres ouvert. Rend status : sent (orderId), declined (le trader a refusé ou n’a pas répondu), refused (garde, avec motif) ou failed (le pont a refusé). Ne propose pas sans raison claire et vérifiable.',
      parameters: {
        type: 'object',
        properties: {
          account: { type: 'string', description: 'Compte NinjaTrader Sim (ex. Sim101)' },
          instrument: { type: 'string', description: 'Nom NinjaTrader complet (ex. MNQ 12-26)' },
          side: { type: 'string', enum: ['buy', 'sell'] },
          qty: { type: 'number', description: 'Contrats, entier ≥ 1' },
          type: { type: 'string', enum: ['market', 'limit', 'stop'], description: 'market par défaut' },
          limit: { type: 'number', description: 'Prix limite (type limit)' },
          stop: { type: 'number', description: 'Prix stop (type stop)' },
          reason: { type: 'string', description: 'Pourquoi cet ordre, en une ou deux phrases : montré tel quel au trader' },
        },
        required: ['account', 'instrument', 'side', 'qty', 'reason'],
        additionalProperties: false,
      },
      async run(args) {
        return ports.proposeOrder(args);
      },
    },
    {
      name: 'desk_events',
      kind: 'read',
      description:
        'Événements du desk : fills NinjaTrader, marge du plan prop suivi sous 50 / 25 / 10 % du drawdown maximal ou franchie (latent du compte compris), catalyseur majeur dans les 15 minutes, changement du lien du pont. Repasser `cursor` pour ne lire que les événements suivants ; sans curseur, les plus récents. Le journal garde les 500 derniers événements du lancement en cours ; `reset` signale un curseur d’un autre lancement.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string', description: 'Curseur rendu par l’appel précédent' },
          kinds: { type: 'array', items: { type: 'string', enum: [...DESK_EVENT_KINDS] }, description: 'Types à lire, tous par défaut' },
          limit: { type: 'number', description: `Événements par page, 1 à ${EVENTS_PAGE_MAX}, défaut ${EVENTS_PAGE_DEFAULT}` },
        },
        additionalProperties: false,
      },
      async run(args) {
        const kinds = Array.isArray(args.kinds) ? args.kinds.filter(isDeskEventKind) : [];
        const page = ports.events({ cursor: str(args.cursor) || undefined, kinds: kinds.length ? kinds : undefined, limit: num(args.limit, EVENTS_PAGE_DEFAULT) });
        return {
          cursor: page.cursor,
          count: page.events.length,
          ...(page.more ? { more: true } : {}),
          ...(page.dropped ? { dropped: page.dropped } : {}),
          ...(page.reset ? { reset: true } : {}),
          events: page.events.map((e) => ({ seq: e.seq, at: new Date(e.at).toISOString(), kind: e.kind, data: e.data })),
        };
      },
    },
    {
      name: 'propfirm_status',
      kind: 'read',
      description:
        'Rejoue le journal contre le plan prop firm suivi : solde, plancher, marge, progression vers l’objectif, règle de consistance. `buffer` = solde de clôture − plancher ; `margin` = plus-bas de la dernière séance rejouée (excursions comprises) − plancher, daté (`margin.date`) : la marge de la jauge K.04, plus prudente. Le rejeu s’arrête à l’objectif atteint (`passedOn`) ou à l’échec (`failedOn`). Par défaut, le plan et le compte suivis par l’écran Métrique.',
      parameters: {
        type: 'object',
        properties: {
          planId: { type: 'string', description: 'Identifiant de plan (défaut : plan suivi dans les réglages)' },
          account: { type: 'string', description: 'Compte à rejouer (défaut : compte suivi ; chaîne vide = tous les comptes)' },
        },
        additionalProperties: false,
      },
      async run(args) {
        const sessions = ports.sessions();
        const trades = ports.trades();
        const plan = findPlan(str(args.planId) || ports.planId());
        if (!plan) return { error: tr('Plan inconnu', 'Unknown plan', 'Plan desconocido') };
        const account = typeof args.account === 'string' ? args.account : ports.planAccount();
        const r = evaluatePlan(plan, sessions, trades, account || undefined);
        return {
          plan,
          account: account || null,
          status: r.status,
          reason: r.reason,
          failedOn: r.failedOn,
          passedOn: r.passedOn ?? null,
          balance: round(r.balance),
          highWater: round(r.highWater),
          floor: round(r.floor),
          buffer: round(r.buffer),
          margin: datedMargin(r),
          targetProgress: round(r.targetProgress, 4),
          remainingToTarget: round(r.remainingToTarget),
          daysTraded: r.daysTraded,
          consistency: r.consistency,
          dailyLossBreaches: r.dailyLossBreaches,
        };
      },
    },
  ];
}

const EMPTY_PORTS: DeskPorts = {
  sessions: () => [],
  trades: () => [],
  startingBalance: () => 0,
  planId: () => '',
  planAccount: () => '',
  updateSession: async () => undefined,
  notes: () => [],
  createNote: async () => ({ id: '', title: '' }),
  branchNote: async () => null,
  linkNotes: async () => null,
  calendarEntries: () => [],
  officialEvents: () => [],
  bridge: async () => ({ nt: null, copier: null }),
  portfolio: async () => ({ pockets: [], positions: [], cash: [], fx: [], base: 'USD' }),
  barSeries: async () => [],
  events: () => ({ cursor: '', events: [], more: false, dropped: 0, reset: false }),
  proposeOrder: async () => ({ ok: false, status: 'refused', reason: 'disabled', detail: '' }),
};

/** Catalogue (affichage UI) — les `run` de ce tableau ne touchent pas les stores. */
export const DESK_TOOLS: DeskTool[] = createDeskTools(EMPTY_PORTS);

/** Description d'outil dans la langue active (le catalogue stocke le français). */
export function toolBlurb(name: string, fallback: string): string {
  switch (name) {
    case 'desk_overview':
      return tr(
        fallback,
        'Journal overview: session count, net PnL, win rate, profit factor, expectancy, Sharpe, max drawdown, tracked prop-firm plan status (on the account tracked by the Metrics screen). Optional range and account filters, as on the Dashboard: Sharpe and Sortino are annualized over the range’s trading days (`tradingDays`, days without a session at 0); without `to`, the range stops at the last session. The tracked plan is always replayed over its account’s whole history. For the plan: `buffer` = closing balance − floor; `margin` = low of the last replayed session (adverse excursions included) − floor, dated (`margin.date`), the K.04 gauge margin, more conservative; the replay stops at the target reached (`passedOn`) or at failure.',
        'Vista del diario: número de sesiones, PnL neto, tasa de acierto, profit factor, esperanza, Sharpe, drawdown máx., estado del plan prop firm seguido (en la cuenta seguida por la pantalla Métricas). Filtros opcionales de período y cuenta, como en el Panel: Sharpe y Sortino se anualizan sobre los días de negociación del período (`tradingDays`, días sin sesión a 0); sin `to`, el período termina en la última sesión. El plan seguido se rejuega siempre sobre todo el historial de su cuenta. Para el plan: `buffer` = saldo de cierre − suelo; `margin` = mínimo de la última sesión rejugada (excursiones adversas incluidas) − suelo, fechado (`margin.date`), el margen del indicador K.04, más prudente; el rejuego se detiene en el objetivo alcanzado (`passedOn`) o en el fracaso.',
      );
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
    case 'branch_note':
      return tr(fallback, 'Opens a child note: question, anchor passage, link to the parent. The parent body is not copied.', 'Abre una nota hija: pregunta, ancla del pasaje, enlace al padre. El cuerpo del padre no se copia.');
    case 'link_notes':
      return tr(fallback, 'Links two notes with an already known predicate. Does not invent a relation.', 'Relaciona dos notas con un predicado ya conocido. No inventa una relación.');
    case 'calendar_events':
      return tr(
        fallback,
        'Catalysts between two dates (at most three calendar years): synced official sources (BLS, BEA, Federal Reserve, ECB, EIA, Treasury, embedded snapshot) merged with local markers (holidays, sessions, estimated CME expirations), then personal entries. Each event carries its source and `estimated` when the date is inferred.',
        'Catalizadores entre dos fechas (como máximo tres años civiles): fuentes oficiales sincronizadas (BLS, BEA, Reserva Federal, BCE, EIA, Treasury, instantánea integrada) fusionadas con las referencias locales (festivos, sesiones, vencimientos CME estimados), y luego entradas personales. Cada evento lleva su fuente y `estimated` cuando la fecha se deduce.',
      );
    case 'journal_breakdown':
      return tr(
        fallback,
        'Journal breakdowns, as on the Analysis tab: by entry hour (New York time), by weekday of the session (CME trading day, 6 pm → 5 pm ET: a Sunday-evening trade counts on Monday), by instrument, long / short. Optional date and account filters. Only slots with trades are returned.',
        'Desgloses del diario, como en la pestaña Análisis: por hora de entrada (hora de Nueva York), por día de la semana de la sesión (jornada de negociación CME, 18 h → 17 h ET: un trade del domingo por la noche cuenta el lunes), por instrumento, largo / corto. Filtros opcionales de fechas y cuenta. Solo se devuelven las franjas con trades.',
      );
    case 'monte_carlo':
      return tr(
        fallback,
        'Monte Carlo projection by i.i.d. bootstrap of daily PnL (ignores autocorrelation): final PnL and max drawdown percentiles, ruin and target probabilities. Sample of the Monte Carlo tab: one account, one value per day. If the range covers several accounts (copied accounts), `account` is required: without it, the tool returns `account_required` and the account list; a single account is taken as is. By default, ruin is the tracked prop plan’s max drawdown and the target its profit target. Fixed seed: reproducible.',
        'Proyección Monte Carlo por bootstrap i.i.d. de los PnL diarios (ignora la autocorrelación): percentiles del PnL final y del drawdown máx., probabilidades de ruina y de objetivo. Muestra de la pestaña Monte Carlo: una cuenta, un valor por día. Si el período abarca varias cuentas (cuentas copiadas), `account` es obligatorio: sin él, la herramienta devuelve `account_required` y la lista de cuentas; una sola cuenta se toma tal cual. Por defecto, la ruina es el drawdown máx. del plan prop seguido y el objetivo su objetivo de beneficio. Semilla fija: reproducible.',
      );
    case 'bridge_status':
      return tr(
        fallback,
        'Live state of the NinjaTrader 8 bridge and the Copier: link, latency, order channel open or closed, ceiling, accounts (cash, realized and unrealized PnL, positions), Copier armed or not, routed orders, last refusal. Read only; to propose an order to the trader: propose_order.',
        'Estado en directo del puente NinjaTrader 8 y del Copiador: enlace, latencia, canal de órdenes abierto o cerrado, techo, cuentas (efectivo, PnL realizado y latente, posiciones), Copiador armado o no, órdenes enrutadas, último rechazo. Solo lectura; para proponer una orden al trader: propose_order.',
      );
    case 'portfolio_snapshot':
      return tr(
        fallback,
        'Consolidated portfolio, as on the Portfolio screen: net value in the base currency, each pocket (value, unrealized, mark, exclusion reason, distance to the prop plan), exposure (notional, gross leverage, concentration, by class and by instrument). Futures positions come from the bridge when it is live.',
        'Cartera consolidada, como en la pantalla Cartera: valor neto en la divisa base, cada bolsillo (valor, latente, marca, motivo de exclusión, distancia al plan prop), exposición (nocional, apalancamiento bruto, concentración, por clase y por instrumento). Las posiciones de futuros vienen del puente cuando está activo.',
      );
    case 'market_levels':
      return tr(
        fallback,
        'Market levels for a registry instrument from the desk’s bars (NinjaTrader bridge, else CSV, else demo): last price, PDH / PDL / PDC, RTH Opening Range, session VWAP and ±1σ, ATR 14. The source is named; a demo series is marked synthetic: its prices are not real.',
        'Niveles de mercado de un instrumento del registro a partir de las barras del desk (puente NinjaTrader, si no CSV, si no demo): último precio, PDH / PDL / PDC, Opening Range RTH, VWAP de sesión y ±1σ, ATR 14. Se nombra la fuente; una serie demo se marca synthetic: sus precios no son reales.',
      );
    case 'propose_order':
      return tr(
        fallback,
        'Proposes an order to the trader, on a Sim account only. The desk shows it in its dialog (order, account, position before and after, your reason) and sends it only after the trader confirms, within 45 s, Decline by default. Guards before the dialog: Sim account, contracts per order, resulting position, proposals per minute, prop plan buffer, order channel open. Returns status: sent (orderId), declined (the trader declined or did not answer), refused (guard, with reason) or failed (the bridge refused). Do not propose without a clear, checkable reason.',
        'Propone una orden al trader, solo en una cuenta Sim. El desk la muestra en su diálogo (orden, cuenta, posición antes y después, tu razón) y solo la envía tras su confirmación, 45 s como máximo, Rechazar por defecto. Controles antes del diálogo: cuenta Sim, contratos por orden, posición resultante, propuestas por minuto, margen del plan prop, canal de órdenes abierto. Devuelve status: sent (orderId), declined (el trader rechazó o no respondió), refused (control, con motivo) o failed (el puente la rechazó). No propongas sin una razón clara y verificable.',
      );
    case 'desk_events':
      return tr(
        fallback,
        'Desk events: NinjaTrader fills, tracked prop plan buffer below 50 / 25 / 10 % of max drawdown or breached (account unrealized included), major catalyst within 15 minutes, bridge link change. Pass `cursor` back to read only the following events; without a cursor, the most recent. The log keeps the last 500 events of the current launch; `reset` flags a cursor from another launch.',
        'Eventos del desk: fills de NinjaTrader, margen del plan prop seguido por debajo del 50 / 25 / 10 % del drawdown máximo o superado (latente de la cuenta incluido), catalizador mayor en los próximos 15 minutos, cambio del enlace del puente. Devolver `cursor` para leer solo los eventos siguientes; sin cursor, los más recientes. El registro guarda los últimos 500 eventos del lanzamiento en curso; `reset` señala un cursor de otro lanzamiento.',
      );
    case 'propfirm_status':
      return tr(
        fallback,
        'Replays the journal against the tracked prop-firm plan: balance, floor, buffer, progress to target, consistency rule. `buffer` = closing balance − floor; `margin` = low of the last replayed session (adverse excursions included) − floor, dated (`margin.date`): the K.04 gauge margin, more conservative. The replay stops at the target reached (`passedOn`) or at failure (`failedOn`). Defaults to the plan and account tracked by the Metrics screen.',
        'Rejuega el diario contra el plan prop firm seguido: saldo, suelo, margen, progreso hacia el objetivo, regla de consistencia. `buffer` = saldo de cierre − suelo; `margin` = mínimo de la última sesión rejugada (excursiones adversas incluidas) − suelo, fechado (`margin.date`): el margen del indicador K.04, más prudente. El rejuego se detiene en el objetivo alcanzado (`passedOn`) o en el fracaso (`failedOn`). Por defecto, el plan y la cuenta seguidos por la pantalla Métricas.',
      );
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
    // Un ordre est confirmé par le dialogue du process principal, pas par celui du renderer.
    if (ctx.source === 'llm' && !ORDER_TOOLS.includes(name)) {
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
