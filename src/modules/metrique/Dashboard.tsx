import { useMemo } from 'react';
import { Bars, Histogram } from '@/design/charts/Bars';
import { Heatmap, type HeatCell } from '@/design/charts/Heatmap';
import { LineArea } from '@/design/charts/LineArea';
import { Button, Empty, Panel, Stat, Tag } from '@/design/primitives';
import { histogram } from '@/engine/metrics';
import { tr, useI18n } from '@/i18n';
import { fmtInt, fmtPct, fmtRatio, fmtUsd, plural, signClass } from '@/lib/format';
import { dateKeyLocal, dateTimeFormatter, formatDuration, formatDateFr, parseDateKey } from '@/lib/time';
import s from './metrique.module.css';
import { useStats } from './useStats';

function tone(v: number): 'pos' | 'neg' | 'flat' {
  return signClass(v);
}

/** Étiquette d'un point d'équité (t = midi local de la date agrégée). */
function equityLabel(tMs: number): string {
  return formatDateFr(dateKeyLocal(new Date(tMs)), { short: true });
}

function trPlanStatus(status: 'en-cours' | 'objectif' | 'echec'): string {
  if (status === 'objectif') return tr('objectif', 'passed', 'objetivo');
  if (status === 'echec') return tr('echec', 'failed', 'fallo');
  return tr('en-cours', 'in progress', 'en curso');
}

export function Dashboard({ onImport, onDemo }: { onImport: () => void; onDemo: () => void }) {
  const locale = useI18n((s) => s.locale);
  const { sessions, tradeStats: t, dailyStats: d, plan, planEval, startingBalance } = useStats();

  // L'équité journalière est agrégée par date (plusieurs comptes = une journée) : le point de
  // départ est le capital initial et chaque étiquette dérive de la date du point lui-même,
  // jamais de l'index des séances brutes.
  const cumSeries = useMemo(
    () => [
      {
        id: 'cum',
        label: tr('PnL cumulé', 'Cumulative PnL', 'PnL acumulado'),
        color: 'var(--mint)',
        area: true,
        signed: true,
        points: d.equity.map((p) => ({ x: p.t, y: p.equity - startingBalance, label: equityLabel(p.t) })),
      },
    ],
    [d.equity, startingBalance, locale],
  );
  const ddSeries = useMemo(() => [{ id: 'dd', label: 'Drawdown', color: 'var(--ember)', area: true, points: d.equity.map((p) => ({ x: p.t, y: p.drawdown, label: equityLabel(p.t) })) }], [d.equity, locale]);
  const rollingSeries = useMemo(
    () => [
      { id: 'wr', label: tr('Taux de réussite (20 séances)', 'Win rate (20 sessions)', 'Tasa de acierto (20 sesiones)'), color: 'var(--ice)', points: d.rolling.map((r) => ({ x: r.t, y: r.winRate * 100, label: formatDateFr(r.date, { short: true }) })) },
    ],
    [d.rolling, locale],
  );
  const rollingExp = useMemo(
    () => [{ id: 'exp', label: tr('Espérance / séance (20)', 'Expectancy / session (20)', 'Esperanza / sesión (20)'), color: 'var(--gold)', area: true, signed: true, points: d.rolling.map((r) => ({ x: r.t, y: r.expectancy, label: formatDateFr(r.date, { short: true }) })) }],
    [d.rolling, locale],
  );

  const year = useMemo(() => {
    if (sessions.length === 0) return null;
    const last = sessions[sessions.length - 1]?.date;
    if (!last) return null;
    const end = parseDateKey(last);
    const start = new Date(end);
    start.setDate(start.getDate() - 7 * 51 - end.getDay());
    const firstSess = sessions[0];
    if (!firstSess) return null;
    const first = parseDateKey(firstSess.date);
    if (first > start) start.setTime(first.getTime());
    const byDate = new Map(sessions.map((sess) => [sess.date, sess]));
    const cells: HeatCell[] = [];
    const cols: string[] = [];
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    let col = 0;
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const dow = (cursor.getDay() + 6) % 7;
      if (dow === 0) cols.push(cursor.getDate() <= 7 ? dateTimeFormatter({ month: 'short' }).format(cursor) : '');
      if (dow < 5) {
        const sess = byDate.get(key);
        cells.push({
          row: dow,
          col,
          value: sess ? sess.pnl : null,
          label: formatDateFr(key, { weekday: true, short: true }),
          hint: sess ? `${sess.tradeCount} trade(s)` : tr('pas de séance', 'no session', 'sin sesión'),
        });
      }
      if (dow === 6) col++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return {
      cells,
      cols: cols.length ? cols : [''],
      rows: [tr('lun', 'Mon', 'lun'), tr('mar', 'Tue', 'mar'), tr('mer', 'Wed', 'mié'), tr('jeu', 'Thu', 'jue'), tr('ven', 'Fri', 'vie')],
    };
  }, [sessions, locale]);

  const hourBars = useMemo(
    () =>
      t.byHour
        .filter((b) => b.count > 0)
        .map((b) => ({
          key: b.key,
          value: b.pnl,
          label: `${b.key}h`,
          hint: `${b.count} trade(s) · ${fmtPct(b.winRate, 0)} ${tr('réussite', 'win rate', 'acierto')}`,
        })),
    [t.byHour, locale],
  );
  const weekdayBars = useMemo(
    () =>
      [1, 2, 3, 4, 5]
        .map((i) => t.byWeekday[i])
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => ({
          key: b.key,
          value: b.pnl,
          label: b.key,
          hint: `${b.count} trade(s) · ${fmtPct(b.winRate, 0)} ${tr('réussite', 'win rate', 'acierto')}`,
        })),
    [t.byWeekday, locale],
  );
  const hist = useMemo(() => histogram(t.pnls, 28), [t.pnls]);
  const thinSample = t.count < 30 || sessions.length < 5;
  const sqnHint = thinSample
    ? tr('Échantillon insuffisant', 'Insufficient sample', 'Muestra insuficiente')
    : t.sqn >= 2.5
      ? tr('Système solide', 'Solid system', 'Sistema sólido')
      : t.sqn >= 1.6
        ? tr('Correct', 'Fair', 'Correcto')
        : tr('Faible', 'Weak', 'Débil');
  const pfHint = thinSample
    ? `${tr('Échantillon insuffisant', 'Insufficient sample', 'Muestra insuficiente')}${Number.isFinite(t.profitFactor) ? '' : ` · ${tr('brut', 'raw', 'bruto')} ${t.profitFactor === Infinity ? '∞' : String(t.profitFactor)}`}`
    : `${tr('Payoff', 'Payoff', 'Payoff')} ${fmtRatio(t.payoffRatio)}${Number.isFinite(t.profitFactor) ? '' : ` · ${tr('aucune perte', 'no losses', 'sin pérdidas')}`}`;

  if (sessions.length === 0) {
    return (
      <Empty
        title={tr('Le journal est vide', 'The journal is empty', 'El diario está vacío')}
        text={tr(
          'Importez un export « Trade Performance › Trades » de NinjaTrader 8, saisissez une séance manuelle, ou chargez le jeu de démonstration pour découvrir le moteur.',
          'Import a NinjaTrader 8 “Trade Performance › Trades” export, enter a manual session, or load the demo dataset to explore the engine.',
          'Importe una exportación « Trade Performance › Trades » de NinjaTrader 8, introduzca una sesión manual o cargue el juego de demostración para descubrir el motor.',
        )}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="gold" onClick={onImport}>
              {tr('Importer NinjaTrader', 'Import NinjaTrader', 'Importar NinjaTrader')}
            </Button>
            <Button onClick={onDemo}>{tr('Jeu de démonstration', 'Demo dataset', 'Juego de demostración')}</Button>
          </div>
        }
      />
    );
  }

  return (
    <div className={s.rows}>
      <div className={s.kpis}>
        <Stat
          label={tr('PnL net', 'Net PnL', 'PnL neto')}
          value={fmtUsd(t.netPnl, { sign: true })}
          num={t.netPnl}
          format={(v) => fmtUsd(v, { sign: true })}
          hint={`${plural(t.count, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades'))} · ${plural(sessions.length, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))}`}
          tone={tone(t.netPnl)}
        />
        <Stat
          label={tr('Réussite', 'Win rate', 'Acierto')}
          value={fmtPct(t.winRate)}
          num={t.winRate}
          format={(v) => fmtPct(v)}
          hint={`${t.wins} ${tr('G', 'W', 'G')} · ${t.losses} ${tr('P', 'L', 'P')} · ${t.breakeven} ${tr('N', 'BE', 'N')}`}
          tone={t.winRate >= 0.5 ? 'pos' : 'flat'}
        />
        <Stat label="Profit factor" value={fmtRatio(t.profitFactor)} num={Number.isFinite(t.profitFactor) ? t.profitFactor : undefined} format={(v) => fmtRatio(v)} hint={pfHint} tone={thinSample ? 'flat' : t.profitFactor >= 1.3 ? 'pos' : t.profitFactor < 1 ? 'neg' : 'flat'} />
        <Stat
          label={tr('Espérance / trade', 'Expectancy / trade', 'Esperanza / trade')}
          value={fmtUsd(t.expectancy, { cents: true, sign: true })}
          num={t.expectancy}
          format={(v) => fmtUsd(v, { cents: true, sign: true })}
          hint={t.expectancyR !== null ? `${fmtRatio(t.expectancyR)} R` : `${tr('Médiane', 'Median', 'Mediana')} ${fmtUsd(t.medianPnl, { cents: true })}`}
          tone={tone(t.expectancy)}
        />
        <Stat
          label={tr('Sharpe · séances', 'Sharpe · sessions', 'Sharpe · sesiones')}
          value={fmtRatio(d.sharpe)}
          num={d.sharpe}
          format={(v) => fmtRatio(v)}
          hint={
            thinSample
              ? tr('Échantillon insuffisant', 'Insufficient sample', 'Muestra insuficiente')
              : `Sortino ${fmtRatio(d.sortino)} · Calmar ${fmtRatio(d.calmar)} (${tr('rendement linéaire annualisé / DD', 'linear annualized return / DD', 'rendimiento lineal anualizado / DD')})`
          }
          tone={thinSample ? 'flat' : d.sharpe >= 1 ? 'pos' : d.sharpe < 0 ? 'neg' : 'flat'}
        />
        <Stat
          label={tr('Drawdown max', 'Max drawdown', 'Drawdown máx.')}
          value={fmtUsd(-d.maxDrawdown)}
          num={-d.maxDrawdown}
          format={(v) => fmtUsd(v)}
          hint={`${plural(d.maxDrawdownDays, tr('journée', 'day', 'día'), tr('journées', 'days', 'días'))} · ${tr('actuel', 'current', 'actual')} ${fmtUsd(-d.currentDrawdown)}`}
          tone={d.currentDrawdown > 0 ? 'neg' : 'flat'}
        />
        <Stat label="SQN" value={fmtRatio(t.sqn)} num={thinSample ? undefined : t.sqn} format={(v) => fmtRatio(v)} hint={sqnHint} tone={thinSample ? 'flat' : t.sqn >= 2 ? 'pos' : 'flat'} />
        <Stat
          label={tr('Séances gagnantes', 'Winning sessions', 'Sesiones ganadoras')}
          value={fmtPct(d.winDayRate)}
          num={d.winDayRate}
          format={(v) => fmtPct(v)}
          hint={`${d.winDays} ${tr('G', 'W', 'G')} · ${d.lossDays} ${tr('P', 'L', 'P')} · ${tr('meilleur', 'best', 'mejor')} ${fmtUsd(d.bestDay)}`}
          tone={d.winDayRate >= 0.5 ? 'pos' : 'flat'}
        />
      </div>

      <div className={s.grid}>
        <Panel
          className={s.c8}
          title={tr("Courbe d'équité", 'Equity curve', 'Curva de equity')}
          sub={tr('PnL cumulé par séance', 'Cumulative PnL per session', 'PnL acumulado por sesión')}
          actions={plan && planEval ? <Tag tone={planEval.status === 'objectif' ? 'mint' : planEval.status === 'echec' ? 'ember' : 'gold'} dot>{plan.firm} · {plan.label} · {trPlanStatus(planEval.status)}</Tag> : undefined}
        >
          <LineArea series={cumSeries} height={240} formatY={(v) => fmtUsd(v)} endValue />
        </Panel>
        <Panel className={s.c4} title="Drawdown" sub={tr('depuis le plus haut', 'from the peak', 'desde el máximo')}>
          <LineArea series={ddSeries} height={240} formatY={(v) => fmtUsd(v)} />
        </Panel>

        <Panel className={s.c12} title={tr('Année glissante', 'Rolling year', 'Año móvil')} sub={tr('PnL par journée de trading', 'PnL per trading day', 'PnL por jornada de trading')}>
          {year && <Heatmap rows={year.rows} cols={year.cols} cells={year.cells} height={200} formatValue={(v) => fmtUsd(v)} />}
        </Panel>

        <Panel className={s.c6} title={tr('Régularité', 'Consistency', 'Regularidad')} sub={tr('fenêtre glissante de 20 séances', '20-session rolling window', 'ventana móvil de 20 sesiones')}>
          <LineArea series={rollingSeries} height={170} formatY={(v) => `${v.toFixed(0)} %`} baseline={50} yDomain={[0, 100]} />
        </Panel>
        <Panel className={s.c6} title={tr('Espérance glissante', 'Rolling expectancy', 'Esperanza móvil')} sub={tr('PnL moyen par séance · 20 séances', 'Average PnL per session · 20 sessions', 'PnL medio por sesión · 20 sesiones')}>
          <LineArea series={rollingExp} height={170} formatY={(v) => fmtUsd(v)} />
        </Panel>

        <Panel className={s.c4} title={tr('Distribution des trades', 'Trade distribution', 'Distribución de trades')} sub={tr('PnL par trade', 'PnL per trade', 'PnL por trade')}>
          <Histogram bins={hist} height={170} formatX={(v) => fmtUsd(v)} />
        </Panel>
        <Panel className={s.c4} title={tr("Par heure d'entrée", 'By entry hour', 'Por hora de entrada')} sub={tr('heure ET', 'ET hour', 'hora ET')}>
          <Bars data={hourBars} height={170} formatY={(v) => fmtUsd(v)} />
        </Panel>
        <Panel className={s.c4} title={tr('Par jour de semaine', 'By weekday', 'Por día de la semana')} sub={tr('PnL agrégé', 'Aggregated PnL', 'PnL agregado')}>
          <Bars data={weekdayBars} height={170} formatY={(v) => fmtUsd(v)} />
        </Panel>

        <Panel className={s.c4} title="Long / Short" sub={tr('asymétrie directionnelle', 'directional asymmetry', 'asimetría direccional')}>
          <dl className={s.kv}>
            <dt>{tr('Long · trades', 'Long · trades', 'Long · trades')}</dt>
            <dd>{fmtInt(t.long.count)}</dd>
            <dt>{tr('Long · PnL', 'Long · PnL', 'Long · PnL')}</dt>
            <dd className={signClass(t.long.pnl)}>{fmtUsd(t.long.pnl, { sign: true })}</dd>
            <dt>{tr('Long · réussite', 'Long · win rate', 'Long · acierto')}</dt>
            <dd>{fmtPct(t.long.winRate)}</dd>
            <dt>{tr('Short · trades', 'Short · trades', 'Short · trades')}</dt>
            <dd>{fmtInt(t.short.count)}</dd>
            <dt>{tr('Short · PnL', 'Short · PnL', 'Short · PnL')}</dt>
            <dd className={signClass(t.short.pnl)}>{fmtUsd(t.short.pnl, { sign: true })}</dd>
            <dt>{tr('Short · réussite', 'Short · win rate', 'Short · acierto')}</dt>
            <dd>{fmtPct(t.short.winRate)}</dd>
          </dl>
        </Panel>
        <Panel className={s.c4} title={tr('Séries & dépendance', 'Streaks & dependence', 'Series y dependencia')} sub={tr('z-score des séquences', 'sequence z-score', 'z-score de las secuencias')}>
          <dl className={s.kv}>
            <dt>{tr('Gains consécutifs max', 'Max consecutive wins', 'Ganancias consecutivas máx.')}</dt>
            <dd>{t.maxConsecWins}</dd>
            <dt>{tr('Pertes consécutives max', 'Max consecutive losses', 'Pérdidas consecutivas máx.')}</dt>
            <dd>{t.maxConsecLosses}</dd>
            <dt>{tr('Série actuelle', 'Current streak', 'Serie actual')}</dt>
            <dd className={signClass(t.currentStreak)}>{t.currentStreak > 0 ? `+${t.currentStreak}` : t.currentStreak}</dd>
            <dt>Z-score</dt>
            <dd className={Math.abs(t.zScore) > 1.96 ? 'gold' : ''}>{fmtRatio(t.zScore)}</dd>
            <dt>Kelly</dt>
            <dd>{fmtPct(t.kelly)}</dd>
            <dt>{tr('Plus gros gain / perte', 'Largest win / loss', 'Mayor ganancia / pérdida')}</dt>
            <dd>
              <span className="pos">{fmtUsd(t.largestWin)}</span> / <span className="neg">{fmtUsd(t.largestLoss)}</span>
            </dd>
          </dl>
          <p className={s.note} style={{ marginTop: 10 }}>
            {Math.abs(t.zScore) > 1.96 ? (
              <>
                <b>{tr('Dépendance significative', 'Significant dependence', 'Dependencia significativa')}</b>
                {' : '}
                {t.zScore > 0
                  ? tr(
                      'les gains et pertes alternent plus que le hasard — la taille peut être modulée après une perte.',
                      'wins and losses alternate more than chance — size can be adjusted after a loss.',
                      'las ganancias y pérdidas alternan más que el azar — el tamaño puede modularse tras una pérdida.',
                    )
                  : tr(
                      'les résultats se regroupent en séries — réduire la taille après une perte, la remonter après un gain.',
                      'results cluster in streaks — reduce size after a loss, increase it after a win.',
                      'los resultados se agrupan en series — reducir el tamaño tras una pérdida, subirlo tras una ganancia.',
                    )}
              </>
            ) : (
              <>
                <b>{tr('Séquences compatibles avec le hasard', 'Sequences consistent with chance', 'Secuencias compatibles con el azar')}</b>
                {' : '}
                {tr(
                  'aucun ajustement de taille fondé sur la série précédente n’est justifié.',
                  'no size adjustment based on the previous streak is justified.',
                  'ningún ajuste de tamaño basado en la serie anterior está justificado.',
                )}
              </>
            )}
          </p>
        </Panel>
        <Panel className={s.c4} title={tr('Exécution', 'Execution', 'Ejecución')} sub={tr('durée · excursions', 'duration · excursions', 'duración · excursions')}>
          <dl className={s.kv}>
            <dt>{tr('Durée moyenne', 'Average duration', 'Duración media')}</dt>
            <dd>{formatDuration(t.avgDurationMs)}</dd>
            <dt>{tr('Durée · gagnants', 'Duration · winners', 'Duración · ganadores')}</dt>
            <dd className="pos">{formatDuration(t.avgWinDurationMs)}</dd>
            <dt>{tr('Durée · perdants', 'Duration · losers', 'Duración · perdedores')}</dt>
            <dd className="neg">{formatDuration(t.avgLossDurationMs)}</dd>
            <dt>{tr('MAE moyenne', 'Average MAE', 'MAE media')}</dt>
            <dd>{t.avgMae !== null ? fmtUsd(-t.avgMae) : '—'}</dd>
            <dt>{tr('MFE moyenne', 'Average MFE', 'MFE media')}</dt>
            <dd>{t.avgMfe !== null ? fmtUsd(t.avgMfe) : '—'}</dd>
            <dt>Edge ratio (MFE/MAE)</dt>
            <dd className={t.edgeRatio !== null && t.edgeRatio > 1 ? 'pos' : ''}>{fmtRatio(t.edgeRatio)}</dd>
            <dt>{tr('Capture de la MFE', 'MFE capture', 'Captura de la MFE')}</dt>
            <dd>{t.captureRatio !== null ? fmtPct(t.captureRatio) : '—'}</dd>
            <dt>{tr('Commissions', 'Commissions', 'Comisiones')}</dt>
            <dd>{fmtUsd(-t.commission)}</dd>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
