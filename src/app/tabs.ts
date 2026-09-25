import type { ComponentType, SVGProps } from 'react';
import { tr } from '@/i18n';
import type { TabId } from '@/store/ui';
import { IconAgent, IconBot, IconCalendar, IconCopier, IconMetric, IconNote, IconVisual } from './icons';

export interface TabDef {
  id: TabId;
  index: string;
  label: string;
  code: string;
  tagline: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
}

export const TABS: TabDef[] = [
  { id: 'metrique', index: '01', label: 'Métrique', code: 'MET', tagline: 'Journal ultime · moteur quantitatif', icon: IconMetric },
  { id: 'visual', index: '02', label: 'Visual', code: 'VIS', tagline: 'Graphique avancé · indicateurs', icon: IconVisual },
  { id: 'calendrier', index: '03', label: 'Calendrier', code: 'CAL', tagline: 'Catalyseurs Nasdaq · repères', icon: IconCalendar },
  { id: 'note', index: '04', label: 'Note', code: 'NTE', tagline: 'Coffre de notes · liens', icon: IconNote },
  { id: 'agent', index: '05', label: 'Agent IA', code: 'AGT', tagline: 'Passerelle native · orchestrateur', icon: IconAgent },
  { id: 'bot', index: '06', label: 'Bot', code: 'BOT', tagline: 'Atelier d’automates · CONCEPTION', icon: IconBot },
  { id: 'copieur', index: '07', label: 'Copieur', code: 'CPY', tagline: 'Réplication de comptes · CONCEPTION', icon: IconCopier },
];

const TAB_EN: Record<TabId, { label: string; tagline: string }> = {
  metrique: { label: 'Metrics', tagline: 'Ultimate journal · quantitative engine' },
  visual: { label: 'Visual', tagline: 'Advanced chart · indicators' },
  calendrier: { label: 'Calendar', tagline: 'Nasdaq catalysts · markers' },
  note: { label: 'Note', tagline: 'Note vault · links' },
  agent: { label: 'AI Agent', tagline: 'Native gateway · orchestrator' },
  bot: { label: 'Bot', tagline: 'Automaton workshop · DESIGN' },
  copieur: { label: 'Copier', tagline: 'Account replication · DESIGN' },
};

const TAB_ES: Record<TabId, { label: string; tagline: string }> = {
  metrique: { label: 'Métrica', tagline: 'Diario definitivo · motor cuantitativo' },
  visual: { label: 'Visual', tagline: 'Gráfico avanzado · indicadores' },
  calendrier: { label: 'Calendario', tagline: 'Catalizadores Nasdaq · referencias' },
  note: { label: 'Nota', tagline: 'Caja de notas · enlaces' },
  agent: { label: 'Agente IA', tagline: 'Pasarela nativa · orquestador' },
  bot: { label: 'Bot', tagline: 'Taller de autómatas · DISEÑO' },
  copieur: { label: 'Copiador', tagline: 'Réplica de cuentas · DISEÑO' },
};

/** Libellé et baseline de l'onglet dans la langue active. */
export function tabCopy(tab: TabDef): { label: string; tagline: string } {
  return {
    label: tr(tab.label, TAB_EN[tab.id].label, TAB_ES[tab.id].label),
    tagline: tr(tab.tagline, TAB_EN[tab.id].tagline, TAB_ES[tab.id].tagline),
  };
}
