import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LiquidationWindow,
  breadthFromTickers,
  emptyReading,
  fundingFromPremiumIndex,
  oiChange,
  type TemperatureReading,
} from '@/engine/crypto/temperature';

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Un instant du 9 octobre 2026 (UTC) en millisecondes, l’unité de la température : `at('10:01:05')`. */
const at = (hms: string): number => Date.parse(`2026-10-09T${hms}Z`);

/** La lecture, ou une erreur claire : un test qui attend une lecture ne passe pas en silence sur `null`. */
function some<T>(reading: T | null, label: string): T {
  if (reading === null) throw new Error(`${label} : aucune lecture`);
  return reading;
}

/** Ce que le réseau peut livrer à la place d’un nombre : aucune de ces valeurs n’est un nombre fini. */
const NOT_A_NUMBER: unknown[] = [undefined, null, '', '   ', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999', '-1e999', true, false, [], [1], {}, NaN, Infinity, -Infinity];

/** Ce qui n’est pas la réponse attendue d’une venue : ni tableau, ou tableau sans ligne exploitable. */
const JUNK: unknown[] = [undefined, null, 0, 42, '', 'abc', '[]', true, {}, { code: -1121, msg: 'Invalid symbol.' }, [], [null], [1, 'a', [], {}], [{}], [[]]];

// Les formes relevées chez Binance le 9 octobre 2026 ; seuls les champs lus par le module comptent, les autres sont là pour le réalisme.

/** Une ligne de `/fapi/v1/premiumIndex`. */
function premium(symbol: string, lastFundingRate: unknown): Record<string, unknown> {
  return {
    symbol,
    markPrice: '82625.70000000',
    indexPrice: '82660.40565217',
    estimatedSettlePrice: '82635.31882983',
    lastFundingRate,
    interestRate: '0.00010000',
    nextFundingTime: 1791561600000,
    time: 1791539845000,
  };
}

/** Une ligne de `/api/v3/ticker/24hr`. `count` vaut 4407 quand on ne le donne pas ; le donner à `undefined` le retire. */
function ticker(symbol: string, priceChangePercent: unknown, ...count: [] | [unknown]): Record<string, unknown> {
  return { symbol, priceChange: '-0.00007100', priceChangePercent, weightedAvgPrice: '0.00218000', lastPrice: '0.00216300', count: count.length === 0 ? 4407 : count[0] };
}

/** Une ligne de `/futures/data/openInterestHist`. */
function oi(timestamp: unknown, sumOpenInterest: unknown, symbol = 'BTCUSDT'): Record<string, unknown> {
  return { symbol, sumOpenInterest, sumOpenInterestValue: '6712345678.9', timestamp };
}

/** `points` relevés horaires, du plus ancien au plus récent, de `first` à `last` : ce que rend `openInterestHist` (`period=1h`, `limit=25`). */
function oiSeries(symbol: string, first: number, last: number, points = 25): Record<string, unknown>[] {
  return Array.from({ length: points }, (_, i) => oi(1791453600000 + i * HOUR, (first + ((last - first) * i) / (points - 1)).toFixed(3), symbol));
}

/** Les champs de l’ordre d’un message `forceOrder`. */
interface Order {
  S?: unknown;
  q?: unknown;
  p?: unknown;
  ap?: unknown;
  z?: unknown;
  T?: unknown;
}

/** Un message du flux `!forceOrder@arr` tel que Binance le pousse ; une valeur `undefined` retire le champ. */
function force(over: Order = {}, event: { E?: unknown } = {}): string {
  const order = { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', f: 'IOC', q: '0.014', p: '82500.10', ap: '82512.30', X: 'FILLED', l: '0.014', z: '0.014', T: 1791539845100, ...over };
  return JSON.stringify({ e: 'forceOrder', E: 1791539845123, ...event, o: order });
}

describe('emptyReading', () => {
  it('part sans lecture : liquidations à zéro depuis le lancement, données en minorant', () => {
    const startedAt = at('10:00:00');
    expect(emptyReading(startedAt)).toStrictEqual({
      funding: null,
      breadth: null,
      liquidations: { long: 0, short: 0, since: startedAt, at: startedAt, lowerBound: true },
      openInterest: null,
    });
  });

  it('rend un objet neuf à chaque appel', () => {
    const a = emptyReading(1);
    const b = emptyReading(1);
    expect(a).not.toBe(b);
    expect(a.liquidations).not.toBe(b.liquidations);
    a.liquidations.long = 5;
    expect(emptyReading(1).liquidations.long).toBe(0);
  });
});

describe('fundingFromPremiumIndex', () => {
  const NOW = at('12:00:00');

  it('prend la médiane des taux, celui du milieu quand leur nombre est impair', () => {
    const funding = some(fundingFromPremiumIndex([premium('SOLUSDT', '0.00010000'), premium('BTCUSDT', '0.00002929'), premium('ETHUSDT', '0.00005000')], NOW), 'funding');
    expect(funding.median).toBeCloseTo(0.00005, 12);
    expect(funding.btc).toBe(0.00002929);
    expect(funding.symbols).toBe(3);
    expect(funding.at).toBe(NOW);
  });

  it('prend la moyenne des deux taux du milieu quand leur nombre est pair', () => {
    const rows = [premium('SOLUSDT', '0.00010000'), premium('BTCUSDT', '0.00002929'), premium('XRPUSDT', '0.00008000'), premium('ETHUSDT', '0.00005000')];
    const funding = some(fundingFromPremiumIndex(rows, NOW), 'funding');
    expect(funding.median).toBeCloseTo(0.000065, 12);
    expect(funding.symbols).toBe(4);
  });

  it('ne dépend pas de l’ordre des lignes', () => {
    const rows = [premium('A1USDT', '0.0003'), premium('A2USDT', '-0.0001'), premium('A3USDT', '0.0002'), premium('A4USDT', '0.0004'), premium('A5USDT', '0.0001')];
    const forward = some(fundingFromPremiumIndex(rows, NOW), 'funding');
    const backward = some(fundingFromPremiumIndex([...rows].reverse(), NOW), 'funding');
    expect(forward.median).toBeCloseTo(0.0002, 12);
    expect(backward.median).toBe(forward.median);
  });

  it('compte les taux négatifs : le marché paie les vendeurs', () => {
    const odd = some(fundingFromPremiumIndex([premium('AUSDT', '-0.0003'), premium('BUSDT', '-0.0001'), premium('CUSDT', '0.0002')], NOW), 'impair');
    expect(odd.median).toBeCloseTo(-0.0001, 12);
    const even = some(fundingFromPremiumIndex([premium('AUSDT', '-0.0003'), premium('BUSDT', '0.0001')], NOW), 'pair');
    expect(even.median).toBeCloseTo(-0.0001, 12);
  });

  it('lit un taux donné en nombre comme un taux donné en chaîne', () => {
    const funding = some(fundingFromPremiumIndex([premium('AUSDT', 0.0001), premium('BUSDT', '0.0003')], NOW), 'funding');
    expect(funding.median).toBeCloseTo(0.0002, 12);
    expect(funding.symbols).toBe(2);
  });

  it('ne retient que les symboles qui finissent par USDT', () => {
    const rows = [
      premium('BTCUSDT', '0.0001'),
      premium('ETHUSDT', '0.0003'),
      premium('BTCUSDC', '0.5'),
      premium('ETHUSDT_261225', '0.5'),
      premium('BTCBUSD', '0.5'),
      premium('USDTBTC', '0.5'),
      premium('btcusdt', '0.5'),
    ];
    const funding = some(fundingFromPremiumIndex(rows, NOW), 'funding');
    expect(funding.median).toBeCloseTo(0.0002, 12);
    expect(funding.symbols).toBe(2);
  });

  it('ignore l’entrée sans taux fini, sans toucher aux autres', () => {
    const rows = [
      premium('BTCUSDT', '0.0001'),
      premium('ETHUSDT', '0.0003'),
      premium('SOLUSDT', '0.0002'),
      ...NOT_A_NUMBER.map((rate, i) => premium(`BAD${i}USDT`, rate)),
      { symbol: 'NORATEUSDT' },
      { lastFundingRate: '9' },
      { symbol: 42, lastFundingRate: '9' },
      null,
      7,
      'ETHUSDT',
      [],
    ];
    const funding = some(fundingFromPremiumIndex(rows, NOW), 'funding');
    expect(funding.median).toBeCloseTo(0.0002, 12);
    expect(funding.symbols).toBe(3);
  });

  it('rend le taux de BTCUSDT, et null quand il manque ou n’est pas lisible', () => {
    expect(some(fundingFromPremiumIndex([premium('BTCUSDT', '0.00002929'), premium('ETHUSDT', '0.0001')], NOW), 'avec BTC').btc).toBe(0.00002929);

    const withoutBtc = some(fundingFromPremiumIndex([premium('ETHUSDT', '0.0001'), premium('SOLUSDT', '0.0003')], NOW), 'sans BTC');
    expect(withoutBtc.btc).toBeNull();
    expect(withoutBtc.median).toBeCloseTo(0.0002, 12);

    const unreadable = some(fundingFromPremiumIndex([premium('BTCUSDT', ''), premium('ETHUSDT', '0.0001'), premium('SOLUSDT', '0.0003')], NOW), 'BTC illisible');
    expect(unreadable.btc).toBeNull();
    expect(unreadable.symbols).toBe(2);

    // BTCUSDC n’est pas BTCUSDT.
    expect(some(fundingFromPremiumIndex([premium('BTCUSDC', '0.0009'), premium('ETHUSDT', '0.0001')], NOW), 'BTCUSDC').btc).toBeNull();
  });

  it('compte BTCUSDT dans la médiane', () => {
    const funding = some(fundingFromPremiumIndex([premium('BTCUSDT', '0.0009'), premium('ETHUSDT', '0.0001'), premium('SOLUSDT', '0.0002')], NOW), 'funding');
    expect(funding.median).toBeCloseTo(0.0002, 12);
    expect(funding.btc).toBe(0.0009);
  });

  it('rend null quand aucun symbole ne donne de taux', () => {
    expect(fundingFromPremiumIndex([], NOW)).toBeNull();
    expect(fundingFromPremiumIndex([premium('BTCUSDC', '0.0001'), premium('ETHUSDT_261225', '0.0001')], NOW)).toBeNull();
    expect(fundingFromPremiumIndex([premium('BTCUSDT', ''), premium('ETHUSDT', 'abc')], NOW)).toBeNull();
  });

  it('rend null sur une réponse qui n’est pas une liste de lignes, sans lever', () => {
    for (const junk of JUNK) expect(fundingFromPremiumIndex(junk, NOW), JSON.stringify(junk) ?? String(junk)).toBeNull();
  });

  it('rend null plutôt qu’un taux infini quand la moyenne déborde', () => {
    expect(fundingFromPremiumIndex([premium('AUSDT', '1.7e308'), premium('BUSDT', '1.7e308')], NOW)).toBeNull();
  });

  it('lit une réponse réelle de Binance, delivery, USDC et nouvelles cotes sans taux compris', () => {
    const reply = [
      premium('BTCUSDT', '0.00002929'),
      premium('ETHUSDT', '0.00010000'),
      premium('SOLUSDT', '-0.00005000'),
      premium('ONEUSDT', '0.00007500'),
      premium('BTCUSDC', '0.00005000'),
      premium('ETHUSDC', '0.00005000'),
      premium('BTCUSDT_261225', ''),
      premium('ETHUSDT_261225', ''),
      premium('NEWUSDT', ''),
    ];
    const funding = some(fundingFromPremiumIndex(reply, at('12:00:00')), 'funding');
    // −0,005 %, 0,002929 %, 0,0075 %, 0,01 % : la médiane est la moyenne des deux du milieu.
    expect(funding.median).toBeCloseTo(0.000052145, 12);
    expect(funding.btc).toBe(0.00002929);
    expect(funding.symbols).toBe(4);
    expect(funding.at).toBe(at('12:00:00'));
  });
});

describe('breadthFromTickers', () => {
  const NOW = at('12:00:00');

  it('compte 2 paires en hausse sur 3 : 0,6667 à 4 décimales près', () => {
    const breadth = some(breadthFromTickers([ticker('ONEUSDT', '-3.178'), ticker('BTCUSDT', '1.204'), ticker('ETHUSDT', '0.412')], NOW), 'largeur');
    expect(breadth.upShare).toBeCloseTo(0.6667, 4);
    expect(breadth.pairs).toBe(3);
    expect(breadth.at).toBe(NOW);
  });

  it('exclut le symbole sans aucun trade (count 0), qu’il soit en hausse ou non', () => {
    const rows = [ticker('BTCUSDT', '1.2', 912345), ticker('ETHUSDT', '-0.4', 701234), ticker('LUNAUSDT', '5.5', 0), ticker('FTTUSDT', '-5.5', '0')];
    const breadth = some(breadthFromTickers(rows, NOW), 'largeur');
    expect(breadth.upShare).toBe(0.5);
    expect(breadth.pairs).toBe(2);
  });

  it('ne retient que les symboles qui finissent par USDT', () => {
    const rows = [
      ticker('BTCUSDT', '1.2'),
      ticker('ETHUSDT', '-0.4'),
      ticker('ETHBTC', '9'),
      ticker('BTCEUR', '9'),
      ticker('BNBFDUSD', '9'),
      ticker('USDTTRY', '9'),
      ticker('btcusdt', '9'),
    ];
    const breadth = some(breadthFromTickers(rows, NOW), 'largeur');
    expect(breadth.upShare).toBe(0.5);
    expect(breadth.pairs).toBe(2);
  });

  it('ne tient pas une paire à 0 % pour une hausse, mais la compte', () => {
    const breadth = some(breadthFromTickers([ticker('USDCUSDT', '0.000'), ticker('BTCUSDT', '1.2'), ticker('ETHUSDT', '-0.4'), ticker('SOLUSDT', 0)], NOW), 'largeur');
    expect(breadth.upShare).toBe(0.25);
    expect(breadth.pairs).toBe(4);
  });

  it('écarte la paire dont la variation ne se lit pas, au lieu de la compter à la baisse', () => {
    const rows = [ticker('BTCUSDT', '1.2'), ticker('ETHUSDT', '-0.4'), ...NOT_A_NUMBER.map((value, i) => ticker(`BAD${i}USDT`, value))];
    const breadth = some(breadthFromTickers(rows, NOW), 'largeur');
    expect(breadth.upShare).toBe(0.5);
    expect(breadth.pairs).toBe(2);
  });

  it('écarte la paire dont le nombre de trades ne se lit pas', () => {
    const rows = [ticker('BTCUSDT', '1.2'), ticker('ETHUSDT', '-0.4'), ...NOT_A_NUMBER.map((value, i) => ticker(`BAD${i}USDT`, '3', value)), ticker('NOCOUNTUSDT', '3', -5)];
    const breadth = some(breadthFromTickers(rows, NOW), 'largeur');
    expect(breadth.upShare).toBe(0.5);
    expect(breadth.pairs).toBe(2);
  });

  it('lit le nombre de trades et la variation en nombre comme en chaîne', () => {
    const breadth = some(breadthFromTickers([ticker('BTCUSDT', 1.2, '912345'), ticker('ETHUSDT', '-0.4', 701234)], NOW), 'largeur');
    expect(breadth.upShare).toBe(0.5);
    expect(breadth.pairs).toBe(2);
  });

  it('ignore les lignes qui ne sont pas des objets, sans toucher aux autres', () => {
    const breadth = some(breadthFromTickers([ticker('BTCUSDT', '1.2'), null, 7, 'BTCUSDT', [], { priceChangePercent: '9', count: 5 }, { symbol: 3, priceChangePercent: '9', count: 5 }], NOW), 'largeur');
    expect(breadth.upShare).toBe(1);
    expect(breadth.pairs).toBe(1);
  });

  it('rend 1 quand tout monte et 0 quand tout baisse, pas null', () => {
    expect(some(breadthFromTickers([ticker('AUSDT', '0.1'), ticker('BUSDT', '7')], NOW), 'hausse').upShare).toBe(1);
    expect(some(breadthFromTickers([ticker('AUSDT', '-0.1'), ticker('BUSDT', '-7')], NOW), 'baisse').upShare).toBe(0);
  });

  it('rend null quand aucune paire ne reste', () => {
    expect(breadthFromTickers([], NOW)).toBeNull();
    expect(breadthFromTickers([ticker('ETHBTC', '1'), ticker('BTCEUR', '1')], NOW)).toBeNull();
    expect(breadthFromTickers([ticker('LUNAUSDT', '1', 0)], NOW)).toBeNull();
    expect(breadthFromTickers([ticker('BTCUSDT', 'abc')], NOW)).toBeNull();
  });

  it('rend null sur une réponse qui n’est pas une liste de lignes, sans lever', () => {
    for (const junk of JUNK) expect(breadthFromTickers(junk, NOW), JSON.stringify(junk) ?? String(junk)).toBeNull();
  });

  it('lit une réponse réelle de Binance', () => {
    const reply = [
      ticker('BTCUSDT', '1.204', 912345),
      ticker('ETHUSDT', '0.412', 701234),
      ticker('ONEUSDT', '-3.178', 4407),
      ticker('ETHBTC', '-0.310', 1203),
      ticker('BTCEUR', '1.100', 3400),
      ticker('LUNAUSDT', '0.000', 0),
      ticker('USDCUSDT', '0.000', 55000),
    ];
    const breadth = some(breadthFromTickers(reply, NOW), 'largeur');
    // BTC et ETH montent, ONE baisse, USDC est plat : 2 sur 4. LUNA n’a pas un trade, ETHBTC et BTCEUR ne sont pas en USDT.
    expect(breadth.upShare).toBe(0.5);
    expect(breadth.pairs).toBe(4);
  });
});

describe('oiChange', () => {
  it('lit +2,4 % sur deux points', () => {
    expect(some(oiChange([oi(1791453600000, '100000'), oi(1791540000000, '102400')]), 'open interest')).toBeCloseTo(0.024, 10);
  });

  it('compare le dernier point au premier, sans regarder ceux du milieu', () => {
    const rows = [oi(1, '100'), oi(2, '130'), oi(3, '90'), oi(4, '102.4')];
    expect(some(oiChange(rows), 'open interest')).toBeCloseTo(0.024, 10);
  });

  it('classe les points par timestamp avant de comparer', () => {
    const rows = [oi(3, '102.4'), oi(1, '100'), oi(2, '130')];
    expect(some(oiChange(rows), 'désordre')).toBeCloseTo(0.024, 10);
    expect(some(oiChange([...rows].reverse()), 'inverse')).toBeCloseTo(0.024, 10);
  });

  it('lit une baisse comme une variation négative et une absence de variation comme 0', () => {
    expect(some(oiChange([oi(1, '100'), oi(2, '95')]), 'baisse')).toBeCloseTo(-0.05, 10);
    expect(oiChange([oi(1, '100'), oi(2, '100')])).toBe(0);
  });

  it('rend null avec moins de deux points', () => {
    expect(oiChange([])).toBeNull();
    expect(oiChange([oi(1, '100')])).toBeNull();
  });

  it('écarte le point sans timestamp ou sans open interest lisible, et compte ceux qui restent', () => {
    const bad = NOT_A_NUMBER.flatMap((value) => [oi(2, value), oi(value, '500')]);
    expect(some(oiChange([oi(1, '100'), ...bad, oi(9, '102.4')]), 'open interest')).toBeCloseTo(0.024, 10);
    // Un seul point lisible ne fait pas une variation.
    expect(oiChange([oi(1, '100'), ...bad])).toBeNull();
    expect(oiChange([oi(1, '100'), { timestamp: 2 }, { sumOpenInterest: '5' }, null, 7, 'x', []])).toBeNull();
  });

  it('écarte un open interest nul ou négatif, qui ne dit rien et ferait diviser par zéro', () => {
    expect(some(oiChange([oi(1, '0'), oi(2, '100'), oi(3, '110')]), 'zéro au début')).toBeCloseTo(0.1, 10);
    expect(oiChange([oi(1, '0'), oi(2, '100')])).toBeNull();
    expect(oiChange([oi(1, '100'), oi(2, '0')])).toBeNull();
    expect(oiChange([oi(1, '-5'), oi(2, '100')])).toBeNull();
  });

  it('lit un timestamp et un open interest donnés en nombre comme en chaîne', () => {
    expect(some(oiChange([oi('1791453600000', 100000), oi(1791540000000, '102400')]), 'open interest')).toBeCloseTo(0.024, 10);
  });

  it('rend null plutôt qu’une variation infinie', () => {
    expect(oiChange([oi(1, '5e-324'), oi(2, '1e308')])).toBeNull();
  });

  it('rend null sur une réponse qui n’est pas une liste de points, sans lever', () => {
    for (const junk of JUNK) expect(oiChange(junk), JSON.stringify(junk) ?? String(junk)).toBeNull();
  });

  it('lit une réponse réelle de Binance : 25 points horaires, de quoi lire 24 h', () => {
    const btc = oiSeries('BTCUSDT', 81234.123, 83183.742);
    expect(btc).toHaveLength(25);
    expect(some(oiChange(btc), 'BTC')).toBeCloseTo(0.024, 6);
    expect(some(oiChange(oiSeries('ETHUSDT', 2412345.678, 2315000.1)), 'ETH')).toBeCloseTo(2315000.1 / 2412345.678 - 1, 6);
  });
});

describe('LiquidationWindow', () => {
  const START = at('10:00:00');
  /** Une liquidation à l’instant `time` : l’heure d’événement `E` suit de 23 ms l’heure de l’ordre `T`. */
  const order = (time: number, over: Order = {}): string => force({ T: time, ...over }, { E: time + 23 });
  /** Combien de liquidations l’instance garde en mémoire : la taille des listes qu’elle tient, quel que soit leur nom. */
  const stored = (window: LiquidationWindow): number => Object.values(window).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);

  it('range une vente forcée dans les longues, au prix moyen exécuté : SELL ap 100 z 2 donne long 200', () => {
    const window = new LiquidationWindow(START);
    // p × q vaudrait 1 155 : c’est bien ap × z qui compte.
    window.push(order(START + 5000, { S: 'SELL', ap: '100', z: '2' }));
    expect(window.totals(START + 10_000)).toEqual({ long: 200, short: 0, since: START });
  });

  it('range un achat forcé dans les courtes', () => {
    const window = new LiquidationWindow(START);
    window.push(order(START + 5000, { S: 'BUY', ap: '100', z: '2' }));
    expect(window.totals(START + 10_000)).toEqual({ long: 0, short: 200, since: START });
  });

  it('additionne les liquidations de chaque côté', () => {
    const window = new LiquidationWindow(START);
    window.push(order(START + 1000, { S: 'SELL', ap: '100', z: '2' }));
    window.push(order(START + 2000, { S: 'BUY', ap: '50', z: '4' }));
    window.push(order(START + 3000, { S: 'SELL', ap: '10', z: '3' }));
    window.push(order(START + 4000, { S: 'BUY', ap: '25.5', z: '2' }));
    expect(window.totals(START + 10_000)).toEqual({ long: 230, short: 251, since: START });
  });

  it('retombe sur prix × quantité de l’ordre quand ap et z ne sont pas tous deux positifs', () => {
    const cases: [string, Order][] = [
      ['ap nul', { ap: '0', z: '2' }],
      ['z nul', { ap: '100', z: '0' }],
      ['ap absent', { ap: undefined, z: '2' }],
      ['z absent', { ap: '100', z: undefined }],
      ['ap illisible', { ap: 'abc', z: '2' }],
      ['z négatif', { ap: '100', z: '-2' }],
      ['ap infini', { ap: '1e999', z: '2' }],
      ['ap et z absents', { ap: undefined, z: undefined }],
    ];
    for (const [label, over] of cases) {
      const window = new LiquidationWindow(START);
      window.push(order(START + 1000, { ...over, p: '50', q: '3' }));
      expect(window.totals(START + 2000).long, label).toBe(150);
    }
  });

  it('prend ap × z même quand p et q ne se lisent pas', () => {
    const window = new LiquidationWindow(START);
    window.push(order(START + 1000, { ap: '100', z: '2', p: 'abc', q: undefined }));
    expect(window.totals(START + 2000).long).toBe(200);
  });

  it('écarte la liquidation dont aucun montant ne se lit', () => {
    const cases: Order[] = [
      { ap: undefined, z: undefined, p: undefined, q: undefined },
      { ap: '0', z: '0', p: '0', q: '0' },
      { ap: 'abc', z: 'abc', p: '-1', q: '2' },
      { ap: '0', z: '2', p: '50', q: '0' },
      { ap: undefined, z: '2', p: '50', q: undefined },
      // Un prix et une quantité tous deux négatifs ont un produit positif : ce n’est pas un montant pour autant.
      { ap: '-100', z: '-2', p: '-50', q: '-3' },
      // Un produit qui déborde (infini) ou s’éteint (zéro) n’est pas un montant.
      { ap: '1e200', z: '1e200', p: '0', q: '0' },
      { ap: '1e-200', z: '1e-200', p: '1e-200', q: '1e-200' },
    ];
    for (const over of cases) {
      const window = new LiquidationWindow(START);
      window.push(order(START + 1000, over));
      expect(window.totals(START + 2000), JSON.stringify(over)).toEqual({ long: 0, short: 0, since: START });
      expect(stored(window), JSON.stringify(over)).toBe(0);
    }
  });

  it('ne range que SELL et BUY, tels que Binance les écrit', () => {
    for (const side of ['sell', 'buy', 'Sell', 'LONG', 'SHORT', 'BOTH', '', undefined, null, 1, true, ['SELL']]) {
      const window = new LiquidationWindow(START);
      window.push(order(START + 1000, { S: side }));
      expect(window.totals(START + 2000), String(side)).toEqual({ long: 0, short: 0, since: START });
    }
  });

  it('ne lit que les messages forceOrder qui portent un ordre', () => {
    const valid = { S: 'SELL', p: '50', q: '3', T: START + 1000 };
    const messages = [
      JSON.stringify({ e: 'aggTrade', E: START + 1000, o: valid }),
      JSON.stringify({ e: 'forceOrder', E: START + 1000 }),
      JSON.stringify({ e: 'forceOrder', E: START + 1000, o: null }),
      JSON.stringify({ e: 'forceOrder', E: START + 1000, o: [] }),
      JSON.stringify({ e: 'forceOrder', E: START + 1000, o: 'SELL' }),
      JSON.stringify({ E: START + 1000, o: valid }),
      JSON.stringify({ e: 'FORCEORDER', E: START + 1000, o: valid }),
      JSON.stringify({ stream: '!forceOrder@arr', data: { e: 'forceOrder', E: START + 1000, o: valid } }),
      JSON.stringify([{ e: 'forceOrder', E: START + 1000, o: valid }]),
    ];
    const window = new LiquidationWindow(START);
    for (const message of messages) window.push(message);
    expect(window.totals(START + 2000)).toEqual({ long: 0, short: 0, since: START });
    window.push(JSON.stringify({ e: 'forceOrder', E: START + 1000, o: valid }));
    expect(window.totals(START + 2000).long).toBe(150);
  });

  it('ignore un texte qui n’est pas du JSON, sans lever', () => {
    const texts = ['', ' ', 'abc', '{', '{"e":"forceOrder"', '{"e":"forceOrder","o":{"S":"SELL","p":"5","q":"2","T":', 'null', '[]', '42', '"forceOrder"', 'true', '{}', '\u0000'];
    const window = new LiquidationWindow(START);
    for (const text of texts) expect(() => window.push(text), text).not.toThrow();
    for (const value of [undefined, null, 42, {}, []]) expect(() => window.push(value as unknown as string)).not.toThrow();
    expect(window.totals(START + 2000)).toEqual({ long: 0, short: 0, since: START });
    expect(stored(window)).toBe(0);
  });

  it('date l’événement par l’heure de l’ordre T, puis par E quand T manque', () => {
    const NOW = START + 90 * MINUTE;
    const counted = (message: string): boolean => {
      const window = new LiquidationWindow(START);
      window.push(message);
      return window.totals(NOW).long === 200;
    };
    const amount = { ap: '100', z: '2' };
    // T récent, E vieux : T fait foi et la liquidation est dans la fenêtre.
    expect(counted(force({ ...amount, T: NOW - 2 * MINUTE }, { E: NOW - 2 * HOUR }))).toBe(true);
    // T vieux, E récent : T fait foi et la liquidation est sortie.
    expect(counted(force({ ...amount, T: NOW - 2 * HOUR }, { E: NOW - 2 * MINUTE }))).toBe(false);
    // T absent, nul, négatif ou illisible : E.
    for (const t of [undefined, 0, -5, 'abc', '', null, {}]) {
      expect(counted(force({ ...amount, T: t }, { E: NOW - 2 * MINUTE })), `T = ${JSON.stringify(t)}`).toBe(true);
      expect(counted(force({ ...amount, T: t }, { E: NOW - 2 * HOUR })), `T = ${JSON.stringify(t)}, E vieux`).toBe(false);
    }
    // Ni T ni E : la liquidation ne peut être placée dans aucune fenêtre, elle n’est même pas retenue.
    for (const message of [force({ ...amount, T: undefined }, { E: undefined }), force({ ...amount, T: 'abc' }, { E: 0 })]) {
      const window = new LiquidationWindow(START);
      window.push(message);
      expect(window.totals(NOW).long).toBe(0);
      expect(stored(window)).toBe(0);
    }
  });

  it('lit l’heure de l’ordre quand Binance la donne en chaîne', () => {
    const window = new LiquidationWindow(START);
    window.push(force({ ap: '100', z: '2', T: String(START + 1000) }));
    expect(window.totals(START + 2000).long).toBe(200);
  });

  it('fait sortir de la fenêtre une liquidation vieille de 61 minutes', () => {
    const window = new LiquidationWindow(START);
    window.push(order(START + 5 * MINUTE, { S: 'SELL', ap: '100', z: '2' }));
    window.push(order(START + 30 * MINUTE, { S: 'BUY', ap: '10', z: '3' }));
    // À 59 minutes, la première est encore dans l’heure.
    expect(window.totals(START + 64 * MINUTE)).toEqual({ long: 200, short: 30, since: START + 4 * MINUTE });
    // À 61 minutes, elle est sortie ; la seconde, vieille de 36 minutes, reste.
    expect(window.totals(START + 66 * MINUTE)).toEqual({ long: 0, short: 30, since: START + 6 * MINUTE });
    // Plus d’une heure plus tard, plus rien.
    expect(window.totals(START + 91 * MINUTE)).toEqual({ long: 0, short: 0, since: START + 31 * MINUTE });
  });

  it('garde une liquidation vieille d’exactement la fenêtre, et plus celle d’une milliseconde de plus', () => {
    const window = new LiquidationWindow(START);
    window.push(order(START + 5 * MINUTE, { ap: '100', z: '2' }));
    expect(window.totals(START + 5 * MINUTE + HOUR).long).toBe(200);
    expect(window.totals(START + 5 * MINUTE + HOUR + 1).long).toBe(0);
  });

  it('compte depuis max(startedAt, now − fenêtre) : le lancement d’abord, puis la fenêtre qui glisse', () => {
    const window = new LiquidationWindow(START);
    expect(window.totals(START).since).toBe(START);
    expect(window.totals(START + 20 * MINUTE).since).toBe(START);
    expect(window.totals(START + HOUR).since).toBe(START);
    expect(window.totals(START + HOUR + 1).since).toBe(START + 1);
    expect(window.totals(START + 3 * HOUR).since).toBe(START + 2 * HOUR);
  });

  it('prend la largeur de fenêtre qu’on lui donne', () => {
    const window = new LiquidationWindow(START, 10 * MINUTE);
    window.push(order(START + MINUTE, { ap: '100', z: '2' }));
    expect(window.totals(START + 10 * MINUTE)).toEqual({ long: 200, short: 0, since: START });
    expect(window.totals(START + 12 * MINUTE)).toEqual({ long: 0, short: 0, since: START + 2 * MINUTE });
  });

  it('compte une liquidation d’avant le lancement qui arrive après lui, au lieu de la perdre', () => {
    // L’horloge du poste peut avancer sur celle de Binance : l’ordre est daté d’un peu avant `startedAt` mais reçu après.
    const window = new LiquidationWindow(START);
    window.push(order(START - 2000, { ap: '100', z: '2' }));
    expect(window.totals(START + 1000)).toEqual({ long: 200, short: 0, since: START });
  });

  it('répond sans changer d’état : mêmes questions, mêmes réponses, dans n’importe quel ordre', () => {
    const window = new LiquidationWindow(START);
    window.push(order(START + 5 * MINUTE, { ap: '100', z: '2' }));
    const early = window.totals(START + 10 * MINUTE);
    expect(early.long).toBe(200);
    expect(window.totals(START + 2 * HOUR).long).toBe(0);
    expect(window.totals(START + 10 * MINUTE)).toEqual(early);
    expect(window.totals(START + 10 * MINUTE)).not.toBe(early);
  });

  it('compte une liquidation arrivée hors d’ordre à son heure, pas à son rang', () => {
    const window = new LiquidationWindow(START);
    window.push(order(START + 30 * MINUTE, { ap: '100', z: '2' }));
    window.push(order(START + 10 * MINUTE, { ap: '10', z: '3' }));
    expect(window.totals(START + 40 * MINUTE).long).toBe(230);
    expect(window.totals(START + 80 * MINUTE).long).toBe(200);
    // Une liquidation déjà sortie de l’heure de la plus récente ne revient pas.
    window.push(order(START - 40 * MINUTE, { ap: '1000', z: '1' }));
    expect(window.totals(START + 40 * MINUTE).long).toBe(230);
  });

  it('ne retient que l’heure qui compte : la mémoire reste bornée sur plusieurs jours', () => {
    const window = new LiquidationWindow(START);
    const minutes = 3 * 24 * 60;
    const wrong: number[] = [];
    for (let minute = 0; minute <= minutes; minute++) {
      const time = START + minute * MINUTE;
      window.push(order(time, { ap: '10', z: '1' }));
      // À chaque minute, la fenêtre compte les liquidations de la dernière heure, une par minute, les deux bornes comprises.
      if (window.totals(time).long !== (Math.min(minute, 60) + 1) * 10) wrong.push(minute);
    }
    expect(wrong).toEqual([]);
    expect(stored(window)).toBeLessThanOrEqual(61);
  });

  it('ne retient pas une liquidation qui arrive déjà sortie de l’heure de la plus récente', () => {
    const window = new LiquidationWindow(START);
    window.push(order(START + 3 * HOUR, { ap: '100', z: '2' }));
    // Mille liquidations datées de START à START + 99 min, toutes plus vieilles d’une heure que celle de START + 3 h.
    for (let i = 0; i < 1000; i++) window.push(order(START + (i % 100) * MINUTE, { ap: '1', z: '1' }));
    expect(stored(window)).toBe(1);
    expect(window.totals(START + 3 * HOUR).long).toBe(200);
  });

  describe('avec l’heure de l’appelant', () => {
    const NOW = START + 10 * MINUTE;

    it('écarte un événement daté de plus de 60 s après elle : un T lointain ne fige pas la fenêtre', () => {
      const window = new LiquidationWindow(START);
      // Une heure d’ordre à dix jours d’ici : sans garde, elle ferait de « la plus récente » une borne que rien d’actuel n’atteint.
      window.push(order(NOW + 10 * 24 * HOUR, { ap: '100', z: '2' }), NOW);
      expect(stored(window)).toBe(0);
      expect(window.totals(NOW)).toEqual({ long: 0, short: 0, since: START });
      // Les liquidations d’à présent se comptent encore, et la fenêtre glisse comme d’habitude.
      window.push(order(NOW - MINUTE, { ap: '10', z: '3' }), NOW);
      expect(window.totals(NOW)).toEqual({ long: 30, short: 0, since: START });
      expect(window.totals(NOW + 2 * HOUR).long).toBe(0);
    });

    it('garde un événement daté d’exactement 60 s après elle, et écarte celui d’une milliseconde de plus', () => {
      const kept = new LiquidationWindow(START);
      kept.push(order(NOW + MINUTE, { ap: '100', z: '2' }), NOW);
      expect(stored(kept)).toBe(1);
      const dropped = new LiquidationWindow(START);
      dropped.push(order(NOW + MINUTE + 1, { ap: '100', z: '2' }), NOW);
      expect(stored(dropped)).toBe(0);
    });

    it('garde un événement daté d’avant elle, de quelques secondes ou de quelques minutes', () => {
      const window = new LiquidationWindow(START);
      window.push(order(NOW - 5000, { ap: '100', z: '2' }), NOW);
      window.push(order(NOW - 30 * MINUTE, { ap: '10', z: '3' }), NOW);
      expect(window.totals(NOW).long).toBe(230);
    });

    it('juge l’avance sur l’heure de l’ordre T, ou sur E quand T manque', () => {
      const far = NOW + 3 * HOUR;
      const window = new LiquidationWindow(START);
      window.push(force({ ap: '100', z: '2', T: far }, { E: NOW }), NOW);
      window.push(force({ ap: '100', z: '2', T: undefined }, { E: far }), NOW);
      expect(stored(window)).toBe(0);
      window.push(force({ ap: '100', z: '2', T: undefined }, { E: NOW }), NOW);
      expect(stored(window)).toBe(1);
    });

    it('sans heure donnée, ou avec une heure qui n’est pas un nombre fini, ne juge pas l’avance', () => {
      for (const given of [undefined, NaN, Infinity, -Infinity]) {
        const window = new LiquidationWindow(START);
        window.push(order(NOW + 10 * 24 * HOUR, { ap: '100', z: '2' }), given);
        expect(stored(window), String(given)).toBe(1);
      }
      const bare = new LiquidationWindow(START);
      bare.push(order(NOW + 10 * 24 * HOUR, { ap: '100', z: '2' }));
      expect(stored(bare)).toBe(1);
    });
  });

  describe('montant unitaire aberrant', () => {
    it('garde un montant de 1e12 dollars, la borne comprise, et écarte celui qui la dépasse', () => {
      const at = START + 1000;
      const kept = new LiquidationWindow(START);
      kept.push(order(at, { ap: '1000000000000', z: '1' }));
      expect(kept.totals(at + 1000).long).toBe(1e12);
      const dropped = new LiquidationWindow(START);
      dropped.push(order(at, { ap: '1000000000001', z: '1' }));
      expect(dropped.totals(at + 1000)).toEqual({ long: 0, short: 0, since: START });
      expect(stored(dropped)).toBe(0);
      // Le prix × la quantité de l’ordre, quand ils font le montant, sont bornés de même.
      const byOrder = new LiquidationWindow(START);
      byOrder.push(order(at, { ap: undefined, z: undefined, p: '1000000000001', q: '1' }));
      expect(stored(byOrder)).toBe(0);
    });

    it('écarte la liquidation dont le montant retenu dépasse la borne, même quand prix × quantité de l’ordre tiendraient', () => {
      const window = new LiquidationWindow(START);
      window.push(order(START + 1000, { ap: '1e13', z: '1', p: '100', q: '1' }));
      expect(stored(window)).toBe(0);
      expect(window.totals(START + 2000)).toEqual({ long: 0, short: 0, since: START });
    });

    it('ne laisse sortir aucun Infinity de totals : trois montants de 1e308 ne se somment pas', () => {
      const window = new LiquidationWindow(START);
      // Chacun est un nombre fini (1e154 × 1e154), mais deux suffisent à déborder en Infinity une fois additionnés.
      for (let i = 0; i < 3; i++) {
        window.push(order(START + 1000 + i, { S: 'SELL', ap: '1e154', z: '1e154' }));
        window.push(order(START + 2000 + i, { S: 'BUY', ap: '1e154', z: '1e154' }));
      }
      const totals = window.totals(START + 3000);
      expect(Number.isFinite(totals.long) && Number.isFinite(totals.short)).toBe(true);
      expect(totals).toEqual({ long: 0, short: 0, since: START });
      expect(stored(window)).toBe(0);
    });

    it('compte les montants plausibles à côté de ceux qu’il écarte', () => {
      const window = new LiquidationWindow(START);
      window.push(order(START + 1000, { ap: '1e154', z: '1e154' }));
      window.push(order(START + 2000, { ap: '100', z: '2' }));
      window.push(order(START + 3000, { S: 'BUY', ap: '1e20', z: '1' }));
      window.push(order(START + 4000, { S: 'BUY', ap: '50', z: '4' }));
      expect(window.totals(START + 5000)).toEqual({ long: 200, short: 200, since: START });
    });
  });

  it('lit un message réel du flux !forceOrder@arr', () => {
    const real =
      '{"e":"forceOrder","E":1791539845123,"o":{"s":"BTCUSDT","S":"SELL","o":"LIMIT","f":"IOC","q":"0.014","p":"82500.10","ap":"82512.30","X":"FILLED","l":"0.014","z":"0.014","T":1791539845100}}';
    const started = 1791539000000;
    const window = new LiquidationWindow(started);
    window.push(real);
    const totals = window.totals(1791539846000);
    expect(totals.long).toBeCloseTo(1155.1722, 6);
    expect(totals.short).toBe(0);
    expect(totals.since).toBe(started);
  });
});

describe('lecture complète', () => {
  it('se compose des quatre relevés et reste lisible en JSON : ni NaN, ni infini', () => {
    const now = at('12:00:00');
    const window = new LiquidationWindow(at('11:00:00'));
    window.push(force({ S: 'SELL', ap: '82512.30', z: '0.014', T: at('11:30:00') }, { E: at('11:30:00') + 23 }));
    window.push(force({ S: 'BUY', ap: '2412.5', z: '10', T: at('11:45:00') }, { E: at('11:45:00') + 23 }));
    const reading: TemperatureReading = {
      funding: fundingFromPremiumIndex([premium('BTCUSDT', '0.00002929'), premium('ETHUSDT', '0.0001'), premium('SOLUSDT', '-0.00005')], now),
      breadth: breadthFromTickers([ticker('BTCUSDT', '1.204'), ticker('ETHUSDT', '0.412'), ticker('ONEUSDT', '-3.178')], now),
      liquidations: { ...window.totals(now), at: now, lowerBound: true },
      openInterest: { btc: oiChange(oiSeries('BTCUSDT', 81234.123, 83183.742)), eth: oiChange(oiSeries('ETHUSDT', 2412345.678, 2315000.1)), at: now },
    };
    expect(JSON.parse(JSON.stringify(reading))).toEqual(reading);
    expect(reading.funding?.median).toBeCloseTo(0.00002929, 12);
    expect(reading.breadth?.pairs).toBe(3);
    expect(reading.liquidations.long).toBeCloseTo(1155.1722, 6);
    expect(reading.liquidations.short).toBe(24125);
    expect(reading.liquidations.since).toBe(at('11:00:00'));
    expect(reading.openInterest?.btc).toBeCloseTo(0.024, 6);
    expect(reading.openInterest?.eth).toBeLessThan(0);
  });
});

describe('entrées absurdes', () => {
  /** Générateur pseudo-aléatoire déterministe (mulberry32) : la même graine rejoue les mêmes entrées. */
  function prng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;

  const SYMBOLS: unknown[] = ['BTCUSDT', 'ETHUSDT', 'ONEUSDT', 'BTCUSDC', 'ETHUSDT_261225', 'USDT', 'btcusdt', '', null, 42, undefined];
  const NUMBERS: unknown[] = [...NOT_A_NUMBER, 0, -0, 1, -1, 0.5, 1e308, -1e308, 5e-324, 0.00002929, -3.178, 4407, '0', '-0', '0.00002929', '-3.178', '4407', '1e-7', '1e308', '-1e308', '  12  '];
  const START = at('10:00:00');
  // Pour les liquidations : des heures plausibles, ou illisibles, et tous les montants, 1e308 compris : la borne d’un montant empêche la somme de déborder.
  const TIMES: unknown[] = [...NOT_A_NUMBER, 0, -5, ...Array.from({ length: 24 }, (_, i) => START + i * 7 * MINUTE), ...Array.from({ length: 6 }, (_, i) => String(START + i * 11 * MINUTE))];
  const AMOUNTS: unknown[] = NUMBERS;

  function rows(rand: () => number, make: () => Record<string, unknown>): unknown[] {
    return Array.from({ length: Math.floor(rand() * 8) }, () => (rand() < 0.15 ? pick<unknown>(rand, [null, 7, 'x', [], [1]]) : make()));
  }

  it('ne lève jamais et ne rend que des nombres finis : funding, largeur et open interest', () => {
    const rand = prng(20261009);
    let fundings = 0;
    let breadths = 0;
    let changes = 0;
    for (let i = 0; i < 3000; i++) {
      const funding = fundingFromPremiumIndex(rows(rand, () => ({ symbol: pick(rand, SYMBOLS), lastFundingRate: pick(rand, NUMBERS) })), 1);
      if (funding !== null) {
        fundings++;
        expect(Number.isFinite(funding.median)).toBe(true);
        expect(funding.btc === null || Number.isFinite(funding.btc)).toBe(true);
        expect(Number.isInteger(funding.symbols) && funding.symbols >= 1).toBe(true);
      }
      const breadth = breadthFromTickers(rows(rand, () => ({ symbol: pick(rand, SYMBOLS), priceChangePercent: pick(rand, NUMBERS), count: pick(rand, NUMBERS) })), 1);
      if (breadth !== null) {
        breadths++;
        expect(breadth.upShare >= 0 && breadth.upShare <= 1).toBe(true);
        expect(Number.isInteger(breadth.pairs) && breadth.pairs >= 1).toBe(true);
      }
      const change = oiChange(rows(rand, () => ({ timestamp: pick(rand, NUMBERS), sumOpenInterest: pick(rand, NUMBERS) })));
      if (change !== null) {
        changes++;
        expect(Number.isFinite(change)).toBe(true);
      }
    }
    // Le tirage atteint les trois chemins : lectures rendues, et lectures refusées.
    for (const kept of [fundings, breadths, changes]) {
      expect(kept).toBeGreaterThan(100);
      expect(kept).toBeLessThan(3000);
    }
  });

  it('ne lève jamais sur des messages absurdes et ne totalise que des dollars finis et positifs', () => {
    const rand = prng(9102026);
    const window = new LiquidationWindow(START);
    for (let i = 0; i < 3000; i++) {
      const order =
        rand() < 0.1
          ? pick<unknown>(rand, [undefined, null, 'x', [], 7])
          : { S: pick<unknown>(rand, ['SELL', 'SELL', 'BUY', 'BUY', 'sell', '', null, 1]), q: pick(rand, AMOUNTS), p: pick(rand, AMOUNTS), ap: pick(rand, AMOUNTS), z: pick(rand, AMOUNTS), T: pick(rand, TIMES) };
      let text = JSON.stringify({ e: pick<unknown>(rand, ['forceOrder', 'forceOrder', 'forceOrder', 'aggTrade', 1, null]), E: pick(rand, TIMES), o: order });
      if (rand() < 0.05) text = text.slice(0, Math.floor(rand() * text.length));
      expect(() => window.push(text)).not.toThrow();
    }
    let counted = 0;
    for (const now of [START, START + HOUR, START + 3 * HOUR, 1e15]) {
      const totals = window.totals(now);
      for (const value of [totals.long, totals.short]) expect(Number.isFinite(value) && value >= 0).toBe(true);
      expect(Number.isFinite(totals.since)).toBe(true);
      counted += totals.long + totals.short;
    }
    expect(counted).toBeGreaterThan(0);
  });
});

describe('partage avec le process principal', () => {
  // Lus dans chaque test : un fichier manquant ne fait échouer que le test qui en a besoin.
  const read = (path: string): string => readFileSync(path, 'utf8');
  const exported = (text: string): string[] =>
    [...text.matchAll(/^export (?:declare )?(?:const|function|type|interface|class) (\w+)/gm)].map((m) => m[1] ?? '').sort();
  /** Le corps de l’interface de la lecture, commentaires et blancs retirés : la source et le .d.ts doivent la dire à l’identique. */
  const readingShape = (text: string): string => {
    const body = /export interface TemperatureReading \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';
    return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  };

  it('n’importe rien : le process principal compile ce fichier seul', () => {
    const source = read('src/engine/crypto/temperature.ts');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bfrom\s+['"]/);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it('est émis par electron/tsconfig.sources.json', () => {
    const config = JSON.parse(read('electron/tsconfig.sources.json')) as { files: string[] };
    expect(config.files).toContain('../src/engine/crypto/temperature.ts');
  });

  it('est typé par un .d.ts qui déclare les mêmes exports, classe et interface comprises', () => {
    const source = read('src/engine/crypto/temperature.ts');
    const declaration = read('electron/crypto/temperature.d.ts');
    expect(exported(declaration)).toEqual(exported(source));
    expect(exported(source)).toEqual(['LiquidationWindow', 'TemperatureReading', 'breadthFromTickers', 'emptyReading', 'fundingFromPremiumIndex', 'oiChange']);
  });

  it('est typé par un .d.ts qui reprend l’interface et les signatures du plan', () => {
    const source = read('src/engine/crypto/temperature.ts');
    const declaration = read('electron/crypto/temperature.d.ts');
    expect(readingShape(source)).not.toBe('');
    expect(readingShape(declaration)).toBe(readingShape(source));
    expect(readingShape(declaration)).toContain('liquidations: { long: number; short: number; since: number; at: number; lowerBound: true };');
    expect(declaration).toContain('export function emptyReading(startedAt: number): TemperatureReading;');
    expect(declaration).toContain("export function fundingFromPremiumIndex(json: unknown, at: number): TemperatureReading['funding'];");
    expect(declaration).toContain("export function breadthFromTickers(json: unknown, at: number): TemperatureReading['breadth'];");
    expect(declaration).toContain('export function oiChange(json: unknown): number | null;');
    expect(declaration).toContain('export class LiquidationWindow {');
    expect(declaration).toContain('constructor(startedAt: number, windowMs?: number);');
    expect(declaration).toContain('push(raw: string, now?: number): void;');
    expect(declaration).toContain('totals(now: number): { long: number; short: number; since: number };');
    expect(declaration).not.toMatch(/^\s*import\b/m);
  });

  it('est relié dans la carte engineSource de vitest.config.mts', () => {
    expect(read('vitest.config.mts')).toContain("'crypto/temperature': 'src/engine/crypto/temperature.ts'");
  });
});
