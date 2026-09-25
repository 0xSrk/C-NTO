import { useEffect, useRef, useState } from 'react';
import { IconSend } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Field, Tag, Toggle, cx } from '@/design/primitives';
import { DESK_TOOLS, toolBlurb } from '@/engine/agent/tools';
import { intlTag, tr, useI18n } from '@/i18n';
import { desk, isDesk } from '@/lib/desk';
import { fmtNum } from '@/lib/format';
import type { AgentMessage } from '@/store/db';
import { useAgent } from '@/store/agent';
import { defaultAgentPrompt, isDefaultAgentPrompt, useSettings, type AgentProvider } from '@/store/settings';
import { useUi } from '@/store/ui';
import { renderMarkdown } from '../note/markdown';
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
      'Quels catalyseurs Nasdaq arrivent dans les 10 prochains jours et comment les aborder ?',
      'Which Nasdaq catalysts arrive in the next 10 days, and how should I approach them?',
      '¿Qué catalizadores Nasdaq llegan en los próximos 10 días y cómo abordarlos?',
    ),
  ];
}

const PRESETS: { id: string; label: string; provider: AgentProvider; baseUrl: string; model: string }[] = [
  { id: 'ollama', label: 'Ollama (local)', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { id: 'lmstudio', label: 'LM Studio (local)', provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
  { id: 'openai', label: 'OpenAI', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4' },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514' },
];

export default function Agent() {
  useI18n((s) => s.locale);
  const { messages, streaming, streamText, pendingTool, error, send, stop, newConversation, probe, orchestrator, startOrchestrator, stopOrchestrator, rotateToken, linkLog } = useAgent();
  const agent = useSettings((st) => st.settings.agent);
  const port = useSettings((st) => st.settings.orchestratorPort);
  const allowWrite = useSettings((st) => st.settings.orchestratorAllowWrite);
  const keyEncrypted = useSettings((st) => st.keyEncrypted);
  const updateAgent = useSettings((st) => st.updateAgent);
  const update = useSettings((st) => st.update);
  const toast = useUi((u) => u.toast);
  const [draft, setDraft] = useState('');
  const [probeState, setProbeState] = useState<{ ok: boolean; detail: string; models?: string[] } | null>(null);
  const [probing, setProbing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sugs = suggestions();
  const systemPromptValue = isDefaultAgentPrompt(agent.systemPrompt) ? defaultAgentPrompt() : agent.systemPrompt;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, streamText]);

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    send(text);
  };

  const visibleMessages = messages.filter((m) => m.role !== 'system');

  return (
    <>
      <ModuleHeader
        tab="agent"
        actions={
          <>
            <Tag tone={probeState?.ok ? 'mint' : 'gold'} dot live={streaming}>
              {agent.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'} · {agent.model}
            </Tag>
            <Button variant="ghost" onClick={() => newConversation()}>
              {tr('Nouvelle conversation', 'New conversation', 'Nueva conversación')}
            </Button>
          </>
        }
      />
      <ModuleContent noPad>
        <div className={s.layout}>
          <section className={s.chat}>
            <div className={s.messages} ref={listRef}>
              {visibleMessages.length === 0 && !streaming && (
                <div className={s.welcome}>
                  <h2>{tr('Passerelle agent', 'Agent gateway', 'Pasarela del agente')}</h2>
                  <p>
                    {tr(
                      'L’agent lit le desk par des outils natifs — métriques, séances, notes, calendrier, plan prop firm — et peut écrire des notes ou annoter des séances. Connectez un modèle local (Ollama, LM Studio) ou distant dans le panneau de droite, puis posez une question.',
                      'The agent reads the desk through native tools — metrics, sessions, notes, calendar, prop firm plan — and can write notes or annotate sessions. Connect a local model (Ollama, LM Studio) or a remote one in the right panel, then ask a question.',
                      'El agente lee el desk con herramientas nativas — métricas, sesiones, notas, calendario, plan prop firm — y puede escribir notas o anotar sesiones. Conecte un modelo local (Ollama, LM Studio) o remoto en el panel derecho, luego formule una pregunta.',
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
                  {streamText ? <div className={cx(s.bubble, s.cursor)} dangerouslySetInnerHTML={{ __html: renderMarkdown(streamText) }} /> : <div className={cx(s.bubble, s.cursor)}>{pendingTool ? tr('Lecture du desk…', 'Reading the desk…', 'Leyendo el desk…') : tr('Réflexion', 'Thinking', 'Reflexión')}</div>}
                </div>
              )}
              {error && (
                <div className={s.error}>
                  {tr('Erreur fournisseur :', 'Provider error:', 'Error del proveedor:')} {error}
                </div>
              )}
            </div>
            <div className={s.composer}>
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

          <aside className={s.side}>
            <div className={s.section}>
              <div className={s.sectionTitle}>
                <span>{tr('Fournisseur', 'Provider', 'Proveedor')}</span>
                <select
                  style={{ height: 28, padding: '0 6px', fontSize: 11 }}
                  value=""
                  onChange={(e) => {
                    const p = PRESETS.find((x) => x.id === e.target.value);
                    if (p) updateAgent({ provider: p.provider, baseUrl: p.baseUrl, model: p.model });
                  }}
                >
                  <option value="">{tr('Préréglages…', 'Presets…', 'Preajustes…')}</option>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
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
                  keyEncrypted
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
                  <Toggle
                    on={allowWrite}
                    onChange={(v) => update({ orchestratorAllowWrite: v })}
                    label={
                      allowWrite
                        ? tr('écriture autorisée (notes, annotations)', 'write allowed (notes, annotations)', 'escritura autorizada (notas, anotaciones)')
                        : tr('lecture seule', 'read only', 'solo lectura')
                    }
                  />
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
                      {new Date(l.at).toLocaleTimeString(intlTag())} {l.direction === 'in' ? '←' : '→'} <b>{l.method}</b>{' '}
                      <span className={l.ok ? s.ok : s.ko}>{l.ok ? 'ok' : l.detail ?? tr('erreur', 'error', 'error')}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className={s.section}>
              <div className={s.sectionTitle}>
                <span>
                  {tr('Outils natifs', 'Native tools', 'Herramientas nativas')} · {DESK_TOOLS.length}
                </span>
              </div>
              {DESK_TOOLS.map((t) => (
                <div key={t.name} className={s.toolItem}>
                  <b>{t.name}</b>
                  <span>{toolBlurb(t.name, t.description)}</span>
                </div>
              ))}
              <div className={s.hint}>
                {tr(
                  'Architecture ouverte : les mêmes outils servent le modèle conversationnel et l’orchestrateur externe ; les outils d’écriture demandent confirmation à l’opérateur. Le desk évolue au rythme du trader.',
                  'Open architecture: the same tools serve the conversational model and the external orchestrator; write tools ask the operator for confirmation. The desk evolves at the trader’s pace.',
                  'Arquitectura abierta: las mismas herramientas sirven al modelo conversacional y al orquestador externo; las de escritura piden confirmación al operador. El desk evoluciona al ritmo del trader.',
                )}
              </div>
            </div>
          </aside>
        </div>
      </ModuleContent>
    </>
  );
}

function Message({ m }: { m: AgentMessage }) {
  useI18n((s) => s.locale);
  if (m.role === 'tool') {
    let pretty = m.content;
    try {
      pretty = JSON.stringify(JSON.parse(m.content), null, 1);
    } catch {
      /* texte brut */
    }
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
        {m.content && <div className={s.bubble} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />}
      </div>
    );
  }
  return (
    <div className={cx(s.msg, s.user)}>
      <div className={s.msgHead}>
        <span>
          {tr('Opérateur', 'Operator', 'Operador')} · {new Date(m.createdAt).toLocaleTimeString(intlTag(), { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className={s.bubble}>{m.content}</div>
    </div>
  );
}
