import { create } from 'zustand';
import type { NtBridgeStatus } from '@/lib/desk';
import { useBridge } from '@/store/bridge';

/** Raccourci du process principal quand le pont n'a encore rien annoncé. */
export const KILL_SHORTCUT_FALLBACK = 'CommandOrControl+Shift+K';

/**
 * Le kill switch engagé, tel que le process principal le dit au renderer. Le raccourci global (Ctrl+Shift+K) aplatit les
 * comptes, ferme le canal d'ordres jusqu'au redémarrage et pousse un statut `ntbridge:status` qui porte `ordersClosed`,
 * lien vivant ou non. Un pont plus ancien sans ce champ : seul un lien vivant au canal fermé prouve la coupure.
 */
export function killEngaged(nt: NtBridgeStatus | null | undefined): boolean {
  return nt?.ordersClosed === true || (nt?.link === 'live' && nt.ordersOpen === false);
}

/** Verrou du renderer : le canal ne se rouvre qu'au redémarrage du desk, la bande non plus. */
export const useKillLatch = create<{ engaged: boolean }>(() => ({ engaged: false }));

// Le verrou écoute le pont dès le chargement du desk : une coupure pendant le démarrage ou le verrou reste vue.
useBridge.subscribe((state) => {
  if (killEngaged(state.nt) && !useKillLatch.getState().engaged) useKillLatch.setState({ engaged: true });
});

/** La bande de niveau 3 est due : coupure vue (verrouillée) ou prouvée par le statut courant. */
export function useKillSwitch(): { engaged: boolean; shortcut: string } {
  const nt = useBridge((b) => b.nt);
  const latched = useKillLatch((k) => k.engaged);
  return { engaged: latched || killEngaged(nt), shortcut: nt?.killSwitchShortcut || KILL_SHORTCUT_FALLBACK };
}
