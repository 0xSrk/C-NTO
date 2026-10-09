import { create } from 'zustand';
import { desk, type CryptoMainStatus } from '@/lib/desk';

/** Hors desk, avant la première lecture : aucune venue ouverte. */
const OFF_VENUES: CryptoMainStatus['venues'] = { coinbase: 'off', binance: 'off', bybit: 'off' };

interface CryptoState {
  /** Vrai une fois la lecture de l'interrupteur terminée : lu auprès du process principal, illisible, ou constaté absent hors du desk. */
  ready: boolean;
  /** L'interrupteur appartient au process principal : le renderer le lit, il ne l'écrit pas. */
  enabled: boolean;
  venues: CryptoMainStatus['venues'];
  load: () => Promise<void>;
  /** Demande l'allumage : le process principal ouvre son dialogue et rend le statut, allumé ou non. */
  requestEnable: () => Promise<void>;
  disable: () => Promise<void>;
}

let unsubscribeStatus: (() => void) | null = null;

export const useCrypto = create<CryptoState>((set) => {
  const apply = (status: CryptoMainStatus) => set({ enabled: status.enabled, venues: status.venues });

  return {
    ready: false,
    enabled: false,
    venues: OFF_VENUES,

    async load() {
      const api = desk?.crypto;
      if (!api) {
        set({ ready: true, enabled: false, venues: OFF_VENUES });
        return;
      }
      try {
        // Abonné avant la lecture : un changement poussé entre les deux ne se perd pas.
        if (!unsubscribeStatus) unsubscribeStatus = api.onStatus(apply);
        apply(await api.status());
      } catch {
        // Process principal illisible : l'état connu reste (éteint à la première lecture), l'écran se montre quand même.
      }
      set({ ready: true });
    },

    async requestEnable() {
      const status = await desk?.crypto?.enable();
      if (status) apply(status);
    },

    async disable() {
      const status = await desk?.crypto?.disable();
      if (status) apply(status);
    },
  };
});
