/**
 * Les noms et les descriptions des indicateurs propres au chart crypto, dans les trois langues (`docs/ONGLET-CRYPTO.md` § 7).
 * Le catalogue de `src/engine/crypto/indicators.ts` porte un texte français de repli ; ce que l'écran affiche passe ici,
 * par identifiant. Tout autre identifiant (EMA, SMA, volume relatif, ATR) garde la copie de Visual.
 * Chaque phrase dit ce que l'indicateur calcule, et seulement cela (`src/engine/crypto/indicators.ts`, `cvd.ts`).
 */
import { tr } from '@/i18n';
import { trIndicatorDesc, trIndicatorName } from '@/modules/visual/IndicatorCards';

/** Le nom affiché d'un indicateur du catalogue crypto ; `fallback` pour un identifiant que ce fichier ne traduit pas. */
export function cryptoIndicatorName(id: string, fallback: string): string {
  switch (id) {
    case 'cvd':
      return tr('Delta de volume cumulé', 'Cumulative volume delta', 'Delta de volumen acumulado');
    case 'cvd-binance':
      return tr('Delta de volume cumulé · Binance', 'Cumulative volume delta · Binance', 'Delta de volumen acumulado · Binance');
    case 'vwap-utc':
      return tr('VWAP 00:00 UTC', 'VWAP 00:00 UTC', 'VWAP 00:00 UTC');
    case 'levels-utc':
      return tr('Niveaux du jour UTC précédent', 'Previous UTC day levels', 'Niveles del día UTC anterior');
    default:
      return trIndicatorName(id, fallback);
  }
}

/** La description affichée d'un indicateur du catalogue crypto ; `fallback` pour un identifiant que ce fichier ne traduit pas. */
export function cryptoIndicatorDesc(id: string, fallback: string): string {
  switch (id) {
    case 'cvd':
      return tr(
        'Volume acheteur moins volume vendeur, cumulé bougie après bougie. Complet sur Binance ; sur Coinbase et Bybit, il commence à la première bougie observée en entier depuis l’ouverture du flux.',
        'Buy volume minus sell volume, cumulated candle after candle. Complete on Binance; on Coinbase and Bybit it starts at the first candle observed in full since the stream opened.',
        'Volumen comprador menos volumen vendedor, acumulado vela a vela. Completo en Binance; en Coinbase y Bybit empieza en la primera vela observada entera desde la apertura del flujo.',
      );
    case 'cvd-binance':
      return tr(
        'CVD de la série Binance USDT du même actif (BTCUSDT, ONDOUSDT), historique complet : un autre marché que celui du chart.',
        'CVD of the Binance USDT series for the same asset (BTCUSDT, ONDOUSDT), full history: a different market from the chart’s.',
        'CVD de la serie Binance USDT del mismo activo (BTCUSDT, ONDOUSDT), historial completo: un mercado distinto del gráfico.',
      );
    case 'vwap-utc':
      return tr(
        'Prix moyen pondéré par le volume, réinitialisé chaque jour à 00:00 UTC : la crypto se négocie 24 h sur 24, sans séance. Bandes ±1σ / ±2σ. Une journée que l’historique chargé ne couvre pas depuis 00:00 UTC n’a pas de VWAP.',
        'Volume-weighted average price, reset every day at 00:00 UTC: crypto trades around the clock, with no session. Bands ±1σ / ±2σ. A day the loaded history does not cover from 00:00 UTC has no VWAP.',
        'Precio medio ponderado por volumen, reiniciado cada día a las 00:00 UTC: la cripto cotiza las 24 h, sin sesión. Bandas ±1σ / ±2σ. Un día que el historial cargado no cubre desde las 00:00 UTC no tiene VWAP.',
      );
    case 'levels-utc':
      return tr(
        'Plus haut (PDH), plus bas (PDL) et clôture (PDC) du jour UTC précédent, de 00:00 à 24:00 UTC. Sans niveaux quand l’historique chargé ne couvre pas la veille depuis 00:00 UTC.',
        'High (PDH), low (PDL) and close (PDC) of the previous UTC day, from 00:00 to 24:00 UTC. No levels when the loaded history does not cover the previous day from 00:00 UTC.',
        'Máximo (PDH), mínimo (PDL) y cierre (PDC) del día UTC anterior, de 00:00 a 24:00 UTC. Sin niveles cuando el historial cargado no cubre el día anterior desde las 00:00 UTC.',
      );
    default:
      return trIndicatorDesc(id, fallback);
  }
}
