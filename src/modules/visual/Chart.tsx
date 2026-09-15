import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, HistogramSeries, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { Bar } from '@/engine/bars';
import type { IndicatorLine } from '@/engine/indicators';
import type { Trade } from '@/engine/types';
import s from './visual.module.css';

export interface HoverInfo {
  time: number;
  bar: Bar | null;
  values: { key: string; label: string; color: string; value: number | null }[];
}

interface Props {
  bars: Bar[];
  timeframe: number;
  lines: IndicatorLine[];
  trades: Trade[];
  onHover?: (info: HoverInfo | null) => void;
}

const LINE_STYLE: Record<NonNullable<IndicatorLine['lineStyle']>, LineStyle> = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted };

const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDateTime = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDay = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

function toTs(sec: number): UTCTimestamp {
  return sec as UTCTimestamp;
}

export function Chart({ bars, timeframe, lines, trades, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineRefs = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [ready, setReady] = useState(false);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const barsRef = useRef(bars);
  barsRef.current = bars;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b91a3',
        fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
        fontSize: 10,
        panes: { separatorColor: 'rgba(255,255,255,0.08)', separatorHoverColor: 'rgba(201,162,77,0.25)', enableResize: true },
        attributionLogo: false,
      },
      grid: { vertLines: { color: 'rgba(255,255,255,0.035)' }, horzLines: { color: 'rgba(255,255,255,0.035)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(201,162,77,0.5)', labelBackgroundColor: '#1a1f2b', width: 1, style: LineStyle.Dashed }, horzLine: { color: 'rgba(201,162,77,0.5)', labelBackgroundColor: '#1a1f2b', width: 1, style: LineStyle.Dashed } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.10)', scaleMargins: { top: 0.06, bottom: 0.05 } },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.10)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 7,
        tickMarkFormatter: (time: Time, tickType: number) => {
          const d = new Date((time as number) * 1000);
          return tickType >= 3 ? fmtTime.format(d) : fmtDay.format(d);
        },
      },
      localization: {
        locale: 'fr-FR',
        timeFormatter: (time: Time) => fmtDateTime.format(new Date((time as number) * 1000)),
        priceFormatter: (p: number) => p.toFixed(2),
      },
      handleScroll: { vertTouchDrag: false },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#3ddc97',
      downColor: '#ff3b4e',
      borderUpColor: '#3ddc97',
      borderDownColor: '#ff3b4e',
      wickUpColor: 'rgba(61,220,151,0.8)',
      wickDownColor: 'rgba(255,59,78,0.8)',
      priceLineColor: 'rgba(201,162,77,0.8)',
      priceLineStyle: LineStyle.Dotted,
      priceFormat: { type: 'price', precision: 2, minMove: 0.25 },
    });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', color: 'rgba(127,209,255,0.35)', lastValueVisible: false, priceLineVisible: false }, 1);
    const volPane = chart.panes()[1];
    if (volPane) volPane.setHeight(70);
    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;
    markersRef.current = createSeriesMarkers(candles, []);

    chart.subscribeCrosshairMove((param) => {
      if (!onHover) return;
      if (!param.time || !param.point) {
        onHover(null);
        return;
      }
      const t = param.time as number;
      const bar = barsRef.current.find((b) => b.time === t) ?? null;
      const values = linesRef.current.map((l) => {
        const series = lineRefs.current.get(l.key);
        const d = series ? (param.seriesData.get(series) as { value?: number } | undefined) : undefined;
        return { key: l.key, label: l.label, color: l.color, value: d && typeof d.value === 'number' ? d.value : null };
      });
      onHover({ time: t, bar, values });
    });
    setReady(true);
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      lineRefs.current.clear();
      markersRef.current = null;
      setReady(false);
    };
  }, [onHover]);

  useEffect(() => {
    if (!ready || !candleRef.current || !volumeRef.current) return;
    candleRef.current.setData(bars.map((b) => ({ time: toTs(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    volumeRef.current.setData(bars.map((b) => ({ time: toTs(b.time), value: b.volume, color: b.close >= b.open ? 'rgba(61,220,151,0.28)' : 'rgba(255,59,78,0.28)' })));
    chartRef.current?.timeScale().fitContent();
    const n = bars.length;
    if (n > 160) chartRef.current?.timeScale().setVisibleLogicalRange({ from: n - 160, to: n + 6 });
  }, [bars, ready]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    const wanted = new Set(lines.map((l) => l.key));
    for (const [key, series] of lineRefs.current) {
      if (!wanted.has(key)) {
        chart.removeSeries(series);
        lineRefs.current.delete(key);
      }
    }
    let paneCursor = 2;
    const paneByKey = new Map<string, number>();
    for (const l of lines) {
      const paneIndex = l.pane === 'pane' ? paneByKey.get(l.key.split(':')[0]) ?? paneCursor++ : 0;
      if (l.pane === 'pane') paneByKey.set(l.key.split(':')[0], paneIndex);
      let series = lineRefs.current.get(l.key);
      if (!series) {
        series = chart.addSeries(LineSeries, { color: l.color, lineWidth: l.lineWidth ?? 1, lineStyle: LINE_STYLE[l.lineStyle ?? 'solid'], priceLineVisible: false, lastValueVisible: l.pane === 'pane', crosshairMarkerVisible: false, title: l.pane === 'pane' ? l.label : '' }, paneIndex);
        lineRefs.current.set(l.key, series);
      } else {
        series.applyOptions({ color: l.color, lineWidth: l.lineWidth ?? 1, lineStyle: LINE_STYLE[l.lineStyle ?? 'solid'] });
      }
      series.setData(l.data.map((p) => (p.value === undefined ? { time: toTs(p.time) } : { time: toTs(p.time), value: p.value })));
    }
    chart.panes().forEach((pane, i) => {
      if (i >= 2) pane.setHeight(90);
    });
  }, [lines, ready]);

  useEffect(() => {
    if (!ready || !markersRef.current || bars.length === 0) return;
    const step = timeframe * 60;
    const first = bars[0].time;
    const last = bars[bars.length - 1].time;
    const snap = (ms: number) => Math.floor(ms / 1000 / step) * step;
    const markers: SeriesMarker<Time>[] = [];
    for (const t of trades) {
      const entry = snap(t.entryTime);
      const exit = snap(t.exitTime);
      if (entry < first || entry > last) continue;
      const long = t.direction === 'long';
      markers.push({ time: toTs(entry), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: long ? '#3ddc97' : '#ff3b4e', text: `${long ? 'L' : 'S'} ${t.qty} @ ${t.entryPrice.toFixed(2)}`, size: 1 });
      if (exit >= first && exit <= last) markers.push({ time: toTs(exit), position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: t.pnl >= 0 ? '#c9a24d' : '#8b91a3', text: `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(0)} $`, size: 0.8 });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current.setMarkers(markers);
  }, [trades, bars, timeframe, ready]);

  return <div ref={containerRef} className={s.chart} />;
}
