import { isChartableMarket, isCryptoSeriesId, isCryptoTimeframe, type CryptoSeriesId, type CryptoTimeframe } from './crypto/markets';

/**
 * Validation de forme des requêtes IPC du module crypto (onglet 09 · CRY), côté process principal. Pure : ni Electron, ni
 * réseau, ni état. Une requête valide est reconstruite champ par champ, si bien que rien d'autre que les champs lus ne
 * passe ; toute autre forme rend `null` (ou `false`), et le runtime (`crypto-electron.ts`) la refuse sans aucun appel.
 */

/** Un objet simple : ni `null`, ni tableau. */
function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** Historique : une série du registre (marché affichable ou source du CVD Binance) et un des six timeframes. */
export function parseHistoryRequest(raw: unknown): { series: CryptoSeriesId; timeframe: CryptoTimeframe } | null {
  const req = record(raw);
  if (req === null || !isCryptoSeriesId(req.series) || !isCryptoTimeframe(req.timeframe)) return null;
  return { series: req.series, timeframe: req.timeframe };
}

/**
 * Abonnement : `ticker` sur un des quatre marchés affichables (une source du CVD Binance ne s'affiche pas et n'a pas de
 * ticker à suivre) ; `bars` sur un marché affichable ou une source du CVD, timeframe du registre requis. Le timeframe joint
 * à un `ticker` est ignoré et ne passe pas, comme dans `CryptoFeedHost.subscribe`.
 */
export function parseSubscribeRequest(raw: unknown): { series: CryptoSeriesId; kind: 'ticker' | 'bars'; timeframe?: CryptoTimeframe } | null {
  const req = record(raw);
  if (req === null) return null;
  if (req.kind === 'ticker') return isChartableMarket(req.series) ? { series: req.series, kind: 'ticker' } : null;
  if (req.kind === 'bars') return isCryptoSeriesId(req.series) && isCryptoTimeframe(req.timeframe) ? { series: req.series, kind: 'bars', timeframe: req.timeframe } : null;
  return null;
}

const SUBSCRIPTION_ID = /^[a-z0-9-]{1,64}$/;

/** Identifiant d'abonnement : de 1 à 64 caractères `[a-z0-9-]`, la forme de ceux que rend `CryptoFeedHost` (`sub-<n>`). */
export function isSubscriptionId(raw: unknown): raw is string {
  return typeof raw === 'string' && SUBSCRIPTION_ID.test(raw);
}
