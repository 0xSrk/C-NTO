/**
 * Types du prototype Copieur, tenus par le moteur.
 * `CopierAccount` reste la ligne Dexie (`src/store/db.ts`).
 */

export type SymbolMap =
  | { mode: 'identique' }
  | { mode: 'micro' }
  | { mode: 'standard' }
  | { mode: 'explicite'; from: string; to: string };

export interface CopierSizing {
  mode: 'fixe' | 'ratio' | 'risque';
  value: number;
  maxContracts: number;
}

export interface CopierConfig {
  enabled: boolean;
  /** Budget de latence toléré maître → suiveur (ms). Au-delà, le fill est refusé. */
  latencyBudgetMs: number;
  copyStops: boolean;
  copyTargets: boolean;
  /** Ne pas copier ±15 min autour des catalyseurs majeurs */
  newsBlackout: boolean;
  /** Fenêtre de copie, heure locale `HH:mm` */
  windowStart: string;
  windowEnd: string;
  /** Rejeter une copie si le tampon du suiveur passe sous cette fraction du DD max. */
  followerBufferFloor: number;
  /** Aplatir les suiveurs quand on coupe. Défaut `false` (D1). */
  flattenOnCut: boolean;
  /** Inutilisé depuis 3.1.0 — conservé pour les coffres déjà exportés. */
  channel: 'stable' | 'beta';
}

export const DEFAULT_COPIER: CopierConfig = {
  enabled: false,
  latencyBudgetMs: 250,
  copyStops: true,
  copyTargets: true,
  newsBlackout: true,
  windowStart: '15:30',
  windowEnd: '17:30',
  followerBufferFloor: 0.3,
  flattenOnCut: false,
  channel: 'stable',
};

export interface FollowerRule {
  account: string;
  sizing: CopierSizing;
  symbolMap: SymbolMap;
}

/** Un seul maître (D2). Les suiveurs de cette forge sont `Sim*`. */
export interface CopierTopology {
  masterAccount: string;
  followers: FollowerRule[];
  latencyBudgetMs: number;
  newsBlackout: boolean;
  windowStart: string;
  windowEnd: string;
  followerBufferFloor: number;
}
