import { useEffect, useRef, useState } from 'react';
import { IconSend } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Field, Tag, Toggle, cx } from '@/design/primitives';
import { DESK_TOOLS } from '@/engine/agent/tools';
import { isDesk } from '@/lib/desk';
import { fmtNum } from '@/lib/format';
import type { AgentMessage } from '@/store/db';
import { useAgent } from '@/store/agent';
import { useSettings, type AgentProvider } from '@/store/settings';
import { useUi } from '@/store/ui';
import { renderMarkdown } from '../note/markdown';
import s from './agent.module.css';

const SUGGESTIONS = [
  'Fais un diagnostic de mon journal : forces, faiblesses, trois axes de travail.',
  'Quels créneaux horaires et jours de semaine dois-je éviter d’après mes séances ?',
  'Où en suis-je sur mon plan prop firm et quel risque par trade est cohérent avec la marge restante ?',
  'Rédige la note de revue hebdomadaire à partir de mes 5 dernières séances.',
  'Quels catalyseurs Nasdaq arrivent dans les 10 prochains jours et comment les aborder ?',
];

const PRESETS: { id: string; label: string; provider: AgentProvider; baseUrl: string; model: string }[] = [
  { id: 'ollama', label: 'Ollama (local)', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  { id: 'lmstudio', label: 'LM Studio (local)', provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
  { id: 'openai', label: 'OpenAI', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4' },
  { id: 'anthropic', label: 'Anthropic', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514' },
];

export default function Agent() {
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
              Nouvelle conversation
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
                  <h2>Passerelle agent</h2>
                  <p>
                    L’agent lit le desk par des outils natifs — métriques, séances, notes, calendrier, plan prop firm — et peut écrire des notes ou annoter des séances. Connectez un modèle local (Ollama, LM Studio) ou distant dans le panneau de droite, puis posez une question.
                  </p>
                  <div className={s.suggestions} style={{ justifyContent: 'center' }}>
                    {SUGGESTIONS.map((sg) => (
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
                  {streamText ? <div className={cx(s.bubble, s.cursor)} dangerouslySetInnerHTML={{ __html: renderMarkdown(streamText) }} /> : <div className={cx(s.bubble, s.cursor)}>{pendingTool ? 'Lecture du desk…' : 'Réflexion'}</div>}
                </div>
              )}
              {error && <div className={s.error}>Erreur fournisseur : {error}</div>}
            </div>
            <div className={s.composer}>
              {visibleMessages.length > 0 && (
                <div className={s.suggestions}>
                  {SUGGESTIONS.slice(0, 3).map((sg) => (
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
                  placeholder="Demander à l’agent… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"
                  rows={2}
                />
                {streaming ? (
                  <Button variant="danger" onClick={stop}>
                    Arrêter
                  </Button>
                ) : (
                  <Button variant="gold" onClick={submit} disabled={!draft.trim()}>
                    <IconSend size={14} /> Envoyer
                  </Button>
                )}
              </div>
            </div>
          </section>

          <aside className={s.side}>
            <div className={s.section}>
              <div className={s.sectionTitle}>
                <span>Fournisseur</span>
                <select
                  style={{ height: 24, padding: '0 6px', fontSize: 11 }}
                  value=""
                  onChange={(e) => {
                    const p = PRESETS.find((x) => x.id === e.target.value);
                    if (p) updateAgent({ provider: p.provider, baseUrl: p.baseUrl, model: p.model });
                  }}
                >
                  <option value="">Préréglages…</option>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={s.row2}>
                <Field label="Protocole">
                  <select value={agent.provider} onChange={(e) => updateAgent({ provider: e.target.value as AgentProvider })}>
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic Messages</option>
                  </select>
                </Field>
                <Field label="Modèle">
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
              <Field label="URL de base" hint={/^http:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/i.test(agent.baseUrl) ? 'Connexion non chiffrée vers un hôte distant : la clé API transiterait en clair.' : undefined}>
                <input value={agent.baseUrl} onChange={(e) => updateAgent({ baseUrl: e.target.value })} spellCheck={false} />
              </Field>
              <Field label="Clé API" hint={keyEncrypted ? 'chiffrée au repos par le trousseau du système · jamais exportée' : isDesk ? 'stockée dans le coffre local · jamais exportée' : 'mode navigateur : stockée en clair dans le coffre local, jamais exportée'}>
                <input type="password" value={agent.apiKey} onChange={(e) => updateAgent({ apiKey: e.target.value })} placeholder="optionnelle pour un modèle local" />
              </Field>
              <div className={s.row2}>
                <Field label={`Température · ${fmtNum(agent.temperature, 1)}`}>
                  <input type="range" min={0} max={1} step={0.1} value={agent.temperature} onChange={(e) => updateAgent({ temperature: Number(e.target.value) })} />
                </Field>
                <Field label="Outils du desk">
                  <Toggle on={agent.toolsEnabled} onChange={(v) => updateAgent({ toolsEnabled: v })} label={agent.toolsEnabled ? 'activés' : 'désactivés'} />
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
                    toast(r.ok ? `Fournisseur joignable : ${r.detail}` : `Fournisseur injoignable : ${r.detail}`, r.ok ? 'ok' : 'error');
                  }}
                >
                  {probing ? 'Test…' : 'Tester la connexion'}
                </Button>
                {probeState && <Tag tone={probeState.ok ? 'mint' : 'ember'}>{probeState.ok ? 'joignable' : 'échec'}</Tag>}
              </div>
              <Field label="Consigne système">
                <textarea rows={5} value={agent.systemPrompt} onChange={(e) => updateAgent({ systemPrompt: e.target.value })} style={{ fontSize: 12 }} />
              </Field>
            </div>

            <div className={s.section}>
              <div className={s.sectionTitle}>
                <span>Orchestrateur externe</span>
                <Tag tone={orchestrator.running ? 'mint' : undefined} dot live={orchestrator.running}>
                  {orchestrator.running ? `port ${orchestrator.port} · ${orchestrator.clients} lien(s)` : 'en veille'}
                </Tag>
              </div>
              {isDesk ? (
                <>
                  <div className={s.row2}>
                    <Field label="Port WebSocket">
                      <input type="number" min={1024} max={65535} value={port} onChange={(e) => update({ orchestratorPort: Number(e.target.value) || 47117 })} disabled={orchestrator.running} />
                    </Field>
                    <Field label="État">
                      {orchestrator.running ? (
                        <Button size="sm" variant="danger" onClick={() => stopOrchestrator()}>
                          Couper
                        </Button>
                      ) : (
                        <Button size="sm" variant="gold" onClick={() => startOrchestrator()}>
                          Ouvrir la passerelle
                        </Button>
                      )}
                    </Field>
                  </div>
                  {orchestrator.error && <div className={s.error}>{orchestrator.error}</div>}
                  <Toggle on={allowWrite} onChange={(v) => update({ orchestratorAllowWrite: v })} label={allowWrite ? 'écriture autorisée (notes, annotations)' : 'lecture seule'} />
                </>
              ) : (
                <div className={s.hint}>Disponible dans le shell local (Electron) : CΛNTO ouvre un serveur WebSocket sur 127.0.0.1 auquel un orchestrateur IA se connecte pour piloter le desk.</div>
              )}
              {isDesk && orchestrator.token && (
                <Field label="Jeton de session" hint="à fournir par l’orchestrateur : ?token=… ou desk.auth — les pages web sont refusées">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input readOnly value={orchestrator.token} className="mono" style={{ flex: 1, fontSize: 11 }} onFocus={(e) => e.currentTarget.select()} />
                    <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(orchestrator.token ?? '').then(() => toast('Jeton copié.', 'ok'))}>
                      Copier
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => rotateToken()} title="Régénérer le jeton (déconnecte les liens)">
                      Renouveler
                    </Button>
                  </div>
                </Field>
              )}
              <div className={s.hint}>
                Protocole JSON-RPC 2.0 sur <code>ws://127.0.0.1:{port}/?token=…</code>. Méthodes : <code>desk.auth</code>, <code>desk.describe</code>, <code>desk.ping</code>, puis <code>tool.&lt;nom&gt;</code> pour chaque outil natif.
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
                      {new Date(l.at).toLocaleTimeString('fr-FR')} {l.direction === 'in' ? '←' : '→'} <b>{l.method}</b> <span className={l.ok ? s.ok : s.ko}>{l.ok ? 'ok' : l.detail ?? 'erreur'}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className={s.section}>
              <div className={s.sectionTitle}>
                <span>Outils natifs · {DESK_TOOLS.length}</span>
              </div>
              {DESK_TOOLS.map((t) => (
                <div key={t.name} className={s.toolItem}>
                  <b>{t.name}</b>
                  <span>{t.description}</span>
                </div>
              ))}
              <div className={s.hint}>Architecture ouverte : les mêmes outils servent le modèle conversationnel et l’orchestrateur externe ; les outils d’écriture demandent confirmation à l’opérateur. Le desk évolue au rythme du trader.</div>
            </div>
          </aside>
        </div>
      </ModuleContent>
    </>
  );
}

function Message({ m }: { m: AgentMessage }) {
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
            <i /> {m.toolName} · résultat
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
        <span>Opérateur · {new Date(m.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className={s.bubble}>{m.content}</div>
    </div>
  );
}
