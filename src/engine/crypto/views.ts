/**
 * Ce que la couche agentique lit du module crypto (`docs/ONGLET-CRYPTO.md` § 9) : les vues que le port `CryptoDeskPort`
 * (`src/engine/agent/ports.ts`) rend aux dix outils `crypto_*` (`src/engine/agent/cryptoTools.ts`), et le résultat de ses
 * écritures. Le port les tire de l'état que le trader a ouvert (le store, `src/store/crypto.ts`) : rien ici n'ouvre un flux.
 * Les outils ne font pas confiance aux nombres d'une vue : ils écartent ou rendent `null` ce qui n'est pas fini.
 * Côté renderer seulement (absent de `electron/tsconfig.sources.json`, sans `.d.ts`).
 */
import type { IndicatorInstance } from '@/engine/indicators';
import { alertEvaluability, type AlertIdleReason, type CryptoAlert, type EvaluabilityData } from './alerts';
import type { CryptoBar, CryptoMarketId, CryptoTimeframe, CryptoVenue, VenueState } from './markets';
import type { CryptoDrawing } from './persist';

/** L'état du module que lit `crypto_status` : le chart réglé, le voyant de chaque venue, les indicateurs et les tracés posés. */
export interface CryptoStatusView {
  market: CryptoMarketId;
  timeframe: CryptoTimeframe;
  venues: Readonly<Record<CryptoVenue, VenueState>>;
  /** Les indicateurs du chart, dans leur ordre ; `id` est ce que `crypto_indicator_set` retire. */
  indicators: readonly IndicatorInstance[];
  /** Les tracés de tous les marchés ; `id` est ce que `crypto_drawing_set` retire. */
  drawings: readonly CryptoDrawing[];
  /** Le dernier refus du flux du chart, en code du process principal (`blocked`, `rate_limited`…), ou `null`. */
  chartError: string | null;
}

/** Une ligne d'indicateur telle que le chart la trace. */
export interface CryptoLineView {
  /** `<instance>:<clé de ligne>` (`i_vwap:vwap`), la clé de la légende de l'onglet ; l'instance est l'`id` de l'indicateur. */
  id: string;
  label: string;
  /** `price` : dans la devise de cotation du marché (lignes du prix, ATR) ; `other` : volume, CVD, volume relatif. */
  unit: 'price' | 'other';
  /** Un point par bougie, `time` en secondes UTC ; un point sans `value` est un blanc. */
  data: readonly { time: number; value?: number }[];
}

/** Ce que le chart ouvert tient : bougies en secondes UTC, lignes des indicateurs visibles, ancrage du CVD. */
export interface CryptoChartView {
  market: CryptoMarketId;
  venue: CryptoVenue;
  timeframe: CryptoTimeframe;
  /** Décimales du pas de prix du marché (`CryptoMarket.precision`). */
  precision: number;
  bars: readonly CryptoBar[];
  indicators: readonly CryptoLineView[];
  /** Ouverture (secondes UTC) de la première bougie qui porte un volume acheteur : le début du CVD ; `null` sans elle. */
  cvdAnchoredAt: number | null;
}

/** Un marché de la watchlist et son dernier prix reçu par le flux léger. */
export interface CryptoWatchRow {
  market: CryptoMarketId;
  venue: CryptoVenue;
  venueState: VenueState;
  /** Dernier prix, `null` sans ticker reçu. */
  last: number | null;
  /** Variation sur 24 h, en pourcent ; `null` quand elle n'est pas connue. */
  change24hPct: number | null;
  /** Heure du ticker, millisecondes ; `null` sans ticker reçu. */
  at: number | null;
}

/**
 * Une alerte et son évaluabilité du moment. Pour une alerte armée, `evaluable` et `reason` sont le verdict de
 * `alertEvaluability`, la règle « non évaluée » de l'onglet ; une alerte en pause ou déclenchée n'est pas évaluée
 * (`evaluable: false`), sans motif : son `state` le dit.
 */
export interface CryptoAlertView extends CryptoAlert {
  evaluable: boolean;
  reason?: AlertIdleReason;
}

/** Le résultat d'une écriture du port : `id` de ce qui a été créé, ou le refus en code stable (`CryptoRefusal` du store). */
export type CryptoWriteResult = { ok: true; id?: string } | { ok: false; reason: string };

/** Les vues des alertes, dans leur ordre : celles que le port rend à `crypto_alert_list`. */
export function cryptoAlertViews(alerts: readonly CryptoAlert[], data: EvaluabilityData): CryptoAlertView[] {
  return alerts.map((alert) => {
    if (alert.state !== 'armed') return { ...alert, evaluable: false };
    const verdict = alertEvaluability(alert, data);
    return verdict.ok ? { ...alert, evaluable: true } : { ...alert, evaluable: false, reason: verdict.reason };
  });
}
