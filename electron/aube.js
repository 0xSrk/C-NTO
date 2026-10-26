/* ═══════════════════════════════════════════════════════════════════════════════
   CΛNTO · Lanceur · AUBE IV « ΟΡΟΣ » — l'aube se lève sur l'horizon du sceau
   SIΞRRΛSKΛ Lab · Artefact 002

   Calque vectoriel (Canvas 2D, 1 px physique) sous l'interface du lanceur. Plus de scène 3D :
   le Système 4.0 est une nuit, des filets et une LED. Ce calque dessine ce que le DOM ne sait pas
   dessiner net :
     - la graduation de l'horizon, au pas de 8 px (majeure tous les 40 px) ;
     - pendant l'aube (temps --t-* de la feuille) : la graduation qui naît avec la lentille, l'onde de
       la frappe du sceau, l'éclair de l'horizon quand le sceau s'y plie, l'éclat de la LED qui se pose ;
     - la lumière de la LED d'or posée sur la pointe du Λ (son halo, jamais une ombre décorative) ;
     - au départ, le retour de la LED sur l'horizon et la couture de lumière qui ouvre le desk.
   Au repos, une image et plus aucune boucle. Couleurs : les jetons de la feuille (--gold, --text-0).

   CSP `script-src 'self'` : aucun eval. API : window.cantoAube
     launch(): Promise<void>  — résout quand le circuit doit prendre la main (CFG.pre)
     rest()                   — l'aube abrégée : la lumière du repos, tout de suite
     start() · stop() · isRunning() · handoffAt (lecture) · quality (lecture)
   ═══════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const VERSION = '4.0.0';

  /* ── Timeline du circuit (miroir de runTransfer() dans launcher-ui.js) ── */
  const T_DONE = 1520;

  const CFG = {
    pre: 1350, // retour de la LED + couture avant la main au circuit (ms) — miroir dans tests/launcher-transfer.test.ts
    horizon: 244, // px CSS, repli quand la feuille ne donne pas --H
    step: 8, // pas de la graduation
    major: 40, // graduation majeure
    back: 520, // la LED quitte la pointe du Λ et revient au centre de l'horizon (ms)
  };

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const win = (t, a, b) => clamp01((t - a) / (b - a));

  const host = document.getElementById('aube');
  const canvas = document.getElementById('aube-vec');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ── Jetons de la feuille : couleur en « r,g,b », longueur en px ── */
  function token(name, fallback) {
    const root = document.documentElement;
    if (!root || typeof getComputedStyle !== 'function') return fallback;
    const value = getComputedStyle(root).getPropertyValue(name).trim();
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
    if (hex) return [hex[1], hex[2], hex[3]].map((h) => parseInt(h, 16)).join(',');
    const px = parseFloat(value);
    return Number.isFinite(px) ? px : fallback;
  }
  const GOLD = token('--gold', '204,176,102');
  const INK = token('--text-0', '245,242,234');

  /* ── Temps de l'aube (ms), lus sur la feuille (--t-*) : la lumière suit la même partition que le DOM ── */
  const ms = (name, fallback) => {
    const s = token(name, NaN);
    return Number.isFinite(s) && s > 0 ? s * 1000 : fallback;
  };
  const T = {
    horizon: ms('--t-horizon', 100),
    strike: ms('--t-strike', 300),
    fold: ms('--t-fold', 720),
    land: ms('--t-land', 1550),
    rest: ms('--t-rest', 2800),
  };
  /** Hauteur du sceau (px) : son centre est à 12,8 / 740 de sa hauteur sous l'horizon. */
  const SEAL_H = token('--seal-h', 400);

  /* ── Tailles ── */
  let W = 0;
  let H = 0;
  let dpr = 1;
  let HZ = CFG.horizon;
  function resize() {
    dpr = Math.min(3, window.devicePixelRatio || 1);
    W = window.innerWidth || 420;
    H = window.innerHeight || 620;
    HZ = token('--H', CFG.horizon);
    if (!canvas) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const snap = (v) => (Math.round(v * dpr) + 0.5) / dpr;

  /** Pointe du Λ, centre et bords optiques du logotype posé (grille 640 × 160). */
  function anchors() {
    const word = document.getElementById('word');
    const r = word && word.getBoundingClientRect ? word.getBoundingClientRect() : null;
    if (!r || !r.width) return { cx: W / 2, cy: HZ, ax: W / 2 - 56, ay: HZ - 25, left: W / 2 - 137, right: W / 2 + 137 };
    return {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      ax: r.left + (208 / 640) * r.width,
      ay: r.top + (30 / 160) * r.height,
      left: r.left + (46.5 / 640) * r.width,
      right: r.left + (593.5 / 640) * r.width,
    };
  }

  /* ── Dessin ── */

  /** Graduation de l'horizon : du centre vers les bords, plus discrète sous le logotype. `reveal(d)` la fait naître. */
  function graduation(a, light, reveal) {
    if (light <= 0) return;
    ctx.lineWidth = 1 / dpr;
    const y = snap(HZ + 4);
    for (let d = 0; d <= W / 2; d += CFG.step) {
      const seen = reveal ? reveal(d) : 1;
      if (seen <= 0) continue;
      const isMajor = d % CFG.major === 0;
      for (const x of d === 0 ? [W / 2] : [W / 2 - d, W / 2 + d]) {
        const under = x > a.left - 8 && x < a.right + 8 ? 0.35 : 1;
        const edge = 1 - 0.6 * (d / (W / 2));
        ctx.strokeStyle = `rgba(${INK},${(isMajor ? 0.32 : 0.16) * light * under * edge * seen})`;
        ctx.beginPath();
        ctx.moveTo(snap(x), y);
        ctx.lineTo(snap(x), y + (isMajor ? 5 : 2));
        ctx.stroke();
      }
    }
  }

  /** Halo de la LED : la lumière d'un point d'or, rien de plus. */
  function glow(x, y, radius, alpha) {
    if (alpha <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(${GOLD},${alpha})`);
    g.addColorStop(0.3, `rgba(${GOLD},${alpha * 0.28})`);
    g.addColorStop(1, `rgba(${GOLD},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  /** Repos : la graduation et le halo de la LED sur la pointe du Λ. */
  function drawRest(a) {
    graduation(a, 1);
    glow(a.ax, a.ay, 44, 0.12);
  }

  /** Aube : la graduation naît avec la lentille, l'onde de la frappe, l'éclair du pli, l'éclat de la pose. */
  function drawIntro(a, t) {
    // La graduation naît du centre vers les bords, dans le sillage de la lentille.
    const g0 = T.horizon + 120;
    graduation(a, 1, (d) => win(t, g0 + 360 * (d / (W / 2)), g0 + 360 * (d / (W / 2)) + 90));
    // L'onde de la frappe : un filet qui part du centre du sceau quand il touche l'horizon.
    const shock = win(t, T.strike + 90, T.strike + 700);
    if (shock > 0 && shock < 1) {
      const cy = HZ + (12.8 / 740) * SEAL_H;
      ctx.lineWidth = 1 / dpr;
      ctx.strokeStyle = `rgba(${INK},${0.34 * (1 - shock)})`;
      ctx.beginPath();
      ctx.arc(W / 2, cy, 40 + easeOut(shock) * 300, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Le pli : le sceau rentre dans la ligne, la ligne s'embrase, le soleil s'annonce au centre.
    const flash = win(t, T.fold + 200, T.fold + 560);
    if (flash > 0 && flash < 1) {
      const k = 1 - easeOut(flash);
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, `rgba(${INK},0)`);
      g.addColorStop(0.5, `rgba(${INK},${0.85 * k})`);
      g.addColorStop(1, `rgba(${INK},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.round(HZ * dpr) / dpr - 0.5 / dpr, W, 1 / dpr + 0.5);
      glow(W / 2, HZ, 90, 0.34 * k);
    }
    // La pose : la LED arrive sur la pointe, son halo s'allume d'un éclat puis se tient.
    const land = win(t, T.land, T.land + 500);
    if (land > 0) glow(a.ax, a.ay, 44 + 26 * (1 - land), 0.12 + 0.34 * (1 - easeOut(land)));
  }

  /** Départ : la LED revient de la pointe au centre de l'horizon, la couture de lumière s'ouvre le long de lui. */
  function drawLaunch(a, t) {
    const back = easeInOut(win(t, 0, CFG.back));
    const x = a.ax + (a.cx - a.ax) * back;
    const y = a.ay + (HZ - a.ay) * back;
    graduation(a, 1 - win(t, 0, 420));
    const open = easeOut(win(t, CFG.back - 120, CFG.pre));
    if (open > 0) {
      const half = (W / 2) * open;
      const g = ctx.createLinearGradient(a.cx - half, 0, a.cx + half, 0);
      g.addColorStop(0, `rgba(${INK},0)`);
      g.addColorStop(0.5, `rgba(${INK},${0.9 * open})`);
      g.addColorStop(1, `rgba(${INK},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(a.cx - half, Math.round(HZ * dpr) / dpr - 0.5 / dpr, half * 2, 1 / dpr + 0.5);
      const band = 2 + 18 * open;
      const v = ctx.createLinearGradient(0, HZ - band, 0, HZ + band);
      v.addColorStop(0, `rgba(${GOLD},0)`);
      v.addColorStop(0.5, `rgba(${GOLD},${0.1 * open})`);
      v.addColorStop(1, `rgba(${GOLD},0)`);
      ctx.fillStyle = v;
      ctx.fillRect(a.cx - half, HZ - band, half * 2, band * 2);
    }
    glow(x, y, 44 + 30 * open, 0.18 + 0.3 * open);
    ctx.fillStyle = `rgba(${GOLD},1)`;
    ctx.fillRect(Math.round((x - 2.5) * dpr) / dpr, Math.round((y - 2.5) * dpr) / dpr, 5, 5);
  }

  /* ══════════════════════════════════════════════════════════════════════════════
     BOUCLE
     ══════════════════════════════════════════════════════════════════════════════ */
  let running = false;
  let raf = 0;
  let launchAt = -1;
  let handoffAt = -1;
  let resolveLaunch = null;
  const introAt = performance.now();
  let introDone = reducedMotion;

  function settle() {
    if (resolveLaunch) {
      resolveLaunch();
      resolveLaunch = null;
    }
  }

  function render(now) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const a = anchors();
    if (launchAt >= 0) drawLaunch(a, now - launchAt);
    else if (!introDone && now - introAt < T.rest) drawIntro(a, now - introAt);
    else {
      introDone = true;
      drawRest(a);
    }
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(); // même horloge que launch() : aucune dérive possible
    render(now);
    if (launchAt >= 0 && handoffAt < 0 && now - launchAt >= CFG.pre) {
      handoffAt = now;
      settle();
    }
    // Au repos, rien ne bouge : une image suffit, la boucle s'arrête.
    if (launchAt < 0 && introDone) stop();
    else if (handoffAt >= 0 && now - handoffAt > T_DONE + 600) stop();
  }

  function start() {
    if (running) return;
    if (reducedMotion && launchAt < 0) {
      render(performance.now());
      return;
    }
    running = true;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    settle();
  }

  /** L'aube abrégée (touche, clic) : la lumière du repos, tout de suite, et plus aucune image. */
  function rest() {
    introDone = true;
    if (launchAt >= 0) return;
    stop();
    render(performance.now());
  }

  /** Retour de la LED et couture. Résout quand le circuit doit prendre la main. */
  function launch() {
    if (launchAt >= 0) return Promise.resolve();
    const now = performance.now();
    launchAt = now;
    if (reducedMotion) {
      handoffAt = now;
      render(now);
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

  window.addEventListener('resize', () => {
    resize();
    render(performance.now());
  });

  resize();
  if (host && host.classList) host.classList.add('vec');
  const api = {
    version: VERSION,
    launch,
    start,
    stop,
    rest,
    isRunning: () => running,
    get handoffAt() {
      return handoffAt;
    },
    get quality() {
      return { tier: 'vector', scale: dpr };
    },
  };
  window.cantoAube = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  start();
})();
