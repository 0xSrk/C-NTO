/* UI du lanceur AUBE — plain JS. Logique de version, de mise à jour, de nouveautés et de langue ; présentation
   en Système 4.0 « ΟΡΟΣ » : plaques liées à l'état réel, signal par glyphe, jauge du téléchargement, bande
   d'étiquette au vrai Code 128. Micrographies : window.cantoMicro (launcher-micro.js, généré). */
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
      notes: (v) => `Nouveautés de la v${v} ▾`,
      sheet: 'Fiche · Nouveautés',
      release: { upToDate: 'À JOUR', available: 'DISPO', failed: 'ÉCHEC', applying: 'MAJ…' },
      artefact: { ready: 'PRÊT', updating: 'MAJ…', launching: 'LANCÉ' },
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
      notes: (v) => `What's new in v${v} ▾`,
      sheet: 'Sheet · What’s new',
      release: { upToDate: 'LATEST', available: 'UPDATE', failed: 'FAILED', applying: 'UPDATE…' },
      artefact: { ready: 'READY', updating: 'UPDATE…', launching: 'OPENING' },
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
      notes: (v) => `Novedades de la v${v} ▾`,
      sheet: 'Ficha · Novedades',
      release: { upToDate: 'AL DÍA', available: 'NUEVA', failed: 'FALLO', applying: 'ACT…' },
      artefact: { ready: 'LISTO', updating: 'ACT…', launching: 'ABRIENDO' },
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
  const btnNotes = $('notes-toggle');
  const notesPanel = $('notes-panel');
  // Présentation (absente de pages réduites : chaque usage est gardé).
  const metaGlyph = $('meta-glyph');
  const plateSeal = $('plate-seal');
  const plateArtefact = $('plate-artefact');
  const plateRelease = $('plate-release');
  const gauge = $('gauge');
  const gaugePct = $('gauge-pct');
  const stripChannel = $('strip-channel');
  const stripLatency = $('strip-latency');
  const stripCode = $('strip-code');
  const code = $('code');
  const MICRO = window.cantoMicro || null;

  const LOCALES = ['fr', 'en', 'es'];
  const fromQuery = new URLSearchParams(location.search).get('lang');
  let locale = LOCALES.includes(fromQuery) ? fromQuery : 'fr';
  let status = null;
  let notesDoc = null;
  let notesOpen = false;
  let applying = false;
  /** Modifications locales détectées : le prochain clic confirme le stash. */
  let stashArmed = false;
  let launching = false;
  /** Relevés réels : version lue du shell, aller-retour du contrôle (ms), pourcentage reçu. */
  let version = null;
  let latencyMs = null;
  let receivedPct = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function L() {
    return COPY[locale];
  }

  /* ─── Présentation : plaques, signal, bande ─────────────────────────────── */

  /** Longueur maximale de chaque relevé de la plaque de publication (scripts/launcher-micro.mjs). */
  const LIMIT = { next: 8, state: 7, channel: 6, latency: 7 };
  const CHANNEL = { github: 'GITHUB', git: 'GIT' };
  const clip = (value, n) => (value === null || value === undefined ? null : String(value).slice(0, n));

  function fmtLatency(ms) {
    if (ms === null || !Number.isFinite(ms)) return null;
    return ms < 1000 ? `${Math.round(ms)} MS` : `${(ms / 1000).toFixed(1)} S`;
  }

  function currentVersion() {
    return status?.current || version || null;
  }

  function bind(el, plate, values) {
    if (!el || !MICRO || !MICRO.PLATES[plate]) return;
    el.innerHTML = MICRO.bindSlots(MICRO.PLATES[plate].svg, values);
  }

  function releaseState() {
    if (!status) return null;
    if (receivedPct !== null) return `${receivedPct} %`;
    if (applying) return L().release.applying;
    if (status.error && !status.available) return L().release.failed;
    return status.available ? L().release.available : L().release.upToDate;
  }

  function artefactState() {
    if (!window.canto?.update) return null;
    if (launching) return L().artefact.launching;
    if (applying) return L().artefact.updating;
    return L().artefact.ready;
  }

  function paintPlates() {
    bind(plateSeal, 'seal', { version: currentVersion() });
    bind(plateArtefact, 'artefact', { state: artefactState() });
    bind(plateRelease, 'release', {
      next: clip(status ? status.latest : null, LIMIT.next),
      state: clip(releaseState(), LIMIT.state),
      channel: clip(status ? CHANNEL[status.source] : null, LIMIT.channel),
      latency: clip(status ? fmtLatency(latencyMs) : null, LIMIT.latency),
    });
  }

  function paintStrip() {
    if (stripChannel) {
      const reached = !!status && !(status.error && !status.available);
      stripChannel.textContent = `${reached ? '■' : '□'} ${(status && CHANNEL[status.source]) || '—'}`;
    }
    if (stripLatency) stripLatency.textContent = status && latencyMs !== null ? `· ${fmtLatency(latencyMs)}` : '';
    const v = currentVersion();
    const text = v ? `SK-ART-002-${v}` : 'SK-ART-002';
    if (stripCode) stripCode.textContent = text;
    if (!code || !MICRO) return;
    if (!v) {
      code.replaceChildren();
      return;
    }
    // Le seul code-barres du lanceur : SK-ART-002-{version}, un module par pixel.
    const { d, modules } = MICRO.code128Path(text, 12);
    code.setAttribute('viewBox', `0 0 ${modules} 12`);
    code.setAttribute('width', String(modules));
    code.innerHTML = `<path d="${d}" />`;
  }

  const LEVEL = { ok: '1', warn: '2', err: '3', busy: 'busy' };
  const GLYPH = { 1: 'signal1', 2: 'signal2', 3: 'signal3', busy: 'now' };

  function paintSignal(kind) {
    const level = LEVEL[kind] || '1';
    if (meta.dataset.level === level && metaGlyph?.firstChild) return;
    meta.dataset.level = level;
    if (metaGlyph && MICRO) metaGlyph.innerHTML = MICRO.GLYPHS[GLYPH[level]];
  }

  function paintGauge() {
    if (!gauge) return;
    gauge.hidden = receivedPct === null;
    if (receivedPct === null) return;
    gauge.style.setProperty('--fill', String(Math.round(receivedPct * 10) / 1000));
    if (gaugePct) gaugePct.textContent = `${receivedPct} %`;
  }

  /** Lentille de l'horizon : le premier tracé du groupe horizon du sceau (la lentille, sans le bord du disque), à l'échelle de la fenêtre. */
  (function paintStatics() {
    if (!MICRO) return;
    const horizon = /<g data-part="horizon">(<path[^>]*\/>)/.exec(MICRO.SEAL.svg);
    const lens = $('lens');
    if (lens && horizon) lens.innerHTML = horizon[1];
    // Instruments de l'aube : le sceau qui frappe, les rayons de l'horizon d'où la LED se lève.
    const seal = $('seal');
    if (seal) seal.innerHTML = MICRO.SEAL.svg;
    const rays = $('rays');
    if (rays) rays.innerHTML = MICRO.GLYPHS.horizon;
    for (const [id, name] of [
      ['glyph-launch', 'arrowOpen'],
      ['glyph-update', 'arrowImport'],
      ['glyph-rule', 'rule'],
    ]) {
      const el = $(id);
      if (el) el.innerHTML = MICRO.GLYPHS[name];
    }
  })();

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
    paintPlates();
    paintStrip();
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

  function cmpVer(a, b) {
    const pa = String(a).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  /** Versions strictement après l'installée, jusqu'à la disponible incluse, la plus récente d'abord. */
  function notesBetween() {
    if (!status?.available || !notesDoc || !Array.isArray(notesDoc.entries)) return [];
    const current = status.current;
    const latest = status.latest;
    return notesDoc.entries
      .filter((entry) => entry && typeof entry.version === 'string' && cmpVer(entry.version, current) > 0 && (!latest || cmpVer(entry.version, latest) <= 0))
      .sort((a, b) => cmpVer(b.version, a.version));
  }

  function paintNotes() {
    if (!btnNotes || !notesPanel) return;
    const rows = notesBetween();
    if (rows.length === 0 || !status?.latest) {
      btnNotes.hidden = true;
      notesPanel.hidden = true;
      notesPanel.classList.remove('open');
      btnNotes.setAttribute('aria-expanded', 'false');
      notesOpen = false;
      return;
    }
    btnNotes.hidden = false;
    btnNotes.textContent = L().notes(status.latest);
    btnNotes.setAttribute('aria-expanded', notesOpen ? 'true' : 'false');
    notesPanel.hidden = !notesOpen;
    notesPanel.classList.toggle('open', notesOpen);
    notesPanel.replaceChildren();
    // En-tête de fiche : le document, et l'écart qu'il couvre.
    const head = document.createElement('div');
    head.className = 'fh';
    const label = document.createElement('span');
    label.textContent = L().sheet;
    const span = document.createElement('span');
    span.textContent = 'v' + status.current + ' → v' + status.latest;
    head.append(label, span);
    notesPanel.appendChild(head);
    for (const entry of rows) {
      const highlights = entry.highlights || {};
      const points = highlights[locale] || highlights.fr || [];
      const title = document.createElement('p');
      title.className = 'ver';
      title.textContent = 'v' + entry.version;
      const list = document.createElement('ul');
      for (const point of points) {
        const item = document.createElement('li');
        item.textContent = String(point);
        list.appendChild(item);
      }
      notesPanel.appendChild(title);
      notesPanel.appendChild(list);
    }
  }

  function setMeta(text, kind) {
    metaText.textContent = text;
    meta.className = 'meta' + (kind ? ' ' + kind : '');
    paintSignal(kind);
  }

  function paint() {
    paintPlates();
    paintStrip();
    paintGauge();
    if (!status) return;
    const { current, latest, available, error } = status;
    if (error && !available) {
      setMeta(error, 'err');
      btnUpdate.hidden = true;
      paintNotes();
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
    paintNotes();
  }

  async function refresh() {
    if (!window.canto?.update) {
      setMeta(L().shell, 'err');
      return;
    }
    setMeta(L().checking, 'busy');
    const asked = performance.now();
    status = await window.canto.update.check();
    latencyMs = performance.now() - asked;
    notesDoc = null;
    notesOpen = false;
    if (status?.available && window.canto.update.changelog) {
      try {
        notesDoc = await window.canto.update.changelog();
      } catch {
        notesDoc = null;
      }
    }
    paint();
  }

  /* ─── Liaison : le départ se replie sur l'horizon ─────────────────────────────
     Après la couture de l'aube (aube.js), le desk se relie : chaque trait de la graduation de
     l'horizon est une liaison, allumée des bords vers le centre par deux trains de points et
     comptée ; le sceau se rouvre en filets, puis se replie dans la ligne avec le logotype ; la
     LED reste seule au centre de l'horizon, rayonne en anneaux — la mémoire des anneaux du sceau —
     et respire jusqu'à l'ouverture du desk. Couleurs : jetons de la feuille. */

  /** Couleur d'un jeton de la feuille (#rrggbb) en « r,g,b » pour le canvas. */
  function rgb(name, fallback) {
    const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? [m[1], m[2], m[3]].map((h) => parseInt(h, 16)).join(',') : fallback;
  }

  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  /** Temps du départ (ms après la main rendue par l'aube) — T_DONE a son miroir dans aube.js. */
  const T_LINKED = 900;
  const T_RING = 520;
  const T_COLLAPSE = 1000;
  const T_LED = 1260;
  const T_DONE = 1520;

  function runTransfer() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    nano.width = Math.round(W * dpr);
    nano.height = Math.round(H * dpr);
    const ctx = nano.getContext('2d');
    if (!ctx) return Promise.resolve();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const GOLD = rgb('--gold', '204,176,102');
    const INK = rgb('--text-0', '245,242,234');
    const hair = 1 / dpr; // 1 pixel physique : la finesse de l'écran
    const snap = (v) => (Math.round(v * dpr) + 0.5) / dpr;

    // L'horizon : l'axe y 80 du logotype ; le centre : le centre du logotype.
    const r = word.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const hz = Math.round(r.top + r.height / 2);
    const sealH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--seal-h')) || 400;
    const ringR = (368 / 740) * sealH;
    const ringY = hz + (12.8 / 740) * sealH;

    // Les liaisons : un trait tous les 8 px, du centre vers chaque bord ; le front part des bords.
    const half = W / 2;
    const links = [];
    for (let d = 0; d <= half; d += 8) {
      for (const x of d === 0 ? [cx] : [cx - d, cx + d]) {
        links.push({ x, major: d % 40 === 0, at: 40 + (1 - d / half) * (T_LINKED - 40) });
      }
    }
    const total = links.length;
    const front = (t) => clamp01((t - 40) / (T_LINKED - 40)); // 0 aux bords → 1 au centre

    return new Promise((resolve) => {
      const t0 = performance.now();
      let resolved = false;
      let collapsed = false;

      function frameTick(now) {
        const t = now - t0;
        ctx.clearRect(0, 0, W, H);
        const surge = t > T_LED ? Math.exp(-(t - T_LED) / 240) : 0;

        // Graduation : les traits éteints en ivoire, les liaisons en or, un éclat quand elles s'allument.
        let linked = 0;
        ctx.lineWidth = hair;
        for (const l of links) {
          const on = t >= l.at;
          if (on) linked++;
          const since = t - l.at;
          const flash = on ? Math.exp(-since / 140) : 0;
          const fold = t > T_COLLAPSE ? 1 - easeInOut(clamp01((t - T_COLLAPSE) / 260)) : 1;
          const len = (l.major ? 7 : 4) * (on ? 1 : 0.6) * fold;
          if (len <= 0.2) continue;
          ctx.strokeStyle = on ? `rgba(${GOLD},${0.5 + 0.5 * flash + surge * 0.3})` : `rgba(${INK},0.14)`;
          ctx.beginPath();
          ctx.moveTo(snap(l.x), snap(hz + 3));
          ctx.lineTo(snap(l.x), snap(hz + 3 + len));
          ctx.stroke();
        }

        // Les deux trains de points sur la ligne, des bords vers le centre ; leur sillage est la ligne allumée.
        const p = front(t);
        if (p > 0 && p < 1) {
          for (const side of [-1, 1]) {
            const x = cx + side * half * (1 - p);
            const g = ctx.createLinearGradient(cx + side * half, 0, x, 0);
            g.addColorStop(0, `rgba(${GOLD},0)`);
            g.addColorStop(1, `rgba(${GOLD},0.75)`);
            ctx.fillStyle = g;
            ctx.fillRect(Math.min(x, cx + side * half), Math.round(hz * dpr) / dpr - hair, Math.abs(cx + side * half - x), 2 * hair);
            for (let k = 0; k < 4; k++) {
              ctx.fillStyle = `rgba(${k ? GOLD : INK},${1 - k * 0.22})`;
              ctx.fillRect(Math.round((x - side * k * 5) * dpr) / dpr - 1, Math.round(hz * dpr) / dpr - 1, 2, 2);
            }
          }
        }

        // Le sceau se rouvre en filets autour de l'horizon, puis se replie dans la ligne avec le logotype.
        const open = easeOut(clamp01((t - T_RING) / 340)) * (1 - easeInOut(clamp01((t - T_COLLAPSE) / 240)));
        if (open > 0.01) {
          ctx.lineWidth = hair;
          for (const [k, a] of [
            [1, 0.26],
            [0.83, 0.16],
          ]) {
            ctx.strokeStyle = `rgba(${INK},${a})`;
            ctx.beginPath();
            ctx.ellipse(cx, ringY, ringR * k, ringR * k * open, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // Le logotype se replie sur son axe : un trait qui se resserre jusqu'à la LED.
        if (t >= T_COLLAPSE && !collapsed) {
          collapsed = true;
          frame.classList.add('collapse');
        }
        if (t >= T_COLLAPSE + 120 && t < T_LED) {
          const k = easeInOut(clamp01((t - T_COLLAPSE - 120) / (T_LED - T_COLLAPSE - 120)));
          const halfW = (r.width / 2) * (1 - k);
          if (halfW > 0.5) {
            const g = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
            g.addColorStop(0, `rgba(${INK},0)`);
            g.addColorStop(0.5, `rgba(${INK},0.95)`);
            g.addColorStop(1, `rgba(${INK},0)`);
            ctx.fillStyle = g;
            ctx.fillRect(cx - halfW, Math.round(hz * dpr) / dpr, halfW * 2, hair);
          }
        }

        // La LED, seule au centre de l'horizon : elle s'embrase, rayonne en anneaux, puis respire.
        if (t >= T_LED) {
          const since = t - T_LED;
          ctx.lineWidth = hair;
          for (let i = 0; i < 3; i++) {
            const q = (since - i * 110) / 760;
            if (q <= 0 || q >= 1) continue;
            ctx.strokeStyle = `rgba(${GOLD},${0.55 * (1 - q)})`;
            ctx.beginPath();
            ctx.arc(cx, hz, 4 + easeOut(q) * ringR * 0.7, 0, Math.PI * 2);
            ctx.stroke();
          }
          const breathe = t > T_DONE ? 0.78 + 0.22 * Math.sin((t - T_DONE) / 420) : 1;
          const glowR = 30 + surge * 44;
          const g = ctx.createRadialGradient(cx, hz, 0, cx, hz, glowR);
          g.addColorStop(0, `rgba(${GOLD},${0.55 * breathe + surge * 0.3})`);
          g.addColorStop(0.35, `rgba(${GOLD},${0.12 * breathe})`);
          g.addColorStop(1, `rgba(${GOLD},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(cx - glowR, hz - glowR, glowR * 2, glowR * 2);
          ctx.fillStyle = `rgba(${GOLD},1)`;
          ctx.fillRect(Math.round((cx - 2.5) * dpr) / dpr, Math.round((hz - 2.5) * dpr) / dpr, 5, 5);
        }

        // Télémétrie : les liaisons comptées, la séquence de points, le temps.
        hudFill.style.width = Math.round(clamp01(t / T_DONE) * 100) + '%';
        hudCount.textContent = String(linked).padStart(3, '0') + ' / ' + String(total).padStart(3, '0');
        hudClock.textContent = 'T+' + (t / 1000).toFixed(3);

        if (t >= T_DONE && !resolved) {
          resolved = true;
          resolve();
        }
        // La boucle continue (la LED respire) jusqu'à la fermeture du lanceur.
        requestAnimationFrame(frameTick);
      }
      requestAnimationFrame(frameTick);
    });
  }

  async function playTransfer() {
    frame.classList.add('leaving');
    hudText.textContent = L().linking;
    if (reducedMotion) {
      xfer.classList.add('on');
      return new Promise((resolve) => setTimeout(resolve, 160));
    }
    // L'aube rend la main : la LED revient sur l'horizon, puis le circuit prend la main.
    // Le filet de launch() et ce finally couvrent une fenêtre masquée : le desk s'ouvre quand même.
    try {
      if (window.cantoAube) await window.cantoAube.launch();
    } catch (e) {
      console.warn('[lanceur] AUBE launch:', e);
    } finally {
      xfer.classList.add('on');
    }
    return runTransfer();
  }

  async function launch() {
    if (launching || btnLaunch.disabled) return;
    toRest();
    launching = true;
    btnLaunch.disabled = true;
    paint();
    await playTransfer();
    hudText.textContent = L().opening;
    await window.canto.update.startDesk();
  }

  btnLaunch.addEventListener('click', () => void launch());
  if (btnNotes) {
    btnNotes.addEventListener('click', () => {
      if (btnNotes.hidden) return;
      notesOpen = !notesOpen;
      paintNotes();
    });
  }
  window.addEventListener('keydown', (event) => {
    if (!frame?.isConnected) return;
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
      receivedPct = p.total ? Math.min(100, Math.floor((p.received / p.total) * 100)) : null;
      paintGauge();
      paintPlates();
      setMeta(L().downloading + pct + ' · ' + mb(p.received) + (p.total ? ' / ' + mb(p.total) : '') + ' Mo', 'busy');
    });
    try {
      status = await window.canto.update.apply({ confirmStash: stashArmed });
      stopProgress?.();
      receivedPct = null;
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
      receivedPct = null;
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

  /* ─── L'aube : la séquence d'ouverture de la feuille (data-phase="intro"), jusqu'au repos ───────────────
     Une touche ou un clic l'abrège (ce clic-là ne vise rien) ; Échap garde son sens ; le mouvement réduit
     donne le repos d'emblée. Le chronomètre T+ dit le temps réel de l'ouverture, puis s'éteint. */
  const INTRO_REST_MS = 2800; // miroir de --t-rest (tests/launcher-dawn.test.ts)
  const clock = $('clock');
  const introAt = performance.now();
  const raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (cb) => setTimeout(cb, 16);
  const unraf = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;
  let introTimer = 0;
  let clockFrame = 0;
  let swallowUntil = 0;

  function restMs() {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-rest'));
    return Number.isFinite(value) && value > 0 ? value * 1000 : INTRO_REST_MS;
  }

  function tickClock() {
    if (!clock || frame.dataset.phase !== 'intro') return;
    clock.textContent = 'T+' + ((performance.now() - introAt) / 1000).toFixed(3);
    clockFrame = raf(tickClock);
  }

  function toRest() {
    if (!frame || frame.dataset.phase === 'rest') return;
    frame.dataset.phase = 'rest';
    clearTimeout(introTimer);
    unraf(clockFrame);
    window.removeEventListener('keydown', skipByKey, true);
    window.removeEventListener('pointerdown', skipByPointer, true);
    window.cantoAube?.rest?.();
  }

  // Une page, une aube : un cadre retiré du document n'écoute plus rien.
  function skipByKey(event) {
    if (!frame.isConnected) return;
    toRest();
    if (event.key === 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function skipByPointer() {
    if (!frame.isConnected) return;
    swallowUntil = performance.now() + 800;
    toRest();
  }

  window.addEventListener(
    'click',
    (event) => {
      if (!frame?.isConnected || performance.now() >= swallowUntil) return;
      swallowUntil = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  if (reducedMotion) toRest();
  else {
    window.addEventListener('keydown', skipByKey, true);
    window.addEventListener('pointerdown', skipByPointer, true);
    introTimer = setTimeout(toRest, restMs());
    clockFrame = raf(tickClock);
  }

  paintLocale();
  if (window.canto?.locale) {
    void window.canto.locale.get().then((saved) => {
      if (LOCALES.includes(saved)) {
        locale = saved;
        paintLocale();
      }
    });
  }
  // La version qui tourne, lue tout de suite : la plaque du sceau et le code de la bande n'attendent pas le réseau.
  if (window.canto?.version) {
    void Promise.resolve()
      .then(() => window.canto.version())
      .then((v) => {
        if (typeof v === 'string' && v) {
          version = v;
          paintPlates();
          paintStrip();
        }
      })
      .catch(() => undefined);
  }
  void refresh();
})();
