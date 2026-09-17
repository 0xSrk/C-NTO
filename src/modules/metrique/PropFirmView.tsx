import { useEffect, useMemo, useState } from 'react';
import { LineArea } from '@/design/charts/LineArea';
import { Panel, Progress, Stat, Tag, cx } from '@/design/primitives';
import { DRAWDOWN_LABEL, PROP_FIRMS, findPlan } from '@/engine/propfirm';
import { fmtInt, fmtPct, fmtUsd, plural } from '@/lib/format';
import { formatDateFr } from '@/lib/time';
import { useSettings } from '@/store/settings';
import s from './metrique.module.css';
import { useStats } from './useStats';

function firmIdForPlan(planId: string): string {
  return PROP_FIRMS.find((f) => f.plans.some((pl) => pl.id === planId))?.id ?? PROP_FIRMS[0]?.id ?? '';
}

export function PropFirmView() {
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
      { id: 'balance', label: 'Solde', color: 'var(--ice)', area: true, points: planEval.timeline.map((p) => ({ x: new Date(`${p.date}T12:00:00`).getTime(), y: p.balance, label: formatDateFr(p.date, { short: true }) })) },
      { id: 'floor', label: 'Plancher', color: 'var(--ember)', dashed: true, points: planEval.timeline.map((p) => ({ x: new Date(`${p.date}T12:00:00`).getTime(), y: p.floor, label: formatDateFr(p.date, { short: true }) })) },
      { id: 'target', label: 'Objectif', color: 'var(--gold)', dashed: true, points: planEval.timeline.map((p) => ({ x: new Date(`${p.date}T12:00:00`).getTime(), y: plan.accountSize + plan.profitTarget, label: formatDateFr(p.date, { short: true }) })) },
    ];
  }, [planEval, plan]);

  return (
    <div className={cx(s.grid, s.gridTop)}>
      <Panel className={s.c4} title="Plan prop" sub="choix en cascade">
        <div className={s.cascade}>
          <label className={s.cascadeStep}>
            <span className={s.cascadeLabel}>
              <em>01</em> Firme
            </span>
            <select value={firmId} onChange={(e) => selectFirm(e.target.value)} aria-label="Firme prop">
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
              <em>02</em> Compte / plan
            </span>
            <select value={planId} onChange={(e) => selectPlan(e.target.value)} aria-label="Plan prop" disabled={!plans.length}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} · cible {fmtUsd(p.profitTarget)}
                </option>
              ))}
            </select>
          </label>

          {plan && (
            <>
              <div className={s.cascadeRail} aria-hidden />
              <div className={s.cascadeNested}>
                <span className={s.cascadeLabel}>
                  <em>03</em> Règles imbriquées
                </span>
                <dl className={s.cascadeRules}>
                  <div>
                    <dt>Taille</dt>
                    <dd>{fmtUsd(plan.accountSize)}</dd>
                  </div>
                  <div>
                    <dt>Objectif</dt>
                    <dd>{fmtUsd(plan.profitTarget)}</dd>
                  </div>
                  <div>
                    <dt>Drawdown</dt>
                    <dd>
                      {fmtUsd(plan.maxDrawdown)}
                      <small>{DRAWDOWN_LABEL[plan.drawdownType]}</small>
                    </dd>
                  </div>
                  {plan.trailingLockAt !== undefined && (
                    <div>
                      <dt>Verrou trailing</dt>
                      <dd>+{fmtUsd(plan.trailingLockAt)}</dd>
                    </div>
                  )}
                  {plan.dailyLossLimit !== undefined && (
                    <div>
                      <dt>Perte / jour</dt>
                      <dd>{fmtUsd(plan.dailyLossLimit)}</dd>
                    </div>
                  )}
                  {plan.consistencyPct !== undefined && (
                    <div>
                      <dt>Consistance</dt>
                      <dd>≤ {fmtPct(plan.consistencyPct, 0)}</dd>
                    </div>
                  )}
                  {plan.minTradingDays !== undefined && (
                    <div>
                      <dt>Jours min.</dt>
                      <dd>{plan.minTradingDays}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Phase</dt>
                    <dd>{plan.phase === 'evaluation' ? 'Évaluation' : 'Funded'}</dd>
                  </div>
                </dl>
                {firm?.payoutNote && <p className={s.cascadeNote}>{firm.payoutNote}</p>}
              </div>
            </>
          )}
        </div>
        <p className={s.note} style={{ marginTop: 16 }}>
          <b>Registre indicatif.</b> Validez chaque paramètre sur le site de la firme. Le plan pilote le rejeu et le Monte Carlo.
        </p>
      </Panel>

      <div className={cx(s.c8, s.rows)}>
        {plan && planEval ? (
          <>
            <div className={cx(s.statusBanner, s[planEval.status])}>
              <div>
                <h4>
                  {plan.firm} · {plan.label} — {planEval.status === 'objectif' ? 'Objectif atteint' : planEval.status === 'echec' ? 'Compte invalidé' : 'Évaluation en cours'}
                  {planAccount ? ` · ${planAccount}` : ''}
                </h4>
                <p>
                  {planEval.status === 'echec' && planEval.reason
                    ? `${planEval.reason} le ${formatDateFr(planEval.failedOn ?? '')}.`
                    : planEval.status === 'objectif' && planEval.passedOn
                      ? `Objectif validé le ${formatDateFr(planEval.passedOn)} · ${DRAWDOWN_LABEL[plan.drawdownType]} · DD max ${fmtUsd(plan.maxDrawdown)}`
                      : `${DRAWDOWN_LABEL[plan.drawdownType]} · DD max ${fmtUsd(plan.maxDrawdown)}${plan.dailyLossLimit ? ` · perte/jour ${fmtUsd(plan.dailyLossLimit)}` : ''}${plan.consistencyPct ? ` · consistance ${fmtPct(plan.consistencyPct, 0)}` : ''}${plan.minTradingDays ? ` · ${plural(plan.minTradingDays, 'jour')} min` : ''}`}
                </p>
              </div>
              <div style={{ marginLeft: 'auto', minWidth: 220 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }} className="micro">
                  <span>Objectif</span>
                  <span>{fmtPct(planEval.targetProgress, 0)}</span>
                </div>
                <Progress value={planEval.targetProgress} tone={planEval.status === 'echec' ? 'ember' : 'gold'} />
              </div>
            </div>

            <div className={s.miniStats}>
              <Stat small label="Solde" value={fmtUsd(planEval.balance)} hint={`départ ${fmtUsd(planEval.startBalance)}`} tone={planEval.balance >= planEval.startBalance ? 'pos' : 'neg'} />
              <Stat small label="Plancher" value={fmtUsd(planEval.floor)} hint={plan.trailingLockAt !== undefined ? `verrou à ${fmtUsd(plan.accountSize + plan.trailingLockAt)}` : DRAWDOWN_LABEL[plan.drawdownType]} tone="ice" />
              <Stat small label="Marge restante" value={fmtUsd(planEval.buffer)} hint={`${fmtPct(planEval.buffer / plan.maxDrawdown, 0)} du DD max`} tone={planEval.buffer < plan.maxDrawdown * 0.3 ? 'neg' : 'pos'} />
              <Stat small label="Reste à gagner" value={fmtUsd(planEval.remainingToTarget)} hint={`objectif ${fmtUsd(plan.profitTarget)}`} tone="gold" />
              <Stat small label="Jours tradés" value={fmtInt(planEval.daysTraded)} hint={plan.minTradingDays ? `minimum ${plan.minTradingDays}` : 'pas de minimum'} />
              <Stat small label="Consistance" value={planEval.consistency.limit ? fmtPct(planEval.consistency.share, 0) : '—'} hint={planEval.consistency.limit ? `limite ${fmtPct(planEval.consistency.limit, 0)} · meilleur jour ${fmtUsd(planEval.consistency.bestDay)}` : 'aucune règle'} tone={planEval.consistency.ok ? 'pos' : 'neg'} />
            </div>

            <Panel
              title="Rejeu du compte"
              actions={
                <>
                  {accounts.length > 1 && (
                    <select value={planAccount} onChange={(e) => update({ planAccount: e.target.value })} style={{ height: 28, fontSize: 11, padding: '0 6px' }} title="Compte rejoué contre le plan">
                      <option value="">Tous les comptes (agrégés par jour)</option>
                      {accounts.map((a) => (
                        <option key={a} value={a}>
                          {a || 'Sans compte'}
                        </option>
                      ))}
                    </select>
                  )}
                  {planEval.dailyLossBreaches.length > 0 && <Tag tone="ember">{plural(planEval.dailyLossBreaches.length, 'dépassement')} perte/jour</Tag>}
                </>
              }
            >
              {timelineSeries[0]?.points.length ? <LineArea series={timelineSeries} height={260} formatY={(v) => fmtUsd(v)} baseline={null} legend /> : <p className={s.note}>Aucune séance à rejouer.</p>}
            </Panel>

            <Panel title="Lecture" sub="ce que le moteur vérifie">
              <p className={s.note}>
                Le rejeu applique journée après journée : mise à jour du plus haut, calcul du plancher, franchissement, limite journalière, consistance et jours minimum. L’objectif est validé le jour où toutes les conditions sont réunies. {plural(planEval.timeline.length, 'journée rejouée', 'journées rejouées')} sur {plural(sessions.length, 'séance')}.
              </p>
            </Panel>
          </>
        ) : (
          <Panel title="Aucun plan sélectionné">
            <p className={s.note}>Choisissez une firme puis un plan pour rejouer votre journal.</p>
          </Panel>
        )}
      </div>
    </div>
  );
}
