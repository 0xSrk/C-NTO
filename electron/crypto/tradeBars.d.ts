/**
 * Types du module émis vers `dist-electron/crypto/tradeBars.js`.
 * L'implémentation est `src/engine/crypto/tradeBars.ts`.
 */
import type { CryptoBar, CryptoTimeframe, CryptoTrade } from './markets';

/**
 * Construit les bougies d'un marché à partir de ses trades. Un constructeur par abonnement : `timeframe` (en
 * minutes) fixe la largeur du seau, `startedAtMs` est l'instant où le flux s'est ouvert.
 * Le seau d'un trade commence à `floor(time / 1000 / (timeframe × 60)) × timeframe × 60` secondes, aligné sur
 * l'epoch UTC. Un seau commencé avant `startedAtMs` est incomplet : sa bougie n'a pas de `buyVolume`. Un seau
 * commencé à `startedAtMs` ou après est complet : sa bougie porte le `buyVolume`, la somme des quantités dont
 * l'agresseur est l'acheteur. Aucune bougie n'est inventée pour un seau sans trade.
 */
export class TradeBarBuilder {
  constructor(timeframe: CryptoTimeframe, startedAtMs: number);
  /**
   * Range un trade et rend la bougie de son seau (`final: false`), précédée, quand le seau change, de la bougie
   * du seau précédent, désormais close (`final: true`). Un trade d'un seau antérieur au seau courant, ou qui ne
   * tient pas (heure non finie, prix ou quantité nuls, négatifs ou non finis), est ignoré : `[]`. Les bougies
   * rendues sont neuves.
   */
  push(trade: CryptoTrade): { bar: CryptoBar; final: boolean }[];
}
/**
 * Range une bougie live dans la série, par `time` croissant, et rend un nouveau tableau : l'entrée n'est jamais
 * modifiée. Même `time` que la dernière bougie : sans `buyVolume`, elle la prolonge (ouverture, volume et
 * `buyVolume` gardés, plus haut et plus bas étendus, clôture du direct) ; avec `buyVolume`, elle la remplace.
 * `time` plus récent : ajoutée. Plus ancien : ignorée. Au plus `max` bougies gardées (1000 par défaut), les plus récentes.
 */
export function mergeLiveBar(bars: readonly CryptoBar[], live: CryptoBar, max?: number): CryptoBar[];
