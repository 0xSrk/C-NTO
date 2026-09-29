import { useId, useMemo } from 'react';
import { Button, Empty, Etiquette, Jauge, Lecteur, Montant, PlaqueVissee } from '@/design/primitives';
import { computeDailyStats, computeTradeStats, type EquityPoint } from '@/engine/metrics';
import { tr, useI18n } from '@/i18n';
import { breakevenWinRate } from '@/lib/breakeven';
import { fmtInt, fmtPct, montantParts, plural } from '@/lib/format';
import { dateTimeFormatter, parseDateKey } from '@/lib/time';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './dashboard.module.css';
import { metricDrawdownLimit } from './drawdownLimit';
import type { MetricRange } from './range';
import type { Session, Trade } from '@/engine/types';

function shortDay(date: string): string {
  if (date.length < 10) return '';
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

function weekday(date: string): string {
  return dateTimeFormatter({ weekday: 'short' }).format(parseDateKey(date)).replace('.', '').toUpperCase();
}

function rangeTitle(range: MetricRange): string {
  if (range === '7j') return tr('7 JOURS', '7 DAYS', '7 DÍAS');
  if (range === '90j') return tr('90 JOURS', '90 DAYS', '90 DÍAS');
  if (range === 'tout') return tr('TOUT', 'ALL', 'TODO');
  return tr('30 JOURS', '30 DAYS', '30 DÍAS');
}

function pnlLabel(value: number): string {
  const parts = montantParts(value, 2);
  const body = `${parts.groups.join(' ')},${parts.decimals}`;
  return parts.sign ? `${parts.sign}${body}` : body;
}

function axisText(value: number): string {
  if (Math.abs(value) < 1e-9) return '0';
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const k = abs / 1000;
    const body = Number.isInteger(k) ? String(k) : k.toFixed(1).replace('.', ',');
    return `${sign}${body}K`;
  }
  return `${sign}${fmtInt(abs)}`;
}

/** Graduations ~4 intervalles, pas 1/2/5/10. Inclut zéro. */
function axisSteps(lo: number, hi: number): number[] {
  const span = Math.max(hi - lo, 1);
  const rough = span / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const n = rough / pow;
  const step = (n >= 7.5 ? 10 : n >= 3.5 ? 5 : n >= 1.5 ? 2 : 1) * pow;
  const start = Math.ceil((lo - step * 1e-6) / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.01 && out.length < 8; v += step) {
    const rounded = Math.abs(v) < step / 1000 ? 0 : Math.round(v / step) * step;
    out.push(rounded);
  }
  if (lo <= 0 && hi >= 0 && !out.some((v) => v === 0)) out.push(0);
  return [...new Set(out)].sort((a, b) => a - b);
}

function EquityCurve({ points, dates, baseline }: { points: EquityPoint[]; dates: string[]; baseline: number }) {
  const pid = useId().replace(/:/g, '');
  if (points.length === 0) return null;
  const w = 640;
  const h = 198;
  const pad = { l: 36, r: 8, t: 18, b: 28 };
  const values = [0, ...points.map((point) => point.equity - baseline)];
  let yLo = Math.min(0, ...values);
  let yHi = Math.max(0, ...values);
  if (yHi === yLo) yHi = yLo + 1;
  else {
    const room = (yHi - yLo) * 0.06;
    if (yLo < 0) yLo -= room;
    if (yHi > 0) yHi += room;
  }
  const x = (i: number) => pad.l + (values.length === 1 ? 0.5 : i / (values.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - yLo) / (yHi - yLo)) * (h - pad.t - pad.b);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  let trough = 0;
  points.forEach((p, i) => {
    if (p.drawdown < (points[trough]?.drawdown ?? 0)) trough = i;
  });
  let peak = 0;
  for (let i = 0; i <= trough; i++) {
    if ((points[i]?.equity ?? 0) >= (points[peak]?.equity ?? 0)) peak = i;
  }
  const dd = Math.abs(points[trough]?.drawdown ?? 0);
  const yAt = (index: number) => y(values[index + 1] ?? 0);
  const hatch =
    dd > 0
      ? [
          ...points.slice(peak, trough + 1).map((_, i) => `${i === 0 ? 'M' : 'L'}${x(peak + 1 + i).toFixed(1)},${yAt(peak + i).toFixed(1)}`),
          `L${x(trough + 1).toFixed(1)},${yAt(peak).toFixed(1)}`,
          'Z',
        ].join(' ')
      : '';
  const last = values[values.length - 1] ?? 0;
  const steps = axisSteps(Math.min(...values), Math.max(...values));
  const step = steps.length > 1 ? (steps[1] ?? 0) - (steps[0] ?? 0) : 1;
  const dateAt = (i: number) => (i === 0 ? dates[0] : dates[i - 1]) ?? '';
  const dateTicks = [0, Math.floor((values.length - 1) / 2), values.length - 1].filter((v, i, all) => all.indexOf(v) === i);
  return (
    <svg className={s.equity} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={tr(`P&L cumulé ${pnlLabel(last)}`, `Cumulative P&L ${pnlLabel(last)}`, `P&L acumulado ${pnlLabel(last)}`)}>
      <defs>
        <pattern id={pid} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--neg)" strokeWidth="2" />
        </pattern>
      </defs>
      {steps.map((value) => {
        const yy = y(value);
        const labeled = value === 0 || (step > 0 && Math.abs(value / (step * 2) - Math.round(value / (step * 2))) < 1e-6);
        return (
          <g key={value}>
            <line x1={pad.l} x2={w - pad.r} y1={yy} y2={yy} stroke={value === 0 ? 'var(--line-2)' : 'var(--line-1)'} strokeDasharray={value === 0 ? undefined : '1 3'} />
            {labeled ? (
              <text className={s.eqAxis} x={pad.l - 6} y={yy + 3} textAnchor="end">
                {axisText(value)}
              </text>
            ) : null}
          </g>
        );
      })}
      {hatch ? <path d={hatch} fill={`url(#${pid})`} /> : null}
      <path d={line} fill="none" stroke="var(--text-0)" strokeWidth="1.6" />
      <text className={s.eqLabel} x={x(values.length - 1) - 8} y={Math.max(12, y(last) - 8)} textAnchor="end" fill="var(--text-0)">
        {pnlLabel(last)}
      </text>
      {dd > 0 ? (
        <text className={s.eqLabel} x={x(trough + 1)} y={Math.min(h - pad.b - 4, yAt(trough) + 14)} fill="var(--neg)">
          −{fmtInt(dd)}
        </text>
      ) : null}
      {dateTicks.map((i) => (
        <text key={i} className={s.eqAxis} x={x(i)} y={h - 6} textAnchor={i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'}>
          {shortDay(dateAt(i))}
        </text>
      ))}
    </svg>
  );
}

export function Dashboard({
  sessions,
  trades,
  range,
  journalEmpty,
  onImport,
  onDemo,
  onSessions,
}: {
  sessions: Session[];
  trades: Trade[];
  range: MetricRange;
  journalEmpty: boolean;
  onImport: () => void;
  onDemo: () => void;
  onSessions: () => void;
}) {
  useI18n((st) => st.locale);
  const startingBalance = useSettings((st) => st.settings.startingBalance);
  const planId = useSettings((st) => st.settings.planId);
  const planAccount = useSettings((st) => st.settings.planAccount);
  const metricAccount = useUi((st) => st.metricAccount);
  const stats = useMemo(() => computeTradeStats(trades), [trades]);
  const daily = useMemo(() => computeDailyStats(sessions, startingBalance), [sessions, startingBalance]);
  const limit = metricDrawdownLimit({ selected: metricAccount, planId, planAccount });
  const breakeven = breakevenWinRate(stats.payoffRatio);
  const ordered = useMemo(() => [...sessions].sort((a, b) => a.date.localeCompare(b.date)), [sessions]);
  const last = ordered.slice(-5).reverse();
  const bySession = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const trade of trades) {
      const list = map.get(trade.sessionId);
      if (list) list.push(trade);
      else map.set(trade.sessionId, [trade]);
    }
    return map;
  }, [trades]);
  const peak = Math.max(...ordered.map((row) => Math.abs(row.pnl)), 1);
  const instruments = stats.byInstrument.filter((row) => row.count > 0);
  const best = ordered.reduce<Session | null>((win, row) => (!win || row.pnl > win.pnl ? row : win), null);
  const names = [...new Set(ordered.flatMap((row) => row.instruments))].slice(0, 3);
  const winSessions = ordered.filter((row) => row.pnl > 0).length;
  const winPart = Math.abs(stats.avgWin);
  const lossPart = Math.abs(stats.avgLoss);
  const split = winPart + lossPart || 1;
  const ddRatio = limit && limit > 0 ? Math.min(1, daily.maxDrawdown / limit) : daily.maxDrawdown > 0 ? Math.min(1, daily.maxDrawdown / (startingBalance || daily.maxDrawdown)) : 0;
  const pf = Number.isFinite(stats.profitFactor) ? Math.min(3, stats.profitFactor) : 3;

  if (journalEmpty) {
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
            <Button onClick={onImport}>{tr('Importer un CSV', 'Import a CSV', 'Importar un CSV')}</Button>
            <Button variant="ghost" onClick={onDemo}>
              {tr('Jeu de démonstration', 'Demo dataset', 'Juego de demostración')}
            </Button>
          </div>
        }
      />
    );
  }

  if (ordered.length === 0) {
    return <Empty title={tr('Aucune séance sur cette période', 'No session in this range', 'Ninguna sesión en este período')} text={tr('Élargissez la période ou le compte.', 'Widen the range or the account.', 'Amplíe el período o la cuenta.')} />;
  }

  return (
    <div className={s.grid}>
      <span className={`canto-plus ${s.plusL}`} aria-hidden>
        +
      </span>
      <span className={`canto-plus ${s.plusR}`} aria-hidden>
        +
      </span>
      <PlaqueVissee className={s.span7}>
        <div className={s.plateBody}>
          <div className={s.plateTop}>
            <div>
              <div className={s.plateLabel}>
                <span className={s.code}>A.01 / {tr('NET P&L', 'NET P&L', 'P&L NETO')} · {rangeTitle(range)}</span>
                <span className={s.hint}>{tr('APRÈS COMMISSIONS', 'AFTER COMMISSIONS', 'DESPUÉS DE COMISIONES')} · USD</span>
              </div>
              <Lecteur value={stats.netPnl} />
            </div>
            <div>
              <span className={s.hint}>{tr('P&L / SÉANCE', 'P&L / SESSION', 'P&L / SESIÓN')}</span>
              <div className={s.bars} aria-hidden>
                {ordered.slice(-28).map((row) => (
                  <i key={row.id} className={row.pnl >= 0 ? s.pos : s.neg} style={{ height: `${Math.max(4, (Math.abs(row.pnl) / peak) * 56)}px` }} />
                ))}
              </div>
              <div className={s.legend}>
                <span className={s.hint}>{tr('Gain', 'Gain', 'Ganancia')}</span>
                <span className={s.hint}>{tr('Perte', 'Loss', 'Pérdida')}</span>
              </div>
            </div>
          </div>
          <div className={s.foot}>
            <span className={s.hint}>
              {tr('Trades', 'Trades', 'Trades')}
              <b>{fmtInt(stats.count)}</b>
            </span>
            <span className={s.hint}>
              {tr('Séances +', 'Win sessions', 'Sesiones +')}
              <b>
                {winSessions}/{ordered.length}
              </b>
            </span>
            <span className={s.hint}>
              {tr('Instruments', 'Instruments', 'Instrumentos')}
              <b>{names.join(' · ') || '—'}</b>
            </span>
            <span className={s.hint}>
              {tr('Meilleure', 'Best', 'Mejor')}
              <b className={s.pos}>{best ? <Montant value={best.pnl} /> : '—'}</b>
            </span>
          </div>
        </div>
      </PlaqueVissee>

      <section className={`${s.card} ${s.kpis} ${s.span5}`}>
        <div className={s.tile}>
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.01 </span>
              <span className={s.kName}>{tr('Espérance', 'Expectancy', 'Esperanza')} / {tr('TRADE', 'TRADE', 'TRADE')}</span>
            </span>
          </div>
          <Montant className={s.kValue} value={stats.expectancy} />
          <div>
            <div className={s.split} aria-hidden>
              <i style={{ width: `${(winPart / split) * 100}%` }} />
              <i style={{ width: `${(lossPart / split) * 100}%` }} />
            </div>
            <div className={s.pair}>
              <span className={s.hint}>
                G̅ <Montant value={stats.avgWin} />
              </span>
              <span className={s.hint}>
                P̅ <Montant value={-Math.abs(stats.avgLoss)} />
              </span>
            </div>
          </div>
        </div>
        <div className={s.tile}>
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.02 </span>
              <span className={s.kName}>{tr('Taux de réussite', 'Win rate', 'Tasa de acierto')}</span>
            </span>
            <span className={s.hint}>
              {fmtInt(stats.wins)} / {fmtInt(stats.count)}
            </span>
          </div>
          <span className={s.kValue}>{fmtPct(stats.winRate, 1)}</span>
          <Jauge
            min={0}
            max={100}
            value={stats.winRate * 100}
            marker={breakeven == null ? null : breakeven * 100}
            markerColor="var(--neg)"
            ticks={[
              { value: 0, label: '0' },
              { value: 50, label: '50' },
              { value: 100, label: '100' },
            ]}
          />
        </div>
        <div className={s.tile}>
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.03 </span>
              <span className={s.kName}>{tr('Profit factor', 'Profit factor', 'Profit factor')}</span>
            </span>
            <span className={s.hint}>{tr('BRUT', 'GROSS', 'BRUTO')}</span>
          </div>
          <span className={s.kValue}>{Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2).replace('.', ',') : '∞'}</span>
          <Jauge
            min={0}
            max={3}
            value={pf}
            marker={1}
            markerColor="var(--neg)"
            ticks={[
              { value: 0, label: '0' },
              { value: 1, label: '1,0', color: 'var(--neg)' },
              { value: 3, label: '3,0' },
            ]}
          />
        </div>
        <div className={s.tile}>
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.04 </span>
              <span className={s.kName}>{tr('Drawdown max', 'Max drawdown', 'Drawdown máx.')}</span>
            </span>
            {limit != null ? (
              <span className={s.hint}>
                / <Montant value={limit} />
              </span>
            ) : null}
          </div>
          <Montant className={`${s.kValue} ${s.neg}`} value={-daily.maxDrawdown} />
          <div>
            <div className={s.hatch} aria-hidden>
              <i style={{ width: `${ddRatio * 100}%` }} />
            </div>
            <div className={s.pair}>
              <span className={s.hint}>{limit != null && limit > 0 ? `${fmtPct(daily.maxDrawdown / limit, 1)} ${tr('DE LA LIMITE', 'OF THE LIMIT', 'DEL LÍMITE')}` : ''}</span>
              <span className={s.hint}>{plural(daily.maxDrawdownDays, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))}</span>
            </div>
          </div>
        </div>
      </section>

      <section className={`${s.card} ${s.pad} ${s.span8}`}>
        <div className={s.cardHead}>
          <span>
            <span className={s.code}>A.02 </span>
            <span className={s.kName}>{tr('Courbe d’équité', 'Equity curve', 'Curva de equidad')}</span>
          </span>
          <span className={s.hint}>{tr('ÉQUITÉ', 'EQUITY', 'EQUIDAD')} · {tr('DRAWDOWN', 'DRAWDOWN', 'DRAWDOWN')}</span>
        </div>
        <EquityCurve points={daily.equity} dates={[...new Set(ordered.map((row) => row.date))].sort()} baseline={startingBalance} />
      </section>

      <section className={`${s.card} ${s.pad} ${s.span4}`}>
        <div className={s.cardHead}>
          <span>
            <span className={s.code}>A.03 </span>
            <span className={s.kName}>{tr('Par instrument', 'By instrument', 'Por instrumento')}</span>
          </span>
          <span className={s.hint}>{tr('NET USD', 'NET USD', 'NETO USD')}</span>
        </div>
        <div>
          {instruments.slice(0, 6).map((row) => (
            <div key={row.key} className={s.inst}>
              <span className={s.root}>{row.key}</span>
              <span className={s.hint}>
                {fmtInt(row.count)} TR · {fmtPct(stats.count ? row.count / stats.count : 0, 1)}
              </span>
              <span className={s.hint} style={{ gridColumn: '1 / -1', justifySelf: 'end' }}>
                <Montant value={row.pnl} />
              </span>
              <div className={s.share}>
                <i style={{ width: `${stats.count ? (row.count / stats.count) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
        <span className={s.hint}>{tr('RÉPARTITION DES', 'SPLIT OF', 'REPARTO DE')} {fmtInt(stats.count)} {tr('TRADES', 'TRADES', 'TRADES')}</span>
      </section>

      <section className={`${s.card} ${s.span12}`}>
        <div className={s.cardHead} style={{ padding: '12px 16px 10px' }}>
          <span>
            <span className={s.code}>A.04 </span>
            <span className={s.kName}>{tr('Dernières séances', 'Latest sessions', 'Últimas sesiones')}</span>
          </span>
          <button type="button" className={s.more} onClick={onSessions}>
            {tr('VOIR LES', 'SEE THE', 'VER LAS')} {fmtInt(ordered.length)} {tr('SÉANCES', 'SESSIONS', 'SESIONES')} →
          </button>
        </div>
        <table className={s.table}>
          <thead>
            <tr>
              <th>{tr('Séance', 'Session', 'Sesión')}</th>
              <th>{tr('Instruments', 'Instruments', 'Instrumentos')}</th>
              <th>{tr('Tr.', 'Tr.', 'Tr.')}</th>
              <th>{tr('Gagnants', 'Winners', 'Ganadores')}</th>
              <th>{tr('Comm. USD', 'Comm. USD', 'Com. USD')}</th>
              <th>{tr('Tag', 'Tag', 'Etiqueta')}</th>
              <th>{tr('Net USD', 'Net USD', 'Neto USD')}</th>
            </tr>
          </thead>
          <tbody>
            {last.map((row) => {
              const mine = bySession.get(row.id) ?? [];
              const wins = mine.filter((trade) => trade.pnl > 0).length;
              const total = mine.length || row.tradeCount;
              const squares = Math.min(total, 8);
              const tag = row.tags[0]?.trim() || tr('HORS PLAN', 'NO PLAN', 'SIN PLAN');
              return (
                <tr key={row.id}>
                  <td>
                    <span className={s.day}>
                      {shortDay(row.date)}
                      <span>{weekday(row.date)}</span>
                    </span>
                  </td>
                  <td>{row.instruments.join(' · ') || '—'}</td>
                  <td>{fmtInt(total)}</td>
                  <td>
                    <span className={s.squares} aria-hidden>
                      {Array.from({ length: squares }, (_, i) => (
                        <i key={i} className={`${s.sq} ${i < Math.min(wins, squares) ? s.on : ''}`} />
                      ))}
                    </span>
                    {wins}/{total}
                  </td>
                  <td>
                    <Montant value={-Math.abs(row.commission)} />
                  </td>
                  <td>
                    <Etiquette>{tag}</Etiquette>
                  </td>
                  <td>
                    <Montant value={row.pnl} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
