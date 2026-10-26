import { memo, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { IconSend } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Field, Led, Tag, Toggle, cx } from '@/design/primitives';
import { llmKeyBound } from '@/engine/agent/llm';
import { coerceRoutineSeen, ROUTINE_OF, routineDue, type RoutineCue, type RoutineSeen } from '@/engine/agent/routineDue';
import { toolSchemas } from '@/engine/agent/tools';
import { tradingDayNow } from '@/engine/discipline';
import { tr, useI18n } from '@/i18n';
import { desk, isDesk } from '@/lib/desk';
import { fmtInt, fmtNum } from '@/lib/format';
import { dateTimeFormatter, formatTimeLocal } from '@/lib/time';
import { db, type AgentMessage } from '@/store/db';
import { useAgent } from '@/store/agent';
import { useAgentCloud } from '@/store/agentCloud';
import { useAgentOrders } from '@/store/agentOrders';
import { useCrypto } from '@/store/crypto';
import { dailyLossReached, useDeskEvents } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { defaultAgentPrompt, isDefaultAgentPrompt, useSettings, type AgentProvider } from '@/store/settings';
import { useUi } from '@/store/ui';
import { renderMarkdown } from '../note/markdown';
import { AgentOrdersPanel } from './AgentOrdersPanel';
import { CloudOptions, cloudStateLabel } from './CloudOptions';
import { CloudReports, cloudState } from './CloudReports';
import { claudeCodeCommand, claudeDesktopConfig, codexConfig, mcpJsonConfig } from './mcpClients';
import { PRESETS } from './presets';
import s from './agent.module.css';

function suggestions(): string[] {
  return [
    tr(
      'Fais un diagnostic de mon journal : forces, faiblesses, trois axes de travail.',
      'Diagnose my journal: strengths, weaknesses, three lines of work.',
      'Haz un diagnóstico de mi diario: fortalezas, debilidades, tres ejes de trabajo.',
    ),
    tr(
      'Quels créneaux horaires et jours de semaine dois-je éviter d’après mes séances ?',
      'Which time slots and weekdays should I avoid based on my sessions?',
      '¿Qué franjas horarias y días de la semana debo evitar según mis sesiones?',
    ),
    tr(
      'Où en suis-je sur mon plan prop firm et quel risque par trade est cohérent avec la marge restante ?',
      'Where do I stand on my prop firm plan, and what risk per trade fits the remaining buffer?',
      '¿Dónde estoy en mi plan prop firm y qué riesgo por trade encaja con el margen restante?',
    ),
    tr(
      'Rédige la note de revue hebdomadaire à partir de mes 5 dernières séances.',
      'Draft the weekly review note from my last 5 sessions.',
      'Redacta la nota de reseña semanal a partir de mis 5 últimas sesiones.',
    ),
    tr(
      'Quels catalyseurs majeurs (FOMC, NFP, CPI…) arrivent dans les 10 prochains jours et comment les aborder ?',
      'Which major catalysts (FOMC, NFP, CPI…) arrive in the next 10 days, and how should I approach them?',
      '¿Qué catalizadores mayores (FOMC, NFP, CPI…) llegan en los próximos 10 días y cómo abordarlos?',
    ),
  ];
}


/** Le flux en cours est affiché en texte brut (Markdown seulement pour le message final) : O(n) par jeton au lieu de O(n²). */
function StreamBubble({ text }: { text: string }) {
  const deferred = useDeferredValue(text);
  return (
    <div className={cx(s.bubble, s.cursor)} style={{ whiteSpace: 'pre-wrap' }}>
      {deferred}
    </div>
  );
}

const NEAR_BOTTOM_PX = 40;

/** Sous-onglets de l'agent : le dossier des rapports d'abord, la conversation, puis toutes les options. */
export type AgentView = 'rapports' | 'conversation' | 'options';

export default function Agent() {
  const locale = useI18n((s) => s.locale);
  // Sélecteurs champ par champ : chaque jeton reçu ne réaffiche que ce qui dépend de streamText.
  const messages = useAgent((a) => a.messages);
  const streaming = useAgent((a) => a.streaming);
  const streamText = useAgent((a) => a.streamText);
  const pendingTool = useAgent((a) => a.pendingTool);
  const error = useAgent((a) => a.error);
  const notice = useAgent((a) => a.notice);
  const eventCount = useDeskEvents((e) => e.count);
  const lastEvent = useDeskEvents((e) => e.last);
  const send = useAgent((a) => a.send);
  const runRoutine = useAgent((a) => a.runRoutine);
  const stop = useAgent((a) => a.stop);
  const newConversation = useAgent((a) => a.newConversation);
  const probe = useAgent((a) => a.probe);
  const orchestrator = useAgent((a) => a.orchestrator);
  const startOrchestrator = useAgent((a) => a.startOrchestrator);
  const stopOrchestrator = useAgent((a) => a.stopOrchestrator);
  const rotateToken = useAgent((a) => a.rotateToken);
  const mcp = useAgent((a) => a.mcp);
  const startMcp = useAgent((a) => a.startMcp);
  const stopMcp = useAgent((a) => a.stopMcp);
  const rotateMcpToken = useAgent((a) => a.rotateMcpToken);
  const mcpConnection = useAgent((a) => a.mcpConnection);
  const mcpPort = useSettings((st) => st.settings.mcpPort);
  const linkLog = useAgent((a) => a.linkLog);
  const agent = useSettings((st) => st.settings.agent);
  const port = useSettings((st) => st.settings.orchestratorPort);
  const allowWrite = useSettings((st) => st.settings.orchestratorAllowWrite);
  const keyEncrypted = useSettings((st) => st.keyEncrypted);
  // Les dix outils `crypto_*` ne sont listés (et donnés au modèle) que module crypto allumé.
  const cryptoOn = useCrypto((c) => c.enabled);
  const updateAgent = useSettings((st) => st.updateAgent);
  const update = useSettings((st) => st.update);
  const toast = useUi((u) => u.toast);
  const [view, setView] = useState<AgentView>('rapports');
  const cloudStatus = useAgentCloud((c) => c.status);
  const cloudCount = useAgentCloud((c) => c.reports.length);
  const pullCloud = useAgentCloud((c) => c.pull);
  const openCloudFolder = useAgentCloud((c) => c.openFolder);
  const ordersStatus = useAgentOrders((a) => a.status);
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState<RoutineSeen>({});
  const sessions = useJournal((j) => j.sessions);
  const [probeState, setProbeState] = useState<{ ok: boolean; detail: string; models?: string[] } | null>(null);
  const [probing, setProbing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const sugs = suggestions();
  const systemPromptValue = isDefaultAgentPrompt(agent.systemPrompt) ? defaultAgentPrompt() : agent.systemPrompt;
  // Clé saisie pour un autre hôte : le process principal ne l'envoie pas à celui-ci.
  const keyElsewhere = !!agent.apiKeyEncrypted && !!agent.apiKeyHost && !llmKeyBound(agent.baseUrl, agent.apiKeyHost);

  // Défilement automatique seulement si l'opérateur était déjà en bas (≈ 40 px) : remonter
  // pour relire un message n'est plus interrompu par chaque jeton.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight });
  }, [messages.length, streamText]);

  // Un nouvel envoi ramène toujours en bas.
  useEffect(() => {
    if (streaming) stickToBottom.current = true;
  }, [streaming]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancel = false;
    void db.settings.get('agent.routineSeen').then((row) => {
      const value = coerceRoutineSeen(row?.value);
      if (!cancel && value) setSeen(value);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const day = tradingDayNow(now);
  const tradesToday = sessions.reduce((n, row) => n + (row.date === day ? row.tradeCount : 0), 0);
  // Perte du jour recalculée du journal, des réglages et du pont (l'anneau d'événements, lui, repart vide au
  // redémarrage) : à l'horloge, quand le journal change ou qu'un événement du desk arrive, pas à chaque jeton du flux.
  const dailyLossFull = useMemo(() => dailyLossReached(now), [now, sessions, lastEvent]);
  // Le catalogue que reçoit le modèle (`toolSchemas`, description dans la langue active) : à la langue et à l'interrupteur, pas à chaque jeton.
  const nativeTools = useMemo(() => toolSchemas({ crypto: cryptoOn }), [cryptoOn, locale]);
  const due = routineDue(now, { tradesToday, dailyLossFull, seen });
  const launch = async (which: RoutineCue) => {
    if (streaming) return;
    const day = due.day;
    // Datée de la journée CME, celle que la pastille et la journée vue retiennent (après 18 h, celle du lendemain).
    // La journée n'est vue que si la routine part : outils coupés ou flux en cours, la pastille reste.
    if (!(await runRoutine(ROUTINE_OF[which], { date: day }))) return;
    const next = { ...seen, [which]: day };
    setSeen(next);
    void db.settings.put({ key: 'agent.routineSeen', value: next });
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    send(text);
  };

  const visibleMessages = messages.filter((m) => m.role !== 'system');

  const cloudOn = isDesk && !!desk?.agentCloud;
  const unread = cloudStatus?.unread ?? 0;
  const cloudReady = cloudOn && !!cloudStatus?.keyStored && !!cloudStatus.deploymentId;
  const clock = (ms: number | null | undefined) => (ms ? dateTimeFormatter({ day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms) : '—');
  const views: { value: AgentView; letter: string; label: string }[] = [
    { value: 'rapports', letter: 'A', label: tr('Rapports', 'Reports', 'Informes') },
    { value: 'conversation', letter: 'B', label: tr('Conversation', 'Conversation', 'Conversación') },
    { value: 'options', letter: 'C', label: tr('Options', 'Options', 'Opciones') },
  ];
  const current = views.find((v) => v.value === view) ?? views[0]!;
  const modelTag = (
    <Tag tone={probeState?.ok ? 'mint' : 'gold'} dot live={streaming}>
      {agent.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'} · {agent.model}
    </Tag>
  );

  return (
    <>
      <ModuleHeader
        tab="agent"
        crumb={current.label.toLocaleUpperCase()}
        cells={
          cloudOn
            ? [
                { label: tr('Dernier relevé', 'Last pull', 'Última lectura'), value: clock(cloudStatus?.lastPullAt) },
                { label: tr('Prochaine exécution', 'Next run', 'Próxima ejecución'), value: clock(cloudStatus?.deployment?.nextRunAt), plan: true },
                {
                  label: tr('Rapports', 'Reports', 'Informes'),
                  value: unread > 0 ? `${fmtInt(cloudCount)} · ${fmtInt(unread)} ${tr('non lu(s)', 'unread', 'sin leer')}` : fmtInt(cloudCount),
                },
              ]
            : undefined
        }
        actions={
          view === 'rapports' ? (
            <>
              <Button variant="ghost" disabled={!cloudOn} onClick={() => void openCloudFolder()}>
                {tr('Ouvrir le dossier', 'Open the folder', 'Abrir la carpeta')}
              </Button>
              <Button variant="chamfer" disabled={!cloudReady || !!cloudStatus?.pulling} onClick={() => void pullCloud()}>
                {cloudStatus?.pulling ? tr('Relevé…', 'Pulling…', 'Leyendo…') : tr('Relever maintenant', 'Pull now', 'Leer ahora')}
              </Button>
            </>
          ) : view === 'conversation' ? (
            <>
              {modelTag}
              <Button variant="ghost" onClick={() => newConversation()}>
                {tr('Nouvelle conversation', 'New conversation', 'Nueva conversación')}
              </Button>
            </>
          ) : (
            modelTag
          )
        }
      />
      <div className={s.subtabs} role="tablist" aria-label={tr('Vues de l’agent', 'Agent views', 'Vistas del agente')}>
        {views.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`agent-tab-${item.value}`}
            aria-controls={`agent-panel-${item.value}`}
            aria-selected={view === item.value}
            className={cx(s.subtab, view === item.value && s.on)}
            onClick={() => startTransition(() => setView(item.value))}
          >
            <i>{item.letter}</i>
            {item.label}
            {item.value === 'rapports' && unread > 0 ? <b className={s.subtabCount}>{fmtInt(unread)}</b> : null}
          </button>
        ))}
        <span className={s.scopeNote}>
          {view === 'rapports'
            ? tr('Relevé par le desk · rien du desk ne part vers le cloud', 'Pulled by the desk · nothing from the desk goes to the cloud', 'Recogido por el desk · nada del desk sale hacia la nube')
            : view === 'conversation'
              ? tr('Modèle conversationnel · outils natifs du desk', 'Conversational model · native desk tools', 'Modelo conversacional · herramientas nativas del desk')
              : tr('Agent cloud · modèle · passerelles · ordres · outils', 'Cloud agent · model · gateways · orders · tools', 'Agente en la nube · modelo · pasarelas · órdenes · herramientas')}
        </span>
      </div>
      <ModuleContent noPad>
        {/* Les trois vues restent montées : brouillon, défilement et réglages en cours survivent au changement de vue. */}
        <div className={s.view} role="tabpanel" id="agent-panel-rapports" aria-labelledby="agent-tab-rapports" hidden={view !== 'rapports'}>
          <CloudReports active={view === 'rapports'} onOptions={() => startTransition(() => setView('options'))} />
        </div>
        <div className={s.view} role="tabpanel" id="agent-panel-conversation" aria-labelledby="agent-tab-conversation" hidden={view !== 'conversation'}>
          <section className={s.chat}>
            <div className={s.messages} ref={listRef}>
              {visibleMessages.length === 0 && !streaming && (
                <div className={s.welcome}>
                  <h2>{tr('Passerelle agent', 'Agent gateway', 'Pasarela del agente')}</h2>
                  <p>
                    {tr(
                      'L’agent lit le desk par des outils natifs — métriques, séances, notes, calendrier, plan prop firm — et peut écrire des notes ou annoter des séances. Connectez un modèle local (Ollama, LM Studio) ou distant dans Options, puis posez une question.',
                      'The agent reads the desk through native tools — metrics, sessions, notes, calendar, prop firm plan — and can write notes or annotate sessions. Connect a local model (Ollama, LM Studio) or a remote one in Options, then ask a question.',
                      'El agente lee el desk con herramientas nativas — métricas, sesiones, notas, calendario, plan prop firm — y puede escribir notas o anotar sesiones. Conecte un modelo local (Ollama, LM Studio) o remoto en Opciones, luego formule una pregunta.',
                    )}
                  </p>
                  <div className={s.suggestions} style={{ justifyContent: 'center' }}>
                    {sugs.map((sg) => (
                      <button key={sg} className={s.suggestion} onClick={() => setDraft(sg)}>
                        {sg}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {visibleMessages.map((m) => (
                <Message key={m.id} m={m} />
              ))}
              {streaming && (
                <div className={cx(s.msg, s.assistant)}>
                  <div className={s.msgHead}>
                    <span>Agent</span>
                    {pendingTool && (
                      <span className={cx(s.toolChip, s.pending)}>
                        <i /> {pendingTool}
                      </span>
                    )}
                  </div>
                  {streamText ? <StreamBubble text={streamText} /> : <div className={cx(s.bubble, s.cursor)}>{pendingTool ? tr('Lecture du desk…', 'Reading the desk…', 'Leyendo el desk…') : tr('Réflexion', 'Thinking', 'Reflexión')}</div>}
                </div>
              )}
              {error && (
                <div className={s.error}>
                  {tr('Erreur fournisseur :', 'Provider error:', 'Error del proveedor:')} {error}
                </div>
              )}
              {notice && !error && (
                <div className={s.notice} role="status">
                  {notice}
                </div>
              )}
            </div>
            <div className={s.composer}>
              <div className={s.routines}>
                <Button size="sm" variant="ghost" disabled={streaming} onClick={() => void launch('brief')}>
                  {tr('Brief', 'Brief', 'Brief')}
                  {due.brief ? <i className={s.cue} aria-hidden /> : null}
                </Button>
                <Button size="sm" variant="ghost" disabled={streaming} onClick={() => void launch('debrief')}>
                  {tr('Débrief', 'Debrief', 'Debrief')}
                  {due.debrief ? <i className={s.cue} aria-hidden /> : null}
                </Button>
              </div>
              {visibleMessages.length > 0 && (
                <div className={s.suggestions}>
                  {sugs.slice(0, 3).map((sg) => (
                    <button key={sg} className={s.suggestion} onClick={() => setDraft(sg)}>
                      {sg.length > 60 ? `${sg.slice(0, 58)}…` : sg}
                    </button>
                  ))}
                </div>
              )}
              <div className={s.composerRow}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={tr(
                    'Demander à l’agent… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)',
                    'Ask the agent… (Enter to send, Shift+Enter for a new line)',
                    'Preguntar al agente… (Entrar para enviar, Mayús+Entrar para una nueva línea)',
                  )}
                  rows={2}
                />
                {streaming ? (
                  <Button variant="danger" onClick={stop}>
                    {tr('Arrêter', 'Stop', 'Detener')}
                  </Button>
                ) : (
                  <Button variant="gold" onClick={submit} disabled={!draft.trim()}>
                    <IconSend size={14} /> {tr('Envoyer', 'Send', 'Enviar')}
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
        <div className={s.view} role="tabpanel" id="agent-panel-options" aria-labelledby="agent-tab-options" hidden={view !== 'options'}>
          <div className={s.options}>
            {/* Bande d'état : ce qui tourne, d'un coup d'œil, avant les réglages de chaque bloc. */}
            <dl className={s.ops} aria-label={tr('État des services de l’agent', 'Agent services status', 'Estado de los servicios del agente')}>
              {(
                [
                  [tr('Agent cloud', 'Cloud agent', 'Agente en la nube'), cloudOn ? cloudStateLabel(cloudState(cloudStatus)) : '—', cloudOn && cloudState(cloudStatus) === 'service'],
                  [tr('Modèle', 'Model', 'Modelo'), `${agent.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'} · ${agent.model}`, false],
                  [
                    tr('Passerelle MCP', 'MCP gateway', 'Pasarela MCP'),
                    mcp.running ? tr(`ouverte · port ${mcp.port}`, `open · port ${mcp.port}`, `abierta · puerto ${mcp.port}`) : tr('fermée', 'closed', 'cerrada'),
                    mcp.running,
                  ],
                  [
                    tr('Orchestrateur', 'Orchestrator', 'Orquestador'),
                    orchestrator.running ? tr(`en service · ${orchestrator.clients} lien(s)`, `running · ${orchestrator.clients} link(s)`, `en servicio · ${orchestrator.clients} enlace(s)`) : tr('en veille', 'idle', 'en espera'),
                    orchestrator.running,
                  ],
                  [tr('Écriture des agents', 'Agents writing', 'Escritura de los agentes'), allowWrite ? tr('autorisée', 'allowed', 'autorizada') : tr('lecture seule', 'read only', 'solo lectura'), false],
                  [
                    tr('Ordres de l’agent', 'Agent orders', 'Órdenes del agente'),
                    ordersStatus.pending ? tr('en attente du trader', 'waiting for the trader', 'esperando al trader') : ordersStatus.enabled ? tr('autorisés · Sim', 'allowed · Sim', 'autorizadas · Sim') : tr('désactivés', 'off', 'desactivadas'),
                    ordersStatus.enabled,
                  ],
                ] as const
              ).map(([label, value, live]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    <Led on={live}>{value}</Led>
                  </dd>
                </div>
              ))}
            </dl>
            <CloudOptions />
            <div className={s.section}>
              <div className={s.sectionTitle}>
                <span>{tr('Fournisseur', 'Provider', 'Proveedor')}</span>
                <select
                  style={{ height: 28, padding: '0 6px', fontSize: 11 }}
                  value=""
                  onChange={(e) => {
                    const p = PRESETS.find((x) => x.id === e.target.value);
                    if (p && !p.reserved) updateAgent({ provider: p.provider, baseUrl: p.baseUrl, model: p.model });
                  }}
                >
                  <option value="">{tr('Préréglages…', 'Presets…', 'Preajustes…')}</option>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.reserved}>
                      {p.reserved ? `${p.label} · ${tr('réservé', 'reserved', 'reservado')}` : p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={s.row2}>
                <Field label={tr('Protocole', 'Protocol', 'Protocolo')}>
                  <select value={agent.provider} onChange={(e) => updateAgent({ provider: e.target.value as AgentProvider })}>
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic Messages</option>
                  </select>
                </Field>
                <Field label={tr('Modèle', 'Model', 'Modelo')}>
                  <input value={agent.model} onChange={(e) => updateAgent({ model: e.target.value })} list="canto-models" />
                  {probeState?.models && (
                    <datalist id="canto-models">
                      {probeState.models.slice(0, 200).map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  )}
                </Field>
              </div>
              <Field
                label={tr('URL de base', 'Base URL', 'URL base')}
                hint={
                  /^http:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/i.test(agent.baseUrl)
                    ? tr(
                        'Connexion non chiffrée vers un hôte distant : la clé API transiterait en clair.',
                        'Unencrypted connection to a remote host: the API key would travel in cleartext.',
                        'Conexión sin cifrar hacia un host remoto: la clave API viajaría en claro.',
                      )
                    : undefined
                }
              >
                <input value={agent.baseUrl} onChange={(e) => updateAgent({ baseUrl: e.target.value })} spellCheck={false} />
              </Field>
              <Field
                label={tr('Clé API', 'API key', 'Clave API')}
                hint={
                  keyElsewhere
                    ? tr(
                        `clé saisie pour ${agent.apiKeyHost} : elle n’est pas envoyée à ce fournisseur · ressaisissez-la pour celui-ci`,
                        `key entered for ${agent.apiKeyHost}: it is not sent to this provider · enter it again for this one`,
                        `clave introducida para ${agent.apiKeyHost}: no se envía a este proveedor · vuelva a introducirla para este`,
                      )
                    : keyEncrypted
                      ? tr(
                          'chiffrée au repos par le trousseau du système · jamais exportée',
                          'encrypted at rest by the system keychain · never exported',
                          'cifrada en reposo por el llavero del sistema · nunca exportada',
                        )
                      : isDesk
                        ? tr('stockée dans le coffre local · jamais exportée', 'stored in the local vault · never exported', 'almacenada en la caja local · nunca exportada')
                        : tr(
                            'mode navigateur : stockée en clair dans le coffre local, jamais exportée',
                            'browser mode: stored in cleartext in the local vault, never exported',
                            'modo navegador: almacenada en claro en la caja local, nunca exportada',
                          )
                }
              >
                <input
                  type="password"
                  value={agent.apiKey}
                  onChange={(e) => updateAgent({ apiKey: e.target.value })}
                  placeholder={tr('optionnelle pour un modèle local', 'optional for a local model', 'opcional para un modelo local')}
                />
              </Field>
              <div className={s.row2}>
                <Field label={`${tr('Température', 'Temperature', 'Temperatura')} · ${fmtNum(agent.temperature, 1)}`}>
                  <input type="range" min={0} max={1} step={0.1} value={agent.temperature} onChange={(e) => updateAgent({ temperature: Number(e.target.value) })} />
                </Field>
                <Field label={tr('Outils du desk', 'Desk tools', 'Herramientas del desk')}>
                  <Toggle
                    on={agent.toolsEnabled}
                    onChange={(v) => updateAgent({ toolsEnabled: v })}
                    label={agent.toolsEnabled ? tr('activés', 'enabled', 'activadas') : tr('désactivés', 'disabled', 'desactivadas')}
                  />
                </Field>
              </div>
              <div className={s.status}>
                <Button
                  size="sm"
                  disabled={probing}
                  onClick={async () => {
                    setProbing(true);
                    const r = await probe();
                    setProbeState(r);
                    setProbing(false);
                    toast(
                      r.ok
                        ? tr(`Fournisseur joignable : ${r.detail}`, `Provider reachable: ${r.detail}`, `Proveedor alcanzable: ${r.detail}`)
                        : tr(`Fournisseur injoignable : ${r.detail}`, `Provider unreachable: ${r.detail}`, `Proveedor inalcanzable: ${r.detail}`),
                      r.ok ? 'ok' : 'error',
                    );
                  }}
                >
                  {probing ? tr('Test…', 'Testing…', 'Prueba…') : tr('Tester la connexion', 'Test connection', 'Probar la conexión')}
                </Button>
                {probeState && <Tag tone={probeState.ok ? 'mint' : 'ember'}>{probeState.ok ? tr('joignable', 'reachable', 'alcanzable') : tr('échec', 'failed', 'fallo')}</Tag>}
              </div>
              <Field label={tr('Consigne système', 'System prompt', 'Instrucción del sistema')}>
                <textarea rows={5} value={systemPromptValue} onChange={(e) => updateAgent({ systemPrompt: e.target.value })} style={{ fontSize: 12 }} />
              </Field>
            </div>

            <div className={s.section}>
              <div className={s.sectionTitle}>
                <span>{tr('Agents externes · MCP', 'External agents · MCP', 'Agentes externos · MCP')}</span>
                <Tag tone={mcp.running ? 'mint' : undefined} dot live={mcp.running}>
                  {mcp.running
                    ? tr(`port ${mcp.port} · ${mcp.calls} appel(s)`, `port ${mcp.port} · ${mcp.calls} call(s)`, `puerto ${mcp.port} · ${mcp.calls} llamada(s)`)
                    : tr('fermée', 'closed', 'cerrada')}
                </Tag>
              </div>
              {isDesk && desk?.mcp ? (
                <>
                  <div className={s.hint}>
                    {tr(
                      'Claude, Codex, Cursor et tout client MCP lisent le desk avec les outils natifs, sur 127.0.0.1 et avec le jeton du desk. Aucun outil ne passe d’ordre : propose_order propose, vous confirmez (voir « Ordres proposés par l’agent »).',
                      'Claude, Codex, Cursor and any MCP client read the desk with the native tools, on 127.0.0.1 and with the desk token. No tool places an order: propose_order proposes, you confirm (see “Orders proposed by the agent”).',
                      'Claude, Codex, Cursor y cualquier cliente MCP leen el desk con las herramientas nativas, en 127.0.0.1 y con el token del desk. Ninguna herramienta envía órdenes: propose_order propone, usted confirma (ver « Órdenes propuestas por el agente »).',
                    )}
                  </div>
                  <div className={s.row2}>
                    <Field label={tr('Port HTTP', 'HTTP port', 'Puerto HTTP')}>
                      <input type="number" min={1024} max={65535} value={mcpPort} onChange={(e) => update({ mcpPort: Number(e.target.value) || 47118 })} disabled={mcp.running} />
                    </Field>
                    <Field label={tr('État', 'Status', 'Estado')}>
                      {mcp.running ? (
                        <Button size="sm" variant="danger" onClick={() => stopMcp()}>
                          {tr('Fermer', 'Close', 'Cerrar')}
                        </Button>
                      ) : (
                        <Button size="sm" variant="gold" onClick={() => startMcp()}>
                          {tr('Ouvrir la passerelle', 'Open gateway', 'Abrir la pasarela')}
                        </Button>
                      )}
                    </Field>
                  </div>
                  {mcp.error && <div className={s.error}>{mcp.error}</div>}
                  <Toggle
                    on={allowWrite}
                    onChange={(v) => update({ orchestratorAllowWrite: v })}
                    label={
                      allowWrite
                        ? tr('écriture autorisée (notes, annotations, module crypto) · MCP et orchestrateur', 'write allowed (notes, annotations, crypto module) · MCP and orchestrator', 'escritura autorizada (notas, anotaciones, módulo cripto) · MCP y orquestador')
                        : tr('lecture seule · MCP et orchestrateur', 'read only · MCP and orchestrator', 'solo lectura · MCP y orquestador')
                    }
                  />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(
                      [
                        ['claude', tr('Copier pour Claude Code', 'Copy for Claude Code', 'Copiar para Claude Code'), claudeCodeCommand],
                        ['desktop', tr('Copier pour Claude Desktop', 'Copy for Claude Desktop', 'Copiar para Claude Desktop'), claudeDesktopConfig],
                        ['codex', tr('Copier pour Codex', 'Copy for Codex', 'Copiar para Codex'), (url: string, _token: string) => codexConfig(url)],
                        // Le jeton de la passerelle MCP, pour CANTO_MCP_TOKEN (Codex) : celui de l'orchestrateur est un autre jeton.
                        ['token', tr('Copier le jeton MCP', 'Copy MCP token', 'Copiar el token MCP'), (_url: string, token: string) => token],
                        ['json', tr('Copier la configuration JSON', 'Copy JSON configuration', 'Copiar la configuración JSON'), mcpJsonConfig],
                      ] as const
                    ).map(([id, label, build]) => (
                      <Button
                        key={id}
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const conn = await mcpConnection();
                          if (conn) await navigator.clipboard?.writeText(build(conn.url, conn.token));
                          toast(
                            !conn
                              ? tr('Passerelle indisponible.', 'Gateway unavailable.', 'Pasarela no disponible.')
                              : id === 'codex'
                                ? tr(
                                    'Copié. Exportez CANTO_MCP_TOKEN avec le jeton MCP (« Copier le jeton MCP ») avant de lancer Codex.',
                                    'Copied. Export CANTO_MCP_TOKEN with the MCP token (“Copy MCP token”) before starting Codex.',
                                    'Copiado. Exporte CANTO_MCP_TOKEN con el token MCP (« Copiar el token MCP ») antes de lanzar Codex.',
                                  )
                                : id === 'token'
                                  ? tr(
                                      'Jeton MCP copié : exportez-le dans CANTO_MCP_TOKEN pour Codex. Ne le partagez pas.',
                                      'MCP token copied: export it as CANTO_MCP_TOKEN for Codex. Do not share it.',
                                      'Token MCP copiado: expórtelo en CANTO_MCP_TOKEN para Codex. No lo comparta.',
                                    )
                                  : tr('Copié. Le jeton y figure : ne le partagez pas.', 'Copied. It contains the token: do not share it.', 'Copiado. Contiene el token: no lo comparta.'),
                            conn ? 'ok' : 'warn',
                          );
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={() => rotateMcpToken()} title={tr('Nouveau jeton : les clients configurés devront être mis à jour', 'New token: configured clients must be updated', 'Nuevo token: hay que actualizar los clientes configurados')}>
                      {tr('Renouveler le jeton', 'Renew token', 'Renovar el token')}
                    </Button>
                  </div>
                  <div className={s.hint}>
                    {tr(
                      'ChatGPT (web et application) appelle les serveurs MCP depuis le cloud d’OpenAI : il ne voit pas 127.0.0.1. Codex, en local, se branche comme Claude Code. Voir docs/PROTOCOLE-AGENT.md.',
                      'ChatGPT (web and app) calls MCP servers from OpenAI’s cloud: it cannot see 127.0.0.1. Codex, running locally, connects like Claude Code. See docs/PROTOCOLE-AGENT.md.',
                      'ChatGPT (web y aplicación) llama a los servidores MCP desde la nube de OpenAI: no ve 127.0.0.1. Codex, en local, se conecta como Claude Code. Ver docs/PROTOCOLE-AGENT.md.',
                    )}
                  </div>
                  <div className={s.hint}>
                    {tr(
                      `Événements du desk (fills, marge prop, catalyseurs, lien du pont) : ${eventCount} depuis l’ouverture${lastEvent ? `, dernier ${lastEvent.kind} à ${formatTimeLocal(lastEvent.at)}` : ''}. Les agents MCP les lisent avec desk_events, l’orchestrateur les reçoit en desk.event.`,
                      `Desk events (fills, prop buffer, catalysts, bridge link): ${eventCount} since opening${lastEvent ? `, last ${lastEvent.kind} at ${formatTimeLocal(lastEvent.at)}` : ''}. MCP agents read them with desk_events, the orchestrator receives them as desk.event.`,
                      `Eventos del desk (fills, margen prop, catalizadores, enlace del puente): ${eventCount} desde la apertura${lastEvent ? `, último ${lastEvent.kind} a las ${formatTimeLocal(lastEvent.at)}` : ''}. Los agentes MCP los leen con desk_events, el orquestador los recibe como desk.event.`,
                    )}
                  </div>
                </>
              ) : (
                <div className={s.hint}>
                  {tr(
                    'Disponible dans le shell local (Electron) : CΛNTO ouvre une passerelle MCP sur 127.0.0.1 pour Claude, Codex, Cursor et tout client MCP.',
                    'Available in the local shell (Electron): CΛNTO opens an MCP gateway on 127.0.0.1 for Claude, Codex, Cursor and any MCP client.',
                    'Disponible en el shell local (Electron): CΛNTO abre una pasarela MCP en 127.0.0.1 para Claude, Codex, Cursor y cualquier cliente MCP.',
                  )}
                </div>
              )}
            </div>

            <div className={s.section}>
              <div className={s.sectionTitle}>
                <span>{tr('Orchestrateur externe', 'External orchestrator', 'Orquestador externo')}</span>
                <Tag tone={orchestrator.running ? 'mint' : undefined} dot live={orchestrator.running}>
                  {orchestrator.running
                    ? tr(`port ${orchestrator.port} · ${orchestrator.clients} lien(s)`, `port ${orchestrator.port} · ${orchestrator.clients} link(s)`, `puerto ${orchestrator.port} · ${orchestrator.clients} enlace(s)`)
                    : tr('en veille', 'idle', 'en espera')}
                </Tag>
              </div>
              {isDesk ? (
                <>
                  <div className={s.row2}>
                    <Field label={tr('Port WebSocket', 'WebSocket port', 'Puerto WebSocket')}>
                      <input type="number" min={1024} max={65535} value={port} onChange={(e) => update({ orchestratorPort: Number(e.target.value) || 47117 })} disabled={orchestrator.running} />
                    </Field>
                    <Field label={tr('État', 'Status', 'Estado')}>
                      {orchestrator.running ? (
                        <Button size="sm" variant="danger" onClick={() => stopOrchestrator()}>
                          {tr('Couper', 'Cut', 'Cortar')}
                        </Button>
                      ) : (
                        <Button size="sm" variant="gold" onClick={() => startOrchestrator()}>
                          {tr('Ouvrir la passerelle', 'Open gateway', 'Abrir la pasarela')}
                        </Button>
                      )}
                    </Field>
                  </div>
                  {orchestrator.error && <div className={s.error}>{orchestrator.error}</div>}
                  <div className={s.hint}>
                    {allowWrite
                      ? tr('Écriture autorisée (réglée avec la passerelle MCP).', 'Write allowed (set with the MCP gateway).', 'Escritura autorizada (se ajusta con la pasarela MCP).')
                      : tr('Lecture seule (réglée avec la passerelle MCP).', 'Read only (set with the MCP gateway).', 'Solo lectura (se ajusta con la pasarela MCP).')}
                  </div>
                </>
              ) : (
                <div className={s.hint}>
                  {tr(
                    'Disponible dans le shell local (Electron) : CΛNTO ouvre un serveur WebSocket sur 127.0.0.1 auquel un orchestrateur IA se connecte pour piloter le desk.',
                    'Available in the local shell (Electron): CΛNTO opens a WebSocket server on 127.0.0.1 that an AI orchestrator connects to in order to drive the desk.',
                    'Disponible en el shell local (Electron): CΛNTO abre un servidor WebSocket en 127.0.0.1 al que un orquestador IA se conecta para pilotar el desk.',
                  )}
                </div>
              )}
              {isDesk && (
                <Field
                  label={tr('Jeton de session', 'Session token', 'Token de sesión')}
                  hint={tr(
                    'à fournir par l’orchestrateur : ?token=… ou desk.auth — les pages web sont refusées',
                    'to be provided by the orchestrator: ?token=… or desk.auth — web pages are refused',
                    'a aportar por el orquestador: ?token=… o desk.auth — las páginas web se rechazan',
                  )}
                >
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input readOnly value="••••" className="mono" style={{ flex: 1, fontSize: 11 }} aria-label={tr('Jeton masqué', 'Masked token', 'Token enmascarado')} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const token = await desk?.orchestrator.copyToken?.();
                        if (token) await navigator.clipboard?.writeText(token);
                        toast(
                          token ? tr('Jeton copié.', 'Token copied.', 'Token copiado.') : tr('Jeton indisponible.', 'Token unavailable.', 'Token no disponible.'),
                          token ? 'ok' : 'warn',
                        );
                      }}
                    >
                      {tr('Copier le jeton', 'Copy token', 'Copiar el token')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => rotateToken()} title={tr('Régénérer le jeton (déconnecte les liens)', 'Regenerate token (disconnects links)', 'Regenerar el token (desconecta los enlaces)')}>
                      {tr('Renouveler', 'Renew', 'Renovar')}
                    </Button>
                  </div>
                </Field>
              )}
              <div className={s.hint}>
                {tr('Protocole JSON-RPC 2.0 sur', 'JSON-RPC 2.0 protocol on', 'Protocolo JSON-RPC 2.0 en')} <code>ws://127.0.0.1:{port}/?token=…</code>. {tr('Méthodes', 'Methods', 'Métodos')} : <code>desk.auth</code>, <code>desk.describe</code>, <code>desk.ping</code>, {tr('puis', 'then', 'luego')} <code>tool.&lt;nom&gt;</code> {tr('pour chaque outil natif.', 'for each native tool.', 'para cada herramienta nativa.')}
              </div>
              <pre className={s.proto}>{`→ {"jsonrpc":"2.0","id":0,"method":"desk.auth","params":{"token":"…"}}
→ {"jsonrpc":"2.0","id":1,"method":"desk.describe"}
→ {"jsonrpc":"2.0","id":2,"method":"tool.desk_overview","params":{}}
→ {"jsonrpc":"2.0","id":3,"method":"tool.list_sessions",
   "params":{"from":"2026-09-01","limit":10}}
← {"jsonrpc":"2.0","id":3,"result":{...}}
← {"jsonrpc":"2.0","method":"desk.event",
   "params":{"event":"session.updated",...}}`}</pre>
              {linkLog.length > 0 && (
                <div className={s.log}>
                  {linkLog.slice(0, 12).map((l) => (
                    <span key={l.id}>
                      {dateTimeFormatter({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(l.at)} {l.direction === 'in' ? '←' : '→'} <b>{l.method}</b>{' '}
                      <span className={l.ok ? s.ok : s.ko}>{l.ok ? 'ok' : l.detail ?? tr('erreur', 'error', 'error')}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <AgentOrdersPanel available={isDesk && !!desk?.agentOrders} />

            <div className={s.section}>
              <div className={s.sectionTitle}>
                <span>
                  {tr('Outils natifs', 'Native tools', 'Herramientas nativas')} · {nativeTools.length}
                </span>
              </div>
              {nativeTools.map((t) => (
                <div key={t.name} className={s.toolItem}>
                  <b>{t.name}</b>
                  <span>{t.description}</span>
                </div>
              ))}
              <div className={s.hint}>
                {tr(
                  'Architecture ouverte : les mêmes outils servent le modèle conversationnel et les agents externes. Pour le modèle, chaque écriture demande confirmation à l’opérateur ; pour un agent externe, l’écriture reste coupée tant qu’elle n’est pas autorisée ci-dessus.',
                  'Open architecture: the same tools serve the conversational model and external agents. For the model, every write asks the operator for confirmation; for an external agent, writing stays off until it is allowed above.',
                  'Arquitectura abierta: las mismas herramientas sirven al modelo conversacional y a los agentes externos. Para el modelo, cada escritura pide confirmación al operador; para un agente externo, la escritura queda cortada mientras no se autorice arriba.',
                )}
              </div>
            </div>
          </div>
        </div>
      </ModuleContent>
    </>
  );
}

function prettyToolContent(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 1);
  } catch {
    return content; /* texte brut */
  }
}

/** Mémorisé : les messages passés ne sont pas réaffichés (ni re-rendus en Markdown) à chaque jeton du flux. */
const Message = memo(function Message({ m }: { m: AgentMessage }) {
  useI18n((s) => s.locale);
  const html = useMemo(() => (m.role === 'assistant' && m.content ? renderMarkdown(m.content) : ''), [m.role, m.content]);
  const pretty = useMemo(() => (m.role === 'tool' ? prettyToolContent(m.content) : ''), [m.role, m.content]);
  if (m.role === 'tool') {
    return (
      <div className={cx(s.msg, s.assistant)}>
        <div className={s.msgHead}>
          <span className={s.toolChip}>
            <i /> {m.toolName} · {tr('résultat', 'result', 'resultado')}
          </span>
        </div>
        <div className={s.toolResult}>{pretty.length > 1200 ? `${pretty.slice(0, 1200)}…` : pretty}</div>
      </div>
    );
  }
  if (m.role === 'assistant') {
    return (
      <div className={cx(s.msg, s.assistant)}>
        <div className={s.msgHead}>
          <span>Agent</span>
          {m.toolCalls?.map((tc) => (
            <span key={tc.id} className={s.toolChip}>
              <i /> {tc.name}
            </span>
          ))}
        </div>
        {html && <div className={s.bubble} dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    );
  }
  return (
    <div className={cx(s.msg, s.user)}>
      <div className={s.msgHead}>
        <span>
          {tr('Opérateur', 'Operator', 'Operador')} · {dateTimeFormatter({ hour: '2-digit', minute: '2-digit' }).format(m.createdAt)}
        </span>
      </div>
      <div className={s.bubble}>{m.content}</div>
    </div>
  );
});
