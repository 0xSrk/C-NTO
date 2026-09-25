import { useEffect, useState } from 'react';
import { tr, useI18n } from '@/i18n';
import { cx } from '@/design/primitives';
import { desk, isDesk, type UpdateStatus } from '@/lib/desk';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './shell.module.css';

/** Bouton titlebar : contrôle GitHub/git au boot ; ambre si une màj est dispo. */
export function UpdateButton() {
  useI18n((s) => s.locale);
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);
  const channel = useSettings((st) => st.settings.updateChannel);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const api = desk?.update;

  useEffect(() => {
    if (!isDesk || !api) return;
    let cancelled = false;
    const refresh = () => {
      void api.check().then((r) => {
        if (!cancelled && r) setStatus(r);
      });
    };
    refresh();
    const t = setInterval(refresh, 30 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [api]);

  if (!isDesk || !api || !status) return null;

  const available = status.available;
  const label = busy ? tr('Màj…', 'Upd…', 'Act…') : available ? tr('Màj', 'Upd', 'Act') : `v${status.current}`;
  const title = available
    ? tr(
        `Mise à jour disponible : v${status.current} → v${status.latest ?? '…'} — cliquer pour installer et relancer`,
        `Update available: v${status.current} → v${status.latest ?? '…'} — click to install and relaunch`,
        `Actualización disponible: v${status.current} → v${status.latest ?? '…'} — clic para instalar y reiniciar`,
      )
    : tr(
        `Version locale v${status.current}${status.latest ? ` · distant v${status.latest}` : ''} — à jour`,
        `Local version v${status.current}${status.latest ? ` · remote v${status.latest}` : ''} — up to date`,
        `Versión local v${status.current}${status.latest ? ` · remota v${status.latest}` : ''} — al día`,
      );

  const onClick = async () => {
    if (!available || busy) {
      if (!available) toast(tr(`CΛNTO v${status.current} — à jour.`, `CΛNTO v${status.current} — up to date.`, `CΛNTO v${status.current} — al día.`), 'ok');
      return;
    }
    setBusy(true);
    toast(tr('Téléchargement de la mise à jour…', 'Downloading the update…', 'Descargando la actualización…'), 'info');
    try {
      let r = await api.apply({ channel, confirmStash: false });
      if (r?.error === 'dirty_needs_stash') {
        const ok = await confirmDialog(tr('Modifications locales détectées', 'Local changes detected', 'Cambios locales detectados'), tr('Mettre de côté le travail en cours (git stash) puis tirer la mise à jour ?', 'Stash the current work (git stash) and then pull the update?', '¿Apartar el trabajo en curso (git stash) y luego traer la actualización?'));
        if (!ok) {
          setBusy(false);
          toast(tr('Mise à jour annulée.', 'Update cancelled.', 'Actualización cancelada.'), 'warn');
          return;
        }
        r = await api.apply({ channel, confirmStash: true });
      }
      if (!r || r.error) {
        toast(r?.error ?? tr('Mise à jour impossible.', 'Update failed.', 'Actualización imposible.'), 'error');
        setBusy(false);
        if (r) setStatus(r);
        return;
      }
      setStatus(r);
      if (!r.applied) {
        toast(tr('Page des versions ouverte.', 'Releases page opened.', 'Página de versiones abierta.'), 'ok');
        setBusy(false);
        return;
      }
      toast(tr('Mise à jour installée — redémarrage…', 'Update installed — restarting…', 'Actualización instalada — reinicio…'), 'ok');
      await api.relaunch();
    } catch (e) {
      toast(e instanceof Error ? e.message : tr('Mise à jour impossible.', 'Update failed.', 'Actualización imposible.'), 'error');
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={cx(s.updateBtn, available && s.updateAvail, busy && s.updateBusy)}
      onClick={() => void onClick()}
      title={title}
      aria-label={title}
      disabled={busy}
    >
      <i className={s.updateDot} aria-hidden />
      {label}
    </button>
  );
}
