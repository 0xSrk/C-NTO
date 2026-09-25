/* UI du lanceur — plain JS. Transition : le circuit converge sur le logotype, qui s'effondre en LED. */
(function () {
  const COPY = {
    fr: {
      close: 'Fermer',
      lang: 'Langue du desk',
      launch: 'Lancer le desk',
      update: 'Mettre à jour',
      updateRelaunch: 'Mettre à jour et relancer',
      updating: 'Mise à jour…',
      checking: 'Contrôle de version…',
      shell: 'Shell indisponible',
      upToDate: 'À jour',
      available: 'disponible',
      linking: 'Liaison du circuit',
      opening: 'Ouverture du desk',
      dirty: 'Fichiers modifiés dans le dossier',
      dirtyHint: 'cliquez à nouveau pour les mettre de côté (git stash, réversible) et mettre à jour.',
      stashUpdate: 'Mettre de côté et mettre à jour',
      releasesOpen: 'Page des versions ouverte',
      availableOpen: 'dispo — page des versions ouverte',
      restarting: 'Redémarrage…',
      downloading: 'Téléchargement',
      verified: 'Vérifié (SHA-256) — installation et redémarrage…',
      installerOpened: 'Installeur ouvert — terminez l’installation puis relancez CΛNTO',
      updateFail: 'Échec de la mise à jour',
    },
    en: {
      close: 'Close',
      lang: 'Desk language',
      launch: 'Launch the desk',
      update: 'Update',
      updateRelaunch: 'Update and relaunch',
      updating: 'Updating…',
      checking: 'Checking version…',
      shell: 'Shell unavailable',
      upToDate: 'Up to date',
      available: 'available',
      linking: 'Linking the circuit',
      opening: 'Opening the desk',
      dirty: 'Files changed in the folder',
      dirtyHint: 'click again to set them aside (git stash, reversible) and update.',
      stashUpdate: 'Set aside and update',
      releasesOpen: 'Releases page opened',
      availableOpen: 'available — releases page opened',
      restarting: 'Restarting…',
      downloading: 'Downloading',
      verified: 'Verified (SHA-256) — installing and restarting…',
      installerOpened: 'Installer opened — finish the install, then relaunch CΛNTO',
      updateFail: 'Update failed',
    },
    es: {
      close: 'Cerrar',
      lang: 'Idioma del desk',
      launch: 'Abrir el desk',
      update: 'Actualizar',
      updateRelaunch: 'Actualizar y reiniciar',
      updating: 'Actualizando…',
      checking: 'Comprobando la versión…',
      shell: 'Shell no disponible',
      upToDate: 'Al día',
      available: 'disponible',
      linking: 'Enlazando el circuito',
      opening: 'Abriendo el desk',
      dirty: 'Archivos modificados en la carpeta',
      dirtyHint: 'haga clic de nuevo para apartarlos (git stash, reversible) y actualizar.',
      stashUpdate: 'Apartar y actualizar',
      releasesOpen: 'Página de versiones abierta',
      availableOpen: 'disponible — página de versiones abierta',
      restarting: 'Reinicio…',
      downloading: 'Descargando',
      verified: 'Verificado (SHA-256) — instalando y reiniciando…',
      installerOpened: 'Instalador abierto — termine la instalación y reinicie CΛNTO',
      updateFail: 'Error de la actualización',
    },
  };

  const $ = (id) => document.getElementById(id);
  const meta = $('meta');
  const metaText = $('meta-text');
  const btnLaunch = $('btn-launch');
  const btnLaunchLabel = $('btn-launch-label');
  const btnUpdate = $('btn-update');
  const btnUpdateLabel = $('btn-update-label');
  const btnClose = $('btn-close');
  const langLabel = $('lang-label');
  const langRow = $('lang-row');
  const frame = $('frame');
  const word = $('word');
  const xfer = $('xfer');
  const nano = $('nano');
  const hudText = $('hud-text');
  const hudFill = $('hud-fill');
  const hudCount = $('hud-count');
  const hudClock = $('hud-clock');

  const LOCALES = ['fr', 'en', 'es'];
  const fromQuery = new URLSearchParams(location.search).get('lang');
  let locale = LOCALES.includes(fromQuery) ? fromQuery : 'fr';
  let status = null;
  let applying = false;
  /** Modifications locales détectées : le prochain clic confirme le stash. */
  let stashArmed = false;
  let launching = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function L() {
    return COPY[locale];
  }

  function paintLocale() {
    const c = L();
    document.documentElement.lang = locale;
    btnClose.setAttribute('aria-label', c.close);
    btnClose.title = c.close;
    langLabel.textContent = c.lang;
    btnLaunchLabel.textContent = c.launch;
    const buttons = langRow.querySelectorAll('button');
    buttons.forEach((button, index) => {
      const on = button.getAttribute('data-locale') === locale;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) langRow.style.setProperty('--at', String(index));
    });
    if (!status && !window.canto?.update) {
      setMeta(c.shell, 'err');
      return;
    }
    paint();
  }

  /** Nomme les fichiers en cause : trois chemins, puis « +N ». */
  function dirtyMessage(files) {
    const list = Array.isArray(files) ? files : [];
    const shown = list.slice(0, 3).join(', ') + (list.length > 3 ? ' +' + (list.length - 3) : '');
    return L().dirty + (shown ? ' : ' + shown : '') + ' — ' + L().dirtyHint;
  }

  function setMeta(text, kind) {
    metaText.textContent = text;
    meta.className = 'meta' + (kind ? ' ' + kind : '');
  }

  function paint() {
    if (!status) return;
    const { current, latest, available, error } = status;
    if (error && !available) {
      setMeta(error, 'err');
      btnUpdate.hidden = true;
      return;
    }
    if (available) {
      btnUpdate.hidden = false;
      btnUpdate.classList.add('update');
      btnUpdate.classList.toggle('busy', applying);
      btnUpdateLabel.textContent = applying ? L().updating : stashArmed ? L().stashUpdate : L().updateRelaunch;
      btnUpdate.disabled = applying || launching;
      btnLaunch.disabled = applying || launching;
      setMeta(`v${current} → v${latest ?? '…'} ${L().available}`, 'warn');
    } else {
      btnUpdate.hidden = true;
      btnLaunch.disabled = launching;
      setMeta(`${L().upToDate} · v${current}`, 'ok');
    }
  }

  async function refresh() {
    if (!window.canto?.update) {
      setMeta(L().shell, 'err');
      return;
    }
    setMeta(L().checking, 'busy');
    status = await window.canto.update.check();
    paint();
  }

  /* ─── Règles du réticule : graduation 8 px, majeure tous les 40 px ─── */
  (function paintTicks() {
    const g = $('ticks');
    if (!g) return;
    const NS = 'http://www.w3.org/2000/svg';
    let d = '';
    let dMajor = '';
    for (let y = 40; y <= 580; y += 8) {
      const major = (y - 40) % 40 === 0;
      const len = major ? 6 : 3;
      const seg = `M17 ${y + 0.5}h${len}M${403 - len} ${y + 0.5}h${len}`;
      if (major) dMajor += seg;
      else d += seg;
    }
    for (const [cls, path] of [
      ['tick', d],
      ['tick major', dMajor],
    ]) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('class', cls);
      p.setAttribute('d', path);
      g.appendChild(p);
    }
  })();

  /* ─── Circuit de transition ─────────────────────────────────────────────
     Traces à 45° façon PCB, tracées par des photons (tête lumineuse + traîne),
     nano-pixels 1×1 qui s'allument au passage, anneau autour du logotype puis
     effondrement du logotype en une LED unique au centre. */

  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  function polyLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return len;
  }

  /** Point à la distance `d` le long de la polyligne. */
  function pointAt(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (d <= seg) {
        const k = seg ? d / seg : 0;
        return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
      }
      d -= seg;
    }
    return pts[pts.length - 1];
  }

  function buildCircuit(W, H, cx, cy, ring) {
    const traces = [];
    const add = (pts, opts) => traces.push({ pts, len: polyLength(pts), ...opts });

    // Bus haut et bas : 11 voies qui s'évasent à 32 px et convergent à 16 px sur l'anneau.
    for (const dir of [-1, 1]) {
      const edgeY = dir < 0 ? 64 : H - 76;
      const ringY = dir < 0 ? ring.y0 : ring.y1;
      const bendEnd = ringY + dir * -16;
      for (let j = -5; j <= 5; j++) {
        const xs = cx + j * 32;
        const xe = cx + j * 16;
        const dx = Math.abs(xs - xe);
        const bendStart = bendEnd + dir * dx;
        const pts = [
          [xs, edgeY],
          [xs, bendStart],
          [xe, bendEnd],
          [xe, ringY],
        ];
        add(pts, {
          delay: 90 + Math.abs(j) * 34 + (dir > 0 ? 40 : 0),
          speed: 0.62 + (5 - Math.abs(j)) * 0.03,
          led: false,
          alpha: j === 0 ? 0.3 : 0.16,
        });
      }
    }
    // Voies latérales : trois de chaque côté, l'axe central en LED.
    for (const side of [-1, 1]) {
      const edgeX = side < 0 ? 32 : W - 32;
      const ringX = side < 0 ? ring.x0 : ring.x1;
      for (let k = -2; k <= 2; k++) {
        const y = cy + k * 12;
        const pts = [
          [edgeX, y + k * 12],
          [ringX + side * (16 + Math.abs(k) * 12), y + k * 12],
          [ringX + side * 16, y],
          [ringX, y],
        ];
        if (k === 0) pts.splice(1, 2);
        add(pts, { delay: 40 + Math.abs(k) * 50, speed: 0.34, led: k === 0, alpha: k === 0 ? 0.5 : 0.16 });
      }
    }
    return traces;
  }

  function runTransfer() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    nano.width = Math.round(W * dpr);
    nano.height = Math.round(H * dpr);
    const ctx = nano.getContext('2d');
    if (!ctx) return Promise.resolve();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const hair = 1 / dpr; // 1 pixel physique : la finesse maximale de l'écran
    const snap = (v) => (Math.round(v * dpr) + 0.5) / dpr;

    const r = word.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const ring = {
      x0: Math.round(r.left) - 16,
      x1: Math.round(r.right) + 16,
      y0: Math.round(r.top) - 20,
      y1: Math.round(r.bottom) + 20,
    };
    const traces = buildCircuit(W, H, cx, cy, ring);
    for (const t of traces) t.end = t.delay + t.len / t.speed;

    // Nano-pixels : ceux posés sur les traces s'allument au passage du photon,
    // ceux du champ scintillent au hasard, sur la grille de 8 px.
    const pix = [];
    for (const t of traces) {
      for (let d = 4; d < t.len; d += 8) {
        const [x, y] = pointAt(t.pts, d);
        pix.push({ x, y, at: t.delay + d / t.speed, base: t.led ? 0.5 : 0.28, led: t.led });
      }
    }
    for (let y = 64; y < H - 80; y += 8) {
      for (let x = 32; x <= W - 32; x += 8) {
        if (Math.random() > 0.075) continue;
        const dist = Math.hypot(x - cx, y - cy);
        pix.push({ x, y, at: 120 + dist * 1.6 + Math.random() * 240, base: 0.1, led: Math.random() < 0.06 });
      }
    }

    // Cadres incrustés à chanfreins, tracés depuis l'axe haut vers le bas, symétriques.
    const insets = [24].map((m, i) => {
      const c = 8;
      const half = [
        [W / 2, m],
        [W - m - c, m],
        [W - m, m + c],
        [W - m, H - m - c],
        [W - m - c, H - m],
        [W / 2, H - m],
      ];
      return { half, len: polyLength(half), delay: 60 + i * 110, dur: 760, alpha: i ? 0.07 : 0.11 };
    });

    const ringHalf = [
      [cx, ring.y0],
      [ring.x1 - 6, ring.y0],
      [ring.x1, ring.y0 + 6],
      [ring.x1, ring.y1 - 6],
      [ring.x1 - 6, ring.y1],
      [cx, ring.y1],
    ];
    const ringLen = polyLength(ringHalf);

    const T_RING = 560;
    const T_COLLAPSE = 1000;
    const T_LED = 1260;
    const T_DONE = 1520;
    const total = traces.length;

    function strokePoly(pts, upTo, mirrorX) {
      let left = upTo;
      ctx.beginPath();
      const map = (p) => [snap(mirrorX ? 2 * mirrorX - p[0] : p[0]), snap(p[1])];
      let [x, y] = map(pts[0]);
      ctx.moveTo(x, y);
      for (let i = 1; i < pts.length && left > 0; i++) {
        const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (left >= seg) {
          [x, y] = map(pts[i]);
          ctx.lineTo(x, y);
        } else {
          const k = left / seg;
          const p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
          [x, y] = map(p);
          ctx.lineTo(x, y);
        }
        left -= seg;
      }
      ctx.stroke();
    }

    function photon(x, y, led, strength) {
      const rad = 10;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, led ? `rgba(255,70,96,${0.55 * strength})` : `rgba(255,255,255,${0.45 * strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      ctx.fillStyle = led ? `rgba(255,120,140,${strength})` : `rgba(255,255,255,${strength})`;
      ctx.fillRect(Math.round(x * dpr) / dpr - hair, Math.round(y * dpr) / dpr - hair, 2 * hair + 1 / dpr, 2 * hair + 1 / dpr);
    }

    return new Promise((resolve) => {
      const t0 = performance.now();
      let resolved = false;
      let collapsed = false;

      function frameTick(now) {
        const t = now - t0;
        ctx.clearRect(0, 0, W, H);
        ctx.lineCap = 'square';
        ctx.lineJoin = 'miter';

        // Montée d'énergie après l'allumage de la LED : tout le circuit pulse une fois.
        const surge = t > T_LED ? Math.exp(-(t - T_LED) / 220) : 0;
        const hold = t > T_DONE ? 0.5 + 0.5 * Math.sin((t - T_DONE) / 380) : 0;

        // Cadres incrustés
        ctx.lineWidth = hair;
        for (const f of insets) {
          const p = easeInOut(clamp01((t - f.delay) / f.dur));
          if (p <= 0) continue;
          ctx.strokeStyle = `rgba(255,255,255,${f.alpha + surge * 0.12})`;
          strokePoly(f.half, f.len * p, 0);
          strokePoly(f.half, f.len * p, W / 2);
        }

        // Traces + photons
        let linked = 0;
        for (const tr of traces) {
          const d = (t - tr.delay) * tr.speed;
          if (d <= 0) continue;
          const drawn = Math.min(tr.len, d);
          const done = d >= tr.len;
          if (done) linked++;
          const a = tr.alpha + surge * (tr.led ? 0.4 : 0.25);
          ctx.lineWidth = tr.led ? 1 / Math.min(dpr, 2) : hair;
          ctx.strokeStyle = tr.led ? `rgba(196,30,58,${a})` : `rgba(255,255,255,${a})`;
          strokePoly(tr.pts, drawn, 0);
          // Traîne : 40 px en dégradé derrière la tête
          if (!done) {
            const TAIL = 40;
            for (let k = 0; k < TAIL; k += 4) {
              const s0 = drawn - k;
              if (s0 <= 0) break;
              const [x1, y1] = pointAt(tr.pts, s0);
              const [x2, y2] = pointAt(tr.pts, Math.max(0, s0 - 4));
              const fade = 1 - k / TAIL;
              ctx.strokeStyle = tr.led ? `rgba(255,80,104,${0.8 * fade})` : `rgba(255,255,255,${0.7 * fade})`;
              ctx.beginPath();
              ctx.moveTo(snap(x2), snap(y2));
              ctx.lineTo(snap(x1), snap(y1));
              ctx.stroke();
            }
            const [hx, hy] = pointAt(tr.pts, drawn);
            photon(hx, hy, tr.led, 1);
          } else {
            // Via : carré 3 px qui flashe à l'arrivée sur l'anneau
            const since = t - tr.end;
            const [vx, vy] = tr.pts[tr.pts.length - 1];
            const va = 0.35 + 0.65 * Math.exp(-since / 160) + surge * 0.4;
            ctx.strokeStyle = tr.led ? `rgba(196,30,58,${va})` : `rgba(255,255,255,${va * 0.8})`;
            ctx.lineWidth = hair;
            ctx.strokeRect(snap(vx - 1.5), snap(vy - 1.5), 3, 3);
            if (since < 200) photon(vx, vy, tr.led, 1 - since / 200);
          }
        }

        // Nano-pixels
        for (const p of pix) {
          if (t < p.at) continue;
          const k = Math.exp(-(t - p.at) / 200);
          const a = Math.min(1, p.base + 0.8 * k + surge * 0.3 + hold * 0.06 * p.base);
          ctx.fillStyle = p.led ? `rgba(196,30,58,${a})` : `rgba(255,255,255,${a})`;
          ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        }

        // Anneau autour du logotype + équerres LED
        const rp = easeOut(clamp01((t - T_RING) / 420));
        if (rp > 0) {
          ctx.lineWidth = hair;
          ctx.strokeStyle = `rgba(255,255,255,${0.22 + surge * 0.3})`;
          strokePoly(ringHalf, ringLen * rp, 0);
          strokePoly(ringHalf, ringLen * rp, cx);
          const ba = clamp01((t - T_RING - 260) / 160);
          if (ba > 0) {
            const off = 6 * (1 - easeOut(ba));
            ctx.strokeStyle = `rgba(196,30,58,${0.9 * ba})`;
            ctx.lineWidth = 1 / Math.min(dpr, 2);
            const B = 8;
            const corners = [
              [ring.x0 - 4 - off, ring.y0 - 4 - off, 1, 1],
              [ring.x1 + 4 + off, ring.y0 - 4 - off, -1, 1],
              [ring.x0 - 4 - off, ring.y1 + 4 + off, 1, -1],
              [ring.x1 + 4 + off, ring.y1 + 4 + off, -1, -1],
            ];
            for (const [x, y, sx, sy] of corners) {
              ctx.beginPath();
              ctx.moveTo(snap(x), snap(y + sy * B));
              ctx.lineTo(snap(x), snap(y));
              ctx.lineTo(snap(x + sx * B), snap(y));
              ctx.stroke();
            }
          }
        }

        // Effondrement : le logotype devient un trait sur son axe, qui se resserre en LED.
        if (t >= T_COLLAPSE && !collapsed) {
          collapsed = true;
          frame.classList.add('collapse');
        }
        if (t >= T_COLLAPSE + 120) {
          const k = easeInOut(clamp01((t - T_COLLAPSE - 120) / (T_LED - T_COLLAPSE - 120)));
          const halfW = (r.width / 2) * (1 - k);
          if (halfW > 0.5) {
            const g = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(0.5, `rgba(255,255,255,${0.95})`);
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(cx - halfW, Math.round(cy * dpr) / dpr, halfW * 2, 1 / dpr);
          }
        }
        if (t >= T_LED) {
          const since = t - T_LED;
          // Impulsions carrées concentriques
          for (let i = 0; i < 3; i++) {
            const pt = (since - i * 90) / 700;
            if (pt <= 0 || pt >= 1) continue;
            const s = 4 + easeOut(pt) * 120;
            ctx.strokeStyle = `rgba(196,30,58,${0.55 * (1 - pt)})`;
            ctx.lineWidth = hair;
            ctx.strokeRect(snap(cx - s), snap(cy - s / 3), s * 2, (s * 2) / 3);
          }
          const breathe = t > T_DONE ? 0.75 + 0.25 * Math.sin((t - T_DONE) / 300) : 1;
          const glowR = 28 + surge * 40;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
          g.addColorStop(0, `rgba(196,30,58,${0.55 * breathe + surge * 0.3})`);
          g.addColorStop(0.35, `rgba(196,30,58,${0.12 * breathe})`);
          g.addColorStop(1, 'rgba(196,30,58,0)');
          ctx.fillStyle = g;
          ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
          ctx.fillStyle = `rgba(255,${Math.round(120 + surge * 100)},${Math.round(140 + surge * 90)},1)`;
          ctx.fillRect(cx - 1, cy - 1, 2, 2);
        }

        // Télémétrie
        const pct = Math.round(clamp01(t / T_DONE) * 100);
        hudFill.style.width = pct + '%';
        hudCount.textContent = String(linked).padStart(3, '0') + ' / ' + String(total).padStart(3, '0');
        hudClock.textContent = 'T+' + (t / 1000).toFixed(3);

        if (t >= T_DONE && !resolved) {
          resolved = true;
          resolve();
        }
        // La boucle continue (LED qui respire) jusqu'à la fermeture du lanceur.
        requestAnimationFrame(frameTick);
      }
      requestAnimationFrame(frameTick);
    });
  }

  function playTransfer() {
    frame.classList.add('leaving');
    xfer.classList.add('on');
    hudText.textContent = L().linking;
    if (reducedMotion) return new Promise((resolve) => setTimeout(resolve, 160));
    return runTransfer();
  }

  async function launch() {
    if (launching || btnLaunch.disabled) return;
    launching = true;
    btnLaunch.disabled = true;
    paint();
    await playTransfer();
    hudText.textContent = L().opening;
    await window.canto.update.startDesk();
  }

  btnLaunch.addEventListener('click', () => void launch());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && document.activeElement === document.body) void launch();
    if (event.key === 'Escape' && !launching) window.canto?.window.close();
  });

  btnUpdate.addEventListener('click', async () => {
    if (applying || launching) return;
    applying = true;
    paint();
    // Application installée : progression du téléchargement de l'installeur.
    const stopProgress = window.canto.update.onProgress?.((p) => {
      const mb = (n) => (n / 1048576).toFixed(0);
      const pct = p.total ? ' · ' + Math.floor((p.received / p.total) * 100) + ' %' : '';
      setMeta(L().downloading + pct + ' · ' + mb(p.received) + (p.total ? ' / ' + mb(p.total) : '') + ' Mo', 'busy');
    });
    try {
      status = await window.canto.update.apply({ confirmStash: stashArmed });
      stopProgress?.();
      if (status.error) {
        applying = false;
        stashArmed = status.error === 'dirty_needs_stash';
        paint();
        setMeta(stashArmed ? dirtyMessage(status.dirtyFiles) : status.error, stashArmed ? 'warn' : 'err');
        return;
      }
      stashArmed = false;
      if (!status.applied) {
        applying = false;
        paint();
        if (status.opened) setMeta(L().installerOpened, 'ok');
        else setMeta(status.error || (status.latest ? 'v' + status.latest + ' ' + L().availableOpen : L().releasesOpen));
        return;
      }
      setMeta(status.source === 'github' ? L().verified : L().restarting, 'warn');
      await window.canto.update.relaunch();
    } catch (e) {
      stopProgress?.();
      applying = false;
      paint();
      setMeta(e instanceof Error ? e.message : L().updateFail, 'err');
    }
  });

  btnClose.addEventListener('click', () => window.canto?.window.close());

  langRow.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    const next = button && button.getAttribute('data-locale');
    if (!LOCALES.includes(next)) return;
    if (next === locale) return;
    locale = next;
    paintLocale();
    if (window.canto?.locale) {
      locale = await window.canto.locale.set(next);
      paintLocale();
    }
  });

  paintLocale();
  if (window.canto?.locale) {
    void window.canto.locale.get().then((saved) => {
      if (LOCALES.includes(saved)) {
        locale = saved;
        paintLocale();
      }
    });
  }
  void refresh();
})();
