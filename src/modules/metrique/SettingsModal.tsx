import { Modal } from '@/design/Modal';
import { Button, Field, Toggle } from '@/design/primitives';
import { PROP_FIRMS } from '@/engine/propfirm';
import { tr, useI18n } from '@/i18n';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { desk } from '@/lib/desk';
import { copyTechJournal } from '@/lib/log';
import s from './metrique.module.css';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  useI18n((s) => s.locale);
  const settings = useSettings((st) => st.settings);
  const update = useSettings((st) => st.update);
  const backupNow = useSettings((st) => st.backupNow);
  const clearAll = useJournal((j) => j.clearAll);
  const count = useJournal((j) => j.sessions.length);
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);

  return (
    <Modal
      title={tr('Réglages du desk', 'Desk settings', 'Ajustes del desk')}
      sub={tr('opérateur · capital · plan suivi', 'operator · capital · tracked plan', 'operador · capital · plan seguido')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              if (
                count &&
                (await confirmDialog(
                  tr(`Effacer les ${count} séances et tous les trades ?`, `Delete the ${count} sessions and all trades?`, `¿Borrar las ${count} sesiones y todos los trades?`),
                  tr('Cette action est irréversible : exportez le coffre avant si nécessaire.', 'This action cannot be undone: export the vault first if needed.', 'Esta acción es irreversible: exporte la caja antes si es necesario.'),
                ))
              ) {
                await clearAll();
                toast(tr('Journal effacé.', 'Journal cleared.', 'Diario borrado.'), 'warn');
                onClose();
              }
            }}
          >
            {tr('Effacer le journal', 'Clear journal', 'Borrar el diario')}
          </Button>
          <span style={{ flex: 1 }} />
          <Button variant="gold" onClick={onClose}>
            {tr('Fermer', 'Close', 'Cerrar')}
          </Button>
        </>
      }
    >
      <div className={s.formGrid}>
        <Field label={tr('Indicatif opérateur', 'Operator callsign', 'Indicativo del operador')} hint={tr('affiché dans le rail', 'shown in the rail', 'mostrado en el rail')}>
          <input value={settings.callsign} onChange={(e) => update({ callsign: e.target.value.toUpperCase().slice(0, 18) })} />
        </Field>
        <Field label={tr('Capital de référence ($)', 'Reference capital ($)', 'Capital de referencia ($)')} hint={tr('base des ratios Sharpe / Calmar', 'base for Sharpe / Calmar ratios', 'base de los ratios Sharpe / Calmar')}>
          <input type="number" min={1000} step={1000} value={settings.startingBalance} onChange={(e) => update({ startingBalance: Number(e.target.value) || 50_000 })} />
        </Field>
        <Field label={tr('Plan prop firm suivi', 'Tracked prop firm plan', 'Plan prop firm seguido')} className={s.full}>
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
        <Field label={tr('Bascule de journée (heure locale)', 'Day boundary (local hour)', 'Cambio de jornada (hora local)')}>
          <select value={settings.boundaryHour} onChange={(e) => update({ boundaryHour: Number(e.target.value) })}>
            <option value={0}>{tr('00:00 — date civile', '00:00 — calendar date', '00:00 — fecha civil')}</option>
            <option value={18}>{tr('18:00 — Globex (heure ET)', '18:00 — Globex (ET hour)', '18:00 — Globex (hora ET)')}</option>
            <option value={17}>17:00</option>
            <option value={23}>23:00</option>
          </select>
        </Field>
        <Field label={tr('Risque par contrat ($)', 'Risk per contract ($)', 'Riesgo por contrato ($)')} hint={tr("pour les multiples de R à l'import", 'for R multiples on import', 'para los múltiplos de R en la importación')}>
          <input type="number" min={0} step={5} value={settings.riskPerContract} onChange={(e) => update({ riskPerContract: Number(e.target.value) || 0 })} />
        </Field>
        <Field label={tr('Canal de mise à jour', 'Update channel', 'Canal de actualización')} className={s.full} hint={tr('un clone git tire origin/main et relance ; sans git, page GitHub', 'a git clone pulls origin/main and restarts; without git, GitHub page', 'un clon git tira origin/main y reinicia; sin git, página GitHub')}>
          <select value={settings.updateChannel} onChange={(e) => update({ updateChannel: e.target.value === 'dev' ? 'dev' : 'release' })}>
            <option value="release">{tr('release — installeur (page GitHub)', 'release — installer (GitHub page)', 'release — instalador (página GitHub)')}</option>
            <option value="dev">{tr('dev — clone git (pull + relancer)', 'dev — git clone (pull + restart)', 'dev — clon git (pull + reiniciar)')}</option>
          </select>
        </Field>
        <Field label={tr('Dossier de sauvegarde', 'Backup folder', 'Carpeta de copia')} className={s.full} hint={tr('copie quotidienne canto-vault-AAAA-MM-JJ.json', 'daily copy canto-vault-YYYY-MM-DD.json', 'copia diaria canto-vault-AAAA-MM-DD.json')}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input readOnly value={settings.backupFolder ?? ''} placeholder={tr('aucun (dialogue à chaque sauvegarde)', 'none (dialog on each backup)', 'ninguno (diálogo en cada copia)')} style={{ flex: 1 }} />
            <Button
              size="sm"
              onClick={async () => {
                const folder = await desk?.files.pickFolder?.();
                if (folder) await update({ backupFolder: folder });
              }}
            >
              {tr('Choisir', 'Choose', 'Elegir')}
            </Button>
          </div>
        </Field>
        <Field label={tr('Chiffrer la sauvegarde', 'Encrypt backup', 'Cifrar la copia')} className={s.full}>
          <Toggle on={settings.backupEncrypted} onChange={(v) => update({ backupEncrypted: v })} label={tr('trousseau système si disponible', 'system keychain if available', 'llavero del sistema si está disponible')} />
        </Field>
        <Field label={tr('Sauvegarde quotidienne', 'Daily backup', 'Copia diaria')} className={s.full} hint={tr('si un dossier est choisi, au boot Electron', 'if a folder is chosen, on Electron boot', 'si se elige una carpeta, al arrancar Electron')}>
          <Toggle on={settings.backupDaily} onChange={(v) => update({ backupDaily: v })} label={tr('écrire canto-vault-AAAA-MM-JJ.json', 'write canto-vault-YYYY-MM-DD.json', 'escribir canto-vault-AAAA-MM-DD.json')} />
        </Field>
        <Field label={tr('Coffre lourd', 'Heavy vault', 'Caja pesada')} className={s.full} hint={tr('barres et messages agent — fichier beaucoup plus gros', 'bars and agent messages — much larger file', 'barras y mensajes del agente — archivo mucho más grande')}>
          <Toggle on={settings.backupIncludeHeavy} onChange={(v) => update({ backupIncludeHeavy: v })} label={tr('inclure barSeries et agentMessages', 'include barSeries and agentMessages', 'incluir barSeries y agentMessages')} />
        </Field>
        <Field label={tr('Sauvegarde', 'Backup', 'Copia')} className={s.full}>
          <Button
            onClick={async () => {
              const r = await backupNow();
              if (r.ok) toast(r.encrypted ? tr('Coffre sauvegardé (chiffré).', 'Vault backed up (encrypted).', 'Caja guardada (cifrada).') : tr('Coffre sauvegardé.', 'Vault backed up.', 'Caja guardada.'), 'ok');
              else toast(tr('Sauvegarde annulée ou impossible.', 'Backup cancelled or failed.', 'Copia cancelada o imposible.'), 'warn');
            }}
          >
            {tr('Sauvegarder maintenant', 'Back up now', 'Guardar ahora')}
          </Button>
        </Field>
        <Field label={tr('Journal technique', 'Technical journal', 'Diario técnico')} className={s.full} hint={tr('anneau local, 200 lignes · pas d’envoi', 'local ring, 200 lines · no upload', 'anillo local, 200 líneas · sin envío')}>
          <Button
            onClick={async () => {
              const ok = await copyTechJournal();
              toast(ok ? tr('Journal technique copié.', 'Technical journal copied.', 'Diario técnico copiado.') : tr('Copie impossible.', 'Copy failed.', 'Copia imposible.'), ok ? 'ok' : 'warn');
            }}
          >
            {tr('Copier le journal technique', 'Copy technical journal', 'Copiar el diario técnico')}
          </Button>
        </Field>
      </div>
    </Modal>
  );
}
