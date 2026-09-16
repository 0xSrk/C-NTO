/* UI du lanceur — plain JS. Transition traits + nano-circuit vers le desk. */
(function () {
  const meta = document.getElementById('meta');
  const btnLaunch = document.getElementById('btn-launch');
  const btnUpdate = document.getElementById('btn-update');
  const btnClose = document.getElementById('btn-close');
  const frame = document.getElementById('frame');
  const xfer = document.getElementById('xfer');
  const nano = document.getElementById('nano');

  let status = null;
  let applying = false;
  let launching = false;

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
      btnUpdate.textContent = applying ? 'Mise à jour…' : 'Mettre à jour et relancer';
      btnUpdate.disabled = applying || launching;
      btnLaunch.disabled = applying || launching;
      setMeta(`v${current} → v${latest ?? '…'} disponible`, 'warn');
    } else {
      btnUpdate.hidden = true;
      btnLaunch.disabled = launching;
      setMeta(`À jour · v${current}`);
    }
  }

  async function refresh() {
    if (!window.canto?.update) {
      setMeta('Shell indisponible', 'err');
      return;
    }
    setMeta('Contrôle de version…');
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
    setMeta('Liaison du circuit…');
    await playTransfer();
    setMeta('Ouverture du desk…');
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
        setMeta(status.error, 'err');
        return;
      }
      setMeta('Redémarrage…', 'warn');
      await window.canto.update.relaunch();
    } catch (e) {
      applying = false;
      setMeta(e instanceof Error ? e.message : 'Échec de la mise à jour', 'err');
      paint();
    }
  });

  btnClose.addEventListener('click', () => window.canto?.window.close());

  void refresh();
})();
