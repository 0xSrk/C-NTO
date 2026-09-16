/* UI du lanceur — plain JS (pas de bundler). API via window.canto */
(function () {
  const meta = document.getElementById('meta');
  const btnLaunch = document.getElementById('btn-launch');
  const btnUpdate = document.getElementById('btn-update');
  const btnClose = document.getElementById('btn-close');

  /** @type {import('./preload').UpdateStatus | null} */
  let status = null;
  let applying = false;

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
      btnUpdate.disabled = applying;
      btnLaunch.disabled = applying;
      setMeta(`v${current} → v${latest ?? '…'} disponible`, 'warn');
    } else {
      btnUpdate.hidden = true;
      btnLaunch.disabled = false;
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

  btnLaunch.addEventListener('click', async () => {
    btnLaunch.disabled = true;
    setMeta('Ouverture du desk…');
    await window.canto.update.startDesk();
  });

  btnUpdate.addEventListener('click', async () => {
    if (applying) return;
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
