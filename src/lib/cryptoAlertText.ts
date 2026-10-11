/**
 * Les textes d'une alerte crypto (`docs/ONGLET-CRYPTO.md` § 8), dans la langue active : le genre, le niveau dans son unité, la cible.
 * Partagés par la fenêtre « Nouvelle alerte » et la colonne de l'onglet (`src/modules/crypto`) et par le toast du store
 * (`src/store/cryptoAlerts.ts`) : un niveau se lit partout de la même façon.
 */
import type { CryptoAlert, CryptoAlertKind } from '@/engine/crypto/alerts';
import { cryptoMarket } from '@/engine/crypto/markets';
import { tr } from '@/i18n';
import { fmtNum, fmtPrice } from './format';

/** Un nombre signé (le plus réservé aux variations et aux écarts), à `digits` décimales. */
export function fmtSigned(v: number | null | undefined, digits: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const body = fmtNum(v, digits);
  return v > 0 && !/^[0.,\s]+$/.test(body) ? `+${body}` : body;
}

/** Un montant en dollars US compact : `4,1 M$`, `850 k$` (`$4.1M` en anglais). */
export function fmtUsdCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const [n, unit] = abs >= 1e6 ? [v / 1e6, 'M'] : abs >= 1e3 ? [v / 1e3, 'k'] : [v, ''];
  const body = fmtNum(n, unit === '' ? 0 : 1);
  return tr(`${body} ${unit}$`, `$${body}${unit}`, `${body} ${unit}$`);
}

/** Le genre d'une alerte, en tête de sa condition. */
export function alertKindText(kind: CryptoAlertKind): string {
  switch (kind) {
    case 'price_above':
      return tr('Prix au-dessus de', 'Price above', 'Precio por encima de');
    case 'price_below':
      return tr('Prix en dessous de', 'Price below', 'Precio por debajo de');
    case 'funding_median_above':
      return tr('Funding médian au-dessus de', 'Median funding above', 'Funding mediano por encima de');
    case 'funding_median_below':
      return tr('Funding médian en dessous de', 'Median funding below', 'Funding mediano por debajo de');
    case 'liquidations_long_1h_above':
      return tr('Liquidations longues 1 h au-dessus de', 'Long liquidations 1 h above', 'Liquidaciones largas 1 h por encima de');
    case 'liquidations_short_1h_above':
      return tr('Liquidations courtes 1 h au-dessus de', 'Short liquidations 1 h above', 'Liquidaciones cortas 1 h por encima de');
    case 'breadth_above':
      return tr('Largeur 24 h au-dessus de', '24 h breadth above', 'Amplitud 24 h por encima de');
    case 'breadth_below':
      return tr('Largeur 24 h en dessous de', '24 h breadth below', 'Amplitud 24 h por debajo de');
  }
}

/** Le niveau dans son unité (§ 8) : prix à la précision du marché et sa devise de cotation, funding en %, liquidations en dollars, largeur en %. */
export function alertLevelText(alert: Pick<CryptoAlert, 'target' | 'kind' | 'level'>): string {
  const { kind, level } = alert;
  switch (kind) {
    case 'price_above':
    case 'price_below': {
      const spec = cryptoMarket(alert.target);
      return spec ? `${fmtPrice(level, spec.precision)} ${spec.quote}` : fmtPrice(level);
    }
    case 'funding_median_above':
    case 'funding_median_below':
      return `${fmtSigned(level, 4)} %`;
    case 'liquidations_long_1h_above':
    case 'liquidations_short_1h_above':
      return fmtUsdCompact(level);
    case 'breadth_above':
    case 'breadth_below':
      return `${fmtNum(level, Number.isInteger(level) ? 0 : 1)} %`;
  }
}

/** La cible d'une alerte : le libellé du marché, ou la température. */
export function alertTargetText(target: CryptoAlert['target']): string {
  return target === 'temperature' ? tr('Température · Binance', 'Temperature · Binance', 'Temperatura · Binance') : (cryptoMarket(target)?.label ?? target);
}
