/**
 * Marque CΛNTO V2 — le Λ en construction, LED carrée d'or à la pointe.
 *
 * Géométrie de la marque 3.2.2 (docs/design/3.2.2/marque/marque.py), inchangée : grille 256 au pas de 8,
 * pieds du Λ sur la ligne de pied (y 184), pointe au-dessus de la capitale (y 68, débord optique de 4 u).
 * Tailles optiques : trait, guides, ancres et LED calibrés en pixels au rendu ; à 32 px et moins, le Λ et
 * la LED restent seuls. Ce qui change avec le Système 4.0 : la matière. La LED passe à l'or (--gold),
 * l'encre à l'ivoire (--text-0), le fond à la nuit du Lab (--bg-2 → --bg-1 → --bg-0).
 *
 * Usage :
 *   node scripts/marque.mjs                 écrit build/logo.svg (taille optique 72, l'encart du lanceur)
 *   node scripts/marque.mjs --svg <dossier> écrit marque-<px>.svg pour chaque taille livrée
 *   node scripts/marque.mjs --icons <dossier>
 *     lit <dossier>/marque-<px>.png (chaque SVG rastérisé par Chromium à sa taille, sans mise à l'échelle)
 *     et écrit build/icon.png (1024) et build/icon.ico (16, 24, 32, 48, 64, 128, 256 ; entrées PNG).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Couleurs du Système 4.0 (src/design/tokens.css) : tests/marque.test.ts vérifie qu'elles ne dérivent pas. */
export const MARQUE_COLORS = Object.freeze({
  led: '#CCB066', // --gold : la LED, ce qui vit
  ink: '#F5F2EA', // --text-0 : l'ivoire
  night: '#07080C', // --bg-0 : la nuit
  plate: '#14151A', // --bg-2
  ground: '#0D0E12', // --bg-1
});

export const MARQUE_SIZES = Object.freeze([16, 24, 32, 48, 64, 72, 128, 256, 1024]);

/** Tailles de l'icône Windows, chacune depuis sa propre taille optique. */
export const ICO_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);

const f2 = (n) => n.toFixed(2);
const f3 = (n) => n.toFixed(3);

/** SVG de la marque à la taille optique `px`. */
export function marque(px) {
  const { led: LED, ink: INK, night, plate, ground } = MARQUE_COLORS;
  const u = 256 / px; // unités par pixel au rendu
  const complete = px >= 48; // construction visible à partir de 48 px
  let trait = Math.max(1.25, px / 80) * u; // 1,25 px jusqu'à 100 px, 12,8 px à 1024
  if (!complete) trait = (px <= 16 ? 1.6 : 2.0) * u; // petites tailles : le Λ doit tenir seul
  const fin = Math.max(0.6, px / 480) * u;
  const [piedG, pointe, piedD] = [
    [72, 184],
    [128, 68],
    [184, 184],
  ];
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${px}" height="${px}">`];
  out.push(`<defs>
<radialGradient id="fond" cx="50%" cy="46%" r="70%"><stop offset="0" stop-color="${plate}"/><stop offset=".55" stop-color="${ground}"/><stop offset="1" stop-color="${night}"/></radialGradient>
<filter id="halo" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${f3(3.2 * u)}"/></filter>
<radialGradient id="ledHalo"><stop offset="0" stop-color="${LED}" stop-opacity=".75"/><stop offset=".35" stop-color="${LED}" stop-opacity=".28"/><stop offset="1" stop-color="${LED}" stop-opacity="0"/></radialGradient>
</defs>`);
  out.push('<rect width="256" height="256" fill="url(#fond)"/>');
  if (complete) {
    // Guides : capitale et pied, axe médian plus discret, axe vertical ; cote au-dessus.
    for (const [y, o] of [
      [72, '0.16'],
      [184, '0.16'],
      [128, '0.08'],
    ]) {
      out.push(`<line x1="0" x2="256" y1="${y}" y2="${y}" stroke="${INK}" stroke-opacity="${o}" stroke-width="${f3(fin)}"/>`);
    }
    out.push(`<line x1="128" x2="128" y1="24" y2="232" stroke="${INK}" stroke-opacity=".07" stroke-width="${f3(fin)}"/>`);
    out.push(`<path d="M72 44 H184 M72 38 V50 M184 38 V50" stroke="${INK}" stroke-opacity=".28" stroke-width="${f3(fin)}" fill="none"/>`);
  }
  const d = `M${piedG[0]} ${piedG[1]} L${pointe[0]} ${pointe[1]} L${piedD[0]} ${piedD[1]}`;
  out.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="${f3(trait * 3)}" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="4" opacity=".2" filter="url(#halo)"/>`);
  out.push(`<path d="${d}" fill="none" stroke="${INK}" stroke-width="${f3(trait)}" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="4"/>`);
  if (complete) {
    const cote = Math.max(5, px / 24) * u;
    for (const [x, y] of [piedG, piedD]) {
      out.push(`<rect x="${f2(x - cote / 2)}" y="${f2(y - cote / 2)}" width="${f2(cote)}" height="${f2(cote)}" fill="${night}" stroke="${INK}" stroke-opacity=".8" stroke-width="${f3(fin)}"/>`);
    }
  }
  // La pointe porte la LED : carré plein, halo d'or.
  const led = (complete ? Math.max(4, px / 26) : Math.max(3, px / 8)) * u;
  const [x, y] = pointe;
  out.push(`<circle cx="${x}" cy="${y}" r="${f2(led * 2.6)}" fill="url(#ledHalo)"/>`);
  out.push(`<rect x="${f2(x - led / 2)}" y="${f2(y - led / 2)}" width="${f2(led)}" height="${f2(led)}" fill="${LED}"/>`);
  out.push('</svg>');
  return out.join('\n') + '\n';
}

/** Fichier ICO à entrées PNG (Windows Vista et suivants), dans l'ordre des tailles. */
export function packIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    header[o] = size >= 256 ? 0 : size;
    header[o + 1] = size >= 256 ? 0 : size;
    header[o + 2] = 0;
    header[o + 3] = 0;
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.png)]);
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const svgDir = flag('--svg');
  const iconDir = flag('--icons');
  if (svgDir) {
    mkdirSync(svgDir, { recursive: true });
    for (const px of MARQUE_SIZES) writeFileSync(path.join(svgDir, `marque-${px}.svg`), marque(px));
    console.log(`marque → ${svgDir} (${MARQUE_SIZES.join(', ')})`);
    return;
  }
  if (iconDir) {
    const read = (px) => readFileSync(path.join(iconDir, `marque-${px}.png`));
    writeFileSync(path.join(root, 'build', 'icon.png'), read(1024));
    writeFileSync(path.join(root, 'build', 'icon.ico'), packIco(ICO_SIZES.map((size) => ({ size, png: read(size) }))));
    console.log('marque → build/icon.png, build/icon.ico');
    return;
  }
  writeFileSync(path.join(root, 'build', 'logo.svg'), marque(72));
  console.log('marque → build/logo.svg');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
