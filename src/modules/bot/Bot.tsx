import { useEffect, useMemo, useState } from 'react';
import { IconPlus, IconTrash } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Empty, Field, Panel, Tag, cx } from '@/design/primitives';
import { generateNasdaqEvents } from '@/engine/calendar';
import { findPlan } from '@/engine/propfirm';
import { plural } from '@/lib/format';
import { dateKeyLocal, formatDateFr } from '@/lib/time';
import { BOT_TEMPLATES, deriveGuards, useBots, type BotRule } from '@/store/bots';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './bot.module.css';

const STAGES: { id: 'brouillon' | 'backtest' | 'papier'; label: string; text: string }[] = [
  { id: 'brouillon', label: 'Brouillon', text: 'Règles rédigées, revues par le trader.' },
  { id: 'backtest', label: 'Backtest', text: 'Rejeu sur barres importées (Visual).' },
  { id: 'papier', label: 'Papier', text: 'Statut d’atelier — aucun ordre n’est envoyé.' },
];

const KIND_TONE: Record<BotRule['kind'], 'ice' | 'mint' | 'ember'> = { condition: 'ice', action: 'mint', garde: 'ember' };
const KIND_LABEL: Record<BotRule['kind'], string> = { condition: 'Condition', action: 'Action', garde: 'Garde-fou' };

export default function Bot() {
  const { ready, bots, activeId, load, create, update, remove, setActive, addRule, removeRule } = useBots();
  const planId = useSettings((st) => st.settings.planId);
  const plan = useMemo(() => findPlan(planId), [planId]);
  const guards = useMemo(() => {
    const y = new Date().getFullYear();
    return deriveGuards(plan, [...generateNasdaqEvents(y), ...generateNasdaqEvents(y + 1)], 10);
  }, [plan]);
  const confirmDialog = useUi((u) => u.confirm);
  const [ruleKind, setRuleKind] = useState<BotRule['kind']>('condition');
  const [ruleText, setRuleText] = useState('');

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
              CONCEPTION
            </Tag>
            <Button variant="gold" onClick={() => create()}>
              <IconPlus size={14} /> Nouvel automate
            </Button>
          </>
        }
      />
      <ModuleContent>
        <div className={s.layout}>
          <div className={s.col}>
            <Panel title="Automates" sub={plural(bots.length, 'plan')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {bots.map((b) => (
                  <button key={b.id} className={cx(s.botItem, b.id === activeId && s.on)} onClick={() => setActive(b.id)}>
                    <b>{b.name}</b>
                    <small>
                      {b.instrument} · {STAGES.find((st) => st.id === b.status)?.label} · {plural(b.rules.length, 'règle')}
                    </small>
                  </button>
                ))}
                {bots.length === 0 && <div className={s.hint}>Aucun automate. Partez d’un gabarit ci-dessous ou d’une feuille blanche.</div>}
              </div>
            </Panel>
            <Panel title="Gabarits" sub="points de départ">
              <div className={s.templates}>
                {BOT_TEMPLATES.map((t) => (
                  <button key={t.id} className={s.template} onClick={() => create(t.id)}>
                    <b>{t.name}</b>
                    <span>{t.description}</span>
                  </button>
                ))}
              </div>
            </Panel>
          </div>

          <div className={s.col}>
            {bot ? (
              <>
                <Panel
                  title={bot.name}
                  sub={`créé le ${formatDateFr(dateKeyLocal(new Date(bot.createdAt)), { short: true })}`}
                  accent
                  actions={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (await confirmDialog(`Supprimer l’automate « ${bot.name} » ?`, `${plural(bot.rules.length, 'règle sera perdue', 'règles seront perdues')}.`)) await remove(bot.id);
                      }}
                      aria-label="Supprimer l’automate"
                      title="Supprimer l’automate"
                    >
                      <IconTrash size={13} />
                    </Button>
                  }
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className={s.formGrid}>
                      <Field label="Nom">
                        <input value={bot.name} onChange={(e) => update(bot.id, { name: e.target.value })} />
                      </Field>
                      <Field label="Instrument">
                        <select value={bot.instrument} onChange={(e) => update(bot.id, { instrument: e.target.value as 'NQ' | 'MNQ' })}>
                          <option value="MNQ">MNQ</option>
                          <option value="NQ">NQ</option>
                        </select>
                      </Field>
                      <Field label="Compte NinjaTrader">
                        <input value={bot.account ?? ''} onChange={(e) => update(bot.id, { account: e.target.value })} placeholder="Sim101, Apex-PA-50K…" />
                      </Field>
                    </div>
                    <Field label="Intention">
                      <textarea rows={2} value={bot.description} onChange={(e) => update(bot.id, { description: e.target.value })} placeholder="Ce que l’automate cherche à capturer, et dans quel contexte il doit rester à l’écart." />
                    </Field>
                    <div>
                      <div className="micro" style={{ marginBottom: 6 }}>
                        Cycle de vie
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

                <Panel title="Règles" sub="conditions · actions · garde-fous">
                  <div className={s.rules}>
                    {bot.rules.map((r) => (
                      <div key={r.id} className={s.rule}>
                        <Tag tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Tag>
                        <span>{r.text}</span>
                        <button onClick={() => removeRule(bot.id, r.id)} aria-label="Retirer">
                          ×
                        </button>
                      </div>
                    ))}
                    {bot.rules.length === 0 && <div className={s.hint}>Aucune règle. Décrivez l’automate en conditions d’entrée, actions et garde-fous : c’est cette grammaire que le moteur d’exécution lira en phase 2.</div>}
                    <div className={s.ruleForm}>
                      <select value={ruleKind} onChange={(e) => setRuleKind(e.target.value as BotRule['kind'])}>
                        <option value="condition">Condition</option>
                        <option value="action">Action</option>
                        <option value="garde">Garde-fou</option>
                      </select>
                      <input
                        value={ruleText}
                        onChange={(e) => setRuleText(e.target.value)}
                        placeholder="Ex. : clôture 1 min au-dessus du OR High"
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
                        Ajouter
                      </Button>
                    </div>
                  </div>
                </Panel>
              </>
            ) : (
              <Empty title="Atelier d’automates" text="Cet espace prépare la création de bots. En phase conception, vous formalisez la logique ; backtest et papier viendront ensuite. Aucun ordre n’est envoyé." />
            )}
          </div>

          <div className={s.col}>
            <Panel title="Garde-fous imposés" sub={plan ? `${plan.firm} · ${plan.label}` : 'aucun plan'}>
              <div className={s.guards}>
                {guards.map((g, i) => (
                  <div key={i} className={s.guard}>
                    {g}
                  </div>
                ))}
              </div>
              <p className={s.hint} style={{ marginTop: 10 }}>
                Dérivés automatiquement du plan prop firm suivi (Métrique › Prop firm) et des catalyseurs majeurs des 10 prochains jours (Calendrier). Aucun automate ne pourra les désactiver.
              </p>
            </Panel>
            <Panel title="Feuille de route" sub="atelier bot">
              <div className={s.roadmap}>
                <div className={s.phase}>
                  <i>P1</i>
                  <span>
                    <b>Conception</b> Formalisation des règles, gabarits, garde-fous dérivés. <Tag tone="amber">en cours</Tag>
                  </span>
                </div>
                <div className={s.phase}>
                  <i>P2</i>
                  <span>
                    <b>Backtest</b> Rejeu des règles sur les barres importées dans Visual, métriques dans Métrique.
                  </span>
                </div>
                <div className={s.phase}>
                  <i>P3</i>
                  <span>
                    <b>Papier</b> Exécution simulée par le pont NinjaTrader (transport WebSocket de l’AddOn CΛNTO Bridge).
                  </span>
                </div>
                <div className={s.phase}>
                  <i>P4</i>
                  <span>
                    <b>Réel verrouillé</b> Passage en compte financé sous garde-fous stricts et journal automatique.
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
