import { useMemo } from 'react';
import { LineArea } from '@/design/charts/LineArea';
import { Panel, Progress, Stat, Tag, cx } from '@/design/primitives';
import { DRAWDOWN_LABEL, PROP_FIRMS } from '@/engine/propfirm';
import { fmtInt, fmtPct, fmtUsd } from '@/lib/format';
import { formatDateFr } from '@/lib/time';
import { useSettings } from '@/store/settings';
import s from './metrique.module.css';
import { useStats } from './useStats';

export function PropFirmView() {
  const { plan, planEval, sessions } = useStats();
  const planId = useSettings((st) => st.settings.planId);
  const update = useSettings((st) => st.update);

  const timelineSeries = useMemo(() => {
    if (!planEval || !plan) return [];
    return [
      { id: 'balance', label: 'Solde', color: 'var(--ice)', area: true, points: planEval.timeline.map((p) => ({ x: new Date(`${p.date}T12:00:00`).getTime(), y: p.balance, label: formatDateFr(p.date, { short: true }) })) },
      { id: 'floor', label: 'Plancher', color: 'var(--ember)', dashed: true, points: planEval.timeline.map((p) => ({ x: new Date(`${p.date}T12:00:00`).getTime(), y: p.floor, label: formatDateFr(p.date, { short: true }) })) },
      { id: 'target', label: 'Objectif', color: 'var(--gold)', dashed: true, points: planEval.timeline.map((p) => ({ x: new Date(`${p.date}T12:00:00`).getTime(), y: plan.accountSize + plan.profitTarget, label: formatDateFr(p.date, { short: true }) })) },
    ];
  }, [planEval, plan]);

  return (
    <div className={s.grid}>
      <Panel className={s.c4} title="Registre" sub="firmes & plans indicatifs">
        <div className={s.planList}>
          {PROP_FIRMS.map((f) => (
            <div key={f.id} className={s.planCard}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b style={{ color: 'var(--text-0)', fontSize: 12 }}>{f.name}</b>
                <span className="micro">{f.platform.join(' · ')}</span>
              </div>
              {f.plans.map((p) => (
                <button key={p.id} className={cx(s.planItem, p.id === planId && s.on)} onClick={() => update({ planId: p.id, startingBalance: p.accountSize })}>
                  <span>{p.label}</span>
                  <span className="mono">{fmtUsd(p.profitTarget)}</span>
                  <small>{DRAWDOWN_LABEL[p.drawdownType]}</small>
                  <small>DD {fmtUsd(p.maxDrawdown)}</small>
                </button>
              ))}
            </div>
          ))}
        </div>
        <p className={s.note} style={{ marginTop: 12 }}>
          <b>Registre indicatif.</b> Les règles des firmes changent fréquemment : validez chaque paramètre sur le site de la firme avant de vous y fier. Le plan sélectionné pilote le rejeu ci-contre et le Monte Carlo.
        </p>
      </Panel>

      <div className={cx(s.c8, s.rows)}>
        {plan && planEval ? (
          <>
            <div className={cx(s.statusBanner, s[planEval.status])}>
              <div>
                <h4>
                  {plan.firm} · {plan.label} — {planEval.status === 'objectif' ? 'Objectif atteint' : planEval.status === 'echec' ? 'Compte invalidé' : 'Évaluation en cours'}
                </h4>
                <p>
                  {planEval.status === 'echec' && planEval.reason ? `${planEval.reason} le ${formatDateFr(planEval.failedOn ?? '')}.` : `${DRAWDOWN_LABEL[plan.drawdownType]} · DD max ${fmtUsd(plan.maxDrawdown)}${plan.dailyLossLimit ? ` · perte/jour ${fmtUsd(plan.dailyLossLimit)}` : ''}${plan.consistencyPct ? ` · consistance ${fmtPct(plan.consistencyPct, 0)}` : ''}${plan.minTradingDays ? ` · ${plan.minTradingDays} jour(s) min` : ''}`}
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
              <Stat small label="Jours tradés" value={fmtInt(planEval.daysTraded)} hint={plan.minTradingDays ? `min ${plan.minTradingDays}` : 'pas de minimum'} />
              <Stat small label="Consistance" value={planEval.consistency.limit ? fmtPct(planEval.consistency.share, 0) : '—'} hint={planEval.consistency.limit ? `limite ${fmtPct(planEval.consistency.limit, 0)} · meilleur jour ${fmtUsd(planEval.consistency.bestDay)}` : 'aucune règle'} tone={planEval.consistency.ok ? 'pos' : 'neg'} />
            </div>

            <Panel title="Rejeu du compte" sub="solde · plancher · objectif" actions={planEval.dailyLossBreaches.length ? <Tag tone="ember">{planEval.dailyLossBreaches.length} dépassement(s) perte/jour</Tag> : undefined}>
              {timelineSeries[0]?.points.length ? <LineArea series={timelineSeries} height={260} formatY={(v) => fmtUsd(v)} baseline={null} legend /> : <p className={s.note}>Aucune séance à rejouer.</p>}
            </Panel>

            <Panel title="Lecture" sub="ce que le moteur vérifie">
              <p className={s.note}>
                Le rejeu applique séance après séance : mise à jour du plus haut (fin de journée ou pic intrajournalier reconstruit via la MFE selon le type de trailing), calcul du plancher (avec verrou le cas échéant), détection d’un franchissement du plancher par la clôture ou l’excursion adverse (MAE), limite de perte journalière, règle de consistance (part du meilleur jour dans le profit total) et nombre minimum de jours tradés. {sessions.length} séance(s) rejouée(s).
              </p>
            </Panel>
          </>
        ) : (
          <Panel title="Aucun plan sélectionné">
            <p className={s.note}>Choisissez un plan dans le registre pour rejouer votre journal contre ses règles.</p>
          </Panel>
        )}
      </div>
    </div>
  );
}
