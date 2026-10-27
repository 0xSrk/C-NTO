import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, createChart, CrosshairMode, LineStyle, type AutoscaleInfo, type IChartApi, type ISeriesApi, type SeriesPartialOptions, type Time, type UTCTimestamp, type WhitespaceData } from 'lightweight-charts';
import { Plate, type SlotValues } from '@/design/Micro';
import { Montant, Segmented } from '@/design/primitives';
import { equityCurve, type EquityCurveData, type EquityGrain, type EquityStep } from '@/engine/equityCurve';
import type { Session, SessionSource, Trade } from '@/engine/types';
import { intlTag, tr, useI18n } from '@/i18n';
import { decimalMark, fmtInt, fmtNum, montantParts } from '@/lib/format';
import { dateTimeFormatter } from '@/lib/time';
import { chartHostReady, safePaneHeight } from '@/modules/visual/chartBox';
import s from './dashboard.module.css';
import { sessionMarks } from './equityPaint';
import { EquityTrait, floorRange, NONE, StemTrait, UnderwaterTrait, type EquityRow, type GlyphKey, type Ink, type Marks, type TraitOptions } from './equitySeries';
import { glyphImage, readyImage } from './glyphSprite';

/**
 * Métrique › A.02 : courbe d'équité, P&L par pas et drawdown sous l'eau, au trait du Lab
 * (fils d'un pixel légèrement lumineux, trame de points, pixel signature au dernier pas), avec les composants de
 * la planche : ⊕ au plus haut, ⊗ au creux, la borne du plan suivi, la plaque de lecture A.02 en filigrane.
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
function palette(el: HTMLElement): Ink & { line1: string; bg3: string } {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim() || 'gray';
  return {
    line: v('--text-0'),
    pos: v('--pos'),
    neg: v('--neg'),
    red: v('--gold'),
    faint: v('--text-2'),
    label: v('--text-1'),
    zero: v('--line-2'),
    paper: v('--bg-2'),
    line1: v('--line-1'),
    bg3: v('--bg-3'),
    mono: css.getPropertyValue('--font-mono').trim() || 'monospace',
  };
}

/** Pixel signature en légende : la même matrice 5 × 5 que sur la courbe. */
const PIXEL_KEY: [number, number, boolean, number][] = Array.from({ length: 25 }, (_, i) => {
  const x = i % 5;
  const y = Math.floor(i / 5);
  const ring = Math.max(Math.abs(x - 2), Math.abs(y - 2));
  const corner = Math.abs(x - 2) === 2 && Math.abs(y - 2) === 2;
  return [x, y, ring === 0, corner ? 0.22 : ring === 2 ? 0.5 : 1];
});

const signed = (value: number) => (Math.round(value) > 0 ? `+${fmtInt(value)}` : fmtInt(value));

function stepLabel(step: EquityStep, grain: EquityGrain): string {
  if (step.origin) return tr('DÉPART', 'START', 'INICIO');
  if (grain === 'trade' && step.at !== null && step.instrument) return `${dateTimeFormatter(LOCAL_LONG).format(new Date(step.at))} · ${step.instrument}`;
  return dateTimeFormatter(DAY_LONG).format(new Date(step.time * 1000));
}

type Trait = ISeriesApi<'Custom', Time, EquityRow | WhitespaceData<Time>, TraitOptions, SeriesPartialOptions<TraitOptions>>;

interface Refs {
  chart: IChartApi;
  traits: Trait[];
  /** Dernière courbe dessinée : un rendu sans changement ne redessine pas. */
  drawn: EquityCurveData | null;
  /** Ses pas, tels que donnés aux traits : la borne qui change les redonne au volet sous l'eau, pour l'échelle. */
  rows: EquityRow[];
  /** Borne posée sur le volet sous l'eau (drawdown maximal du plan suivi, 0 sans plan). */
  floor: number;
}

/** Statistiques de la période que lit la plaque A.02 : celles du tableau de bord, pas recalculées ici. */
export interface EquityPlateStats {
  trades: number;
  winRate: number;
  profitFactor: number;
}

/** Composants de la planche peints sur la courbe, et leur taille (px CSS) : ⊕ et ⊗ de 12, la borne de 10. */
const GLYPHS: readonly [GlyphKey, number][] = [
  ['target', 12],
  ['mire', 12],
  ['borne', 10],
];

/** Montant de plaque : signe, groupes de trois, séparateur décimal de la langue, deux décimales. */
function plateAmount(value: number): string {
  const parts = montantParts(value, 2);
  return `${parts.sign}${parts.groups.join(' ')}${decimalMark()}${parts.decimals}`;
}

function sourceLabel(source: SessionSource): string {
  switch (source) {
    case 'demo':
      return tr('DÉMO', 'DEMO', 'DEMO');
    case 'ninjatrader':
      return 'NT8';
    case 'csv':
      return 'CSV';
    case 'manuel':
      return tr('MANUEL', 'MANUAL', 'MANUAL');
  }
}

/** Ce que lit la plaque A.02 : la source du journal, le cumul et l'écart au plus haut du dernier pas, les statistiques. */
function plateValues(curve: EquityCurveData, sessions: readonly Session[], stats: EquityPlateStats | undefined): SlotValues {
  const sources = new Set(sessions.map((row) => row.source));
  const only = sources.size === 1 ? [...sources][0] : undefined;
  const last = curve.steps[curve.steps.length - 1];
  return {
    state: only ? sourceLabel(only) : sources.size > 1 ? tr('JOURNAL', 'JOURNAL', 'DIARIO') : null,
    cumul: last ? plateAmount(curve.net) : null,
    dd: last ? plateAmount(last.drawdown) : null,
    sessions: fmtInt(sessions.length),
    trades: stats ? fmtInt(stats.trades) : null,
    win: stats ? fmtNum(stats.winRate * 100, 1) : null,
    pf: stats ? (Number.isFinite(stats.profitFactor) ? fmtNum(stats.profitFactor, 2) : '∞') : null,
  };
}

const floorLabel = (floor: number) => (floor > 0 ? `${tr('PLANCHER', 'FLOOR', 'SUELO')} −${fmtInt(floor)}` : '');

/** Repères du volet principal : le plus haut et le creux du plus grand drawdown, au trait. */
function marksOf(curve: EquityCurveData): Marks {
  let high = NONE;
  curve.steps.forEach((step, i) => {
    if (step.equity > 0 && (high === NONE || step.equity > (curve.steps[high]?.equity ?? 0))) high = i;
  });
  const top = curve.steps[high];
  return {
    high,
    highLabel: top ? `${tr('PLUS-HAUT', 'HIGH', 'MÁXIMO')} ${signed(top.equity)}` : '',
    trough: curve.maxDrawdown?.trough ?? NONE,
    troughLabel: curve.maxDrawdown ? `${tr('CREUX', 'TROUGH', 'VALLE')} −${fmtInt(curve.maxDrawdown.depth)}` : '',
  };
}

function draw(refs: Refs, curve: EquityCurveData): void {
  const sessions = sessionMarks(curve.steps);
  const rows: EquityRow[] = curve.steps.map((step, i) => ({ time: step.time as UTCTimestamp, equity: step.equity, peak: step.peak, drawdown: step.drawdown, pnl: step.pnl, session: sessions[i] ?? NONE }));
  const marks = marksOf(curve);
  for (const trait of refs.traits) {
    trait.applyOptions({ marks, focus: NONE });
    trait.setData(rows);
  }
  refs.chart.timeScale().fitContent();
  refs.drawn = curve;
  refs.rows = rows;
}

export function EquityCard({
  sessions,
  trades,
  className,
  floor,
  stats,
}: {
  sessions: Session[];
  trades: Trade[];
  className?: string;
  /** Drawdown maximal du plan suivi pour le compte filtré : la borne du volet sous l'eau. Absent : aucune borne inventée. */
  floor?: number | null;
  stats?: EquityPlateStats;
}) {
  const locale = useI18n((st) => st.locale);
  const [grain, setGrain] = useState<EquityGrain>('session');
  const curve = useMemo(() => equityCurve(sessions, trades, grain), [sessions, trades, grain]);
  const floorValue = floor != null && floor > 0 ? floor : 0;
  const floorRef = useRef(floorValue);
  floorRef.current = floorValue;
  const plate = useMemo(() => plateValues(curve, sessions, stats), [curve, sessions, stats, locale]);
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
    const sprites: Partial<Record<GlyphKey, HTMLImageElement>> = {};
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
            textColor: colors.faint,
            fontFamily: colors.mono,
            fontSize: 10,
            panes: { separatorColor: colors.line1, separatorHoverColor: colors.zero, enableResize: false },
            attributionLogo: false,
          },
          grid: { vertLines: { visible: false }, horzLines: { color: colors.line1, style: LineStyle.SparseDotted } },
          crosshair: {
            mode: CrosshairMode.Magnet,
            vertLine: { color: colors.faint, labelBackgroundColor: colors.bg3, width: 1, style: LineStyle.SparseDotted },
            horzLine: { color: colors.faint, labelBackgroundColor: colors.bg3, width: 1, style: LineStyle.SparseDotted },
          },
          rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.2, bottom: 0.16 } },
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
        const ink: Ink = colors;
        const scale = { priceLineVisible: false, priceFormat: { type: 'price' as const, precision: 0, minMove: 1 } };
        const equity = chart.addCustomSeries(new EquityTrait(), { ...scale, ink, color: ink.line, lastValueVisible: true });
        const pnl = chart.addCustomSeries(new StemTrait(), { ...scale, ink, color: ink.faint, lastValueVisible: false }, 1);
        // La borne du plan suivi : le volet sous l'eau l'expose, et son échelle la contient.
        const floorNow = floorRef.current;
        const drawdown = chart.addCustomSeries(
          new UnderwaterTrait(),
          { ...scale, ink, color: ink.neg, lastValueVisible: false, floor: floorNow, floorLabel: floorLabel(floorNow), autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => floorRange(base(), floorRef.current) },
          2,
        );
        const panes = chart.panes();
        const pnlHeight = safePaneHeight(PNL_PANE, height, panes.length);
        const ddHeight = safePaneHeight(DD_PANE, height, panes.length);
        if (pnlHeight) panes[1]?.setHeight(pnlHeight);
        if (ddHeight) panes[2]?.setHeight(ddHeight);
        chart.subscribeCrosshairMove((param) => {
          if (param.time === undefined || !param.point) {
            setHover(null);
            return;
          }
          const index = curveRef.current.steps.findIndex((step) => step.time === (param.time as number));
          setHover(index >= 0 ? index : null);
        });
        refs.current = { chart, traits: [equity, pnl, drawdown], drawn: null, rows: [], floor: floorNow };
        // Composants de la planche (⊕ ⊗ borne) : images du master, encrées en ivoire, à la densité de l'écran ; le trait
        // ne les reçoit qu'une fois chargées, et chaque chargement redessine.
        const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
        const lookup = (key: GlyphKey) => readyImage(sprites[key]);
        const repaint = () => {
          if (disposed) return;
          const glyph = (key: GlyphKey) => lookup(key);
          for (const trait of refs.current?.traits ?? []) trait.applyOptions({ glyph });
        };
        for (const [key, px] of GLYPHS) sprites[key] = glyphImage(key, colors.line, colors.paper, Math.ceil(px * dpr), repaint, Math.max(1, 0.6 * dpr));
        for (const trait of refs.current.traits) trait.applyOptions({ glyph: lookup });
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
      for (const img of Object.values(sprites)) img.onload = null;
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

  // La borne suit le plan suivi et la langue ; ses pas redonnés au volet sous l'eau recalculent son échelle.
  useEffect(() => {
    const current = refs.current;
    const drawdown = current?.traits[2];
    if (!current || !drawdown) return;
    drawdown.applyOptions({ floor: floorValue, floorLabel: floorLabel(floorValue) });
    if (current.floor !== floorValue) {
      current.floor = floorValue;
      if (current.rows.length) drawdown.setData(current.rows);
    }
  }, [floorValue, locale]);

  // Les étiquettes des repères suivent la langue du desk.
  useEffect(() => {
    for (const trait of refs.current?.traits ?? []) trait.applyOptions({ marks: marksOf(curveRef.current) });
  }, [locale]);

  // Pas survolé : carré creux sur la crête, fil allumé, lueur sous l'eau.
  useEffect(() => {
    for (const trait of refs.current?.traits ?? []) trait.applyOptions({ focus: hover ?? NONE });
  }, [hover]);

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
        <div className={s.eqStage}>
          <div ref={host} className={s.eqChart} style={{ height: CHART_HEIGHT }} role="img" aria-label={tr(`P&L cumulé ${signed(curve.net)} USD`, `Cumulative P&L ${signed(curve.net)} USD`, `P&L acumulado ${signed(curve.net)} USD`)} />
          {/* La plaque de lecture A.02 en filigrane : elle lit la courbe et les statistiques réelles, la lecture au-dessus les dit déjà. */}
          <Plate id="equity" values={plate} className={s.eqPlate} />
        </div>
      )}
      <div className={s.eqLegend}>
        <span>
          <i className={s.eqKeyLine} /> {tr('Équité', 'Equity', 'Equidad')}
        </span>
        <span>
          <i className={s.eqKeyPeak} /> {tr('Plus haut', 'High', 'Máximo')}
        </span>
        <span>
          <i className={s.eqKeyStem} /> {tr('P&L par pas', 'P&L per step', 'P&L por paso')}
        </span>
        <span>
          <i className={s.eqKeyDd} /> {tr('Drawdown', 'Drawdown', 'Drawdown')}
          {curve.maxDrawdown ? ` max −${fmtInt(curve.maxDrawdown.depth)}` : ''}
        </span>
        {floorValue > 0 ? (
          <span>
            <i className={s.eqKeyFloor} /> {tr('Plancher · borne', 'Floor · limit', 'Suelo · límite')}
          </span>
        ) : null}
        <span>
          <svg className={s.eqKeyPixel} viewBox="0 0 9 9" aria-hidden>
            {PIXEL_KEY.map(([x, y, core, a]) => (
              <rect key={`${x}-${y}`} x={x * 2} y={y * 2} width="1.4" height="1.4" className={core ? s.eqPixelCore : undefined} opacity={a} />
            ))}
          </svg>
          {tr('Dernier pas', 'Last step', 'Último paso')}
        </span>
        <span className={s.eqHelp}>{tr('Ctrl + molette : zoom · double-clic : tout', 'Ctrl + wheel: zoom · double-click: all', 'Ctrl + rueda: zoom · doble clic: todo')}</span>
      </div>
    </section>
  );
}
