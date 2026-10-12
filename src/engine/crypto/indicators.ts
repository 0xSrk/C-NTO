/**
 * Le catalogue d'indicateurs du chart crypto, côté renderer seulement (`docs/ONGLET-CRYPTO.md` § 3 et § 7).
 * L'EMA, la SMA, le volume relatif et l'ATR du desk ne dépendent d'aucune séance : ils sont repris tels quels.
 * Le VWAP et les niveaux du desk sont ancrés sur la séance Globex (bascule à 18:00 ET) ; la crypto se négocie 24 h sur 24,
 * sans séance, ils sont donc réécrits ici avec une ancre UTC : le VWAP repart de zéro à 00:00 UTC, les niveaux sont ceux
 * du jour UTC précédent. Le CVD vient de `./cvd`. Les lignes gardent les clés, les étiquettes et les teintes de leurs
 * équivalents du desk.
 * Une journée n'est ancrée que si la fenêtre de bougies la couvre : sa première bougie n'est pas plus tardive que 00:00 UTC
 * de cette journée. L'historique chargé (500 bougies, ou depuis 00:00 UTC de la veille si c'est plus : `historyTarget`)
 * commence le plus souvent en pleine journée : sa première journée est alors partielle, et un VWAP parti du début de la
 * fenêtre ou des extrêmes partiels présentés comme ceux de la veille seraient faux sans le paraître. Une journée non
 * couverte n'a donc ni VWAP, ni bandes ; le jour d'après n'a pas de niveaux.
 */
import type { Bar } from '@/engine/bars';
import { indicatorById, type IndicatorDefinition, type IndicatorInstance, type IndicatorLine, type IndicatorParam } from '@/engine/indicators';
import { cvdPoints } from './cvd';
import { cryptoMarket, type CryptoBar, type CryptoMarketId, type CryptoTimeframe } from './markets';

type LinePoint = IndicatorLine['data'][number];

/**
 * Les teintes des lignes du desk (`PALETTE` de `src/engine/indicators.ts`, qui ne l'exporte pas), et `--amber` de
 * `src/design/tokens.css` pour le CVD.
 */
const COLOR = {
  ink: '#ffffff',
  steel: '#6c6c6c',
  mint: '#7fcf9a',
  ember: '#e0776c',
  amber: '#d8b45a',
} as const;

const DAY_SECONDS = 86_400;

/** Le rang du jour UTC d'une bougie depuis l'epoch (`time` est en secondes UTC) : l'ancre du VWAP et des niveaux. */
function utcDay(timeSec: number): number {
  return Math.floor(timeSec / DAY_SECONDS);
}

/** Une définition du desk reprise telle quelle : l'objet même de `INDICATORS`, jamais une copie. */
function deskIndicator(id: string): IndicatorDefinition {
  const def = indicatorById(id);
  if (!def) throw new Error(`indicateur du desk introuvable : ${id}`);
  return def;
}

/**
 * Vrai quand la fenêtre de bougies remonte jusqu'au début du jour UTC `day` : sa première bougie n'est pas plus tardive
 * que 00:00 UTC de ce jour. Le test ne lit jamais l'heure de la première bougie du jour, qui peut être 00:05 quand la
 * venue n'envoie pas de bougie pour un seau vide : seul compte ce que la fenêtre contient avant ce jour.
 */
function reachesDayStart(bars: readonly Bar[], day: number): boolean {
  const first = bars[0];
  return first !== undefined && first.time <= day * DAY_SECONDS;
}

/**
 * Les points d'une ligne ancrée sur le jour UTC : un point par bougie qui a une valeur, et un blanc entre le dernier point
 * d'un jour et le premier du suivant, que minuit soit liquide ou non. Le chart dessine alors un segment par jour, sans
 * raccord oblique. Une bougie sans valeur n'a pas de point : le blanc, lui, n'est posé qu'à la rupture. Il tombe sur
 * l'instant entier à mi-chemin entre ces deux bougies, jamais sur celui d'une bougie ; deux bougies à moins de 2 s l'une
 * de l'autre n'en laissent aucun (la plus courte bougie dure 1 min), et la ligne n'y est pas coupée.
 */
function dayLine(bars: readonly Bar[], values: readonly (number | null)[]): LinePoint[] {
  const data: LinePoint[] = [];
  let lastDay = Number.NaN;
  let lastTime = Number.NaN;
  bars.forEach((bar, i) => {
    const value = values[i];
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    const day = utcDay(bar.time);
    if (data.length > 0 && day !== lastDay) {
      const blank = Math.floor((lastTime + bar.time) / 2);
      if (blank > lastTime) data.push({ time: blank });
    }
    data.push({ time: bar.time, value });
    lastDay = day;
    lastTime = bar.time;
  });
  return data;
}

const vwapUtc: IndicatorDefinition = {
  id: 'vwap-utc',
  name: 'VWAP 00:00 UTC',
  short: 'VWAP',
  description: 'Prix moyen pondéré par le volume, réinitialisé chaque jour à 00:00 UTC : la crypto se négocie 24 h sur 24, sans séance. Bandes ±1σ / ±2σ.',
  family: 'volume',
  params: [{ key: 'bands', label: 'Bandes', type: 'select', default: '2', options: [{ value: '0', label: 'Aucune' }, { value: '1', label: '±1σ' }, { value: '2', label: '±1σ et ±2σ' }] }],
  compute: (bars, p) => {
    // Moyenne et variance pondérées par le volume, mises à jour bougie après bougie : la première bougie du jour vaut
    // exactement son prix typique, avec un σ nul. (Le VWAP du desk somme prix et prix², qui perdent des chiffres là.)
    const rows: ({ mean: number; sd: number } | null)[] = [];
    let day = Number.NaN;
    let covered = false;
    let volume = 0;
    let mean = 0;
    let spread = 0;
    for (const bar of bars) {
      const barDay = utcDay(bar.time);
      if (barDay !== day) {
        day = barDay;
        covered = reachesDayStart(bars, barDay);
        volume = 0;
        mean = 0;
        spread = 0;
      }
      // Un jour que la fenêtre ne couvre pas depuis 00:00 UTC n'a pas de VWAP : jamais ancré ailleurs qu'à minuit.
      if (!covered) {
        rows.push(null);
        continue;
      }
      const typical = (bar.high + bar.low + bar.close) / 3;
      // Le volume pèse tel quel, sous 1 aussi : le VWAP du desk compte au moins 1 par bougie (des contrats entiers), alors
      // qu'une bougie de BTC pèse souvent moins d'un BTC. Une bougie sans volume, ou sans prix ou volume fini, ne pèse
      // rien : le VWAP ne bouge pas.
      if (bar.volume > 0 && Number.isFinite(bar.volume) && Number.isFinite(typical)) {
        volume += bar.volume;
        const gap = typical - mean;
        mean += gap * (bar.volume / volume);
        spread += bar.volume * gap * (typical - mean);
      }
      rows.push(volume > 0 ? { mean, sd: Math.sqrt(Math.max(0, spread / volume)) } : null);
    }
    const band = (k: number): (number | null)[] => rows.map((row) => (row ? row.mean + k * row.sd : null));
    const bands = Number(p.bands);
    const lines: IndicatorLine[] = [{ key: 'vwap', label: 'VWAP', color: COLOR.ink, lineWidth: 2, pane: 'price', data: dayLine(bars, rows.map((row) => (row ? row.mean : null))) }];
    if (bands >= 1) {
      lines.push({ key: 'up1', label: '+1σ', color: COLOR.steel, lineStyle: 'dotted', pane: 'price', data: dayLine(bars, band(1)) });
      lines.push({ key: 'dn1', label: '−1σ', color: COLOR.steel, lineStyle: 'dotted', pane: 'price', data: dayLine(bars, band(-1)) });
    }
    if (bands >= 2) {
      lines.push({ key: 'up2', label: '+2σ', color: COLOR.steel, lineStyle: 'dashed', pane: 'price', data: dayLine(bars, band(2)) });
      lines.push({ key: 'dn2', label: '−2σ', color: COLOR.steel, lineStyle: 'dashed', pane: 'price', data: dayLine(bars, band(-2)) });
    }
    return { id: 'vwap-utc', lines };
  },
};

interface DayLevels {
  high: number;
  low: number;
  close: number;
}

/**
 * Pour chaque bougie, plus haut, plus bas et clôture du jour UTC qui précède le sien, ou `null`. Seul le jour calendaire
 * d'avant compte, et seulement s'il a des bougies valides et que la fenêtre le couvre depuis 00:00 UTC : un jour sans
 * bougie ne se remplace pas par un plus ancien, et les extrêmes d'un jour partiel ne passent pas pour ceux de la veille.
 * Une bougie sans plus haut, plus bas ou clôture fini est écartée en entier, sans effacer le reste du jour.
 */
function previousDayLevels(bars: readonly Bar[]): (DayLevels | null)[] {
  const out: (DayLevels | null)[] = [];
  let day = Number.NaN;
  let current: DayLevels | null = null;
  let previous: DayLevels | null = null;
  for (const bar of bars) {
    const barDay = utcDay(bar.time);
    if (barDay !== day) {
      previous = current !== null && barDay === day + 1 && reachesDayStart(bars, day) ? current : null;
      current = null;
      day = barDay;
    }
    if (Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close)) {
      current =
        current === null
          ? { high: bar.high, low: bar.low, close: bar.close }
          : { high: Math.max(current.high, bar.high), low: Math.min(current.low, bar.low), close: bar.close };
    }
    out.push(previous);
  }
  return out;
}

const levelsUtc: IndicatorDefinition = {
  id: 'levels-utc',
  name: 'Niveaux du jour UTC précédent',
  short: 'PDH/PDL',
  description: 'Plus haut, plus bas et clôture du jour UTC précédent (de 00:00 à 24:00 UTC) : supports et résistances suivis par la majorité des intervenants.',
  family: 'niveaux',
  params: [],
  compute: (bars) => {
    const levels = previousDayLevels(bars);
    return {
      id: 'levels-utc',
      lines: [
        { key: 'pdh', label: 'PDH', color: COLOR.mint, lineStyle: 'dashed', pane: 'price', data: dayLine(bars, levels.map((level) => (level ? level.high : null))) },
        { key: 'pdl', label: 'PDL', color: COLOR.ember, lineStyle: 'dashed', pane: 'price', data: dayLine(bars, levels.map((level) => (level ? level.low : null))) },
        { key: 'pdc', label: 'PDC', color: COLOR.steel, lineStyle: 'dotted', pane: 'price', data: dayLine(bars, levels.map((level) => (level ? level.close : null))) },
      ],
    };
  },
};

/** Le CVD du chart et le CVD Binance : la même ligne de panneau, sur des bougies différentes (voir `inputBarsFor`). */
function cvdIndicator(def: Pick<IndicatorDefinition, 'id' | 'name' | 'description'>, label: string): IndicatorDefinition {
  return {
    ...def,
    short: 'CVD',
    family: 'volume',
    params: [],
    // `buyVolume` n'est pas dans `Bar` : les bougies sont des `CryptoBar` à l'exécution, et `cvdPoints` le lit.
    compute: (bars) => ({ id: def.id, lines: [{ key: 'cvd', label, color: COLOR.amber, pane: 'pane', data: cvdPoints(bars) }] }),
  };
}

/** Les huit indicateurs du chart crypto, dans l'ordre du catalogue. */
export const CRYPTO_INDICATORS: IndicatorDefinition[] = [
  deskIndicator('ema'),
  deskIndicator('sma'),
  deskIndicator('volume-ma'),
  deskIndicator('atr'),
  vwapUtc,
  levelsUtc,
  cvdIndicator(
    {
      id: 'cvd',
      name: 'Delta de volume cumulé',
      description: 'Acheteurs moins vendeurs, cumulés bougie après bougie. Complet sur Binance ; sur Coinbase et Bybit, il commence à l’ouverture du flux.',
    },
    'CVD',
  ),
  cvdIndicator(
    {
      id: 'cvd-binance',
      name: 'Delta de volume cumulé · Binance',
      description: 'CVD de la série Binance USDT du même actif (BTCUSDT, ONDOUSDT), historique complet : un autre marché que celui du chart.',
    },
    'CVD Binance',
  ),
];

/** Ancrés sur le jour UTC : en 1j, un point par jour, invisible ou dégénéré. Ni proposés ni calculés à cette unité. */
const DAY_ANCHORED: ReadonlySet<string> = new Set(['vwap-utc', 'levels-utc']);
const DAY: CryptoTimeframe = 1440;

/**
 * Le catalogue du marché et de l'unité de temps, dans l'ordre de `CRYPTO_INDICATORS` : le CVD Binance pour un marché qui a sa
 * série Binance, rien d'ancré au jour UTC en 1j. Ce que l'onglet propose et trace, et ce que l'agent lit (`cryptoDeskPort`).
 */
export function offeredCatalog(market: CryptoMarketId, timeframe: CryptoTimeframe): IndicatorDefinition[] {
  const hasProxy = cryptoMarket(market)?.cvdProxy !== undefined;
  return CRYPTO_INDICATORS.filter((def) => (def.id !== 'cvd-binance' || hasProxy) && !(timeframe === DAY && DAY_ANCHORED.has(def.id)));
}

/** La définition du catalogue crypto qui porte cet identifiant. Le VWAP et les niveaux de séance du desk n'y sont pas. */
export function cryptoIndicatorById(id: string): IndicatorDefinition | undefined {
  return CRYPTO_INDICATORS.find((def) => def.id === id);
}

/**
 * Un nombre est sur la grille d'un paramètre quand `(valeur - min) / pas` est entier, `min` valant 0 s'il manque. Un pas
 * absent, nul, négatif ou non fini n'est pas une grille. L'écart toléré (relatif au nombre de pas) absorbe le bruit des
 * flottants : 0,3 / 0,1 vaut 2,9999999999999996. La règle du store (`readParams`) et du contrôle des outils de l'agent
 * (`readParamsShape`, avant la confirmation de l'opérateur).
 */
export function onStepGrid(value: number, spec: IndicatorParam): boolean {
  const { step } = spec;
  if (step === undefined || !Number.isFinite(step) || step <= 0) return true;
  const steps = (value - (spec.min ?? 0)) / step;
  return Math.abs(steps - Math.round(steps)) <= 1e-12 * Math.max(1, Math.abs(steps));
}

/** Ce que le chart affiche à la première ouverture : le CVD, et le VWAP à ±1σ (la définition propose ±1σ et ±2σ). */
export const DEFAULT_CRYPTO_INDICATORS: IndicatorInstance[] = [
  { id: 'i_cvd', definitionId: 'cvd', params: {}, visible: true },
  { id: 'i_vwap', definitionId: 'vwap-utc', params: { bands: '1' }, visible: true },
];

/**
 * Les bougies qu'un indicateur lit : celles du marché affiché, sauf `cvd-binance`, qui lit la série Binance du même actif.
 * Sans bougie de cette série, `cvd-binance` n'a rien à tracer : il ne se rabat pas sur celles du chart.
 */
export function inputBarsFor(definitionId: string, chartBars: readonly CryptoBar[], proxyBars: readonly CryptoBar[]): readonly CryptoBar[] {
  return definitionId === 'cvd-binance' ? proxyBars : chartBars;
}
