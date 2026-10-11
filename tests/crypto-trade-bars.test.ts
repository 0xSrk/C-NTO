import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cvdAnchor, cvdPoints } from '@/engine/crypto/cvd';
import { CRYPTO_TIMEFRAMES, type CryptoBar, type CryptoTimeframe, type CryptoTrade } from '@/engine/crypto/markets';
import { TradeBarBuilder, mergeLiveBar } from '@/engine/crypto/tradeBars';

/** Un instant du 9 octobre 2026 (UTC) en millisecondes, l’unité des trades : `at('10:01:05')`. */
const at = (hms: string): number => Date.parse(`2026-10-09T${hms}Z`);
/** Le même instant en secondes, l’unité de `CryptoBar.time`. */
const sec = (hms: string): number => at(hms) / 1000;

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index < 0 ? list.length + index : index];
  if (item === undefined) throw new Error(`aucun élément à l’index ${index}`);
  return item;
}

function tradeMs(time: number, price: number, size: number, aggressor: 'buy' | 'sell'): CryptoTrade {
  return { market: 'coinbase:BTC-USD', time, price, size, aggressor };
}

function trade(hms: string, price: number, size: number, aggressor: 'buy' | 'sell'): CryptoTrade {
  return tradeMs(at(hms), price, size, aggressor);
}

function bar(time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume?: number): CryptoBar {
  return buyVolume === undefined ? { time, open, high, low, close, volume } : { time, open, high, low, close, volume, buyVolume };
}

describe('TradeBarBuilder', () => {
  it('suit le scénario : seau incomplet sans volume acheteur, seau suivant complet, bougie précédente finale au changement de seau', () => {
    const builder = new TradeBarBuilder(1, at('10:00:30'));

    // 10:00:40 : le seau 10:00 a commencé avant l’ouverture du flux (10:00:30), il est incomplet.
    expect(builder.push(trade('10:00:40', 100, 4, 'buy'))).toStrictEqual([
      { bar: { time: sec('10:00:00'), open: 100, high: 100, low: 100, close: 100, volume: 4 }, final: false },
    ]);

    // 10:01:05 : le seau change. La bougie 10:00 revient finale, la bougie 10:01 est complète.
    expect(builder.push(trade('10:01:05', 101, 2, 'buy'))).toStrictEqual([
      { bar: { time: sec('10:00:00'), open: 100, high: 100, low: 100, close: 100, volume: 4 }, final: true },
      { bar: { time: sec('10:01:00'), open: 101, high: 101, low: 101, close: 101, volume: 2, buyVolume: 2 }, final: false },
    ]);

    // 10:01:20 : même seau, une vente de 1 : volume 3, volume acheteur 2.
    expect(builder.push(trade('10:01:20', 99, 1, 'sell'))).toStrictEqual([
      { bar: { time: sec('10:01:00'), open: 101, high: 101, low: 99, close: 99, volume: 3, buyVolume: 2 }, final: false },
    ]);

    // 10:02:00 : la bougie 10:01 revient finale.
    expect(builder.push(trade('10:02:00', 100, 5, 'buy'))).toStrictEqual([
      { bar: { time: sec('10:01:00'), open: 101, high: 101, low: 99, close: 99, volume: 3, buyVolume: 2 }, final: true },
      { bar: { time: sec('10:02:00'), open: 100, high: 100, low: 100, close: 100, volume: 5, buyVolume: 5 }, final: false },
    ]);

    // 10:01:59 arrive ensuite : son seau est antérieur au seau courant, le trade est ignoré.
    expect(builder.push(trade('10:01:59', 500, 50, 'buy'))).toStrictEqual([]);

    // La bougie en cours n’a pas bougé.
    expect(builder.push(trade('10:02:10', 100.5, 1, 'sell'))).toStrictEqual([
      { bar: { time: sec('10:02:00'), open: 100, high: 100.5, low: 100, close: 100.5, volume: 6, buyVolume: 5 }, final: false },
    ]);
  });

  it('aligne le seau sur l’epoch UTC, pour chacun des six timeframes', () => {
    const open: [CryptoTimeframe, string][] = [
      [1, '13:47:00'],
      [5, '13:45:00'],
      [15, '13:45:00'],
      [60, '13:00:00'],
      [240, '12:00:00'],
      [1440, '00:00:00'],
    ];
    expect(open.map(([tf]) => tf)).toEqual([...CRYPTO_TIMEFRAMES]);
    for (const [tf, expected] of open) {
      const [event] = new TradeBarBuilder(tf, 0).push(trade('13:47:31.250', 100, 1, 'buy'));
      expect(event?.bar.time, `${tf} min`).toBe(sec(expected));
    }
  });

  it('change de seau à la milliseconde près', () => {
    // Minuit UTC est une frontière pour les six timeframes (1 440 min se divise par chacun).
    const midnight = Date.UTC(2026, 9, 10);
    for (const tf of CRYPTO_TIMEFRAMES) {
      const span = tf * 60;
      const builder = new TradeBarBuilder(tf, 0);
      const label = `${tf} min`;
      expect(builder.push(tradeMs(midnight - 1, 100, 1, 'buy')).map((e) => [e.bar.time, e.final]), label).toEqual([[midnight / 1000 - span, false]]);
      expect(builder.push(tradeMs(midnight, 100, 1, 'buy')).map((e) => [e.bar.time, e.final]), label).toEqual([
        [midnight / 1000 - span, true],
        [midnight / 1000, false],
      ]);
      expect(builder.push(tradeMs(midnight + 1, 100, 1, 'buy')).map((e) => [e.bar.time, e.final]), label).toEqual([[midnight / 1000, false]]);
    }
  });

  it('range un instant quelconque dans le seau aligné sur le timeframe qui le contient', () => {
    for (const tf of CRYPTO_TIMEFRAMES) {
      const span = tf * 60;
      for (let i = 0; i < 400; i++) {
        const time = at('00:00:00') + i * 999_983 + 17;
        const { bar: b } = nth(new TradeBarBuilder(tf, 0).push(tradeMs(time, 100, 1, 'buy')), 0);
        expect(b.time % span, `${tf} min · ${time}`).toBe(0);
        expect(b.time <= time / 1000 && time / 1000 < b.time + span, `${tf} min · ${time}`).toBe(true);
      }
    }
  });

  it('tient un seau pour complet dès qu’il commence à startedAtMs, cet instant compris', () => {
    const start = at('10:01:00');
    const exact = nth(new TradeBarBuilder(1, start).push(trade('10:01:30', 100, 1, 'buy')), 0);
    expect(exact.bar.buyVolume).toBe(1);
    const oneMsLate = nth(new TradeBarBuilder(1, start + 1).push(trade('10:01:30', 100, 1, 'buy')), 0);
    expect(oneMsLate.bar).not.toHaveProperty('buyVolume');

    // Même règle aux six timeframes : le seau qui commence à minuit est complet si le flux s’ouvre à minuit pile,
    // incomplet s’il s’ouvre une milliseconde plus tard, et le seau suivant l’est dans les deux cas.
    const midnight = Date.UTC(2026, 9, 10);
    for (const tf of CRYPTO_TIMEFRAMES) {
      const span = tf * 60;
      const onTime = nth(new TradeBarBuilder(tf, midnight).push(tradeMs(midnight + 500, 100, 1, 'buy')), 0);
      expect(onTime.bar.buyVolume, `${tf} min · à minuit pile`).toBe(1);
      const late = new TradeBarBuilder(tf, midnight + 1);
      expect(nth(late.push(tradeMs(midnight + 500, 100, 1, 'buy')), 0).bar, `${tf} min · une milliseconde après`).not.toHaveProperty('buyVolume');
      expect(nth(late.push(tradeMs(midnight + span * 1000, 100, 1, 'buy')), -1).bar.buyVolume, `${tf} min · seau suivant`).toBe(1);
    }
  });

  it('agrège ouverture, plus haut, plus bas, clôture, volume et volume acheteur de ses trades', () => {
    const builder = new TradeBarBuilder(5, at('09:00:00'));
    builder.push(trade('10:00:10', 100, 1.5, 'buy'));
    builder.push(trade('10:01:00', 103, 2, 'sell'));
    builder.push(trade('10:02:30', 98, 0.5, 'buy'));
    expect(builder.push(trade('10:04:59.999', 101, 4, 'sell'))).toStrictEqual([
      { bar: { time: sec('10:00:00'), open: 100, high: 103, low: 98, close: 101, volume: 8, buyVolume: 2 }, final: false },
    ]);
  });

  it('garde les prix et les quantités tels quels, du minuscule à l’énorme', () => {
    const one = new TradeBarBuilder(1, 0);
    one.push(trade('10:00:01', 0.002163, 1000, 'buy'));
    expect(one.push(trade('10:00:02', 0.002161, 25_000.5, 'sell'))).toStrictEqual([
      { bar: { time: sec('10:00:00'), open: 0.002163, high: 0.002163, low: 0.002161, close: 0.002161, volume: 26_000.5, buyVolume: 1000 }, final: false },
    ]);
    const btc = new TradeBarBuilder(60, 0);
    btc.push(trade('10:00:01', 82528.01, 0.00012, 'sell'));
    expect(nth(btc.push(trade('10:00:02', 82528.5, 0.5, 'buy')), 0).bar).toStrictEqual({
      time: sec('10:00:00'),
      open: 82528.01,
      high: 82528.5,
      low: 82528.01,
      close: 82528.5,
      volume: 0.00012 + 0.5,
      buyVolume: 0.5,
    });
  });

  it('donne un volume acheteur nul à un seau complet sans achat', () => {
    expect(new TradeBarBuilder(1, 0).push(trade('10:00:10', 100, 3, 'sell'))).toStrictEqual([
      { bar: { time: sec('10:00:00'), open: 100, high: 100, low: 100, close: 100, volume: 3, buyVolume: 0 }, final: false },
    ]);
  });

  it('laisse un seau incomplet sans volume acheteur, achats compris, et lui garde le volume observé', () => {
    const builder = new TradeBarBuilder(1, at('10:00:30'));
    builder.push(trade('10:00:40', 100, 1, 'buy'));
    const events = builder.push(trade('10:00:50', 102, 2, 'buy'));
    expect(events).toStrictEqual([{ bar: { time: sec('10:00:00'), open: 100, high: 102, low: 100, close: 102, volume: 3 }, final: false }]);
    // Finale, elle reste sans volume acheteur.
    const rolled = builder.push(trade('10:01:00', 102, 1, 'buy'));
    expect(nth(rolled, 0)).toStrictEqual({ bar: { time: sec('10:00:00'), open: 100, high: 102, low: 100, close: 102, volume: 3 }, final: true });
    expect(nth(rolled, 0).bar).not.toHaveProperty('buyVolume');
  });

  it('ne comble pas les seaux sans trade', () => {
    const builder = new TradeBarBuilder(1, 0);
    builder.push(trade('10:01:10', 100, 1, 'buy'));
    const events = builder.push(trade('10:05:20', 101, 2, 'sell'));
    expect(events.map((e) => [e.bar.time, e.final])).toEqual([
      [sec('10:01:00'), true],
      [sec('10:05:00'), false],
    ]);
  });

  it('compte un trade plus ancien du seau courant, et ignore ceux de tout seau antérieur', () => {
    const builder = new TradeBarBuilder(1, 0);
    builder.push(trade('10:02:30', 100, 1, 'buy'));
    // Même seau, heure plus ancienne : l’ordre d’arrivée fait foi, le trade est compté.
    expect(builder.push(trade('10:02:10', 99, 2, 'sell'))).toStrictEqual([
      { bar: { time: sec('10:02:00'), open: 100, high: 100, low: 99, close: 99, volume: 3, buyVolume: 1 }, final: false },
    ]);
    // Seau précédent, deux seaux plus tôt, et l’epoch : tous ignorés, sans rien rendre ni rien changer.
    for (const hms of ['10:01:59.999', '10:00:00', '00:00:00']) {
      expect(builder.push(trade(hms, 1, 1000, 'buy')), hms).toStrictEqual([]);
    }
    expect(builder.push(tradeMs(0, 1, 1000, 'buy'))).toStrictEqual([]);
    expect(builder.push(trade('10:02:40', 101, 1, 'buy'))).toStrictEqual([
      { bar: { time: sec('10:02:00'), open: 100, high: 101, low: 99, close: 101, volume: 4, buyVolume: 2 }, final: false },
    ]);
  });

  it('écarte un trade dont l’heure, le prix ou la quantité ne tient pas, sans toucher à la bougie en cours', () => {
    const patches: [string, Partial<CryptoTrade>][] = [
      ['heure NaN', { time: Number.NaN }],
      ['heure infinie', { time: Number.POSITIVE_INFINITY }],
      ['prix nul', { price: 0 }],
      ['prix négatif', { price: -1 }],
      ['prix NaN', { price: Number.NaN }],
      ['prix infini', { price: Number.POSITIVE_INFINITY }],
      ['quantité nulle', { size: 0 }],
      ['quantité négative', { size: -1 }],
      ['quantité NaN', { size: Number.NaN }],
      ['quantité infinie', { size: Number.POSITIVE_INFINITY }],
    ];
    const builder = new TradeBarBuilder(1, 0);
    expect(builder.push({ ...trade('10:00:10', 100, 2, 'buy'), price: Number.NaN })).toStrictEqual([]);
    builder.push(trade('10:00:10', 100, 2, 'buy'));
    // Dans le seau courant comme dans un seau suivant : un trade invalide ne clôt jamais la bougie en cours.
    for (const base of [trade('10:00:20', 100, 1, 'buy'), trade('10:05:10', 100, 1, 'buy')]) {
      for (const [label, patch] of patches) {
        expect(builder.push({ ...base, ...patch }), `${label} · ${base.time}`).toStrictEqual([]);
      }
    }
    expect(builder.push(trade('10:00:30', 101, 1, 'sell'))).toStrictEqual([
      { bar: { time: sec('10:00:00'), open: 100, high: 101, low: 100, close: 101, volume: 3, buyVolume: 2 }, final: false },
    ]);
  });

  it('rend des bougies neuves, que ni l’appelant ni les trades suivants ne peuvent altérer', () => {
    const builder = new TradeBarBuilder(1, 0);
    const first = nth(builder.push(trade('10:00:10', 100, 1, 'buy')), 0).bar;
    // L’appelant écrit dans ce qu’il a reçu : la bougie du constructeur n’en sait rien.
    first.volume = 999;
    first.high = 999;
    const second = nth(builder.push(trade('10:00:20', 101, 2, 'sell')), 0).bar;
    expect(second).toStrictEqual({ time: sec('10:00:00'), open: 100, high: 101, low: 100, close: 101, volume: 3, buyVolume: 1 });
    // Et une bougie déjà rendue ne bouge pas avec les trades suivants, finale ou non.
    builder.push(trade('10:00:30', 102, 1, 'buy'));
    expect(second.volume).toBe(3);
    expect(second.close).toBe(101);
    const closing = nth(builder.push(trade('10:01:00', 100, 1, 'buy')), 0).bar;
    builder.push(trade('10:01:10', 50, 1, 'buy'));
    expect(closing.close).toBe(102);
    expect(closing.volume).toBe(4);
  });

  it('ne rend que des bougies qui se tiennent, dans l’ordre, et jamais deux fois la même bougie finale', () => {
    for (const tf of [1, 5] as const) {
      const span = tf * 60;
      for (const startedAt of [0, at('10:20:00')]) {
        const builder = new TradeBarBuilder(tf, startedAt);
        let previous = Number.NEGATIVE_INFINITY;
        let closed = Number.NEGATIVE_INFINITY;
        let events = 0;
        for (let i = 0; i < 600; i++) {
          // Des quantités décimales : les sommes en virgule flottante ne doivent pas faire dépasser le volume acheteur.
          const t = tradeMs(at('10:00:00') + i * 7_919, 100 + ((i * 37) % 23) / 10, (((i * 13) % 9) + 1) / 10, (i * 7) % 3 === 0 ? 'sell' : 'buy');
          for (const { bar: b, final } of builder.push(t)) {
            const label = `${tf} min · départ ${startedAt} · trade ${i}`;
            events++;
            expect(b.time % span, label).toBe(0);
            expect(b.time, `${label} · une bougie finale ne revient pas`).toBeGreaterThan(closed);
            expect(b.time, `${label} · l’ordre ne recule pas`).toBeGreaterThanOrEqual(previous);
            previous = b.time;
            if (final) closed = b.time;
            expect(Math.min(b.open, b.close), label).toBeGreaterThanOrEqual(b.low);
            expect(Math.max(b.open, b.close), label).toBeLessThanOrEqual(b.high);
            expect(b.volume, label).toBeGreaterThan(0);
            expect(b.buyVolume !== undefined, `${label} · complet seulement s’il commence à l’ouverture du flux`).toBe(b.time * 1000 >= startedAt);
            if (b.buyVolume !== undefined) {
              expect(b.buyVolume, label).toBeGreaterThanOrEqual(0);
              expect(b.buyVolume, label).toBeLessThanOrEqual(b.volume);
            }
          }
        }
        expect(events, `${tf} min · départ ${startedAt}`).toBeGreaterThan(600);
      }
    }
  });
});

describe('mergeLiveBar', () => {
  const T0 = sec('10:00:00');
  const T1 = sec('10:01:00');
  const T2 = sec('10:02:00');
  const history = (): CryptoBar[] => [bar(T0, 10, 12, 9, 11, 100), bar(T1, 11, 13, 10, 12, 80)];

  it('fusionne une bougie partielle : garde l’ouverture et le volume, étend le plus haut et le plus bas, prend la clôture du direct', () => {
    expect(mergeLiveBar(history(), bar(T1, 12.4, 14, 9.5, 13.5, 5))).toStrictEqual([bar(T0, 10, 12, 9, 11, 100), bar(T1, 11, 14, 9.5, 13.5, 80)]);
  });

  it('ne rétrécit ni le plus haut ni le plus bas avec une bougie partielle plus étroite', () => {
    expect(mergeLiveBar(history(), bar(T1, 12, 12.5, 10.5, 11.8, 2))).toStrictEqual([bar(T0, 10, 12, 9, 11, 100), bar(T1, 11, 13, 10, 11.8, 80)]);
  });

  it('garde le volume acheteur de la dernière bougie quand le direct n’en porte pas', () => {
    const bars = [bar(T0, 10, 12, 9, 11, 100, 60), bar(T1, 11, 13, 10, 12, 80, 30)];
    expect(mergeLiveBar(bars, bar(T1, 12, 13.2, 11, 12.8, 3))).toStrictEqual([bar(T0, 10, 12, 9, 11, 100, 60), bar(T1, 11, 13.2, 10, 12.8, 80, 30)]);
  });

  it('remplace la dernière bougie par une bougie complète, plus haut et plus bas compris', () => {
    // Plus haut 12,8 sous les 13 de la bougie remplacée : c’est un remplacement, pas un maximum.
    expect(mergeLiveBar(history(), bar(T1, 11.5, 12.8, 10.2, 12.1, 90, 40))).toStrictEqual([bar(T0, 10, 12, 9, 11, 100), bar(T1, 11.5, 12.8, 10.2, 12.1, 90, 40)]);
  });

  it('remplace la bougie de même instant par une bougie complète dont le volume acheteur vaut 0', () => {
    // Un volume acheteur nul est un volume acheteur : la bougie est complète, tout son volume est vendeur. Un test « truthy »
    // la prendrait pour partielle : il garderait le volume, le plus haut et le plus bas de l’historique.
    expect(mergeLiveBar(history(), bar(T1, 11.5, 12.5, 10.5, 11, 90, 0))).toStrictEqual([bar(T0, 10, 12, 9, 11, 100), bar(T1, 11.5, 12.5, 10.5, 11, 90, 0)]);
    const complete = [bar(T0, 10, 12, 9, 11, 100, 60), bar(T1, 11, 13, 10, 12, 80, 30)];
    expect(mergeLiveBar(complete, bar(T1, 11.5, 12.5, 10.5, 11, 90, 0))).toStrictEqual([bar(T0, 10, 12, 9, 11, 100, 60), bar(T1, 11.5, 12.5, 10.5, 11, 90, 0)]);
  });

  it('ajoute une bougie plus récente, partielle ou complète, sans toucher aux autres', () => {
    expect(mergeLiveBar(history(), bar(T2, 12, 13, 11, 12.5, 7, 3))).toStrictEqual([...history(), bar(T2, 12, 13, 11, 12.5, 7, 3)]);
    expect(mergeLiveBar(history(), bar(T2, 12, 12, 12, 12, 1))).toStrictEqual([...history(), bar(T2, 12, 12, 12, 12, 1)]);
    expect(mergeLiveBar(history(), bar(T1 + 1, 12, 12, 12, 12, 1)).map((b) => b.time)).toEqual([T0, T1, T1 + 1]);
  });

  it('ignore une bougie plus ancienne que la dernière', () => {
    expect(mergeLiveBar(history(), bar(T0, 1, 2, 0.5, 1.5, 1, 1))).toStrictEqual(history());
    expect(mergeLiveBar(history(), bar(T1 - 1, 1, 2, 0.5, 1.5, 1))).toStrictEqual(history());
  });

  it('part d’une série vide', () => {
    expect(mergeLiveBar([], bar(T1, 11, 13, 10, 12, 80))).toStrictEqual([bar(T1, 11, 13, 10, 12, 80)]);
  });

  it('garde les max dernières bougies en lâchant les plus anciennes', () => {
    const bars = [bar(1, 1, 1, 1, 1, 1), bar(2, 1, 1, 1, 1, 1), bar(3, 1, 1, 1, 1, 1)];
    expect(mergeLiveBar(bars, bar(4, 1, 1, 1, 1, 1), 3).map((b) => b.time)).toEqual([2, 3, 4]);
    expect(mergeLiveBar(bars, bar(4, 1, 1, 1, 1, 1), 4).map((b) => b.time)).toEqual([1, 2, 3, 4]);
    expect(mergeLiveBar(bars, bar(4, 1, 1, 1, 1, 1), 1).map((b) => b.time)).toEqual([4]);
    // Le plafond vaut quelle que soit la branche : remplacement de la dernière bougie ou bougie ignorée.
    expect(mergeLiveBar(bars, bar(3, 1, 2, 1, 2, 1, 1), 2)).toStrictEqual([bar(2, 1, 1, 1, 1, 1), bar(3, 1, 2, 1, 2, 1, 1)]);
    expect(mergeLiveBar(bars, bar(1, 1, 1, 1, 1, 1), 2).map((b) => b.time)).toEqual([2, 3]);
  });

  it('plafonne à 1000 bougies par défaut', () => {
    const thousand = Array.from({ length: 1000 }, (_, i) => bar(60 * i, 1, 1, 1, 1, 1));
    const out = mergeLiveBar(thousand, bar(60 * 1000, 2, 2, 2, 2, 2));
    expect(out).toHaveLength(1000);
    expect(nth(out, 0).time).toBe(60);
    expect(nth(out, -1).time).toBe(60 * 1000);
    // À 999 bougies, la millième s’ajoute sans rien lâcher.
    const short = mergeLiveBar(thousand.slice(0, 999), bar(60 * 999, 2, 2, 2, 2, 2));
    expect(short).toHaveLength(1000);
    expect(nth(short, 0).time).toBe(0);
  });

  it('rend un nouveau tableau et ne modifie ni le tableau ni les bougies reçus', () => {
    const frozen = Object.freeze(history().map((b) => Object.freeze(b)));
    const lives = {
      partielle: bar(T1, 12.4, 14, 9.5, 13.5, 5),
      complète: bar(T1, 11.5, 12.8, 10.2, 12.1, 90, 40),
      'plus récente': bar(T2, 12, 13, 11, 12.5, 7, 3),
      'plus ancienne': bar(T0, 1, 2, 0.5, 1.5, 1),
    };
    for (const [label, live] of Object.entries(lives)) {
      const copy = structuredClone(live);
      const out = mergeLiveBar(frozen, live, 5);
      expect(out, label).not.toBe(frozen);
      expect(frozen, label).toStrictEqual(history());
      expect(live, label).toStrictEqual(copy);
    }
    // Un résultat qu’on modifie n’altère pas la série d’origine.
    const base = history();
    const out = mergeLiveBar(base, bar(T2, 12, 13, 11, 12.5, 7, 3));
    out.pop();
    out.push(bar(9, 9, 9, 9, 9, 9));
    expect(base).toStrictEqual(history());
  });
});

describe('CVD', () => {
  it('laisse un blanc avant la première bougie qui a un volume acheteur, puis cumule 2 × volume acheteur − volume', () => {
    // Le scénario du constructeur : 10:00 incomplète, 10:01 complète (volume 3, volume acheteur 2).
    const bars = Object.freeze([bar(sec('10:00:00'), 100, 100, 100, 100, 4), bar(sec('10:01:00'), 101, 101, 99, 99, 3, 2)]);
    expect(cvdPoints(bars)).toStrictEqual([{ time: sec('10:00:00') }, { time: sec('10:01:00'), value: 1 }]);
    expect(cvdAnchor(bars)).toBe(sec('10:01:00'));
  });

  it('ancre le CVD à la première bougie quand toutes ont un volume acheteur, comme celles de Binance', () => {
    const binance = [
      bar(sec('10:00:00'), 10, 11, 9, 10.5, 10, 7), // +4
      bar(sec('10:01:00'), 10.5, 11, 10, 10.2, 6, 1), // −4
      bar(sec('10:02:00'), 10.2, 12, 10, 11.5, 8, 5), // +2
    ];
    expect(cvdPoints(binance)).toStrictEqual([
      { time: sec('10:00:00'), value: 4 },
      { time: sec('10:01:00'), value: 0 },
      { time: sec('10:02:00'), value: 2 },
    ]);
    expect(cvdAnchor(binance)).toBe(sec('10:00:00'));
  });

  it('compte un volume acheteur nul comme un volume acheteur : tout le volume est vendeur', () => {
    const bars = [bar(sec('10:00:00'), 10, 10, 10, 10, 5), bar(sec('10:01:00'), 10, 10, 10, 10, 5, 0), bar(sec('10:02:00'), 10, 10, 10, 10, 2, 2)];
    expect(cvdPoints(bars)).toStrictEqual([{ time: sec('10:00:00') }, { time: sec('10:01:00'), value: -5 }, { time: sec('10:02:00'), value: -3 }]);
    expect(cvdAnchor(bars)).toBe(sec('10:01:00'));
  });

  it('ne donne que des blancs et pas d’ancre quand aucune bougie n’a de volume acheteur', () => {
    const bars = [bar(sec('10:00:00'), 10, 10, 10, 10, 5), bar(sec('10:01:00'), 10, 10, 10, 10, 5)];
    expect(cvdPoints(bars)).toStrictEqual([{ time: sec('10:00:00') }, { time: sec('10:01:00') }]);
    expect(cvdAnchor(bars)).toBeNull();
    expect(cvdPoints([])).toStrictEqual([]);
    expect(cvdAnchor([])).toBeNull();
  });

  it('laisse un blanc, sans toucher au cumul, pour une bougie sans volume acheteur au milieu de la série', () => {
    const bars = [bar(sec('10:00:00'), 10, 10, 10, 10, 3, 2), bar(sec('10:01:00'), 10, 10, 10, 10, 9), bar(sec('10:02:00'), 10, 10, 10, 10, 4, 4)];
    expect(cvdPoints(bars)).toStrictEqual([{ time: sec('10:00:00'), value: 1 }, { time: sec('10:01:00') }, { time: sec('10:02:00'), value: 5 }]);
    expect(cvdAnchor(bars)).toBe(sec('10:00:00'));
  });

  it('écarte un volume acheteur qui n’est pas fini, pour le CVD comme pour l’ancre', () => {
    const bars = [bar(sec('10:00:00'), 10, 10, 10, 10, 3, Number.NaN), bar(sec('10:01:00'), 10, 10, 10, 10, 3, 2)];
    expect(cvdPoints(bars)).toStrictEqual([{ time: sec('10:00:00') }, { time: sec('10:01:00'), value: 1 }]);
    expect(cvdAnchor(bars)).toBe(sec('10:01:00'));
  });

  it('va de bout en bout : historique REST, trades, fusion, puis CVD ancré à la première bougie observée en entier', () => {
    // Coinbase : l’historique REST s’arrête sur la bougie 10:00 entamée, sans volume acheteur.
    const rest = [bar(sec('09:59:00'), 98, 99.5, 97.5, 99, 20), bar(sec('10:00:00'), 99, 100.5, 98.5, 100, 12)];
    let bars: CryptoBar[] = rest;
    const builder = new TradeBarBuilder(1, at('10:00:30'));
    for (const t of [trade('10:00:40', 100.2, 4, 'buy'), trade('10:01:05', 101, 2, 'buy'), trade('10:01:20', 99, 1, 'sell'), trade('10:02:00', 100, 5, 'buy')]) {
      for (const event of builder.push(t)) bars = mergeLiveBar(bars, event.bar);
    }
    expect(bars).toStrictEqual([
      bar(sec('09:59:00'), 98, 99.5, 97.5, 99, 20),
      // La bougie de l’historique garde son ouverture et son volume ; les trades ne bougent que le plus haut, le plus bas et la clôture.
      bar(sec('10:00:00'), 99, 100.5, 98.5, 100.2, 12),
      bar(sec('10:01:00'), 101, 101, 99, 99, 3, 2),
      bar(sec('10:02:00'), 100, 100, 100, 100, 5, 5),
    ]);
    expect(cvdPoints(bars)).toStrictEqual([
      { time: sec('09:59:00') },
      { time: sec('10:00:00') },
      { time: sec('10:01:00'), value: 1 },
      { time: sec('10:02:00'), value: 6 },
    ]);
    expect(cvdAnchor(bars)).toBe(sec('10:01:00'));
  });
});

describe('partage avec le process principal', () => {
  // Lus dans chaque test : un fichier manquant ne fait échouer que le test qui en a besoin.
  const read = (path: string): string => readFileSync(path, 'utf8');
  const exported = (text: string): string[] =>
    [...text.matchAll(/^export (?:declare )?(?:const|function|type|interface|class) (\w+)/gm)].map((m) => m[1] ?? '').sort();
  const specifiers = (text: string): string[] => [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');

  it('n’importe que ./markets : le process principal le compile sans alias ni bars', () => {
    const source = read('src/engine/crypto/tradeBars.ts');
    expect(specifiers(source).length).toBeGreaterThan(0);
    expect(new Set(specifiers(source))).toEqual(new Set(['./markets']));
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/^\s*import\s+['"]/m);
  });

  it('est émis par electron/tsconfig.sources.json, après markets', () => {
    const config = JSON.parse(read('electron/tsconfig.sources.json')) as { files: string[] };
    expect(config.files).toContain('../src/engine/crypto/tradeBars.ts');
    expect(config.files.indexOf('../src/engine/crypto/tradeBars.ts')).toBeGreaterThan(config.files.indexOf('../src/engine/crypto/markets.ts'));
  });

  it('est typé par un .d.ts qui déclare les mêmes exports, classe comprise', () => {
    const source = read('src/engine/crypto/tradeBars.ts');
    const declaration = read('electron/crypto/tradeBars.d.ts');
    expect(exported(declaration)).toEqual(exported(source));
    expect(exported(source)).toEqual(['TradeBarBuilder', 'mergeLiveBar']);
    expect(declaration).toMatch(/from '\.\/markets'/);
  });

  it('est typé par un .d.ts qui reprend les signatures du plan', () => {
    const declaration = read('electron/crypto/tradeBars.d.ts');
    expect(declaration).toContain('export class TradeBarBuilder {');
    expect(declaration).toContain('constructor(timeframe: CryptoTimeframe, startedAtMs: number);');
    expect(declaration).toContain('push(trade: CryptoTrade): { bar: CryptoBar; final: boolean }[];');
    expect(declaration).toContain('export function mergeLiveBar(bars: readonly CryptoBar[], live: CryptoBar, max?: number): CryptoBar[];');
  });

  it('est relié dans la carte engineSource de vitest.config.mts', () => {
    expect(read('vitest.config.mts')).toContain("'crypto/tradeBars': 'src/engine/crypto/tradeBars.ts'");
  });

  it('laisse cvd.ts au renderer : des types de ./markets seulement, et rien pour le process principal', () => {
    const cvd = read('src/engine/crypto/cvd.ts');
    expect(new Set(specifiers(cvd))).toEqual(new Set(['./markets']));
    expect(cvd).toMatch(/^import type \{[^}]*\} from '\.\/markets';$/m);
    expect(cvd).not.toMatch(/\bimport\s*\(/);
    expect(cvd).not.toMatch(/\brequire\s*\(/);
    const config = JSON.parse(read('electron/tsconfig.sources.json')) as { files: string[] };
    expect(config.files).not.toContain('../src/engine/crypto/cvd.ts');
  });
});
