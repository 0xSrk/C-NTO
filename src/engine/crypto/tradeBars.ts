/**
 * Les bougies que le process principal construit à partir des trades quand la venue ne pousse pas de bougies
 * (Coinbase et Bybit), et le rangement d'une bougie live dans la série affichée (`docs/ONGLET-CRYPTO.md` § 5).
 * Partagé par le process principal, qui lit les trades et construit les bougies (`electron/crypto-feeds.ts`), et
 * par le renderer, qui range celles qu'il reçoit avec `mergeLiveBar` (émis vers `dist-electron/crypto/tradeBars.js`
 * par `electron/tsconfig.sources.json`). Il n'importe que des types de `./markets` : le process principal le
 * compile sans alias ni `bars.ts`. Aucun réseau ici. Barres en secondes UTC, trades en millisecondes.
 */
import type { CryptoBar, CryptoTimeframe, CryptoTrade } from './markets';

/** Bougies que `mergeLiveBar` garde au plus, quand l'appelant ne fixe pas de plafond. */
const MAX_BARS = 1000;

/** Un prix ou une quantité de trade : un nombre fini strictement positif, comme les lignes que garde `venues.ts`. */
const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** La bougie en cours de construction. `buyVolume` reste `null` tant que le seau est incomplet. */
interface Building {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buyVolume: number | null;
}

/** Une bougie neuve, sans `buyVolume` quand le seau est incomplet : celle que `push` rend n'est jamais celle que le constructeur continue de remplir. */
function snapshot(b: Building): CryptoBar {
  const bar: CryptoBar = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
  return b.buyVolume === null ? bar : { ...bar, buyVolume: b.buyVolume };
}

/**
 * Construit les bougies d'un marché à partir de ses trades. Un constructeur par abonnement : `timeframe` (en
 * minutes) fixe la largeur du seau, `startedAtMs` est l'instant à partir duquel le flux est tenu pour effectif.
 * Le process principal (`electron/crypto-feeds.ts`) le prend à la confirmation de l'abonnement, plus une marge d'une
 * seconde : l'accusé de la venue pour la demande qui porte ses clés, ou la première trame de son propre flux (jamais
 * celle d'un autre flux, ni d'une activation précédente du sien) ; il recrée le constructeur à chaque reconnexion.
 * Une bougie entamée avant que le flux ne soit effectif n'est jamais marquée complète.
 * Le seau d'un trade commence à `floor(time / 1000 / (timeframe × 60)) × timeframe × 60` secondes, aligné sur
 * l'epoch UTC. Un seau commencé avant `startedAtMs` est incomplet : les trades d'avant l'ouverture du flux
 * manquent, sa bougie n'a pas de `buyVolume` (son ouverture et son volume sont ceux des seuls trades vus ;
 * `mergeLiveBar` garde ceux de l'historique). Un seau commencé à `startedAtMs` ou après est complet : sa bougie
 * porte le `buyVolume`, la somme des quantités dont l'agresseur est l'acheteur.
 * Aucune bougie n'est inventée pour un seau sans trade. L'ordre d'arrivée fait foi : ouverture et clôture sont
 * celles du premier et du dernier trade reçus dans le seau.
 */
export class TradeBarBuilder {
  /** Largeur du seau, en secondes. */
  private readonly span: number;
  private readonly startedAtMs: number;
  private current: Building | null = null;

  constructor(timeframe: CryptoTimeframe, startedAtMs: number) {
    this.span = timeframe * 60;
    this.startedAtMs = startedAtMs;
  }

  /**
   * Range un trade et rend la bougie de son seau (`final: false`), précédée, quand le seau change, de la bougie
   * du seau précédent, désormais close (`final: true`). Un trade d'un seau antérieur au seau courant est
   * ignoré, comme un trade qui ne tient pas (heure non finie, prix ou quantité nuls, négatifs ou non finis) :
   * il ne rend rien et ne touche pas la bougie en cours. Les bougies rendues sont neuves : un appel suivant ne
   * les modifie pas.
   */
  push(trade: CryptoTrade): { bar: CryptoBar; final: boolean }[] {
    const { price, size } = trade;
    const bucket = Math.floor(trade.time / 1000 / this.span) * this.span;
    if (!Number.isFinite(bucket) || !positive(price) || !positive(size)) return [];
    let live = this.current;
    if (live !== null && bucket < live.time) return [];
    const events: { bar: CryptoBar; final: boolean }[] = [];
    if (live === null || bucket > live.time) {
      if (live !== null) events.push({ bar: snapshot(live), final: true });
      live = { time: bucket, open: price, high: price, low: price, close: price, volume: 0, buyVolume: bucket * 1000 >= this.startedAtMs ? 0 : null };
      this.current = live;
    }
    live.high = Math.max(live.high, price);
    live.low = Math.min(live.low, price);
    live.close = price;
    live.volume += size;
    if (live.buyVolume !== null && trade.aggressor === 'buy') live.buyVolume += size;
    events.push({ bar: snapshot(live), final: false });
    return events;
  }
}

/**
 * Range une bougie live dans la série affichée, par `time` croissant, et rend un nouveau tableau : ni la série
 * reçue ni ses bougies ne sont modifiées. Même `time` que la dernière bougie : sans `buyVolume`, la bougie live
 * est partielle (son seau a commencé avant l'ouverture du flux) et ne fait que prolonger la dernière, dont elle
 * garde l'ouverture, le volume et le `buyVolume` : le plus haut est le plus grand des deux, le plus bas le plus
 * petit, la clôture celle du direct ; avec `buyVolume`, elle est entière (Binance, ou un seau vu depuis son
 * début) et remplace la dernière. `time` plus récent : elle est ajoutée. Plus ancien : elle est ignorée.
 * La série garde au plus `max` bougies, les plus récentes.
 */
export function mergeLiveBar(bars: readonly CryptoBar[], live: CryptoBar, max = MAX_BARS): CryptoBar[] {
  const last = bars.at(-1);
  let next: CryptoBar[];
  if (last === undefined || live.time > last.time) {
    next = [...bars, live];
  } else if (live.time < last.time) {
    next = [...bars];
  } else {
    const merged: CryptoBar =
      live.buyVolume !== undefined ? live : { ...last, high: Math.max(last.high, live.high), low: Math.min(last.low, live.low), close: live.close };
    next = [...bars.slice(0, -1), merged];
  }
  return next.length > max ? next.slice(next.length - max) : next;
}
