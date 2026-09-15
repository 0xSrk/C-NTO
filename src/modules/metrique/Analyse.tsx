import { useMemo } from 'react';
import { Bars } from '@/design/charts/Bars';
import { Histogram } from '@/design/charts/Bars';
import { Heatmap, type HeatCell } from '@/design/charts/Heatmap';
import { Empty, Panel, tableClass, cx } from '@/design/primitives';
import { computeTradeStats, histogram, WEEKDAY_KEYS } from '@/engine/metrics';
import type { Trade } from '@/engine/types';
import { fmtInt, fmtPct, fmtRatio, fmtUsd, signClass } from '@/lib/format';
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
    return edges.map((edge, i) => {
      const lo = i === 0 ? 0 : edges[i - 1];
      const arr = trades.filter((x) => {
        const m = (x.exitTime - x.entryTime) / 60000;
        return m >= lo && m < edge;
      });
      const pnl = arr.reduce((sum, x) => sum + x.pnl, 0);
      return { key: labels[i], value: pnl, label: labels[i], hint: `${arr.length} trade(s) · ${arr.length ? fmtPct(arr.filter((x) => x.pnl > 0).length / arr.length, 0) : '—'} réussite` };
    });
  }, [trades]);

  const heat = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => i).filter((h) => trades.some((x) => new Date(x.entryTime).getHours() === h));
    const rows = [1, 2, 3, 4, 5];
    const cells: HeatCell[] = [];
    rows.forEach((dow, ri) => {
      hours.forEach((h, ci) => {
        const arr = trades.filter((x) => {
          const d = new Date(x.entryTime);
          return d.getDay() === dow && d.getHours() === h;
        });
        cells.push({ row: ri, col: ci, value: arr.length ? arr.reduce((sum, x) => sum + x.pnl, 0) : null, hint: `${arr.length} trade(s)` });
      });
    });
    return { rows: rows.map((d) => WEEKDAY_KEYS[d]), cols: hours.map((h) => `${h}h`), cells };
  }, [trades]);

  const scatter = useMemo(() => {
    const pts = trades.filter((x) => typeof x.mae === 'number' && typeof x.mfe === 'number').map((x) => ({ mae: x.mae as number, mfe: x.mfe as number, pnl: x.pnl }));
    if (pts.length === 0) return null;
    const max = Math.max(...pts.map((p) => Math.max(p.mae, p.mfe)), 1);
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
          <svg viewBox="0 0 320 220" className={s.scatter} preserveAspectRatio="none">
            <line x1={36} x2={310} y1={190} y2={190} stroke="rgba(255,255,255,0.2)" />
            <line x1={36} x2={36} y1={10} y2={190} stroke="rgba(255,255,255,0.2)" />
            <line x1={36} y1={190} x2={310} y2={10} stroke="rgba(201,162,77,0.35)" strokeDasharray="3 3" />
            <text x={310} y={206} textAnchor="end" fontSize={9} fill="var(--text-3)" fontFamily="var(--font-mono)">
              MAE → {fmtUsd(scatter.max)}
            </text>
            <text x={12} y={14} fontSize={9} fill="var(--text-3)" fontFamily="var(--font-mono)">
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
      <Panel className={s.c4} title="Multiples de R" sub={t.rMultiples.length ? `${fmtInt(t.rMultiples.length)} trades avec risque défini` : 'risque non renseigné'}>
        {rHist ? <Histogram bins={rHist} height={180} formatX={(v) => `${v.toFixed(1)}R`} /> : <p className={s.note}>Définissez un risque par contrat dans les réglages (ou une colonne Risk dans le CSV) pour obtenir la distribution en R.</p>}
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
