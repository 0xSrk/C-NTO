import { useMemo } from 'react';
import { tableClass } from '@/design/primitives';
import { sessionDates } from '@/engine/metrics';
import { findPlan } from '@/engine/propfirm';
import {
  adjustedRiskPoints,
  bernoulliRun,
  betaPosterior,
  dayBlockedMeanCi,
  horizonSigma,
  longestLossStreak,
  rateAfterStreak,
  realizedRewardRisk,
  rrMatrix,
  sigmaBand,
  sigmaDistance,
  tradeRisk,
} from '@/engine/riskConsole';
import type { Session, Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { fmtNum, fmtPct, fmtRatio, fmtUsd, plural, signClass } from '@/lib/format';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './metrique.module.css';

/** Bornes des classes de stop en σ, au séparateur décimal de la langue du desk. */
function bandLabel(band: string): string {
  if (band === '<0.25') return `< ${fmtNum(0.25, 2)} σ`;
  if (band === '0.25-0.5') return `${fmtNum(0.25, 2)}–${fmtNum(0.5, 1)} σ`;
  if (band === '0.5-1') return `${fmtNum(0.5, 1)}–1 σ`;
  return '> 1 σ';
}

/** Lecture du R et des séries, onglet C. Le risque ajusté reste le risque de base tant que les tables et le contexte manquent. */
export function RiskReading({ sessions, trades }: { sessions: Session[]; trades: Trade[] }) {
  useI18n((st) => st.locale);
  const settings = useSettings((st) => st.settings);
  const metricAccount = useUi((st) => st.metricAccount);
  const plan = metricAccount && settings.planAccount === metricAccount ? (findPlan(settings.planId) ?? null) : null;
  const capital = plan?.maxDrawdown && plan.maxDrawdown > 0 ? plan.maxDrawdown : settings.startingBalance;
  const base = adjustedRiskPoints(settings.riskBasePoints);

  const reading = useMemo(() => {
    const days = sessionDates(sessions);
    const rows = trades.map((trade) => ({ trade, risk: tradeRisk(trade, settings.riskPerContract, capital) }));
    const known = rows.filter((row) => row.risk.source !== 'absent');
    const allFixed = known.length > 0 && known.every((row) => row.risk.source === 'fixe');
    const wins = trades.filter((trade) => trade.pnl > 0).length;
    const losses = trades.filter((trade) => trade.pnl < 0).length;
    const decisive = wins + losses;
    const winRate = decisive ? wins / decisive : 0;
    const posterior = betaPosterior(wins, losses);
    // Le point réalisé croise le taux réalisé et le R/R réalisé (gain moyen ÷ |perte moyenne|), jamais le R/R prévu.
    const matrix = rrMatrix(winRate, realizedRewardRisk(trades), [settings.rrShiftUp, -settings.rrShiftDown, -settings.rrShiftFar], posterior.low);
    const byDay = new Map<string, number[]>();
    for (const row of rows) {
      const day = days.get(row.trade.sessionId) ?? row.trade.sessionId;
      const list = byDay.get(day) ?? [];
      list.push(row.trade.pnl);
      byDay.set(day, list);
    }
    const expectancyCi = dayBlockedMeanCi([...byDay.values()]);
    const sideDays = (side: 'within' | 'above') => {
      const map = new Map<string, number[]>();
      for (const row of known) {
        const inside = row.risk.lossPct != null && row.risk.lossPct <= base.points / 100;
        if (side === 'within' ? !inside : inside) continue;
        const day = days.get(row.trade.sessionId) ?? row.trade.sessionId;
        const list = map.get(day) ?? [];
        list.push(row.trade.pnl);
        map.set(day, list);
      }
      return [...map.values()];
    };
    const respect = {
      within: { n: known.filter((row) => row.risk.lossPct != null && row.risk.lossPct <= base.points / 100).length, ci: dayBlockedMeanCi(sideDays('within')) },
      above: { n: known.filter((row) => row.risk.lossPct == null || row.risk.lossPct > base.points / 100).length, ci: dayBlockedMeanCi(sideDays('above')) },
    };
    const pnls = [...trades].sort((a, b) => a.exitTime - b.exitTime).map((trade) => trade.pnl);
    const streaks = [1, 2, 3].map((n) => ({ n, loss: rateAfterStreak(pnls, n, 'loss'), win: rateAfterStreak(pnls, n, 'win') }));
    const sigmaGroups = new Map<string, number[][]>();
    if (settings.impliedVol != null) {
      const byBand = new Map<string, Map<string, number[]>>();
      for (const row of rows) {
        const sigma = horizonSigma(row.trade.entryPrice, settings.impliedVol, 252);
        const distance = sigmaDistance(row.risk.stopPoints, sigma);
        const band = distance == null ? null : sigmaBand(distance);
        if (!band) continue;
        const day = days.get(row.trade.sessionId) ?? row.trade.sessionId;
        const bandDays = byBand.get(band) ?? new Map<string, number[]>();
        const list = bandDays.get(day) ?? [];
        list.push(row.trade.pnl);
        bandDays.set(day, list);
        byBand.set(band, bandDays);
      }
      for (const [band, bandDays] of byBand) sigmaGroups.set(band, [...bandDays.values()]);
    }
    return { known, allFixed, winRate, posterior, matrix, expectancyCi, respect, streaks, decisive, sigmaGroups };
  }, [trades, sessions, settings.riskPerContract, settings.impliedVol, settings.rrShiftUp, settings.rrShiftDown, settings.rrShiftFar, capital, base.points]);

  const lossRun = useMemo(() => (reading.decisive > 0 ? longestLossStreak(reading.decisive, 1 - reading.winRate) : null), [reading.decisive, reading.winRate]);

  return (
    <section className={s.analyseRank}>
      <header className={s.trameHead}>
        <div>
          <h3>{tr('Risque et séries', 'Risk and streaks', 'Riesgo y series')}</h3>
          <p>
            {tr(
              `Capital de risque ${fmtUsd(capital)} · risque de base ${fmtRatio(base.points, 2)} % · tables F20 à F22 non fournies, ajustements non appliqués`,
              `Risk capital ${fmtUsd(capital)} · base risk ${fmtRatio(base.points, 2)} % · F20 to F22 tables not supplied, adjustments not applied`,
              `Capital de riesgo ${fmtUsd(capital)} · riesgo base ${fmtRatio(base.points, 2)} % · tablas F20 a F22 no dadas, ajustes no aplicados`,
            )}
          </p>
        </div>
      </header>
      {reading.allFixed ? (
        <p className={s.note}>{tr('Tous les trades sont en risque fixe : le R n’apporte rien de plus que les dollars.', 'Every trade uses the fixed risk: R adds nothing beyond the dollars.', 'Todos los trades están en riesgo fijo: la R no aporta más que los dólares.')}</p>
      ) : null}
      <p className={s.note}>
        {tr('Espérance', 'Expectancy', 'Esperanza')} {fmtUsd(reading.expectancyCi.center, { sign: true, cents: true })} · {tr('IC 90 %', '90% CI', 'IC 90 %')} {fmtUsd(reading.expectancyCi.low, { sign: true, cents: true })} – {fmtUsd(reading.expectancyCi.high, { sign: true, cents: true })}
      </p>
      <table className={tableClass}>
        <thead>
          <tr>
            <th>{tr('Taux', 'Win rate', 'Tasa')}</th>
            {reading.matrix.rewardRisks.map((rr, index) => (
              <th key={`${rr}-${index}`} className="num">
                {fmtRatio(rr, 2)}
                {index === reading.matrix.realized?.col ? ' R' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reading.matrix.cells.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td>{fmtPct(reading.matrix.winRates[rowIndex] ?? 0, 1)}</td>
              {row.map((cell, colIndex) => (
                <td key={colIndex} className={`num ${signClass(cell)}`}>
                  {fmtRatio(cell, 2)}
                  {rowIndex === reading.matrix.realized?.row && colIndex === reading.matrix.realized.col ? ' ·' : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.note}>
        {tr('Dans la recommandation', 'Within the recommendation', 'Dentro de la recomendación')} {plural(reading.respect.within.n, 'trade')} · {fmtUsd(reading.respect.within.ci.center, { sign: true, cents: true })}
        {' · '}
        {tr('au-dessus', 'above', 'por encima')} {plural(reading.respect.above.n, 'trade')} · {fmtUsd(reading.respect.above.ci.center, { sign: true, cents: true })}
      </p>
      <p className={s.note}>
        Bernoulli 5 {tr('gains', 'wins', 'ganancias')} {fmtRatio(bernoulliRun(reading.winRate, 5), 4)} · 5 {tr('pertes', 'losses', 'pérdidas')} {fmtRatio(bernoulliRun(1 - reading.winRate, 5), 4)}
        {lossRun ? ` · ${tr('série de pertes attendue', 'expected loss streak', 'serie de pérdidas esperada')} ${fmtRatio(lossRun.mean, 1)} · ${tr('95e', '95th', '95.º')} ${lossRun.p95}` : ''}
        {' · '}
        Bayes {fmtPct(reading.posterior.mean, 1)} [{fmtPct(reading.posterior.low, 1)} ; {fmtPct(reading.posterior.high, 1)}]
      </p>
      {reading.streaks.map((row) => (
        <p key={row.n} className={s.note}>
          {tr(`Après ${row.n} perte${row.n > 1 ? 's' : ''}`, `After ${row.n} loss${row.n > 1 ? 'es' : ''}`, `Tras ${row.n} pérdida${row.n > 1 ? 's' : ''}`)}{' '}
          {row.loss.winRate == null ? '—' : fmtPct(row.loss.winRate, 0)} ({row.loss.count}) · {tr('après gain', 'after a win', 'tras ganancia')} {row.win.winRate == null ? '—' : fmtPct(row.win.winRate, 0)} ({row.win.count})
        </p>
      ))}
      {settings.impliedVol == null ? (
        <p className={s.note}>{tr('Volatilité implicite non saisie : pas de distance de stop en σ. Le volCT viendra avec le contexte.', 'Implied volatility is empty: no stop distance in σ. volCT comes with the context.', 'Volatilidad implícita vacía: sin distancia de stop en σ. volCT llega con el contexto.')}</p>
      ) : (
        <p className={s.note}>
          {['<0.25', '0.25-0.5', '0.5-1', '>1'].map((band) => {
            const groups = reading.sigmaGroups.get(band) ?? [];
            const ci = dayBlockedMeanCi(groups);
            return `${bandLabel(band)} ${groups.reduce((sum, day) => sum + day.length, 0)} · ${fmtUsd(ci.center, { cents: true, sign: true })}`;
          }).join(' · ')}
        </p>
      )}
    </section>
  );
}
