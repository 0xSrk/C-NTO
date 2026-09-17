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
export function deriveGuards(plan: PropPlan | undefined, events: CalEvent[], horizonDays = 7): string[] {
  const out: string[] = [];
  if (plan) {
    out.push(`Coupe-circuit drawdown : arrêt total si la marge au plancher passe sous 30 % du DD max (${Math.round(plan.maxDrawdown * 0.3)} $)`);
    if (plan.dailyLossLimit) out.push(`Perte journalière : fermeture de toutes les positions à −${Math.round(plan.dailyLossLimit * 0.8)} $ (80 % de la limite ${plan.dailyLossLimit} $)`);
    else out.push(`Perte journalière interne : −${Math.round(plan.maxDrawdown * 0.4)} $ (40 % du DD max, la firme n’impose pas de limite)`);
    if (plan.consistencyPct) out.push(`Consistance : plafonner le gain journalier à ${Math.round(plan.consistencyPct * 100)} % du profit cumulé visé`);
    out.push('Flat obligatoire avant 16:59 ET (pas de position overnight)');
  }
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + horizonDays);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = key(today);
  const to = key(end);
  for (const e of events.filter((ev) => ev.impact === 3 && ev.date >= from && ev.date <= to)) {
    out.push(e.timeET ? `Blackout ${e.date} ${e.timeET} ET ± 15 min · ${e.title}` : `Journée à risque ${e.date} · ${e.title}`);
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
      name: tpl?.name ?? 'Nouvel automate',
      instrument: 'MNQ',
      status: 'brouillon',
      description: tpl?.description ?? '',
      rules: (tpl?.rules ?? []).map((r) => ({ ...r, id: uid('r') })),
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
