import { useMemo, useState, type CSSProperties } from 'react';
import { Bars } from '@/design/charts/Bars';
import { Histogram } from '@/design/charts/Bars';
import { Heatmap, type HeatCell } from '@/design/charts/Heatmap';
import { Empty, Segmented, cx } from '@/design/primitives';
import { computeTradeStats, histogram, WEEKDAY_KEYS } from '@/engine/metrics';
import { ET_ZONE, zonedWallClock } from '@/lib/time';
import type { Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { fmtPct, fmtRatio, fmtUsd, plural, signClass } from '@/lib/format';
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

function weekdayLabel(key: string): string {
  const map: Record<string, [string, string, string]> = {
    dim: ['dim', 'Sun', 'dom'],
    lun: ['lun', 'Mon', 'lun'],
    mar: ['mar', 'Tue', 'mar'],
    mer: ['mer', 'Wed', 'mié'],
    jeu: ['jeu', 'Thu', 'jue'],
    ven: ['ven', 'Fri', 'vie'],
    sam: ['sam', 'Sat', 'sáb'],
  };
  const t = map[key];
  return t ? tr(t[0], t[1], t[2]) : key;
}

function displayGroupKey(key: string): string {
  if (key === 'Sans stratégie') return tr('Sans stratégie', 'No strategy', 'Sin estrategia');
  if (['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'].includes(key)) return weekdayLabel(key);
  return key;
}

/** Bandes d’encre proportionnelles — lecture visuelle du PnL sans tableau. */
function InkRank({ rows, label }: { rows: GroupRow[]; label: string }) {
  useI18n((s) => s.locale);
  if (rows.length === 0)
    return (
      <p className={s.note}>
        {tr(`Aucune donnée pour ${label.toLowerCase()}.`, `No data for ${label.toLowerCase()}.`, `Sin datos para ${label.toLowerCase()}.`)}
      </p>
    );
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  return (
    <div className={s.inkRank}>
      <header className={s.inkHead}>
        <span>{label}</span>
        <span>{tr('PnL · part', 'PnL · share', 'PnL · parte')}</span>
      </header>
      {rows.slice(0, 10).map((r, i) => {
        const w = (Math.abs(r.pnl) / max) * 100;
        return (
          <div key={r.key} className={s.inkRow} style={{ '--i': i } as CSSProperties}>
            <div className={s.inkMeta}>
              <b>{displayGroupKey(r.key)}</b>
              <small>
                {plural(r.count, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades'))} · {fmtPct(r.winRate, 0)} · PF {fmtRatio(r.profitFactor)}
              </small>
            </div>
            <div className={s.inkTrack}>
              <i className={cx(s.inkBar, r.pnl >= 0 ? s.pos : s.neg)} style={{ width: `${Math.max(2, w)}%` }} />
            </div>
            <span className={cx(s.inkVal, signClass(r.pnl))}>{fmtUsd(r.pnl, { sign: true })}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Anneau polar : contribution PnL par jour de semaine. */
function WeekRing({ byDow }: { byDow: { key: string; pnl: number; n: number }[] }) {
  useI18n((s) => s.locale);
  const max = Math.max(1, ...byDow.map((d) => Math.abs(d.pnl)));
  const cx0 = 110;
  const cy0 = 110;
  const r0 = 38;
  const r1 = 88;
  return (
    <svg viewBox="0 0 220 220" className={s.weekRing} aria-label={tr('PnL par jour de semaine', 'PnL by weekday', 'PnL por día de la semana')}>
      <circle cx={cx0} cy={cy0} r={r0} fill="none" stroke="var(--line-1)" strokeWidth={1} />
      <circle cx={cx0} cy={cy0} r={r1} fill="none" stroke="var(--line-0)" strokeWidth={1} />
      {byDow.map((d, i) => {
        const a0 = -Math.PI / 2 + (i / 5) * Math.PI * 2;
        const a1 = -Math.PI / 2 + ((i + 1) / 5) * Math.PI * 2 - 0.04;
        const t = Math.min(1, Math.abs(d.pnl) / max);
        const r = r0 + 8 + t * (r1 - r0 - 12);
        const x0 = cx0 + Math.cos(a0) * r0;
        const y0 = cy0 + Math.sin(a0) * r0;
        const x1 = cx0 + Math.cos(a0) * r;
        const y1 = cy0 + Math.sin(a0) * r;
        const x2 = cx0 + Math.cos(a1) * r;
        const y2 = cy0 + Math.sin(a1) * r;
        const x3 = cx0 + Math.cos(a1) * r0;
        const y3 = cy0 + Math.sin(a1) * r0;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const mid = (a0 + a1) / 2;
        const lx = cx0 + Math.cos(mid) * (r1 + 14);
        const ly = cy0 + Math.sin(mid) * (r1 + 14);
        return (
          <g key={d.key}>
            <path
              d={`M${x0} ${y0} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r0} ${r0} 0 ${large} 0 ${x0} ${y0} Z`}
              fill={d.pnl >= 0 ? 'rgba(127,207,154,0.45)' : 'rgba(224,119,108,0.45)'}
              stroke={d.pnl >= 0 ? 'var(--mint-line)' : 'var(--ember-line)'}
              strokeWidth={1}
            />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className={s.ringLabel}>
              {weekdayLabel(d.key)}
            </text>
          </g>
        );
      })}
      <text x={cx0} y={cy0 - 6} textAnchor="middle" className={s.ringCenter}>
        {tr('SEMAINE', 'WEEK', 'SEMANA')}
      </text>
      <text x={cx0} y={cy0 + 10} textAnchor="middle" className={s.ringSub}>
        {tr('trame PnL', 'PnL frame', 'trama PnL')}
      </text>
    </svg>
  );
}

/** Champ MAE×MFE en quadrants lithographiques. */
function ExcursionField({ pts, max }: { pts: { mae: number; mfe: number; pnl: number }[]; max: number }) {
  const w = 360;
  const h = 280;
  const pad = { l: 40, r: 16, t: 16, b: 32 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const sx = (v: number) => pad.l + (v / max) * iw;
  const sy = (v: number) => pad.t + ih - (v / max) * ih;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={s.field} preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="fieldGrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="url(#fieldGrid)" />
      {/* Quadrants */}
      <line x1={sx(0)} x2={sx(max)} y1={sy(0)} y2={sy(max)} stroke="var(--gold-line)" strokeWidth={1} strokeDasharray="4 4" />
      <rect x={pad.l} y={pad.t} width={iw} height={ih} fill="none" stroke="var(--line-1)" />
      <text x={w - pad.r} y={h - 8} textAnchor="end" className={s.fieldAxis}>
        MAE →
      </text>
      <text x={8} y={pad.t + 4} className={s.fieldAxis} writingMode="tb">
        MFE
      </text>
      {pts.map((p, i) => (
        <rect
          key={i}
          x={sx(p.mae) - 1.5}
          y={sy(p.mfe) - 1.5}
          width={3}
          height={3}
          fill={p.pnl >= 0 ? 'var(--mint)' : 'var(--ember)'}
          opacity={0.85}
        />
      ))}
    </svg>
  );
}

export function Analyse() {
  const locale = useI18n((s) => s.locale);
  const { trades, tradeStats: t } = useStats();
  const [rankMode, setRankMode] = useState<'strategie' | 'tag' | 'taille'>('strategie');

  const byStrategy = useMemo(() => groupBy(trades, (x) => [x.strategy ?? 'Sans stratégie']), [trades]);
  const byTag = useMemo(() => groupBy(trades.filter((x) => x.tags?.length), (x) => x.tags ?? []), [trades]);
  const byInstrument = useMemo(() => groupBy(trades, (x) => [x.instrument]), [trades]);
  const byQty = useMemo(() => groupBy(trades, (x) => [`${x.qty} ct`]).sort((a, b) => parseInt(a.key) - parseInt(b.key)), [trades]);

  const durationBuckets = useMemo(() => {
    const edges = [2, 5, 10, 20, 40, 90, Infinity];
    const labels = ['< 2m', '2–5m', '5–10m', '10–20m', '20–40m', '40–90m', '> 90m'];
    const acc = labels.map(() => ({ n: 0, wins: 0, pnl: 0 }));
    for (const x of trades) {
      const m = (x.exitTime - x.entryTime) / 60000;
      const i = edges.findIndex((edge) => m < edge);
      const b = acc[i === -1 ? acc.length - 1 : i];
      if (!b) continue;
      b.n++;
      b.pnl += x.pnl;
      if (x.pnl > 0) b.wins++;
    }
    return labels.map((label, i) => {
      const cell = acc[i] ?? { n: 0, wins: 0, pnl: 0 };
      return {
        key: label,
        value: cell.pnl,
        label,
        hint: `${plural(cell.n, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades'))} · ${cell.n ? fmtPct(cell.wins / cell.n, 0) : '—'} ${tr('réussite', 'win rate', 'acierto')}`,
      };
    });
  }, [trades, locale]);

  const heat = useMemo(() => {
    const acc = new Map<number, { pnl: number; n: number }>();
    const hoursSeen = new Set<number>();
    for (const x of trades) {
      const clock = zonedWallClock(x.entryTime, ET_ZONE);
      const dow = clock.weekday;
      const h = clock.hour;
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
    const candidates: { dow: number; h: number; pnl: number }[] = [];
    rows.forEach((dow, ri) => {
      hours.forEach((h, ci) => {
        const cur = acc.get(dow * 24 + h);
        cells.push({ row: ri, col: ci, value: cur ? cur.pnl : null, hint: plural(cur?.n ?? 0, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades')) });
        if (cur) candidates.push({ dow, h, pnl: cur.pnl });
      });
    });
    const best = candidates.reduce<{ dow: number; h: number; pnl: number } | null>((accBest, c) => (!accBest || c.pnl > accBest.pnl ? c : accBest), null);
    return { rows: rows.map((d) => weekdayLabel(WEEKDAY_KEYS[d] ?? '')), cols: hours.map((h) => `${h}h`), cells, best, hours };
  }, [trades, locale]);

  const byDow = useMemo(() => {
    const acc = new Map<number, { pnl: number; n: number }>();
    for (const x of trades) {
      const dow = new Date(x.entryTime).getDay();
      if (dow === 0 || dow === 6) continue;
      const cur = acc.get(dow) ?? { pnl: 0, n: 0 };
      cur.pnl += x.pnl;
      cur.n++;
      acc.set(dow, cur);
    }
    return [1, 2, 3, 4, 5].map((d) => ({ key: WEEKDAY_KEYS[d] ?? '', pnl: acc.get(d)?.pnl ?? 0, n: acc.get(d)?.n ?? 0 }));
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

  const insights = useMemo(() => {
    const bestDur = [...durationBuckets].sort((a, b) => b.value - a.value)[0];
    const bestStrat = byStrategy[0];
    const edge = t.expectancy;
    return {
      bestHour: heat.best ? `${weekdayLabel(WEEKDAY_KEYS[heat.best.dow] ?? '')} ${heat.best.h}h` : '—',
      bestHourPnl: heat.best?.pnl ?? 0,
      bestDur: bestDur?.key ?? '—',
      bestDurPnl: bestDur?.value ?? 0,
      bestStrat: bestStrat ? displayGroupKey(bestStrat.key) : '—',
      bestStratPnl: bestStrat?.pnl ?? 0,
      edge,
      wr: t.winRate,
      pf: t.profitFactor,
    };
  }, [heat, durationBuckets, byStrategy, t, locale]);

  const rankRows = rankMode === 'strategie' ? byStrategy : rankMode === 'tag' ? byTag : byQty;
  const rankLabel = rankMode === 'strategie' ? tr('Stratégie', 'Strategy', 'Estrategia') : rankMode === 'tag' ? 'Tag' : tr('Taille', 'Size', 'Tamaño');

  if (trades.length === 0)
    return (
      <Empty
        title={tr('Analyse indisponible', 'Analysis unavailable', 'Análisis no disponible')}
        text={tr(
          'L’analyse détaillée nécessite des trades (import NinjaTrader ou jeu de démonstration).',
          'Detailed analysis requires trades (NinjaTrader import or demo dataset).',
          'El análisis detallado requiere trades (importación NinjaTrader o juego de demostración).',
        )}
      />
    );

  return (
    <div className={s.analyse}>
      <p className={s.note}>{tr('Sharpe : rf = 0, annualisation √252, séances agrégées par date Globex.', 'Sharpe: rf = 0, √252 annualization, sessions aggregated by Globex date.', 'Sharpe: rf = 0, anualización √252, sesiones agregadas por fecha Globex.')}</p>
      {/* Rail d’insights — lecture immédiate */}
      <section className={s.insightRail} aria-label={tr('Repères d’analyse', 'Analysis markers', 'Referencias de análisis')}>
        <div className={s.insight}>
          <span className={s.insightK}>{tr('Créneau fort', 'Strong slot', 'Franja fuerte')}</span>
          <b>{insights.bestHour}</b>
          <em className={signClass(insights.bestHourPnl)}>{fmtUsd(insights.bestHourPnl, { sign: true })}</em>
        </div>
        <i className={s.insightSep} />
        <div className={s.insight}>
          <span className={s.insightK}>{tr('Durée fertile', 'Fertile duration', 'Duración fértil')}</span>
          <b>{insights.bestDur}</b>
          <em className={signClass(insights.bestDurPnl)}>{fmtUsd(insights.bestDurPnl, { sign: true })}</em>
        </div>
        <i className={s.insightSep} />
        <div className={s.insight}>
          <span className={s.insightK}>{tr('Vecteur', 'Vector', 'Vector')}</span>
          <b title={insights.bestStrat}>{insights.bestStrat.length > 18 ? `${insights.bestStrat.slice(0, 16)}…` : insights.bestStrat}</b>
          <em className={signClass(insights.bestStratPnl)}>{fmtUsd(insights.bestStratPnl, { sign: true })}</em>
        </div>
        <i className={s.insightSep} />
        <div className={s.insight}>
          <span className={s.insightK}>{tr('Espérance', 'Expectancy', 'Esperanza')}</span>
          <b className={signClass(insights.edge)}>{fmtUsd(insights.edge, { cents: true })}</b>
          <em>
            WR {fmtPct(insights.wr, 0)} · PF {fmtRatio(insights.pf)}
          </em>
        </div>
        <i className={s.insightSep} />
        <div className={s.insight}>
          <span className={s.insightK}>{tr('Instruments', 'Instruments', 'Instrumentos')}</span>
          <b>{byInstrument.map((r) => r.key).join(' · ') || '—'}</b>
          <em>{plural(trades.length, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades'))}</em>
        </div>
      </section>

      {/* Trame principale : heatmap héroïque + anneau semaine */}
      <section className={s.analyseHero}>
        <div className={s.trame}>
          <header className={s.trameHead}>
            <div>
              <h3>{tr('Trame horaire', 'Hourly frame', 'Trama horaria')}</h3>
              <p>{tr('PnL par jour × heure ET d’entrée — densité d’avantage', 'PnL by day × ET entry hour — edge density', 'PnL por día × hora ET de entrada — densidad de ventaja')}</p>
            </div>
            <span className={s.trameLegend}>
              <i className={s.legNeg} /> {tr('perte', 'loss', 'pérdida')} <i className={s.legPos} /> {tr('gain', 'win', 'ganancia')}
            </span>
          </header>
          <Heatmap rows={heat.rows} cols={heat.cols} cells={heat.cells} height={220} formatValue={(v) => fmtUsd(v)} colLabelEvery={heat.cols.length > 14 ? 2 : 1} />
        </div>
        <aside className={s.ringPane}>
          <header className={s.trameHead}>
            <div>
              <h3>{tr('Anneau semaine', 'Week ring', 'Anillo semanal')}</h3>
              <p>{tr('Amplitude relative', 'Relative amplitude', 'Amplitud relativa')}</p>
            </div>
          </header>
          <WeekRing byDow={byDow} />
          <ul className={s.ringStats}>
            {byDow.map((d) => (
              <li key={d.key}>
                <span>{weekdayLabel(d.key)}</span>
                <b className={signClass(d.pnl)}>{fmtUsd(d.pnl, { sign: true })}</b>
                <small>{plural(d.n, 't')}</small>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      {/* Spectre durée + R + excursions */}
      <section className={s.analyseMid}>
        <div className={s.midBlock}>
          <header className={s.trameHead}>
            <div>
              <h3>{tr('Spectre de durée', 'Duration spectrum', 'Espectro de duración')}</h3>
              <p>{tr('PnL agrégé par temps en position', 'PnL aggregated by time in trade', 'PnL agregado por tiempo en posición')}</p>
            </div>
          </header>
          <Bars data={durationBuckets} height={200} formatY={(v) => fmtUsd(v)} />
        </div>
        <div className={s.midBlock}>
          <header className={s.trameHead}>
            <div>
              <h3>{tr('Champ d’excursion', 'Excursion field', 'Campo de excursion')}</h3>
              <p>{tr('MAE × MFE — au-dessus de la diagonale = asymétrie favorable', 'MAE × MFE — above the diagonal = favorable asymmetry', 'MAE × MFE — por encima de la diagonal = asimetría favorable')}</p>
            </div>
          </header>
          {scatter ? (
            <ExcursionField pts={scatter.pts} max={scatter.max} />
          ) : (
            <p className={s.note}>{tr('MAE/MFE absents : activez leur export dans NinjaTrader.', 'MAE/MFE missing: enable their export in NinjaTrader.', 'MAE/MFE ausentes: active su exportación en NinjaTrader.')}</p>
          )}
        </div>
        <div className={s.midBlock}>
          <header className={s.trameHead}>
            <div>
              <h3>{tr('Multiples de R', 'R multiples', 'Múltiplos de R')}</h3>
              <p>{t.rMultiples.length ? plural(t.rMultiples.length, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades')) : tr('risque non renseigné', 'risk not set', 'riesgo no indicado')}</p>
            </div>
          </header>
          {rHist ? <Histogram bins={rHist} height={200} formatX={(v) => `${fmtRatio(v, 1)} R`} /> : <p className={s.note}>{tr('Définissez un risque par contrat pour la distribution en R.', 'Set a risk per contract for the R distribution.', 'Defina un riesgo por contrato para la distribución en R.')}</p>}
        </div>
      </section>

      {/* Classement à bandes d’encre */}
      <section className={s.analyseRank}>
        <header className={s.trameHead}>
          <div>
            <h3>{tr('Classement d’encre', 'Ink ranking', 'Clasificación de tinta')}</h3>
            <p>{tr('Contribution relative — largeur = |PnL|', 'Relative contribution — width = |PnL|', 'Contribución relativa — anchura = |PnL|')}</p>
          </div>
          <Segmented
            value={rankMode}
            onChange={setRankMode}
            options={[
              { value: 'strategie', label: tr('Stratégie', 'Strategy', 'Estrategia') },
              { value: 'tag', label: 'Tag' },
              { value: 'taille', label: tr('Taille', 'Size', 'Tamaño') },
            ]}
          />
        </header>
        <InkRank rows={rankRows} label={rankLabel} />
      </section>
    </div>
  );
}
