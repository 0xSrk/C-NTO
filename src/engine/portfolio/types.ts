import type { PropEvaluation } from '@/engine/propfirm';

/** `'crypto'` est réservé : aucune poche de ce type ne se crée ni ne se restaure. */
export const POCKET_KINDS = ['propfirm', 'futures', 'actions', 'indices', 'forex', 'commodites', 'cfd', 'liquidites', 'crypto'] as const;
export type PocketKind = (typeof POCKET_KINDS)[number];

export const CREATABLE_POCKET_KINDS = ['propfirm', 'futures', 'actions', 'indices', 'forex', 'commodites', 'cfd', 'liquidites'] as const;
export type CreatablePocketKind = (typeof CREATABLE_POCKET_KINDS)[number];

export const TRADITIONAL_KINDS = ['actions', 'indices', 'forex', 'commodites', 'cfd'] as const;

/** Instantané du pont encore utilisable pour l'équité et l'exposition. */
export const BRIDGE_MAX_AGE_MS = 60_000;

export const CRYPTO_POCKET_ERROR = 'Poche crypto refusée : la crypto est hors périmètre de CΛNTO.';

export interface Pocket {
  id: string;
  name: string;
  kind: PocketKind;
  /** Devise native de la poche (ISO 4217, 3 lettres). */
  currency: string;
  /** propfirm / futures : nom de compte tel que dans les séances et le pont. */
  account?: string;
  /** propfirm : identifiant du plan (`findPlan`). */
  planId?: string;
  /** actions / forex / cfd… : courtier ou lieu, texte libre. */
  venue?: string;
  createdAt: number;
  archivedAt?: number;
}

/** Poches traditionnelles uniquement. `quantity` signée : négatif = vendeur. */
export interface Position {
  id: string;
  pocketId: string;
  /** Symbole du registre si connu, sinon libre. */
  symbol: string;
  label?: string;
  quantity: number;
  avgPrice: number;
  /** Saisi par l'utilisateur, ou recouvert à la lecture par un port déjà ouvert. */
  lastPrice?: number;
  lastPriceAt?: number;
  /** Défaut : `pointValue` du registre si le symbole est connu, sinon 1. */
  multiplier?: number;
  currency: string;
  openedAt: number;
  closedAt?: number;
  realizedPnl?: number;
}

export interface CashBalance {
  id: string;
  pocketId: string;
  currency: string;
  amount: number;
  at: number;
}

/** `pair` = devise de base + devise cotée, ex. `EURUSD` : 1 EUR = `rate` USD. */
export interface FxRate {
  pair: string;
  rate: number;
  at: number;
  by: 'utilisateur';
}

export interface ConsolidatedPoint {
  date: string;
  /** Valeur nette en devise de base, dernière valeur connue de chaque poche reportée. */
  equity: number;
  /** PnL de trading du jour en devise de base (un apport de cash n'est pas un PnL). */
  pnl: number;
}

export interface EquityPoint {
  /** Journée de trading `YYYY-MM-DD` (bascule 18:00 America/New_York). */
  date: string;
  pocketId: string;
  equity: number;
  pnl: number;
  currency: string;
}

export interface BridgePositionSnap {
  instrument: string;
  quantity: number;
  avgPrice: number;
}

export interface BridgeSnapshot {
  account: string;
  cashValue: number;
  unrealizedPnl: number;
  positions: BridgePositionSnap[];
  /** Epoch ms de l'instantané. */
  at: number;
}

export type ValuationMark = 'pont' | 'journal' | 'saisi' | 'prix de revient';

export interface PropDistance {
  toDrawdown: number;
  toDailyLoss: number | null;
  toTarget: number;
  daysTraded: number;
  status: PropEvaluation['status'];
  /** Vrai si le drawdown restant est à 25 % ou moins du drawdown maximal du plan. */
  alert: boolean;
}

export interface PocketValuation {
  pocketId: string;
  kind: PocketKind;
  currency: string;
  nativeEquity: number | null;
  /** Null si la poche est exclue du total (taux manquant, plan manquant, crypto). */
  equityBase: number | null;
  /** Null tant qu'une position ouverte n'a pas de dernier prix. Jamais 0 à la place. */
  unrealized: number | null;
  mark: ValuationMark;
  reason?: string;
  prop?: PropDistance;
}

export interface Coeur {
  netValue: number;
  currency: string;
  byPocket: PocketValuation[];
  excluded: { pocketId: string; reason: string }[];
  asOf: number;
}

export function isIsoCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

export function isCreatableKind(kind: string): kind is CreatablePocketKind {
  return (CREATABLE_POCKET_KINDS as readonly string[]).includes(kind);
}

export function isTraditionalKind(kind: PocketKind): boolean {
  return (TRADITIONAL_KINDS as readonly string[]).includes(kind);
}

/** Lève si une ligne de coffre porte `kind: 'crypto'`. Les autres formes invalides restent au validateur. */
export function assertNoCryptoPockets(input: unknown): void {
  if (!Array.isArray(input)) return;
  for (const item of input) {
    if (item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'crypto') {
      throw new Error(CRYPTO_POCKET_ERROR);
    }
  }
}
