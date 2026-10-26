/**
 * Ce que lisent les signaux de l'onglet 09 · CRY (Système 4.0 « ΟΡΟΣ », `docs/DESIGN.md` § 02) : le niveau du signal d'une
 * alerte, le mot de son état, son seuil (sujet, sens, niveau). Pur : l'écran passe l'état du store, rien ici ne le lit.
 */
import { alertDirection, type CryptoAlert } from '@/engine/crypto/alerts';
import { cryptoMarket } from '@/engine/crypto/markets';
import { tr } from '@/i18n';
import { alertLevelText } from '@/lib/cryptoAlertText';
import { fmtPrice } from '@/lib/format';

export type SignalLevel = 1 | 2;

/**
 * Le niveau de signal d'une alerte : armée, elle veille (niveau 1, contour seul) ; déclenchée, elle demande l'attention
 * (niveau 2). En pause, elle ne surveille rien : aucun signal. Une alerte n'est jamais critique — le rouge reste au niveau 3.
 */
export function alertSignalLevel(state: CryptoAlert['state']): SignalLevel | null {
  switch (state) {
    case 'armed':
      return 1;
    case 'triggered':
      return 2;
    case 'paused':
      return null;
  }
}

/** Le mot de l'étiquette d'état ; son trait le redit : tireté (armée, prévu), plein (déclenchée), pointillé (en pause). */
export function alertStateWord(state: CryptoAlert['state']): string {
  switch (state) {
    case 'armed':
      return tr('Armée', 'Armed', 'Armada');
    case 'triggered':
      return tr('Déclenchée', 'Triggered', 'Disparada');
    case 'paused':
      return tr('En pause', 'Paused', 'En pausa');
  }
}

/** Le sens d'un seuil, nommé pour les lecteurs d'écran sur le glyphe qui le dessine (flèche montante ou descendante). */
export function directionText(direction: 'above' | 'below'): string {
  return direction === 'above' ? tr('au-dessus de', 'above', 'por encima de') : tr('en dessous de', 'below', 'por debajo de');
}

/** Le glyphe du sens : `up` pour un seuil franchi par le haut (≥), `down` par le bas (≤). */
export function directionGlyph(alert: Pick<CryptoAlert, 'kind'>): 'up' | 'down' {
  return alertDirection(alert.kind) === 'above' ? 'up' : 'down';
}

/** Ce que surveille l'alerte, en tête de son seuil : le symbole du marché, ou la lecture de la température (libellés de la colonne). */
export function alertSubject(alert: Pick<CryptoAlert, 'target' | 'kind'>): string {
  switch (alert.kind) {
    case 'price_above':
    case 'price_below':
      return cryptoMarket(alert.target)?.symbol ?? alert.target;
    case 'funding_median_above':
    case 'funding_median_below':
      return tr('Funding médian', 'Median funding', 'Funding mediano');
    case 'liquidations_long_1h_above':
      return tr('Liq. 1 h · long', 'Liq. 1 h · long', 'Liq. 1 h · long');
    case 'liquidations_short_1h_above':
      return tr('Liq. 1 h · short', 'Liq. 1 h · short', 'Liq. 1 h · short');
    case 'breadth_above':
    case 'breadth_below':
      return tr('Largeur 24 h', '24 h breadth', 'Amplitud 24 h');
  }
}

/** Le niveau du seuil : un prix à la précision du marché (sa cotation se lit dans le symbole), les autres dans leur unité. */
export function alertThreshold(alert: Pick<CryptoAlert, 'target' | 'kind' | 'level'>): string {
  if (alert.kind === 'price_above' || alert.kind === 'price_below') {
    const spec = cryptoMarket(alert.target);
    return spec ? fmtPrice(alert.level, spec.precision) : fmtPrice(alert.level);
  }
  return alertLevelText(alert);
}
