import { useEffect, useMemo, useState } from 'react';
import { IconPlus, IconTrash } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Empty, Field, Panel, Tag, cx } from '@/design/primitives';
import { generateNasdaqEvents } from '@/engine/calendar';
import { findPlan } from '@/engine/propfirm';
import { tr, useI18n } from '@/i18n';
import { plural } from '@/lib/format';
import { dateKeyLocal, formatDateFr } from '@/lib/time';
import { BOT_TEMPLATES, deriveGuards, useBots, type BotRule } from '@/store/bots';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './bot.module.css';

function stages(): { id: 'brouillon' | 'backtest' | 'papier'; label: string; text: string }[] {
  return [
    {
      id: 'brouillon',
      label: tr('Brouillon', 'Draft', 'Borrador'),
      text: tr('Règles rédigées, revues par le trader.', 'Rules drafted, reviewed by the trader.', 'Reglas redactadas, revisadas por el trader.'),
    },
    {
      id: 'backtest',
      label: 'Backtest',
      text: tr('Rejeu sur barres importées (Visual).', 'Replay on imported bars (Visual).', 'Repetición sobre barras importadas (Visual).'),
    },
    {
      id: 'papier',
      label: tr('Papier', 'Paper', 'Papel'),
      text: tr('Statut d’atelier — aucun ordre n’est envoyé.', 'Workshop status — no order is sent.', 'Estado de taller — no se envía ningún orden.'),
    },
  ];
}

const KIND_TONE: Record<BotRule['kind'], 'ice' | 'mint' | 'ember'> = { condition: 'ice', action: 'mint', garde: 'ember' };

function kindLabel(kind: BotRule['kind']): string {
  if (kind === 'condition') return tr('Condition', 'Condition', 'Condición');
  if (kind === 'action') return tr('Action', 'Action', 'Acción');
  return tr('Garde-fou', 'Guardrail', 'Salvaguarda');
}

function templateCopy(id: string, name: string, description: string): { name: string; description: string } {
  if (id === 'orb') {
    return {
      name: tr('ORB 15 min', 'ORB 15 min', 'ORB 15 min'),
      description: tr(
        'Cassure de l’opening range des 15 premières minutes RTH, dans le sens de la tendance VWAP.',
        'Breakout of the opening range from the first 15 RTH minutes, in the direction of the VWAP trend.',
        'Ruptura del opening range de los primeros 15 minutos RTH, en el sentido de la tendencia VWAP.',
      ),
    };
  }
  if (id === 'vwap') {
    return {
      name: tr('VWAP reclaim', 'VWAP reclaim', 'VWAP reclaim'),
      description: tr(
        'Reprise du VWAP après une excursion sous la bande −1σ, en tendance haussière.',
        'VWAP reclaim after an excursion below the −1σ band, in an uptrend.',
        'Recuperación del VWAP tras una excursión bajo la banda −1σ, en tendencia alcista.',
      ),
    };
  }
  return { name, description };
}

export default function Bot() {
  const locale = useI18n((s) => s.locale);
  const { ready, bots, activeId, load, create, update, remove, setActive, addRule, removeRule } = useBots();
  const planId = useSettings((st) => st.settings.planId);
  const plan = useMemo(() => findPlan(planId), [planId]);
  const guards = useMemo(() => {
    const y = new Date().getFullYear();
    return deriveGuards(plan, [...generateNasdaqEvents(y), ...generateNasdaqEvents(y + 1)], 10);
  }, [plan, locale]);
  const confirmDialog = useUi((u) => u.confirm);
  const [ruleKind, setRuleKind] = useState<BotRule['kind']>('condition');
  const [ruleText, setRuleText] = useState('');
  const STAGES = stages();

  useEffect(() => {
    if (!ready) load();
  }, [ready, load]);

  const bot = bots.find((b) => b.id === activeId) ?? null;
  const stageIndex = bot ? STAGES.findIndex((st) => st.id === bot.status) : -1;

  return (
    <>
      <ModuleHeader
        tab="bot"
        actions={
          <>
            <Tag tone="amber" dot>
              {tr('CONCEPTION', 'DESIGN', 'CONCEPCIÓN')}
            </Tag>
            <Button variant="gold" onClick={() => create()}>
              <IconPlus size={14} /> {tr('Nouvel automate', 'New automaton', 'Nuevo autómata')}
            </Button>
          </>
        }
      />
      <ModuleContent>
        <div className={s.layout}>
          <div className={s.col}>
            <Panel title={tr('Automates', 'Automata', 'Autómatas')} sub={plural(bots.length, tr('plan', 'plan', 'plan'), tr('plans', 'plans', 'planes'))}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {bots.map((b) => (
                  <button key={b.id} className={cx(s.botItem, b.id === activeId && s.on)} onClick={() => setActive(b.id)}>
                    <b>{b.name}</b>
                    <small>
                      {b.instrument} · {STAGES.find((st) => st.id === b.status)?.label} · {plural(b.rules.length, tr('règle', 'rule', 'regla'), tr('règles', 'rules', 'reglas'))}
                    </small>
                  </button>
                ))}
                {bots.length === 0 && (
                  <div className={s.hint}>
                    {tr(
                      'Aucun automate. Partez d’un gabarit ci-dessous ou d’une feuille blanche.',
                      'No automaton yet. Start from a template below or a blank sheet.',
                      'Ningún autómata. Parta de una plantilla abajo o de una hoja en blanco.',
                    )}
                  </div>
                )}
              </div>
            </Panel>
            <Panel title={tr('Gabarits', 'Templates', 'Plantillas')} sub={tr('points de départ', 'starting points', 'puntos de partida')}>
              <div className={s.templates}>
                {BOT_TEMPLATES.map((t) => {
                  const copy = templateCopy(t.id, t.name, t.description);
                  return (
                    <button key={t.id} className={s.template} onClick={() => create(t.id)}>
                      <b>{copy.name}</b>
                      <span>{copy.description}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div className={s.col}>
            {bot ? (
              <>
                <Panel
                  title={bot.name}
                  sub={`${tr('créé le', 'created', 'creado el')} ${formatDateFr(dateKeyLocal(new Date(bot.createdAt)), { short: true })}`}
                  accent
                  actions={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (
                          await confirmDialog(
                            tr(`Supprimer l’automate « ${bot.name} » ?`, `Delete automaton “${bot.name}”?`, `¿Eliminar el autómata « ${bot.name} »?`),
                            `${plural(
                              bot.rules.length,
                              tr('règle sera perdue', 'rule will be lost', 'regla se perderá'),
                              tr('règles seront perdues', 'rules will be lost', 'reglas se perderán'),
                            )}.`,
                          )
                        )
                          await remove(bot.id);
                      }}
                      aria-label={tr('Supprimer l’automate', 'Delete automaton', 'Eliminar el autómata')}
                      title={tr('Supprimer l’automate', 'Delete automaton', 'Eliminar el autómata')}
                    >
                      <IconTrash size={13} />
                    </Button>
                  }
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className={s.formGrid}>
                      <Field label={tr('Nom', 'Name', 'Nombre')}>
                        <input value={bot.name} onChange={(e) => update(bot.id, { name: e.target.value })} />
                      </Field>
                      <Field label={tr('Instrument', 'Instrument', 'Instrumento')}>
                        <select value={bot.instrument} onChange={(e) => update(bot.id, { instrument: e.target.value as 'NQ' | 'MNQ' })}>
                          <option value="MNQ">MNQ</option>
                          <option value="NQ">NQ</option>
                        </select>
                      </Field>
                      <Field label={tr('Compte NinjaTrader', 'NinjaTrader account', 'Cuenta NinjaTrader')}>
                        <input value={bot.account ?? ''} onChange={(e) => update(bot.id, { account: e.target.value })} placeholder="Sim101, Apex-PA-50K…" />
                      </Field>
                    </div>
                    <Field label={tr('Intention', 'Intent', 'Intención')}>
                      <textarea
                        rows={2}
                        value={bot.description}
                        onChange={(e) => update(bot.id, { description: e.target.value })}
                        placeholder={tr(
                          'Ce que l’automate cherche à capturer, et dans quel contexte il doit rester à l’écart.',
                          'What the automaton aims to capture, and in which context it should stay aside.',
                          'Lo que el autómata busca capturar, y en qué contexto debe mantenerse al margen.',
                        )}
                      />
                    </Field>
                    <div>
                      <div className="micro" style={{ marginBottom: 6 }}>
                        {tr('Cycle de vie', 'Lifecycle', 'Ciclo de vida')}
                      </div>
                      <div className={s.pipeline}>
                        {STAGES.map((st, i) => {
                          return (
                            <button key={st.id} className={cx(s.stage, i < stageIndex && s.done, i === stageIndex && s.current)} onClick={() => update(bot.id, { status: st.id })}>
                              <b>{st.label}</b>
                              <small>{st.text}</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </Panel>

                <Panel title={tr('Règles', 'Rules', 'Reglas')} sub={tr('conditions · actions · garde-fous', 'conditions · actions · guardrails', 'condiciones · acciones · salvaguardas')}>
                  <div className={s.rules}>
                    {bot.rules.map((r) => (
                      <div key={r.id} className={s.rule}>
                        <Tag tone={KIND_TONE[r.kind]}>{kindLabel(r.kind)}</Tag>
                        <span>{r.text}</span>
                        <button onClick={() => removeRule(bot.id, r.id)} aria-label={tr('Retirer', 'Remove', 'Quitar')}>
                          ×
                        </button>
                      </div>
                    ))}
                    {bot.rules.length === 0 && (
                      <div className={s.hint}>
                        {tr(
                          'Aucune règle. Décrivez l’automate en conditions d’entrée, actions et garde-fous : c’est cette grammaire que le moteur d’exécution lira en phase 2.',
                          'No rules yet. Describe the automaton with entry conditions, actions, and guardrails: that is the grammar the execution engine will read in phase 2.',
                          'Ninguna regla. Describa el autómata con condiciones de entrada, acciones y salvaguardas: esa es la gramática que el motor de ejecución leerá en la fase 2.',
                        )}
                      </div>
                    )}
                    <div className={s.ruleForm}>
                      <select value={ruleKind} onChange={(e) => setRuleKind(e.target.value as BotRule['kind'])}>
                        <option value="condition">{tr('Condition', 'Condition', 'Condición')}</option>
                        <option value="action">{tr('Action', 'Action', 'Acción')}</option>
                        <option value="garde">{tr('Garde-fou', 'Guardrail', 'Salvaguarda')}</option>
                      </select>
                      <input
                        value={ruleText}
                        onChange={(e) => setRuleText(e.target.value)}
                        placeholder={tr('Ex. : clôture 1 min au-dessus du OR High', 'E.g.: 1-min close above the OR High', 'Ej.: cierre de 1 min por encima del OR High')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && ruleText.trim()) {
                            addRule(bot.id, { kind: ruleKind, text: ruleText.trim() });
                            setRuleText('');
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          if (!ruleText.trim()) return;
                          addRule(bot.id, { kind: ruleKind, text: ruleText.trim() });
                          setRuleText('');
                        }}
                      >
                        {tr('Ajouter', 'Add', 'Añadir')}
                      </Button>
                    </div>
                  </div>
                </Panel>
              </>
            ) : (
              <Empty
                title={tr('Atelier d’automates', 'Automaton workshop', 'Taller de autómatas')}
                text={tr(
                  'Cet espace prépare la création de bots. En phase conception, vous formalisez la logique ; backtest et papier viendront ensuite. Aucun ordre n’est envoyé.',
                  'This space prepares bot creation. In the design phase you formalize the logic; backtest and paper come next. No order is sent.',
                  'Este espacio prepara la creación de bots. En la fase de concepción formaliza la lógica; backtest y papel vendrán después. No se envía ningún orden.',
                )}
              />
            )}
          </div>

          <div className={s.col}>
            <Panel title={tr('Garde-fous imposés', 'Imposed guardrails', 'Salvaguardas impuestas')} sub={plan ? `${plan.firm} · ${plan.label}` : tr('aucun plan', 'no plan', 'ningún plan')}>
              <div className={s.guards}>
                {guards.map((g, i) => (
                  <div key={i} className={s.guard}>
                    {g}
                  </div>
                ))}
              </div>
              <p className={s.hint} style={{ marginTop: 10 }}>
                {tr(
                  'Dérivés automatiquement du plan prop firm suivi (Métrique › Prop firm) et des catalyseurs majeurs des 10 prochains jours (Calendrier). Aucun automate ne pourra les désactiver.',
                  'Derived automatically from the tracked prop firm plan (Metrics › Prop firm) and major catalysts over the next 10 days (Calendar). No automaton can turn them off.',
                  'Derivadas automáticamente del plan prop firm seguido (Métrica › Prop firm) y de los catalizadores mayores de los próximos 10 días (Calendario). Ningún autómata podrá desactivarlas.',
                )}
              </p>
            </Panel>
            <Panel title={tr('Feuille de route', 'Roadmap', 'Hoja de ruta')} sub={tr('atelier bot', 'bot workshop', 'taller bot')}>
              <div className={s.roadmap}>
                <div className={s.phase}>
                  <i>P1</i>
                  <span>
                    <b>{tr('Conception', 'Design', 'Concepción')}</b>{' '}
                    {tr('Formalisation des règles, gabarits, garde-fous dérivés.', 'Formalizing rules, templates, derived guardrails.', 'Formalización de reglas, plantillas, salvaguardas derivadas.')}{' '}
                    <Tag tone="amber">{tr('en cours', 'in progress', 'en curso')}</Tag>
                  </span>
                </div>
                <div className={s.phase}>
                  <i>P2</i>
                  <span>
                    <b>Backtest</b>{' '}
                    {tr(
                      'Rejeu des règles sur les barres importées dans Visual, métriques dans Métrique.',
                      'Replay rules on bars imported in Visual, metrics in Metrics.',
                      'Repetición de las reglas sobre las barras importadas en Visual, métricas en Métrica.',
                    )}
                  </span>
                </div>
                <div className={s.phase}>
                  <i>P3</i>
                  <span>
                    <b>{tr('Papier', 'Paper', 'Papel')}</b>{' '}
                    {tr(
                      'Exécution simulée par le pont NinjaTrader (transport WebSocket de l’AddOn CΛNTO Bridge).',
                      'Simulated execution via the NinjaTrader bridge (WebSocket transport of the CΛNTO Bridge AddOn).',
                      'Ejecución simulada por el puente NinjaTrader (transporte WebSocket del AddOn CΛNTO Bridge).',
                    )}
                  </span>
                </div>
                <div className={s.phase}>
                  <i>P4</i>
                  <span>
                    <b>{tr('Réel verrouillé', 'Live locked', 'Real bloqueado')}</b>{' '}
                    {tr(
                      'Passage en compte financé sous garde-fous stricts et journal automatique.',
                      'Move to a funded account under strict guardrails and an automatic journal.',
                      'Paso a cuenta financiada bajo salvaguardas estrictas y diario automático.',
                    )}
                  </span>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </ModuleContent>
    </>
  );
}
