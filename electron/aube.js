/* ═══════════════════════════════════════════════════════════════════════════════
   CΛNTO · Lanceur · AUBE II — lever de soleil orbital, cœur vectoriel
   SIΞRRΛSKΛ Lab · Artefact 002

   Deux calques, deux moteurs :
     · #aube-gl  — WebGL2, résolution physique. Terre de nuit en lancer de rayons
                   (sphère, couche nuageuse à altitude réelle avec parallaxe et ombres
                   rasantes, reflet océanique, atmosphère diffusante, lueur nocturne),
                   lumières de villes ponctuelles anticrénelées en espace écran,
                   champ d'étoiles en trois profondeurs + voie lactée, disque solaire,
                   tone-mapping filmique, grain et tramage anti-bandes.
     · #aube-vec — Canvas 2D, filets d'un pixel physique. Limbe, graticule terrestre,
                   réticule solaire, aigrettes de diffraction, poussières en profondeur
                   de champ ; au lancement : le graticule quitte la Terre et se referme
                   en CŒUR (sphère filaire, trois orbites, noyau), puis s'effondre en
                   LED sur la timeline du circuit du lanceur.

   CSP `script-src 'self'` : aucun eval, shaders compilés depuis des chaînes.
   API : window.cantoAube = { launch(): Promise<void>, start(), stop(), isRunning() }
   ═══════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Timeline du circuit (miroir exact de runTransfer() dans launcher-ui.js) ── */
  const T_RING = 560;
  const T_COLLAPSE = 1000;
  const T_LED = 1260;
  const T_DONE = 1520;

  /* ── Réglages ─────────────────────────────────────────────────────────────── */
  const CFG = {
    limbY: 390, // px CSS : apex du limbe (sous « SIΞRRΛSKΛ—LAB », au-dessus du panneau)
    alt: 0.2, // altitude caméra (rayons terrestres) : courbure du limbe
    fov: 50, // champ vertical (degrés)
    sunAz: 0, // le soleil se lève sur l'axe du réticule
    sunRadius: 0.5, // rayon angulaire du disque (degrés)
    riseStart: 1500, // ms après l'ouverture
    riseDur: 14000, // durée du lever
    hStart: -7.0, // élévation du soleil sous l'horizon au départ (degrés)
    hEnd: 1.6, // élévation atteinte à la fin du lever
    hDrift: 0.012, // montée résiduelle ensuite (degrés / s)
    hDriftMax: 1.2,
    expoNight: 1.8,
    expoDay: 0.8,
    spin: 0.0026, // rotation terrestre (rad / s)
    earthTilt: -0.92, // orientation de base : latitude survolée
    earthYaw: 5.8, // méridien initial (compose l'image d'ouverture)
    axialTilt: 0.409, // 23,4°
    cloudDrift: 0.0022, // dérive des nuages (tours / s, relative au sol)
    pre: 1350, // durée de l'immersion avant la main au circuit (ms)
    coreR: 44, // rayon du cœur (px CSS) — épouse la hauteur de l'anneau du circuit
    bake: 2048, // largeur des cartes procédurales (équirectangulaires 2:1)
    maxScale: 3, // plafond du rapport pixels GL / px CSS
  };

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
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
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
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

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

  /* Carte terrestre procédurale, calculée une fois : R côte · G population · B nuages · A relief */
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
  float metro = smoothstep(0.62, 0.9, fbm(d * 11.0 + w * 1.5, 5) * 0.5 + 0.5); // agglomérations
  float fil = pow(ridge(d * 15.0 + w * 2.2, 6), 7.0);                          // réseau routier, vallées
  float town = smoothstep(0.55, 0.85, fbm(d * 34.0, 4) * 0.5 + 0.5);
  float pop = lm * clamp(region * (metro * 1.1 + fil * 0.55 + town * fil * 0.8) + coast * fil * 0.6 * region + metro * coast * 0.4, 0.0, 1.0);
  pop *= smoothstep(0.92, 0.70, abs(d.y));
  vec3 cw = d * 1.7 + w * 0.9 + vec3(fbm(d * 3.0 + 50.0, 4), fbm(d * 3.0 + 60.0, 4), 0.0) * 0.9; // tourbillons
  float cl = fbm(cw + vec3(40.0), 8) * 0.5 + 0.5;
  cl = mix(cl, ridge(d * 6.0 + cw, 6), 0.32);
  cl = smoothstep(0.34, 0.8, cl);
  cl *= 0.72 + 0.35 * smoothstep(0.05, 0.55, abs(d.y + 0.07 * sin(atan(d.x, d.z) * 3.0)));
  float rel = fbm(d * 24.0, 6) * 0.5 + 0.5;
  o = vec4(clamp(land, 0.0, 1.0), pop, clamp(cl, 0.0, 1.0), rel);
}`;

  /* Carte du ciel : R voie lactée · G halo galactique · B bandes sombres */
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

  const FS_MAIN = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform float uPx;
uniform float uTime;
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform float uTanH, uAspect;
uniform vec3 uSun;
uniform float uSunVis, uSunAng;
uniform mat3 uEarth;
uniform float uCloud, uExpo, uVec, uZoom, uFade, uIntro, uCity, uStars;
uniform vec2 uZc;
uniform int uFrame;
uniform sampler2D uMap, uSky;
out vec4 fragColor;

const float PI = 3.14159265, TAU = 6.2831853;
const float R_CLOUD = 1.0042;
const vec3 WHITE = vec3(1.0, 0.985, 0.965);

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 rnd3(ivec3 c) { return vec3(pcg3d(uvec3(c))) * (1.0 / 4294967295.0); }

vec2 sph(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
vec2 equi(vec3 d) { return vec2(atan(d.x, d.z) / TAU + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5); }
vec4 sampleEqui(sampler2D s, vec2 uv) {
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= round(dx.x); dy.x -= round(dy.x);                  // pas de couture à la date
  return textureGrad(s, uv, dx, dy);
}

/* Couche de points : chaque cellule porte au plus une source ponctuelle, rendue en
   gaussienne dans l'espace ÉCRAN (jacobien inversé) — ronde et nette quelle que soit
   la perspective. Quand les cellules deviennent sous-pixel (limbe), l'énergie moyenne
   remplace les points : aucun scintillement parasite. */
vec3 points(vec2 q, float nx, float salt, float dens, float sig, float haloR, float haloK, float twk) {
  vec2 qx = vec2(dFdx(q.x), dFdy(q.x)); qx -= nx * round(qx / nx);
  vec2 qy = vec2(dFdx(q.y), dFdy(q.y));
  mat2 J = mat2(qx.x, qy.x, qx.y, qy.y);
  float det = abs(J[0][0] * J[1][1] - J[0][1] * J[1][0]);
  sig = max(sig, 0.55);
  // énergie moyenne des sources non résolues, bornée (l'atmosphère rasante en absorbe l'essentiel)
  float avg = min(dens * 0.14 * det * 6.2831853 * sig * sig, dens * 0.6);
  float wu = smoothstep(0.05, 0.35, det);
  if (wu >= 1.0 || dens <= 0.0) return vec3(avg * wu);
  vec2 c = floor(q);
  int cx = int(mod(c.x, nx));
  vec3 r1 = rnd3(ivec3(cx, int(c.y), int(salt)));
  if (r1.x > dens) return vec3(avg * wu);
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
  float v = (core + halo) * b;
  return vec3(mix(v, avg, wu), r2.y, 0.0);
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hgPhase(float mu, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5); }

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 ndc0 = fc / uRes * 2.0 - 1.0;
  vec2 ndc = uZc + (ndc0 - uZc) / (1.0 + uZoom);
  vec3 rd = normalize(uCamF + ndc.x * uAspect * uTanH * uCamR + ndc.y * uTanH * uCamU);
  vec3 ro = uCamPos;
  float mu = dot(rd, uSun);
  float angS = sqrt(max(2.0 * (1.0 - mu), 0.0));
  vec2 hg = sph(ro, rd, 1.0);
  vec2 hc = sph(ro, rd, R_CLOUD);
  bool ground = hg.x > 0.0;

  float tca = max(-dot(ro, rd), 0.0);
  vec3 pca = ro + rd * tca;
  float imp = length(pca);
  // l'aube naît en un arc serré autour du point de lever, puis gagne tout le limbe
  float lit = min(1.0, exp(dot(pca / imp, uSun) / 0.02));
  float hAlt = imp - 1.0;

  vec3 col = vec3(0.0);
  float pxRad = 2.0 * uTanH / uRes.y;                          // radians par pixel

  if (ground) {
    /* ───────── Terre ───────── */
    vec3 pg = ro + rd * hg.x;
    vec3 n = pg;
    vec3 ne = uEarth * n;
    vec2 uv = equi(ne);
    vec4 m = sampleEqui(uMap, uv);
    float cw = max(fwidth(m.r), 0.0035);
    float land = smoothstep(0.5 - cw, 0.5 + cw, m.r);
    float ndl = dot(n, uSun);
    float lam = max(ndl, 0.0);
    float dayK = smoothstep(-0.02, 0.06, ndl);
    vec3 alb = mix(vec3(0.020, 0.022, 0.026), vec3(0.085) + m.a * 0.075, land);

    // nuages : échantillonnés à leur altitude (parallaxe réelle près du limbe)
    vec3 pc = ro + rd * hc.x;
    vec3 nc = normalize(pc);
    vec4 mc = sampleEqui(uMap, equi(uEarth * nc) + vec2(uCloud, 0.0));
    float cd = smoothstep(0.56, 0.9, mc.b + (mc.a - 0.5) * 0.28);

    // ombre portée des nuages sous soleil rasant
    float sh = 1.0;
    if (dayK > 0.0) {
      vec3 ps = normalize(pg + uSun * min((R_CLOUD - 1.0) / max(ndl, 0.03), 0.14));
      vec4 ms = sampleEqui(uMap, equi(uEarth * ps) + vec2(uCloud, 0.0));
      sh = 1.0 - 0.85 * smoothstep(0.56, 0.9, ms.b + (ms.a - 0.5) * 0.28);
    }
    // reflet solaire sur l'océan
    vec3 hv = normalize(uSun - rd);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    float glint = pow(max(dot(n, hv), 0.0), 900.0) * 90.0 + pow(max(dot(n, hv), 0.0), 60.0) * 0.8;
    vec3 gcol = alb * lam * sh * 1.4 + WHITE * glint * fres * (1.0 - land) * sh * dayK;
    gcol += alb * 0.03;                                           // clair de lune

    // lumières : quatre profondeurs de semis, blanches, scintillement fin
    float pop = m.g;
    float night = 1.0 - smoothstep(-0.06, 0.015, ndl);
    float lx = 0.0;
    if (night > 0.0) {
      float ny;
      vec2 q;
      ny = 150.0;  q = vec2(uv.x * ny * 2.0, uv.y * ny);
      lx += points(q, ny * 2.0, 11.0, smoothstep(0.50, 0.95, pop) * 0.95, 0.85 * uPx, 3.2 * uPx, 0.10, 1.0).x * 8.0;
      ny = 380.0;  q = vec2(uv.x * ny * 2.0, uv.y * ny);
      lx += points(q, ny * 2.0, 23.0, smoothstep(0.22, 0.80, pop) * 0.75, 0.62 * uPx, 1.8 * uPx, 0.05, 0.7).x * 3.8;
      ny = 920.0;  q = vec2(uv.x * ny * 2.0, uv.y * ny);
      lx += points(q, ny * 2.0, 37.0, smoothstep(0.06, 0.55, pop) * 0.62, 0.5 * uPx, 1.0, 0.0, 0.4).x * 1.9;
      ny = 2200.0; q = vec2(uv.x * ny * 2.0, uv.y * ny);
      lx += points(q, ny * 2.0, 53.0, smoothstep(0.02, 0.35, pop) * 0.5 * land, 0.45 * uPx, 1.0, 0.0, 0.0).x * 0.8;
      lx *= night * (1.0 - 0.8 * cd);
    }
    gcol += WHITE * lx * uCity * 0.9;

    // nuages : lune, lever rasant, rétro-éclairage par les villes
    float ncl = dot(nc, uSun);
    float cLit = max(ncl + 0.025, 0.0) * 1.2 + smoothstep(-0.03, 0.02, ncl) * 0.05;
    vec3 ccol = vec3(0.86) * (cLit + 0.003) + WHITE * pop * night * 0.007 * uCity;
    col = mix(gcol, ccol, cd * 0.93);

    // perspective aérienne vers le limbe
    float aer = exp(-(1.0 - imp) / 0.012);
    col *= 1.0 - 0.55 * aer;
    col *= 1.0 - 0.88 * uVec;                                      // la Terre se dématérialise
  } else {
    /* ───────── Ciel ───────── */
    float az = atan(rd.x, -rd.z) / TAU + 0.5;
    float el = asin(clamp(rd.y, -1.0, 1.0)) / PI + 0.5;
    vec4 sk = sampleEqui(uSky, vec2(atan(rd.x, rd.z) / TAU + 0.5, el));
    float thick = exp(-max(hAlt, 0.0) / 0.03);                     // extinction près du limbe
    float mw = sk.r;
    vec3 sky = vec3(0.86, 0.89, 0.94) * (mw * 0.011 + sk.g * 0.0015);
    float twk = exp(-max(hAlt, 0.0) / 0.06);
    float st = 0.0;
    st += points(vec2(az * 300.0, el * 150.0), 300.0, 101.0, 0.08 + 0.22 * mw, 0.62 * uPx, 2.2 * uPx, 0.05, twk).x * 1.7;
    st += points(vec2(az * 760.0, el * 380.0), 760.0, 131.0, 0.05 + 0.22 * mw, 0.52 * uPx, 1.0, 0.0, twk * 0.6).x * 0.9;
    st += points(vec2(az * 1700.0, el * 850.0), 1700.0, 157.0, 0.03 + 0.3 * mw, 0.46 * uPx, 1.0, 0.0, 0.0).x * 0.35;
    st *= uStars;
    sky += WHITE * st;
    col = sky * (1.0 - thick * 0.96);

    // silhouette des nuages au-dessus du limbe terrestre
    if (hc.x > 0.0) {
      vec3 nc = normalize(ro + rd * hc.x);
      vec4 mc = sampleEqui(uMap, equi(uEarth * nc) + vec2(uCloud, 0.0));
      float cd = smoothstep(0.56, 0.9, mc.b + (mc.a - 0.5) * 0.28);
      float ncl = dot(nc, uSun);
      col = mix(col, vec3(0.86) * (max(ncl + 0.03, 0.0) * 1.4 + 0.01), cd * 0.8 * (1.0 - uVec));
    }

    // disque solaire (occulté naturellement par la Terre)
    float disk = smoothstep(uSunAng + pxRad, uSunAng - pxRad, angS);
    float ldark = 1.0 - 0.35 * pow(clamp(angS / uSunAng, 0.0, 1.0), 2.0);
    col += WHITE * disk * ldark * 60.0 * (1.0 - 0.6 * thick);
  }

  /* ───────── Atmosphère ───────── */
  float dR = ground ? exp(-(1.0 - imp) / 0.02) : exp(-hAlt / 0.0085);
  float dM = ground ? exp(-(1.0 - imp) / 0.007) : exp(-hAlt / 0.0032);
  float ray = 0.75 * (1.0 + mu * mu);
  float mie = hgPhase(mu, 0.82);
  vec3 atm = (vec3(0.88, 0.93, 1.0) * dR * ray * 0.06 + WHITE * dM * mie * 0.09) * lit;
  float airglow = ground ? 0.0 : exp(-pow((hAlt - 0.0105) / 0.0016, 2.0));
  atm += vec3(0.82, 0.86, 0.92) * (airglow * 0.028 + dR * 0.004) * (1.0 - uVec * 0.7);
  col = col * (1.0 - clamp(dR * 0.5 * lit, 0.0, 0.6)) + atm;

  // halo optique du soleil : ne connaît pas l'horizon, seulement la visibilité du disque
  col += WHITE * uSunVis * (exp(-angS / 0.0035) * 2.5 + exp(-angS / 0.02) * 0.28 + exp(-angS / 0.11) * 0.045);

  /* ───────── Développement ───────── */
  col *= uExpo;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  vec2 vg = ndc0 * vec2(0.85, 0.62);
  col *= 1.0 - 0.32 * pow(dot(vg, vg), 1.35);
  col *= uIntro * (1.0 - uFade);
  vec3 r = rnd3(ivec3(ivec2(fc), uFrame));
  col += (r.x + r.y - 1.0) / 255.0;                                 // tramage triangulaire : zéro bande
  col += (r.z - 0.5) * 0.012 * (1.0 - col) * uIntro;               // grain argentique discret
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

  /* ══════════════════════════════════════════════════════════════════════════════
     DOM
     ══════════════════════════════════════════════════════════════════════════════ */
  const host = document.getElementById('aube');
  const glCanvas = document.getElementById('aube-gl');
  const vCanvas = document.getElementById('aube-vec');
  if (!host || !glCanvas || !vCanvas) return;
  const vctx = vCanvas.getContext('2d');
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── WebGL2 ─────────────────────────────────────────────────────────────────── */
  let gl = null;
  let prog = null;
  let U = {};
  let texMap = null;
  let texSky = null;
  let glOK = false;
  let software = false;

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
  function link(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('AUBE link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  function bake(fs, w, h) {
    const p = link(fs);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p);
    gl.uniform2f(gl.getUniformLocation(p, 'uSize'), w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteProgram(p);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return tex;
  }

  function initGL() {
    try {
      gl = glCanvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) return false;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      software = /swiftshader|llvmpipe|software|basic render/i.test(renderer);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const bw = software ? CFG.bake / 2 : CFG.bake;
      texMap = bake(FS_EARTH, bw, bw / 2);
      texSky = bake(FS_SKY, bw / 2, bw / 4);
      prog = link(FS_MAIN);
      gl.useProgram(prog);
      const names = ['uRes', 'uPx', 'uTime', 'uCamPos', 'uCamR', 'uCamU', 'uCamF', 'uTanH', 'uAspect', 'uSun', 'uSunVis', 'uSunAng', 'uEarth', 'uCloud', 'uExpo', 'uVec', 'uZoom', 'uFade', 'uIntro', 'uCity', 'uStars', 'uZc', 'uFrame', 'uMap', 'uSky'];
      U = {};
      for (const n of names) U[n] = gl.getUniformLocation(prog, n);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texMap);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texSky);
      gl.uniform1i(U.uMap, 0);
      gl.uniform1i(U.uSky, 1);
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
    glOK = initGL();
    resize();
  });

  /* ── Tailles et qualité ─────────────────────────────────────────────────────── */
  let W = 0;
  let H = 0;
  let dpr = 1;
  let gScale = 1; // pixels GL par px CSS (adaptatif)
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(CFG.maxScale, window.devicePixelRatio || 1);
    if (!gScale || gScale > dpr) gScale = software ? Math.min(1, dpr) : dpr;
    vCanvas.width = Math.round(W * dpr);
    vCanvas.height = Math.round(H * dpr);
    applyGLSize();
  }
  function applyGLSize() {
    if (!gl) return;
    const w = Math.max(1, Math.round(W * gScale));
    const h = Math.max(1, Math.round(H * gScale));
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
    }
  }
  // Régulation : si l'image dépasse le budget, la résolution GL baisse par paliers de 15 %
  // (plancher 0,6 px CSS) ; les filets vectoriels restent, eux, à la résolution physique.
  const ft = [];
  let lockUntil = 0;
  function govern(dt, now) {
    if (dt > 100) return; // onglet masqué, saut d'horloge : pas une mesure
    ft.push(dt);
    if (ft.length > 40) ft.shift(); // onglet masqué, saut d'horloge : pas une mesure
    if (ft.length < 40 || now < lockUntil || launchAt >= 0) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    if (avg > 24 && gScale > 0.6) {
      gScale = Math.max(0.6, gScale * 0.85);
      applyGLSize();
      ft.length = 0;
      lockUntil = now + 2500;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════════
     SCÈNE : caméra, soleil, Terre
     ══════════════════════════════════════════════════════════════════════════════ */
  const t0 = performance.now();
  let launchAt = -1;
  let handoffAt = -1;
  let core = null; // géométrie figée au clic
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };

  function sunH(ti) {
    const u = clamp01((ti - CFG.riseStart) / CFG.riseDur);
    let h = lerp(CFG.hStart, CFG.hEnd, easeInOutS(u));
    const past = ti - CFG.riseStart - CFG.riseDur;
    if (past > 0) h += Math.min(CFG.hDriftMax, (CFG.hDrift * past) / 1000);
    return h;
  }

  function scene(now) {
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
    const sunAng = CFG.sunRadius * DEG;
    const sunVis = sstep(-sunAng, sunAng, hR);
    const spin = CFG.earthYaw + (ti / 1000) * CFG.spin + spinBoost;
    // Terre-fixe → monde : inclinaison de base · obliquité · rotation propre
    const E = mmul(mmul(rx(CFG.earthTilt), rz(CFG.axialTilt)), ry(spin));
    const expo = lerp(CFG.expoNight, CFG.expoDay, sstep(-4, 1.5, h)) * expoK;
    const zc = core ? [(core.cx / W) * 2 - 1, 1 - (core.cy / H) * 2] : [0, 0];
    const stars = (1 - 0.75 * sstep(-3.5, 1.5, h)) * (lk >= 0 ? 1 - easeIn(win(lk, 0, 700)) : 1);
    return { ti, lk, h, stars, sun, sunVis, sunAng, pos, F, R, Up, tanH, E, expo, vecK, zoom, fade, city, zc, cloud: (ti / 1000) * CFG.cloudDrift + 0.13 };
  }

  // Projection monde → px CSS (identique au shader, zoom de lancement compris)
  function project(S, P) {
    const v = [P[0] - S.pos[0], P[1] - S.pos[1], P[2] - S.pos[2]];
    const z = dot(v, S.F);
    if (z <= 1e-4) return null;
    let nx = dot(v, S.R) / (z * S.tanH * (W / H));
    let ny = dot(v, S.Up) / (z * S.tanH);
    nx = S.zc[0] + (nx - S.zc[0]) * (1 + S.zoom);
    ny = S.zc[1] + (ny - S.zc[1]) * (1 + S.zoom);
    return [((nx + 1) / 2) * W, ((1 - ny) / 2) * H];
  }

  /* ══════════════════════════════════════════════════════════════════════════════
     RENDU GL
     ══════════════════════════════════════════════════════════════════════════════ */
  let frame = 0;
  function drawGL(S, now) {
    if (!glOK) return;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.useProgram(prog);
    gl.uniform2f(U.uRes, glCanvas.width, glCanvas.height);
    gl.uniform1f(U.uPx, glCanvas.height / H);
    gl.uniform1f(U.uTime, (now - t0) / 1000);
    gl.uniform3fv(U.uCamPos, S.pos);
    gl.uniform3fv(U.uCamR, S.R);
    gl.uniform3fv(U.uCamU, S.Up);
    gl.uniform3fv(U.uCamF, S.F);
    gl.uniform1f(U.uTanH, S.tanH);
    gl.uniform1f(U.uAspect, W / H);
    gl.uniform3fv(U.uSun, S.sun);
    gl.uniform1f(U.uSunVis, S.sunVis);
    gl.uniform1f(U.uSunAng, S.sunAng);
    gl.uniformMatrix3fv(U.uEarth, false, colMajor(mT(S.E)));
    gl.uniform1f(U.uCloud, S.cloud);
    gl.uniform1f(U.uExpo, S.expo);
    gl.uniform1f(U.uVec, S.vecK);
    gl.uniform1f(U.uZoom, S.zoom);
    gl.uniform1f(U.uFade, S.fade);
    gl.uniform1f(U.uIntro, easeOut(clamp01(S.ti / 1600)));
    gl.uniform1f(U.uCity, S.city);
    gl.uniform1f(U.uStars, S.stars);
    gl.uniform2f(U.uZc, S.zc[0], S.zc[1]);
    gl.uniform1i(U.uFrame, frame++ & 1023);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ══════════════════════════════════════════════════════════════════════════════
     CALQUE VECTORIEL
     ══════════════════════════════════════════════════════════════════════════════ */
  // Graticule : 11 parallèles, 24 méridiens (15°), échantillonnés tous les 3°
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

  // Poussières en profondeur de champ (bokeh) : trois plans
  seed = 0x5153;
  const MOTES = Array.from({ length: 30 }, () => ({ x: rnd(), y: rnd(), z: 0.15 + rnd() * 0.85, s: rnd(), ph: rnd() * 6.283, vx: (rnd() - 0.5) * 0.004, vy: (rnd() - 0.5) * 0.003 }));

  const px = () => 1 / dpr; // 1 pixel physique en px CSS
  const snap = (v) => (Math.round(v * dpr) + 0.5) / dpr;

  function limbCurve(S) {
    const dip = Math.acos(1 / (1 + (S.pos[1] - 1)));
    const dist = Math.sqrt(S.pos[1] * S.pos[1] - 1);
    const pts = [];
    for (let i = -60; i <= 60; i++) {
      const phi = (i / 60) * 1.05;
      const d = [Math.sin(phi) * Math.cos(dip), -Math.sin(dip), -Math.cos(phi) * Math.cos(dip)];
      const P = [S.pos[0] + d[0] * dist, S.pos[1] + d[1] * dist, S.pos[2] + d[2] * dist];
      const q = project(S, P);
      if (q) pts.push(q);
    }
    return pts;
  }

  // Alpha quantifié → un Path2D par niveau : des milliers de segments en 10 traits
  const LEVELS = 10;
  function makeBuckets() {
    return Array.from({ length: LEVELS }, () => new Path2D());
  }
  function strokeBuckets(buckets, maxA, rgb) {
    vctx.lineWidth = px();
    for (let i = 0; i < LEVELS; i++) {
      const a = ((i + 1) / LEVELS) * maxA;
      if (a <= 0.003) continue;
      vctx.strokeStyle = `rgba(${rgb},${a.toFixed(4)})`;
      vctx.stroke(buckets[i]);
    }
  }
  const bucketOf = (a) => Math.min(LEVELS - 1, Math.max(0, Math.round(a * LEVELS) - 1));

  function coreRot(tc) {
    // le cœur tourne vite en se formant, puis se pose
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

    /* ── Poussières (derrière tout le reste, devant la Terre) ── */
    if (sceneA > 0.01) {
      for (const m of MOTES) {
        let x = ((m.x + m.vx * (S.ti / 1000) + 10) % 1) * W + ptr.x * 14 * m.z;
        let y = ((m.y + m.vy * (S.ti / 1000) + 10) % 1) * H + ptr.y * 10 * m.z;
        if (lk >= 0 && core) {
          // on plonge : les poussières fuient vers les bords
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
          // disque de bokeh : cœur plat + liseré plus clair, comme un objectif réel
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

    /* ── Limbe : filet d'un pixel, s'illumine depuis le point de lever ── */
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
      // graduations d'horizon (tous les 3°, majeures tous les 15°)
      ctx.strokeStyle = `rgba(255,255,255,${(0.1 * intro).toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i < limb.length - 1; i += 2) {
        const [x, y] = limb[i];
        const [x2, y2] = limb[Math.min(limb.length - 1, i + 1)];
        const nx = -(y2 - y);
        const ny = x2 - x;
        const l = Math.hypot(nx, ny) || 1;
        const len = (i - 60) % 10 === 0 ? 5 : 2;
        ctx.moveTo(x, y);
        ctx.lineTo(x - (nx / l) * len * -1, y - (ny / l) * len * -1);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* ── Graticule terrestre → cœur ── */
    const Mc = core ? coreRot(coreK) : null;
    // formation : 450 → 1250 ms ; effondrement sur la timeline du circuit
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
        // position sur la Terre
        const P = mvec(Ew, pe);
        const toCam = [S.pos[0] - P[0], S.pos[1] - P[1], S.pos[2] - P[2]];
        const facing = dot(P, toCam) / (Math.hypot(toCam[0], toCam[1], toCam[2]) || 1);
        const q = mk < 1 ? project(S, P) : null;
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
          const ac = coreA * (c[2] > 0 ? 0.5 : 0.14) + (1 - coreA) * 0.35 * Math.sin(Math.PI * mk);
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
          const b = buckets[bucketOf((a + prev[2]) / 2 / 0.6)];
          b.moveTo(prev[0], prev[1]);
          b.lineTo(x, y);
        }
        prev = [x, y, a];
      }
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

    /* ── Aigrettes de diffraction + traînée anamorphique ── */
    if (sunScr && S.sunVis > 0.001 && sceneA > 0.01) {
      const [x, y] = sunScr;
      const k = S.sunVis * sceneA * (lk >= 0 ? 1 + 1.2 * Math.sin(Math.PI * win(lk, 100, 900)) : 1);
      const rot = (S.ti / 60000) * 0.3;
      for (let i = 0; i < 8; i++) {
        const ang = rot + (i * Math.PI) / 4;
        const main = i % 2 === 0;
        const len = (main ? 90 : 38) * k * (0.85 + 0.15 * Math.sin(S.ti / 700 + i));
        const ex = x + Math.cos(ang) * len;
        const ey = y + Math.sin(ang) * len;
        const g = ctx.createLinearGradient(x, y, ex, ey);
        g.addColorStop(0, `rgba(255,255,255,${((main ? 0.5 : 0.25) * k).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = px();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      const g = ctx.createLinearGradient(0, 0, W, 0);
      const c = clamp01(x / W);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(c, `rgba(255,255,255,${(0.22 * k).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.round(y * dpr) / dpr, W, px());
      // fantômes d'objectif le long de l'axe soleil → centre optique
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
      // orbites 3D, tracées progressivement, moitié arrière atténuée
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
            const b = bRing[bucketOf(a / 0.6)];
            b.moveTo(prev[0], prev[1]);
            b.lineTo(x, y);
          }
          prev = [x, y];
        }
        strokeBuckets(bRing, 0.6, '255,255,255');
        // photon orbital + traîne
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
      // échelle gyroscopique : 96 graduations, majeures toutes les 8
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
      }
      // noyau
      const nk = easeOut(win(lk, 900, 1300));
      if (nk > 0) {
        const pulse = 0.85 + 0.15 * Math.sin(tc / 140);
        const rr = 16 * nk * pulse;
        const g = ctx.createRadialGradient(core.cx, core.cy, 0, core.cx, core.cy, rr);
        g.addColorStop(0, `rgba(255,255,255,${(0.55 * coreA).toFixed(3)})`);
        g.addColorStop(0.25, `rgba(255,255,255,${(0.12 * coreA).toFixed(3)})`);
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

  function render(now) {
    const S = scene(now);
    if (glOK && S.fade < 0.999) drawGL(S, now);
    else if (glOK && S.fade >= 0.999) {
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    drawVector(S, now);
    if (!glOK) drawFallback(S);
    if (launchAt >= 0 && handoffAt < 0 && now - launchAt >= CFG.pre) {
      handoffAt = now;
      if (resolveLaunch) resolveLaunch();
      resolveLaunch = null;
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
    render(now);
    // après la LED, le calque vectoriel a fini : on libère le GPU pour le desk
    if (handoffAt >= 0 && now - handoffAt > T_DONE + 600) stop();
  }

  function start() {
    if (running) return;
    if (reducedMotion) {
      render(t0 + CFG.riseStart + CFG.riseDur);
      return;
    }
    running = true;
    last = 0;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
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
    return new Promise((res) => {
      resolveLaunch = res;
    });
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
  window.cantoAube = { launch, start, stop, isRunning: () => running };
  start();
})();
