import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, code128Path, code128Values, code128Widths } from '@/lib/code128';

/** Largeurs de modules relevées sur bwip-js (code128) pour chaque texte : barre, espace, barre… jusqu'à l'arrêt. */
const BWIP: [string, string][] = [
  ['SK-ART-002', '2112142131131123311221321113232311312133111221321231221231222232112412112331112'],
  ['SK-ART-002-3.6.0', '2112142131131123311221321113232311312133111221321231221231222232111221322211321222312231121222311231221112242331112'],
  ['CANTO', '2112141313211113231133212133111331211211242331112'],
  ['Hello, world!', '2112142311131122142211142211141341111122322122224211121341111212412211141412212221223121312331112'],
  [' !"#$%&\'()*+,-./', '2112142122222221222222211212231213221312221222131223121322122212132213122312121122321221321222311132222231122331112'],
  [':;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ', '2112143212213122123221123222112121232123212321211113231311231313211123131321131323112113132311132313111121331123311321311131231133211331213131212113312311312131132133112131313111233113213311213121133123111241122331112'],
  ['[]^_`abcdefghijklmnopqrstuvwxyz{|}~', '2112143321112214114311111112241114221211241214211411221412211122141124121221141224111421121422112412112211144131112411121341111112421211421212411142121241121242114112124211124212112121412141214121211111431113411311411211242331112'],
  ['0123456789', '2112322221223121311131231411222121411421122331112'],
  ['9596979899', '2112321141131143114111134113111131413211222331112'],
  ['00010203', '2112322122222221222222211212232231122331112'],
  ['A1B2C3', '2112141113231232211311232232111313212211321231222331112'],
  ['SK-SIG-3', '2112142131131123311221322131132313112113131221322211321113232331112'],
  ['v3.6.0', '2112144112122211321222312231121222311231222212132331112'],
  ['ART002', '2112141113232311312133111231221231222232113122122331112'],
  ['SK-DOC-RCN-0007', '2112142131131123311221321123131331211313211221322311311313211133211221321131412122221223124311112331112'],
  ['20261026', '2112322212313212212213123212212222212331112'],
];

/** Relecture indépendante : largeurs → valeurs → texte, contrôle de la somme compris. */
function decode(widths: number[]): string {
  const index = new Map(CODE128_PATTERNS.map((pattern, value) => [pattern, value]));
  const values: number[] = [];
  for (let i = 0; i < widths.length; ) {
    const n = widths.length - i === 7 ? 7 : 6;
    const value = index.get(widths.slice(i, i + n).join(''));
    if (value === undefined) throw new Error(`motif inconnu à ${i}`);
    values.push(value);
    i += n;
  }
  let sum = values[0]!;
  for (let k = 1; k < values.length - 2; k++) sum += values[k]! * k;
  if (sum % 103 !== values[values.length - 2]) throw new Error('somme de contrôle');
  let set: 'B' | 'C' = values[0] === 105 ? 'C' : 'B';
  let out = '';
  for (const value of values.slice(1, -2)) {
    if (set === 'C') {
      if (value === 100) set = 'B';
      else out += String(value).padStart(2, '0');
    } else if (value === 99) set = 'C';
    else out += String.fromCharCode(value + 32);
  }
  return out;
}

describe('Code 128 du desk', () => {
  it('rend les largeurs de bwip-js sur seize textes', () => {
    for (const [text, expected] of BWIP) expect(code128Widths(text).join(''), text).toBe(expected);
  });

  it('se relit : chaque code décodé redonne son texte', () => {
    for (const [text] of BWIP) expect(decode(code128Widths(text)), text).toBe(text);
  });

  it('garde une table saine : 107 motifs uniques, 11 modules chacun, 13 pour l’arrêt', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((pattern, value) => {
      expect([...pattern].reduce((a, b) => a + Number(b), 0), String(value)).toBe(value === 106 ? 13 : 11);
    });
  });

  it('refuse un caractère hors de l’ASCII imprimable plutôt que de coder faux', () => {
    expect(() => code128Values('CΛNTO')).toThrow();
  });

  it('trace autant de modules que le code en compte : 211 pour SK-ART-002-3.6.0', () => {
    const { d, modules } = code128Path('SK-ART-002-3.6.0', 12);
    expect(modules).toBe(211);
    expect(d.match(/M/g)).toHaveLength(code128Widths('SK-ART-002-3.6.0').filter((_, i) => i % 2 === 0).length);
  });
});
