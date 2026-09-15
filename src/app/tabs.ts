import type { ComponentType, SVGProps } from 'react';
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
  { id: 'metrique', index: '01', label: 'Métrique', code: 'MTR', tagline: 'Journal ultime · moteur quantitatif', icon: IconMetric },
  { id: 'visual', index: '02', label: 'Visual', code: 'VIS', tagline: 'Graphique avancé · indicateurs', icon: IconVisual },
  { id: 'calendrier', index: '03', label: 'Calendrier', code: 'CAL', tagline: 'Catalyseurs Nasdaq · repères', icon: IconCalendar },
  { id: 'note', index: '04', label: 'Note', code: 'NTE', tagline: 'Coffre de notes · liens', icon: IconNote },
  { id: 'agent', index: '05', label: 'Agent IA', code: 'AGT', tagline: 'Passerelle native · orchestrateur', icon: IconAgent },
  { id: 'bot', index: '06', label: 'Bot', code: 'BOT', tagline: 'Atelier d’automates NinjaTrader', icon: IconBot },
  { id: 'copieur', index: '07', label: 'Copieur', code: 'CPY', tagline: 'Réplication de comptes', icon: IconCopier },
];
