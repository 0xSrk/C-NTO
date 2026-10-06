/**
 * Ordres proposés par un agent (A5). L'agent ne soumet rien : il propose. Le process principal garde
 * (compte Sim, limites, cadence, canal d'ordres ouvert), demande la confirmation de l'opérateur dans
 * son propre dialogue, puis soumet par le pont, qui applique ses gardes, puis celles de l'AddOn.
 * Aucun import : ce module tourne dans le moteur et dans le process principal.
 */

export const AGENT_ORDER_TAG = 'canto-agent';
export const AGENT_ORDER_TYPES = ['market', 'limit', 'stop'] as const;
export type AgentOrderType = (typeof AGENT_ORDER_TYPES)[number];
export const AGENT_REASON_MAX = 500;
/** Part restante du drawdown maximal du plan suivi sous laquelle l'agent ne peut plus ouvrir ni augmenter. */
export const AGENT_PROP_FLOOR = 0.25;
/** Fenêtre de la cadence. */
export const AGENT_RATE_WINDOW_MS = 60_000;

export interface AgentOrderProposal {
  account: string;
  instrument: string;
  side: 'buy' | 'sell';
  qty: number;
  type: AgentOrderType;
  limit?: number;
  stop?: number;
  /** Pourquoi l'agent propose cet ordre : affiché à l'opérateur, tel quel, dans le dialogue. */
  reason: string;
}

export interface AgentOrderPolicy {
  /** Désactivé à chaque ouverture du desk ; activé par un dialogue du process principal. */
  enabled: boolean;
  /** Contrats par ordre. */
  maxQty: number;
  /** Position absolue maximale qu'un ordre de l'agent peut atteindre sur un compte et un instrument. */
  maxPosition: number;
  /** Propositions par minute, refusées comprises. */
  perMinute: number;
}

export const AGENT_ORDER_DEFAULTS: AgentOrderPolicy = { enabled: false, maxQty: 1, maxPosition: 2, perMinute: 3 };
export const AGENT_ORDER_BOUNDS = { maxQty: [1, 50], maxPosition: [1, 100], perMinute: [1, 10] } as const;

type Limit = keyof typeof AGENT_ORDER_BOUNDS;
export const AGENT_ORDER_LIMITS: readonly Limit[] = ['maxQty', 'maxPosition', 'perMinute'];

/** Contrôles (C0, C1), formats (bidi, marques de direction, largeur nulle), séparateurs de ligne et de paragraphe. */
const CONTROL_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** Ce qui coupe une ligne dans un dialogue. */
const LINE_BREAK_RE = /[\t\n\v\f\r\u0085\u2028\u2029]+/g;
/** Contrôles bidi : ils retournent l'affichage du texte qui les suit. */
const BIDI_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
/** Autres contrôles C0 / C1. */
const OTHER_CONTROL_RE = /\p{Cc}/gu;

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

/** Compte, instrument : montrés au trader et transmis au pont. Un caractère de contrôle ou bidi les rend invalides. */
function name(v: unknown, max: number): string | null | 'control' {
  if (typeof v !== 'string') return null;
  if (CONTROL_RE.test(v)) return 'control';
  return str(v.replace(/\s+/g, ' '), max);
}

/** Raison de l'agent : une seule ligne dans le dialogue, sans contrôle bidi. */
function reasonText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(LINE_BREAK_RE, ' ').replace(BIDI_RE, '').replace(OTHER_CONTROL_RE, '').trim().slice(0, AGENT_REASON_MAX);
}

function price(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Arguments d'outil → proposition. Raison obligatoire : l'opérateur doit lire pourquoi. */
export function parseProposal(raw: unknown): { ok: true; proposal: AgentOrderProposal } | { ok: false; detail: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, detail: 'proposition illisible' };
  const r = raw as Record<string, unknown>;
  const account = name(r.account, 128);
  const instrument = name(r.instrument, 64);
  const side = r.side === 'buy' || r.side === 'sell' ? r.side : null;
  const type = (AGENT_ORDER_TYPES as readonly unknown[]).includes(r.type ?? 'market') ? ((r.type ?? 'market') as AgentOrderType) : null;
  const qty = typeof r.qty === 'number' && Number.isInteger(r.qty) && r.qty >= 1 ? r.qty : null;
  const reason = reasonText(r.reason);
  if (account === 'control') return { ok: false, detail: 'account : caractères de contrôle ou de direction refusés' };
  if (!account) return { ok: false, detail: 'account requis' };
  if (instrument === 'control') return { ok: false, detail: 'instrument : caractères de contrôle ou de direction refusés' };
  if (!instrument) return { ok: false, detail: 'instrument requis (nom NinjaTrader, ex. MNQ 12-26)' };
  if (!side) return { ok: false, detail: 'side : buy ou sell' };
  if (!type) return { ok: false, detail: 'type : market, limit ou stop' };
  if (qty === null) return { ok: false, detail: 'qty : entier ≥ 1' };
  if (!reason) return { ok: false, detail: 'reason requis : la raison est montrée au trader' };
  const proposal: AgentOrderProposal = { account, instrument, side, qty, type, reason };
  if (type === 'limit') {
    const limit = price(r.limit);
    if (limit === null) return { ok: false, detail: 'limit requis pour un ordre limite' };
    proposal.limit = limit;
  }
  if (type === 'stop') {
    const stop = price(r.stop);
    if (stop === null) return { ok: false, detail: 'stop requis pour un ordre stop' };
    proposal.stop = stop;
  }
  return { ok: true, proposal };
}

/** Politique relue d'un fichier ou d'une IPC : bornée ; `enabled` n'est jamais lu, il part de faux. */
export function coerceAgentPolicy(raw: unknown, enabled = false): AgentOrderPolicy {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: AgentOrderPolicy = { ...AGENT_ORDER_DEFAULTS, enabled };
  for (const key of AGENT_ORDER_LIMITS) {
    const v = r[key];
    const [lo, hi] = AGENT_ORDER_BOUNDS[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi) out[key] = v;
  }
  return out;
}

/** Limites relevées par rapport à la politique en place : elles passent par un dialogue du process principal. */
export function raisedLimits(current: AgentOrderPolicy, next: AgentOrderPolicy): Limit[] {
  return AGENT_ORDER_LIMITS.filter((key) => next[key] > current[key]);
}

export const AGENT_ORDER_REFUSALS = ['disabled', 'not_sim', 'busy', 'link', 'orders_closed', 'rate', 'quantity', 'position', 'prop_buffer', 'trader_rule'] as const;
export type AgentOrderRefusal = (typeof AGENT_ORDER_REFUSALS)[number];

/**
 * Règles du trader qui refusent une ouverture de l'agent (décision 1 de l'ADMIN, 2026-10-06) : perte du jour
 * atteinte, fenêtre d'un catalyseur majeur, instrument hors de la liste. Le renderer les évalue comme la veille
 * discipline (`detectRuleBreaches`) ; le process principal ne retient que ces trois-là.
 */
export const AGENT_TRADER_RULES = ['after_daily_limit', 'catalyst_window', 'instrument_not_allowed'] as const;
export type AgentTraderRule = (typeof AGENT_TRADER_RULES)[number];
export interface AgentTraderRuleBlock {
  rule: AgentTraderRule;
  /** Motif lisible, dans la langue du desk : une ligne, borné. */
  detail: string;
}
/** Longueur du motif d'une règle enfreinte. */
export const AGENT_RULE_DETAIL_MAX = 200;

/** Règle enfreinte transmise par le renderer : une des trois règles décidées, sinon rien ; motif sur une ligne, sans bidi. */
export function parseTraderRule(raw: unknown): AgentTraderRuleBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { rule, detail } = raw as { rule?: unknown; detail?: unknown };
  if (typeof rule !== 'string' || !(AGENT_TRADER_RULES as readonly string[]).includes(rule)) return null;
  const text = typeof detail === 'string' ? detail.replace(LINE_BREAK_RE, ' ').replace(BIDI_RE, '').replace(OTHER_CONTROL_RE, '').trim().slice(0, AGENT_RULE_DETAIL_MAX) : '';
  return { rule: rule as AgentTraderRule, detail: text };
}

export interface AgentOrderSnapshot {
  now: number;
  /** Lien du pont NinjaTrader. */
  link: string;
  /** Faux après le kill switch, jusqu'au redémarrage du desk. */
  ordersOpen: boolean;
  /** Position signée actuelle du compte sur l'instrument (0 si aucune). */
  position: number;
  /** Instants des propositions précédentes (epoch ms). */
  recent: readonly number[];
  /** Une proposition attend déjà la réponse de l'opérateur. */
  busy: boolean;
  /** Part restante du drawdown maximal si le compte est celui du plan suivi ; `null` sinon. */
  propShare: number | null;
  /** Règle du trader que l'ouverture enfreindrait ; absente ou `null` : aucune. */
  traderRule?: AgentTraderRuleBlock | null;
}

export function signedQty(p: Pick<AgentOrderProposal, 'side' | 'qty'>): number {
  return p.side === 'buy' ? p.qty : -p.qty;
}

/** L'ordre rapproche la position de zéro sans la retourner. */
export function reducesRisk(position: number, resulting: number): boolean {
  return Math.abs(resulting) < Math.abs(position) && (resulting === 0 || Math.sign(resulting) === Math.sign(position));
}

/**
 * Gardes de l'agent, avant toute question à l'opérateur. Plus strictes que celles du pont : comptes
 * `Sim*` seulement (jamais un compte réel, même autorisé à la main), une proposition à la fois, cadence,
 * quantité, position atteinte, marge prop, règles du trader. Une réduction de risque n'est bornée que par la quantité.
 */
export function guardProposal(
  p: AgentOrderProposal,
  policy: AgentOrderPolicy,
  snap: AgentOrderSnapshot,
): { ok: true; resulting: number; reducing: boolean } | { ok: false; reason: AgentOrderRefusal; detail: string } {
  if (!policy.enabled) return { ok: false, reason: 'disabled', detail: 'ordres de l’agent désactivés dans CΛNTO' };
  if (!p.account.startsWith('Sim')) return { ok: false, reason: 'not_sim', detail: `compte ${p.account} : l’agent ne propose que sur les comptes Sim` };
  if (snap.busy) return { ok: false, reason: 'busy', detail: 'une proposition attend déjà la réponse du trader' };
  if (snap.link !== 'live') return { ok: false, reason: 'link', detail: 'pont NinjaTrader indisponible' };
  if (!snap.ordersOpen) return { ok: false, reason: 'orders_closed', detail: 'canal d’ordres fermé (kill switch)' };
  const inWindow = snap.recent.filter((t) => snap.now - t < AGENT_RATE_WINDOW_MS).length;
  if (inWindow >= policy.perMinute) return { ok: false, reason: 'rate', detail: `au plus ${policy.perMinute} proposition(s) par minute` };
  if (p.qty > policy.maxQty) return { ok: false, reason: 'quantity', detail: `au plus ${policy.maxQty} contrat(s) par ordre de l’agent` };
  const resulting = snap.position + signedQty(p);
  const reducing = reducesRisk(snap.position, resulting);
  if (!reducing && Math.abs(resulting) > policy.maxPosition) {
    return { ok: false, reason: 'position', detail: `position ${snap.position} → ${resulting} : au plus ${policy.maxPosition} contrat(s) pour l’agent` };
  }
  if (!reducing && snap.propShare !== null && snap.propShare <= AGENT_PROP_FLOOR) {
    return { ok: false, reason: 'prop_buffer', detail: `marge du plan prop à ${Math.round(snap.propShare * 100)} % du drawdown maximal : l’agent ne peut plus ouvrir` };
  }
  if (!reducing && snap.traderRule) return { ok: false, reason: 'trader_rule', detail: snap.traderRule.detail || 'règle du trader enfreinte' };
  return { ok: true, resulting, reducing };
}
