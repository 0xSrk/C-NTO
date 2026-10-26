/**
 * Micrographies du lanceur AUBE — génère electron/launcher-micro.js.
 *
 * Le lanceur est en HTML et JS simples (CSP `script-src 'self'`, aucun bundler) : il ne peut pas importer les
 * sources TypeScript du desk. Ce script les lit et les fige dans un fichier que le lanceur charge tel quel :
 *   - le sceau Horizon, master négatif (src/design/seal/seal-negative.svg), en quatre groupes ; les douze
 *     filaments portent leur rang (--i) pour l'onde de la frappe ;
 *   - les composants de la planche des 150 que le lanceur emploie, sous le nom que leur donne le desk
 *     (src/design/micro/assets.ts : masters Fox Rockett, Ligne V2 Rév. A, redistribution confirmée par l'ADMIN) ;
 *   - les plaques du sceau et de l'artefact, et la plaque de liaison réécrite en canal de publication — chaque
 *     ligne réécrite reste plus courte que celle du master ; chaque emplacement est porté par son tspan ;
 *   - la règle des emplacements du desk (un emplacement vide se lit « — ») et son Code 128 (src/lib/code128.ts).
 *
 * Usage : node scripts/launcher-micro.mjs   (tests/launcher-micro.test.ts vérifie que le fichier est à jour)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'electron', 'launcher-micro.js');

/** Composants employés par le lanceur, sous leur nom du desk (GLYPH_ID) — chacun dit une fonction. */
export const LAUNCHER_GLYPHS = Object.freeze([
  'signal1', // à jour, information : l'orbite
  'signal2', // mise à jour disponible, attention : le rayonnement
  'signal3', // échec, et lui seul en rouge : le cercle barré
  'now', // l'anneau de « maintenant » : l'horloge du contrôle de version
  'horizon', // les rayons de l'horizon : le lever de la LED
  'rule', // la règle : la jauge du téléchargement
  'arrowOpen', // ouvrir : lancer le desk
  'arrowImport', // importer : télécharger la mise à jour
]);

/** Longueur maximale de chaque valeur de la plaque de publication : la ligne ne dépasse jamais celle du master. */
export const RELEASE_LIMITS = Object.freeze({ next: 8, state: 7, channel: 6, latency: 7 });

/** Plaque de liaison du desk → canal de publication : [texte du desk, texte du lanceur]. */
const RELEASE_TEXTS = [
  ['{{venue}}', '{{next}}'],
  ['{{ws}}', '{{state}}'],
  ['MARKET FEED — {{feed}}', 'RELEASE — {{channel}}'],
  ['PUBLIC DATA | LATENCY: {{latency}}', 'CHECK | LATENCY: {{latency}}'],
];

function transpile(rel) {
  const source = readFileSync(path.join(ROOT, rel), 'utf8');
  return ts
    .transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, newLine: ts.NewLineKind.LineFeed } })
    .outputText.replace(/\r\n/g, '\n');
}

function loadTs(rel) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(rel), { module, exports: module.exports });
  return module.exports;
}

const SEAL_PARTS = ['rings', 'horizon', 'filaments', 'inscription'];

function seal() {
  const svg = readFileSync(path.join(ROOT, 'src', 'design', 'seal', 'seal-negative.svg'), 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const groups = SEAL_PARTS.map((part) => {
    const inner = new RegExp(`<g id="${part}"[^>]*>([\\s\\S]*?)</g>`).exec(svg)?.[1];
    if (inner === undefined) throw new Error(`sceau : groupe ${part} introuvable`);
    const paths = [...inner.matchAll(/<path ([^>]*?)\/?>/g)].map((m, i) => {
      const d = /\bd="([^"]*)"/.exec(m[1])?.[1];
      if (!d) throw new Error(`sceau : tracé vide dans ${part}`);
      const rule = /fill-rule="evenodd"/.test(m[1]) ? ' fill-rule="evenodd"' : '';
      return part === 'filaments' ? `<path style="--i:${i}" d="${d}"${rule}/>` : `<path d="${d}"${rule}/>`;
    });
    return `<g data-part="${part}">${paths.join('')}</g>`;
  });
  return {
    viewBox,
    // Fraction de la hauteur où passe l'horizon (y = −12,8 dans la boîte −370 → 370), comme src/design/Seal.tsx.
    horizon: (370 - 12.8) / 740,
    svg: `<svg class="lm-seal" viewBox="${viewBox}" fill="currentColor" aria-hidden="true" focusable="false">${groups.join('')}</svg>`,
  };
}

const slotsOf = (svg) => [...new Set([...svg.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
const carry = (svg) => svg.replace(/\{\{(\w+)\}\}/g, '<tspan class="lm-v">{{$1}}</tspan>');

function plates(PLATES) {
  let release = PLATES.link.svg.replace(/mglink/g, 'mgrelease').replace('mg mg-link', 'mg mg-release');
  for (const [from, to] of RELEASE_TEXTS) {
    if (!release.includes(`>${from}<`)) throw new Error(`plaque de liaison : « ${from} » introuvable`);
    release = release.replace(`>${from}<`, `>${to}<`);
  }
  const out = { seal: PLATES.seal.svg, artefact: PLATES.artefact.svg, release };
  return Object.fromEntries(Object.entries(out).map(([id, svg]) => [id, { svg: carry(svg), slots: slotsOf(svg) }]));
}

/** Texte complet de electron/launcher-micro.js. */
export function generateLauncherMicro() {
  const { COMPONENTS, GLYPH_ID, PLATES } = loadTs('src/design/micro/assets.ts');
  const glyphs = Object.fromEntries(
    LAUNCHER_GLYPHS.map((name) => {
      const svg = COMPONENTS[GLYPH_ID[name]];
      if (!svg) throw new Error(`composant ${name} absent de la planche du desk`);
      return [name, svg];
    }),
  );
  const code128 = transpile('src/lib/code128.ts').trim().replace(/\n/g, '\n    ');
  return `/* Generated by scripts/launcher-micro.mjs — do not edit by hand.
   Micrographies du lanceur AUBE (Système 4.0 « ΟΡΟΣ ») : le sceau Horizon (src/design/seal/seal-negative.svg),
   les composants et les plaques du Lab (src/design/micro/assets.ts — masters Fox Rockett, Ligne V2 Rév. A,
   redistribution confirmée par l'ADMIN), la plaque de liaison réécrite en canal de publication, la règle des
   emplacements et le Code 128 du desk (src/lib/code128.ts). Encre --k, papier --p ; aucun code 2D. */
(function () {
  'use strict';

  var code128 = (function () {
    var exports = {};
    ${code128}
    return exports;
  })();

  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Remplit les emplacements d'une plaque. Sans valeur, un emplacement se lit « — » : une plaque n'invente rien. */
  function bindSlots(svg, values) {
    return svg.replace(/\\{\\{(\\w+)\\}\\}/g, function (_, key) {
      var v = values ? values[key] : undefined;
      return v === null || v === undefined || v === '' ? '—' : esc(v);
    });
  }

  window.cantoMicro = Object.freeze({
    SEAL: ${JSON.stringify(seal())},
    GLYPHS: ${JSON.stringify(glyphs)},
    PLATES: ${JSON.stringify(plates(PLATES))},
    bindSlots: bindSlots,
    code128Widths: code128.code128Widths,
    code128Path: code128.code128Path,
  });
})();
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = generateLauncherMicro();
  writeFileSync(OUT, text);
  console.log(`launcher-micro → ${path.relative(ROOT, OUT)} (${Math.round(text.length / 1024)} Ko)`);
}
