import { create } from 'zustand';
import { replicatedQty as sizeFollowerPreview } from '@/engine/copier/sizing';
import { DEFAULT_COPIER, type CopierConfig } from '@/engine/copier/types';
import { uid } from '@/lib/id';
import { coerceSymbolMap, db, getSetting, setSetting, type CopierAccount } from './db';

export { DEFAULT_COPIER, type CopierConfig };

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
    const [stored, config] = await Promise.all([db.copierAccounts.toArray(), getSetting<Partial<CopierConfig>>('copier.config', {})]);
    const accounts: CopierAccount[] = [];
    for (const row of stored) {
      const symbolMap = coerceSymbolMap(row.symbolMap);
      if (symbolMap) accounts.push({ ...row, symbolMap });
    }
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
    // Optimiste : le store reflète la frappe immédiatement (les champs contrôlés ne perdent pas de caractères).
    set({ accounts: get().accounts.map((a) => (a.id === id ? next : a)) });
    await db.copierAccounts.put(next);
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
export function replicatedQty(master: { qty: number; instrument: string }, follower: CopierAccount): { qty: number; instrument: string; note?: string } {
  const map = coerceSymbolMap(follower.symbolMap);
  if (!map) return { qty: 0, instrument: master.instrument, note: 'taille nulle' };
  return sizeFollowerPreview(master, { sizing: follower.sizing, symbolMap: map });
}
