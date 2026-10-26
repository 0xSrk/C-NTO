/**
 * Ce que lisent les signaux de l'onglet 09 · CRY (Système 4.0 « ΟΡΟΣ », `docs/DESIGN.md` § 02) : le niveau du signal d'une
 * alerte, le mot de son état, son seuil (sujet, sens, niveau), ses lignes sur le chart, les plaques SIGNAL et LINK. Pur :
 * l'écran passe l'état du store et les encres résolues, rien ici ne les lit.
 */
import type { SlotValues } from '@/design/Micro';
import { alertDirection, type CryptoAlert } from '@/engine/crypto/alerts';
import { cryptoMarket, type CryptoMarketId, type CryptoTicker, type CryptoVenue, type VenueState } from '@/engine/crypto/markets';
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

/** Les états d'alerte que lit la plaque SIGNAL, du plus fort au plus faible, et leur code de plaque. */
const STATE_ORDER: readonly CryptoAlert['state'][] = ['triggered', 'armed', 'paused'];
const STATE_CODE: Record<CryptoAlert['state'], string> = { triggered: 'TRIGGERED', armed: 'ARMED', paused: 'PAUSED' };

export interface SignalPlateInput {
  /** Le marché du chart : la cible de la plaque. */
  market: CryptoMarketId;
  alerts: readonly CryptoAlert[];
  venues: Readonly<Record<CryptoVenue, VenueState>>;
  tickers: Partial<Record<CryptoMarketId, CryptoTicker>>;
}

/**
 * Ce que lit la plaque SIGNAL en tête des alertes : sa cible, le marché du chart ; l'état de ses alertes, le plus fort
 * l'emporte (déclenchée, puis armée, puis en pause), « — » sans alerte ; `LIVE` quand son prix arrive en direct (venue en
 * direct et un prix reçu : le voyant de sa ligne de marché), « — » sinon.
 */
export function signalPlateValues({ market, alerts, venues, tickers }: SignalPlateInput): SlotValues {
  const spec = cryptoMarket(market);
  const states = new Set(alerts.filter((a) => a.target === market).map((a) => a.state));
  const strongest = STATE_ORDER.find((state) => states.has(state));
  const live = spec !== undefined && venues[spec.venue] === 'live' && tickers[market] !== undefined;
  return { target: spec?.symbol ?? market, state: strongest ? STATE_CODE[strongest] : null, live: live ? 'LIVE' : null };
}

/** La même lecture, en phrase, pour les lecteurs d'écran. */
export function signalPlateLabel(values: SlotValues): string {
  const target = String(values.target ?? '—');
  const state =
    values.state === 'TRIGGERED'
      ? tr('alerte déclenchée', 'alert triggered', 'alerta disparada')
      : values.state === 'ARMED'
        ? tr('alerte armée', 'alert armed', 'alerta armada')
        : values.state === 'PAUSED'
          ? tr('alerte en pause', 'alert paused', 'alerta en pausa')
          : tr('aucune alerte', 'no alert', 'ninguna alerta');
  const live = values.live === 'LIVE' ? tr('prix en direct', 'live price', 'precio en directo') : tr('prix pas en direct', 'price not live', 'precio no en directo');
  return tr(`Signal : ${target} · ${state} · ${live}`, `Signal: ${target} · ${state} · ${live}`, `Señal: ${target} · ${state} · ${live}`);
}

/** Une venue qui a vu le direct mais n'en reçoit plus : le prix du chart est figé. */
const FROZEN: ReadonlySet<VenueState> = new Set(['stale', 'reconnecting', 'blocked']);

/** L'état du flux du chart : figé, actif (le direct l'a changé), historique seul (des bougies, pas encore de direct). */
export type ChartFeed = 'FROZEN' | 'ACTIVE' | 'HISTORY';

/**
 * L'état du flux du chart, que lisent la puce du chart et la plaque LINK : figé quand la venue a perdu le direct, actif dès
 * qu'une bougie du direct a changé le chart, historique tant que seules les bougies d'historique sont là, `null` sans bougie.
 */
export function chartFeed({ venueState, liveSeen, barCount }: { venueState: VenueState; liveSeen: boolean; barCount: number }): ChartFeed | null {
  if (FROZEN.has(venueState)) return 'FROZEN';
  if (venueState === 'live' && liveSeen) return 'ACTIVE';
  return barCount > 0 ? 'HISTORY' : null;
}

/** Le code du websocket d'une venue sur la plaque LINK : sept signes au plus avec `WS.`, la place que le master lui laisse. */
const WS_CODE: Record<VenueState, string> = { off: 'OFF', connecting: 'CONN', live: 'LIVE', reconnecting: 'RECON', stale: 'STALE', blocked: 'BLOCK' };

export interface LinkPlateInput {
  /** Le nom de la venue du marché du chart (`Coinbase`). */
  venueName: string;
  venueState: VenueState;
  feed: ChartFeed | null;
}

/**
 * Ce que lit la plaque LINK de la barre du module : la venue du marché du chart, l'état de son websocket, le flux du chart.
 * La latence n'est pas mesurée par le store : sa ligne garde « — », jamais un chiffre d'exemple.
 */
export function linkPlateValues({ venueName, venueState, feed }: LinkPlateInput): SlotValues {
  return { venue: venueName.toUpperCase(), ws: `WS.${WS_CODE[venueState]}`, feed, latency: null };
}

/** La même lecture, en phrase, pour les lecteurs d'écran ; `stateWord` : l'état de la venue en clair (`venueStateText`). */
export function linkPlateLabel({ venueName, feed }: LinkPlateInput, stateWord: string): string {
  const flow =
    feed === 'ACTIVE'
      ? tr('flux en direct', 'live feed', 'flujo en directo')
      : feed === 'FROZEN'
        ? tr('flux figé', 'frozen feed', 'flujo congelado')
        : feed === 'HISTORY'
          ? tr('historique seul', 'history only', 'solo histórico')
          : tr('aucune bougie', 'no candles', 'ninguna vela');
  return tr(`Lien de marché : ${venueName} · ${stateWord} · ${flow}`, `Market link: ${venueName} · ${stateWord} · ${flow}`, `Enlace de mercado: ${venueName} · ${stateWord} · ${flow}`);
}
