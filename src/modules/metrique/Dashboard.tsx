import { useMemo } from 'react';
import { Button, Empty, Etiquette, Jauge, Lecteur, Montant, PlaqueVissee } from '@/design/primitives';
import { computeDailyStats, computeTradeStats } from '@/engine/metrics';
import { tr, useI18n } from '@/i18n';
import { breakevenWinRate } from '@/lib/breakeven';
import { fmtInt, fmtPct, fmtRatio, plural } from '@/lib/format';
import { dateTimeFormatter, parseDateKey } from '@/lib/time';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './dashboard.module.css';
import { metricDrawdownLimit } from './drawdownLimit';
import { EquityCard } from './EquityChart';
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

export function Dashboard({
  sessions,
  trades,
  range,
  period,
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
  const daily = useMemo(() => computeDailyStats(sessions, startingBalance, 20, { from: period.from ?? undefined, to: period.to }), [sessions, startingBalance, period.from, period.to]);
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
            <span className={s.hint}>{tr('APRÈS FRAIS', 'AFTER FEES', 'TRAS COMISIONES')}</span>
          </div>
          <span className={s.kValue}>{Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2).replace('.', ',') : '∞'}</span>
          <span className={s.hint}>
            {tr('AVANT FRAIS', 'BEFORE FEES', 'ANTES DE COMISIONES')} {Number.isFinite(stats.profitFactorBeforeFees) ? stats.profitFactorBeforeFees.toFixed(2).replace('.', ',') : '∞'}
          </span>
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

      <EquityCard className={s.span8} sessions={ordered} trades={trades} />

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

      <details className={`${s.card} ${s.span12} ${s.ratios}`}>
        <summary className={s.cardHead}>
          <span>
            <span className={s.code}>A.05 </span>
            <span className={s.kName}>{tr('Ratios annualisés', 'Annualized ratios', 'Ratios anualizados')}</span>
          </span>
          <span className={s.hint}>SHARPE · SORTINO · CALMAR</span>
        </summary>
        <div className={s.ratioRow}>
          <span>
            <span className={s.hint}>Sharpe</span>
            <span className={s.ratioValue}>{fmtRatio(daily.sharpe)}</span>
          </span>
          <span>
            <span className={s.hint}>Sortino</span>
            <span className={s.ratioValue}>{fmtRatio(daily.sortino)}</span>
          </span>
          <span>
            <span className={s.hint}>Calmar</span>
            <span className={s.ratioValue}>{fmtRatio(daily.calmar)}</span>
          </span>
          <p className={s.hint}>
            {tr(
              `rf = 0 · √252 · ${plural(daily.tradingDays, 'journée de cotation', 'journées de cotation')} sur la période, jours sans séance comptés à zéro`,
              `rf = 0 · √252 · ${plural(daily.tradingDays, 'trading day', 'trading days')} in the range, days without a session counted as zero`,
              `rf = 0 · √252 · ${plural(daily.tradingDays, 'jornada de cotización', 'jornadas de cotización')} en el período, días sin sesión contados en cero`,
            )}
          </p>
        </div>
      </details>
    </div>
  );
}
