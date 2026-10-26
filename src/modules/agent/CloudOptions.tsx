import { useEffect, useState } from 'react';
import { Button, Field, Tag } from '@/design/primitives';
import { tr, useI18n } from '@/i18n';
import { desk, isDesk } from '@/lib/desk';
import { fmtNum } from '@/lib/format';
import { useAgentCloud } from '@/store/agentCloud';
import { cloudState, type CloudState } from './CloudReports';
import s from './agent.module.css';

const TONE: Record<CloudState, 'gold' | 'ember' | undefined> = { service: 'gold', paused: undefined, construction: undefined, fault: 'ember', archived: undefined };

export function cloudStateLabel(state: CloudState): string {
  switch (state) {
    case 'service':
      return tr('en service', 'in service', 'en servicio');
    case 'paused':
      return tr('en pause', 'paused', 'en pausa');
    case 'construction':
      return tr('en construction', 'under construction', 'en construcción');
    case 'fault':
      return tr('en défaut', 'faulty', 'en fallo');
    case 'archived':
      return tr('archivé', 'archived', 'archivado');
  }
}

/**
 * Options › Agent cloud : la clé (envoyée une fois au process principal, qui la chiffre), la planification voulue,
 * l'installation et les commandes du déploiement. Installer, lancer et reprendre ouvrent un dialogue du process principal.
 */
export function CloudOptions() {
  useI18n((st) => st.locale);
  const status = useAgentCloud((c) => c.status);
  const setKey = useAgentCloud((c) => c.setKey);
  const setSchedule = useAgentCloud((c) => c.setSchedule);
  const setDeployment = useAgentCloud((c) => c.setDeployment);
  const provision = useAgentCloud((c) => c.provision);
  const run = useAgentCloud((c) => c.run);
  const pause = useAgentCloud((c) => c.pause);
  const unpause = useAgentCloud((c) => c.unpause);
  const pull = useAgentCloud((c) => c.pull);
  const [key, setKeyDraft] = useState('');
  const [cron, setCron] = useState(status?.schedule.cron ?? '');
  const [timezone, setTimezone] = useState(status?.schedule.timezone ?? '');
  const [external, setExternal] = useState('');

  useEffect(() => {
    if (!status) return;
    setCron(status.schedule.cron);
    setTimezone(status.schedule.timezone);
  }, [status?.schedule.cron, status?.schedule.timezone]);

  const state = cloudState(status);
  const title = tr('Agent cloud · Anthropic', 'Cloud agent · Anthropic', 'Agente en la nube · Anthropic');
  if (!isDesk || !desk?.agentCloud) {
    return (
      <div className={s.section}>
        <div className={s.sectionTitle}>
          <span>{title}</span>
        </div>
        <div className={s.hint}>
          {tr(
            'Disponible dans le shell local (Electron) : la clé reste dans le process principal, qui relève les rapports de l’agent.',
            'Available in the local shell (Electron): the key stays in the main process, which pulls the agent’s reports.',
            'Disponible en el shell local (Electron): la clave queda en el proceso principal, que recoge los informes del agente.',
          )}
        </div>
      </div>
    );
  }

  const busy = status?.busy ?? null;
  const deployment = status?.deployment ?? null;
  const isExternal = !!status?.deploymentId && !status.managed;
  const scheduleChanged = !!status && (cron !== status.schedule.cron || timezone !== status.schedule.timezone);
  const appliedDiffers = !!deployment && status?.managed && (deployment.cron !== status.schedule.cron || deployment.timezone !== status.schedule.timezone);

  return (
    <div className={s.section}>
      <div className={s.sectionTitle}>
        <span>{title}</span>
        <Tag tone={TONE[state]} dot live={state === 'service'}>
          {cloudStateLabel(state)}
        </Tag>
      </div>
      <div className={s.hint}>
        {tr(
          'Un agent Managed Agents tourne chaque jour dans son bac à sable chez Anthropic, sur les crédits API de l’organisation de la clé, et dépose un rapport que le desk relève. Rien du desk ne part vers le cloud.',
          'A Managed Agents agent runs every day in its sandbox at Anthropic, on the API credits of the key’s organization, and writes a report the desk pulls. Nothing from the desk goes to the cloud.',
          'Un agente Managed Agents se ejecuta cada día en su entorno aislado de Anthropic, con los créditos API de la organización de la clave, y deja un informe que el desk recoge. Nada del desk sale hacia la nube.',
        )}
      </div>

      <Field
        label={tr('Clé API (Console Anthropic)', 'API key (Anthropic Console)', 'Clave API (Consola de Anthropic)')}
        hint={
          status?.available === false
            ? tr('trousseau du système indisponible : aucune clé n’est gardée', 'system keychain unavailable: no key is kept', 'llavero del sistema no disponible: no se guarda ninguna clave')
            : status?.keyStored
              ? tr('enregistrée · chiffrée par le trousseau du système · gardée par le process principal · jamais exportée', 'stored · encrypted by the system keychain · kept by the main process · never exported', 'guardada · cifrada por el llavero del sistema · en el proceso principal · nunca exportada')
              : tr('aucune clé enregistrée', 'no key stored', 'ninguna clave guardada')
        }
      >
        <div className={s.inline}>
          <input type="password" value={key} onChange={(e) => setKeyDraft(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} aria-label={tr('Clé API de l’agent cloud', 'Cloud agent API key', 'Clave API del agente en la nube')} />
          <Button
            size="sm"
            variant="ghost"
            disabled={!key.trim() || busy !== null}
            onClick={async () => {
              await setKey(key.trim());
              setKeyDraft('');
            }}
          >
            {tr('Enregistrer', 'Save', 'Guardar')}
          </Button>
          {status?.keyStored ? (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void setKey('')}>
              {tr('Effacer', 'Erase', 'Borrar')}
            </Button>
          ) : null}
        </div>
      </Field>

      <div className={s.row2}>
        <Field label={tr('Planification (cron)', 'Schedule (cron)', 'Planificación (cron)')}>
          <input value={cron} onChange={(e) => setCron(e.target.value)} spellCheck={false} className="mono" />
        </Field>
        <Field label={tr('Fuseau (IANA)', 'Time zone (IANA)', 'Zona (IANA)')}>
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} spellCheck={false} className="mono" />
        </Field>
      </div>
      <div className={s.status}>
        <Button size="sm" variant="ghost" disabled={!scheduleChanged} onClick={() => void setSchedule({ cron: cron.trim(), timezone: timezone.trim() })}>
          {tr('Retenir la planification', 'Keep this schedule', 'Guardar la planificación')}
        </Button>
        <span className={s.hint}>
          {appliedDiffers
            ? tr('différente du déploiement : appliquée à la prochaine mise à jour', 'differs from the deployment: applied at the next update', 'distinta del despliegue: se aplica en la próxima actualización')
            : tr('0 7 * * 1-5 : à 7 h, du lundi au vendredi', '0 7 * * 1-5: at 7 am, Monday to Friday', '0 7 * * 1-5: a las 7, de lunes a viernes')}
        </span>
      </div>

      <div className={s.actions}>
        <Button variant="chamfer" disabled={!status?.keyStored || isExternal || busy !== null} onClick={() => void provision()}>
          {busy === 'provision'
            ? tr('Installation…', 'Installing…', 'Instalando…')
            : status?.managed
              ? tr('Mettre à jour l’agent', 'Update the agent', 'Actualizar el agente')
              : tr('Installer l’agent cloud', 'Install the cloud agent', 'Instalar el agente en la nube')}
        </Button>
        <Button size="sm" variant="ghost" disabled={!status?.deploymentId || busy !== null} onClick={() => void run()}>
          {busy === 'run' ? tr('Lancement…', 'Starting…', 'Lanzando…') : tr('Lancer maintenant', 'Run now', 'Lanzar ahora')}
        </Button>
        {deployment?.state === 'paused' ? (
          <Button size="sm" variant="ghost" disabled={isExternal || busy !== null} onClick={() => void unpause()}>
            {tr('Reprendre', 'Resume', 'Reanudar')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={isExternal || !deployment || deployment.state !== 'active' || busy !== null} onClick={() => void pause()}>
            {tr('Suspendre', 'Pause', 'Suspender')}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={!status?.deploymentId || status.pulling} onClick={() => void pull()}>
          {tr('Relever', 'Pull', 'Leer')}
        </Button>
      </div>
      {deployment ? (
        <div className={s.hint}>
          {deployment.name} · {deployment.cron ?? '—'} · {deployment.timezone ?? '—'}
          {deployment.budgetCents !== null ? ` · ${tr('plafond', 'cap', 'límite')} ${fmtNum(deployment.budgetCents / 100, 2)} $` : ''}
          {deployment.agentVersion !== null ? ` · ${tr('agent', 'agent', 'agente')} v${deployment.agentVersion}` : ''}
          {deployment.pausedReason && deployment.pausedReason !== 'manual' ? ` · ${deployment.pausedReason}` : ''}
        </div>
      ) : null}
      {status?.error ? <div className={s.error}>{status.error}</div> : null}

      <Field
        label={tr('Déploiement créé dans la Console', 'Deployment created in the Console', 'Despliegue creado en la Consola')}
        hint={
          isExternal
            ? tr(
                'déploiement externe : relevé et lancé sur demande, jamais modifié, suspendu ni repris par le desk',
                'external deployment: pulled and run on request, never changed, paused or resumed by the desk',
                'despliegue externo: leído y lanzado a petición, nunca modificado, suspendido ni reanudado por el desk',
              )
            : tr('facultatif : le desk installe le sien', 'optional: the desk installs its own', 'opcional: el desk instala el suyo')
        }
      >
        <div className={s.inline}>
          <input value={external} onChange={(e) => setExternal(e.target.value)} placeholder={status?.deploymentId ?? 'depl_…'} spellCheck={false} className="mono" />
          <Button
            size="sm"
            variant="ghost"
            disabled={!external.trim() || busy !== null}
            onClick={async () => {
              await setDeployment(external.trim());
              setExternal('');
            }}
          >
            {tr('Relever celui-ci', 'Pull this one', 'Leer este')}
          </Button>
          {status?.deploymentId ? (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void setDeployment(null)}>
              {status.managed ? tr('Quitter', 'Leave', 'Dejar') : tr('Oublier', 'Forget', 'Olvidar')}
            </Button>
          ) : null}
        </div>
      </Field>
    </div>
  );
}
