import { useEffect, useMemo, useState } from 'react';
import { LineArea } from '@/design/charts/LineArea';
import { Panel, Progress, Stat, Tag, cx } from '@/design/primitives';
import { DRAWDOWN_LABEL, PROP_FIRMS, findPlan, type DrawdownType } from '@/engine/propfirm';
import { tr, useI18n } from '@/i18n';
import { fmtInt, fmtPct, fmtUsd, plural } from '@/lib/format';
import { formatDateFr } from '@/lib/time';
import { useSettings } from '@/store/settings';
import s from './metrique.module.css';
import { useStats } from './useStats';

function firmIdForPlan(planId: string): string {
  return PROP_FIRMS.find((f) => f.plans.some((pl) => pl.id === planId))?.id ?? PROP_FIRMS[0]?.id ?? '';
}

function trDrawdown(type: DrawdownType): string {
  const fr = DRAWDOWN_LABEL[type];
  if (type === 'eod-trailing') return tr(fr, 'End-of-day trailing', 'Trailing de fin de jornada');
  if (type === 'intraday-trailing') return tr(fr, 'Intraday trailing', 'Trailing intradía');
  return tr(fr, 'Static', 'Estático');
}

function trPlanReason(reason: string): string {
  if (reason === 'Limite de perte journalière dépassée') {
    return tr('Limite de perte journalière dépassée', 'Daily loss limit exceeded', 'Límite de pérdida diaria superado');
  }
  for (const type of Object.keys(DRAWDOWN_LABEL) as DrawdownType[]) {
    const fr = `Drawdown maximal touché (${DRAWDOWN_LABEL[type].toLowerCase()})`;
    if (reason === fr) {
      return tr(fr, `Maximum drawdown hit (${trDrawdown(type).toLowerCase()})`, `Drawdown máximo tocado (${trDrawdown(type).toLowerCase()})`);
    }
  }
  return reason;
}

function trPayoutNote(note: string): string {
  const map: [string, string, string][] = [
    [
      'Express Funded Account après Combine. Payouts hebdomadaires selon règles du compte.',
      'Express Funded Account after Combine. Weekly payouts per account rules.',
      'Express Funded Account tras Combine. Pagos semanales según reglas de la cuenta.',
    ],
    [
      'Compte PA après évaluation ; règle de consistance 30 % sur les demandes de payout.',
      'PA account after evaluation; 30% consistency rule on payout requests.',
      'Cuenta PA tras evaluación; regla de consistencia del 30 % en solicitudes de payout.',
    ],
    [
      'Plans Starter / Expert ; règle de consistance selon plan.',
      'Starter / Expert plans; consistency rule per plan.',
      'Planes Starter / Expert; regla de consistencia según el plan.',
    ],
    [
      'Compte PRO après test ; retraits quotidiens possibles selon règles.',
      'PRO account after test; daily withdrawals possible per rules.',
      'Cuenta PRO tras la prueba; retiros diarios posibles según reglas.',
    ],
    [
      'Plans Growth / Select / Lightning avec règles distinctes.',
      'Growth / Select / Lightning plans with distinct rules.',
      'Planes Growth / Select / Lightning con reglas distintas.',
    ],
    [
      'Gauntlet Mini ; compte financé chez un partenaire après réussite.',
      'Gauntlet Mini; funded account with a partner after passing.',
      'Gauntlet Mini; cuenta fondeada con un socio tras aprobar.',
    ],
  ];
  for (const [fr, en, es] of map) {
    if (note === fr) return tr(fr, en, es);
  }
  return note;
}

export function PropFirmView() {
  const locale = useI18n((s) => s.locale);
  const { plan, planEval, sessions, accounts, planAccount } = useStats();
  const planId = useSettings((st) => st.settings.planId);
  const update = useSettings((st) => st.update);
  const [firmId, setFirmId] = useState(() => firmIdForPlan(planId));

  useEffect(() => {
    setFirmId(firmIdForPlan(planId));
  }, [planId]);

  const firm = PROP_FIRMS.find((f) => f.id === firmId) ?? PROP_FIRMS[0];
  const plans = firm?.plans ?? [];

  const selectFirm = (id: string) => {
    setFirmId(id);
    const f = PROP_FIRMS.find((x) => x.id === id);
    const keep = f?.plans.find((p) => p.id === planId) ?? f?.plans[0];
    if (keep) update({ planId: keep.id, startingBalance: keep.accountSize });
  };

  const selectPlan = (id: string) => {
    const p = findPlan(id);
    if (p) update({ planId: p.id, startingBalance: p.accountSize });
  };

  const timelineSeries = useMemo(() => {
    if (!planEval || !plan) return [];
    return [
      { id: 'balance', label: tr('Solde', 'Balance', 'Saldo'), color: 'var(--ice)', area: true, points: planEval.timeline.map((p) => ({ x: new Date(`${p.date}T12:00:00`).getTime(), y: p.balance, label: formatDateFr(p.date, { short: true }) })) },
      { id: 'floor', label: tr('Plancher', 'Floor', 'Suelo'), color: 'var(--ember)', dashed: true, points: planEval.timeline.map((p) => ({ x: new Date(`${p.date}T12:00:00`).getTime(), y: p.floor, label: formatDateFr(p.date, { short: true }) })) },
      { id: 'target', label: tr('Objectif', 'Target', 'Objetivo'), color: 'var(--gold)', dashed: true, points: planEval.timeline.map((p) => ({ x: new Date(`${p.date}T12:00:00`).getTime(), y: plan.accountSize + plan.profitTarget, label: formatDateFr(p.date, { short: true }) })) },
    ];
  }, [planEval, plan, locale]);

  return (
    <div className={cx(s.grid, s.gridTop)}>
      <Panel className={s.c4} title={tr('Plan prop', 'Prop plan', 'Plan prop')} sub={tr('choix en cascade', 'cascading choice', 'elección en cascada')}>
        <div className={s.cascade}>
          <label className={s.cascadeStep}>
            <span className={s.cascadeLabel}>
              <em>01</em> {tr('Firme', 'Firm', 'Firma')}
            </span>
            <select value={firmId} onChange={(e) => selectFirm(e.target.value)} aria-label={tr('Firme prop', 'Prop firm', 'Firma prop')}>
              {PROP_FIRMS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {firm && (
              <div className={s.cascadeHint}>
                <span>{firm.platform.join(' · ')}</span>
                <span>{firm.country}</span>
              </div>
            )}
          </label>

          <div className={s.cascadeRail} aria-hidden />

          <label className={s.cascadeStep}>
            <span className={s.cascadeLabel}>
              <em>02</em> {tr('Compte / plan', 'Account / plan', 'Cuenta / plan')}
            </span>
            <select value={planId} onChange={(e) => selectPlan(e.target.value)} aria-label={tr('Plan prop', 'Prop plan', 'Plan prop')} disabled={!plans.length}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · {tr('cible', 'target', 'objetivo')} {fmtUsd(p.profitTarget)}
                </option>
              ))}
            </select>
          </label>

          {plan && (
            <>
              <div className={s.cascadeRail} aria-hidden />
              <div className={s.cascadeNested}>
                <span className={s.cascadeLabel}>
                  <em>03</em> {tr('Règles imbriquées', 'Nested rules', 'Reglas anidadas')}
                </span>
                <dl className={s.cascadeRules}>
                  <div>
                    <dt>{tr('Taille', 'Size', 'Tamaño')}</dt>
                    <dd>{fmtUsd(plan.accountSize)}</dd>
                  </div>
                  <div>
                    <dt>{tr('Objectif', 'Target', 'Objetivo')}</dt>
                    <dd>{fmtUsd(plan.profitTarget)}</dd>
                  </div>
                  <div>
                    <dt>Drawdown</dt>
                    <dd>
                      {fmtUsd(plan.maxDrawdown)}
                      <small>{trDrawdown(plan.drawdownType)}</small>
                    </dd>
                  </div>
                  {plan.trailingLockAt !== undefined && (
                    <div>
                      <dt>{tr('Verrou trailing', 'Trailing lock', 'Bloqueo trailing')}</dt>
                      <dd>+{fmtUsd(plan.trailingLockAt)}</dd>
                    </div>
                  )}
                  {plan.dailyLossLimit !== undefined && (
                    <div>
                      <dt>{tr('Perte / jour', 'Loss / day', 'Pérdida / día')}</dt>
                      <dd>{fmtUsd(plan.dailyLossLimit)}</dd>
                    </div>
                  )}
                  {plan.consistencyPct !== undefined && (
                    <div>
                      <dt>{tr('Consistance', 'Consistency', 'Consistencia')}</dt>
                      <dd>≤ {fmtPct(plan.consistencyPct, 0)}</dd>
                    </div>
                  )}
                  {plan.minTradingDays !== undefined && (
                    <div>
                      <dt>{tr('Jours min.', 'Min. days', 'Días mín.')}</dt>
                      <dd>{plan.minTradingDays}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{tr('Phase', 'Phase', 'Fase')}</dt>
                    <dd>{plan.phase === 'evaluation' ? tr('Évaluation', 'Evaluation', 'Evaluación') : tr('Financé', 'Funded', 'Fondeado')}</dd>
                  </div>
                </dl>
                {firm?.payoutNote && <p className={s.cascadeNote}>{trPayoutNote(firm.payoutNote)}</p>}
              </div>
            </>
          )}
        </div>
        <p className={s.note} style={{ marginTop: 16 }}>
          <b>{tr('Registre indicatif.', 'Indicative registry.', 'Registro indicativo.')}</b>{' '}
          {tr(
            'Validez chaque paramètre sur le site de la firme. Le plan pilote le rejeu et la simulation Monte-Carlo.',
            'Validate each parameter on the firm’s website. The plan drives the replay and Monte-Carlo simulation.',
            'Valide cada parámetro en el sitio de la firma. El plan dirige la repetición y la simulación Monte-Carlo.',
          )}
        </p>
      </Panel>

      <div className={cx(s.c8, s.rows)}>
        {plan && planEval ? (
          <>
            <div className={cx(s.statusBanner, s[planEval.status])}>
              <div>
                <h4>
                  {plan.firm} · {plan.label} —{' '}
                  {planEval.status === 'objectif'
                    ? tr('Objectif atteint', 'Target reached', 'Objetivo alcanzado')
                    : planEval.status === 'echec'
                      ? tr('Compte invalidé', 'Account failed', 'Cuenta invalidada')
                      : tr('Évaluation en cours', 'Evaluation in progress', 'Evaluación en curso')}
                  {planAccount ? ` · ${planAccount}` : ''}
                </h4>
                <p>
                  {planEval.status === 'echec' && planEval.reason
                    ? tr(
                        `${planEval.reason} le ${formatDateFr(planEval.failedOn ?? '')}.`,
                        `${trPlanReason(planEval.reason)} on ${formatDateFr(planEval.failedOn ?? '')}.`,
                        `${trPlanReason(planEval.reason)} el ${formatDateFr(planEval.failedOn ?? '')}.`,
                      )
                    : planEval.status === 'objectif' && planEval.passedOn
                      ? tr(
                          `Objectif validé le ${formatDateFr(planEval.passedOn)} · ${DRAWDOWN_LABEL[plan.drawdownType]} · DD max ${fmtUsd(plan.maxDrawdown)}`,
                          `Target validated on ${formatDateFr(planEval.passedOn)} · ${trDrawdown(plan.drawdownType)} · max DD ${fmtUsd(plan.maxDrawdown)}`,
                          `Objetivo validado el ${formatDateFr(planEval.passedOn)} · ${trDrawdown(plan.drawdownType)} · DD máx. ${fmtUsd(plan.maxDrawdown)}`,
                        )
                      : `${trDrawdown(plan.drawdownType)} · DD max ${fmtUsd(plan.maxDrawdown)}${plan.dailyLossLimit ? ` · ${tr('perte/jour', 'loss/day', 'pérdida/día')} ${fmtUsd(plan.dailyLossLimit)}` : ''}${plan.consistencyPct ? ` · ${tr('consistance', 'consistency', 'consistencia')} ${fmtPct(plan.consistencyPct, 0)}` : ''}${plan.minTradingDays ? ` · ${plural(plan.minTradingDays, tr('jour', 'day', 'día'), tr('jours', 'days', 'días'))} min` : ''}`}
                </p>
              </div>
              <div style={{ marginLeft: 'auto', minWidth: 220 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }} className="micro">
                  <span>{tr('Objectif', 'Target', 'Objetivo')}</span>
                  <span>{fmtPct(planEval.targetProgress, 0)}</span>
                </div>
                <Progress value={planEval.targetProgress} tone={planEval.status === 'echec' ? 'ember' : 'gold'} />
              </div>
            </div>

            <div className={s.miniStats}>
              <Stat small label={tr('Solde', 'Balance', 'Saldo')} value={fmtUsd(planEval.balance)} hint={`${tr('départ', 'start', 'inicio')} ${fmtUsd(planEval.startBalance)}`} tone={planEval.balance >= planEval.startBalance ? 'pos' : 'neg'} />
              <Stat small label={tr('Plancher', 'Floor', 'Suelo')} value={fmtUsd(planEval.floor)} hint={plan.trailingLockAt !== undefined ? `${tr('verrou à', 'lock at', 'bloqueo a')} ${fmtUsd(plan.accountSize + plan.trailingLockAt)}` : trDrawdown(plan.drawdownType)} tone="ice" />
              <Stat small label={tr('Marge restante', 'Remaining buffer', 'Margen restante')} value={fmtUsd(planEval.buffer)} hint={`${fmtPct(planEval.buffer / plan.maxDrawdown, 0)} ${tr('du DD max', 'of max DD', 'del DD máx.')}`} tone={planEval.buffer < plan.maxDrawdown * 0.3 ? 'neg' : 'pos'} />
              <Stat small label={tr('Reste à gagner', 'Left to target', 'Resta por ganar')} value={fmtUsd(planEval.remainingToTarget)} hint={`${tr('objectif', 'target', 'objetivo')} ${fmtUsd(plan.profitTarget)}`} tone="gold" />
              <Stat small label={tr('Jours tradés', 'Days traded', 'Días operados')} value={fmtInt(planEval.daysTraded)} hint={plan.minTradingDays ? `${tr('minimum', 'minimum', 'mínimo')} ${plan.minTradingDays}` : tr('pas de minimum', 'no minimum', 'sin mínimo')} />
              <Stat
                small
                label={tr('Consistance', 'Consistency', 'Consistencia')}
                value={planEval.consistency.limit ? fmtPct(planEval.consistency.share, 0) : '—'}
                hint={
                  planEval.consistency.limit
                    ? `${tr('limite', 'limit', 'límite')} ${fmtPct(planEval.consistency.limit, 0)} · ${tr('meilleur jour', 'best day', 'mejor día')} ${fmtUsd(planEval.consistency.bestDay)}`
                    : tr('aucune règle', 'no rule', 'ninguna regla')
                }
                tone={planEval.consistency.ok ? 'pos' : 'neg'}
              />
            </div>

            <Panel
              title={tr('Rejeu du compte', 'Account replay', 'Repetición de la cuenta')}
              actions={
                <>
                  {accounts.length > 1 && (
                    <select value={planAccount} onChange={(e) => update({ planAccount: e.target.value })} style={{ height: 28, fontSize: 11, padding: '0 6px' }} title={tr('Compte rejoué contre le plan', 'Account replayed against the plan', 'Cuenta repetida contra el plan')}>
                      <option value="">{tr('Tous les comptes (agrégés par jour)', 'All accounts (aggregated by day)', 'Todas las cuentas (agregadas por día)')}</option>
                      {accounts.map((a) => (
                        <option key={a} value={a}>
                          {a || tr('Sans compte', 'No account', 'Sin cuenta')}
                        </option>
                      ))}
                    </select>
                  )}
                  {planEval.dailyLossBreaches.length > 0 && (
                    <Tag tone="ember">
                      {plural(planEval.dailyLossBreaches.length, tr('dépassement', 'breach', 'exceso'), tr('dépassements', 'breaches', 'excesos'))} {tr('perte/jour', 'loss/day', 'pérdida/día')}
                    </Tag>
                  )}
                </>
              }
            >
              {timelineSeries[0]?.points.length ? <LineArea series={timelineSeries} height={260} formatY={(v) => fmtUsd(v)} baseline={null} legend /> : <p className={s.note}>{tr('Aucune séance à rejouer.', 'No session to replay.', 'Ninguna sesión que repetir.')}</p>}
            </Panel>

            <Panel title={tr('Lecture', 'Readout', 'Lectura')} sub={tr('ce que le moteur vérifie', 'what the engine checks', 'lo que el motor verifica')}>
              <p className={s.note}>
                {tr(
                  'Le rejeu applique journée après journée : mise à jour du plus haut, calcul du plancher, franchissement, limite journalière, consistance et jours minimum. L’objectif est validé le jour où toutes les conditions sont réunies.',
                  'The replay applies day after day: high-water update, floor calculation, breach, daily limit, consistency and minimum days. The target is validated on the day all conditions are met.',
                  'La repetición aplica día tras día: actualización del máximo, cálculo del suelo, ruptura, límite diario, consistencia y días mínimos. El objetivo se valida el día en que se reúnen todas las condiciones.',
                )}{' '}
                {plural(planEval.timeline.length, tr('journée rejouée', 'day replayed', 'día repetido'), tr('journées rejouées', 'days replayed', 'días repetidos'))} {tr('sur', 'over', 'sobre')} {plural(sessions.length, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))}.
              </p>
            </Panel>
          </>
        ) : (
          <Panel title={tr('Aucun plan sélectionné', 'No plan selected', 'Ningún plan seleccionado')}>
            <p className={s.note}>{tr('Choisissez une firme puis un plan pour rejouer votre journal.', 'Choose a firm then a plan to replay your journal.', 'Elija una firma y luego un plan para repetir su diario.')}</p>
          </Panel>
        )}
      </div>
    </div>
  );
}
