import { useMemo } from 'react';
import { Bars } from '@/design/charts/Bars';
import { Histogram } from '@/design/charts/Bars';
import { Heatmap, type HeatCell } from '@/design/charts/Heatmap';
import { Empty, Panel, tableClass, cx } from '@/design/primitives';
import { computeTradeStats, histogram, WEEKDAY_KEYS } from '@/engine/metrics';
import type { Trade } from '@/engine/types';
import { fmtPct, fmtRatio, fmtUsd, plural, signClass } from '@/lib/format';
import { formatDuration } from '@/lib/time';
import s from './metrique.module.css';
import { useStats } from './useStats';

interface GroupRow {
  key: string;
  count: number;
  pnl: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  avgDurationMs: number;
}

function groupBy(trades: Trade[], keyOf: (t: Trade) => string[]): GroupRow[] {
  const map = new Map<string, Trade[]>();
  for (const t of trades) {
    for (const k of keyOf(t)) {
      const arr = map.get(k);
      if (arr) arr.push(t);
      else map.set(k, [t]);
    }
  }
  return [...map.entries()]
    .map(([key, arr]) => {
      const st = computeTradeStats(arr);
      return { key, count: st.count, pnl: st.netPnl, winRate: st.winRate, profitFactor: st.profitFactor, expectancy: st.expectancy, avgDurationMs: st.avgDurationMs };
    })
    .sort((a, b) => b.pnl - a.pnl);
}

function GroupTable({ rows, label }: { rows: GroupRow[]; label: string }) {
  if (rows.length === 0) return <p className={s.note}>Aucune donnée : renseignez {label.toLowerCase()} dans NinjaTrader ou via les tags de séance.</p>;
  return (
    <div className={s.tableWrap} style={{ maxHeight: 300 }}>
      <table className={tableClass}>
        <thead>
          <tr>
            <th>{label}</th>
            <th className="num">Trades</th>
            <th className="num">PnL</th>
            <th className="num">Réussite</th>
            <th className="num">PF</th>
            <th className="num">Espérance</th>
            <th className="num">Durée</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              <td className="num">{r.count}</td>
              <td className={cx('num', signClass(r.pnl))}>{fmtUsd(r.pnl, { sign: true })}</td>
              <td className="num">{fmtPct(r.winRate, 0)}</td>
              <td className="num">{fmtRatio(r.profitFactor)}</td>
              <td className={cx('num', signClass(r.expectancy))}>{fmtUsd(r.expectancy, { cents: true })}</td>
              <td className="num muted">{formatDuration(r.avgDurationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Analyse() {
  const { trades, tradeStats: t } = useStats();

  const byStrategy = useMemo(() => groupBy(trades, (x) => [x.strategy ?? 'Sans stratégie']), [trades]);
  const byTag = useMemo(() => groupBy(trades.filter((x) => x.tags?.length), (x) => x.tags ?? []), [trades]);
  const byInstrument = useMemo(() => groupBy(trades, (x) => [x.instrument]), [trades]);
  const byQty = useMemo(() => groupBy(trades, (x) => [`${x.qty} contrat${x.qty > 1 ? 's' : ''}`]).sort((a, b) => parseInt(a.key) - parseInt(b.key)), [trades]);

  const durationBuckets = useMemo(() => {
    const edges = [2, 5, 10, 20, 40, 90, Infinity];
    const labels = ['< 2m', '2–5m', '5–10m', '10–20m', '20–40m', '40–90m', '> 90m'];
    const acc = labels.map(() => ({ n: 0, wins: 0, pnl: 0 }));
    for (const x of trades) {
      const m = (x.exitTime - x.entryTime) / 60000;
      const i = edges.findIndex((edge) => m < edge);
      const b = acc[i === -1 ? acc.length - 1 : i];
      b.n++;
      b.pnl += x.pnl;
      if (x.pnl > 0) b.wins++;
    }
    return labels.map((label, i) => ({ key: label, value: acc[i].pnl, label, hint: `${plural(acc[i].n, 'trade')} · ${acc[i].n ? fmtPct(acc[i].wins / acc[i].n, 0) : '—'} réussite` }));
  }, [trades]);

  const heat = useMemo(() => {
    // Une seule passe : agrégation par (jour de semaine × heure locale d'entrée).
    const acc = new Map<number, { pnl: number; n: number }>();
    const hoursSeen = new Set<number>();
    for (const x of trades) {
      const d = new Date(x.entryTime);
      const dow = d.getDay();
      const h = d.getHours();
      hoursSeen.add(h);
      const k = dow * 24 + h;
      const cur = acc.get(k);
      if (cur) {
        cur.pnl += x.pnl;
        cur.n++;
      } else acc.set(k, { pnl: x.pnl, n: 1 });
    }
    const hours = [...hoursSeen].sort((a, b) => a - b);
    const rows = [1, 2, 3, 4, 5];
    const cells: HeatCell[] = [];
    rows.forEach((dow, ri) => {
      hours.forEach((h, ci) => {
        const cur = acc.get(dow * 24 + h);
        cells.push({ row: ri, col: ci, value: cur ? cur.pnl : null, hint: plural(cur?.n ?? 0, 'trade') });
      });
    });
    return { rows: rows.map((d) => WEEKDAY_KEYS[d]), cols: hours.map((h) => `${h}h`), cells };
  }, [trades]);

  const scatter = useMemo(() => {
    const pts: { mae: number; mfe: number; pnl: number }[] = [];
    let max = 1;
    for (const x of trades) {
      if (typeof x.mae !== 'number' || typeof x.mfe !== 'number' || !Number.isFinite(x.mae) || !Number.isFinite(x.mfe)) continue;
      pts.push({ mae: x.mae, mfe: x.mfe, pnl: x.pnl });
      if (x.mae > max) max = x.mae;
      if (x.mfe > max) max = x.mfe;
    }
    if (pts.length === 0) return null;
    return { pts, max };
  }, [trades]);

  const rHist = useMemo(() => (t.rMultiples.length ? histogram(t.rMultiples, 20) : null), [t.rMultiples]);

  if (trades.length === 0) return <Empty title="Analyse indisponible" text="L’analyse détaillée nécessite des trades (import NinjaTrader ou jeu de démonstration)." />;

  return (
    <div className={s.grid}>
      <Panel className={s.c6} title="Par stratégie" sub="champ Strategy / Entry name">
        <GroupTable rows={byStrategy} label="Stratégie" />
      </Panel>
      <Panel className={s.c6} title="Par tag" sub="étiquettes de trade">
        <GroupTable rows={byTag} label="Tag" />
      </Panel>
      <Panel className={s.c12} title="Carte horaire" sub="PnL par jour × heure locale d'entrée">
        <Heatmap rows={heat.rows} cols={heat.cols} cells={heat.cells} height={150} formatValue={(v) => fmtUsd(v)} />
      </Panel>
      <Panel className={s.c4} title="Par durée en position" sub="PnL agrégé">
        <Bars data={durationBuckets} height={180} formatY={(v) => fmtUsd(v)} />
      </Panel>
      <Panel className={s.c4} title="MAE / MFE" sub="excursions par trade ($)">
        {scatter ? (
          <svg viewBox="0 0 320 220" className={s.scatter} preserveAspectRatio="xMidYMid meet">
            <line x1={36} x2={310} y1={190} y2={190} stroke="rgba(255,255,255,0.2)" />
            <line x1={36} x2={36} y1={10} y2={190} stroke="rgba(255,255,255,0.2)" />
            <line x1={36} y1={190} x2={310} y2={10} stroke="var(--gold-line)" strokeDasharray="3 3" />
            <text x={310} y={206} textAnchor="end" fontSize={11} fill="var(--text-3)" fontFamily="var(--font-mono)">
              MAE → {fmtUsd(scatter.max)}
            </text>
            <text x={12} y={14} fontSize={11} fill="var(--text-3)" fontFamily="var(--font-mono)">
              MFE
            </text>
            {scatter.pts.map((p, i) => (
              <circle key={i} cx={36 + (p.mae / scatter.max) * 274} cy={190 - (p.mfe / scatter.max) * 180} r={2.4} fill={p.pnl >= 0 ? 'var(--mint)' : 'var(--ember)'} opacity={0.7} />
            ))}
          </svg>
        ) : (
          <p className={s.note}>MAE/MFE absents : activez leur export dans NinjaTrader (Trade Performance › colonnes MAE, MFE).</p>
        )}
        <p className={s.note}>Au-dessus de la diagonale, le trade a offert plus qu’il n’a coûté. Les points rouges très à droite signalent des stops trop larges.</p>
      </Panel>
      <Panel className={s.c4} title="Multiples de R" sub={t.rMultiples.length ? `${plural(t.rMultiples.length, 'trade')} avec risque défini` : 'risque non renseigné'}>
        {rHist ? <Histogram bins={rHist} height={180} formatX={(v) => `${fmtRatio(v, 1)} R`} /> : <p className={s.note}>Définissez un risque par contrat dans les réglages (ou une colonne Risk dans le CSV) pour obtenir la distribution en R.</p>}
      </Panel>
      <Panel className={s.c6} title="Par instrument" sub="NQ · MNQ">
        <GroupTable rows={byInstrument} label="Instrument" />
      </Panel>
      <Panel className={s.c6} title="Par taille" sub="nombre de contrats">
        <GroupTable rows={byQty} label="Taille" />
      </Panel>
    </div>
  );
}
