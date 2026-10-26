import { tr, useI18n } from '@/i18n';
import { fmtInt } from '@/lib/format';
import type { TabId } from '@/store/ui';

/**
 * Ce que le rail-bordereau lit dans les stores déjà chargés au démarrage (`App.tsx`, `boot`) :
 * aucune lecture de plus, aucune valeur inventée (Système 4.0 — une plaque n'est jamais décorative).
 */
export interface RailSnapshot {
  sessions: number;
  /** Repères personnels du jour (notes et événements du Calendrier). */
  todayEntries: number;
  notes: number;
  links: number;
  agentRunning: boolean;
  /** Rapports de l'agent cloud non lus ; `null` hors du desk ou avant le premier statut. */
  agentReportsUnread: number | null;
  /** `null` tant que le Copieur n'a pas chargé ses comptes. */
  copierAccounts: number | null;
  cryptoMarkets: number;
}

/** Accord du nombre selon la langue : « 0 lien » en français, « 0 links » et « 0 enlaces » ailleurs. */
export function count(n: number, one: string, many: string): string {
  const singular = useI18n.getState().locale === 'fr' ? Math.abs(n) < 2 : Math.abs(n) === 1;
  return `${fmtInt(n)} ${singular ? one : many}`;
}

/** La quantité sous le nom du module. `null` : le desk n'a rien de vrai à dire, il se tait. */
export function railQuantity(id: TabId, snap: RailSnapshot): string | null {
  switch (id) {
    case 'metrique':
      return snap.sessions > 0
        ? count(snap.sessions, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))
        : tr('Journal vide', 'Empty journal', 'Diario vacío');
    case 'calendrier':
      return snap.todayEntries > 0
        ? `${count(snap.todayEntries, tr('repère', 'marker', 'referencia'), tr('repères', 'markers', 'referencias'))} ${tr('ce jour', 'today', 'hoy')}`
        : null;
    case 'note':
      return snap.notes > 0
        ? `${count(snap.notes, tr('note', 'note', 'nota'), tr('notes', 'notes', 'notas'))} · ${count(snap.links, tr('lien', 'link', 'enlace'), tr('liens', 'links', 'enlaces'))}`
        : null;
    case 'agent':
      // Un rapport non lu passe devant l'état de l'orchestrateur : c'est ce que le trader vient lire.
      if (snap.agentReportsUnread !== null && snap.agentReportsUnread > 0)
        return count(snap.agentReportsUnread, tr('rapport non lu', 'unread report', 'informe sin leer'), tr('rapports non lus', 'unread reports', 'informes sin leer'));
      return snap.agentRunning ? tr('Orchestrateur en service', 'Orchestrator running', 'Orquestador en servicio') : tr('En veille', 'Idle', 'En espera');
    case 'copieur':
      if (snap.copierAccounts === null) return null;
      return snap.copierAccounts > 0
        ? count(snap.copierAccounts, tr('compte suiveur', 'follower account', 'cuenta seguidora'), tr('comptes suiveurs', 'follower accounts', 'cuentas seguidoras'))
        : tr('Aucun suiveur', 'No follower', 'Sin seguidor');
    case 'crypto':
      return snap.cryptoMarkets > 0
        ? count(snap.cryptoMarkets, tr('marché suivi', 'market tracked', 'mercado seguido'), tr('marchés suivis', 'markets tracked', 'mercados seguidos'))
        : null;
    default:
      return null;
  }
}
