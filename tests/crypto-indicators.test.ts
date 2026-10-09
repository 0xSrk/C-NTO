import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cvdPoints } from '@/engine/crypto/cvd';
import { CRYPTO_INDICATORS, DEFAULT_CRYPTO_INDICATORS, cryptoIndicatorById, inputBarsFor } from '@/engine/crypto/indicators';
import type { CryptoBar } from '@/engine/crypto/markets';
import { defaultParams, indicatorById, type IndicatorLine, type IndicatorOutput } from '@/engine/indicators';

/** Un instant UTC en secondes, l’unité de `CryptoBar.time` : `at('2026-10-09T10:00:00')`. */
const at = (iso: string): number => Date.parse(`${iso}Z`) / 1000;
/** Le jour `d` d’octobre 2026 à l’heure `hms`, en secondes UTC. En octobre 2026, 18:00 ET est 22:00 UTC. */
const utc = (d: number, hms: string): number => at(`2026-10-${String(d).padStart(2, '0')}T${hms}`);

function bar(time: number, open: number, high: number, low: number, close: number, volume: number, buyVolume?: number): CryptoBar {
  return buyVolume === undefined ? { time, open, high, low, close, volume } : { time, open, high, low, close, volume, buyVolume };
}

/** Une bougie plate : son prix typique est exactement `price`. */
const flat = (time: number, price: number, volume: number): CryptoBar => bar(time, price, price, price, price, volume);

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index < 0 ? list.length + index : index];
  if (item === undefined) throw new Error(`aucun élément à l’index ${index}`);
  return item;
}

/** Calcule un indicateur du catalogue crypto comme le fait le chart : paramètres par défaut, puis ceux de l’appelant. */
function run(id: string, bars: readonly CryptoBar[], params: Record<string, number | string> = {}): IndicatorOutput {
  const def = cryptoIndicatorById(id);
  if (!def) throw new Error(`indicateur absent du catalogue : ${id}`);
  return def.compute([...bars], { ...defaultParams(def), ...params });
}

function line(out: IndicatorOutput, key: string): IndicatorLine {
  const found = out.lines.find((l) => l.key === key);
  if (!found) throw new Error(`ligne absente : ${key}`);
  return found;
}

const valueAt = (out: IndicatorOutput, key: string, time: number): number | undefined => line(out, key).data.find((p) => p.time === time)?.value;

/** Les points qui portent une valeur : ce que le chart dessine. */
const valued = (l: IndicatorLine): { time: number; value: number }[] =>
  l.data.flatMap((p) => (p.value === undefined ? [] : [{ time: p.time, value: p.value }]));

/** Les segments que le chart dessine : une série par suite de points contigus, coupée à chaque blanc (`splitSegments`, `Chart.tsx`). */
function segments(l: IndicatorLine): { time: number; value: number }[][] {
  const out: { time: number; value: number }[][] = [];
  let current: { time: number; value: number }[] = [];
  for (const p of l.data) {
    if (p.value === undefined) {
      if (current.length) out.push(current);
      current = [];
    } else current.push({ time: p.time, value: p.value });
  }
  if (current.length) out.push(current);
  return out;
}

/** Le style d’une ligne : tout sauf ses données. */
const style = (l: IndicatorLine) => ({ key: l.key, label: l.label, color: l.color, lineWidth: l.lineWidth, lineStyle: l.lineStyle, pane: l.pane });

/** Le prix typique d’une bougie. */
const typicalOf = (b: CryptoBar): number => (b.high + b.low + b.close) / 3;

/** VWAP et écart-type pondéré par le volume, en deux passes : la définition, sans recette incrémentale. */
function reference(bars: readonly CryptoBar[]): { mean: number; sd: number } {
  const volume = bars.reduce((sum, b) => sum + b.volume, 0);
  const mean = bars.reduce((sum, b) => sum + typicalOf(b) * b.volume, 0) / volume;
  const variance = bars.reduce((sum, b) => sum + b.volume * (typicalOf(b) - mean) ** 2, 0) / volume;
  return { mean, sd: Math.sqrt(variance) };
}

/** 72 bougies d’une heure, du 8 au 10 octobre 2026 (UTC), toutes avec un volume acheteur. */
function threeDays(): CryptoBar[] {
  const out: CryptoBar[] = [];
  for (let i = 0; i < 72; i++) {
    const close = 100 + 8 * Math.sin(i / 5) + i * 0.1;
    const open = 100 + 8 * Math.sin((i - 1) / 5) + (i - 1) * 0.1;
    const volume = 10 + (i % 9);
    out.push(bar(utc(8, '00:00:00') + i * 3600, open, Math.max(open, close) + 1, Math.min(open, close) - 1, close, volume, volume * (0.3 + 0.05 * (i % 5))));
  }
  return out;
}

describe('catalogue d’indicateurs crypto', () => {
  it('liste les huit indicateurs, dans l’ordre du plan', () => {
    expect(CRYPTO_INDICATORS.map((def) => def.id)).toEqual(['ema', 'sma', 'volume-ma', 'atr', 'vwap-utc', 'levels-utc', 'cvd', 'cvd-binance']);
  });

  it('reprend tels quels les indicateurs du desk qui ne dépendent d’aucune séance', () => {
    for (const id of ['ema', 'sma', 'volume-ma', 'atr']) {
      const desk = indicatorById(id);
      expect(desk, id).toBeDefined();
      expect(cryptoIndicatorById(id), id).toBe(desk);
    }
  });

  it('n’a ni le VWAP, ni l’opening range, ni les niveaux de la séance Globex', () => {
    for (const id of ['vwap', 'opening-range', 'prev-session']) {
      expect(CRYPTO_INDICATORS.map((def) => def.id), id).not.toContain(id);
      expect(cryptoIndicatorById(id), id).toBeUndefined();
    }
  });

  it('retrouve chaque indicateur par son identifiant, et rien d’autre', () => {
    for (const def of CRYPTO_INDICATORS) expect(cryptoIndicatorById(def.id), def.id).toBe(def);
    for (const id of ['', 'nope', 'cvd ', 'CVD', 'constructor', '__proto__']) expect(cryptoIndicatorById(id), id).toBeUndefined();
  });

  it('décrit chaque indicateur : nom, abréviation, description, famille et paramètres', () => {
    expect(new Set(CRYPTO_INDICATORS.map((def) => def.id)).size).toBe(CRYPTO_INDICATORS.length);
    for (const def of CRYPTO_INDICATORS) {
      expect(def.name.trim().length, def.id).toBeGreaterThan(0);
      expect(def.short.trim().length, def.id).toBeGreaterThan(0);
      expect(def.description.trim().length, def.id).toBeGreaterThan(0);
      expect(['tendance', 'volume', 'volatilité', 'niveaux'], def.id).toContain(def.family);
      for (const p of def.params) {
        if (p.type === 'select') expect(p.options?.map((o) => o.value), `${def.id}.${p.key}`).toContain(String(p.default));
      }
    }
  });

  it('calcule chaque indicateur avec ses paramètres par défaut : des lignes nommées, des valeurs finies, des temps croissants', () => {
    const bars = threeDays();
    for (const def of CRYPTO_INDICATORS) {
      const out = run(def.id, bars);
      expect(out.id, def.id).toBe(def.id);
      expect(out.lines.length, def.id).toBeGreaterThan(0);
      // Le chart préfixe chaque clé de `${instance}:` et groupe les panneaux sur ce qui précède le premier « : ».
      const keys = out.lines.map((l) => l.key);
      expect(new Set(keys).size, def.id).toBe(keys.length);
      for (const l of out.lines) {
        const label = `${def.id}.${l.key}`;
        expect(l.key, label).not.toContain(':');
        expect(l.label.length, label).toBeGreaterThan(0);
        expect(['price', 'pane'], label).toContain(l.pane);
        expect(l.data.some((p) => p.value !== undefined), label).toBe(true);
        expect(l.data.every((p) => p.value === undefined || Number.isFinite(p.value)), label).toBe(true);
        for (let i = 1; i < l.data.length; i++) expect(nth(l.data, i).time, `${label} · point ${i}`).toBeGreaterThan(nth(l.data, i - 1).time);
      }
    }
  });

  it('accepte une série vide', () => {
    for (const def of CRYPTO_INDICATORS) {
      const out = run(def.id, []);
      expect(out.id, def.id).toBe(def.id);
      for (const l of out.lines) expect(l.data, `${def.id}.${l.key}`).toEqual([]);
    }
  });

  it('ne modifie pas les bougies qu’il reçoit', () => {
    // Gelées : une écriture dans le tableau ou dans une bougie lèverait une erreur.
    const frozen = Object.freeze(threeDays().map((b) => Object.freeze(b)));
    const before = structuredClone(frozen);
    for (const def of CRYPTO_INDICATORS) {
      expect(() => def.compute(frozen as CryptoBar[], defaultParams(def)), def.id).not.toThrow();
    }
    expect(frozen).toStrictEqual(before);
  });
});

describe('VWAP 00:00 UTC', () => {
  it('vaut le prix typique (h + l + c) / 3 à la première bougie après minuit UTC, bandes comprises', () => {
    // La veille finit sur un gros volume, loin du prix du jour : la première bougie du 9 en repart de zéro.
    const bars = [bar(utc(8, '23:00:00'), 500, 520, 480, 510, 1_000_000), bar(utc(9, '00:00:00'), 100, 110, 90, 107, 3.5), bar(utc(9, '01:00:00'), 107, 112, 104, 108, 2)];
    const out = run('vwap-utc', bars);
    const typical = (110 + 90 + 107) / 3;
    expect(typical).not.toBe(Math.round(typical));
    for (const key of ['vwap', 'up1', 'dn1', 'up2', 'dn2']) expect(valueAt(out, key, utc(9, '00:00:00')), key).toBe(typical);
    // La bougie suivante : moyenne des deux prix typiques, pondérée par leurs volumes.
    expect(valueAt(out, 'vwap', utc(9, '01:00:00'))).toBeCloseTo((typical * 3.5 + 108 * 2) / 5.5, 10);
  });

  it('pondère par le volume réel, y compris sous 1', () => {
    // Des volumes de BTC ou d’ONDO sont fractionnaires : (100 × 0,5 + 110 × 1,5) / 2 = 107,5, pas 106.
    const bars = [flat(utc(9, '00:00:00'), 100, 0.5), flat(utc(9, '01:00:00'), 110, 1.5)];
    expect(valueAt(run('vwap-utc', bars), 'vwap', utc(9, '01:00:00'))).toBeCloseTo(107.5, 10);
  });

  it('repart de zéro à 00:00 UTC, et non à 18:00 ET (22:00 UTC)', () => {
    const bars = [
      flat(utc(9, '21:00:00'), 100, 1),
      flat(utc(9, '22:00:00'), 110, 3),
      flat(utc(9, '23:00:00'), 120, 1),
      flat(utc(10, '00:00:00'), 200, 50),
      flat(utc(10, '01:00:00'), 210, 50),
    ];
    const values = valued(line(run('vwap-utc', bars), 'vwap')).map((p) => p.value);
    expect(values).toHaveLength(5);
    [100, 107.5, 110, 200, 205].forEach((expected, i) => expect(nth(values, i), `bougie ${i}`).toBeCloseTo(expected, 10));
  });

  it('égale le VWAP de séance du desk quand les deux ancres coïncident', () => {
    // De 00:00 à 21:00 UTC le 9 octobre 2026, c’est une seule séance Globex et un seul jour UTC. Volumes entiers ≥ 1 :
    // le VWAP du desk compte au moins 1 par bougie, ce qui ne change rien ici.
    const bars: CryptoBar[] = [];
    for (let i = 0; i < 22; i++) {
      const close = 100 + 5 * Math.sin(i / 2) + i * 0.3;
      const open = 100 + 5 * Math.sin((i - 1) / 2) + (i - 1) * 0.3;
      bars.push(bar(utc(9, '00:00:00') + i * 3600, open, Math.max(open, close) + 1 + (i % 3), Math.min(open, close) - 1 - (i % 2), close, 5 + (i % 7) * 3));
    }
    const desk = indicatorById('vwap')?.compute([...bars], { bands: '2' });
    expect(desk).toBeDefined();
    const mine = run('vwap-utc', bars, { bands: '2' });
    expect(mine.lines.map((l) => l.key)).toEqual(desk?.lines.map((l) => l.key));
    for (const l of desk?.lines ?? []) {
      const own = line(mine, l.key);
      expect(own.data.map((p) => p.time), l.key).toEqual(l.data.map((p) => p.time));
      // Le desk tire σ de E[x²] − E[x]², qui perd une dizaine de chiffres sur les premières bougies du jour (un σ de
      // l’ordre de 1e-6 là où il vaut 0) : les bandes se comparent à 1e-4 près, le VWAP lui-même à 1e-9 près.
      const digits = l.key === 'vwap' ? 9 : 4;
      own.data.forEach((p, i) => expect(p.value, `${l.key} · point ${i}`).toBeCloseTo(nth(l.data, i).value ?? Number.NaN, digits));
    }
  });

  it('trace les bandes à ±1σ et ±2σ autour du VWAP, écart-type pondéré par le volume', () => {
    // Deux bougies de même volume à 100 et 110 : VWAP 105, écart-type 5.
    const pair = run('vwap-utc', [flat(utc(9, '00:00:00'), 100, 1), flat(utc(9, '01:00:00'), 110, 1)], { bands: '2' });
    const t1 = utc(9, '01:00:00');
    [
      ['vwap', 105],
      ['up1', 110],
      ['dn1', 100],
      ['up2', 115],
      ['dn2', 95],
    ].forEach(([key, expected]) => expect(valueAt(pair, String(key), t1), String(key)).toBeCloseTo(Number(expected), 10));

    // Neuf bougies sur deux jours, volumes inégaux et fractionnaires : chaque point égale la définition en deux passes.
    const bars = [
      bar(utc(9, '00:00:00'), 100, 104, 98, 102, 0.4),
      bar(utc(9, '04:00:00'), 102, 109, 101, 108, 12.5),
      bar(utc(9, '08:00:00'), 108, 111, 99, 100, 3),
      bar(utc(9, '12:00:00'), 100, 103, 95, 96, 0.05),
      bar(utc(9, '23:00:00'), 96, 99, 90, 97, 40),
      bar(utc(10, '00:00:00'), 97, 150, 80, 140, 2),
      bar(utc(10, '03:00:00'), 140, 141, 120, 125, 7.25),
      bar(utc(10, '14:00:00'), 125, 130, 118, 119, 1),
      bar(utc(10, '22:30:00'), 119, 121, 117, 120, 9),
    ];
    const out = run('vwap-utc', bars, { bands: '2' });
    bars.forEach((b, i) => {
      const day = bars.filter((c, j) => j <= i && Math.floor(c.time / 86_400) === Math.floor(b.time / 86_400));
      const { mean, sd } = reference(day);
      const label = `bougie ${i}`;
      expect(valueAt(out, 'vwap', b.time), label).toBeCloseTo(mean, 9);
      expect(valueAt(out, 'up1', b.time), label).toBeCloseTo(mean + sd, 9);
      expect(valueAt(out, 'dn1', b.time), label).toBeCloseTo(mean - sd, 9);
      expect(valueAt(out, 'up2', b.time), label).toBeCloseTo(mean + 2 * sd, 9);
      expect(valueAt(out, 'dn2', b.time), label).toBeCloseTo(mean - 2 * sd, 9);
    });
  });

  it('suit le paramètre bands : aucune, ±1σ, ou ±1σ et ±2σ', () => {
    const bars = threeDays();
    expect(run('vwap-utc', bars, { bands: '0' }).lines.map((l) => l.key)).toEqual(['vwap']);
    expect(run('vwap-utc', bars, { bands: '1' }).lines.map((l) => l.key)).toEqual(['vwap', 'up1', 'dn1']);
    expect(run('vwap-utc', bars, { bands: '2' }).lines.map((l) => l.key)).toEqual(['vwap', 'up1', 'dn1', 'up2', 'dn2']);
    expect(run('vwap-utc', bars).lines).toHaveLength(5);
  });

  it('reprend le paramètre et le style de lignes du VWAP de séance', () => {
    const desk = indicatorById('vwap');
    expect(desk).toBeDefined();
    expect(cryptoIndicatorById('vwap-utc')?.params).toEqual(desk?.params);
    expect(cryptoIndicatorById('vwap-utc')?.params).toEqual([
      { key: 'bands', label: 'Bandes', type: 'select', default: '2', options: [{ value: '0', label: 'Aucune' }, { value: '1', label: '±1σ' }, { value: '2', label: '±1σ et ±2σ' }] },
    ]);
    const bars = threeDays();
    expect(run('vwap-utc', bars, { bands: '2' }).lines.map(style)).toEqual(desk?.compute([...bars], { bands: '2' }).lines.map(style));
  });

  it('ne laisse peser ni une bougie sans volume, ni une bougie sans prix ou sans volume fini', () => {
    const bars = [
      flat(utc(9, '00:00:00'), 100, 0), // aucun volume encore : pas de VWAP
      flat(utc(9, '01:00:00'), 104, 2), // la première bougie qui pèse : son prix
      flat(utc(9, '02:00:00'), 120, 0), // sans volume : le VWAP ne bouge pas
      bar(utc(9, '03:00:00'), 1, Number.NaN, 1, 1, 5), // prix NaN
      flat(utc(9, '04:00:00'), 108, Number.NaN), // volume NaN
      flat(utc(9, '05:00:00'), 108, Number.POSITIVE_INFINITY), // volume infini
      flat(utc(9, '06:00:00'), 110, 2),
    ];
    const out = run('vwap-utc', bars, { bands: '2' });
    expect(line(out, 'vwap').data).toStrictEqual([
      { time: utc(9, '01:00:00'), value: 104 },
      { time: utc(9, '02:00:00'), value: 104 },
      { time: utc(9, '03:00:00'), value: 104 },
      { time: utc(9, '04:00:00'), value: 104 },
      { time: utc(9, '05:00:00'), value: 104 },
      { time: utc(9, '06:00:00'), value: 107 },
    ]);
    for (const l of out.lines) expect(l.data.every((p) => p.value === undefined || Number.isFinite(p.value)), l.key).toBe(true);
  });

  it('garde des bandes finies quand une bougie écrase la précédente par son volume', () => {
    // 0,3 puis 0,9 avec un poids un milliard de milliards de fois plus grand : la moyenne mise à jour dépasse 0,9 d’un
    // ulp, et la somme des carrés des écarts passe sous zéro (−7e-17). Sans plancher à 0, σ vaudrait NaN.
    const bars = [flat(utc(9, '00:00:00'), 0.3, 1e-30), flat(utc(9, '01:00:00'), 0.9, 1)];
    const out = run('vwap-utc', bars, { bands: '2' });
    for (const key of ['vwap', 'up1', 'dn1', 'up2', 'dn2']) expect(valueAt(out, key, utc(9, '01:00:00')), key).toBeCloseTo(0.9, 10);
  });
});

describe('niveaux du jour UTC précédent', () => {
  // Le 8 : plus haut 120 (12:00), plus bas 90 (22:30, après la bascule de 18:00 ET), clôture 92 (23:30).
  // Le 9 : plus haut 130, plus bas 60, clôture 66. Le 10 : deux bougies.
  const bars = [
    bar(utc(8, '00:00:00'), 100, 110, 95, 105, 10),
    bar(utc(8, '12:00:00'), 105, 120, 100, 115, 20),
    bar(utc(8, '22:30:00'), 115, 118, 90, 100, 5),
    bar(utc(8, '23:30:00'), 100, 101, 91, 92, 4),
    bar(utc(9, '00:00:00'), 92, 130, 91, 125, 8),
    bar(utc(9, '12:00:00'), 125, 126, 60, 70, 9),
    bar(utc(9, '23:00:00'), 70, 72, 65, 66, 4),
    bar(utc(10, '00:00:00'), 66, 70, 64, 68, 3),
    bar(utc(10, '06:00:00'), 68, 69, 67, 67.5, 2),
  ];
  const day9 = [utc(9, '00:00:00'), utc(9, '12:00:00'), utc(9, '23:00:00')];
  const day10 = [utc(10, '00:00:00'), utc(10, '06:00:00')];

  it('donne au jour 2 le plus haut, le plus bas et la clôture du jour 1', () => {
    const out = run('levels-utc', bars.slice(0, 7));
    expect(out.lines.map((l) => l.key)).toEqual(['pdh', 'pdl', 'pdc']);
    expect(line(out, 'pdh').data).toStrictEqual(day9.map((time) => ({ time, value: 120 })));
    expect(line(out, 'pdl').data).toStrictEqual(day9.map((time) => ({ time, value: 90 })));
    expect(line(out, 'pdc').data).toStrictEqual(day9.map((time) => ({ time, value: 92 })));
  });

  it('ne trace rien le premier jour de la série', () => {
    const out = run('levels-utc', bars);
    for (const l of out.lines) {
      expect(l.data.filter((p) => p.time < utc(9, '00:00:00')), l.key).toEqual([]);
    }
    // Un seul jour : aucune ligne, mais les trois sont là.
    const single = run('levels-utc', bars.slice(0, 4));
    expect(single.lines.map((l) => l.data)).toEqual([[], [], []]);
  });

  it('interrompt chaque ligne à chaque jour : un blanc entre deux jours, un segment par jour', () => {
    const out = run('levels-utc', bars);
    const expected: Record<string, [number, number]> = {
      pdh: [120, 130],
      pdl: [90, 60],
      pdc: [92, 66],
    };
    for (const [key, [first, second]] of Object.entries(expected)) {
      const l = line(out, key);
      expect(segments(l), key).toStrictEqual([day9.map((time) => ({ time, value: first })), day10.map((time) => ({ time, value: second }))]);
      // Un seul blanc, entre la dernière bougie du 9 et la première du 10, sur un instant qui n’est celui d’aucune bougie.
      const blanks = l.data.filter((p) => p.value === undefined);
      expect(blanks, key).toHaveLength(1);
      const blank = nth(blanks, 0);
      expect(blank, key).toStrictEqual({ time: blank.time });
      expect(blank.time, key).toBeGreaterThan(utc(9, '23:00:00'));
      expect(blank.time, key).toBeLessThan(utc(10, '00:00:00'));
      expect(l.data, key).toHaveLength(day9.length + 1 + day10.length);
    }
  });

  it('calcule le jour 3 sur le seul jour 2, sans cumul avec le jour 1', () => {
    const out = run('levels-utc', bars);
    // Le 1ᵉʳ jour monte à 120, le 2ᵉ à 130 : le 3ᵉ lit 130, pas un maximum sur les deux.
    expect(valueAt(out, 'pdh', utc(10, '06:00:00'))).toBe(130);
    // Le 1ᵉʳ jour descend à 90, le 2ᵉ à 60 : le 3ᵉ lit 60.
    expect(valueAt(out, 'pdl', utc(10, '06:00:00'))).toBe(60);
    // La clôture est celle de la dernière bougie du jour, pas la plus haute ni la plus basse.
    expect(valueAt(out, 'pdc', utc(10, '06:00:00'))).toBe(66);
  });

  it('coupe les jours à minuit UTC, et non à 18:00 ET (22:00 UTC)', () => {
    // 23:59 et 00:00 : deux jours. 21:59, 22:00 et 22:30 : le même jour (plus haut 150 avant 22:00 UTC, plus bas 50 à 22:00).
    const edge = [
      bar(utc(8, '21:59:00'), 100, 150, 100, 100, 1),
      bar(utc(8, '22:00:00'), 100, 100, 50, 100, 1),
      bar(utc(8, '22:30:00'), 100, 100, 70, 70, 1),
      bar(utc(8, '23:59:00'), 70, 80, 70, 80, 1),
      bar(utc(9, '00:00:00'), 80, 80, 80, 80, 1),
    ];
    const out = run('levels-utc', edge);
    expect(line(out, 'pdh').data).toStrictEqual([{ time: utc(9, '00:00:00'), value: 150 }]);
    expect(line(out, 'pdl').data).toStrictEqual([{ time: utc(9, '00:00:00'), value: 50 }]);
    expect(line(out, 'pdc').data).toStrictEqual([{ time: utc(9, '00:00:00'), value: 80 }]);
  });

  it('ne remplace pas un jour sans bougie par un jour plus ancien', () => {
    // Le 8, puis le 10 : le « jour précédent » du 10 est le 9, qui n’a pas de bougie.
    const gap = [flat(utc(8, '00:00:00'), 100, 1), flat(utc(8, '12:00:00'), 110, 1), flat(utc(10, '00:00:00'), 120, 1), flat(utc(10, '12:00:00'), 130, 1), flat(utc(11, '00:00:00'), 125, 1)];
    const out = run('levels-utc', gap);
    // Le 11 lit le 10 (plus haut 130, plus bas 120, clôture 130) ; le 10 ne lit rien.
    expect(line(out, 'pdh').data).toStrictEqual([{ time: utc(11, '00:00:00'), value: 130 }]);
    expect(line(out, 'pdl').data).toStrictEqual([{ time: utc(11, '00:00:00'), value: 120 }]);
    expect(line(out, 'pdc').data).toStrictEqual([{ time: utc(11, '00:00:00'), value: 130 }]);
  });

  it('reprend les clés, les étiquettes et le style des niveaux de séance du desk', () => {
    const desk = indicatorById('prev-session');
    expect(desk).toBeDefined();
    expect(cryptoIndicatorById('levels-utc')?.params).toEqual([]);
    expect(run('levels-utc', bars).lines.map(style)).toEqual(desk?.compute([...bars], {}).lines.map(style));
  });
});

describe('CVD', () => {
  // Le scénario de cvd.ts : 10:00 sans volume acheteur (blanc), 10:01 complète (+1), 10:02 complète (+5).
  const live = [bar(utc(9, '10:00:00'), 100, 100, 100, 100, 4), bar(utc(9, '10:01:00'), 101, 101, 99, 99, 3, 2), bar(utc(9, '10:02:00'), 100, 100, 100, 100, 5, 5)];

  it('cvd donne une ligne de panneau de clé cvd, avec les points de cvdPoints', () => {
    const out = run('cvd', live);
    expect(out.id).toBe('cvd');
    expect(out.lines).toHaveLength(1);
    const only = nth(out.lines, 0);
    expect(only.pane).toBe('pane');
    expect(only.key).toBe('cvd');
    expect(only.label).toBe('CVD');
    expect(only.data).toStrictEqual([{ time: utc(9, '10:00:00') }, { time: utc(9, '10:01:00'), value: 1 }, { time: utc(9, '10:02:00'), value: 6 }]);
    expect(only.data).toStrictEqual(cvdPoints(live));
  });

  it('cvd-binance donne la même ligne, étiquetée Binance', () => {
    const proxy = [bar(utc(9, '10:00:00'), 10, 11, 9, 10.5, 10, 7), bar(utc(9, '10:01:00'), 10.5, 11, 10, 10.2, 6, 1), bar(utc(9, '10:02:00'), 10.2, 12, 10, 11.5, 8, 5)];
    const out = run('cvd-binance', proxy);
    expect(out.id).toBe('cvd-binance');
    expect(out.lines).toHaveLength(1);
    const only = nth(out.lines, 0);
    expect(only.pane).toBe('pane');
    expect(only.key).toBe('cvd');
    expect(only.label).toBe('CVD Binance');
    expect(only.data).toStrictEqual([
      { time: utc(9, '10:00:00'), value: 4 },
      { time: utc(9, '10:01:00'), value: 0 },
      { time: utc(9, '10:02:00'), value: 2 },
    ]);
    expect(only.data).toStrictEqual(cvdPoints(proxy));
  });

  it('ne trace qu’un blanc par bougie quand aucune n’a de volume acheteur', () => {
    const bare = [flat(utc(9, '10:00:00'), 100, 4), flat(utc(9, '10:01:00'), 100, 4)];
    expect(nth(run('cvd', bare).lines, 0).data).toStrictEqual([{ time: utc(9, '10:00:00') }, { time: utc(9, '10:01:00') }]);
  });
});

describe('inputBarsFor', () => {
  const chart = [flat(utc(9, '10:00:00'), 100, 1)];
  const proxy = [flat(utc(9, '10:00:00'), 99, 2)];

  it('lit la série Binance pour cvd-binance', () => {
    expect(inputBarsFor('cvd-binance', chart, proxy)).toBe(proxy);
  });

  it('lit les bougies du marché affiché pour tous les autres indicateurs', () => {
    for (const def of CRYPTO_INDICATORS.filter((d) => d.id !== 'cvd-binance')) expect(inputBarsFor(def.id, chart, proxy), def.id).toBe(chart);
    expect(inputBarsFor('inconnu', chart, proxy)).toBe(chart);
  });

  it('ne se rabat pas sur le chart quand la série Binance est vide', () => {
    const none: CryptoBar[] = [];
    expect(inputBarsFor('cvd-binance', chart, none)).toBe(none);
  });
});

describe('indicateurs par défaut', () => {
  it('posent le CVD et le VWAP à ±1σ', () => {
    expect(DEFAULT_CRYPTO_INDICATORS).toStrictEqual([
      { id: 'i_cvd', definitionId: 'cvd', params: {}, visible: true },
      { id: 'i_vwap', definitionId: 'vwap-utc', params: { bands: '1' }, visible: true },
    ]);
  });

  it('visent des définitions du catalogue et des paramètres qu’elles déclarent', () => {
    for (const inst of DEFAULT_CRYPTO_INDICATORS) {
      const def = cryptoIndicatorById(inst.definitionId);
      expect(def, inst.id).toBeDefined();
      for (const [key, value] of Object.entries(inst.params)) {
        const param = def?.params.find((p) => p.key === key);
        expect(param, `${inst.id}.${key}`).toBeDefined();
        if (param?.type === 'select') expect(param.options?.map((o) => o.value), `${inst.id}.${key}`).toContain(String(value));
      }
    }
    // Le défaut du VWAP est ±1σ ; la définition, elle, propose ±1σ et ±2σ : l’écart est voulu.
    expect(cryptoIndicatorById('vwap-utc')?.params[0]?.default).toBe('2');
  });

  it('se calculent tels quels, avec les seuls paramètres de l’instance', () => {
    const bars = threeDays();
    const [cvd, vwap] = DEFAULT_CRYPTO_INDICATORS.map((inst) => cryptoIndicatorById(inst.definitionId)?.compute([...bars], inst.params));
    expect(cvd?.lines.map((l) => l.key)).toEqual(['cvd']);
    expect(vwap?.lines.map((l) => l.key)).toEqual(['vwap', 'up1', 'dn1']);
  });
});

describe('renderer seulement', () => {
  it('n’est pas émis pour le process principal et n’importe que le moteur', () => {
    const config = JSON.parse(readFileSync('electron/tsconfig.sources.json', 'utf8')) as { files: string[] };
    expect(config.files).not.toContain('../src/engine/crypto/indicators.ts');
    expect(existsSync('electron/crypto/indicators.d.ts')).toBe(false);
    const source = readFileSync('src/engine/crypto/indicators.ts', 'utf8');
    const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
    expect(specifiers).toContain('@/engine/indicators');
    expect(specifiers).toContain('./cvd');
    expect(specifiers.filter((s) => !/^(@\/engine\/|\.\/)/.test(s))).toEqual([]);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
