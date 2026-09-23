import { create } from 'zustand';
import { uid } from '@/lib/id';
import { db, getSetting, setSetting, type CopierAccount } from './db';

export interface CopierConfig {
  enabled: boolean;
  /** Budget de latence toléré maître → suiveur (ms) avant alerte */
  latencyBudgetMs: number;
  copyStops: boolean;
  copyTargets: boolean;
  /** Ne pas copier ±15 min autour des catalyseurs majeurs */
  newsBlackout: boolean;
  /** Fenêtre de copie, heure locale */
  windowStart: string;
  windowEnd: string;
  /** Rejeter une copie si le suiveur dépasse cette marge de drawdown (fraction du DD max de son plan) */
  followerBufferFloor: number;
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
  channel: 'stable',
};

export const COPIER_CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: '2.0.0',
    date: '2026-09-23',
    items: [
      'Desk natif macOS, Windows et Linux — installeurs DMG, NSIS et AppImage / deb',
      'Pont fichier inclus sur chaque OS : le desk surveille l’export CANTO, l’AddOn NT8 reste compilé sous Windows',
    ],
  },
  {
    version: '1.1.2',
    date: '2026-09-17',
    items: [
      'Alignement desk v1.1.2 — badge CONCEPTION, kill switch, aucun ordre',
      'Grammaire visuelle Lab — précision lithographique, LED unique',
      'Modèle maître / suiveurs, sizing fixe · ratio · risque, NQ ↔ MNQ',
      'Filtres : fenêtre horaire, blackout catalyseurs, marge plancher',
      'Spécification du pont NinjaTrader (docs/PONT-NINJATRADER.md)',
    ],
  },
];

interface CopierState {
  ready: boolean;
  accounts: CopierAccount[];
  config: CopierConfig;
  load: () => Promise<void>;
  addAccount: (input: Omit<CopierAccount, 'id' | 'createdAt'>) => Promise<CopierAccount>;
  updateAccount: (id: string, patch: Partial<Omit<CopierAccount, 'id' | 'createdAt'>>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  updateConfig: (patch: Partial<CopierConfig>) => Promise<void>;
}

export const useCopier = create<CopierState>((set, get) => ({
  ready: false,
  accounts: [],
  config: DEFAULT_COPIER,
  async load() {
    const [accounts, config] = await Promise.all([db.copierAccounts.toArray(), getSetting<Partial<CopierConfig>>('copier.config', {})]);
    set({ accounts, config: { ...DEFAULT_COPIER, ...config }, ready: true });
  },
  async addAccount(input) {
    const acc: CopierAccount = { ...input, id: uid('acc'), createdAt: Date.now() };
    await db.copierAccounts.add(acc);
    set({ accounts: [...get().accounts, acc] });
    return acc;
  },
  async updateAccount(id, patch) {
    const cur = get().accounts.find((a) => a.id === id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    await db.copierAccounts.put(next);
    set({ accounts: get().accounts.map((a) => (a.id === id ? next : a)) });
  },
  async removeAccount(id) {
    await db.copierAccounts.delete(id);
    set({ accounts: get().accounts.filter((a) => a.id !== id) });
  },
  async updateConfig(patch) {
    const config = { ...get().config, ...patch };
    set({ config });
    await setSetting('copier.config', config);
  },
}));

/** Taille répliquée pour un suiveur à partir d'un ordre maître. */
export function replicatedQty(master: { qty: number; instrument: 'NQ' | 'MNQ' }, follower: CopierAccount): { qty: number; instrument: 'NQ' | 'MNQ'; note?: string } {
  let qty = master.qty;
  let instrument = master.instrument;
  if (follower.symbolMap === 'NQ→MNQ' && instrument === 'NQ') {
    instrument = 'MNQ';
    qty *= 10;
  } else if (follower.symbolMap === 'MNQ→NQ' && instrument === 'MNQ') {
    instrument = 'NQ';
    qty = Math.floor(qty / 10);
  }
  if (follower.sizing.mode === 'fixe') qty = follower.sizing.value;
  else if (follower.sizing.mode === 'ratio') qty = Math.round(qty * follower.sizing.value);
  else if (follower.sizing.mode === 'risque') qty = Math.max(1, Math.round(follower.sizing.value));
  const capped = Math.min(qty, follower.sizing.maxContracts);
  return { qty: capped, instrument, note: capped < qty ? `plafonné à ${follower.sizing.maxContracts}` : qty === 0 ? 'taille nulle' : undefined };
}
