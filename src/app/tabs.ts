import type { ComponentType, SVGProps } from 'react';
import { tr } from '@/i18n';
import type { TabId } from '@/store/ui';
import { IconAgent, IconBot, IconCalendar, IconCopier, IconCrypto, IconMetric, IconNote, IconPortfolio, IconVisual } from './icons';

export interface TabDef {
  id: TabId;
  index: string;
  label: string;
  code: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
}

/** Les modules du rail, dans l'ordre des raccourcis Ctrl+1…9. Le nom seul : aucune baseline sous le titre (4.1). */
export const TABS: TabDef[] = [
  { id: 'metrique', index: '01', label: 'Métrique', code: 'MET', icon: IconMetric },
  { id: 'visual', index: '02', label: 'Visual', code: 'VIS', icon: IconVisual },
  { id: 'calendrier', index: '03', label: 'Calendrier', code: 'CAL', icon: IconCalendar },
  { id: 'note', index: '04', label: 'Note', code: 'NTE', icon: IconNote },
  { id: 'portefeuille', index: '05', label: 'Portefeuille', code: 'PTF', icon: IconPortfolio },
  { id: 'agent', index: '06', label: 'Agent IA', code: 'AGT', icon: IconAgent },
  { id: 'bot', index: '07', label: 'Bot', code: 'BOT', icon: IconBot },
  { id: 'copieur', index: '08', label: 'Copieur', code: 'CPY', icon: IconCopier },
  { id: 'crypto', index: '09', label: 'Crypto', code: 'CRY', icon: IconCrypto },
];

const TAB_EN: Record<TabId, string> = {
  metrique: 'Metrics',
  visual: 'Visual',
  calendrier: 'Calendar',
  note: 'Note',
  agent: 'AI Agent',
  bot: 'Bot',
  copieur: 'Copier',
  portefeuille: 'Portfolio',
  crypto: 'Crypto',
};

const TAB_ES: Record<TabId, string> = {
  metrique: 'Métrica',
  visual: 'Visual',
  calendrier: 'Calendario',
  note: 'Nota',
  agent: 'Agente IA',
  bot: 'Bot',
  copieur: 'Copiador',
  portefeuille: 'Cartera',
  crypto: 'Cripto',
};

/** Libellé de l'onglet dans la langue active. */
export function tabCopy(tab: TabDef): { label: string } {
  return { label: tr(tab.label, TAB_EN[tab.id], TAB_ES[tab.id]) };
}
