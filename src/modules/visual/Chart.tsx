import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, HistogramSeries, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { Bar } from '@/engine/bars';
import type { IndicatorLine } from '@/engine/indicators';
import type { Trade } from '@/engine/types';
import { fmtPrice, fmtUsd } from '@/lib/format';
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

/** Recherche dichotomique d'une barre par horodatage (les barres sont triées). */
function findBar(bars: Bar[], time: number): Bar | null {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = bars[mid].time;
    if (t === time) return bars[mid];
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/**
 * lightweight-charts relie les points de part et d'autre d'un blanc : pour obtenir une vraie
 * rupture (niveaux de séance), chaque segment contigu devient une série distincte.
 */
function splitSegments(data: IndicatorLine['data'], maxSegments = 80): { time: number; value: number }[][] {
  const segments: { time: number; value: number }[][] = [];
  let current: { time: number; value: number }[] = [];
  for (const p of data) {
    if (p.value === undefined) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ time: p.time, value: p.value });
  }
  if (current.length) segments.push(current);
  return segments.length > maxSegments ? segments.slice(-maxSegments) : segments;
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
        textColor: '#8a8a8a',
        fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
        fontSize: 11,
        panes: { separatorColor: '#232323', separatorHoverColor: 'rgba(196,30,58,0.28)', enableResize: true },
        attributionLogo: false,
      },
      grid: { vertLines: { color: '#161616' }, horzLines: { color: '#161616' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#8a8a8a', labelBackgroundColor: '#0b0b0b', width: 1, style: LineStyle.Dotted }, horzLine: { color: '#8a8a8a', labelBackgroundColor: '#0b0b0b', width: 1, style: LineStyle.Dotted } },
      rightPriceScale: { borderColor: '#232323', scaleMargins: { top: 0.06, bottom: 0.05 } },
      timeScale: {
        borderColor: '#232323',
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
        priceFormatter: (p: number) => fmtPrice(p),
      },
      handleScroll: { vertTouchDrag: false },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#7fcf9a',
      downColor: '#e0776c',
      borderUpColor: '#7fcf9a',
      borderDownColor: '#e0776c',
      wickUpColor: 'rgba(127,207,154,0.8)',
      wickDownColor: 'rgba(224,119,108,0.8)',
      priceLineColor: '#8a8a8a',
      priceLineStyle: LineStyle.Dotted,
      priceFormat: { type: 'price', precision: 2, minMove: 0.25 },
    });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', color: 'rgba(138,138,138,0.35)', lastValueVisible: false, priceLineVisible: false }, 1);
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
      const bar = findBar(barsRef.current, t);
      const values = linesRef.current.map((l) => {
        let value: number | null = null;
        for (const [key, series] of lineRefs.current) {
          if (!key.startsWith(`${l.key}#`)) continue;
          const d = param.seriesData.get(series) as { value?: number } | undefined;
          if (d && typeof d.value === 'number') {
            value = d.value;
            break;
          }
        }
        return { key: l.key, label: l.label, color: l.color, value };
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
    volumeRef.current.setData(bars.map((b) => ({ time: toTs(b.time), value: b.volume, color: b.close >= b.open ? 'rgba(127,207,154,0.28)' : 'rgba(224,119,108,0.28)' })));
    chartRef.current?.timeScale().fitContent();
    const n = bars.length;
    if (n > 160) chartRef.current?.timeScale().setVisibleLogicalRange({ from: n - 160, to: n + 6 });
  }, [bars, ready]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!ready || !chart) return;
    const wanted = new Set<string>();
    let paneCursor = 2;
    const paneByKey = new Map<string, number>();
    for (const l of lines) {
      const paneIndex = l.pane === 'pane' ? paneByKey.get(l.key.split(':')[0]) ?? paneCursor++ : 0;
      if (l.pane === 'pane') paneByKey.set(l.key.split(':')[0], paneIndex);
      const segments = splitSegments(l.data);
      segments.forEach((segment, i) => {
        const segKey = `${l.key}#${i}`;
        wanted.add(segKey);
        let series = lineRefs.current.get(segKey);
        const options = { color: l.color, lineWidth: l.lineWidth ?? 1, lineStyle: LINE_STYLE[l.lineStyle ?? 'solid'] } as const;
        if (!series) {
          series = chart.addSeries(LineSeries, { ...options, priceLineVisible: false, lastValueVisible: l.pane === 'pane' && i === segments.length - 1, crosshairMarkerVisible: false, title: l.pane === 'pane' && i === segments.length - 1 ? l.label : '' }, paneIndex);
          lineRefs.current.set(segKey, series);
        } else {
          series.applyOptions(options);
        }
        series.setData(segment.map((p) => ({ time: toTs(p.time), value: p.value })));
      });
    }
    for (const [key, series] of lineRefs.current) {
      if (!wanted.has(key)) {
        chart.removeSeries(series);
        lineRefs.current.delete(key);
      }
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
      markers.push({ time: toTs(entry), position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: long ? '#7fcf9a' : '#e0776c', text: `${long ? 'L' : 'S'} ${t.qty} @ ${fmtPrice(t.entryPrice)}`, size: 1 });
      if (exit >= first && exit <= last) markers.push({ time: toTs(exit), position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: t.pnl >= 0 ? '#c41e3a' : '#8a8a8a', text: fmtUsd(t.pnl, { sign: true }), size: 0.8 });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current.setMarkers(markers);
  }, [trades, bars, timeframe, ready]);

  return <div ref={containerRef} className={s.chart} />;
}
