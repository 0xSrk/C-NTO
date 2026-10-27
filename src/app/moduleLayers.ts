import type { GlyphName } from '@/design/Micro';
import { tr } from '@/i18n';
import type { TabId } from '@/store/ui';

/**
 * Couches du Lab (Ligne V2) : chaque module du desk appartient à l'une des cinq. Table centrale, lue par l'en-tête de
 * module à partir de l'onglet : les modules n'ont rien à passer.
 */
export type LayerId = 'L01' | 'L02' | 'L03' | 'L04' | 'L05';

export const MODULE_LAYERS: Readonly<Record<TabId, LayerId>> = {
  metrique: 'L02',
  visual: 'L02',
  calendrier: 'L01',
  note: 'L05',
  portefeuille: 'L02',
  agent: 'L04',
  bot: 'L04',
  copieur: 'L03',
  crypto: 'L03',
};

/** Le composant de la planche qui dit la couche : matrice, cadran, rayonnement, réseau, étoile. */
export const LAYER_GLYPH: Readonly<Record<LayerId, GlyphName>> = {
  L01: 'layerData',
  L02: 'layerCockpit',
  L03: 'layerAlerts',
  L04: 'layerAi',
  L05: 'layerDoctrine',
};

/** « L.02 » : le code de la couche tel que la planche l'imprime. */
export function layerCode(id: LayerId): string {
  return id.replace('L0', 'L.0');
}

/** Nom de la couche dans la langue du desk. */
export function layerName(id: LayerId): string {
  switch (id) {
    case 'L01':
      return tr('Données', 'Data', 'Datos');
    case 'L02':
      return tr('Cockpit', 'Cockpit', 'Cabina');
    case 'L03':
      return tr('Alertes', 'Alerts', 'Alertas');
    case 'L04':
      return tr('IA', 'AI', 'IA');
    case 'L05':
      return tr('Doctrine', 'Doctrine', 'Doctrina');
  }
}
