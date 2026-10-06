import { useEffect, useMemo, useRef, useState } from 'react';
import { BaselineSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, HistogramSeries, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import { Montant, Segmented } from '@/design/primitives';
import { equityCurve, type EquityCurveData, type EquityGrain, type EquityStep } from '@/engine/equityCurve';
import type { Session, Trade } from '@/engine/types';
import { intlTag, tr, useI18n } from '@/i18n';
import { fmtInt } from '@/lib/format';
import { dateTimeFormatter } from '@/lib/time';
import { chartHostReady, safePaneHeight } from '@/modules/visual/chartBox';
import s from './dashboard.module.css';

/**
 * Métrique › A.02 : courbe d'équité, P&L par pas et drawdown sous l'eau.
 * Glisser déplace, Ctrl (⌘) + molette zoome, double-clic recadre : la molette seule fait défiler la page.
 */

const CHART_HEIGHT = 300;
const PNL_PANE = 58;
const DD_PANE = 64;

const DAY: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', timeZone: 'UTC' };
const DAY_LONG: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
const LOCAL_DAY: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' };
const LOCAL_LONG: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** Couleurs lues dans les jetons (`tokens.css`) : le canevas ne lit pas les variables CSS. */
function palette(el: HTMLElement) {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim() || 'gray';
  return {
    pos: v('--pos'),
    neg: v('--neg'),
    posSoft: v('--mint-soft'),
    negSoft: v('--ember-soft'),
    posLine: v('--mint-line'),
    negLine: v('--ember-line'),
    text0: v('--text-0'),
    text2: v('--text-2'),
    line1: v('--line-1'),
    line2: v('--line-2'),
    bg3: v('--bg-3'),
    mono: css.getPropertyValue('--font-mono').trim() || 'monospace',
  };
}

const signed = (value: number) => (Math.round(value) > 0 ? `+${fmtInt(value)}` : fmtInt(value));

function stepLabel(step: EquityStep, grain: EquityGrain): string {
  if (step.origin) return tr('DÉPART', 'START', 'INICIO');
  if (grain === 'trade' && step.at !== null && step.instrument) return `${dateTimeFormatter(LOCAL_LONG).format(new Date(step.at))} · ${step.instrument}`;
  return dateTimeFormatter(DAY_LONG).format(new Date(step.time * 1000));
}

interface Refs {
  chart: IChartApi;
  equity: ISeriesApi<'Baseline'>;
  peak: ISeriesApi<'Line'>;
  pnl: ISeriesApi<'Histogram'>;
  drawdown: ISeriesApi<'Baseline'>;
  markers: ISeriesMarkersPluginApi<Time>;
  colors: ReturnType<typeof palette>;
  /** Dernière courbe dessinée : un rendu sans changement ne redessine pas. */
  drawn: EquityCurveData | null;
}

function draw(refs: Refs, curve: EquityCurveData): void {
  const { colors } = refs;
  const ts = (step: EquityStep) => step.time as UTCTimestamp;
  refs.equity.setData(curve.steps.map((step) => ({ time: ts(step), value: step.equity })));
  refs.peak.setData(curve.steps.map((step) => ({ time: ts(step), value: step.peak })));
  refs.pnl.setData(curve.steps.map((step) => (step.origin ? { time: ts(step) } : { time: ts(step), value: step.pnl, color: step.pnl < 0 ? colors.negLine : colors.posLine })));
  refs.drawdown.setData(curve.steps.map((step) => ({ time: ts(step), value: step.drawdown })));
  const trough = curve.maxDrawdown ? curve.steps[curve.maxDrawdown.trough] : undefined;
  refs.markers.setMarkers(trough && curve.maxDrawdown ? [{ time: ts(trough), position: 'belowBar', shape: 'arrowUp', color: colors.neg, text: `−${fmtInt(curve.maxDrawdown.depth)}` }] : []);
  refs.chart.timeScale().fitContent();
  refs.drawn = curve;
}

export function EquityCard({ sessions, trades, className }: { sessions: Session[]; trades: Trade[]; className?: string }) {
  useI18n((st) => st.locale);
  const [grain, setGrain] = useState<EquityGrain>('session');
  const curve = useMemo(() => equityCurve(sessions, trades, grain), [sessions, trades, grain]);
  const [hover, setHover] = useState<number | null>(null);
  const [fault, setFault] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const refs = useRef<Refs | null>(null);
  const curveRef = useRef(curve);
  curveRef.current = curve;
  const grainRef = useRef(grain);
  grainRef.current = grain;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const boot = () => {
      if (disposed || refs.current) return;
      const width = Math.floor(el.clientWidth);
      const height = Math.floor(el.clientHeight);
      if (!chartHostReady(width, height)) return;
      try {
        const colors = palette(el);
        const chart = createChart(el, {
          autoSize: false,
          width,
          height,
          layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: colors.text2,
            fontFamily: colors.mono,
            fontSize: 10,
            panes: { separatorColor: colors.line1, separatorHoverColor: colors.line2, enableResize: false },
            attributionLogo: false,
          },
          grid: { vertLines: { visible: false }, horzLines: { color: colors.line1, style: LineStyle.Dotted } },
          crosshair: {
            mode: CrosshairMode.Magnet,
            vertLine: { color: colors.text2, labelBackgroundColor: colors.bg3, width: 1, style: LineStyle.Dotted },
            horzLine: { color: colors.text2, labelBackgroundColor: colors.bg3, width: 1, style: LineStyle.Dotted },
          },
          rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
          timeScale: {
            borderColor: colors.line1,
            rightOffset: 2,
            lockVisibleTimeRangeOnResize: true,
            tickMarkFormatter: (time: Time, tickType: number) => {
              const d = new Date((time as number) * 1000);
              if (grainRef.current === 'session') return dateTimeFormatter(DAY).format(d);
              return tickType >= 3 ? dateTimeFormatter(TIME).format(d) : dateTimeFormatter(LOCAL_DAY).format(d);
            },
          },
          localization: {
            locale: intlTag(),
            priceFormatter: signed,
            timeFormatter: (time: Time) => {
              const d = new Date((time as number) * 1000);
              return grainRef.current === 'session' ? dateTimeFormatter(DAY_LONG).format(d) : dateTimeFormatter(LOCAL_LONG).format(d);
            },
          },
          handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
          handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: false }, axisDoubleClickReset: true },
        });
        const equity = chart.addSeries(BaselineSeries, {
          baseValue: { type: 'price', price: 0 },
          topLineColor: colors.pos,
          topFillColor1: colors.posSoft,
          topFillColor2: colors.posSoft,
          bottomLineColor: colors.neg,
          bottomFillColor1: colors.negSoft,
          bottomFillColor2: colors.negSoft,
          lineWidth: 2,
          priceLineVisible: false,
          crosshairMarkerRadius: 3,
          priceFormat: { type: 'price', precision: 0, minMove: 1 },
        });
        const peak = chart.addSeries(LineSeries, { color: colors.text2, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 0, minMove: 1 } });
        const pnl = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'price', precision: 0, minMove: 1 } }, 1);
        const drawdown = chart.addSeries(
          BaselineSeries,
          {
            baseValue: { type: 'price', price: 0 },
            topLineColor: 'transparent',
            topFillColor1: 'transparent',
            topFillColor2: 'transparent',
            bottomLineColor: colors.neg,
            bottomFillColor1: colors.negSoft,
            bottomFillColor2: colors.negSoft,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            priceFormat: { type: 'price', precision: 0, minMove: 1 },
          },
          2,
        );
        const panes = chart.panes();
        const pnlHeight = safePaneHeight(PNL_PANE, height, panes.length);
        const ddHeight = safePaneHeight(DD_PANE, height, panes.length);
        if (pnlHeight) panes[1]?.setHeight(pnlHeight);
        if (ddHeight) panes[2]?.setHeight(ddHeight);
        const markers = createSeriesMarkers(equity, []);
        chart.subscribeCrosshairMove((param) => {
          if (param.time === undefined || !param.point) {
            setHover(null);
            return;
          }
          const index = curveRef.current.steps.findIndex((step) => step.time === (param.time as number));
          setHover(index >= 0 ? index : null);
        });
        refs.current = { chart, equity, peak, pnl, drawdown, markers, colors, drawn: null };
        draw(refs.current, curveRef.current);
      } catch {
        if (!disposed) setFault(true);
      }
    };
    const ro = new ResizeObserver(() => {
      const current = refs.current;
      if (!current) {
        boot();
        return;
      }
      const width = Math.floor(el.clientWidth);
      const height = Math.floor(el.clientHeight);
      if (chartHostReady(width, height)) current.chart.applyOptions({ width, height });
    });
    ro.observe(el);
    // Ctrl (⌘) + molette : zoom autour du pointeur. La molette seule reste au défilement de la page.
    const onWheel = (event: WheelEvent) => {
      const current = refs.current;
      if (!current || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const scale = current.chart.timeScale();
      const range = scale.getVisibleLogicalRange();
      if (!range) return;
      const span = range.to - range.from;
      const next = Math.min(Math.max(span * (event.deltaY > 0 ? 1.15 : 1 / 1.15), 4), Math.max(8, curveRef.current.steps.length * 1.2));
      const anchor = scale.coordinateToLogical(event.offsetX) ?? range.to;
      const ratio = span > 0 ? (anchor - range.from) / span : 1;
      scale.setVisibleLogicalRange({ from: anchor - next * ratio, to: anchor + next * (1 - ratio) });
    };
    const onDoubleClick = () => refs.current?.chart.timeScale().fitContent();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDoubleClick);
    boot();
    return () => {
      disposed = true;
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDoubleClick);
      refs.current?.chart.remove();
      refs.current = null;
    };
  }, []);

  useEffect(() => {
    setHover(null);
    if (refs.current && refs.current.drawn !== curve) draw(refs.current, curve);
  }, [curve]);

  const last = curve.steps.length - 1;
  const step = curve.steps[hover ?? last];
  return (
    <section className={`${s.card} ${s.pad} ${className ?? ''}`}>
      <div className={s.cardHead}>
        <span>
          <span className={s.code}>A.02 </span>
          <span className={s.kName}>{tr('Courbe d’équité', 'Equity curve', 'Curva de equidad')}</span>
        </span>
        <Segmented<EquityGrain>
          value={grain}
          onChange={setGrain}
          options={[
            { value: 'session', label: tr('Séance', 'Session', 'Sesión') },
            { value: 'trade', label: tr('Trade', 'Trade', 'Trade') },
          ]}
        />
      </div>
      {step ? (
        <div className={s.eqRead} aria-live="off">
          <span className={s.eqWhen}>{stepLabel(step, grain)}</span>
          <span className={s.eqCell}>
            <span className={s.hint}>{tr('Cumul', 'Cumulative', 'Acumulado')}</span>
            <Montant value={step.equity} className={step.equity < 0 ? s.neg : step.equity > 0 ? s.pos : undefined} />
          </span>
          <span className={s.eqCell}>
            <span className={s.hint}>{grain === 'session' ? tr('Séance', 'Session', 'Sesión') : tr('Trade', 'Trade', 'Trade')}</span>
            <Montant value={step.pnl} className={step.pnl < 0 ? s.neg : step.pnl > 0 ? s.pos : undefined} />
          </span>
          <span className={s.eqCell}>
            <span className={s.hint}>{tr('Sous le plus haut', 'Below the high', 'Bajo el máximo')}</span>
            <Montant value={step.drawdown} className={step.drawdown < 0 ? s.neg : undefined} />
          </span>
          <span className={s.eqCell}>
            <span className={s.hint}>{tr('Trades', 'Trades', 'Trades')}</span>
            <span>{fmtInt(step.trades)}</span>
          </span>
        </div>
      ) : null}
      {fault ? (
        <div className={s.eqFault}>{tr('Graphique indisponible.', 'Chart unavailable.', 'Gráfico no disponible.')}</div>
      ) : (
        <div ref={host} className={s.eqChart} style={{ height: CHART_HEIGHT }} role="img" aria-label={tr(`P&L cumulé ${signed(curve.net)} USD`, `Cumulative P&L ${signed(curve.net)} USD`, `P&L acumulado ${signed(curve.net)} USD`)} />
      )}
      <div className={s.eqLegend}>
        <span>
          <i className={s.eqKeyLine} /> {tr('Équité', 'Equity', 'Equidad')}
        </span>
        <span>
          <i className={s.eqKeyPeak} /> {tr('Plus haut', 'High', 'Máximo')}
        </span>
        <span>
          <i className={s.eqKeyBar} /> {tr('P&L par pas', 'P&L per step', 'P&L por paso')}
        </span>
        <span>
          <i className={s.eqKeyDd} /> {tr('Drawdown', 'Drawdown', 'Drawdown')}
          {curve.maxDrawdown ? ` max −${fmtInt(curve.maxDrawdown.depth)}` : ''}
        </span>
        <span className={s.eqHelp}>{tr('Ctrl + molette : zoom · double-clic : tout', 'Ctrl + wheel: zoom · double-click: all', 'Ctrl + rueda: zoom · doble clic: todo')}</span>
      </div>
    </section>
  );
}
