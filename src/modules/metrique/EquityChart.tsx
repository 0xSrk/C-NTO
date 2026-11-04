import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, createChart, CrosshairMode, LineStyle, type AutoscaleInfo, type IChartApi, type ISeriesApi, type SeriesPartialOptions, type Time, type UTCTimestamp, type WhitespaceData } from 'lightweight-charts';
import { SetCount } from '@/app/objects/Selection';
import { Glyph } from '@/design/Micro';
import { cx, Montant, Segmented } from '@/design/primitives';
import { majorCatalysts } from '@/engine/discipline';
import { equityCurve, type EquityCurveData, type EquityGrain, type EquityStep } from '@/engine/equityCurve';
import { catalystSource } from '@/engine/macroMerge';
import { findPlan } from '@/engine/propfirm';
import { entryHourET } from '@/engine/selection';
import type { Session, Trade } from '@/engine/types';
import { intlTag, tr, useI18n } from '@/i18n';
import { trEventTitle } from '@/lib/eventTitles';
import { fmtInt } from '@/lib/format';
import { cmeDay, replayDiscipline } from '@/lib/frise';
import { dateTimeFormatter } from '@/lib/time';
import { chartHostReady, safePaneHeight } from '@/modules/visual/chartBox';
import { useMacro } from '@/store/macro';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './dashboard.module.css';
import { sessionMarks } from './equityPaint';
import { cursorStep, EquityTrait, eventMarks, floorRange, NONE, StemTrait, UnderwaterTrait, type EquityRow, type EventGlyphKey, type EventMarks, type GlyphKey, type Ink, type Marks, type TraitOptions } from './equitySeries';
import { glyphImage, readyImage } from './glyphSprite';

/**
 * Métrique › A.02 : courbe d'équité, P&L par pas et drawdown sous l'eau, au trait du Lab
 * (fils d'un pixel légèrement lumineux, trame de points, pixel signature au dernier pas), avec les composants de
 * la planche : ⊕ au plus haut, ⊗ au creux, la borne du plan suivi. Système 4.1 : plus de plaque en filigrane, la lecture
 * au-dessus de la courbe dit le pas.
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
  /** Charge à la demande un composant que seule une puce allume (C.090, C.024) : rien n'est chargé tant qu'elle est éteinte. */
  ensure: (key: EventGlyphKey, px: number) => void;
  traits: Trait[];
  /** Dernière courbe dessinée : un rendu sans changement ne redessine pas. */
  drawn: EquityCurveData | null;
  /** Ses pas, tels que donnés aux traits : la borne qui change les redonne au volet sous l'eau, pour l'échelle. */
  rows: EquityRow[];
  /** Borne posée sur le volet sous l'eau (drawdown maximal du plan suivi, 0 sans plan). */
  floor: number;
}

/** Composants de la planche peints sur la courbe, et leur taille (px CSS) : ⊕ et ⊗ de 12, la borne de 10. */
const GLYPHS: readonly [GlyphKey, number][] = [
  ['target', 12],
  ['mire', 12],
  ['borne', 10],
];

const floorLabel = (floor: number) => (floor > 0 ? `${tr('PLANCHER', 'FLOOR', 'SUELO')} −${fmtInt(floor)}` : '');

/** Les composants qu'une puce allume (OROS5.36), et leur taille (px CSS) : la tête du catalyseur, l'écart au pied. */
const EVENT_GLYPHS: Readonly<Record<'catalysts' | 'drifts', readonly [EventGlyphKey, number]>> = { catalysts: ['catalyst', 12], drifts: ['drift', 10] };

/** Les années que couvre la courbe : la source unique du catalyseur s'y lit (repères locaux et lignes officielles). */
function yearsOf(sessions: readonly Session[]): number[] {
  const years = sessions.map((row) => Number(row.date.slice(0, 4))).filter((y) => Number.isInteger(y));
  if (!years.length) return [];
  const out: number[] = [];
  for (let y = Math.min(...years); y <= Math.max(...years); y++) out.push(y);
  return out;
}

const ALL_STEPS = () => true;

/**
 * Les pas qu'allument les puces Instrument (OROS5.32) et Heure (OROS5.35) : au grain séance, chaque journée où la
 * sélection a un trade ; au grain trade, chacun de ses trades (sa sortie et son instrument). Le départ n'en est jamais.
 * `null` sans puce.
 */
export function litSteps(curve: EquityCurveData, sessions: readonly Session[], trades: readonly Trade[], instrument: string | null, hour: number | null = null): { on: boolean[]; count: number } | null {
  if (!instrument && hour == null) return null;
  const keep = (row: Trade) => (!instrument || row.instrument === instrument) && (hour == null || entryHourET(row) === hour);
  const dateOf = new Map(sessions.map((row) => [row.id, row.date]));
  const days = new Set<string>();
  const exits = new Set<string>();
  for (const row of trades) {
    if (!keep(row)) continue;
    days.add(dateOf.get(row.sessionId) ?? '');
    exits.add(`${row.exitTime}|${row.instrument}`);
  }
  const onTrade = (step: EquityStep) => (hour == null ? step.instrument === instrument : exits.has(`${step.at}|${step.instrument}`));
  const on = curve.steps.map((step) => !step.origin && (curve.grain === 'trade' ? onTrade(step) : days.has(step.date)));
  return { on, count: on.filter(Boolean).length };
}

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
  lit,
  litHour,
  onStep,
}: {
  sessions: Session[];
  trades: Trade[];
  className?: string;
  /**
   * La puce Instrument de la sélection partagée (OROS5.32) : ses pas s'allument sur la courbe du compte, les autres
   * restent, atténués. Au grain séance, les journées où l'instrument a un trade ; au grain trade, ses trades.
   */
  lit?: string | null;
  /** La puce Heure (OROS5.35) : ses pas s'allument de même, une journée ou un trade entré à cette heure de New York. */
  litHour?: number | null;
  /** Drawdown maximal du plan suivi pour le compte filtré : la borne du volet sous l'eau. Absent : aucune borne inventée. */
  floor?: number | null;
  /**
   * Un pas cliqué (OROS5.26) : chaque pas est une séance, qui ouvre sa fiche. La bibliothèque ne compte pas un glisser
   * pour un clic (au-delà de 5 px) : glisser déplace toujours la courbe.
   */
  onStep?: (step: EquityStep, origin: HTMLElement | null) => void;
}) {
  const locale = useI18n((st) => st.locale);
  const [grain, setGrain] = useState<EquityGrain>('session');
  const curve = useMemo(() => equityCurve(sessions, trades, grain), [sessions, trades, grain]);
  // Le curseur de temps (OROS5.36) : le réticule unique s'épingle au pas qu'il tient ; le survol garde la priorité.
  const cursor = useUi((u) => u.timeCursor);
  const cursorIndex = useMemo(() => cursorStep(curve, cursor), [curve, cursor]);
  const pinned = cursorIndex !== null && cursorIndex >= 0 ? cursorIndex : null;
  // Les jeux d'événements, en puces : les catalyseurs majeurs de la source unique (OROS5.13) et les écarts rejoués comme
  // le couloir Desk de la frise (`replayDiscipline`). Éteints au départ : la courbe reste la même tant qu'on ne les allume pas.
  const [sets, setSets] = useState({ catalysts: false, drifts: false });
  const official = useMacro((m) => m.events);
  const rules = useSettings((st) => st.settings.traderRules);
  const planId = useSettings((st) => st.settings.planId);
  const planAccount = useSettings((st) => st.settings.planAccount);
  const years = yearsOf(sessions).join(',');
  const calendar = useMemo(() => (years ? catalystSource(official, years.split(',').map(Number)) : []), [official, years]);
  const majors = useMemo(() => majorCatalysts(calendar), [calendar]);
  const findings = useMemo(() => (trades.length ? replayDiscipline(trades, calendar, rules, findPlan(planId), planAccount) : []), [trades, calendar, rules, planId, planAccount]);
  const marksOfEvents = useMemo(() => eventMarks(curve, { catalysts: majors, findings, trades }, trEventTitle), [curve, majors, findings, trades, locale]);
  const counts = { catalysts: marksOfEvents.catalysts.reduce((n, m) => n + m.count, 0), drifts: marksOfEvents.drifts.reduce((n, m) => n + m.count, 0) };
  const [booted, setBooted] = useState(0);
  const floorValue = floor != null && floor > 0 ? floor : 0;
  const floorRef = useRef(floorValue);
  floorRef.current = floorValue;
  const [hover, setHover] = useState<number | null>(null);
  const [fault, setFault] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const refs = useRef<Refs | null>(null);
  const curveRef = useRef(curve);
  curveRef.current = curve;
  const grainRef = useRef(grain);
  grainRef.current = grain;
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const selectionRef = useRef<((index: number) => boolean) | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const sprites: Partial<Record<GlyphKey | EventGlyphKey, HTMLImageElement>> = {};
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
          // Un point sans événement d'origine n'est pas le pointeur : c'est la position posée par `setCrosshairPosition`,
          // que la bibliothèque relance à chaque `applyOptions` d'une série (`updateCrosshair`). Ce n'est pas un survol.
          if (param.point && !param.sourceEvent) return;
          if (param.time === undefined || !param.point) {
            setHover(null);
            return;
          }
          const index = curveRef.current.steps.findIndex((step) => step.time === (param.time as number));
          setHover(index >= 0 ? index : null);
        });
        // Le clic, hors glisser : le pas ouvre la fiche de sa séance ; le départ n'est pas une séance.
        chart.subscribeClick?.((param) => {
          if (param.time === undefined) return;
          const step = curveRef.current.steps.find((row) => row.time === (param.time as number));
          if (step && !step.origin) onStepRef.current?.(step, el);
        });
        // Composants de la planche (⊕ ⊗ borne) : images du master, encrées en ivoire, à la densité de l'écran ; le trait
        // ne les reçoit qu'une fois chargées, et chaque chargement redessine.
        const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
        const lookup = (key: GlyphKey) => readyImage(sprites[key]);
        const eventLookup = (key: EventGlyphKey) => readyImage(sprites[key]);
        const repaint = () => {
          if (disposed) return;
          const glyph = (key: GlyphKey) => lookup(key);
          const eventGlyph = (key: EventGlyphKey) => eventLookup(key);
          for (const trait of refs.current?.traits ?? []) trait.applyOptions({ glyph, eventGlyph });
        };
        const load = (key: GlyphKey | EventGlyphKey, px: number) => {
          if (!sprites[key]) sprites[key] = glyphImage(key, colors.line, colors.paper, Math.ceil(px * dpr), repaint, Math.max(1, 0.6 * dpr));
        };
        refs.current = { chart, ensure: load, traits: [equity, pnl, drawdown], drawn: null, rows: [], floor: floorNow };
        for (const [key, px] of GLYPHS) load(key, px);
        for (const trait of refs.current.traits) trait.applyOptions({ glyph: lookup, eventGlyph: eventLookup });
        draw(refs.current, curveRef.current);
        const selected = selectionRef.current;
        for (const trait of refs.current.traits) trait.applyOptions({ selecting: selected != null, inSelection: selected ?? ALL_STEPS });
        // Le graphique posé : le réticule du curseur et les jeux allumés s'y reportent.
        setBooted((n) => n + 1);
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

  // Pas survolé, ou pas du curseur : carré creux sur la crête, fil allumé, lueur sous l'eau. Le survol passe devant.
  // Une courbe nouvelle repasse par `draw`, qui remet le focus : il se repose après elle.
  useEffect(() => {
    for (const trait of refs.current?.traits ?? []) trait.applyOptions({ focus: hover ?? pinned ?? NONE });
  }, [hover, pinned, curve, booted]);

  // Le réticule unique de la bibliothèque, posé sur le pas du curseur tant que le pointeur n'est pas sur la courbe. La
  // position posée ainsi (« synthétique ») ne déclenche pas d'événement ; la bibliothèque la relance ensuite à chaque
  // `applyOptions`, sans événement d'origine, et le gestionnaire du survol l'ignore.
  useEffect(() => {
    const current = refs.current;
    if (!current || hover !== null) return;
    const row = pinned !== null ? curve.steps[pinned] : undefined;
    const series = current.traits[0];
    if (row && series && current.drawn === curve) current.chart.setCrosshairPosition?.(row.equity, row.time as UTCTimestamp, series);
    else current.chart.clearCrosshairPosition?.();
  }, [pinned, hover, curve, booted]);

  // Les jeux d'événements allumés : leurs marques au trait d'équité ; un composant ne se charge qu'à sa première puce.
  useEffect(() => {
    const current = refs.current;
    if (!current) return;
    for (const set of ['catalysts', 'drifts'] as const) if (sets[set] && marksOfEvents[set].length) current.ensure(...EVENT_GLYPHS[set]);
    const events: EventMarks = { catalysts: sets.catalysts ? marksOfEvents.catalysts : [], drifts: sets.drifts ? marksOfEvents.drifts : [] };
    for (const trait of current.traits) trait.applyOptions({ events });
  }, [sets, marksOfEvents, booted]);

  // La sélection allumée : les pas de l'instrument, un par journée qui en a un trade, ou un par trade de l'instrument.
  const lighting = useMemo(() => litSteps(curve, sessions, trades, lit ?? null, litHour ?? null), [curve, sessions, trades, lit, litHour]);
  const selection = useMemo(() => (lighting ? (index: number) => lighting.on[index] ?? false : null), [lighting]);
  selectionRef.current = selection;
  useEffect(() => {
    for (const trait of refs.current?.traits ?? []) trait.applyOptions({ selecting: selection != null, inSelection: selection ?? ALL_STEPS });
  }, [selection]);
  const counted = curve.steps.filter((row) => !row.origin).length;

  const last = curve.steps.length - 1;
  const step = curve.steps[hover ?? pinned ?? last];
  // Le curseur tient une journée sans pas : la lecture le dit, sans pas à lire.
  const noStep = hover === null && cursorIndex === -1 && cursor !== null;
  const held = hover === null && pinned !== null;
  // Le pas lu porte un catalyseur allumé : la lecture le nomme, même quand la tige n'a pas la place de le dire.
  const readIndex = hover ?? pinned ?? last;
  const readCatalyst = sets.catalysts ? marksOfEvents.catalysts.find((m) => m.index === readIndex)?.label : undefined;
  return (
    <section className={`${s.card} ${s.pad} ${className ?? ''}`}>
      <div className={s.cardHead}>
        <span>
          <span className={s.code}>A.02 </span>
          <span className={s.kName}>{tr('Courbe d’équité', 'Equity curve', 'Curva de equidad')}</span>
        </span>
        <span className={s.cardTools}>
          {/* Les jeux d'événements, en puces, chacun son n : ils s'allument sur la courbe, sans la changer. */}
          <span className={s.eqSets} role="group" aria-label={tr('Jeux d’événements', 'Event sets', 'Conjuntos de eventos')}>
            <button type="button" className={cx(s.eqSet, sets.catalysts && s.eqSetOn)} data-event-set="catalysts" aria-pressed={sets.catalysts} onClick={() => setSets((v) => ({ ...v, catalysts: !v.catalysts }))}>
              <Glyph name="catalyst" className={s.eqSetGlyph} />
              {tr('Catalyseurs', 'Catalysts', 'Catalizadores')} <b>{fmtInt(counts.catalysts)}</b>
            </button>
            <button type="button" className={cx(s.eqSet, sets.drifts && s.eqSetOn)} data-event-set="drifts" aria-pressed={sets.drifts} onClick={() => setSets((v) => ({ ...v, drifts: !v.drifts }))}>
              <Glyph name="drift" className={s.eqSetGlyph} />
              {tr('Écarts', 'Breaches', 'Desvíos')} <b>{fmtInt(counts.drifts)}</b>
            </button>
          </span>
          <SetCount n={lighting ? lighting.count : counted} total={counted} kind={grain === 'trade' ? 'trade' : 'session'} className={s.count} />
          <Segmented<EquityGrain>
            value={grain}
            onChange={setGrain}
            options={[
              { value: 'session', label: tr('Séance', 'Session', 'Sesión') },
              { value: 'trade', label: tr('Trade', 'Trade', 'Trade') },
            ]}
          />
        </span>
      </div>
      {noStep && cursor !== null ? (
        <div className={s.eqRead} aria-live="off">
          <span className={cx(s.eqWhen, s.eqPinned)} data-pinned="">
            {dateTimeFormatter(DAY_LONG).format(new Date(`${cmeDay(cursor)}T12:00:00Z`))} · {cmeDay(cursor) < (curve.steps[1]?.date ?? '') || cmeDay(cursor) > (curve.steps[last]?.date ?? '') ? tr('hors période', 'outside the range', 'fuera del período') : tr('aucune séance', 'no session', 'ninguna sesión')}
          </span>
          {[tr('Cumul', 'Cumulative', 'Acumulado'), grain === 'session' ? tr('Séance', 'Session', 'Sesión') : tr('Trade', 'Trade', 'Trade'), tr('Sous le plus haut', 'Below the high', 'Bajo el máximo'), tr('Trades', 'Trades', 'Trades')].map((name) => (
            <span key={name} className={s.eqCell}>
              <span className={s.hint}>{name}</span>
              <span>—</span>
            </span>
          ))}
        </div>
      ) : step ? (
        <div className={s.eqRead} aria-live="off">
          <span className={cx(s.eqWhen, held && s.eqPinned)} data-pinned={held ? '' : undefined}>
            {stepLabel(step, grain)}
            {readCatalyst ? <span className={s.eqWhenEvent}> · {readCatalyst}</span> : null}
          </span>
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
