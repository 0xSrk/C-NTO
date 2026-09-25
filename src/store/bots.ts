import { tr } from '@/i18n';
import { create } from 'zustand';
import type { CalEvent } from '@/engine/calendar';
import type { PropPlan } from '@/engine/propfirm';
import { uid } from '@/lib/id';
import { db, type BotBlueprint } from './db';

export type BotRule = BotBlueprint['rules'][number];

const LIVE_STATUSES = new Set(['verrouille', 'reel', 'réel', 'real', 'live', 'locked']);

function coerceBotStatus(status: string): BotBlueprint['status'] {
  const v = status.toLowerCase();
  if (v === 'brouillon' || v === 'backtest' || v === 'papier') return v;
  if (LIVE_STATUSES.has(v)) return 'papier';
  return 'brouillon';
}

export const BOT_TEMPLATES: { id: string; name: string; description: string; rules: Omit<BotRule, 'id'>[] }[] = [
  {
    id: 'orb',
    name: 'ORB 15 min',
    description: 'Cassure de l’opening range des 15 premières minutes RTH, dans le sens de la tendance VWAP.',
    rules: [
      { kind: 'condition', text: 'Heure entre 09:45 et 11:30 ET' },
      { kind: 'condition', text: 'Clôture 1 min au-dessus du OR High (long) ou sous le OR Low (short)' },
      { kind: 'condition', text: 'Prix du même côté que le VWAP de séance' },
      { kind: 'action', text: 'Entrée stop-limit à la cassure, 1 contrat MNQ' },
      { kind: 'action', text: 'Stop initial = milieu de l’opening range · objectif = 1,5 × risque' },
      { kind: 'garde', text: 'Maximum 2 tentatives par séance' },
    ],
  },
  {
    id: 'vwap',
    name: 'VWAP reclaim',
    description: 'Reprise du VWAP après une excursion sous la bande −1σ, en tendance haussière.',
    rules: [
      { kind: 'condition', text: 'EMA 21 > EMA 55 sur 5 min' },
      { kind: 'condition', text: 'Bougie 1 min clôture au-dessus du VWAP après avoir touché −1σ' },
      { kind: 'action', text: 'Entrée au marché, stop sous le plus bas de la bougie de reprise' },
      { kind: 'action', text: 'Sortie partielle à +1σ, solde au trailing EMA 21' },
      { kind: 'garde', text: 'Pas d’entrée après 15:30 ET' },
    ],
  },
];

/** Garde-fous dérivés du plan prop firm et du calendrier : imposés à tout automate. */
function ruleText(text: string): string {
  const copy: Record<string, [string, string]> = {
    'Heure entre 09:45 et 11:30 ET': ['Time between 09:45 and 11:30 ET', 'Hora entre 09:45 y 11:30 ET'],
    'Clôture 1 min au-dessus du OR High (long) ou sous le OR Low (short)': ['1-min close above the OR High (long) or below the OR Low (short)', 'Cierre de 1 min por encima del OR High (largo) o bajo el OR Low (corto)'],
    'Prix du même côté que le VWAP de séance': ['Price on the same side as the session VWAP', 'Precio del mismo lado que el VWAP de la sesión'],
    'Entrée stop-limit à la cassure, 1 contrat MNQ': ['Stop-limit entry on the breakout, 1 MNQ contract', 'Entrada stop-limit en la ruptura, 1 contrato MNQ'],
    'Stop initial = milieu de l’opening range · objectif = 1,5 × risque': ['Initial stop = midpoint of the opening range · target = 1.5 × risk', 'Stop inicial = punto medio del opening range · objetivo = 1,5 × riesgo'],
    'Maximum 2 tentatives par séance': ['Maximum 2 attempts per session', 'Máximo 2 intentos por sesión'],
    'EMA 21 > EMA 55 sur 5 min': ['EMA 21 > EMA 55 on 5 min', 'EMA 21 > EMA 55 en 5 min'],
    'Bougie 1 min clôture au-dessus du VWAP après avoir touché −1σ': ['1-min candle closes above the VWAP after touching −1σ', 'Vela de 1 min cierra por encima del VWAP tras tocar −1σ'],
    'Entrée au marché, stop sous le plus bas de la bougie de reprise': ['Market entry, stop under the low of the reclaim candle', 'Entrada a mercado, stop bajo el mínimo de la vela de recuperación'],
    'Sortie partielle à +1σ, solde au trailing EMA 21': ['Partial exit at +1σ, remainder on a trailing EMA 21', 'Salida parcial en +1σ, resto en trailing EMA 21'],
    'Pas d’entrée après 15:30 ET': ['No entry after 15:30 ET', 'Sin entrada después de las 15:30 ET'],
    'Cassure de l’opening range des 15 premières minutes RTH, dans le sens de la tendance VWAP.': ['Breakout of the opening range from the first 15 RTH minutes, in the direction of the VWAP trend.', 'Ruptura del opening range de los primeros 15 minutos RTH, en el sentido de la tendencia VWAP.'],
    'Reprise du VWAP après une excursion sous la bande −1σ, en tendance haussière.': ['VWAP reclaim after an excursion below the −1σ band, in an uptrend.', 'Recuperación del VWAP tras una excursión bajo la banda −1σ, en tendencia alcista.'],
  };
  const row = copy[text];
  return row ? tr(text, row[0], row[1]) : text;
}

export function deriveGuards(plan: PropPlan | undefined, events: CalEvent[], horizonDays = 7): string[] {
  const out: string[] = [];
  if (plan) {
    const floor = Math.round(plan.maxDrawdown * 0.3);
    out.push(tr(
      `Coupe-circuit drawdown : arrêt total si la marge au plancher passe sous 30 % du DD max (${floor} $)`,
      `Drawdown circuit breaker: full stop if the buffer to the floor drops under 30% of max DD (${floor} $)`,
      `Cortacircuitos de drawdown: parada total si el margen al suelo baja del 30 % del DD máx. (${floor} $)`,
    ));
    if (plan.dailyLossLimit) {
      const stop = Math.round(plan.dailyLossLimit * 0.8);
      out.push(tr(
        `Perte journalière : fermeture de toutes les positions à −${stop} $ (80 % de la limite ${plan.dailyLossLimit} $)`,
        `Daily loss: close every position at −${stop} $ (80% of the ${plan.dailyLossLimit} $ limit)`,
        `Pérdida diaria: cierre de todas las posiciones en −${stop} $ (80 % del límite de ${plan.dailyLossLimit} $)`,
      ));
    } else {
      const stop = Math.round(plan.maxDrawdown * 0.4);
      out.push(tr(
        `Perte journalière interne : −${stop} $ (40 % du DD max, la firme n’impose pas de limite)`,
        `Internal daily loss: −${stop} $ (40% of max DD, the firm sets no limit)`,
        `Pérdida diaria interna: −${stop} $ (40 % del DD máx., la firma no impone límite)`,
      ));
    }
    if (plan.consistencyPct) {
      const pct = Math.round(plan.consistencyPct * 100);
      out.push(tr(
        `Consistance : plafonner le gain journalier à ${pct} % du profit cumulé visé`,
        `Consistency: cap the daily gain at ${pct}% of the target cumulative profit`,
        `Consistencia: limitar la ganancia diaria al ${pct} % del beneficio acumulado objetivo`,
      ));
    }
    out.push(tr('Flat obligatoire avant 16:59 ET (pas de position overnight)', 'Must be flat before 16:59 ET (no overnight position)', 'Flat obligatorio antes de las 16:59 ET (sin posición overnight)'));
  }
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + horizonDays);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = key(today);
  const to = key(end);
  for (const e of events.filter((ev) => ev.impact === 3 && ev.date >= from && ev.date <= to)) {
    out.push(e.timeET
      ? tr(`Blackout ${e.date} ${e.timeET} ET ± 15 min · ${e.title}`, `Blackout ${e.date} ${e.timeET} ET ± 15 min · ${e.title}`, `Blackout ${e.date} ${e.timeET} ET ± 15 min · ${e.title}`)
      : tr(`Journée à risque ${e.date} · ${e.title}`, `Risk day ${e.date} · ${e.title}`, `Jornada de riesgo ${e.date} · ${e.title}`));
  }
  return out;
}

interface BotsState {
  ready: boolean;
  bots: BotBlueprint[];
  activeId: string | null;
  load: () => Promise<void>;
  create: (templateId?: string) => Promise<BotBlueprint>;
  update: (id: string, patch: Partial<Omit<BotBlueprint, 'id' | 'createdAt'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
  addRule: (id: string, rule: Omit<BotRule, 'id'>) => Promise<void>;
  removeRule: (id: string, ruleId: string) => Promise<void>;
}

export const useBots = create<BotsState>((set, get) => ({
  ready: false,
  bots: [],
  activeId: null,
  async load() {
    const rows = await db.bots.orderBy('updatedAt').reverse().toArray();
    const bots: BotBlueprint[] = [];
    for (const b of rows) {
      const status = coerceBotStatus(b.status);
      const next = status === b.status ? b : { ...b, status, updatedAt: Date.now() };
      if (next !== b) await db.bots.put(next);
      bots.push(next);
    }
    set({ bots, ready: true, activeId: get().activeId ?? bots[0]?.id ?? null });
  },
  async create(templateId) {
    const tpl = BOT_TEMPLATES.find((t) => t.id === templateId);
    const now = Date.now();
    const bot: BotBlueprint = {
      id: uid('bot'),
      name: tpl?.name ?? tr('Nouvel automate', 'New automaton', 'Nuevo autómata'),
      instrument: 'MNQ',
      status: 'brouillon',
      description: tpl ? ruleText(tpl.description) : '',
      rules: (tpl?.rules ?? []).map((r) => ({ ...r, id: uid('r'), text: ruleText(r.text) })),
      createdAt: now,
      updatedAt: now,
    };
    await db.bots.add(bot);
    set({ bots: [bot, ...get().bots], activeId: bot.id });
    return bot;
  },
  async update(id, patch) {
    const cur = get().bots.find((b) => b.id === id);
    if (!cur) return;
    const next = { ...cur, ...patch, status: coerceBotStatus(String(patch.status ?? cur.status)), updatedAt: Date.now() };
    await db.bots.put(next);
    set({ bots: get().bots.map((b) => (b.id === id ? next : b)) });
  },
  async remove(id) {
    await db.bots.delete(id);
    const bots = get().bots.filter((b) => b.id !== id);
    set({ bots, activeId: get().activeId === id ? bots[0]?.id ?? null : get().activeId });
  },
  setActive: (id) => set({ activeId: id }),
  async addRule(id, rule) {
    const cur = get().bots.find((b) => b.id === id);
    if (!cur) return;
    await get().update(id, { rules: [...cur.rules, { ...rule, id: uid('r') }] });
  },
  async removeRule(id, ruleId) {
    const cur = get().bots.find((b) => b.id === id);
    if (!cur) return;
    await get().update(id, { rules: cur.rules.filter((r) => r.id !== ruleId) });
  },
}));
