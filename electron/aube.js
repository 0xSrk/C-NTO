/* ═══════════════════════════════════════════════════════════════════════════
   CΛNTO · Lanceur · « AUBE » — lever de Terre en pixels, 60 ips.
   SIΞRRΛSKΛ Lab · Artefact 002

   Plain JS, CSP `script-src 'self'`, zéro dépendance.
   Moteur : tampon basse résolution (1 texel = 2 px physiques) calculé texel par
   texel (Terre sphérique, atmosphère, rayons crépusculaires, disque solaire),
   tramé en ordonné (Bayer 8×8) dans la palette du desk, puis remonté en
   plus-proche-voisin. Une couche vectorielle 1 px (limbe, règle d'horizon,
   photon LED) est tracée par-dessus, en pixels physiques, à la finesse du desk.

   API publique : window.cantoAube = { start, stop, launch, setHover, isRunning }
   Fusion avec le circuit du lanceur : launch() suit exactement la timeline de
   runTransfer() (T_RING 560 · T_COLLAPSE 1000 · T_LED 1260 · T_DONE 1520).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* ── Timeline du circuit (miroir de launcher-ui.js) ─────────────────── */
  const T_RING = 560;
  const T_COLLAPSE = 1000;
  const T_LED = 1260;
  const T_DONE = 1520;

  /* ── Géométrie (en px CSS, la fenêtre native fait 420 × 620) ──────────── */
  const LIMB_Y = 384; // apex du limbe : sous « SIΞRRΛSKΛ—LAB », au-dessus du panneau
  const EARTH_R = 640; // rayon de la Terre : sagitta de 34 px aux bords → courbure douce
  const ATM_H = 22; // hauteur d'échelle de l'atmosphère
  const SUN_R = 26; // rayon du disque
  const RAY_H = 150; // portée verticale des rayons
  const RAY_D = 290; // portée radiale des rayons
  const GLOW_1 = 90; // halo court (dans l'atmosphère)
  const GLOW_2 = 260; // halo long (ciel)
  const EL_AMBIENT = -68; // élévation de repos (sous l'apex, en px CSS)
  const EL_SWELL = 16; // respiration lente
  const EL_HOVER = 22; // le soleil se lève un peu quand la souris survole « Lancer »

  /* ── Palette du desk ───────────────────────────────────────────────────── */
  // Rampe neutre : --bg → --line → --text → blanc
  const NEUTRAL = [
    [0.0, 0, 0, 0],
    [0.18, 11, 11, 11],
    [0.4, 46, 46, 46],
    [0.62, 138, 138, 138],
    [0.82, 196, 196, 196],
    [1.0, 255, 255, 255],
  ];
  // Rampe chaude : noir → rouge profond → LED #c41e3a → ember #e0776c → amber #d8b45a → blanc
  const WARM = [
    [0.0, 0, 0, 0],
    [0.14, 34, 8, 13],
    [0.32, 196, 30, 58],
    [0.5, 224, 119, 108],
    [0.7, 216, 180, 90],
    [0.86, 243, 226, 176],
    [1.0, 255, 255, 255],
  ];
  const LV = 28; // niveaux de luminance
  const WV = 8; // niveaux de chaleur

  function rampAt(ramp, t) {
    if (t <= 0) return [ramp[0][1], ramp[0][2], ramp[0][3]];
    for (let i = 1; i < ramp.length; i++) {
      if (t <= ramp[i][0]) {
        const a = ramp[i - 1];
        const b = ramp[i];
        const u = (t - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
      }
    }
    const l = ramp[ramp.length - 1];
    return [l[1], l[2], l[3]];
  }
  const LUT = new Uint8ClampedArray(LV * WV * 3);
  for (let w = 0; w < WV; w++) {
    const kw = w / (WV - 1);
    for (let l = 0; l < LV; l++) {
      const t = l / (LV - 1);
      const n = rampAt(NEUTRAL, t);
      const c = rampAt(WARM, t);
      const o = (w * LV + l) * 3;
      LUT[o] = n[0] + (c[0] - n[0]) * kw;
      LUT[o + 1] = n[1] + (c[1] - n[1]) * kw;
      LUT[o + 2] = n[2] + (c[2] - n[2]) * kw;
    }
  }
  // Matrice de Bayer 8×8, normalisée dans [0,1)
  const BAYER = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33,
    9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
  ];
  const BAY = new Float32Array(64);
  for (let i = 0; i < 64; i++) BAY[i] = (BAYER[i] + 0.5) / 64;

  /* ── Outils ─────────────────────────────────────────────────────────────── */
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeIn = (x) => x * x * x;
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  // Hachage déterministe : la scène est identique à chaque ouverture (graine fixe)
  let seed = 0x5153; // « SK »
  function rnd() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function h1(x) {
    const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  function h2(x, y) {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(h1(i), h1(i + 1), u);
  }
  function noise2(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(h2(ix, iy), h2(ix + 1, iy), ux), lerp(h2(ix, iy + 1), h2(ix + 1, iy + 1), ux), uy);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Cœur de rendu (pur : pas de DOM). Construit une scène pour un tampon
     BW × BH texels, `s` texels par px CSS, puis rend chaque image dans `rgba`.
     ══════════════════════════════════════════════════════════════════════════ */
  function buildScene(BW, BH, s) {
    const N = BW * BH;
    const ex = BW / 2;
    const ER = EARTH_R * s;
    const limbY = LIMB_Y * s;
    const ey = limbY + ER;
    const kind = new Uint8Array(N); // 0 ciel · 1 Terre
    const nx = new Float32Array(N);
    const ny = new Float32Array(N);
    const nz = new Float32Array(N);
    const alt = new Float32Array(N); // altitude au-dessus du limbe (texels)
    const atmA = new Float32Array(N); // exp(-alt/AT) : densité de l'atmosphère
    const bandA = new Float32Array(N); // exp(-alt/4s) : liseré du limbe
    const rayA = new Float32Array(N); // exp(-alt/RH) : portée verticale des rayons
    const grat = new Uint8Array(N); // graticule 1 texel
    const tex = new Float32Array(N); // relief très léger de la surface
    const lon = new Float32Array(N);
    const lat = new Float32Array(N);
    // Axe de la Terre : incliné de 23,4° dans le plan écran, et basculé de 52° vers la caméra
    const tilt = (23.4 * Math.PI) / 180;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const cam = (52 * Math.PI) / 180;
    const cc = Math.cos(cam);
    const sc = Math.sin(cam);
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < BW; x++) {
        const i = y * BW + x;
        const dx = x + 0.5 - ex;
        const dy = y + 0.5 - ey;
        const d = Math.hypot(dx, dy);
        if (d < ER) {
          kind[i] = 1;
          const ux = dx / ER;
          const uy = dy / ER;
          const uz = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
          nx[i] = ux;
          ny[i] = uy;
          nz[i] = uz;
          // repère géographique
          const rx = ux * ct - uy * st;
          const ry = ux * st + uy * ct;
          const gy = ry * cc - uz * sc;
          const gz = ry * sc + uz * cc;
          lat[i] = Math.asin(Math.max(-1, Math.min(1, gy)));
          lon[i] = Math.atan2(rx, gz);
          tex[i] = noise2(lon[i] * 18, lat[i] * 18) * 0.5 + noise2(lon[i] * 47, lat[i] * 47) * 0.5;
        } else {
          const h = d - ER;
          alt[i] = h;
          atmA[i] = Math.exp(-h / (ATM_H * s));
          bandA[i] = Math.exp(-h / (4 * s));
          rayA[i] = Math.exp(-h / (RAY_H * s));
        }
      }
    }
    // Graticule : tous les 10°, détecté par changement de cellule (trait exactement 1 texel)
    const SP = (10 * Math.PI) / 180;
    for (let y = 1; y < BH; y++) {
      for (let x = 1; x < BW; x++) {
        const i = y * BW + x;
        if (!kind[i]) continue;
        const l = i - 1;
        const u = i - BW;
        let g = 0;
        if (kind[l] && Math.floor(lon[i] / SP) !== Math.floor(lon[l] / SP)) g = 1;
        if (kind[u] && Math.floor(lat[i] / SP) !== Math.floor(lat[u] / SP)) g = 1;
        grat[i] = g;
      }
    }
    // Lumières de nuit : semées là où le « continent » (bruit géographique) affleure,
    // puis reliées par des pistes de circuit en Manhattan (le litho nano du desk).
    const lights = []; // {i, kind: 0 amber · 1 blanc · 2 LED, ph}
    const lightSet = new Uint8Array(N);
    for (let y = Math.floor(limbY) + 2; y < BH; y++) {
      for (let x = 0; x < BW; x++) {
        const i = y * BW + x;
        if (!kind[i]) continue;
        const cont = noise2(lon[i] * 5.5 + 3.1, lat[i] * 5.5 + 7.7);
        const city = noise2(lon[i] * 31, lat[i] * 31);
        const p = cont > 0.55 ? 0.022 + (city > 0.64 ? 0.2 : 0) : 0.0015;
        if (rnd() < p) {
          const r = rnd();
          lights.push({ i, x, y, kind: r < 0.78 ? 0 : r < 0.95 ? 1 : 2, ph: rnd() * 6.283 });
          lightSet[i] = 1;
        }
      }
    }
    // Pistes : depuis un point lumineux, marche en Manhattan (trait horizontal puis vertical)
    const traces = []; // { idx: Int32Array, len }
    const grid = 4; // pas de grille du circuit (texels)
    for (let k = 0; k < 44 && lights.length > 4; k++) {
      const a = lights[Math.floor(rnd() * lights.length)];
      const b = lights[Math.floor(rnd() * lights.length)];
      if (a === b) continue;
      const dxs = Math.abs(a.x - b.x);
      const dys = Math.abs(a.y - b.y);
      if (dxs + dys < 6 || dxs + dys > 70) continue;
      const pts = [];
      let cx = a.x;
      let cy = a.y;
      const midX = Math.round((a.x + (b.x - a.x) * (0.3 + rnd() * 0.4)) / grid) * grid;
      const stepTo = (tx, ty) => {
        while (cx !== tx) {
          cx += cx < tx ? 1 : -1;
          pts.push(cy * BW + cx);
        }
        while (cy !== ty) {
          cy += cy < ty ? 1 : -1;
          pts.push(cy * BW + cx);
        }
      };
      stepTo(midX, a.y);
      stepTo(midX, b.y);
      stepTo(b.x, b.y);
      const idx = pts.filter((i) => kind[i] === 1);
      if (idx.length > 5) traces.push({ idx: Int32Array.from(idx), len: idx.length, ph: rnd() * 9000, per: 5200 + rnd() * 6000, led: rnd() < 0.25 });
    }
    // Étoiles : semées sur la grille de 2 texels, avec une magnitude
    const stars = [];
    for (let k = 0; k < 170; k++) {
      const x = Math.floor(rnd() * BW);
      const y = Math.floor(rnd() * (limbY - 6));
      const i = y * BW + x;
      if (kind[i]) continue;
      stars.push({ i, x, y, m: 0.25 + rnd() * 0.75, ph: rnd() * 6.283, sp: 0.6 + rnd() * 1.6 });
    }
    // Tables radiales (distance au soleil, en texels) : halos et portée des rayons
    const DL = 2048;
    const g1T = new Float32Array(DL);
    const g2T = new Float32Array(DL);
    const rdT = new Float32Array(DL);
    const gwT = new Float32Array(DL);
    const flT = new Float32Array(DL);
    for (let k = 0; k < DL; k++) {
      g1T[k] = Math.exp(-k / (GLOW_1 * s)) * 1.15;
      g2T[k] = Math.exp(-k / (GLOW_2 * s)) * 0.3;
      rdT[k] = Math.exp(-k / (RAY_D * s));
      gwT[k] = Math.exp(-k / (GLOW_1 * s * 1.5)) * 0.55;
      flT[k] = 0.12 + 0.88 * Math.exp(-k / (210 * s));
    }
    return { BW, BH, N, s, ex, ey, ER, limbY, kind, nx, ny, nz, alt, atmA, bandA, rayA, grat, tex, lights, traces, stars, DL, g1T, g2T, rdT, gwT, flT };
  }

  /* Profil angulaire des rayons (rayons crépusculaires) : calculé une fois par image. */
  const RAYN = 512;
  const rayProf = new Float32Array(RAYN);
  function buildRays(rot, gapNoise) {
    for (let k = 0; k < RAYN; k++) {
      const a = (k / RAYN) * 12; // ~12 cycles de bruit sur le demi-tour
      let v = noise1(a * 1.0 + rot) * 0.5 + noise1(a * 2.7 - rot * 1.6 + 11) * 0.3 + noise1(a * 7.3 + rot * 0.4 + 31) * 0.2;
      // Les nuages au ras du limbe ferment certains rayons (lentement)
      v *= 0.6 + 0.4 * noise1(a * 0.45 + gapNoise);
      // Peigne fin : ~28 faisceaux nets sur le demi-tour, à la finesse d'une gravure
      const comb = 0.65 + 0.35 * Math.sin(k * 0.34 + rot * 3);
      v = smooth(0.34, 0.7, v) * comb;
      rayProf[k] = v * v;
    }
  }

  /* Image : remplit rgba (Uint8ClampedArray, BW*BH*4) et lum (Float32Array, BW*BH). */
  function render(sc, rgba, lum, p) {
    // p : { sx, sy, el, dawn, rayGain, flash, rot, gap, stars, t, px, py }
    const { BW, BH, s, ex, ey, ER, limbY, kind, nx, ny, nz, atmA, bandA, rayA, grat, tex, DL, g1T, g2T, rdT, gwT, flT } = sc;
    const DLm = DL - 1;
    buildRays(p.rot, p.gap);
    const SR = SUN_R * s;
    const sx = p.sx;
    const sy = p.sy;
    // Direction de la lumière (soleil lointain) vue du centre de la Terre
    // Le spectateur est côté nuit : le soleil est derrière la Terre (lz < 0). Quand il se lève,
    // le terminateur bascule vers la caméra et un croissant de jour déborde du limbe.
    // La bande de jour visible mesure θ0 depuis l'apex : 9° au repos → 30° au zénith de l'aube.
    const th0 = ((9 + 16 * clamp01((p.el - EL_AMBIENT + EL_SWELL) / 118)) * Math.PI) / 180;
    let lx = ((sx - ex) / ER) * 0.6;
    let ly = -1;
    let lz = -Math.cos(th0) / Math.sin(th0);
    const ll = Math.hypot(lx, ly, lz);
    lx /= ll;
    ly /= ll;
    lz /= ll;
    const dawn = p.dawn;
    const flash = p.flash;
    const diskOn = p.el > -SUN_R;
    const invPI = 1 / Math.PI;
    for (let y = 0; y < BH; y++) {
      const by = (y & 7) << 3;
      for (let x = 0; x < BW; x++) {
        const i = y * BW + x;
        let L, W;
        if (kind[i]) {
          // ── Terre ──
          const dot = nx[i] * lx + ny[i] * ly + nz[i] * lz;
          const day = clamp01(dot * 5); // jour : croissant au limbe
          const twi = smooth(-0.035, 0.03, dot) * (1 - day); // crépuscule : liseré chaud au terminateur
          L = 0.028 + tex[i] * 0.022 + day * (0.3 + tex[i] * 0.1) + twi * 0.06 + grat[i] * (0.05 + day * 0.05);
          W = clamp01(twi * 0.9 + day * 0.25);
          // le bord du disque terrestre reçoit le halo de l'atmosphère
          const rim = 1 - Math.hypot(x + 0.5 - ex, y + 0.5 - ey) / ER;
          if (rim < 0.012) L += ((0.012 - rim) / 0.012) * 0.22 * dawn;
          if (flash > 0) {
            L += flash * 0.4;
            W = Math.max(W, flash * 0.7);
          }
        } else {
          // ── Ciel ──
          const atm = atmA[i];
          const ddx = x + 0.5 - sx;
          const ddy = y + 0.5 - sy;
          const ds = Math.sqrt(ddx * ddx + ddy * ddy);
          let di = ds | 0;
          if (di > DLm) di = DLm;
          const glow = (atm * g1T[di] + g2T[di] + bandA[i] * 0.42) * dawn;
          // rayons crépusculaires : profil angulaire × portée verticale × portée radiale
          const th = Math.atan2(ddy, ddx) * invPI; // -1..1 (le ciel est au-dessus : th < 0)
          const k = ((th + 1) * 0.5 * RAYN) | 0;
          const ray = rayProf[k & (RAYN - 1)] * rayA[i] * rdT[di] * p.rayGain * dawn;
          L = glow + ray * 0.55;
          W = clamp01(0.92 * atm + gwT[di] + 0.12 * dawn);
          if (diskOn && ds < SR + 1) {
            const e = smooth(SR + 1, SR - 1.2, ds);
            L = Math.max(L, e);
            W = ds < SR - 2.5 ? 0.18 : 0.75;
          }
          if (flash > 0) {
            L += flash * flT[di];
            W = Math.max(W, flash * 0.8);
          }
        }
        if (L > 1) L = 1;
        lum[i] = L;
        // ── Tramage ordonné dans la palette du desk ──
        const b = BAY[by | (x & 7)];
        let li = (L * (LV - 1) + b) | 0;
        if (li >= LV) li = LV - 1;
        let wi = (W * (WV - 1) + BAY[((x & 7) << 3) | (y & 7)]) | 0;
        if (wi >= WV) wi = WV - 1;
        const o = (wi * LV + li) * 3;
        const q = i << 2;
        rgba[q] = LUT[o];
        rgba[q + 1] = LUT[o + 1];
        rgba[q + 2] = LUT[o + 2];
        rgba[q + 3] = 255;
      }
    }
    // ── Étoiles (s'éteignent quand le ciel s'éclaire) ──
    const t = p.t;
    const ox = Math.round(p.px * 2.5);
    const oy = Math.round(p.py * 1.5);
    for (const st of sc.stars) {
      const x = st.x + ox;
      const y = st.y + oy;
      if (x < 0 || x >= BW || y < 0 || y >= BH) continue;
      const i = y * BW + x;
      if (kind[i]) continue;
      const fade = clamp01((0.11 - lum[i]) / 0.11) * (1 - flash);
      if (fade <= 0) continue;
      const tw = 0.7 + 0.3 * Math.sin(t * 0.0011 * st.sp + st.ph);
      const v = Math.round(255 * clamp01(st.m * tw * fade * p.stars));
      const q = i << 2;
      if (v > rgba[q]) {
        rgba[q] = v;
        rgba[q + 1] = v;
        rgba[q + 2] = v;
      }
    }
    // ── Lumières de nuit + photons sur les pistes ──
    const night = 1 - flash;
    for (const lg of sc.lights) {
      const i = lg.i;
      const dot = nx[i] * lx + ny[i] * ly + nz[i] * lz;
      const dark = clamp01((0.06 - dot) / 0.12) * night;
      if (dark <= 0) continue;
      const tw = 0.75 + 0.25 * Math.sin(t * 0.0026 + lg.ph);
      const a = dark * tw;
      const q = i << 2;
      if (lg.kind === 0) {
        rgba[q] = Math.max(rgba[q], 216 * a);
        rgba[q + 1] = Math.max(rgba[q + 1], 180 * a);
        rgba[q + 2] = Math.max(rgba[q + 2], 90 * a);
      } else if (lg.kind === 1) {
        const v = 235 * a;
        rgba[q] = Math.max(rgba[q], v);
        rgba[q + 1] = Math.max(rgba[q + 1], v);
        rgba[q + 2] = Math.max(rgba[q + 2], v);
      } else {
        rgba[q] = Math.max(rgba[q], 196 * a);
        rgba[q + 1] = Math.max(rgba[q + 1], 30 * a);
        rgba[q + 2] = Math.max(rgba[q + 2], 58 * a);
      }
    }
    for (const tr of sc.traces) {
      // trait de piste très faible + un photon qui parcourt la piste
      const ph = ((t + tr.ph) % tr.per) / tr.per;
      const head = ph * (tr.len + 10) - 5;
      for (let k = 0; k < tr.len; k++) {
        const i = tr.idx[k];
        const dot = nx[i] * lx + ny[i] * ly + nz[i] * lz;
        const dark = clamp01((0.06 - dot) / 0.12) * night;
        if (dark <= 0) continue;
        const dd = head - k;
        const pulse = dd >= 0 && dd < 7 ? (1 - dd / 7) * (1 - dd / 7) : 0;
        const base = 0.055 * dark;
        const q = i << 2;
        if (tr.led) {
          rgba[q] = Math.max(rgba[q], (60 * base + 196 * pulse) * dark);
          rgba[q + 1] = Math.max(rgba[q + 1], (30 * base + 30 * pulse) * dark);
          rgba[q + 2] = Math.max(rgba[q + 2], (40 * base + 58 * pulse) * dark);
        } else {
          const v = (255 * base + 230 * pulse) * dark;
          rgba[q] = Math.max(rgba[q], v);
          rgba[q + 1] = Math.max(rgba[q + 1], v * 0.94);
          rgba[q + 2] = Math.max(rgba[q + 2], v * 0.78);
        }
      }
    }
    // ── Satellite : un pixel qui traverse le ciel toutes les ~34 s, avec sa balise LED ──
    const satT = (t % 34000) / 34000;
    if (satT < 0.26 && night > 0.5) {
      const u = satT / 0.26;
      const x = Math.round(lerp(-2, BW + 2, u));
      const y = Math.round(limbY * 0.42 - Math.sin(u * Math.PI) * 26 * s);
      if (x >= 0 && x < BW && y >= 0 && y < BH && !kind[y * BW + x]) {
        const q = (y * BW + x) << 2;
        rgba[q] = rgba[q + 1] = rgba[q + 2] = 200;
        if (Math.floor(t / 500) % 2 === 0 && x + 1 < BW) {
          const q2 = q + 4;
          rgba[q2] = 196;
          rgba[q2 + 1] = 30;
          rgba[q2 + 2] = 58;
        }
      }
    }
  }

  root.__cantoAubeCore = { buildScene, render, EL_AMBIENT, LIMB_Y, EARTH_R };

  /* ══════════════════════════════════════════════════════════════════════════
     Glu DOM : canvas, boucle, adaptation, survol, lancement.
     ══════════════════════════════════════════════════════════════════════════ */
  if (typeof document === 'undefined') return;
  const canvas = document.getElementById('sky');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let dpr = 1;
  let PW = 0;
  let PH = 0;
  let cell = 2; // taille d'un texel en px physiques
  let sc = null;
  let off = null;
  let offCtx = null;
  let img = null;
  let lumBuf = null;
  let running = false;
  let raf = 0;
  let last = 0;
  let cost = 4; // moyenne mobile du coût d'une image (ms)
  let cellFloor = 2;

  // état animé
  const state = { hover: 0, hoverT: 0, px: 0, py: 0, ptx: 0, pty: 0, rot: 0, gap: 0 };
  let launchAt = -1;
  let launchCY = 0; // centre du logotype (px CSS) : point de fuite de l'effondrement
  let elAtLaunch = EL_AMBIENT;

  function rebuild() {
    dpr = Math.min(3, root.devicePixelRatio || 1);
    const W = root.innerWidth;
    const H = root.innerHeight;
    PW = Math.round(W * dpr);
    PH = Math.round(H * dpr);
    canvas.width = PW;
    canvas.height = PH;
    cellFloor = Math.max(2, Math.round(2 * dpr));
    cell = Math.max(cell, cellFloor);
    const BW = Math.ceil(PW / cell);
    const BH = Math.ceil(PH / cell);
    const s = dpr / cell; // texels par px CSS
    seed = 0x5153;
    sc = buildScene(BW, BH, s);
    off = document.createElement('canvas');
    off.width = BW;
    off.height = BH;
    offCtx = off.getContext('2d');
    img = offCtx.createImageData(BW, BH);
    lumBuf = new Float32Array(BW * BH);
  }

  function elevation(now, t) {
    // t : ms depuis launch(), ou -1 hors lancement
    const swell = Math.sin(now / 9000) * EL_SWELL + Math.sin(now / 2300) * 2.5;
    let el = EL_AMBIENT + swell + state.hover * EL_HOVER;
    if (t < 0) return el;
    if (t <= T_RING) return lerp(elAtLaunch, -SUN_R + 2, easeIn(t / T_RING));
    if (t <= T_COLLAPSE) return lerp(-SUN_R + 2, 9, easeOut((t - T_RING) / (T_COLLAPSE - T_RING)));
    if (t <= T_LED) return lerp(9, 30, easeIn((t - T_COLLAPSE) / (T_LED - T_COLLAPSE)));
    return 30;
  }

  function frameParams(now, t) {
    const s = sc.s;
    const el = elevation(now, t);
    const sway = Math.sin(now / 13000) * 6 * (t < 0 ? 1 : clamp01(1 - t / T_RING));
    const sx = sc.ex + sway * s + state.px * 1.2;
    const sy = sc.limbY - el * s;
    // aube : 0 (nuit) → 1 (soleil au limbe)
    let dawn = clamp01((el + 96) / 100);
    let rayGain = 0.9 + state.hover * 0.45;
    let flash = 0;
    let stars = 1;
    if (t >= 0) {
      rayGain += 1.6 * easeOut(clamp01(t / T_RING));
      dawn = Math.max(dawn, 0.55 + 0.45 * easeOut(clamp01(t / T_COLLAPSE)));
      if (t > T_COLLAPSE) flash = easeIn(clamp01((t - T_COLLAPSE) / (T_LED - T_COLLAPSE)));
      if (t > T_LED) flash = 1 - easeOut(clamp01((t - T_LED) / (T_DONE - T_LED)));
      stars = 1 - clamp01(t / T_COLLAPSE);
    }
    return { sx, sy, el, dawn, rayGain, flash, rot: state.rot, gap: state.gap, stars, t: now, px: state.px, py: state.py };
  }

  /* Couche vectorielle 1 px : limbe, règle d'horizon, photon LED sur le limbe. */
  function overlay(now, t, dawn) {
    const cx = sc.ex * cell;
    const cy = sc.ey * cell;
    const R = sc.ER * cell;
    const half = Math.asin(Math.min(1, PW / 2 / R)) + 0.02;
    const a0 = -Math.PI / 2 - half;
    const a1 = -Math.PI / 2 + half;
    // Pendant l'effondrement, le limbe se resserre sur l'axe du logotype comme le reste de la scène
    let sq = 1;
    if (t >= T_LED) sq = 1 - easeInOut(clamp01((t - T_LED) / (T_DONE - T_LED)));
    const cyp = launchCY * dpr;
    ctx.setTransform(1, 0, 0, sq, 0, cyp * (1 - sq));
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    // limbe : trait LED, très fin, dont l'intensité suit l'aube ; après T_DONE il ne reste
    // qu'un horizon résiduel sur l'axe, qui respire au rythme de la LED du circuit
    let a = 0.22 + dawn * 0.5;
    if (t >= T_LED) a *= sq;
    if (t >= T_DONE) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(196,30,58,${(0.1 * (0.75 + 0.25 * Math.sin((t - T_DONE) / 300))).toFixed(3)})`;
      ctx.fillRect(0, Math.round(cyp), PW, 1);
      return;
    }
    ctx.strokeStyle = `rgba(196,30,58,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy + 0.5, R, a0, a1);
    ctx.stroke();
    // 2e trait, 1 px au-dessus, blanc chaud : la lisière de l'atmosphère
    ctx.strokeStyle = `rgba(243,226,176,${(0.05 + dawn * 0.16).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy + 0.5, R + 1, a0, a1);
    ctx.stroke();
    // règle d'horizon : graduations tous les 24 px CSS, majeures tous les 120
    if (t < T_COLLAPSE) {
      const step = (24 * dpr) / R;
      ctx.strokeStyle = 'rgba(66,66,66,0.7)';
      ctx.beginPath();
      let n = 0;
      for (let ang = -Math.PI / 2; ang <= a1; ang += step, n++) {
        for (const sg of n === 0 ? [1] : [1, -1]) {
          const q = -Math.PI / 2 + (ang + Math.PI / 2) * sg;
          const len = n % 5 === 0 ? 6 : 3;
          const c = Math.cos(q);
          const sn = Math.sin(q);
          ctx.moveTo(Math.round(cx + c * (R + 2)) + 0.5, Math.round(cy + sn * (R + 2)) + 0.5);
          ctx.lineTo(Math.round(cx + c * (R + 2 + len * dpr)) + 0.5, Math.round(cy + sn * (R + 2 + len * dpr)) + 0.5);
        }
      }
      ctx.stroke();
    }
    // photon : une étincelle LED de 28 px parcourt le limbe, plus vite au survol
    const per = 5200 / (1 + state.hover * 1.2);
    const u = ((now % per) / per) * 2 - 1; // -1 → 1
    const pa = -Math.PI / 2 + u * half;
    const dashLen = 28 * dpr;
    ctx.setLineDash([dashLen, 100000]);
    ctx.lineDashOffset = -(R * (pa - a0) - dashLen);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy + 0.5, R, a0, a1);
    ctx.stroke();
    ctx.setLineDash([]);
    // axe : le soleil monte sur l'axe du réticule ; un tick LED sous l'apex le rappelle
    if (t < T_COLLAPSE) {
      ctx.fillStyle = `rgba(196,30,58,${(0.35 + dawn * 0.4).toFixed(3)})`;
      ctx.fillRect(Math.round(cx) - Math.round(dpr / 2), Math.round(cy - R) + 2 * dpr, Math.max(1, Math.round(dpr)), 5 * dpr);
    }
  }

  function draw(now) {
    const t = launchAt < 0 ? -1 : now - launchAt;
    const p = frameParams(now, t);
    const t0 = performance.now();
    render(sc, img.data, lumBuf, p);
    offCtx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, PW, PH);
    if (t >= T_LED) {
      // Effondrement : la scène entière se resserre sur l'axe du logotype (miroir de .collapse)
      const k = easeInOut(clamp01((t - T_LED) / (T_DONE - T_LED)));
      const sq = 1 - k;
      const cyp = launchCY * dpr;
      ctx.globalAlpha = 1 - k * 0.92;
      ctx.drawImage(off, 0, 0, sc.BW, sc.BH, 0, cyp * (1 - sq), sc.BW * cell, sc.BH * cell * sq);
      ctx.globalAlpha = 1;
      if (k < 1) {
        // ligne de lumière blanche résiduelle sur l'axe
        const g = ctx.createLinearGradient(0, 0, PW, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, `rgba(255,255,255,${(0.6 * (1 - k)).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, Math.round(cyp), PW, 1);
      }
    } else {
      ctx.drawImage(off, 0, 0, sc.BW, sc.BH, 0, 0, sc.BW * cell, sc.BH * cell);
    }
    overlay(now, t, p.dawn);
    // Adaptation : si une image coûte trop, on grossit le texel (jamais sous 30 ips)
    const ms = performance.now() - t0;
    cost = cost * 0.9 + ms * 0.1;
    if (cost > 9 && cell < cellFloor + 2 && t < 0) {
      cell += 1;
      cost = 4;
      rebuild();
    }
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(50, now - (last || now));
    last = now;
    // survol : montée douce, descente douce
    state.hover += (state.hoverT - state.hover) * (1 - Math.exp(-dt / 260));
    state.px += (state.ptx - state.px) * (1 - Math.exp(-dt / 400));
    state.py += (state.pty - state.py) * (1 - Math.exp(-dt / 400));
    const launching = launchAt >= 0;
    const lt = launching ? now - launchAt : -1;
    state.rot += dt * 0.00003 * (1 + state.hover * 0.6 + (launching ? 3 * easeOut(clamp01(lt / T_RING)) : 0));
    state.gap += dt * 0.00012;
    draw(now);
  }

  function start() {
    if (running) return;
    if (!sc) rebuild();
    if (reducedMotion) {
      running = true;
      draw(performance.now());
      running = false;
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
  function setHover(on) {
    state.hoverT = on ? 1 : 0;
  }
  /** Fusion avec le circuit : à appeler au début de playTransfer(). */
  function launch() {
    if (launchAt >= 0) return;
    const word = document.getElementById('word');
    const r = word ? word.getBoundingClientRect() : null;
    launchCY = r ? r.top + r.height / 2 : root.innerHeight * 0.44;
    elAtLaunch = elevation(performance.now(), -1);
    launchAt = performance.now();
    state.hoverT = 0;
    if (reducedMotion) {
      running = true;
      // performance.now() peut être < T_DONE à l'ouverture : un launchAt négatif
      // serait lu comme « pas de lancement » (sentinelle < 0) et redessinerait l'aube de repos.
      const now = Math.max(performance.now(), T_DONE);
      launchAt = now - T_DONE;
      draw(now);
      running = false;
    }
  }

  // Réactivité : parallaxe au pointeur, aube anticipée au survol de « Lancer le desk »
  root.addEventListener(
    'pointermove',
    (e) => {
      state.ptx = (e.clientX / root.innerWidth) * 2 - 1;
      state.pty = (e.clientY / root.innerHeight) * 2 - 1;
    },
    { passive: true },
  );
  root.addEventListener('pointerleave', () => {
    state.ptx = 0;
    state.pty = 0;
  });
  const btn = document.getElementById('btn-launch');
  if (btn) {
    btn.addEventListener('mouseenter', () => setHover(true));
    btn.addEventListener('mouseleave', () => setHover(false));
    btn.addEventListener('focus', () => setHover(true));
    btn.addEventListener('blur', () => setHover(false));
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  root.addEventListener('resize', () => {
    if (!sc) return;
    cell = cellFloor;
    rebuild();
  });

  root.cantoAube = { start, stop, launch, setHover, isRunning: () => running };
  start();
})();
