import { useEffect, useState } from 'react';
import { cx } from '@/design/primitives';
import { desk, isDesk, type UpdateStatus } from '@/lib/desk';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './shell.module.css';

/** Bouton titlebar : contrôle GitHub/git au boot ; ambre si une màj est dispo. */
export function UpdateButton() {
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
  const label = busy ? 'Màj…' : available ? 'Màj' : `v${status.current}`;
  const title = available
    ? `Mise à jour disponible : v${status.current} → v${status.latest ?? '…'} — cliquer pour installer et relancer`
    : `Version locale v${status.current}${status.latest ? ` · distant v${status.latest}` : ''} — à jour`;

  const onClick = async () => {
    if (!available || busy) {
      if (!available) toast(`CΛNTO v${status.current} — à jour.`, 'ok');
      return;
    }
    setBusy(true);
    toast('Téléchargement de la mise à jour…', 'info');
    try {
      let r = await api.apply({ channel, confirmStash: false });
      if (r?.error === 'dirty_needs_stash') {
        const ok = await confirmDialog('Modifications locales détectées', 'Mettre de côté le travail en cours (git stash) puis tirer la mise à jour ?');
        if (!ok) {
          setBusy(false);
          toast('Mise à jour annulée.', 'warn');
          return;
        }
        r = await api.apply({ channel, confirmStash: true });
      }
      if (!r || r.error) {
        toast(r?.error ?? 'Mise à jour impossible.', 'error');
        setBusy(false);
        if (r) setStatus(r);
        return;
      }
      setStatus(r);
      if (!r.applied) {
        toast('Page des versions ouverte.', 'ok');
        setBusy(false);
        return;
      }
      toast('Mise à jour installée — redémarrage…', 'ok');
      await api.relaunch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Mise à jour impossible.', 'error');
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
