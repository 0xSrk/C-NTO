/* UI du lanceur — plain JS. Transition traits + nano-circuit vers le desk. */
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
      linking: 'Liaison du circuit…',
      opening: 'Ouverture du desk…',
      dirty: 'Modifications locales — stash ou commit, puis réessayez.',
      releasesOpen: 'Page des versions ouverte',
      availableOpen: 'dispo — page des versions ouverte',
      restarting: 'Redémarrage…',
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
      linking: 'Linking the circuit…',
      opening: 'Opening the desk…',
      dirty: 'Local changes — stash or commit, then try again.',
      releasesOpen: 'Releases page opened',
      availableOpen: 'available — releases page opened',
      restarting: 'Restarting…',
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
      linking: 'Enlazando el circuito…',
      opening: 'Abriendo el desk…',
      dirty: 'Cambios locales — stash o commit, luego reintente.',
      releasesOpen: 'Página de versiones abierta',
      availableOpen: 'disponible — página de versiones abierta',
      restarting: 'Reinicio…',
      updateFail: 'Error de la actualización',
    },
  };

  const meta = document.getElementById('meta');
  const btnLaunch = document.getElementById('btn-launch');
  const btnUpdate = document.getElementById('btn-update');
  const btnClose = document.getElementById('btn-close');
  const langLabel = document.getElementById('lang-label');
  const langRow = document.getElementById('lang-row');
  const frame = document.getElementById('frame');
  const xfer = document.getElementById('xfer');
  const nano = document.getElementById('nano');

  const fromQuery = new URLSearchParams(location.search).get('lang');
  let locale = fromQuery === 'en' || fromQuery === 'es' || fromQuery === 'fr' ? fromQuery : 'fr';
  let status = null;
  let applying = false;
  let launching = false;

  function L() {
    return COPY[locale];
  }

  function paintLocale() {
    const c = L();
    document.documentElement.lang = locale;
    btnClose.setAttribute('aria-label', c.close);
    btnClose.title = c.close;
    langLabel.textContent = c.lang;
    btnLaunch.textContent = c.launch;
    for (const button of langRow.querySelectorAll('button')) {
      const on = button.getAttribute('data-locale') === locale;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    if (!status && !window.canto?.update) {
      setMeta(c.shell, 'err');
      return;
    }
    paint();
  }

  function setMeta(text, kind) {
    meta.textContent = text;
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
      btnUpdate.textContent = applying ? L().updating : L().updateRelaunch;
      btnUpdate.disabled = applying || launching;
      btnLaunch.disabled = applying || launching;
      setMeta(`v${current} → v${latest ?? '…'} ${L().available}`, 'warn');
    } else {
      btnUpdate.hidden = true;
      btnLaunch.disabled = launching;
      setMeta(`${L().upToDate} · v${current}`);
    }
  }

  async function refresh() {
    if (!window.canto?.update) {
      setMeta(L().shell, 'err');
      return;
    }
    setMeta(L().checking);
    status = await window.canto.update.check();
    paint();
  }

  /** Nano-pixels : points 1×1 qui s’allument le long d’une grille circuit. */
  function runNano(durationMs) {
    if (!nano) return;
    const ctx = nano.getContext('2d');
    if (!ctx) return;
    const w = nano.width;
    const h = nano.height;
    const cells = [];
    const step = 6;
    for (let y = 40; y < h - 40; y += step) {
      for (let x = 40; x < w - 40; x += step) {
        const onTrace = x % 70 < 1 || y % 70 < 1 || (x + y) % 42 === 0;
        if (onTrace || Math.random() < 0.05) {
          cells.push({ x, y, led: Math.random() < 0.1, t: Math.random() });
        }
      }
    }
    const t0 = performance.now();
    function frameNano(now) {
      const p = Math.min(1, (now - t0) / durationMs);
      ctx.clearRect(0, 0, w, h);
      for (const c of cells) {
        if (c.t > p) continue;
        ctx.fillStyle = c.led ? 'rgba(196,30,58,0.8)' : 'rgba(255,255,255,0.24)';
        ctx.fillRect(c.x, c.y, 1, 1);
      }
      if (p < 1) requestAnimationFrame(frameNano);
    }
    requestAnimationFrame(frameNano);
  }

  function playTransfer() {
    return new Promise((resolve) => {
      frame.classList.add('leaving');
      xfer.classList.add('on');
      runNano(900);
      setTimeout(resolve, 920);
    });
  }

  btnLaunch.addEventListener('click', async () => {
    if (launching) return;
    launching = true;
    btnLaunch.disabled = true;
    setMeta(L().linking);
    await playTransfer();
    setMeta(L().opening);
    await window.canto.update.startDesk();
  });

  btnUpdate.addEventListener('click', async () => {
    if (applying || launching) return;
    applying = true;
    paint();
    try {
      status = await window.canto.update.apply();
      if (status.error) {
        applying = false;
        paint();
        setMeta(status.error === 'dirty_needs_stash' ? L().dirty : status.error, 'err');
        return;
      }
      if (!status.applied) {
        applying = false;
        paint();
        setMeta(status.error || (status.latest ? 'v' + status.latest + ' ' + L().availableOpen : L().releasesOpen));
        return;
      }
      setMeta(L().restarting, 'warn');
      await window.canto.update.relaunch();
    } catch (e) {
      applying = false;
      setMeta(e instanceof Error ? e.message : L().updateFail, 'err');
      paint();
    }
  });

  btnClose.addEventListener('click', () => window.canto?.window.close());

  langRow.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    const next = button && button.getAttribute('data-locale');
    if (next !== 'fr' && next !== 'en' && next !== 'es') return;
    if (next === locale) return;
    locale = next;
    if (window.canto?.locale) locale = await window.canto.locale.set(next);
    paintLocale();
  });

  paintLocale();
  if (window.canto?.locale) {
    void window.canto.locale.get().then((saved) => {
      if (saved === 'fr' || saved === 'en' || saved === 'es') {
        locale = saved;
        paintLocale();
      }
    });
  }
  void refresh();
})();
