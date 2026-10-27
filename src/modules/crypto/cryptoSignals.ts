/**
 * Ce que lisent les signaux de l'onglet 09 · CRY (Système 4.0 « ΟΡΟΣ », `docs/DESIGN.md` § 02) : le niveau du signal d'une
 * alerte, le mot de son état, son seuil (sujet, sens, niveau), ses lignes sur le chart, le flux du chart. Système 4.1 : plus
 * de plaque SIGNAL ni LINK, chaque état est dit une fois, sur sa ligne ou sur la puce du chart. Pur : l'écran passe l'état du
 * store et les encres résolues, rien ici ne les lit.
 */
import { alertDirection, type CryptoAlert } from '@/engine/crypto/alerts';
import { cryptoMarket, type CryptoMarketId, type VenueState } from '@/engine/crypto/markets';
import { tr } from '@/i18n';
import { alertLevelText } from '@/lib/cryptoAlertText';
import { fmtPrice } from '@/lib/format';
import type { ChartPriceLine } from '@/modules/visual/Chart';

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

/**
 * Les seuils de prix du marché du chart, en lignes du chart (que le chart trace en tireté) : une par alerte armée, à l'encre du
 * niveau 1, ou déclenchée, à l'encre du niveau 2, titrée ALERTE. En pause, une alerte ne surveille rien : pas de ligne ; la
 * température et les autres marchés n'ont pas de prix sur ce chart. `ink` : les encres résolues (le canevas ne lit pas `var()`).
 */
export function alertPriceLines(alerts: readonly CryptoAlert[], market: CryptoMarketId, ink: Readonly<Record<SignalLevel, string>>): ChartPriceLine[] {
  const title = tr('ALERTE', 'ALERT', 'ALERTA');
  const out: ChartPriceLine[] = [];
  for (const alert of alerts) {
    if (alert.target !== market || (alert.kind !== 'price_above' && alert.kind !== 'price_below')) continue;
    const level = alertSignalLevel(alert.state);
    if (level !== null) out.push({ id: `alert:${alert.id}`, price: alert.level, title, color: ink[level] });
  }
  return out;
}

/** Une venue qui a vu le direct mais n'en reçoit plus : le prix du chart est figé. */
const FROZEN: ReadonlySet<VenueState> = new Set(['stale', 'reconnecting', 'blocked']);

/** L'état du flux du chart : figé, actif (le direct l'a changé), historique seul (des bougies, pas encore de direct). */
export type ChartFeed = 'FROZEN' | 'ACTIVE' | 'HISTORY';

/**
 * L'état du flux du chart, que lit la puce du chart : figé quand la venue a perdu le direct, actif dès qu'une bougie du direct
 * a changé le chart, historique tant que seules les bougies d'historique sont là, `null` sans bougie.
 */
export function chartFeed({ venueState, liveSeen, barCount }: { venueState: VenueState; liveSeen: boolean; barCount: number }): ChartFeed | null {
  if (FROZEN.has(venueState)) return 'FROZEN';
  if (venueState === 'live' && liveSeen) return 'ACTIVE';
  return barCount > 0 ? 'HISTORY' : null;
}
