/**
 * Composants de la planche des 150 dessinés au dépôt (Système 5 « Fiche et Frise », décision 5 de l'ADMIN, 2026-11-01).
 * `assets.ts` est généré hors du dépôt et ne s'édite pas à la main : les composants que le desk emploie sans master au
 * dépôt sont dessinés ici, une seule fois, fusionnés dans `GLYPH_ID` et rendus par `Glyph` (`src/design/Micro.tsx`).
 * L'ADMIN pourra régénérer `assets.ts` avec ces numéros et retirer ce module.
 *
 * Dessin d'après les masters de la Ligne V2 (C.024, C.070) ou la vignette du pack, recomposé à la taille d'usage : la
 * viewBox est en pixels (une unité, un pixel), traits d'un pixel environ, lisibles à 14–16 px. Encre `var(--k)`, papier
 * `var(--p)`, aucune couleur écrite ; chaque svg s'ouvre comme un master (`class="skg skg-N"`, `fill="var(--k)"`).
 */

/** Une coordonnée à deux décimales au plus. */
const f = (v: number) => String(Math.round(v * 100) / 100);
const svg = (n: number, w: number, h: number, body: string) => `<svg class="skg skg-${n}" viewBox="0 0 ${w} ${h}" fill="var(--k)" aria-hidden="true">${body}</svg>`;
const ink = (width: number) => `fill="none" stroke="var(--k)" stroke-width="${f(width)}"`;

/** Étoile à quatre branches aux flancs concaves (C.024, C.135), centrée, de demi-envergure `r` ; `w` règle le pincement. */
function star(cx: number, cy: number, r: number, w: number, turn = 0): string {
  const at = (dx: number, dy: number) => {
    const a = (turn * Math.PI) / 180;
    return `${f(cx + dx * Math.cos(a) - dy * Math.sin(a))} ${f(cy + dx * Math.sin(a) + dy * Math.cos(a))}`;
  };
  return `<path d="M${at(0, -r)}Q${at(w, -w)} ${at(r, 0)}Q${at(w, w)} ${at(0, r)}Q${at(-w, w)} ${at(-r, 0)}Q${at(-w, -w)} ${at(0, -r)}Z"/>`;
}

/**
 * C.094 — la séance : capsules évidées, hautes aux bouts, qui se réduisent jusqu'au petit cercle du centre (le U d'une
 * séance RTH). Trois capsules de chaque côté (la vignette en a quatre), au pas de 3 px, traits posés sur la grille.
 */
function session(): string {
  const caps: [x: number, h: number][] = [
    [0.5, 15],
    [3.5, 11],
    [6.5, 7],
  ];
  const body = caps
    .flatMap(([x, h]) => [x, 20 - x - 2].map((left) => `<rect x="${f(left)}" y="${f((16 - h) / 2)}" width="2" height="${f(h)}" rx="1"/>`))
    .join('');
  return `<g ${ink(0.75)}>${body}<circle cx="10" cy="8" r="1.2"/></g>`;
}

/** C.035 — un trade : de l'entrée (⊕) à la sortie (→), le filet orienté. */
function trade(): string {
  return `<g ${ink(0.9)}><circle cx="3.9" cy="4" r="3.2"/><path d="M3.9 2.1V5.9M2 4H5.8M7.1 4H22.9M20.1 1.4 22.9 4 20.1 6.6"/></g>`;
}

/** C.090 — le catalyseur : l'étoile pleine à huit rais, au croisement de sa tige et de l'axe du temps. */
function catalyst(): string {
  const cx = 6;
  const cy = 11;
  const rays = [45, 135, 225, 315]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      return `M${f(cx + 1.6 * Math.cos(a))} ${f(cy + 1.6 * Math.sin(a))}L${f(cx + 4.2 * Math.cos(a))} ${f(cy + 4.2 * Math.sin(a))}`;
    })
    .join('');
  return `<path ${ink(0.75)} d="M6 0.5V15.5M0.5 11H11.5"/><path ${ink(1)} d="${rays}M6 6.8V15.2M1.8 11H10.2"/><circle cx="${cx}" cy="${cy}" r="1.7"/>`;
}

/** C.065 — le compte : ⊖ en haut, ⊕ dessous, sur leur tige (la limite qu'on règle). */
function account(): string {
  return `<g ${ink(0.85)}><circle cx="5" cy="2.6" r="2.2"/><path d="M3.8 2.6H6.2M5 4.8V7.8M2.8 11.7H7.2M5 9.5V13.9"/><circle cx="5" cy="11.7" r="3.9"/></g>`;
}

/**
 * C.042 — refusé : la croix de Saint-André au contour seul, angles intérieurs arrondis ; ce qui n'a pas eu lieu, sans
 * rouge. Deux bandes de demi-largeur `h`, bouts d'équerre aux coins, chaque creux arrondi d'un arc de rayon `r`.
 */
function refused(): string {
  const e = 1.9;
  const h = 1.25;
  const r = 3.2;
  const d = h / Math.SQRT2;
  const k = 2 * d;
  const t = r / Math.SQRT2;
  const p = (x: number, y: number) => `${f(x)} ${f(y)}`;
  const arc = (x: number, y: number) => `A${f(r)} ${f(r)} 0 0 0 ${p(x, y)}`;
  return `<path ${ink(0.8)} d="M${p(e + d, e - d)}L${p(8 - t, 8 - k - t)}${arc(8 + t, 8 - k - t)}L${p(16 - e - d, e - d)} ${p(16 - e + d, e + d)} ${p(8 + k + t, 8 - t)}${arc(8 + k + t, 8 + t)}L${p(16 - e + d, 16 - e - d)} ${p(16 - e - d, 16 - e + d)} ${p(8 + t, 8 + k + t)}${arc(8 - t, 8 + k + t)}L${p(e + d, 16 - e + d)} ${p(e - d, 16 - e - d)} ${p(8 - k - t, 8 + t)}${arc(8 - k - t, 8 - t)}L${p(e - d, e + d)}Z"/>`;
}

/** C.013 — périmé : la séquence qui s'efface, d'un disque à un trait, sur cinq pas réguliers. */
function stale(): string {
  const rx = [2, 1.5, 1, 0.6, 0.3];
  return rx.map((r, i) => `<ellipse cx="${f(2.2 + i * 4.4)}" cy="3" rx="${f(r)}" ry="2"/>`).join('');
}

/** C.054 — partiel : la couronne octogonale de la matrice 7 × 7, centre vide (une source incomplète). */
function partial(): string {
  const rows = [[1, 3, 5], [0, 1, 2, 4, 5, 6], [1, 5], [0, 6], [1, 5], [0, 1, 2, 4, 5, 6], [1, 3, 5]];
  const pitch = (16 - 1.8) / 6;
  return rows.flatMap((cols, row) => cols.map((col) => `<rect x="${f(col * pitch)}" y="${f(row * pitch)}" width="1.8" height="1.8" rx="0.45"/>`)).join('');
}

/**
 * C.024 — l'écart de discipline : un champ de croix identiques (le trait fin, le cœur concave), l'une tournée de 45°.
 * La grille 4 × 3 du master, au pas de 5 px, chaque croix posée sur la grille.
 */
function drift(): string {
  const cells: string[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 2.5 + col * 5;
      const y = 2.5 + row * 5;
      const turn = row === 1 && col === 2 ? 45 : 0;
      const a = (turn * Math.PI) / 180;
      const arm = (dx: number, dy: number) => `${f(x + dx * Math.cos(a) - dy * Math.sin(a))} ${f(y + dx * Math.sin(a) + dy * Math.cos(a))}`;
      cells.push(`<path ${ink(0.8)} d="M${arm(-2, 0)}L${arm(2, 0)}M${arm(0, -2)}L${arm(0, 2)}"/>${star(x, y, 0.9, 0.25, turn)}`);
    }
  }
  return cells.join('');
}

/** C.070 — la garde du process principal : l'écrou (coins pleins hors du cercle) et ses cinq cercles en croix. */
function guard(): string {
  const w = 16 * (Math.sqrt(3) / 2);
  const x0 = (14 - w) / 2;
  const c = { x: 7, y: 8 };
  const r = 6.6;
  const hex = `M7 0L${f(x0 + w)} 4V12L7 16L${f(x0)} 12V4Z`;
  const hole = `M${f(c.x - r)} ${c.y}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;
  const k = 3.4;
  const rings = [
    [0, 0],
    [0, -k],
    [0, k],
    [-k, 0],
    [k, 0],
  ]
    .map(([dx, dy]) => `<circle cx="${f(c.x + dx!)}" cy="${f(c.y + dy!)}" r="1.3"/>`)
    .join('');
  return `<path fill-rule="evenodd" d="${hex}${hole}"/><g ${ink(0.75)}>${rings}</g>`;
}

/** C.073 — l'aplatissement : deux moitiés striées qui se referment sur l'axe, la position ramenée à zéro. */
function flatten(): string {
  const reach = [1.2, 2.8, 4.5, 2.8, 1.2];
  const bars = reach.flatMap((len, i) => {
    const y = 0.5 + i * 2.4;
    return [
      `<rect x="0.3" y="${f(y)}" width="1.8" height="1.4" rx="0.7"/>`,
      `<rect x="2.9" y="${f(y)}" width="${f(len)}" height="1.4" rx="0.7"/>`,
      `<rect x="${f(16 - 2.9 - len)}" y="${f(y)}" width="${f(len)}" height="1.4" rx="0.7"/>`,
      `<rect x="13.9" y="${f(y)}" width="1.8" height="1.4" rx="0.7"/>`,
    ];
  });
  return bars.join('');
}

/** C.105 — la réduction de risque : C.107 en miroir, la flèche descend vers l'origine, donc vers le flat ; elle passe toujours. */
function reduceRisk(): string {
  return `<g ${ink(0.8)}><circle cx="8" cy="8" r="7.5"/><path d="M13.3 2.69 4.52 11.48"/><path stroke-linecap="square" d="M4.52 9.02V11.48H6.98"/></g>`;
}

/** C.109 — les règles du trader : l'étoile de doctrine (C.135 pleine) dans sa visée ; le carré redressé, la croix jusqu'aux bords. */
function traderRule(): string {
  return `<g ${ink(0.8)}><rect x="0.5" y="0.5" width="15" height="15"/><circle cx="8" cy="8" r="7.1"/></g><path ${ink(1.1)} d="M8 0.5V15.5M0.5 8H15.5"/>${star(8, 8, 4.4, 0.9)}`;
}

/** Les quatre triangles de C.126, la borne du plancher (master du dépôt, boîte de 15,29). */
const BORNE = [
  'M14.18,13.01l-4.9-4.9c-.25-.25-.25-.67,0-.92l4.9-4.9c.41-.41,1.11-.12,1.11.46v9.81c0,.58-.7.87-1.11.46Z',
  'M13.01,1.11l-4.9,4.9c-.25.25-.67.25-.92,0L2.28,1.11C1.87.7,2.16,0,2.74,0h9.81c.58,0,.87.7.46,1.11Z',
  'M1.11,2.28l4.9,4.9c.25.25.25.67,0,.92L1.11,13.01C.7,13.42,0,13.13,0,12.55V2.74c0-.58.7-.87,1.11-.46Z',
  'M2.28,14.18l4.9-4.9c.25-.25.67-.25.92,0l4.9,4.9c.41.41.12,1.11-.46,1.11H2.74c-.58,0-.87-.7-.46-1.11Z',
];

/** C.125 — le plancher qui suit encore (drawdown trailing avant son verrou) : C.126 au trait ; plein, il serait fixé. */
function floorTrailing(): string {
  const k = 15 / 15.29;
  return `<g transform="translate(0.5 0.5) scale(${f(k)})" ${ink(0.9 / k)}>${BORNE.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

/** C.140 — la marge au plancher, ce qui reste avant la borne : un segment entre deux points, la suspension, puis la borne même du desk (C.126). */
function margin(): string {
  const k = 7 / 15.29;
  const dots = [12.5, 14.1, 15.7].map((x) => `<circle cx="${f(x)}" cy="4" r="0.55"/>`).join('');
  return `<circle cx="1.1" cy="4" r="1"/><path ${ink(0.8)} d="M1.1 4H9.6"/><circle cx="9.6" cy="4" r="1"/>${dots}<g transform="translate(16.5 0.5) scale(${f(k)})">${BORNE.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

/**
 * C.092 — la proposition de l'agent : la proposition (carré) passe la garde du process principal, puis monte au siège de
 * l'opérateur (disque). Sans triangle, réservé au signal (décision 5) : la garde y prend l'écrou de C.070.
 */
function proposal(): string {
  return `<path ${ink(0.75)} d="M5.5 4H18.5"/><rect x="0.5" y="1.5" width="5" height="5"/><path d="M12 1 14.6 2.5V5.5L12 7 9.4 5.5V2.5Z"/><circle cx="21.2" cy="4" r="2.6"/>`;
}

/** Les composants dessinés, par leur numéro sur la planche des 150. */
export const DRAWN: Readonly<Record<number, string>> = {
  13: svg(13, 22, 6, stale()),
  24: svg(24, 20, 15, drift()),
  35: svg(35, 24, 8, trade()),
  42: svg(42, 16, 16, refused()),
  54: svg(54, 16, 16, partial()),
  65: svg(65, 10, 16, account()),
  70: svg(70, 14, 16, guard()),
  73: svg(73, 16, 12, flatten()),
  90: svg(90, 12, 16, catalyst()),
  92: svg(92, 24, 8, proposal()),
  94: svg(94, 20, 16, session()),
  105: svg(105, 16, 16, reduceRisk()),
  109: svg(109, 16, 16, traderRule()),
  125: svg(125, 16, 16, floorTrailing()),
  140: svg(140, 24, 8, margin()),
};

/** Le nom que le desk donne à chaque composant dessiné ici. */
export const DRAWN_ID = {
  session: 94,
  trade: 35,
  catalyst: 90,
  account: 65,
  refused: 42,
  stale: 13,
  partial: 54,
  drift: 24,
  guard: 70,
  flatten: 73,
  reduceRisk: 105,
  traderRule: 109,
  floorTrailing: 125,
  margin: 140,
  proposal: 92,
} as const;
