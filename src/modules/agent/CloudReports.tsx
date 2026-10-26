import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { count } from '@/app/railQuantity';
import { reportCodes, type CloudReport } from '@/engine/agent/cloudReport';
import { Signal } from '@/design/Micro';
import { Button, Empty, Led, Regle, cx } from '@/design/primitives';
import { tr, useI18n } from '@/i18n';
import { desk, isDesk, type AgentCloudStatus } from '@/lib/desk';
import { fmtInt, fmtNum } from '@/lib/format';
import { dateKeyLocal, dateTimeFormatter, formatDateFr } from '@/lib/time';
import { useAgentCloud } from '@/store/agentCloud';
import { renderMarkdown } from '../note/markdown';
import r from './reports.module.css';

/**
 * Dossier des rapports de l'agent cloud (Système 4.0) : à gauche la plaque de l'agent et les fiches, à droite le lecteur.
 * Le trait dit l'état — plein : en service ; tireté : prévu, en construction, en pause ; pointillé : hors d'atteinte. La LED
 * or marque ce qui vit (une fiche non lue, un agent en service). Chaque fiche porte son code en clair, sans code-barres.
 */

export type CloudState = 'service' | 'paused' | 'construction' | 'fault' | 'archived';

export function cloudState(status: AgentCloudStatus | null): CloudState {
  if (!status || !status.keyStored || !status.deploymentId) return 'construction';
  if (status.error) return 'fault';
  if (!status.deployment) return 'construction';
  if (status.deployment.state === 'archived') return 'archived';
  return status.deployment.state === 'paused' ? 'paused' : 'service';
}

const TRAIT: Record<CloudState, string | undefined> = { service: r.solid, paused: r.dashed, construction: r.dashed, fault: r.dotted, archived: r.dotted };

function stateLabel(state: CloudState): string {
  switch (state) {
    case 'service':
      return tr('En service', 'In service', 'En servicio');
    case 'paused':
      return tr('En pause', 'Paused', 'En pausa');
    case 'construction':
      return tr('En construction', 'Under construction', 'En construcción');
    case 'fault':
      return tr('En défaut', 'Faulty', 'En fallo');
    case 'archived':
      return tr('Archivé', 'Archived', 'Archivado');
  }
}

const dayTime = (ms: number) => dateTimeFormatter({ day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms);
const fullTime = (ms: number) => dateTimeFormatter({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ms);
const dollars = (cents: number) => `${fmtNum(cents / 100, 2)} $`;

function failureText(kind: string, detail: string): string {
  const what =
    kind === 'run'
      ? tr('Déclenchement refusé', 'Trigger refused', 'Disparo rechazado')
      : kind === 'no_report'
        ? tr('Session finie sans rapport', 'Session ended without a report', 'Sesión terminada sin informe')
        : kind === 'budget'
          ? tr('Plafond atteint avant le rapport', 'Cap reached before the report', 'Límite alcanzado antes del informe')
          : kind === 'too_large'
          ? tr('Rapport trop lourd', 'Report too large', 'Informe demasiado pesado')
          : kind === 'archived'
            ? tr('Session archivée', 'Session archived', 'Sesión archivada')
            : tr('Rapport hors contrat', 'Report off contract', 'Informe fuera de contrato');
  return detail ? `${what} · ${detail}` : what;
}

/** Plaque de l'agent cloud : un état réel du pont, jamais décorative. */
function CloudPlate({ status, onOptions }: { status: AgentCloudStatus | null; onOptions: () => void }) {
  const state = cloudState(status);
  const deployment = status?.deployment ?? null;
  const failures = status?.failures.slice(0, 2) ?? [];
  return (
    <section className={cx(r.plate, TRAIT[state])} aria-label={tr('Agent cloud', 'Cloud agent', 'Agente en la nube')}>
      <div className={r.plateHead}>
        <span>{tr('Agent cloud · Anthropic', 'Cloud agent · Anthropic', 'Agente en la nube · Anthropic')}</span>
        <span className={cx(r.state, state === 'service' && r.live)}>
          <Led on={state === 'service'}>{stateLabel(state)}</Led>
        </span>
      </div>
      <Regle label={tr('Déploiement', 'Deployment', 'Despliegue')} value={deployment?.name || (status?.deploymentId ? `${status.deploymentId.slice(0, 12)}…` : '—')} />
      <Regle label={tr('Prochaine exécution', 'Next run', 'Próxima ejecución')} value={deployment?.nextRunAt ? dayTime(deployment.nextRunAt) : '—'} />
      <Regle
        label={tr('Dernier relevé', 'Last pull', 'Última lectura')}
        value={status?.pulling ? tr('En cours…', 'Running…', 'En curso…') : status?.lastPullAt ? dayTime(status.lastPullAt) : '—'}
      />
      <Regle label={tr('Plafond', 'Cap', 'Límite')} value={deployment?.budgetCents ? `${dollars(deployment.budgetCents)} / ${tr('exéc.', 'run', 'ejec.')}` : '—'} />
      {status && status.pending > 0 ? <Regle label={tr('En cours', 'Running', 'En curso')} value={`${fmtInt(status.pending)} ${tr('session(s)', 'session(s)', 'sesión(es)')}`} /> : null}
      {status?.error ? <Signal level={2}>{status.error}</Signal> : null}
      {failures.map((f) => (
        <Signal key={`${f.at}-${f.kind}`} level={1}>
          {failureText(f.kind, f.detail)}
        </Signal>
      ))}
      {state === 'construction' ? (
        <div className={r.plateHint}>
          <span>{tr('Clé API et déploiement se règlent dans Options › Agent cloud.', 'API key and deployment are set in Options › Cloud agent.', 'La clave API y el despliegue se ajustan en Opciones › Agente en la nube.')}</span>
          <Button size="sm" variant="ghost" onClick={onOptions}>
            {tr('Ouvrir les options', 'Open options', 'Abrir las opciones')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Ouvre un lien https du rapport dans le navigateur du système (le desk ne navigue jamais), au clic comme au clic du
 * milieu ; tout autre lien ne fait rien.
 */
function openLink(event: MouseEvent<HTMLElement>): void {
  const anchor = (event.target as HTMLElement | null)?.closest?.('a');
  if (!anchor) return;
  event.preventDefault();
  // `auxclick` part pour tout bouton secondaire : seul le clic du milieu ouvre ; le clic droit sert à regarder le lien.
  if (event.type === 'auxclick' && event.button !== 1) return;
  const href = anchor.getAttribute('href') ?? '';
  if (/^https:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
}

/**
 * Le texte d'un lien vient du modèle : l'hôte réel s'affiche à côté (« [Communiqué FOMC] fomc.example »). Un lien qui
 * n'est pas en https perd son adresse et reste du texte.
 */
export function decorateLinks(html: string): string {
  if (typeof DOMParser === 'undefined' || !html.includes('<a')) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;
  for (const anchor of [...root.querySelectorAll('a')]) {
    const href = anchor.getAttribute('href') ?? '';
    let host = '';
    try {
      const url = new URL(href);
      host = url.protocol === 'https:' ? url.host : '';
    } catch {
      /* adresse illisible */
    }
    if (!host) {
      anchor.removeAttribute('href');
      continue;
    }
    const mark = doc.createElement('span');
    mark.className = r.linkHost ?? '';
    mark.textContent = host;
    anchor.after(mark);
  }
  return root.innerHTML;
}

function Reader({ report, code }: { report: CloudReport; code: string }) {
  useI18n((s) => s.locale);
  const html = useMemo(() => report.sections.map((s) => decorateLinks(renderMarkdown(s.body))), [report]);
  return (
    <article className={r.sheet} onClick={openLink} onAuxClick={openLink}>
      <header className={r.sheetHead}>
        <span className={r.code}>{code}</span>
        <h2 className={r.sheetTitle}>{report.title}</h2>
        <div className={r.meta}>
          <Regle label={tr('Journée', 'Day', 'Jornada')} value={formatDateFr(report.date, { weekday: true })} />
          <Regle label={tr('Reçu', 'Received', 'Recibido')} value={fullTime(report.receivedAt)} />
          {report.generatedAt !== null ? <Regle label={tr('Écrit', 'Written', 'Escrito')} value={fullTime(report.generatedAt)} /> : null}
          {report.session.costCents !== null ? <Regle label={tr('Coût', 'Cost', 'Coste')} value={dollars(report.session.costCents)} /> : null}
          {report.session.agentVersion !== null ? <Regle label={tr('Agent', 'Agent', 'Agente')} value={`v${report.session.agentVersion}`} /> : null}
        </div>
        {report.summary ? <p className={r.summary}>{report.summary}</p> : null}
      </header>
      {report.sections.map((section, index) => (
        <section key={`${index}-${section.heading}`} className={r.section}>
          <h3>{section.heading}</h3>
          <div className={r.prose} dangerouslySetInnerHTML={{ __html: html[index] ?? '' }} />
        </section>
      ))}
      {report.sources.length > 0 ? (
        <footer className={r.sources}>
          <h3>{tr('Sources', 'Sources', 'Fuentes')}</h3>
          <ol>
            {report.sources.map((source, index) => (
              <li key={`${index}-${source.url}`}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
                <span>{new URL(source.url).host}</span>
              </li>
            ))}
          </ol>
        </footer>
      ) : null}
    </article>
  );
}

export function CloudReports({ active, onOptions }: { active: boolean; onOptions: () => void }) {
  useI18n((s) => s.locale);
  const status = useAgentCloud((c) => c.status);
  const reports = useAgentCloud((c) => c.reports);
  const selectedId = useAgentCloud((c) => c.selectedId);
  const open = useAgentCloud((c) => c.open);
  const select = useAgentCloud((c) => c.select);
  const codes = useMemo(() => reportCodes(reports), [reports]);
  const latest = reports[0] ?? null;
  const autoOpened = useRef<string | null>(null);
  const readerRef = useRef<HTMLElement>(null);

  // Le dossier s'ouvre sur le dernier rapport quand il est à l'écran ; un rapport plus récent et non lu prend la place,
  // une fois : l'opérateur qui ouvre ensuite une autre fiche la garde.
  useEffect(() => {
    if (!active || !latest) return;
    if (!selectedId || (latest.id !== autoOpened.current && !latest.read)) {
      autoOpened.current = latest.id;
      void select(latest.id);
    }
  }, [active, selectedId, latest, select]);

  // Une autre fiche s'ouvre en haut, pas au défilement de la précédente.
  useEffect(() => {
    if (readerRef.current) readerRef.current.scrollTop = 0;
  }, [open?.id]);

  if (!isDesk || !desk?.agentCloud) {
    return (
      <div className={r.offDesk}>
        <Empty
          title={tr('Rapports de l’agent cloud', 'Cloud agent reports', 'Informes del agente en la nube')}
          text={tr(
            'Disponible dans le shell local (Electron) : le process principal relève chaque jour les rapports de l’agent qui tourne chez Anthropic.',
            'Available in the local shell (Electron): the main process pulls, every day, the reports of the agent running at Anthropic.',
            'Disponible en el shell local (Electron): el proceso principal recoge cada día los informes del agente que se ejecuta en Anthropic.',
          )}
        />
      </div>
    );
  }

  const state = cloudState(status);
  const next = state === 'service' ? (status?.deployment?.nextRunAt ?? null) : null;
  // Le code de la fiche prévue suit la même règle que les autres : jamais celui d'une fiche déjà rangée ce jour-là.
  const plannedCode = next === null ? '' : (reportCodes([...reports, { id: 'planned', date: dateKeyLocal(new Date(next)), receivedAt: Number.MAX_SAFE_INTEGER }]).get('planned') ?? '');
  return (
    <div className={r.layout}>
      <aside className={r.folder}>
        <CloudPlate status={status} onOptions={onOptions} />
        <div className={r.folderHead}>
          <span>{tr('Rapports', 'Reports', 'Informes')}</span>
          <i aria-hidden />
          <b>
            {count(reports.length, tr('fiche', 'sheet', 'ficha'), tr('fiches', 'sheets', 'fichas'))}
          </b>
        </div>
        <ul className={r.fiches}>
          {next !== null ? (
            <li className={cx(r.fiche, r.planned)}>
              <span className={r.ficheHead}>
                <span className={r.code}>{plannedCode}</span>
                <span>{tr('Prévu', 'Planned', 'Previsto')} · {dayTime(next)}</span>
              </span>
              <span className={r.ficheTitle}>{tr('Prochain rapport', 'Next report', 'Próximo informe')}</span>
            </li>
          ) : null}
          {reports.map((rep) => (
            <li key={rep.id}>
              <button type="button" className={cx(r.fiche, rep.id === selectedId && r.on)} aria-current={rep.id === selectedId ? 'true' : undefined} onClick={() => void select(rep.id)}>
                <span className={r.ficheHead}>
                  <span className={r.code}>{codes.get(rep.id)}</span>
                  <span>{formatDateFr(rep.date, { short: true })}</span>
                </span>
                <span className={r.ficheTitle}>
                  {!rep.read ? <Led /> : null}
                  {rep.title}
                </span>
                {rep.summary ? <span className={r.ficheSummary}>{rep.summary}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {reports.length === 0 ? (
          <Empty
            title={tr('Dossier en construction', 'Folder under construction', 'Carpeta en construcción')}
            text={tr(
              'Le premier rapport arrive ici après la première exécution de l’agent cloud.',
              'The first report lands here after the cloud agent’s first run.',
              'El primer informe llega aquí tras la primera ejecución del agente en la nube.',
            )}
          />
        ) : null}
      </aside>
      <section className={r.reader} ref={readerRef}>
        {open ? (
          <Reader report={open} code={codes.get(open.id) ?? ''} />
        ) : (
          <Empty
            title={reports.length ? tr('Choisissez une fiche', 'Pick a sheet', 'Elija una ficha') : tr('Aucun rapport pour l’instant', 'No report yet', 'Ningún informe por ahora')}
            text={tr(
              'Chaque rapport est déposé par l’agent dans son bac à sable chez Anthropic, puis relevé par le desk : rien du desk ne part vers le cloud.',
              'Each report is written by the agent in its sandbox at Anthropic, then pulled by the desk: nothing from the desk goes to the cloud.',
              'Cada informe lo escribe el agente en su entorno aislado de Anthropic y luego el desk lo recoge: nada del desk sale hacia la nube.',
            )}
          />
        )}
      </section>
    </div>
  );
}
