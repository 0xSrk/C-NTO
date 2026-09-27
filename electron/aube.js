/* ═══════════════════════════════════════════════════════════════════════════════
   CΛNTO · Lanceur · AUBE III — lever de soleil orbital, cœur vectoriel
   SIΞRRΛSKΛ Lab · Artefact 002

   Remplace AUBE II à l'identique côté intégration (même API, mêmes canvas,
   même timeline). Tout le reste est réécrit.

   PIPELINE (WebGL2, par image)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 0  cuisson (une fois) : carte Terre 2048² · carte ciel 1024² ·           │
   │    table de transmittance atmosphérique 256×128                         │
   ├──────────────────────────────────────────────────────────────────────────┤
   │ 1  SCÈNE  → HDR 16 bits, résolution de rendu                             │
   │    Terre : sphère + relief (normales dérivées) + océan GGX + 2 couches   │
   │    de nuages à leur altitude (ombres rasantes, silhouettes au limbe)     │
   │    + lumières de villes (4 semis ponctuels, halos de pollution lumineuse)│
   │    Atmosphère : diffusion simple Rayleigh + Mie, 14 pas importance-      │
   │    échantillonnés vers le point le plus bas, transmittance par table     │
   │    Ciel : étoiles 3 profondeurs + voie lactée + Lune en phase            │
   ├──────────────────────────────────────────────────────────────────────────┤
   │ 2  PRÉFILTRE 1/2 → 3 SOUS-ÉCHANTILLONS 13 taps → 3 SUR-ÉCHANTILLONS tente│
   │    = bloom physique                                                      │
   │ 3  RAYONS : flou radial vers le soleil, 2 passes, 1/2                    │
   │ 4  TRAÎNÉE ANAMORPHIQUE : flou horizontal, 2 passes, 1/4                 │
   │ 5  COMPOSITION → écran : exposition adaptative, ACES, désaturation       │
   │    « argent », vignette, grain, tramage triangulaire, fondus             │
   └──────────────────────────────────────────────────────────────────────────┘
   CALQUE VECTORIEL (Canvas 2D, 1 px physique) : limbe gradué, graticule,
   réticule solaire, aigrettes, poussières en profondeur de champ ; au
   lancement le graticule se referme en CŒUR (sphère filaire à épaisseur de
   trait selon la profondeur, halo, 3 orbites, échelle gyroscopique, noyau)
   puis s'effondre en LED sur la timeline du circuit.

   CSP `script-src 'self'` : aucun eval. API : window.cantoAube
     launch(): Promise<void>  — résout quand le circuit doit prendre la main
     start() · stop() · isRunning() · handoffAt (lecture) · quality (lecture)
   ═══════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const VERSION = '3.0.0';

  /* ── Timeline du circuit (miroir exact de runTransfer() dans launcher-ui.js) ── */
  const T_RING = 560;
  const T_COLLAPSE = 1000;
  const T_LED = 1260;
  const T_DONE = 1520;

  /* ── Réglages ─────────────────────────────────────────────────────────────── */
  const CFG = {
    limbY: 390, // px CSS : apex du limbe (sous « SIΞRRΛSKΛ—LAB », au-dessus du panneau)
    alt: 0.2, // altitude caméra (rayons terrestres)
    fov: 50, // champ vertical (degrés)
    sunAz: 0, // le soleil se lève sur l'axe du réticule
    sunRadius: 0.5, // rayon angulaire du disque (degrés)
    riseStart: 1500, // ms après l'ouverture
    riseDur: 14000, // durée du lever
    hStart: -7.0, // élévation du soleil au départ (degrés sous l'horizon)
    hEnd: 2.0, // élévation à la fin du lever
    hDrift: 0.012, // montée résiduelle (degrés / s)
    hDriftMax: 1.2,
    expoNight: 1.9, // exposition de nuit
    expoDay: 0.16, // exposition soleil levé (échelle HDR physique : ~14× moins)
    spin: 0.0026, // rotation terrestre (rad / s)
    earthTilt: -0.92, // latitude survolée
    earthYaw: 5.8, // méridien initial : compose l'image d'ouverture
    axialTilt: 0.409, // 23,4°
    cloudDrift: 0.0022, // dérive des nuages bas (tours / s)
    cirrusDrift: 0.0037, // dérive des cirrus
    moonAz: -34, // azimut de la Lune (degrés, vers la gauche)
    moonEl: 31, // élévation de la Lune
    pre: 1350, // immersion + cœur avant la main au circuit (ms) — miroir dans tests/launcher-transfer.test.ts
    coreR: 44, // rayon du cœur (px CSS)
    bake: 2048, // largeur de la carte Terre
    maxScale: 3, // plafond de pixels GL par px CSS
    bloom: 0.07, // dosage du bloom
    rays: 0.22, // dosage des rayons
    streak: 0.14, // dosage de la traînée anamorphique
    tint: 0.04, // part de couleur conservée (0 = monochrome strict)
  };

  /* ── Paliers de qualité (le régulateur descend seul, remonte sur mesure GPU) ── */
  const TIERS = [
    { name: 'ultra', scale: 1.25, rays: true, streak: true },
    { name: 'high', scale: 1.0, rays: true, streak: true },
    { name: 'medium', scale: 0.8, rays: true, streak: false },
    { name: 'low', scale: 0.6, rays: false, streak: false },
  ];

  const DEG = Math.PI / 180;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeIn = (x) => x * x * x;
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeInOutS = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x));
  const sstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const win = (t, a, b) => clamp01((t - a) / (b - a));

  /* ── Algèbre 3×3 (lignes) ─────────────────────────────────────────────────── */
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const mmul = (A, B) => {
    const C = new Array(9);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    return C;
  };
  const mvec = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
  const mT = (M) => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
  const rx = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const ry = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const colMajor = (M) => new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]);

  // Générateur déterministe : la même Terre, les mêmes poussières à chaque ouverture
  let seed = 0x5153;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  /* ══════════════════════════════════════════════════════════════════════════════
     SHADERS
     ══════════════════════════════════════════════════════════════════════════════ */
  const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const NOISE = `
vec3 h3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}
float gn(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(dot(h3(i), f), dot(h3(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), u.x),
                 mix(dot(h3(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)), dot(h3(i + vec3(1, 1, 0)), f - vec3(1, 1, 0)), u.x), u.y),
             mix(mix(dot(h3(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)), dot(h3(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), u.x),
                 mix(dot(h3(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)), dot(h3(i + vec3(1, 1, 1)), f - vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int k = 0; k < 9; k++) { if (k >= oct) break; s += a * gn(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
float ridge(vec3 p, int oct) {
  float a = 0.5, s = 0.0;
  for (int k = 0; k < 7; k++) { if (k >= oct) break; s += a * (1.0 - abs(gn(p))); p = p * 2.11 + vec3(4.1, 2.3, 7.7); a *= 0.5; }
  return s;
}
vec3 dirFromUV(vec2 uv) {
  float lon = (uv.x - 0.5) * 6.2831853, lat = (uv.y - 0.5) * 3.14159265;
  return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
}`;

  /* Carte Terre (une fois) : R côte · G population · B nuages bas · A relief/cirrus */
  const FS_EARTH = `#version 300 es
precision highp float;
uniform vec2 uSize;
out vec4 o;
${NOISE}
void main() {
  vec3 d = dirFromUV(gl_FragCoord.xy / uSize);
  vec3 w = d * 1.35 + vec3(fbm(d * 2.1 + 3.0, 4), fbm(d * 2.1 + 11.0, 4), fbm(d * 2.1 + 19.0, 4)) * 0.6;
  float c = fbm(w * 1.25, 8);
  float land = 0.5 + (c - 0.085) * 2.4;                       // 0,5 = trait de côte (~35 % de terres)
  float lm = smoothstep(0.495, 0.505, land);
  float coast = exp(-abs(land - 0.5) * 16.0);
  float region = smoothstep(0.34, 0.56, fbm(d * 2.3 + 7.0, 5) * 0.5 + 0.5);     // régions peuplées / déserts
  float metro = smoothstep(0.62, 0.9, fbm(d * 11.0 + w * 1.5, 5) * 0.5 + 0.5);  // agglomérations
  float fil = pow(ridge(d * 15.0 + w * 2.2, 6), 7.0);                          // réseau routier, vallées
  float town = smoothstep(0.55, 0.85, fbm(d * 34.0, 4) * 0.5 + 0.5);
  float pop = lm * clamp(region * (metro * 1.1 + fil * 0.55 + town * fil * 0.8) + coast * fil * 0.6 * region + metro * coast * 0.4, 0.0, 1.0);
  pop *= smoothstep(0.92, 0.70, abs(d.y));
  vec3 cw = d * 1.7 + w * 0.9 + vec3(fbm(d * 3.0 + 50.0, 4), fbm(d * 3.0 + 60.0, 4), 0.0) * 0.9;
  float cl = fbm(cw + vec3(40.0), 8) * 0.5 + 0.5;
  cl = mix(cl, ridge(d * 6.0 + cw, 6), 0.32);
  cl = smoothstep(0.34, 0.8, cl);
  cl *= 0.72 + 0.35 * smoothstep(0.05, 0.55, abs(d.y + 0.07 * sin(atan(d.x, d.z) * 3.0)));
  // relief (côtes montagneuses) — réutilisé comme cirrus à une autre échelle
  float rel = fbm(d * 24.0, 6) * 0.5 + 0.5;
  rel = mix(rel, ridge(d * 30.0 + w, 5), 0.35);
  o = vec4(clamp(land, 0.0, 1.0), pop, clamp(cl, 0.0, 1.0), rel);
}`;

  /* Carte du ciel (une fois) : R voie lactée · G halo · B bandes sombres */
  const FS_SKY = `#version 300 es
precision highp float;
uniform vec2 uSize;
out vec4 o;
${NOISE}
void main() {
  vec3 d = dirFromUV(gl_FragCoord.xy / uSize);
  vec3 nb = normalize(vec3(-0.42, 0.55, 0.72));
  float b = dot(d, nb) + 0.04 * fbm(d * 3.0, 3);
  float band = exp(-b * b / 0.05), core = exp(-b * b / 0.007);
  float dust = fbm(d * 5.0 + 2.0, 7) * 0.5 + 0.5;
  float lanes = smoothstep(0.62, 0.95, ridge(d * 5.5 + 9.0, 6));
  float mw = band * (0.2 + 0.8 * dust * dust) + core * 0.7 * dust;
  mw *= 1.0 - 0.85 * lanes * smoothstep(0.0, 1.0, core + band * 0.4);
  float neb = pow(fbm(d * 2.4 + 30.0, 6) * 0.5 + 0.5, 3.0);
  o = vec4(clamp(mw, 0.0, 1.0), neb, lanes, 1.0);
}`;

  /* Physique de l'atmosphère (unités : rayon terrestre) */
  const ATMO = `
// Atmosphère dilatée ×2 (épaisseur lisible à cette taille de fenêtre), densités
// divisées d'autant : les profondeurs optiques restent celles de la Terre.
const float HA = 0.032;                 // sommet de l'atmosphère
const float RA = 1.032;
const float HR = 0.0025, HM = 0.00038;  // hauteurs d'échelle Rayleigh / Mie
const vec3 BR = vec3(18.5, 43.0, 105.5);
const float BM = 10.5;
vec2 sph(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}`;

  /* Table de transmittance T(h, μ) : (une fois) 256 × 128 */
  const FS_TRANS = `#version 300 es
precision highp float;
uniform vec2 uSize;
out vec4 o;
${ATMO}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float h = uv.x * uv.x * HA;
  float mu = uv.y * 2.0 - 1.0;
  vec3 p = vec3(0.0, 1.0 + h, 0.0);
  vec3 d = vec3(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  vec2 g = sph(p, d, 1.0);
  if (g.x > 0.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float t1 = sph(p, d, RA).y;
  const int N = 48;
  float dt = t1 / float(N);
  vec2 od = vec2(0.0);
  for (int i = 0; i < N; i++) {
    vec3 q = p + d * (float(i) + 0.5) * dt;
    float hh = max(length(q) - 1.0, 0.0);
    od += vec2(exp(-hh / HR), exp(-hh / HM)) * dt;
  }
  o = vec4(exp(-(BR * od.x + BM * 1.1 * od.y)), 1.0);
}`;

  const FS_SCENE = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform float uPx, uTime;
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform float uTanH, uAspect;
uniform vec3 uSun, uMoon;
uniform float uSunAng, uSunVis;
uniform mat3 uEarth;
uniform float uCloud, uCirrus, uVec, uZoom, uCity, uStars;
uniform vec2 uZc;
uniform sampler2D uMap, uSky, uTrans;
out vec4 fragColor;

const float PI = 3.14159265, TAU = 6.2831853;
const float R_CLOUD = 1.0032, R_CIRRUS = 1.0085;
const vec3 SKYLIGHT = vec3(0.62, 0.7, 0.82);   // lumière du ciel crépusculaire (diffusion multiple)
float twilight(float ndl) { return smoothstep(-0.36, 0.14, ndl); }
const float SUN_I = 22.0;               // irradiance solaire (unités HDR)
const vec3 WHITE = vec3(1.0, 0.985, 0.965);
${ATMO}

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 rnd3(ivec3 c) { return vec3(pcg3d(uvec3(c))) * (1.0 / 4294967295.0); }
vec2 equi(vec3 d) { return vec2(atan(d.x, d.z) / TAU + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5); }
vec4 sampleEqui(sampler2D s, vec2 uv) {
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= round(dx.x); dy.x -= round(dy.x);                  // pas de couture à la ligne de date
  return textureGrad(s, uv, dx, dy);
}
vec3 transm(float h, float mu) {
  // moyenne sur le disque solaire : terminateur en pénombre, pas en marche
  float x = sqrt(clamp(h / HA, 0.0, 1.0));
  vec3 a = texture(uTrans, vec2(x, (mu + uSunAng * 0.7) * 0.5 + 0.5)).rgb;
  vec3 b = texture(uTrans, vec2(x, (mu - uSunAng * 0.7) * 0.5 + 0.5)).rgb;
  return 0.5 * (a + b);
}

/* Couche de points : une source par cellule, gaussienne en espace ÉCRAN (jacobien
   inversé) : ronde et nette quelle que soit la perspective. Sous le pixel, l'énergie
   moyenne bornée prend le relais : aucun fourmillement. .y porte une graine de teinte. */
vec3 points(vec2 q, float nx, float salt, float dens, float sig, float haloR, float haloK, float twk) {
  vec2 qx = vec2(dFdx(q.x), dFdy(q.x)); qx -= nx * round(qx / nx);
  vec2 qy = vec2(dFdx(q.y), dFdy(q.y));
  mat2 J = mat2(qx.x, qy.x, qx.y, qy.y);
  float det = abs(J[0][0] * J[1][1] - J[0][1] * J[1][0]);
  sig = max(sig, 0.55);
  float avg = min(dens * 0.14 * det * 6.2831853 * sig * sig, dens * 0.6);
  float wu = smoothstep(0.05, 0.35, det);
  if (wu >= 1.0 || dens <= 0.0) return vec3(avg * wu, 0.5, 0.0);
  vec2 c = floor(q);
  int cx = int(mod(c.x, nx));
  vec3 r1 = rnd3(ivec3(cx, int(c.y), int(salt)));
  if (r1.x > dens) return vec3(avg * wu, 0.5, 0.0);
  vec3 r2 = rnd3(ivec3(cx, int(c.y), int(salt) + 7919));
  vec2 pos = c + 0.18 + 0.64 * r1.yz;
  vec2 s = inverse(J) * (q - pos);
  float d2 = dot(s, s);
  float b = 0.1 + 0.9 * r2.x * r2.x * r2.x * r2.x;
  float t = uTime;
  b *= 0.82 + 0.18 * sin(t * (0.7 + 2.3 * r2.y) + TAU * r2.z);
  b *= 1.0 + twk * 2.2 * pow(max(0.0, sin(t * (0.9 + 2.1 * r2.y) + r2.z * 61.0)), 48.0);
  float core = exp(-d2 / (2.0 * sig * sig));
  float halo = haloK * r2.x * exp(-sqrt(d2) / haloR);
  return vec3(mix((core + halo) * b, avg, wu), r2.y, 0.0);
}

/* Diffusion simple le long du rayon, 14 pas resserrés vers le point le plus bas. */
vec3 scatter(vec3 ro, vec3 rd, float tMax, out vec3 Tv) {
  Tv = vec3(1.0);
  vec2 ha = sph(ro, rd, RA);
  float t0 = max(ha.x, 0.0), t1 = min(ha.y, tMax);
  if (t1 <= t0 || ha.y < 0.0) return vec3(0.0);
  float tc = clamp(-dot(ro, rd), t0, t1);
  vec3 sR = vec3(0.0), sM = vec3(0.0);
  vec2 od = vec2(0.0);
  const int N = 7;
  for (int side = 0; side < 2; side++) {
    float ta = side == 0 ? t0 : tc, tb = side == 0 ? tc : t1;
    for (int i = 0; i < N; i++) {
      float u0 = float(i) / float(N), u1 = float(i + 1) / float(N);
      float s0 = side == 0 ? tb - (tb - ta) * (1.0 - u0) * (1.0 - u0) : ta + (tb - ta) * u0 * u0;
      float s1 = side == 0 ? tb - (tb - ta) * (1.0 - u1) * (1.0 - u1) : ta + (tb - ta) * u1 * u1;
      float ds = s1 - s0;
      if (ds <= 0.0) continue;
      vec3 p = ro + rd * (0.5 * (s0 + s1));
      float r = length(p);
      float h = max(r - 1.0, 0.0);
      vec2 dn = vec2(exp(-h / HR), exp(-h / HM)) * ds;
      od += 0.5 * dn;
      vec3 T = exp(-(BR * od.x + BM * 1.1 * od.y)) * transm(h, dot(p / r, uSun));
      od += 0.5 * dn;
      sR += T * dn.x;
      sM += T * dn.y;
    }
  }
  Tv = exp(-(BR * od.x + BM * 1.1 * od.y));
  float mu = dot(rd, uSun);
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.76, g2 = g * g;
  float pM = 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
  return (sR * BR * pR + sM * BM * pM) * SUN_I;
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 ndc0 = fc / uRes * 2.0 - 1.0;
  vec2 ndc = uZc + (ndc0 - uZc) / (1.0 + uZoom);
  vec3 rd = normalize(uCamF + ndc.x * uAspect * uTanH * uCamR + ndc.y * uTanH * uCamU);
  vec3 ro = uCamPos;
  float mu = dot(rd, uSun);
  float angS = sqrt(max(2.0 * (1.0 - mu), 0.0));
  vec2 hg = sph(ro, rd, 1.0);
  bool ground = hg.x > 0.0;
  float tca = max(-dot(ro, rd), 0.0);
  float imp = length(ro + rd * tca);
  float hAlt = imp - 1.0;
  float pxRad = 2.0 * uTanH / uRes.y;

  vec3 col = vec3(0.0);
  vec3 Tv = vec3(1.0);
  vec3 sky = vec3(0.0);
  sky = scatter(ro, rd, ground ? hg.x : 1e9, Tv);

  if (ground) {
    /* ───────── Terre ───────── */
    vec3 pg = ro + rd * hg.x;
    vec3 n = pg;
    vec3 ne = uEarth * n;
    vec2 uv = equi(ne);
    vec4 m = sampleEqui(uMap, uv);
    float cw = max(fwidth(m.r), 0.0035);
    float land = smoothstep(0.5 - cw, 0.5 + cw, m.r);
    // relief : normale perturbée par le gradient de la carte (deux lectures)
    vec2 e = vec2(0.6 / 2048.0, 0.6 / 1024.0);
    float hx = sampleEqui(uMap, uv + vec2(e.x, 0.0)).a - sampleEqui(uMap, uv - vec2(e.x, 0.0)).a;
    float hy = sampleEqui(uMap, uv + vec2(0.0, e.y)).a - sampleEqui(uMap, uv - vec2(0.0, e.y)).a;
    vec3 tU = normalize(cross(vec3(0.0, 1.0, 0.0), n));
    vec3 tV = cross(n, tU);
    vec3 nr = normalize(n - (tU * hx + tV * hy) * 9.0 * land);
    float ndl = dot(n, uSun);
    float ndlr = max(dot(nr, uSun), 0.0);
    vec3 Ts = transm(0.0, ndl);                                  // couleur du soleil au sol
    vec3 alb = mix(vec3(0.020, 0.024, 0.030), vec3(0.075) + m.a * 0.09, land);
    // nuages bas, à leur altitude
    vec2 hc = sph(ro, rd, R_CLOUD);
    vec3 pc = ro + rd * hc.x;
    vec3 nc = normalize(pc);
    vec2 cuv = equi(uEarth * nc) + vec2(uCloud, 0.0);
    vec4 mc = sampleEqui(uMap, cuv);
    float cdet = sampleEqui(uMap, cuv * 4.0 + vec2(0.37, 0.11)).a - 0.5;   // détail fin des bords
    float cd = smoothstep(0.6, 0.92, mc.b + (mc.a - 0.5) * 0.22 + cdet * 0.16);
    // cirrus, plus haut : fins, ils prennent le soleil les premiers
    vec2 hh = sph(ro, rd, R_CIRRUS);
    vec3 nh = normalize(ro + rd * hh.x);
    vec4 mh = sampleEqui(uMap, equi(uEarth * nh) * vec2(2.0, 1.0) + vec2(uCirrus, 0.21));
    float ci = smoothstep(0.66, 0.84, mh.a) * 0.55;
    // ombre des nuages sous soleil rasant
    float sh = 1.0;
    if (ndl > -0.03) {
      vec3 ps = normalize(pg + uSun * min((R_CLOUD - 1.0) / max(ndl, 0.03), 0.14));
      vec4 ms = sampleEqui(uMap, equi(uEarth * ps) + vec2(uCloud, 0.0));
      sh = 1.0 - 0.85 * smoothstep(0.56, 0.9, ms.b + (ms.a - 0.5) * 0.28);
    }
    // océan : GGX rugosité 0,08, Fresnel Schlick, disque solaire
    vec3 hv = normalize(uSun - rd);
    float ndh = max(dot(n, hv), 0.0), ndv = max(dot(n, -rd), 1e-3);
    float rough = 0.085, a2 = rough * rough;
    float dd = ndh * ndh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    float spec = D * F / (4.0 * ndv + 0.4);
    vec3 sunG = Ts * SUN_I;
    vec3 gcol = alb * (ndlr * sh * sunG + SKYLIGHT * SUN_I * 0.12 * twilight(ndl) * (0.6 + 0.4 * sh));
    gcol += WHITE * spec * ndlr * sh * sunG * (1.0 - land) * (1.0 - cd) * 0.32;
    gcol += alb * 0.045;                                         // clair de lune
    // lumières : 4 semis + halos de pollution lumineuse
    float pop = m.g;
    float night = 1.0 - smoothstep(-0.06, 0.015, ndl);
    vec3 lx = vec3(0.0);
    if (night > 0.0) {
      float ny;
      vec2 q;
      vec3 p1, p2, p3, p4;
      ny = 150.0;  q = vec2(uv.x * ny * 2.0, uv.y * ny);
      p1 = points(q, ny * 2.0, 11.0, smoothstep(0.50, 0.95, pop) * 0.95, 0.85 * uPx, 3.2 * uPx, 0.10, 1.0);
      ny = 380.0;  q = vec2(uv.x * ny * 2.0, uv.y * ny);
      p2 = points(q, ny * 2.0, 23.0, smoothstep(0.22, 0.80, pop) * 0.75, 0.62 * uPx, 1.8 * uPx, 0.05, 0.7);
      ny = 920.0;  q = vec2(uv.x * ny * 2.0, uv.y * ny);
      p3 = points(q, ny * 2.0, 37.0, smoothstep(0.06, 0.55, pop) * 0.62, 0.5 * uPx, 1.0, 0.0, 0.4);
      ny = 2200.0; q = vec2(uv.x * ny * 2.0, uv.y * ny);
      p4 = points(q, ny * 2.0, 53.0, smoothstep(0.02, 0.35, pop) * 0.5 * land, 0.45 * uPx, 1.0, 0.0, 0.0);
      // température de couleur : sodium chaud, LED froide, à dose discrète
      vec3 warm = vec3(1.0, 0.92, 0.80), cool = vec3(0.88, 0.94, 1.0);
      lx = mix(cool, warm, p1.y) * p1.x * 8.0 + mix(cool, warm, p2.y) * p2.x * 3.8 + WHITE * (p3.x * 1.9 + p4.x * 0.8);
      float glow = textureLod(uMap, uv, 4.5).g;                  // pollution lumineuse
      lx += mix(warm, WHITE, 0.5) * glow * glow * 0.16;
      lx *= night * (1.0 - 0.55 * cd) * (1.0 - 0.3 * ci);
    }
    gcol += lx * uCity * 0.9;
    // nuages : clair de lune, soleil rasant, rétro-éclairage par les villes
    float ncl = dot(nc, uSun);
    vec3 Tc = transm(R_CLOUD - 1.0, ncl);
    float thick = 0.62 + 0.55 * smoothstep(0.62, 1.05, mc.b + cdet * 0.25);
    vec3 ccol = vec3(0.86) * thick * (max(ncl + 0.02, 0.0) * 1.15 * Tc * SUN_I + SKYLIGHT * SUN_I * 0.07 * twilight(ncl) + 0.004) + mix(WHITE, vec3(1.0, 0.93, 0.82), 0.4) * pop * night * 0.02 * uCity;
    float nch = dot(nh, uSun);
    vec3 Th = transm(R_CIRRUS - 1.0, nch);
    vec3 hcol = vec3(0.9) * (max(nch + 0.03, 0.0) * 1.3 * Th * SUN_I + SKYLIGHT * SUN_I * 0.05 * twilight(nch) + 0.003);
    col = mix(gcol, ccol, cd * 0.93);
    col = mix(col, hcol, ci * (1.0 - cd * 0.5));
    col *= 1.0 - 0.88 * uVec;                                    // la Terre se dématérialise
    col = col * Tv + sky;                                        // perspective aérienne
  } else {
    /* ───────── Ciel ───────── */
    float az = atan(rd.x, -rd.z) / TAU + 0.5;
    float el = asin(clamp(rd.y, -1.0, 1.0)) / PI + 0.5;
    vec4 sk = sampleEqui(uSky, vec2(atan(rd.x, rd.z) / TAU + 0.5, el));
    float mw = sk.r;
    vec3 stars = vec3(0.86, 0.89, 0.94) * (mw * 0.011 + sk.g * 0.0015);
    float twk = exp(-max(hAlt, 0.0) / 0.06);
    vec3 s1 = points(vec2(az * 300.0, el * 150.0), 300.0, 101.0, 0.065 + 0.2 * mw, 0.6 * uPx, 2.0 * uPx, 0.03, twk);
    vec3 s2 = points(vec2(az * 760.0, el * 380.0), 760.0, 131.0, 0.05 + 0.22 * mw, 0.52 * uPx, 1.0, 0.0, twk * 0.6);
    vec3 s3 = points(vec2(az * 1700.0, el * 850.0), 1700.0, 157.0, 0.03 + 0.3 * mw, 0.46 * uPx, 1.0, 0.0, 0.0);
    // classes spectrales, à dose discrète
    vec3 tint = mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.93, 0.85), s1.y);
    stars += tint * s1.x * 1.7 + WHITE * (s2.x * 0.9 + s3.x * 0.35);
    col = stars * uStars;
    // Lune : petite sphère lointaine, phase donnée par le soleil
    float dm = dot(rd, uMoon);
    float angM = sqrt(max(2.0 * (1.0 - dm), 0.0));
    float rM = 0.0056;
    if (angM < rM + pxRad) {
      vec3 mx = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0))), my = cross(mx, uMoon);
      vec2 o = vec2(dot(rd - uMoon * dm, mx), dot(rd - uMoon * dm, my)) / rM;
      vec3 nm = mx * o.x + my * o.y - uMoon * sqrt(max(1.0 - dot(o, o), 0.0)); // normale du point visible
      float lit = max(dot(nm, uSun), 0.0);
      float disk = smoothstep(rM + pxRad, rM - pxRad, angM);
      col += vec3(0.9, 0.89, 0.86) * (lit * 2.4 + 0.012) * disk * uStars;
    }
    // silhouette des nuages et cirrus au-dessus du limbe
    vec2 hc = sph(ro, rd, R_CLOUD);
    if (hc.x > 0.0) {
      vec3 nc = normalize(ro + rd * hc.x);
      vec4 mc = sampleEqui(uMap, equi(uEarth * nc) + vec2(uCloud, 0.0));
      float cd = smoothstep(0.56, 0.9, mc.b + (mc.a - 0.5) * 0.28);
      float ncl = dot(nc, uSun);
      vec3 Tc = transm(R_CLOUD - 1.0, ncl);
      col = mix(col, vec3(0.86) * (max(ncl + 0.03, 0.0) * 1.3 * Tc * SUN_I + SKYLIGHT * SUN_I * 0.07 * twilight(ncl) + 0.004), cd * 0.8 * (1.0 - uVec));
    }
    vec2 hh = sph(ro, rd, R_CIRRUS);
    if (hh.x > 0.0) {
      vec3 nh = normalize(ro + rd * hh.x);
      vec4 mh = sampleEqui(uMap, equi(uEarth * nh) * vec2(2.0, 1.0) + vec2(uCirrus, 0.21));
      float ci = smoothstep(0.66, 0.84, mh.a) * 0.55;
      float nch = dot(nh, uSun);
      vec3 Th = transm(R_CIRRUS - 1.0, nch);
      col = mix(col, vec3(0.9) * (max(nch + 0.03, 0.0) * 1.3 * Th * SUN_I + SKYLIGHT * SUN_I * 0.05 * twilight(nch) + 0.003), ci * (1.0 - uVec));
    }
    // disque solaire, assombrissement centre-bord (occulté naturellement par la Terre)
    float disk = smoothstep(uSunAng + pxRad, uSunAng - pxRad, angS);
    float ldark = 1.0 - 0.4 * pow(clamp(angS / uSunAng, 0.0, 1.0), 2.5);
    col += WHITE * disk * ldark * SUN_I * 30.0;
    col = col * Tv + sky;
    // lueur nocturne : couche fine suspendue à 90 km
    float airglow = exp(-pow((hAlt - 0.0275) / 0.0022, 2.0));
    col += vec3(0.82, 0.86, 0.92) * airglow * 0.016 * (1.0 - uVec * 0.7);
  }
  // halo de lentille minimal (le bloom fait le reste)
  col += WHITE * uSunVis * SUN_I * 0.04 * exp(-angS / 0.006);
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

  /* Préfiltre : seuil doux, 13 taps, demi-résolution */
  const FS_PREFILTER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold, uKnee, uExpo;
out vec4 o;
vec3 tap(vec2 uv) {
  vec3 c = max(texture(uSrc, uv).rgb * uExpo, 0.0);
  return c * 40.0 / (40.0 + c);                                 // plafond doux : le disque solaire ne noie pas l'image
}
vec3 down13(vec2 uv) {
  vec2 t = uTexel;
  vec3 a = tap(uv + t * vec2(-2, -2)), b = tap(uv + t * vec2(0, -2)), c = tap(uv + t * vec2(2, -2));
  vec3 d = tap(uv + t * vec2(-1, -1)), e = tap(uv + t * vec2(1, -1));
  vec3 f = tap(uv + t * vec2(-2, 0)), g = tap(uv), h = tap(uv + t * vec2(2, 0));
  vec3 i = tap(uv + t * vec2(-1, 1)), j = tap(uv + t * vec2(1, 1));
  vec3 k = tap(uv + t * vec2(-2, 2)), l = tap(uv + t * vec2(0, 2)), m = tap(uv + t * vec2(2, 2));
  return (d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125 + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125;
}
void main() {
  vec3 c = down13(vUv);
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  o = vec4(c * w, 1.0);
}`;

  const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 o;
vec3 tap(vec2 uv) { return texture(uSrc, uv).rgb; }
void main() {
  vec2 t = uTexel;
  vec3 a = tap(vUv + t * vec2(-2, -2)), b = tap(vUv + t * vec2(0, -2)), c = tap(vUv + t * vec2(2, -2));
  vec3 d = tap(vUv + t * vec2(-1, -1)), e = tap(vUv + t * vec2(1, -1));
  vec3 f = tap(vUv + t * vec2(-2, 0)), g = tap(vUv), h = tap(vUv + t * vec2(2, 0));
  vec3 i = tap(vUv + t * vec2(-1, 1)), j = tap(vUv + t * vec2(1, 1));
  vec3 k = tap(vUv + t * vec2(-2, 2)), l = tap(vUv + t * vec2(0, 2)), m = tap(vUv + t * vec2(2, 2));
  o = vec4((d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125 + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125, 1.0);
}`;

  /* Sur-échantillonnage tente 3×3, additif avec le niveau courant */
  const FS_UP = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc, uAdd;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 o;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(uSrc, vUv + t * vec2(-1, -1)).rgb + texture(uSrc, vUv + t * vec2(1, -1)).rgb + texture(uSrc, vUv + t * vec2(-1, 1)).rgb + texture(uSrc, vUv + t * vec2(1, 1)).rgb;
  s += 2.0 * (texture(uSrc, vUv + t * vec2(0, -1)).rgb + texture(uSrc, vUv + t * vec2(-1, 0)).rgb + texture(uSrc, vUv + t * vec2(1, 0)).rgb + texture(uSrc, vUv + t * vec2(0, 1)).rgb);
  s += 4.0 * texture(uSrc, vUv).rgb;
  o = vec4(s / 16.0 + texture(uAdd, vUv).rgb, 1.0);
}`;

  /* Rayons crépusculaires : flou radial vers le soleil (2 passes = 144 échantillons effectifs) */
  const FS_RAYS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uSunUv;
uniform float uLen, uDecay;
out vec4 o;
void main() {
  vec2 d = (uSunUv - vUv) * uLen / 12.0;
  vec3 s = vec3(0.0);
  float w = 1.0, tw = 0.0;
  vec2 uv = vUv;
  for (int i = 0; i < 12; i++) {
    s += min(texture(uSrc, uv).rgb, vec3(1.6)) * w;              // masque, pas énergie : les rayons restent des rayons
    tw += w;
    w *= uDecay;
    uv += d;
  }
  o = vec4(s / tw, 1.0);
}`;

  /* Traînée anamorphique : flou horizontal (2 passes) */
  const FS_STREAK = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uStep;
out vec4 o;
void main() {
  vec3 s = vec3(0.0);
  float tw = 0.0;
  for (int i = -8; i <= 8; i++) {
    float w = exp(-float(i * i) / 22.0);
    s += min(texture(uSrc, vUv + vec2(float(i) * uTexel.x * uStep, 0.0)).rgb, vec3(5.0)) * w;
    tw += w;
  }
  o = vec4(s / tw * vec3(0.92, 0.96, 1.0), 1.0);
}`;

  /* Composition : exposition, bloom, rayons, traînée, ACES, argent, vignette, grain, tramage */
  const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene, uBloom, uRays, uStreak;
uniform float uExpo, uBloomK, uRaysK, uStreakK, uTint, uFade, uIntro;
uniform int uFrame;
out vec4 o;
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 rnd3(ivec3 c) { return vec3(pcg3d(uvec3(c))) * (1.0 / 4294967295.0); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 c = texture(uScene, vUv).rgb * uExpo;
  c += texture(uBloom, vUv).rgb * uBloomK;
  c += texture(uRays, vUv).rgb * uRaysK;
  c += texture(uStreak, vUv).rgb * uStreakK;
  // « argent » : on garde la structure spectrale, on retire presque toute la couleur
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uTint);
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  vec2 v = (vUv * 2.0 - 1.0) * vec2(0.85, 0.62);
  c *= 1.0 - 0.32 * pow(dot(v, v), 1.35);
  c *= uIntro * (1.0 - uFade);
  vec3 r = rnd3(ivec3(ivec2(gl_FragCoord.xy), uFrame));
  c += (r.x + r.y - 1.0) / 255.0;                                 // tramage triangulaire : zéro bande
  c += (r.z - 0.5) * 0.011 * (1.0 - c) * uIntro;                 // grain argentique
  o = vec4(max(c, 0.0), 1.0);
}`;

  /* ══════════════════════════════════════════════════════════════════════════════
     DOM
     ══════════════════════════════════════════════════════════════════════════════ */
  const host = document.getElementById('aube');
  const glCanvas = document.getElementById('aube-gl');
  const vCanvas = document.getElementById('aube-vec');
  if (!host || !glCanvas || !vCanvas) return;
  const vctx = vCanvas.getContext('2d');
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ── WebGL2 ─────────────────────────────────────────────────────────────────── */
  let gl = null;
  let glOK = false;
  let software = false;
  let hdr = false;
  let P = {}; // programmes
  let tex = {}; // textures cuites
  let fb = {}; // cibles de rendu
  let timer = null; // EXT_disjoint_timer_query_webgl2
  let tier = 1;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('AUBE shader: ' + log);
    }
    return s;
  }
  function program(fs, uniforms) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('AUBE link: ' + gl.getProgramInfoLog(p));
    const u = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }
  function texture(w, h, float, wrapS) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h, float) {
    const t = texture(w, h, float);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error('AUBE fbo');
    return { t, f, w, h };
  }
  function destroy(rt) {
    if (!rt) return;
    gl.deleteFramebuffer(rt.f);
    gl.deleteTexture(rt.t);
  }
  function bake(fs, w, h, mip, float) {
    const pr = program(fs, ['uSize']);
    const rt = target(w, h, !!float);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.f);
    gl.viewport(0, 0, w, h);
    gl.useProgram(pr.p);
    gl.uniform2f(pr.u.uSize, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(rt.f);
    gl.deleteProgram(pr.p);
    gl.bindTexture(gl.TEXTURE_2D, rt.t);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    return rt.t;
  }

  function initGL() {
    try {
      gl = glCanvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'default' });
      if (!gl) return false;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
      hdr = !!gl.getExtension('EXT_color_buffer_float');
      if (hdr) gl.getExtension('OES_texture_float_linear');
      timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const bw = software ? CFG.bake / 2 : CFG.bake;
      tex.map = bake(FS_EARTH, bw, bw / 2, true);
      tex.sky = bake(FS_SKY, bw / 2, bw / 4, true);
      tex.trans = bake(FS_TRANS, 256, 128, false, hdr); // 16 bits : le crépuscule profond garde ses nuances
      P.scene = program(FS_SCENE, ['uRes', 'uPx', 'uTime', 'uCamPos', 'uCamR', 'uCamU', 'uCamF', 'uTanH', 'uAspect', 'uSun', 'uMoon', 'uSunAng', 'uSunVis', 'uEarth', 'uCloud', 'uCirrus', 'uVec', 'uZoom', 'uCity', 'uStars', 'uZc', 'uMap', 'uSky', 'uTrans']);
      P.pre = program(FS_PREFILTER, ['uSrc', 'uTexel', 'uThreshold', 'uKnee', 'uExpo']);
      P.down = program(FS_DOWN, ['uSrc', 'uTexel']);
      P.up = program(FS_UP, ['uSrc', 'uAdd', 'uTexel', 'uRadius']);
      P.rays = program(FS_RAYS, ['uSrc', 'uSunUv', 'uLen', 'uDecay']);
      P.streak = program(FS_STREAK, ['uSrc', 'uTexel', 'uStep']);
      P.comp = program(FS_COMPOSITE, ['uScene', 'uBloom', 'uRays', 'uStreak', 'uExpo', 'uBloomK', 'uRaysK', 'uStreakK', 'uTint', 'uFade', 'uIntro', 'uFrame']);
      tier = software ? 3 : 1;
      return true;
    } catch (e) {
      console.warn(e);
      gl = null;
      return false;
    }
  }

  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    glOK = false;
  });
  glCanvas.addEventListener('webglcontextrestored', () => {
    fb = {};
    glOK = initGL();
    resize();
  });

  /* ── Tailles, cibles, qualité ───────────────────────────────────────────────── */
  let W = 0;
  let H = 0;
  let dpr = 1;
  let gScale = 1;
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(CFG.maxScale, window.devicePixelRatio || 1);
    vCanvas.width = Math.round(W * dpr);
    vCanvas.height = Math.round(H * dpr);
    applyTier();
  }
  function applyTier() {
    if (!gl) return;
    const tr = TIERS[tier];
    gScale = Math.min(dpr * tr.scale, CFG.maxScale);
    const w = Math.max(2, Math.round(W * gScale));
    const h = Math.max(2, Math.round(H * gScale));
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
    }
    if (fb.scene && fb.scene.w === w && fb.scene.h === h) return;
    for (const k of Object.keys(fb)) {
      if (Array.isArray(fb[k])) fb[k].forEach(destroy);
      else destroy(fb[k]);
    }
    fb = {};
    fb.scene = target(w, h, hdr);
    const hw = Math.max(1, w >> 1);
    const hh = Math.max(1, h >> 1);
    fb.pre = target(hw, hh, hdr);
    fb.chain = [];
    fb.chainUp = [];
    for (let i = 0, cw = hw >> 1, ch = hh >> 1; i < 3; i++, cw = Math.max(1, cw >> 1), ch = Math.max(1, ch >> 1)) {
      fb.chain.push(target(cw, ch, hdr));
      fb.chainUp.push(target(cw, ch, hdr));
    }
    fb.bloom = target(hw, hh, hdr);
    fb.raysA = target(hw, hh, hdr);
    fb.raysB = target(hw, hh, hdr);
    fb.streakA = target(Math.max(1, hw >> 1), Math.max(1, hh >> 1), hdr);
    fb.streakB = target(Math.max(1, hw >> 1), Math.max(1, hh >> 1), hdr);
  }

  // Régulateur : descend d'un palier si l'image dépasse le budget (mesure GPU si dispo,
  // sinon cadence rAF), remonte seulement sur une mesure GPU franche et stable.
  const ft = [];
  let gpuMs = 0;
  let lockUntil = 0;
  let queries = [];
  function govern(dt, now) {
    if (dt > 100 || launchAt >= 0) return;
    ft.push(dt);
    if (ft.length > 45) ft.shift();
    if (ft.length < 45 || now < lockUntil) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    if ((avg > 23 || gpuMs > 14) && tier < TIERS.length - 1) {
      tier++;
      applyTier();
      ft.length = 0;
      lockUntil = now + 3000;
    } else if (timer && gpuMs > 0 && gpuMs < 5.5 && tier > 0 && now - t0 > 6000) {
      tier--;
      applyTier();
      ft.length = 0;
      lockUntil = now + 8000;
    }
  }
  function gpuBegin() {
    if (!timer || queries.length > 4) return;
    const q = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
    queries.push(q);
    return q;
  }
  function gpuEnd(q) {
    if (!q) return;
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    // récolte différée des mesures disponibles
    while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const done = queries.shift();
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6;
        gpuMs = gpuMs ? gpuMs * 0.9 + ms * 0.1 : ms;
      }
      gl.deleteQuery(done);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════════
     SCÈNE : caméra, soleil, Terre
     ══════════════════════════════════════════════════════════════════════════════ */
  const t0 = performance.now();
  let launchAt = -1;
  let handoffAt = -1;
  let core = null;
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  let expoSmooth = -1;

  function sunH(ti) {
    const u = clamp01((ti - CFG.riseStart) / CFG.riseDur);
    let h = lerp(CFG.hStart, CFG.hEnd, easeInOutS(u));
    const past = ti - CFG.riseStart - CFG.riseDur;
    if (past > 0) h += Math.min(CFG.hDriftMax, (CFG.hDrift * past) / 1000);
    return h;
  }

  function scene(now, dt) {
    const ti = now - t0;
    const lk = launchAt < 0 ? -1 : now - launchAt;
    let h = sunH(ti);
    let fov = CFG.fov;
    let pitchUp = 0;
    let spinBoost = 0;
    let vecK = 0;
    let zoom = 0;
    let fade = 0;
    let expoK = 1;
    let city = 1;
    if (lk >= 0) {
      const a = win(lk, 0, 900);
      h = core.h0 + (Math.max(core.h0, 0.6) + 3.2 - core.h0) * easeOut(a);
      fov = lerp(CFG.fov, CFG.fov - 9, easeInOut(win(lk, 0, 1150)));
      pitchUp = 4.5 * easeInOut(win(lk, 0, 1100));
      spinBoost = 0.9 * easeIn(win(lk, 0, 1300));
      vecK = easeInOut(win(lk, 250, 900));
      zoom = 2.2 * easeIn(win(lk, 420, CFG.pre));
      fade = easeInOut(win(lk, 380, 1250));
      expoK = (1 + 0.35 * Math.sin(Math.PI * win(lk, 120, 700))) * (1 - 0.5 * easeIn(win(lk, 500, 1100)));
      city = 1 + 2.4 * Math.sin(Math.PI * win(lk, 60, 520));
    }
    const hR = h * DEG;
    const dip = Math.acos(1 / (1 + CFG.alt));
    const tanH = Math.tan((fov * DEG) / 2);
    const ndcH = 1 - (2 * CFG.limbY) / H;
    const drift = Math.sin(ti / 41000) * 0.35 * DEG;
    const yaw = drift + ptr.x * 0.45 * DEG;
    const pitch = dip + Math.atan(ndcH * Math.tan((CFG.fov * DEG) / 2)) - pitchUp * DEG + ptr.y * 0.3 * DEG;
    const F = [-Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)];
    const R = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const Up = cross(R, F);
    const pos = [0, 1 + CFG.alt + Math.sin(ti / 17000) * 0.0015, 0];
    const el = hR - dip;
    const az = CFG.sunAz * DEG;
    const sun = [-Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
    const mel = CFG.moonEl * DEG - dip * 0.0;
    const maz = CFG.moonAz * DEG;
    const moon = [-Math.cos(mel) * Math.sin(maz), Math.sin(mel), -Math.cos(mel) * Math.cos(maz)];
    const sunAng = CFG.sunRadius * DEG;
    const sunVis = sstep(-sunAng, sunAng, hR);
    const spin = CFG.earthYaw + (ti / 1000) * CFG.spin + spinBoost;
    const E = mmul(mmul(rx(CFG.earthTilt), rz(CFG.axialTilt)), ry(spin));
    // exposition : adaptation avec retard (l'œil, la caméra)
    const expoTarget = Math.exp(lerp(Math.log(CFG.expoNight), Math.log(CFG.expoDay), sstep(-4.5, 1.5, h))) * expoK;
    if (expoSmooth < 0 || dt <= 0) expoSmooth = expoTarget;
    else expoSmooth += (expoTarget - expoSmooth) * (1 - Math.exp(-dt / (lk >= 0 ? 90 : 700)));
    const stars = (1 - 0.8 * sstep(-3.5, 1.5, h)) * (lk >= 0 ? 1 - easeIn(win(lk, 0, 700)) : 1);
    const zc = core ? [(core.cx / W) * 2 - 1, 1 - (core.cy / H) * 2] : [0, 0];
    return { ti, lk, h, sun, moon, sunVis, sunAng, pos, F, R, Up, tanH, E, expo: expoSmooth, vecK, zoom, fade, city, stars, zc, cloud: (ti / 1000) * CFG.cloudDrift + 0.13, cirrus: (ti / 1000) * CFG.cirrusDrift + 0.41 };
  }

  // Projection monde → px CSS (identique au shader, zoom de lancement compris)
  function project(S, Pw) {
    const v = [Pw[0] - S.pos[0], Pw[1] - S.pos[1], Pw[2] - S.pos[2]];
    const z = dot(v, S.F);
    if (z <= 1e-4) return null;
    let nx = dot(v, S.R) / (z * S.tanH * (W / H));
    let ny = dot(v, S.Up) / (z * S.tanH);
    nx = S.zc[0] + (nx - S.zc[0]) * (1 + S.zoom);
    ny = S.zc[1] + (ny - S.zc[1]) * (1 + S.zoom);
    return [((nx + 1) / 2) * W, ((1 - ny) / 2) * H];
  }

  /* ══════════════════════════════════════════════════════════════════════════════
     RENDU GL — passes
     ══════════════════════════════════════════════════════════════════════════════ */
  let frame = 0;
  function bind(rt) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt ? rt.f : null);
    gl.viewport(0, 0, rt ? rt.w : glCanvas.width, rt ? rt.h : glCanvas.height);
  }
  function use(pr, textures) {
    gl.useProgram(pr.p);
    textures.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(pr.u[name], i);
    });
  }
  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

  function drawGL(S, now) {
    if (!glOK) return;
    const tr = TIERS[tier];
    const q = gpuBegin();
    /* 1 · scène HDR */
    bind(fb.scene);
    use(P.scene, [
      ['uMap', tex.map],
      ['uSky', tex.sky],
      ['uTrans', tex.trans],
    ]);
    const u = P.scene.u;
    gl.uniform2f(u.uRes, fb.scene.w, fb.scene.h);
    gl.uniform1f(u.uPx, fb.scene.h / H);
    gl.uniform1f(u.uTime, (now - t0) / 1000);
    gl.uniform3fv(u.uCamPos, S.pos);
    gl.uniform3fv(u.uCamR, S.R);
    gl.uniform3fv(u.uCamU, S.Up);
    gl.uniform3fv(u.uCamF, S.F);
    gl.uniform1f(u.uTanH, S.tanH);
    gl.uniform1f(u.uAspect, W / H);
    gl.uniform3fv(u.uSun, S.sun);
    gl.uniform3fv(u.uMoon, S.moon);
    gl.uniform1f(u.uSunAng, S.sunAng);
    gl.uniform1f(u.uSunVis, S.sunVis);
    gl.uniformMatrix3fv(u.uEarth, false, colMajor(mT(S.E)));
    gl.uniform1f(u.uCloud, S.cloud);
    gl.uniform1f(u.uCirrus, S.cirrus);
    gl.uniform1f(u.uVec, S.vecK);
    gl.uniform1f(u.uZoom, S.zoom);
    gl.uniform1f(u.uCity, S.city);
    gl.uniform1f(u.uStars, S.stars);
    gl.uniform2f(u.uZc, S.zc[0], S.zc[1]);
    draw();
    /* 2 · bloom : préfiltre 1/2, chaîne 1/4 → 1/16, remontée tente */
    bind(fb.pre);
    use(P.pre, [['uSrc', fb.scene.t]]);
    gl.uniform2f(P.pre.u.uTexel, 1 / fb.scene.w, 1 / fb.scene.h);
    gl.uniform1f(P.pre.u.uThreshold, 1.0);
    gl.uniform1f(P.pre.u.uKnee, 0.6);
    gl.uniform1f(P.pre.u.uExpo, S.expo);
    draw();
    let src = fb.pre;
    for (let i = 0; i < fb.chain.length; i++) {
      bind(fb.chain[i]);
      use(P.down, [['uSrc', src.t]]);
      gl.uniform2f(P.down.u.uTexel, 1 / src.w, 1 / src.h);
      draw();
      src = fb.chain[i];
    }
    let up = fb.chain[fb.chain.length - 1];
    for (let i = fb.chain.length - 2; i >= 0; i--) {
      bind(fb.chainUp[i]);
      use(P.up, [
        ['uSrc', up.t],
        ['uAdd', fb.chain[i].t],
      ]);
      gl.uniform2f(P.up.u.uTexel, 1 / up.w, 1 / up.h);
      gl.uniform1f(P.up.u.uRadius, 1.0);
      draw();
      up = fb.chainUp[i];
    }
    bind(fb.bloom);
    use(P.up, [
      ['uSrc', up.t],
      ['uAdd', fb.pre.t],
    ]);
    gl.uniform2f(P.up.u.uTexel, 1 / up.w, 1 / up.h);
    gl.uniform1f(P.up.u.uRadius, 1.0);
    draw();
    /* 3 · rayons crépusculaires */
    let raysT = null;
    if (tr.rays && S.fade < 0.98) {
      const sunScr = project(S, [S.pos[0] + S.sun[0] * 50, S.pos[1] + S.sun[1] * 50, S.pos[2] + S.sun[2] * 50]);
      const su = sunScr ? [sunScr[0] / W, 1 - sunScr[1] / H] : [0.5, 0.3];
      const len = 0.9 * S.sunVis + 0.25;
      bind(fb.raysA);
      use(P.rays, [['uSrc', fb.pre.t]]);
      gl.uniform2f(P.rays.u.uSunUv, su[0], su[1]);
      gl.uniform1f(P.rays.u.uLen, len * 0.35);
      gl.uniform1f(P.rays.u.uDecay, 0.93);
      draw();
      bind(fb.raysB);
      use(P.rays, [['uSrc', fb.raysA.t]]);
      gl.uniform2f(P.rays.u.uSunUv, su[0], su[1]);
      gl.uniform1f(P.rays.u.uLen, len);
      gl.uniform1f(P.rays.u.uDecay, 0.9);
      draw();
      raysT = fb.raysB.t;
    }
    /* 4 · traînée anamorphique */
    let streakT = null;
    if (tr.streak) {
      bind(fb.streakA);
      use(P.streak, [['uSrc', fb.chain[0].t]]);
      gl.uniform2f(P.streak.u.uTexel, 1 / fb.chain[0].w, 1 / fb.chain[0].h);
      gl.uniform1f(P.streak.u.uStep, 1.0);
      draw();
      bind(fb.streakB);
      use(P.streak, [['uSrc', fb.streakA.t]]);
      gl.uniform2f(P.streak.u.uTexel, 1 / fb.streakA.w, 1 / fb.streakA.h);
      gl.uniform1f(P.streak.u.uStep, 3.0);
      draw();
      streakT = fb.streakB.t;
    }
    /* 5 · composition */
    bind(null);
    use(P.comp, [
      ['uScene', fb.scene.t],
      ['uBloom', fb.bloom.t],
      ['uRays', raysT || fb.bloom.t],
      ['uStreak', streakT || fb.bloom.t],
    ]);
    gl.uniform1f(P.comp.u.uExpo, S.expo);
    gl.uniform1f(P.comp.u.uBloomK, CFG.bloom);
    gl.uniform1f(P.comp.u.uRaysK, raysT ? CFG.rays : 0);
    gl.uniform1f(P.comp.u.uStreakK, streakT ? CFG.streak : 0);
    gl.uniform1f(P.comp.u.uTint, CFG.tint);
    gl.uniform1f(P.comp.u.uFade, S.fade);
    gl.uniform1f(P.comp.u.uIntro, easeOut(clamp01(S.ti / 1600)));
    gl.uniform1i(P.comp.u.uFrame, frame++ & 1023);
    draw();
    gpuEnd(q);
  }

  /* ══════════════════════════════════════════════════════════════════════════════
     CALQUE VECTORIEL
     ══════════════════════════════════════════════════════════════════════════════ */
  const GRAT = [];
  (function buildGraticule() {
    const toP = (lat, lon) => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    for (let la = -75; la <= 75; la += 15) {
      const pts = [];
      for (let lo = 0; lo <= 360; lo += 3) pts.push(toP(la * DEG, lo * DEG));
      GRAT.push({ pts, kind: 0, key: la });
    }
    for (let lo = 0; lo < 360; lo += 15) {
      const pts = [];
      for (let la = -84; la <= 84; la += 3) pts.push(toP(la * DEG, lo * DEG));
      GRAT.push({ pts, kind: 1, key: lo });
    }
  })();

  seed = 0x5153;
  const MOTES = Array.from({ length: 34 }, () => ({ x: rnd(), y: rnd(), z: 0.15 + rnd() * 0.85, s: rnd(), ph: rnd() * 6.283, vx: (rnd() - 0.5) * 0.004, vy: (rnd() - 0.5) * 0.003 }));

  const px = () => 1 / dpr;
  const snap = (v) => (Math.round(v * dpr) + 0.5) / dpr;

  function limbCurve(S) {
    const dip = Math.acos(1 / S.pos[1]);
    const dist = Math.sqrt(S.pos[1] * S.pos[1] - 1);
    const pts = [];
    for (let i = -60; i <= 60; i++) {
      const phi = (i / 60) * 1.05;
      const d = [Math.sin(phi) * Math.cos(dip), -Math.sin(dip), -Math.cos(phi) * Math.cos(dip)];
      const q = project(S, [S.pos[0] + d[0] * dist, S.pos[1] + d[1] * dist, S.pos[2] + d[2] * dist]);
      if (q) pts.push(q);
    }
    return pts;
  }

  // Segments classés par alpha ET par épaisseur : des milliers de traits en quelques appels
  const LEVELS = 10;
  const WIDTHS = [0.6, 1.0, 1.5];
  function makeBuckets() {
    return WIDTHS.map(() => Array.from({ length: LEVELS }, () => new Path2D()));
  }
  function strokeBuckets(buckets, maxA, rgb) {
    for (let w = 0; w < WIDTHS.length; w++) {
      vctx.lineWidth = px() * WIDTHS[w];
      for (let i = 0; i < LEVELS; i++) {
        const a = ((i + 1) / LEVELS) * maxA;
        if (a <= 0.003) continue;
        vctx.strokeStyle = `rgba(${rgb},${a.toFixed(4)})`;
        vctx.stroke(buckets[w][i]);
      }
    }
  }
  const bucketOf = (a) => Math.min(LEVELS - 1, Math.max(0, Math.round(a * LEVELS) - 1));
  const widthOf = (z) => (z > 0.45 ? 2 : z > -0.2 ? 1 : 0);

  function coreRot(tc) {
    const spin = tc * 0.0021 - Math.exp(-tc / 700) * 2.2;
    return mmul(mmul(rx(-0.42), rz(0.24)), ry(spin));
  }
  function coreProj(Mc, p, sq, sx) {
    const q = mvec(Mc, p);
    const k = 1 / (1 - q[2] * 0.16);
    const r = CFG.coreR * k;
    return [core.cx + q[0] * r * sx, core.cy - q[1] * r * sq, q[2]];
  }

  function drawVector(S, now) {
    const ctx = vctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    const intro = easeOut(clamp01((S.ti - 350) / 1500));
    const lk = S.lk;
    const coreK = lk < 0 ? 0 : lk;
    const sunScr = project(S, [S.pos[0] + S.sun[0] * 50, S.pos[1] + S.sun[1] * 50, S.pos[2] + S.sun[2] * 50]);
    const dawn = sstep(-5, 0.5, S.h);
    const sceneA = 1 - S.fade;

    /* ── Poussières en profondeur de champ ── */
    if (sceneA > 0.01) {
      for (const m of MOTES) {
        let x = ((m.x + m.vx * (S.ti / 1000) + 10) % 1) * W + ptr.x * 14 * m.z;
        let y = ((m.y + m.vy * (S.ti / 1000) + 10) % 1) * H + ptr.y * 10 * m.z;
        if (lk >= 0 && core) {
          const k = easeIn(win(lk, 0, 1100)) * (0.6 + m.z * 1.6);
          x = core.cx + (x - core.cx) * (1 + k * 2.5);
          y = core.cy + (y - core.cy) * (1 + k * 2.5);
        }
        const light = 0.25 + 0.75 * dawn;
        const r = 0.6 + m.z * m.z * 7;
        const a = (0.012 + 0.05 * (1 - m.z) + 0.02 * Math.sin(S.ti / 1900 + m.ph)) * light * intro * sceneA;
        if (a <= 0.002) continue;
        if (r < 1.6) {
          ctx.fillStyle = `rgba(255,255,255,${(a * 3).toFixed(3)})`;
          ctx.fillRect(snap(x) - px() / 2, snap(y) - px() / 2, px(), px());
        } else {
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(255,255,255,${(a * 0.5).toFixed(4)})`);
          g.addColorStop(0.82, `rgba(255,255,255,${(a * 0.7).toFixed(4)})`);
          g.addColorStop(0.92, `rgba(255,255,255,${a.toFixed(4)})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    /* ── Limbe gradué ── */
    const limb = limbCurve(S);
    if (limb.length > 2 && sceneA > 0.01) {
      const sx = sunScr ? sunScr[0] : W / 2;
      const g = ctx.createLinearGradient(0, 0, W, 0);
      const base = 0.07 * intro;
      const hot = (0.1 + 0.55 * dawn) * intro;
      const c = clamp01(sx / W);
      g.addColorStop(0, `rgba(255,255,255,${base})`);
      g.addColorStop(Math.max(0, c - 0.28), `rgba(255,255,255,${base})`);
      g.addColorStop(c, `rgba(255,255,255,${hot})`);
      g.addColorStop(Math.min(1, c + 0.28), `rgba(255,255,255,${base})`);
      g.addColorStop(1, `rgba(255,255,255,${base})`);
      ctx.globalAlpha = sceneA;
      ctx.strokeStyle = g;
      ctx.lineWidth = px();
      ctx.beginPath();
      ctx.moveTo(limb[0][0], limb[0][1]);
      for (let i = 1; i < limb.length; i++) ctx.lineTo(limb[i][0], limb[i][1]);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${(0.1 * intro).toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i < limb.length - 1; i += 2) {
        const [x, y] = limb[i];
        const [x2, y2] = limb[Math.min(limb.length - 1, i + 1)];
        const nx = y2 - y;
        const ny = -(x2 - x);
        const l = Math.hypot(nx, ny) || 1;
        const len = (i - 60) % 10 === 0 ? 5 : 2;
        ctx.moveTo(x, y);
        ctx.lineTo(x + (nx / l) * len, y + (ny / l) * len);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* ── Graticule terrestre → cœur ── */
    const Mc = core ? coreRot(coreK) : null;
    let sq = 1;
    let sx = 1;
    let coreA = 0;
    if (core) {
      coreA = easeOut(win(lk, 700, 1250));
      if (handoffAt >= 0) {
        const tc = now - handoffAt;
        coreA *= lerp(1, 0.55, easeInOut(win(tc, 0, T_RING)));
        sq = 1 - easeInOut(win(tc, T_COLLAPSE, T_COLLAPSE + 280));
        sx = 1 - easeInOut(win(tc, T_COLLAPSE + 120, T_LED));
        if (tc > T_LED) coreA = 0;
      }
    }
    const buckets = makeBuckets();
    const halo = makeBuckets();
    const Ew = S.E;
    let waveR = -1;
    if (lk >= 0) waveR = easeOut(win(lk, 120, 760)) * 520;
    const gratIdle = 0.075 * intro;
    for (let li = 0; li < GRAT.length; li++) {
      const L = GRAT[li];
      const stag = L.kind === 1 ? (Math.abs(((L.key + 180) % 360) - 180) / 180) * 260 : (Math.abs(L.key) / 75) * 200;
      const mk = core ? easeInOut(win(lk, 450 + stag, 450 + stag + 560)) : 0;
      let prev = null;
      for (let i = 0; i < L.pts.length; i++) {
        const pe = L.pts[i];
        let x = 0;
        let y = 0;
        let a = 0;
        let z = -1;
        const Pw = mvec(Ew, pe);
        const toCam = [S.pos[0] - Pw[0], S.pos[1] - Pw[1], S.pos[2] - Pw[2]];
        const facing = dot(Pw, toCam) / (Math.hypot(toCam[0], toCam[1], toCam[2]) || 1);
        const q = mk < 1 ? project(S, Pw) : null;
        let ae = 0;
        if (q && facing > 0) {
          ae = gratIdle * sstep(0, 0.35, facing);
          if (waveR > 0 && sunScr) {
            const d = Math.hypot(q[0] - sunScr[0], q[1] - sunScr[1]);
            const front = Math.exp(-Math.pow((d - waveR) / 28, 2));
            ae = Math.max(ae, (0.12 + 0.5 * front) * sstep(0, 0.2, facing) * (d < waveR ? 1 : front));
          }
          ae *= sceneA;
        }
        if (core && mk > 0) {
          const c = coreProj(Mc, pe, sq, sx);
          z = c[2];
          const ac = coreA * (z > 0 ? 0.5 : 0.14) + (1 - coreA) * 0.35 * Math.sin(Math.PI * mk);
          if (q && facing > 0) {
            x = lerp(q[0], c[0], mk);
            y = lerp(q[1], c[1], mk);
            a = lerp(ae, ac, mk);
          } else {
            x = c[0];
            y = c[1];
            a = ac * mk;
          }
        } else if (q) {
          x = q[0];
          y = q[1];
          a = ae;
        } else {
          prev = null;
          continue;
        }
        if (prev && (a > 0.003 || prev[2] > 0.003)) {
          const am = (a + prev[2]) / 2;
          const wi = mk > 0.5 ? widthOf(z) : 1;
          const b = buckets[wi][bucketOf(am / 0.6)];
          b.moveTo(prev[0], prev[1]);
          b.lineTo(x, y);
          if (mk > 0.5 && z > 0.2) {
            const hb = halo[2][bucketOf((am * 0.35) / 0.6)];
            hb.moveTo(prev[0], prev[1]);
            hb.lineTo(x, y);
          }
        }
        prev = [x, y, a];
      }
    }
    // halo doux d'abord (trait large, faible), puis les filets nets
    vctx.lineWidth = px() * 3;
    for (let i = 0; i < LEVELS; i++) {
      const a = ((i + 1) / LEVELS) * 0.6 * 0.22;
      if (a <= 0.003) continue;
      vctx.strokeStyle = `rgba(255,255,255,${a.toFixed(4)})`;
      vctx.stroke(halo[2][i]);
    }
    strokeBuckets(buckets, 0.6, '255,255,255');

    /* ── Réticule solaire + télémétrie ── */
    if (sunScr && sceneA > 0.01) {
      const [x, y] = sunScr;
      const a = 0.32 * intro * sceneA * (lk >= 0 ? 1 - win(lk, 0, 260) : 1);
      const B = 7;
      const o = 11;
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.lineWidth = px();
      ctx.beginPath();
      for (const [sx2, sy2] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const cx = snap(x + sx2 * o);
        const cy = snap(y + sy2 * o);
        ctx.moveTo(cx, cy - sy2 * B);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx - sx2 * B, cy);
      }
      ctx.stroke();
      ctx.font = '500 9px "JetBrains Mono Variable", "Cascadia Mono", Consolas, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255,255,255,${(a * 0.9).toFixed(3)})`;
      const hs = (S.h >= 0 ? '+' : '−') + Math.abs(S.h).toFixed(2).padStart(5, '0');
      ctx.fillText('SOL', snap(x + o + 8), snap(y - 5));
      ctx.fillStyle = `rgba(255,255,255,${(a * 0.6).toFixed(3)})`;
      ctx.fillText('EL ' + hs + '°', snap(x + o + 8), snap(y + 6));
    }

    /* ── Aigrettes de diffraction (les halos viennent du bloom) ── */
    if (sunScr && S.sunVis > 0.001 && sceneA > 0.01) {
      const [x, y] = sunScr;
      const k = S.sunVis * sceneA * (lk >= 0 ? 1 + 1.2 * Math.sin(Math.PI * win(lk, 100, 900)) : 1);
      const rot = (S.ti / 60000) * 0.3;
      for (let i = 0; i < 12; i++) {
        const ang = rot + (i * Math.PI) / 6;
        const main = i % 3 === 0;
        const len = (main ? 96 : 34) * k * (0.85 + 0.15 * Math.sin(S.ti / 700 + i));
        const ex = x + Math.cos(ang) * len;
        const ey = y + Math.sin(ang) * len;
        const g = ctx.createLinearGradient(x, y, ex, ey);
        g.addColorStop(0, `rgba(255,255,255,${((main ? 0.5 : 0.2) * k).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = px();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      for (const [t, r, a] of [
        [-0.55, 9, 0.05],
        [-1.1, 22, 0.035],
        [-1.6, 5, 0.06],
      ]) {
        const gx = W / 2 + (x - W / 2) * t;
        const gy = H / 2 + (y - H / 2) * t;
        ctx.strokeStyle = `rgba(255,255,255,${(a * k).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    /* ── Lancement : faisceaux convergents ── */
    if (core && lk >= 0 && lk < CFG.pre + 200) {
      ctx.lineWidth = px();
      for (const s of core.streaks) {
        const p = win(lk, s.delay, s.delay + s.dur);
        if (p <= 0 || p >= 1) continue;
        const r = s.r0 * (1 - easeIn(p));
        const rPrev = s.r0 * (1 - easeIn(Math.max(0, p - 0.06)));
        const x1 = core.cx + Math.cos(s.th) * r;
        const y1 = core.cy + Math.sin(s.th) * r;
        const x2 = core.cx + Math.cos(s.th) * rPrev;
        const y2 = core.cy + Math.sin(s.th) * rPrev;
        const a = s.a * Math.sin(Math.PI * p);
        const g = ctx.createLinearGradient(x2, y2, x1, y1);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, `rgba(255,255,255,${a.toFixed(3)})`);
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a * 1.6).toFixed(3)})`;
        ctx.fillRect(snap(x1) - px(), snap(y1) - px(), 2 * px(), 2 * px());
      }
    }

    /* ── Cœur : orbites, échelle gyroscopique, noyau ── */
    if (core && coreA > 0.001) {
      const tc = coreK;
      core.rings.forEach((rg, idx) => {
        const drawK = easeInOut(win(lk, 820 + idx * 90, 1300 + idx * 90));
        if (drawK <= 0) return;
        const bRing = makeBuckets();
        const N = 160;
        const Mr = mmul(Mc, rg.M);
        let prev = null;
        for (let i = 0; i <= N * drawK; i++) {
          const th = (i / N) * Math.PI * 2 + rg.ph;
          const p = [Math.cos(th) * rg.r, 0, Math.sin(th) * rg.r];
          const q = mvec(Mr, p);
          const k = 1 / (1 - q[2] * 0.16);
          const x = core.cx + q[0] * CFG.coreR * k * sx;
          const y = core.cy - q[1] * CFG.coreR * k * sq;
          const a = coreA * (q[2] > 0 ? 0.55 : 0.16);
          if (prev) {
            const b = bRing[widthOf(q[2] * 0.6)][bucketOf(a / 0.6)];
            b.moveTo(prev[0], prev[1]);
            b.lineTo(x, y);
          }
          prev = [x, y];
        }
        strokeBuckets(bRing, 0.6, '255,255,255');
        if (drawK >= 1) {
          const th0 = tc * rg.w + rg.ph;
          for (let j = 0; j < 14; j++) {
            const th = th0 - j * 0.045;
            const q = mvec(Mr, [Math.cos(th) * rg.r, 0, Math.sin(th) * rg.r]);
            const k = 1 / (1 - q[2] * 0.16);
            const x = core.cx + q[0] * CFG.coreR * k * sx;
            const y = core.cy - q[1] * CFG.coreR * k * sq;
            const a = coreA * (1 - j / 14) * (q[2] > 0 ? 0.95 : 0.3);
            ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
            const s = j === 0 ? 2 : 1;
            ctx.fillRect(snap(x) - (s * px()) / 2, snap(y) - (s * px()) / 2, s * px(), s * px());
          }
        }
      });
      // échelle gyroscopique : 96 graduations, majeures toutes les 8, index de lecture
      const gk = easeOut(win(lk, 950, 1350));
      if (gk > 0) {
        const R0 = CFG.coreR * 1.95;
        const rot = tc * 0.00018;
        ctx.strokeStyle = `rgba(255,255,255,${(0.28 * coreA * gk).toFixed(3)})`;
        ctx.lineWidth = px();
        ctx.beginPath();
        const n = Math.round(96 * gk);
        for (let i = 0; i < n; i++) {
          const th = rot + (i / 96) * Math.PI * 2;
          const len = i % 8 === 0 ? 5 : 2;
          const c = Math.cos(th);
          const s = Math.sin(th);
          ctx.moveTo(core.cx + c * R0 * sx, core.cy + s * R0 * 0.42 * sq);
          ctx.lineTo(core.cx + c * (R0 + len) * sx, core.cy + s * (R0 + len) * 0.42 * sq);
        }
        ctx.stroke();
        // index : deux repères fixes en haut et en bas de l'échelle
        ctx.strokeStyle = `rgba(255,255,255,${(0.6 * coreA * gk).toFixed(3)})`;
        ctx.beginPath();
        for (const s of [-1, 1]) {
          ctx.moveTo(snap(core.cx) - 3, core.cy + s * (R0 + 9) * 0.42 * sq);
          ctx.lineTo(snap(core.cx), core.cy + s * (R0 + 5) * 0.42 * sq);
          ctx.lineTo(snap(core.cx) + 3, core.cy + s * (R0 + 9) * 0.42 * sq);
        }
        ctx.stroke();
      }
      // noyau : deux halos et un point
      const nk = easeOut(win(lk, 900, 1300));
      if (nk > 0) {
        const pulse = 0.85 + 0.15 * Math.sin(tc / 140);
        const rr = 18 * nk * pulse;
        const g = ctx.createRadialGradient(core.cx, core.cy, 0, core.cx, core.cy, rr);
        g.addColorStop(0, `rgba(255,255,255,${(0.6 * coreA).toFixed(3)})`);
        g.addColorStop(0.18, `rgba(255,255,255,${(0.16 * coreA).toFixed(3)})`);
        g.addColorStop(0.5, `rgba(255,255,255,${(0.04 * coreA).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(core.cx - rr, core.cy - rr, rr * 2, rr * 2);
        ctx.fillStyle = `rgba(255,255,255,${coreA.toFixed(3)})`;
        ctx.fillRect(snap(core.cx) - px(), snap(core.cy) - px(), 2 * px(), 2 * px());
      }
    }

    /* ── Passage de relais à la LED du circuit ── */
    if (core && handoffAt >= 0) {
      const tc = now - handoffAt;
      if (tc >= T_LED - 60 && tc < T_LED + 520) {
        const p = win(tc, T_LED - 60, T_LED + 520);
        const r = 6 + easeOut(p) * 150;
        ctx.strokeStyle = `rgba(255,255,255,${(0.4 * (1 - p)).toFixed(3)})`;
        ctx.lineWidth = px();
        ctx.beginPath();
        ctx.ellipse(core.cx, core.cy, r, r * 0.34, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(196,30,58,${(0.5 * (1 - p)).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(core.cx, core.cy, r * 0.62, r * 0.62 * 0.34, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /* ── Repli sans WebGL2 : la même composition, en 2D ── */
  function drawFallback(S) {
    const ctx = vctx;
    const limb = limbCurve(S);
    if (limb.length < 2) return;
    const intro = easeOut(clamp01(S.ti / 1600)) * (1 - S.fade);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    const g = ctx.createLinearGradient(0, limb[60] ? limb[60][1] : H * 0.6, 0, H);
    g.addColorStop(0, `rgba(22,22,24,${intro})`);
    g.addColorStop(1, `rgba(4,4,5,${intro})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(limb[0][0], limb[0][1]);
    for (const p of limb) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ══════════════════════════════════════════════════════════════════════════════
     BOUCLE
     ══════════════════════════════════════════════════════════════════════════════ */
  let running = false;
  let raf = 0;
  let last = 0;
  let resolveLaunch = null;

  function settle() {
    if (resolveLaunch) {
      resolveLaunch();
      resolveLaunch = null;
    }
  }

  function render(now, dt) {
    const S = scene(now, dt);
    if (glOK && S.fade < 0.999) drawGL(S, now);
    else if (glOK) {
      bind(null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    drawVector(S, now);
    if (!glOK) drawFallback(S);
    if (launchAt >= 0 && handoffAt < 0 && now - launchAt >= CFG.pre) {
      handoffAt = now;
      settle();
    }
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(); // même horloge que launch() : aucune dérive possible
    const dt = last ? now - last : 16.7;
    last = now;
    const k = 1 - Math.exp(-Math.min(dt, 64) / 420);
    ptr.x += (ptr.tx - ptr.x) * k;
    ptr.y += (ptr.ty - ptr.y) * k;
    govern(dt, now); // un redimensionnement efface le canvas : il doit précéder le dessin
    render(now, dt);
    if (handoffAt >= 0 && now - handoffAt > T_DONE + 600) stop();
  }

  function start() {
    if (running) return;
    if (reducedMotion) {
      render(t0 + CFG.riseStart + CFG.riseDur, 0);
      return;
    }
    running = true;
    last = 0;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    settle();
  }

  /** Immersion + formation du cœur. Résout quand le circuit doit prendre la main. */
  function launch() {
    if (launchAt >= 0) return Promise.resolve();
    const now = performance.now();
    const word = document.getElementById('word');
    const r = word ? word.getBoundingClientRect() : { left: W / 2 - 108, top: H * 0.44 - 27, width: 216, height: 54 };
    seed = 0x0a0b;
    core = {
      cx: Math.round(r.left + r.width / 2),
      cy: Math.round(r.top + r.height / 2),
      h0: sunH(now - t0),
      rings: [
        { r: 2.55, M: mmul(rx(1.36), rz(0.0)), ph: 0.0, w: 0.0042 },
        { r: 1.9, M: mmul(rx(1.1), rz(0.42)), ph: 2.1, w: -0.0056 },
        { r: 1.42, M: mmul(rx(1.22), rz(-0.5)), ph: 4.2, w: 0.0071 },
      ],
      streaks: Array.from({ length: 120 }, () => ({
        th: rnd() * Math.PI * 2,
        r0: 260 + rnd() * 340,
        delay: rnd() * 520,
        dur: 520 + rnd() * 420,
        a: 0.12 + rnd() * 0.4,
      })),
    };
    launchAt = now;
    if (reducedMotion) {
      handoffAt = now;
      return Promise.resolve();
    }
    if (!running) start();
    const animation = new Promise((res) => {
      resolveLaunch = res;
    });
    // Filet : si aucune image n'a résolu la promesse (fenêtre masquée), le circuit
    // reprend la main au plus tard CFG.pre + 400 ms après l'appel.
    const guard = new Promise((res) =>
      setTimeout(() => {
        if (handoffAt < 0) handoffAt = performance.now();
        settle();
        res();
      }, CFG.pre + 400),
    );
    return Promise.race([animation, guard]);
  }

  /* ── Entrées ── */
  window.addEventListener(
    'pointermove',
    (e) => {
      ptr.tx = (e.clientX / W) * 2 - 1;
      ptr.ty = (e.clientY / H) * 2 - 1;
    },
    { passive: true },
  );
  document.addEventListener('pointerleave', () => {
    ptr.tx = 0;
    ptr.ty = 0;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && launchAt < 0) stop();
    else if (!document.hidden && handoffAt < 0) start();
  });
  window.addEventListener('resize', resize);

  glOK = initGL();
  resize();
  host.classList.add(glOK ? 'gl' : 'flat');
  const api = {
    version: VERSION,
    launch,
    start,
    stop,
    isRunning: () => running,
    get handoffAt() {
      return handoffAt;
    },
    get quality() {
      return { tier: TIERS[tier].name, scale: gScale, hdr, software, gpuMs: Math.round(gpuMs * 100) / 100 };
    },
  };
  window.cantoAube = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  start();
})();
