import { Modal } from '@/design/Modal';
import { Button, Field, Toggle } from '@/design/primitives';
import { PROP_FIRMS } from '@/engine/propfirm';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { desk } from '@/lib/desk';
import s from './metrique.module.css';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings((st) => st.settings);
  const update = useSettings((st) => st.update);
  const backupNow = useSettings((st) => st.backupNow);
  const clearAll = useJournal((j) => j.clearAll);
  const count = useJournal((j) => j.sessions.length);
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);

  return (
    <Modal
      title="Réglages du desk"
      sub="opérateur · capital · plan suivi"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              if (count && (await confirmDialog(`Effacer les ${count} séances et tous les trades ?`, 'Cette action est irréversible : exportez le coffre avant si nécessaire.'))) {
                await clearAll();
                toast('Journal effacé.', 'warn');
                onClose();
              }
            }}
          >
            Effacer le journal
          </Button>
          <span style={{ flex: 1 }} />
          <Button variant="gold" onClick={onClose}>
            Fermer
          </Button>
        </>
      }
    >
      <div className={s.formGrid}>
        <Field label="Indicatif opérateur" hint="affiché dans le rail">
          <input value={settings.callsign} onChange={(e) => update({ callsign: e.target.value.toUpperCase().slice(0, 18) })} />
        </Field>
        <Field label="Capital de référence ($)" hint="base des ratios Sharpe / Calmar">
          <input type="number" min={1000} step={1000} value={settings.startingBalance} onChange={(e) => update({ startingBalance: Number(e.target.value) || 50_000 })} />
        </Field>
        <Field label="Plan prop firm suivi" className={s.full}>
          <select value={settings.planId} onChange={(e) => update({ planId: e.target.value })}>
            {PROP_FIRMS.map((f) => (
              <optgroup key={f.id} label={f.name}>
                {f.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {f.name} · {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Bascule de journée (heure locale)">
          <select value={settings.boundaryHour} onChange={(e) => update({ boundaryHour: Number(e.target.value) })}>
            <option value={0}>00:00 — date civile</option>
            <option value={18}>18:00 — Globex (heure ET)</option>
            <option value={17}>17:00</option>
            <option value={23}>23:00</option>
          </select>
        </Field>
        <Field label="Risque par contrat ($)" hint="pour les multiples de R à l'import">
          <input type="number" min={0} step={5} value={settings.riskPerContract} onChange={(e) => update({ riskPerContract: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Dossier de sauvegarde" className={s.full} hint="copie quotidienne canto-vault-AAAA-MM-JJ.json">
          <div style={{ display: 'flex', gap: 8 }}>
            <input readOnly value={settings.backupFolder ?? ''} placeholder="aucun (dialogue à chaque sauvegarde)" style={{ flex: 1 }} />
            <Button
              size="sm"
              onClick={async () => {
                const folder = await desk?.files.pickFolder?.();
                if (folder) await update({ backupFolder: folder });
              }}
            >
              Choisir
            </Button>
          </div>
        </Field>
        <Field label="Chiffrer la sauvegarde" className={s.full}>
          <Toggle on={settings.backupEncrypted} onChange={(v) => update({ backupEncrypted: v })} label="trousseau système si disponible" />
        </Field>
        <Field label="Sauvegarde" className={s.full}>
          <Button
            onClick={async () => {
              const r = await backupNow();
              if (r.ok) toast(r.encrypted ? 'Coffre sauvegardé (chiffré).' : 'Coffre sauvegardé.', 'ok');
              else toast('Sauvegarde annulée ou impossible.', 'warn');
            }}
          >
            Sauvegarder maintenant
          </Button>
        </Field>
      </div>
    </Modal>
  );
}
