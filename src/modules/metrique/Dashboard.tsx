import { useMemo } from 'react';
import { Bars } from '@/design/charts/Bars';
import { Histogram } from '@/design/charts/Bars';
import { Heatmap, type HeatCell } from '@/design/charts/Heatmap';
import { LineArea } from '@/design/charts/LineArea';
import { Button, Empty, Panel, Stat, Tag } from '@/design/primitives';
import { histogram } from '@/engine/metrics';
import { fmtInt, fmtPct, fmtRatio, fmtUsd, plural, signClass } from '@/lib/format';
import { formatDuration, formatDateFr, parseDateKey } from '@/lib/time';
import s from './metrique.module.css';
import { useStats } from './useStats';

function tone(v: number): 'pos' | 'neg' | 'flat' {
  return signClass(v);
}

export function Dashboard({ onImport, onDemo }: { onImport: () => void; onDemo: () => void }) {
  const { sessions, tradeStats: t, dailyStats: d, plan, planEval } = useStats();

  const startEq = d.equity[0] ? d.equity[0].equity - (sessions[0]?.pnl ?? 0) : 0;
  const cumSeries = useMemo(
    () => [
      {
        id: 'cum',
        label: 'PnL cumulé',
        color: 'var(--mint)',
        area: true,
        signed: true,
        points: d.equity.map((p, i) => ({ x: p.t, y: p.equity - startEq, label: formatDateFr(sessions[i]?.date ?? '', { short: true }) })),
      },
    ],
    [d.equity, sessions, startEq],
  );
  const ddSeries = useMemo(() => [{ id: 'dd', label: 'Drawdown', color: 'var(--ember)', area: true, points: d.equity.map((p, i) => ({ x: p.t, y: p.drawdown, label: formatDateFr(sessions[i]?.date ?? '', { short: true }) })) }], [d.equity, sessions]);
  const rollingSeries = useMemo(
    () => [
      { id: 'wr', label: 'Taux de réussite (20 séances)', color: 'var(--ice)', points: d.rolling.map((r) => ({ x: r.t, y: r.winRate * 100, label: formatDateFr(r.date, { short: true }) })) },
    ],
    [d.rolling],
  );
  const rollingExp = useMemo(() => [{ id: 'exp', label: 'Espérance / séance (20)', color: 'var(--gold)', area: true, signed: true, points: d.rolling.map((r) => ({ x: r.t, y: r.expectancy, label: formatDateFr(r.date, { short: true }) })) }], [d.rolling]);

  const year = useMemo(() => {
    if (sessions.length === 0) return null;
    const last = sessions[sessions.length - 1].date;
    const end = parseDateKey(last);
    const start = new Date(end);
    start.setDate(start.getDate() - 7 * 51 - end.getDay());
    const first = parseDateKey(sessions[0].date);
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
      if (dow === 0) cols.push(cursor.getDate() <= 7 ? cursor.toLocaleDateString('fr-FR', { month: 'short' }) : '');
      if (dow < 5) {
        const sess = byDate.get(key);
        cells.push({ row: dow, col, value: sess ? sess.pnl : null, label: formatDateFr(key, { weekday: true, short: true }), hint: sess ? `${sess.tradeCount} trade(s)` : 'pas de séance' });
      }
      if (dow === 6) col++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return { cells, cols: cols.length ? cols : [''], rows: ['lun', 'mar', 'mer', 'jeu', 'ven'] };
  }, [sessions]);

  const hourBars = useMemo(() => t.byHour.filter((b) => b.count > 0).map((b) => ({ key: b.key, value: b.pnl, label: `${b.key}h`, hint: `${b.count} trade(s) · ${fmtPct(b.winRate, 0)} réussite` })), [t.byHour]);
  const weekdayBars = useMemo(() => [1, 2, 3, 4, 5].map((i) => t.byWeekday[i]).map((b) => ({ key: b.key, value: b.pnl, label: b.key, hint: `${b.count} trade(s) · ${fmtPct(b.winRate, 0)} réussite` })), [t.byWeekday]);
  const hist = useMemo(() => histogram(t.pnls, 28), [t.pnls]);
  const thinSample = t.count < 30 || sessions.length < 5;
  const sqnHint = thinSample ? 'Échantillon insuffisant' : t.sqn >= 2.5 ? 'Système solide' : t.sqn >= 1.6 ? 'Correct' : 'Faible';
  const pfHint = thinSample
    ? `Échantillon insuffisant${Number.isFinite(t.profitFactor) ? '' : ` · brut ${t.profitFactor === Infinity ? '∞' : String(t.profitFactor)}`}`
    : `Payoff ${fmtRatio(t.payoffRatio)}${Number.isFinite(t.profitFactor) ? '' : ' · aucune perte'}`;

  if (sessions.length === 0) {
    return (
      <Empty
        title="Le journal est vide"
        text="Importez un export « Trade Performance › Trades » de NinjaTrader 8, saisissez une séance manuelle, ou chargez le jeu de démonstration pour découvrir le moteur."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="gold" onClick={onImport}>
              Importer NinjaTrader
            </Button>
            <Button onClick={onDemo}>Jeu de démonstration</Button>
          </div>
        }
      />
    );
  }

  return (
    <div className={s.rows}>
      <div className={s.kpis}>
        <Stat label="PnL net" value={fmtUsd(t.netPnl, { sign: true })} num={t.netPnl} format={(v) => fmtUsd(v, { sign: true })} hint={`${plural(t.count, 'trade')} · ${plural(sessions.length, 'séance')}`} tone={tone(t.netPnl)} />
        <Stat label="Réussite" value={fmtPct(t.winRate)} num={t.winRate} format={(v) => fmtPct(v)} hint={`${t.wins} G · ${t.losses} P · ${t.breakeven} N`} tone={t.winRate >= 0.5 ? 'pos' : 'flat'} />
        <Stat label="Profit factor" value={fmtRatio(t.profitFactor)} num={Number.isFinite(t.profitFactor) ? t.profitFactor : undefined} format={(v) => fmtRatio(v)} hint={pfHint} tone={thinSample ? 'flat' : t.profitFactor >= 1.3 ? 'pos' : t.profitFactor < 1 ? 'neg' : 'flat'} />
        <Stat label="Espérance / trade" value={fmtUsd(t.expectancy, { cents: true, sign: true })} num={t.expectancy} format={(v) => fmtUsd(v, { cents: true, sign: true })} hint={t.expectancyR !== null ? `${fmtRatio(t.expectancyR)} R` : `Médiane ${fmtUsd(t.medianPnl, { cents: true })}`} tone={tone(t.expectancy)} />
        <Stat label="Sharpe · séances" value={fmtRatio(d.sharpe)} num={d.sharpe} format={(v) => fmtRatio(v)} hint={thinSample ? 'Échantillon insuffisant' : `Sortino ${fmtRatio(d.sortino)} · Calmar ${fmtRatio(d.calmar)}`} tone={thinSample ? 'flat' : d.sharpe >= 1 ? 'pos' : d.sharpe < 0 ? 'neg' : 'flat'} />
        <Stat label="Drawdown max" value={fmtUsd(-d.maxDrawdown)} num={-d.maxDrawdown} format={(v) => fmtUsd(v)} hint={`${plural(d.maxDrawdownDays, 'journée')} · actuel ${fmtUsd(-d.currentDrawdown)}`} tone={d.currentDrawdown > 0 ? 'neg' : 'flat'} />
        <Stat label="SQN" value={fmtRatio(t.sqn)} num={thinSample ? undefined : t.sqn} format={(v) => fmtRatio(v)} hint={sqnHint} tone={thinSample ? 'flat' : t.sqn >= 2 ? 'pos' : 'flat'} />
        <Stat label="Séances gagnantes" value={fmtPct(d.winDayRate)} num={d.winDayRate} format={(v) => fmtPct(v)} hint={`${d.winDays} G · ${d.lossDays} P · meilleur ${fmtUsd(d.bestDay)}`} tone={d.winDayRate >= 0.5 ? 'pos' : 'flat'} />
      </div>

      <div className={s.grid}>
        <Panel className={s.c8} title="Courbe d'équité" sub="PnL cumulé par séance" actions={plan && planEval ? <Tag tone={planEval.status === 'objectif' ? 'mint' : planEval.status === 'echec' ? 'ember' : 'gold'} dot>{plan.firm} · {plan.label} · {planEval.status}</Tag> : undefined}>
          <LineArea series={cumSeries} height={240} formatY={(v) => fmtUsd(v)} endValue />
        </Panel>
        <Panel className={s.c4} title="Drawdown" sub="depuis le plus haut">
          <LineArea series={ddSeries} height={240} formatY={(v) => fmtUsd(v)} />
        </Panel>

        <Panel className={s.c12} title="Année glissante" sub="PnL par journée de trading">
          {year && <Heatmap rows={year.rows} cols={year.cols} cells={year.cells} height={120} formatValue={(v) => fmtUsd(v)} />}
        </Panel>

        <Panel className={s.c6} title="Régularité" sub="fenêtre glissante de 20 séances">
          <LineArea series={rollingSeries} height={170} formatY={(v) => `${v.toFixed(0)} %`} baseline={50} yDomain={[0, 100]} />
        </Panel>
        <Panel className={s.c6} title="Espérance glissante" sub="PnL moyen par séance · 20 séances">
          <LineArea series={rollingExp} height={170} formatY={(v) => fmtUsd(v)} />
        </Panel>

        <Panel className={s.c4} title="Distribution des trades" sub="PnL par trade">
          <Histogram bins={hist} height={170} formatX={(v) => fmtUsd(v)} />
        </Panel>
        <Panel className={s.c4} title="Par heure d'entrée" sub="heure locale">
          <Bars data={hourBars} height={170} formatY={(v) => fmtUsd(v)} />
        </Panel>
        <Panel className={s.c4} title="Par jour de semaine" sub="PnL agrégé">
          <Bars data={weekdayBars} height={170} formatY={(v) => fmtUsd(v)} />
        </Panel>

        <Panel className={s.c4} title="Long / Short" sub="asymétrie directionnelle">
          <dl className={s.kv}>
            <dt>Long · trades</dt>
            <dd>{fmtInt(t.long.count)}</dd>
            <dt>Long · PnL</dt>
            <dd className={signClass(t.long.pnl)}>{fmtUsd(t.long.pnl, { sign: true })}</dd>
            <dt>Long · réussite</dt>
            <dd>{fmtPct(t.long.winRate)}</dd>
            <dt>Short · trades</dt>
            <dd>{fmtInt(t.short.count)}</dd>
            <dt>Short · PnL</dt>
            <dd className={signClass(t.short.pnl)}>{fmtUsd(t.short.pnl, { sign: true })}</dd>
            <dt>Short · réussite</dt>
            <dd>{fmtPct(t.short.winRate)}</dd>
          </dl>
        </Panel>
        <Panel className={s.c4} title="Séries & dépendance" sub="z-score des séquences">
          <dl className={s.kv}>
            <dt>Gains consécutifs max</dt>
            <dd>{t.maxConsecWins}</dd>
            <dt>Pertes consécutives max</dt>
            <dd>{t.maxConsecLosses}</dd>
            <dt>Série actuelle</dt>
            <dd className={signClass(t.currentStreak)}>{t.currentStreak > 0 ? `+${t.currentStreak}` : t.currentStreak}</dd>
            <dt>Z-score</dt>
            <dd className={Math.abs(t.zScore) > 1.96 ? 'gold' : ''}>{fmtRatio(t.zScore)}</dd>
            <dt>Kelly</dt>
            <dd>{fmtPct(t.kelly)}</dd>
            <dt>Plus gros gain / perte</dt>
            <dd>
              <span className="pos">{fmtUsd(t.largestWin)}</span> / <span className="neg">{fmtUsd(t.largestLoss)}</span>
            </dd>
          </dl>
          <p className={s.note} style={{ marginTop: 10 }}>
            {Math.abs(t.zScore) > 1.96 ? (
              <>
                <b>Dépendance significative</b> : {t.zScore > 0 ? 'les gains et pertes alternent plus que le hasard — la taille peut être modulée après une perte.' : 'les résultats se regroupent en séries — réduire la taille après une perte, la remonter après un gain.'}
              </>
            ) : (
              <>
                <b>Séquences compatibles avec le hasard</b> : aucun ajustement de taille fondé sur la série précédente n’est justifié.
              </>
            )}
          </p>
        </Panel>
        <Panel className={s.c4} title="Exécution" sub="durée · excursions">
          <dl className={s.kv}>
            <dt>Durée moyenne</dt>
            <dd>{formatDuration(t.avgDurationMs)}</dd>
            <dt>Durée · gagnants</dt>
            <dd className="pos">{formatDuration(t.avgWinDurationMs)}</dd>
            <dt>Durée · perdants</dt>
            <dd className="neg">{formatDuration(t.avgLossDurationMs)}</dd>
            <dt>MAE moyenne</dt>
            <dd>{t.avgMae !== null ? fmtUsd(-t.avgMae) : '—'}</dd>
            <dt>MFE moyenne</dt>
            <dd>{t.avgMfe !== null ? fmtUsd(t.avgMfe) : '—'}</dd>
            <dt>Edge ratio (MFE/MAE)</dt>
            <dd className={t.edgeRatio !== null && t.edgeRatio > 1 ? 'pos' : ''}>{fmtRatio(t.edgeRatio)}</dd>
            <dt>Capture de la MFE</dt>
            <dd>{t.captureRatio !== null ? fmtPct(t.captureRatio) : '—'}</dd>
            <dt>Commissions</dt>
            <dd>{fmtUsd(-t.commission)}</dd>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
