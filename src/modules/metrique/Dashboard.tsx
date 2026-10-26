import { useMemo, type ComponentProps } from 'react';
import { Signal } from '@/design/Micro';
import { Button, Empty, Etiquette, Jauge, Lecteur, Montant, PlaqueVissee } from '@/design/primitives';
import { computeDailyStats, computeTradeStats } from '@/engine/metrics';
import { allocatedRiskStats, autocorrelations, cusum, dailyResultSeries, ratioIntervals, rollingBands, sessionWinRateSeries } from '@/engine/inference';
import { aggregatePoints } from '@/engine/tradeUnits';
import { findPlan } from '@/engine/propfirm';
import { tr, useI18n } from '@/i18n';
import { breakevenWinRate } from '@/lib/breakeven';
import { fmtInt, fmtPct, fmtPoints, fmtRatio, fmtUsd, plural } from '@/lib/format';
import { dateTimeFormatter, parseDateKey } from '@/lib/time';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './dashboard.module.css';
import { borneSignal, drawdownGauge, metricDrawdownLimit } from './drawdownLimit';
import { EquityCard } from './EquityChart';
import type { MetricRange } from './range';
import type { Session, Trade } from '@/engine/types';

/** La borne de K.04 se pose aux cinq sixièmes de la piste : la zone au-delà reste visible, hachurée. */
const BORNE_SPAN = 1.2;

function shortDay(date: string): string {
  if (date.length < 10) return '';
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

function weekday(date: string): string {
  return dateTimeFormatter({ weekday: 'short' }).format(parseDateKey(date)).replace('.', '').toUpperCase();
}

/** Jauge K avec la règle graduée de la planche sous sa piste : un appui tous les 25 %, un trait tous les 5 %. */
function Gauge(props: ComponentProps<typeof Jauge>) {
  return (
    <div className={s.gauge}>
      <Jauge {...props} />
      <i className={s.ruler} data-ruler="" aria-hidden />
    </div>
  );
}

function rangeTitle(range: MetricRange): string {
  if (range === '7j') return tr('7 JOURS', '7 DAYS', '7 DÍAS');
  if (range === '90j') return tr('90 JOURS', '90 DAYS', '90 DÍAS');
  if (range === 'tout') return tr('TOUT', 'ALL', 'TODO');
  return tr('30 JOURS', '30 DAYS', '30 DÍAS');
}

export function Dashboard({
  sessions,
  trades,
  range,
  period,
  history,
  journalEmpty,
  onImport,
  onDemo,
  onSessions,
}: {
  sessions: Session[];
  trades: Trade[];
  range: MetricRange;
  /** Bornes de la période affichée : la base des ratios annualisés. `from` nul : depuis la première séance. */
  period: { from: string | null; to: string };
  /** Tout l'historique du compte filtré : le plancher d'un plan n'en dépend pas de la période. */
  history: { sessions: Session[]; trades: Trade[] };
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
  const stabilityWindow = useSettings((st) => st.settings.stabilityWindow);
  const stats = useMemo(() => computeTradeStats(trades), [trades]);
  // Ce que lit la plaque A.02 : les statistiques de cette page, pas un second calcul.
  const plateStats = useMemo(() => ({ trades: stats.count, winRate: stats.winRate, profitFactor: stats.profitFactor }), [stats]);
  const daily = useMemo(() => computeDailyStats(sessions, startingBalance, stabilityWindow, { from: period.from ?? undefined, to: period.to }), [sessions, startingBalance, period.from, period.to, stabilityWindow]);
  const dailyPnls = useMemo(() => dailyResultSeries(sessions), [sessions]);
  const band = useMemo(() => rollingBands(dailyPnls, stabilityWindow).at(-1) ?? null, [dailyPnls]);
  const shift = useMemo(() => cusum(dailyPnls), [dailyPnls]);
  const winAcf = useMemo(() => autocorrelations(sessionWinRateSeries(sessions, trades)), [sessions, trades]);
  const pnlAcf = useMemo(() => autocorrelations(dailyPnls), [dailyPnls]);
  const limit = metricDrawdownLimit({ selected: metricAccount, planId, planAccount });
  const trackedPlan = limit != null ? (findPlan(planId) ?? null) : null;
  const allocated = useMemo(
    () => (trackedPlan ? allocatedRiskStats(sessions, trackedPlan.maxDrawdown, { from: period.from ?? undefined, to: period.to }) : null),
    [trackedPlan, sessions, period.from, period.to],
  );
  const ratioCi = useMemo(() => ratioIntervals(sessions, startingBalance, { from: period.from ?? undefined, to: period.to }), [sessions, startingBalance, period.from, period.to]);
  const gauge = useMemo(
    () => drawdownGauge({ plan: limit != null ? (findPlan(planId) ?? null) : null, account: metricAccount, history, maxDrawdown: daily.maxDrawdown, startingBalance }),
    [limit, planId, metricAccount, history, daily.maxDrawdown, startingBalance],
  );
  // K.04 : la borne est le drawdown maximal du plan suivi ; la jauge mesure ce qui en est consommé, la zone au-delà est hachurée.
  const borne = gauge.limit != null && gauge.limit > 0 ? gauge.limit : null;
  const consumed = gauge.kind === 'plan' ? Math.max(0, gauge.limit - gauge.margin) : gauge.maxDrawdown;
  const borneUsed = borne != null ? consumed / borne : 0;
  const borneLevel = borneSignal(gauge);
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
  const instrumentPoints = useMemo(() => {
    const map = new Map<string, ReturnType<typeof aggregatePoints>>();
    const groups = new Map<string, Trade[]>();
    for (const trade of trades) {
      if (!Number.isFinite(trade.pnl)) continue;
      const list = groups.get(trade.instrument);
      if (list) list.push(trade);
      else groups.set(trade.instrument, [trade]);
    }
    for (const [key, list] of groups) map.set(key, aggregatePoints(list));
    return map;
  }, [trades]);
  const best = ordered.reduce<Session | null>((win, row) => (!win || row.pnl > win.pnl ? row : win), null);
  const names = [...new Set(ordered.flatMap((row) => row.instruments))].slice(0, 3);
  const winSessions = ordered.filter((row) => row.pnl > 0).length;
  const winPart = Math.abs(stats.avgWin);
  const lossPart = Math.abs(stats.avgLoss);
  const split = winPart + lossPart || 1;
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
        <div className={s.tile} data-k="K.01">
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
        <div className={s.tile} data-k="K.02">
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
          <Gauge
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
        <div className={s.tile} data-k="K.03">
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.03 </span>
              <span className={s.kName}>{tr('Profit factor', 'Profit factor', 'Profit factor')}</span>
            </span>
            <span className={s.hint}>{tr('APRÈS FRAIS', 'AFTER FEES', 'TRAS COMISIONES')}</span>
          </div>
          <span className={s.kValue}>{Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2).replace('.', ',') : '∞'}</span>
          <span className={s.hint}>
            {tr('AVANT FRAIS', 'BEFORE FEES', 'ANTES DE COMISIONES')} {Number.isFinite(stats.profitFactorBeforeFees) ? stats.profitFactorBeforeFees.toFixed(2).replace('.', ',') : '∞'}
          </span>
          <Gauge
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
        <div className={s.tile} data-k="K.04">
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.04 </span>
              <span className={s.kName}>{gauge.kind === 'plan' ? tr('Marge au plancher', 'Margin to floor', 'Margen al suelo') : tr('Drawdown max', 'Max drawdown', 'Drawdown máx.')}</span>
            </span>
            {gauge.limit != null ? (
              <span className={s.hint}>
                / <Montant value={gauge.limit} />
              </span>
            ) : null}
          </div>
          {gauge.kind === 'plan' ? <Montant className={`${s.kValue} ${gauge.margin < gauge.limit * 0.25 ? s.neg : ''}`} value={gauge.margin} /> : <Montant className={`${s.kValue} ${s.neg}`} value={-gauge.maxDrawdown} />}
          <div>
            {borne != null ? (
              <Gauge
                min={0}
                max={borne * BORNE_SPAN}
                value={consumed}
                marker={borne}
                markerColor="var(--text-0)"
                hatchFrom={borne}
                ticks={[
                  { value: 0, label: '0' },
                  { value: borne, label: `${tr('PLANCHER', 'FLOOR', 'SUELO')} −${fmtInt(borne)}` },
                ]}
              />
            ) : (
              <Gauge min={0} max={100} value={gauge.used * 100} ticks={[{ value: 0, label: '0' }, { value: 100, label: '100 %' }]} />
            )}
            {gauge.kind === 'plan' ? (
              <div className={s.pair}>
                <span className={s.hint}>
                  {tr('PLANCHER', 'FLOOR', 'SUELO')} {fmtInt(gauge.floor)} · {tr('PLUS-HAUT', 'HIGH', 'MÁXIMO')} {fmtInt(gauge.highWater)}
                </span>
                <span className={s.hint}>
                  {tr('PLUS-BAS DERNIÈRE SÉANCE', 'LAST SESSION LOW', 'MÍNIMO ÚLTIMA SESIÓN')} {fmtInt(gauge.lastLow)}
                  {gauge.status === 'objectif'
                    ? ` · ${tr('OBJECTIF ATTEINT LE', 'TARGET REACHED ON', 'OBJETIVO ALCANZADO EL')} ${shortDay(gauge.date)}`
                    : gauge.status === 'echec'
                      ? ` · ${tr('COMPTE INVALIDÉ LE', 'ACCOUNT FAILED ON', 'CUENTA INVALIDADA EL')} ${shortDay(gauge.date)}`
                      : ''}
                </span>
              </div>
            ) : (
              <div className={s.pair}>
                <span className={s.hint}>
                  {gauge.limit != null && gauge.limit > 0 ? `${fmtPct(gauge.maxDrawdown / gauge.limit, 1)} ${tr('DE LA LIMITE', 'OF THE LIMIT', 'DEL LÍMITE')} · ` : ''}
                  {tr('SUR CLÔTURES, PÉRIODE AFFICHÉE', 'ON CLOSES, SHOWN RANGE', 'EN CIERRES, PERÍODO MOSTRADO')}
                </span>
                <span className={s.hint}>{plural(daily.maxDrawdownDays, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))}</span>
              </div>
            )}
            {borneLevel === 3 ? (
              <Signal level={3} className={s.kSignal}>
                {tr('Borne franchie', 'Limit crossed', 'Límite superado')}
                {gauge.kind === 'plan' && gauge.status === 'echec' ? ` · ${shortDay(gauge.date)}` : ''}
              </Signal>
            ) : borneLevel === 2 ? (
              <Signal level={2} className={s.kSignal}>
                <b>{fmtPct(borneUsed, 0)}</b> {tr('de la borne consommée', 'of the limit used', 'del límite consumido')}
              </Signal>
            ) : null}
          </div>
        </div>
      </section>

      <EquityCard className={s.span8} sessions={ordered} trades={trades} floor={limit} stats={plateStats} />

      <section className={`${s.card} ${s.pad} ${s.span4}`}>
        <div className={s.cardHead}>
          <span>
            <span className={s.code}>A.03 </span>
            <span className={s.kName}>{tr('Par instrument', 'By instrument', 'Por instrumento')}</span>
          </span>
          <span className={s.hint}>{tr('NET · POINTS', 'NET · POINTS', 'NETO · PUNTOS')}</span>
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
                {' · '}
                {fmtPoints(instrumentPoints.get(row.key)?.points)}
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

      <details className={`${s.card} ${s.span12} ${s.ratios}`}>
        <summary className={s.cardHead}>
          <span>
            <span className={s.code}>A.05 </span>
            <span className={s.kName}>{tr('Ratios annualisés', 'Annualized ratios', 'Ratios anualizados')}</span>
          </span>
          <span className={s.hint}>SHARPE · SORTINO · CALMAR · IC 90 %</span>
        </summary>
        <div className={s.ratioRow}>
          <span>
            <span className={s.hint}>Sharpe</span>
            <span className={s.ratioValue}>{fmtRatio(daily.sharpe)}</span>
            <span className={s.hint}>{fmtRatio(ratioCi.sharpe.low)} – {fmtRatio(ratioCi.sharpe.high)}</span>
          </span>
          <span>
            <span className={s.hint}>Sortino</span>
            <span className={s.ratioValue}>{fmtRatio(daily.sortino)}</span>
            <span className={s.hint}>{fmtRatio(ratioCi.sortino.low)} – {fmtRatio(ratioCi.sortino.high)}</span>
          </span>
          <span>
            <span className={s.hint}>Calmar</span>
            <span className={s.ratioValue}>{fmtRatio(daily.calmar)}</span>
            <span className={s.hint}>{fmtRatio(ratioCi.calmar.low)} – {fmtRatio(ratioCi.calmar.high)}</span>
          </span>
          <span>
            <span className={s.hint}>SQN</span>
            <span className={s.ratioValue}>{fmtRatio(stats.sqn)}</span>
          </span>
          <span>
            <span className={s.hint}>Kelly</span>
            <span className={s.ratioValue}>{fmtPct(stats.kelly, 1)}</span>
          </span>
          <p className={s.hint}>
            {tr(
              `rf = 0 · √252 · ${plural(daily.tradingDays, 'journée de cotation', 'journées de cotation')} sur la période, jours sans séance comptés à zéro`,
              `rf = 0 · √252 · ${plural(daily.tradingDays, 'trading day', 'trading days')} in the range, days without a session counted as zero`,
              `rf = 0 · √252 · ${plural(daily.tradingDays, 'jornada de cotización', 'jornadas de cotización')} en el período, días sin sesión contados en cero`,
            )}
          </p>
          {allocated && trackedPlan ? (
            <p className={s.hint}>
              {tr(
                `Rapportés à la perte maximale du plan (${fmtInt(trackedPlan.maxDrawdown)} $), pas au capital nominal · repli ${fmtPct(allocated.maxDrawdownPct, 1)} · Calmar ${fmtRatio(allocated.calmar)} · Ulcer ${fmtRatio(allocated.ulcerIndex, 4)}`,
                `Relative to the plan’s maximum loss (${fmtInt(trackedPlan.maxDrawdown)} $), not the nominal capital · drawdown ${fmtPct(allocated.maxDrawdownPct, 1)} · Calmar ${fmtRatio(allocated.calmar)} · Ulcer ${fmtRatio(allocated.ulcerIndex, 4)}`,
                `Respecto de la pérdida máxima del plan (${fmtInt(trackedPlan.maxDrawdown)} $), no del capital nominal · retroceso ${fmtPct(allocated.maxDrawdownPct, 1)} · Calmar ${fmtRatio(allocated.calmar)} · Ulcer ${fmtRatio(allocated.ulcerIndex, 4)}`,
              )}
            </p>
          ) : null}
        </div>
      </details>

      <section className={`${s.card} ${s.pad} ${s.span12}`}>
        <div className={s.cardHead}>
          <span className={s.kName}>{tr('Suivi de stabilité', 'Stability tracking', 'Seguimiento de estabilidad')}</span>
          <span className={s.hint}>{plural(stabilityWindow, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))}</span>
        </div>
        <p className={s.hint}>
          {band
            ? tr(
                `Espérance de la fenêtre ${fmtUsd(band.mean, { sign: true, cents: true })} · bande ${fmtUsd(band.low, { sign: true, cents: true })} – ${fmtUsd(band.high, { sign: true, cents: true })}`,
                `Window expectancy ${fmtUsd(band.mean, { sign: true, cents: true })} · band ${fmtUsd(band.low, { sign: true, cents: true })} – ${fmtUsd(band.high, { sign: true, cents: true })}`,
                `Esperanza de la ventana ${fmtUsd(band.mean, { sign: true, cents: true })} · banda ${fmtUsd(band.low, { sign: true, cents: true })} – ${fmtUsd(band.high, { sign: true, cents: true })}`,
              )
            : '—'}
        </p>
        <p className={s.hint}>
          {shift.alert
            ? tr(
                `Alerte CUSUM${shift.crossedAt != null && daily.rolling[shift.crossedAt] ? ` · ${daily.rolling[shift.crossedAt]!.date}` : ''}`,
                `CUSUM alert${shift.crossedAt != null && daily.rolling[shift.crossedAt] ? ` · ${daily.rolling[shift.crossedAt]!.date}` : ''}`,
                `Alerta CUSUM${shift.crossedAt != null && daily.rolling[shift.crossedAt] ? ` · ${daily.rolling[shift.crossedAt]!.date}` : ''}`,
              )
            : tr('CUSUM dans les bornes (k = 0,5 σ, h = 5 σ)', 'CUSUM inside the limits (k = 0.5 σ, h = 5 σ)', 'CUSUM dentro de los límites (k = 0,5 σ, h = 5 σ)')}
        </p>
        <p className={s.hint}>
          {tr('Taux de réussite', 'Win rate', 'Tasa de acierto')}{' '}
          {winAcf.map((row) => `${row.lag}:${fmtRatio(row.rho)}${row.outside ? '*' : ''}`).join(' · ')}
          {winAcf[0] ? ` · ±${fmtRatio(winAcf[0].band)}` : ''}
        </p>
        <p className={s.hint}>
          {tr('Résultat journalier', 'Daily result', 'Resultado diario')}{' '}
          {pnlAcf.map((row) => `${row.lag}:${fmtRatio(row.rho)}${row.outside ? '*' : ''}`).join(' · ')}
          {pnlAcf[0] ? ` · ±${fmtRatio(pnlAcf[0].band)}` : ''}
        </p>
      </section>
    </div>
  );
}
