import { useMemo } from 'react';
import { Barcode, Button, Empty, Etiquette, Jauge, Lecteur, Montant, PlaqueVissee, Regle } from '@/design/primitives';
import { findPlan } from '@/engine/propfirm';
import type { Bilan, BilanPreset } from '@/engine/portfolio/bilan';
import type { Exposure } from '@/engine/portfolio/exposure';
import { convertAmount } from '@/engine/portfolio/fx';
import { PROP_DRAWDOWN_ALERT } from '@/engine/portfolio/risk';
import { LEVERAGE_WARN, type BridgeSnapshot, type Coeur, type EquityPoint, type FxRate, type Pocket, type PocketKind, type PocketValuation } from '@/engine/portfolio/types';
import { Projection } from './Projection';
import { tr, useI18n } from '@/i18n';
import { fmtInt, fmtPct } from '@/lib/format';
import { ET_ZONE, etDateKey } from '@/lib/time';
import s from './synthese.module.css';

const SWATCH = ['var(--mint)', 'var(--text-0)', 'var(--text-1)', 'var(--ember)', 'var(--gold)'];

function kindLabel(kind: PocketKind): string {
  const map: Record<PocketKind, [string, string, string]> = {
    propfirm: ['Prop firm', 'Prop firm', 'Prop firm'],
    futures: ['Futures', 'Futures', 'Futuros'],
    actions: ['Actions', 'Equities', 'Acciones'],
    indices: ['Indices', 'Indices', 'Índices'],
    forex: ['Forex', 'Forex', 'Forex'],
    commodites: ['Commodités', 'Commodities', 'Materias primas'],
    cfd: ['CFD', 'CFD', 'CFD'],
    liquidites: ['Liquidités', 'Cash', 'Liquidez'],
    crypto: ['Crypto', 'Crypto', 'Cripto'],
  };
  const row = map[kind];
  return tr(row[0], row[1], row[2]);
}

function presetTitle(preset: BilanPreset): string {
  if (preset === '7j') return tr('7 jours', '7 days', '7 días');
  if (preset === 'trimestre') return tr('le trimestre', 'the quarter', 'el trimestre');
  if (preset === 'annee') return tr('l’année', 'the year', 'el año');
  if (preset === 'personnalisee') return tr('la période', 'the range', 'el período');
  return tr('30 jours', '30 days', '30 días');
}

/** Pire drawdown et drawdown courant sur la fenêtre du bilan. */
export function windowDrawdown(series: readonly { date: string; equity: number }[], from: string, to: string): { current: number; worst: number } {
  const slice = series.filter((point) => point.date >= from && point.date <= to);
  const first = slice[0];
  if (!first) return { current: 0, worst: 0 };
  let peak = first.equity;
  let worst = 0;
  let current = 0;
  for (const point of slice) {
    if (point.equity > peak) peak = point.equity;
    const dd = Math.max(0, peak - point.equity);
    if (dd > worst) worst = dd;
    current = dd;
  }
  return { current, worst };
}

function sourceTag(pocket: Pocket, valuation: PocketValuation, snapshots: readonly BridgeSnapshot[], now: number): string {
  if (valuation.mark === 'pont') {
    const snap = snapshots.find((row) => row.account === (pocket.account ?? ''));
    if (snap) return `PONT · ${Math.max(0, Math.round((now - snap.at) / 1000))} S`;
    return 'PONT';
  }
  if (valuation.mark === 'journal') return 'JOURNAL';
  if (valuation.mark === 'saisi') return 'SAISIE';
  return 'PRIX';
}

export function Synthese({
  discrete,
  base,
  now,
  preset,
  coeur,
  valuations,
  pockets,
  points,
  fx,
  snapshots,
  expo,
  report,
  report30,
  series,
  currentDrawdown,
  sample,
  money,
  ruinValue,
  ruinSource,
  windowDays,
  onWindowDays,
  onExportCsv,
  customFrom,
  customTo,
  onCustom,
  onCreate,
}: {
  discrete: boolean;
  base: string;
  now: number;
  preset: BilanPreset;
  coeur: Coeur;
  valuations: PocketValuation[];
  pockets: Pocket[];
  points: EquityPoint[];
  fx: readonly FxRate[];
  snapshots: readonly BridgeSnapshot[];
  expo: Exposure;
  report: Bilan;
  report30: Bilan;
  series: readonly { date: string; equity: number; pnl: number }[];
  currentDrawdown: number;
  sample: number[];
  money: (amount: number | null | undefined, currency: string, sign?: boolean) => string;
  ruinValue: number;
  ruinSource: 'prop' | 'historique';
  windowDays: number;
  onWindowDays: (n: number) => void;
  onExportCsv: () => void;
  customFrom: string;
  customTo: string;
  onCustom: (from: string, to: string) => void;
  onCreate?: () => void;
}) {
  useI18n((st) => st.locale);
  const today = etDateKey(now);
  const clock = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ET_ZONE }).format(now);
  const stamp = `${today.slice(8, 10)}.${today.slice(5, 7)} · ${clock} ET · ${base}`;
  const dayPoint = series.find((point) => point.date === today);
  const dayPnl = dayPoint?.pnl ?? 0;
  const dayFlat = Math.abs(dayPnl) < 0.005;
  const prev = dayPoint ? dayPoint.equity - dayPoint.pnl : coeur.netValue;
  const dayPct = prev > 0 ? dayPnl / prev : 0;
  const included = valuations.filter((row) => row.equityBase != null && row.equityBase > 0);
  const allocTotal = included.reduce((sum, row) => sum + (row.equityBase ?? 0), 0) || 1;
  const days30 = useMemo(() => series.filter((point) => point.date >= report30.from && point.date <= report30.to), [series, report30.from, report30.to]);
  const period = windowDrawdown(series, report.from, report.to);
  const peak = useMemo(() => {
    const slice = series.filter((point) => point.date >= report.from && point.date <= report.to);
    return slice.reduce((max, point) => Math.max(max, point.equity), coeur.netValue || 0);
  }, [series, report.from, report.to, coeur.netValue]);
  const currentPct = peak > 0 ? currentDrawdown / peak : 0;
  const drawdownFlat = Math.round(currentPct * 1000) / 10 <= 0;
  const worstPct = peak > 0 ? period.worst / peak : 0;
  const gaugeMax = Math.max(5, currentPct * 100, worstPct * 100);
  const alerts = valuations.filter((row) => row.kind === 'propfirm' && row.prop?.alert);
  const props = valuations.filter((row) => row.kind === 'propfirm' && row.prop);
  const leverage = expo.grossLeverage ?? 0;
  const pocketName = (id: string) => pockets.find((row) => row.id === id)?.name ?? id;
  const top = expo.byInstrument[0];

  return (
    <div className={s.grid}>
      <span className={`canto-plus ${s.plusL}`} aria-hidden>
        +
      </span>
      <span className={`canto-plus ${s.plusR}`} aria-hidden>
        +
      </span>
      <PlaqueVissee className={s.span7}>
        <div className={s.plate}>
          <div className={s.plateLabel}>
            <span className={s.code}>B.01 / {tr('VALEUR NETTE CONSOLIDÉE', 'CONSOLIDATED NET VALUE', 'VALOR NETO CONSOLIDADO')}</span>
            <span className={s.hint}>
              {tr('AU', 'AS OF', 'AL')} {stamp}
            </span>
          </div>
          <Lecteur value={coeur.netValue} discrete={discrete} />
          <div className={s.dayRow}>
            <span className={s.hint}>{tr('AUJOURD’HUI', 'TODAY', 'HOY')}</span>
            <Montant value={dayFlat ? 0 : dayPnl} discrete={discrete} className={dayFlat ? undefined : dayPnl < 0 ? s.neg : s.pos} />
            <span className={dayFlat ? undefined : dayPnl < 0 ? s.neg : s.pos}>{dayFlat ? '·' : dayPnl > 0 ? '▲' : '▼'} {discrete ? '•••••' : fmtPct(dayFlat ? 0 : Math.abs(dayPct), 2)}</span>
          </div>
          <div className={s.alloc} aria-hidden>
            {included.map((row, index) => (
              <i key={row.pocketId} style={{ width: `${((row.equityBase ?? 0) / allocTotal) * 100}%`, background: SWATCH[index % SWATCH.length] }} />
            ))}
          </div>
          <div className={s.legend}>
            {included.map((row, index) => (
              <span key={row.pocketId}>
                <i style={{ background: SWATCH[index % SWATCH.length] }} />
                {pocketName(row.pocketId)}
                <b>{discrete ? '••' : fmtPct((row.equityBase ?? 0) / allocTotal, 1)}</b>
              </span>
            ))}
          </div>
        </div>
      </PlaqueVissee>

      <section className={`${s.card} ${s.kpis} ${s.span5}`}>
        <div className={s.tile}>
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.01 </span>
              <span className={s.kName}>{tr('P&L 30 jours', '30-day P&L', 'P&L 30 días')}</span>
            </span>
            <span className={s.hint}>
              {fmtInt(report30.winningDays)} / {fmtInt(report30.winningDays + report30.losingDays)} J
            </span>
          </div>
          <Montant value={report30.totalPnl} discrete={discrete} className={s.kValue} />
          <div className={s.squares} aria-hidden>
            {days30.map((point) => (
              <i key={point.date} className={`${s.sq} ${point.pnl > 0 ? s.win : point.pnl < 0 ? s.loss : ''}`} />
            ))}
          </div>
        </div>
        <div className={s.tile}>
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.02 </span>
              <span className={s.kName}>{tr('Levier brut', 'Gross leverage', 'Apalancamiento bruto')}</span>
            </span>
            <span className={s.hint}>{discrete ? '•••••' : `${fmtInt(expo.totalNotional)} NOT.`}</span>
          </div>
          <span className={s.kValue}>{discrete ? '•••••' : `${leverage.toFixed(2).replace('.', ',')}×`}</span>
          <Jauge
            min={0}
            max={5}
            value={leverage}
            marker={LEVERAGE_WARN}
            markerColor="var(--gold)"
            hatchFrom={LEVERAGE_WARN}
            ticks={[
              { value: 0, label: '0×' },
              { value: LEVERAGE_WARN, label: `${LEVERAGE_WARN}×`, color: 'var(--gold)' },
              { value: 5, label: '5×' },
            ]}
          />
        </div>
        <div className={s.tile}>
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.03 </span>
              <span className={s.kName}>{tr('Drawdown courant', 'Current drawdown', 'Drawdown actual')}</span>
            </span>
          </div>
          <span className={`${s.kValue} ${drawdownFlat ? '' : s.neg}`}>{discrete ? '•••••' : drawdownFlat ? fmtPct(0, 1) : `−${fmtPct(currentPct, 1).replace('−', '').replace('-', '')}`}</span>
          <Jauge
            min={0}
            max={gaugeMax}
            value={currentPct * 100}
            marker={period.worst > 0 ? worstPct * 100 : null}
            markerColor="var(--neg)"
            ticks={[
              { value: 0, label: '0' },
              ...(period.worst > 0 ? [{ value: worstPct * 100, label: `−${(worstPct * 100).toFixed(1).replace('.', ',')}`, color: 'var(--neg)' }] : []),
              { value: gaugeMax, label: `−${gaugeMax.toFixed(0)} %` },
            ]}
          />
        </div>
        <div className={s.tile}>
          <div className={s.kHead}>
            <span>
              <span className={s.code}>K.04 </span>
              <span className={s.kName}>{tr('Seuils prop', 'Prop thresholds', 'Umbrales prop')}</span>
            </span>
            <span className={s.hint}>
              {tr('SEUIL', 'THRESHOLD', 'UMBRAL')} {fmtInt(PROP_DRAWDOWN_ALERT * 100)} %
            </span>
          </div>
          {alerts.length > 0 ? (
            <span className={s.alert}>
              <i />
              {fmtInt(alerts.length)} {alerts.length > 1 ? tr('alertes', 'alerts', 'alertas') : tr('alerte', 'alert', 'alerta')}
            </span>
          ) : (
            <span className={s.kName}>{tr('Aucune alerte', 'No alert', 'Ninguna alerta')}</span>
          )}
          <div className={s.minis}>
            {props.map((row) => {
              const pocket = pockets.find((item) => item.id === row.pocketId);
              const plan = pocket?.planId ? findPlan(pocket.planId) : undefined;
              const left = row.prop && plan && plan.maxDrawdown > 0 ? row.prop.toDrawdown / plan.maxDrawdown : 0;
              return (
                <div key={row.pocketId}>
                  <span className={s.hint}>{pocketName(row.pocketId)}</span>
                  <div className={s.mini}>
                    <i style={{ width: `${Math.max(0, Math.min(1, left)) * 100}%` }} />
                  </div>
                  <span className={s.hint}>{discrete ? '••' : fmtPct(left, 1)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className={`${s.card} ${s.span8}`}>
        <div className={s.head}>
          <span>
            <span className={s.code}>B.02 </span>
            <span className={s.kName}>{tr('Poches', 'Pockets', 'Bolsas')}</span>
          </span>
          <span className={s.hint}>{tr('VALORISÉES EN', 'VALUED IN', 'VALORADAS EN')} {base}</span>
        </div>
        <table className={s.table}>
          <thead>
            <tr>
              <th>{tr('Poche', 'Pocket', 'Bolsa')}</th>
              <th>{tr('Type', 'Type', 'Tipo')}</th>
              <th>{tr('Valeur', 'Value', 'Valor')}</th>
              <th>{tr('Jour', 'Day', 'Día')}</th>
              <th>{tr('Marge au seuil', 'Buffer to threshold', 'Margen al umbral')}</th>
              <th>{tr('Source', 'Source', 'Fuente')}</th>
            </tr>
          </thead>
          <tbody>
            {valuations.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty
                    title={tr('Aucune poche', 'No pocket', 'Ninguna bolsa')}
                    text={tr('La synthèse se remplit dès qu’une poche a une valeur.', 'The synthesis fills in once a pocket has a value.', 'La síntesis se completa cuando una bolsa tiene un valor.')}
                    action={
                      onCreate ? (
                        <Button variant="chamfer" onClick={onCreate}>
                          {tr('Nouvelle poche', 'New pocket', 'Nueva bolsa')}
                        </Button>
                      ) : null
                    }
                  />
                </td>
              </tr>
            ) : null}
            {valuations.map((row) => {
              const pocket = pockets.find((item) => item.id === row.pocketId);
              if (!pocket) return null;
              const plan = pocket.planId ? findPlan(pocket.planId) : undefined;
              const day = points.find((point) => point.pocketId === pocket.id && point.date === today);
              const converted = day ? convertAmount(day.pnl, day.currency, base, fx) : null;
              return (
                <tr key={row.pocketId}>
                  <td>
                    <span className={s.pocketName}>{pocket.name}</span>
                    <span className={s.hint}>{pocket.account || pocket.venue || pocket.currency}</span>
                  </td>
                  <td>{kindLabel(pocket.kind)}</td>
                  <td>{row.equityBase == null ? '—' : <Montant value={row.equityBase} discrete={discrete} />}</td>
                  <td>{converted?.ok ? <Montant value={converted.value} discrete={discrete} /> : '—'}</td>
                  <td className={s.hint}>
                    {row.prop && plan ? (
                      <>
                        {discrete ? '•••••' : fmtInt(row.prop.toDrawdown)} / {discrete ? '•••••' : fmtInt(plan.maxDrawdown)}
                      </>
                    ) : (
                      tr('— sans seuil', '— no threshold', '— sin umbral')
                    )}
                  </td>
                  <td>
                    <Etiquette>{sourceTag(pocket, row, snapshots, now)}</Etiquette>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className={`${s.card} ${s.pad} ${s.span4}`}>
        <div className={s.head}>
          <span>
            <span className={s.code}>B.03 </span>
            <span className={s.kName}>{tr('Exposition', 'Exposure', 'Exposición')}</span>
          </span>
          <span className={s.hint}>{tr('NOTIONNEL', 'NOTIONAL', 'NOCIONAL')} {base}</span>
        </div>
        {expo.byInstrument.length === 0 ? (
          <p className={s.note}>{tr('Aucune ligne ouverte.', 'No open line.', 'Ninguna línea abierta.')}</p>
        ) : (
          expo.byInstrument.slice(0, 6).map((row) => (
            <div key={row.key} className={s.line}>
              <span className={s.root}>{row.key}</span>
              <span className={s.hint}>{discrete ? '•••••' : fmtInt(row.notional)}</span>
              <span className={s.hint}>{expo.totalNotional > 0 ? fmtPct(row.notional / expo.totalNotional, 1) : '—'}</span>
              <div className={s.share}>
                <i style={{ width: `${expo.totalNotional > 0 ? (row.notional / expo.totalNotional) * 100 : 0}%` }} />
              </div>
            </div>
          ))
        )}
        {top && expo.totalNotional > 0 ? (
          <p className={s.note}>
            {tr('CONCENTRATION', 'CONCENTRATION', 'CONCENTRACIÓN')} {fmtPct(expo.concentration, 1)} {tr('SUR', 'ON', 'EN')} {top.key}
          </p>
        ) : null}
        {expo.notes.length > 0 ? <p className={s.note}>{expo.notes.map((row) => `${pocketName(row.pocketId)} · ${row.text}`).join(' — ')}</p> : null}
      </section>

      <section className={`${s.card} ${s.pad} ${s.span8}`}>
        <div className={s.head}>
          <span>
            <span className={s.code}>B.04 </span>
            <span className={s.kName}>{tr('Projection', 'Projection', 'Proyección')}</span>
          </span>
          <span className={s.hint}>{ruinSource === 'prop' ? tr('ruine = drawdowns prop restants', 'ruin = remaining prop drawdowns', 'ruina = drawdowns prop restantes') : tr('ruine = drawdown max historique', 'ruin = historical max drawdown', 'ruina = drawdown máximo histórico')}</span>
        </div>
        <Projection sample={sample} currency={base} discrete={discrete} money={money} ruinValue={ruinValue} ruinSource={ruinSource} windowDays={windowDays} onWindowDays={onWindowDays} />
      </section>

      <section className={`${s.card} ${s.pad} ${s.span4}`}>
        <div className={s.head}>
          <span>
            <span className={s.code}>B.05 </span>
            <span className={s.kName}>{tr('Bilan', 'Statement', 'Balance')} · {presetTitle(preset)}</span>
          </span>
          <button type="button" className={s.more} onClick={onExportCsv}>
            {tr('EXPORTER', 'EXPORT', 'EXPORTAR')} →
          </button>
        </div>
        {report.byPocket.map((row) => (
          <Regle key={row.pocketId} label={pocketName(row.pocketId)} value={discrete ? '•••••' : <Montant value={row.pnlBase} />} />
        ))}
        <Regle label={tr('Total', 'Total', 'Total')} value={discrete ? '•••••' : <Montant value={report.totalPnl} />} />
        <div className={s.bilanFoot}>
          <Barcode />
          <span className={s.hint}>
            {report.from} → {report.to}
          </span>
        </div>
        <div className={s.custom}>
          <input type="date" aria-label={tr('Du', 'From', 'Desde')} value={customFrom} onChange={(event) => onCustom(event.target.value, customTo)} />
          <input type="date" aria-label={tr('Au', 'To', 'Hasta')} value={customTo} onChange={(event) => onCustom(customFrom, event.target.value)} />
        </div>
      </section>
    </div>
  );
}
