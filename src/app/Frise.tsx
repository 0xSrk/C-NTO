import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Glyph, type GlyphName } from '@/design/Micro';
import { cx } from '@/design/primitives';
import e from '@/design/etat.module.css';
import type { EntityRef } from '@/engine/ontology';
import { findPlan } from '@/engine/propfirm';
import type { Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { horizonEnd, impactBars, strokeOf } from '@/lib/calendarMarks';
import { trEventTitle } from '@/lib/eventTitles';
import { CURSOR_TABS, dayFraction, fractionToMs, groupNear, hourTicks, MERGE_PX, MIN, moveCursor, replayDiscipline, snap, spaced, stemGroups, type TimeWindow } from '@/lib/frise';
import { useJournal } from '@/store/journal';
import { useObjects } from '@/store/objects';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { etDay, FRISE_ANSWER_ID, FRISE_DRAWER_ID, useHourAnswer } from './FriseAnswer';
import { etClock, STROKE_ETAT, type EtatStroke } from './objects/index';
import { cursorMoveOf, matchShortcut } from './shortcuts';
import f from './frise.module.css';

/**
 * Le tiroir de la frise (OROS5.24, Système 5 « Fiche et Frise » ; repris du prototype C · Frise, d3) : la réponse de la
 * barre d'état, ou sa touche, le déplie au-dessus d'elle, 64 px (mesure locale, décision 4), sans pousser la zone de
 * travail. Quatre couloirs — Séance, Catalyseurs, Fenêtres, Desk — sur la journée CME de 18:00 à 17:00 ET, la nuit
 * comprimée au tiers de l'axe, et la ligne « maintenant » à l'or (décision 1) ; tiré, le curseur prend l'or et maintenant
 * passe au graphite.
 *
 * L'axe est un `role="slider"` qui lit le registre des raccourcis (`cursorMoveOf`, `matchShortcut('frise', e)`) : ← → 5
 * min, Maj 1 h, Pg préc. / suiv. une journée ouvrée, Début / Fin aux bords, Échap rend le présent (puis replie), Entrée
 * ouvre la fiche de l'objet sous le curseur. Le curseur ne vit que dans Métrique et le Calendrier (`CURSOR_TABS`) ;
 * ailleurs l'axe se lit au présent. Chaque geste est gardé par l'inertie du châssis : sous le verrou, rien ne répond.
 *
 * Chaque marque tracée prend son trait dans la table d'états (`src/design/etat.module.css`) : pleine pour ce qui a eu
 * lieu, tiretée pour ce qui est prévu, pointillée au-delà de l'horizon, éteinte pour une journée fermée. Lecture seule : le
 * tiroir ne fait que lire et ouvrir des fiches.
 */

/** Quatre couloirs de 12 px, puis l'axe des heures de 16 px (`frise.module.css`) : 64 px. */
const LANE = 12;
const LANES = 4 * LANE;
/** L'ordre des couloirs, de haut en bas, et leur milieu. */
const Y = { session: LANE / 2, catalyst: LANE + LANE / 2, window: 2 * LANE + LANE / 2, desk: 3 * LANE + LANE / 2 } as const;
/** Largeur de l'axe avant la première mesure (jsdom, premier rendu). */
const DEFAULT_WIDTH = 960;
/** Ce qu'Entrée ouvre sous le curseur : un trade à 5 min près, une publication à 10 min près. */
const NEAR_TRADE = 5 * MIN;
const NEAR_EVENT = 10 * MIN;

const LANE_NAMES: readonly { key: keyof typeof Y; glyph: GlyphName; name: () => string }[] = [
  { key: 'session', glyph: 'session', name: () => tr('Séance', 'Session', 'Sesión') },
  { key: 'catalyst', glyph: 'catalyst', name: () => tr('Catalyseurs', 'Catalysts', 'Catalizadores') },
  { key: 'window', glyph: 'traderRule', name: () => tr('Fenêtres', 'Windows', 'Ventanas') },
  { key: 'desk', glyph: 'trade', name: () => tr('Desk', 'Desk', 'Desk') },
];

/** L'état d'un instant de la journée dans la table d'états : passé plein, prévu tireté, au-delà de l'horizon pointillé. */
function stateAt(ms: number, now: number, beyond: boolean): EtatStroke {
  if (ms <= now) return 'plein';
  return beyond ? 'pointille' : 'tirete';
}

/** Le tiroir, monté seulement déplié : la réponse de la barre d'état l'ouvre. */
export function FriseDrawer({ className }: { className?: string }) {
  const open = useUi((u) => u.friseOpen);
  return open ? <Drawer className={className} /> : null;
}

function Drawer({ className }: { className?: string }) {
  useI18n((st) => st.locale);
  const { answer, line, at, now, pulled, events, own } = useHourAnswer();
  const tab = useUi((u) => u.tab);
  const sessions = useJournal((j) => j.sessions);
  const planAccount = useSettings((st) => st.settings.planAccount);
  const planId = useSettings((st) => st.settings.planId);
  const rules = useSettings((st) => st.settings.traderRules);
  const canPull = (CURSOR_TABS as readonly string[]).includes(tab);
  const { span, plan, timed, windows } = answer;
  const beyond = span.day > horizonEnd(now);

  /* ─── La mesure : l'axe se pose sur la largeur des couloirs ─── */
  const lanesRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useLayoutEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const read = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const x = (ms: number) => Math.round(dayFraction(ms, span) * width * 2) / 2;

  // Déplié par la réponse : l'axe prend le focus, les flèches tirent le curseur aussitôt.
  useEffect(() => {
    if (!useObjects.getState().locked) sliderRef.current?.focus();
  }, []);

  /* ─── Ce que les couloirs lisent ─── */
  const dayTrades = useMemo(() => own.filter((t) => Number.isFinite(t.entryTime) && t.entryTime >= span.start && t.entryTime <= span.end).sort((a, b) => a.entryTime - b.entryTime), [own, span]);
  const findings = useMemo(() => (dayTrades.length ? replayDiscipline(dayTrades, events, rules, findPlan(planId), planAccount) : []), [dayTrades, events, rules, planId, planAccount]);
  const groups = useMemo(() => stemGroups(timed), [timed]);
  const stems = groupNear(groups, (g) => x(g.at), MERGE_PX);
  const ruleWindows = windows.filter((w): w is TimeWindow & { kind: 'rule' } => w.kind === 'rule');
  const lossWindows = windows.filter((w) => w.kind === 'afterLimit');
  const daySessions = sessions.filter((row) => row.date === span.day && (!planAccount || (row.account ?? '') === planAccount));

  /* ─── Les gestes, gardés par l'inertie du châssis ─── */
  const locked = () => useObjects.getState().locked;
  const setCursor = (ms: number | null) => useUi.getState().setTimeCursor(ms);
  const dragging = useRef(false);
  const place = (clientX: number) => {
    const el = lanesRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / (r.width || 1)));
    setCursor(snap(fractionToMs(frac, span)));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (locked() || event.button !== 0) return;
    sliderRef.current?.focus();
    if (!canPull) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    place(event.clientX);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current && !locked()) place(event.clientX);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  /** Entrée : l'objet sous le curseur — un trade, sinon une publication, sinon la séance de la journée. */
  const openUnder = (origin: HTMLElement) => {
    const near = (ms: number, tol: number) => Math.abs(ms - at) <= tol;
    const open = (ref: EntityRef, siblings: EntityRef[]) => useObjects.getState().openObject(ref, { origin, siblings });
    const trade = dayTrades.find((t) => near(t.entryTime, NEAR_TRADE) || near(t.exitTime, NEAR_TRADE) || (t.entryTime <= at && at <= t.exitTime));
    if (trade) return open({ type: 'trade', id: trade.id }, dayTrades.map((t) => ({ type: 'trade', id: t.id })));
    const group = groups.find((g) => near(g.at, NEAR_EVENT));
    if (group) return open({ type: 'evenement', id: group.events[0]!.id }, groups.map((g) => ({ type: 'evenement', id: g.events[0]!.id })));
    const session = daySessions[0];
    if (session) return open({ type: 'session', id: session.id }, daySessions.map((row) => ({ type: 'session', id: row.id })));
    return false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked()) return;
    const move = cursorMoveOf(event);
    if (move) {
      event.preventDefault();
      if (canPull) setCursor(moveCursor(at, move));
      return;
    }
    const hit = matchShortcut('frise', event);
    if (hit?.id === 'cursorPresent') {
      // Échap rend le présent ; au présent, replie le tiroir et rend le focus à la réponse.
      event.preventDefault();
      event.stopPropagation();
      if (pulled) setCursor(null);
      else {
        useUi.getState().setFriseOpen(false);
        document.getElementById(FRISE_ANSWER_ID)?.focus();
      }
    } else if (hit?.id === 'cursorOpen') {
      event.preventDefault();
      openUnder(event.currentTarget);
    }
  };

  /* ─── Ce qui se dessine ─── */
  const ticks = hourTicks(span);
  const nightPx = (width / 3) / 13;
  const labels = ticks.filter((t, i) => i < ticks.length - 1 && (t.hour === 7 || !t.night || nightPx >= 26 || (t.hour - 18 + 24) % 2 === 0));
  const nowIn = now >= span.start && now <= span.end;
  const headX = x(at);
  const valueText = `${etDay(at)} · ${etClock(at)} ET · ${line.label}`;
  // Une phase coupée à maintenant : ce qui a eu lieu, plein ; ce qui reste, prévu (tireté, pointillé au-delà de l'horizon).
  const ahead: EtatStroke = beyond ? 'pointille' : 'tirete';
  const phaseParts = plan.phases.flatMap((p) => {
    const split = (from: number, to: number) => (to > from ? [{ kind: p.kind, from, to }] : []);
    return [...split(p.from, Math.min(p.to, now)).map((part) => ({ ...part, etat: 'plein' as EtatStroke })), ...split(Math.max(p.from, now), p.to).map((part) => ({ ...part, etat: ahead }))];
  });

  return (
    <section id={FRISE_DRAWER_ID} className={cx(f.drawer, className)} data-frise="" aria-label={tr('Frise de la journée CME', 'CME day timeline', 'Friso de la jornada CME')}>
      <div className={f.gutter}>
        {LANE_NAMES.map((lane) => (
          <span key={lane.key} className={f.laneName} data-lane={lane.key}>
            <Glyph name={lane.glyph} className={f.laneGlyph} />
            <span>{lane.name()}</span>
          </span>
        ))}
        <span className={f.day}>
          <span className={pulled ? f.dayHeld : undefined}>{etDay(at)}</span>
          {pulled ? (
            <button type="button" className={f.present} data-present="" onClick={() => !locked() && setCursor(null)} title={tr('Revenir au présent · Échap', 'Back to the present · Esc', 'Volver al presente · Esc')}>
              {tr('Présent', 'Present', 'Presente')}
            </button>
          ) : null}
        </span>
      </div>

      <div
        ref={sliderRef}
        className={f.slider}
        tabIndex={0}
        role="slider"
        aria-label={tr('Curseur de temps de la journée CME', 'CME day time cursor', 'Cursor de tiempo de la jornada CME')}
        aria-valuemin={span.start}
        aria-valuemax={span.end}
        aria-valuenow={Math.round(at)}
        aria-valuetext={valueText}
        aria-readonly={canPull ? undefined : true}
        title={canPull ? tr('← → 5 min · Maj 1 h · Pg préc. / suiv. une journée · Échap : présent · Entrée : ouvrir', '← → 5 min · Shift 1 h · PgUp / PgDn a day · Esc: present · Enter: open', '← → 5 min · Mayús 1 h · RePág / AvPág un día · Esc: presente · Intro: abrir') : tr('Le curseur se tire dans Métrique et le Calendrier', 'The cursor is pulled in Metrics and the Calendar', 'El cursor se mueve en Métrica y el Calendario')}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={lanesRef} className={f.lanes}>
          {lossWindows.map((w) => (
            <span
              key={`h${w.from}`}
              className={f.hatch}
              style={{ left: x(w.from), width: Math.max(1, x(w.to) - x(w.from)), top: 2 * LANE + 2 }}
              title={tr(`Perte du jour au-delà de sa limite, de ${etClock(w.from)} à ${etClock(w.to)}`, `Day loss beyond its limit, from ${etClock(w.from)} to ${etClock(w.to)}`, `Pérdida del día más allá de su límite, de ${etClock(w.from)} a ${etClock(w.to)}`)}
              aria-hidden
            />
          ))}
          <svg className={f.svg} width={width} height={LANES} aria-hidden="true">
            {[1, 2, 3].map((i) => (
              <line key={`r${i}`} className={f.laneRule} x1={0} x2={width} y1={i * LANE + 0.5} y2={i * LANE + 0.5} />
            ))}
            {/* Séance : passée pleine (le RTH épais), à venir tiretée, au-delà de l'horizon pointillée, fermée éteinte. */}
            {plan.closed ? (
              <line data-mark="phase" className={cx(f.phase, e.eteint)} x1={0} x2={width} y1={Y.session} y2={Y.session} />
            ) : (
              phaseParts.map((part) => <line key={`${part.kind}${part.from}`} data-mark="phase" data-phase={part.kind} className={cx(part.kind === 'rth' ? f.phaseRth : f.phase, e[part.etat])} x1={x(part.from)} x2={x(part.to)} y1={Y.session} y2={Y.session} />)
            )}
            {/* Catalyseurs : la tige à son heure ET, le trait dit l'état de la publication ; les voisines se fondent. */}
            {stems.map((cluster) => {
              const first = cluster.rows[0]!;
              const evs = cluster.rows.flatMap((row) => row.events);
              const impact = Math.max(...cluster.rows.map((row) => row.impact));
              const etat = STROKE_ETAT[strokeOf({ date: evs[0]!.date, timeET: evs[0]!.timeET, actual: evs.some((ev) => ev.actual) ? 'x' : undefined }, now)];
              return (
                <g key={`c${first.at}`} data-impact={impact}>
                  <line data-mark="catalyst" className={cx(f.stem, e[etat])} x1={cluster.x} x2={cluster.x} y1={LANE + 1} y2={2 * LANE - 1} />
                  {impactBars(impact).map((bar, i) => (
                    <rect key={i} className={bar.on ? f.barOn : f.barOff} x={cluster.x + 6 + i * 2} y={2 * LANE - 2 - bar.height / 2} width={1.2} height={bar.height / 2} />
                  ))}
                </g>
              );
            })}
            {/* Fenêtres : ± la règle du trader autour de chaque catalyseur majeur. */}
            {ruleWindows.map((w) => {
              const etat = w.to <= now ? 'plein' : w.from <= now ? 'plein' : stateAt(w.from, now, beyond);
              return <rect key={`w${w.from}`} data-mark="window" className={cx(f.window, e[etat])} x={x(w.from)} y={2 * LANE + 3} width={Math.max(2, x(w.to) - x(w.from))} height={LANE - 6} />;
            })}
            {/* Desk : chaque trade du compte suivi, de l'entrée à la sortie ; ce qui a eu lieu est plein. */}
            {dayTrades.map((t: Trade) => (
              <line key={`t${t.id}`} data-mark="trade" className={cx(f.trade, e.plein)} x1={x(t.entryTime)} x2={Math.max(x(t.entryTime) + 2, x(Number.isFinite(t.exitTime) ? t.exitTime : t.entryTime))} y1={Y.desk} y2={Y.desk} />
            ))}
            {/* Maintenant, à l'or au présent, au graphite quand le curseur est tiré ; le curseur, à l'or. */}
            {nowIn ? <line className={pulled ? f.nowGhost : f.now} x1={x(now)} x2={x(now)} y1={0} y2={LANES} /> : null}
            {pulled ? <line className={f.cursor} data-cursor="" x1={headX} x2={headX} y1={0} y2={LANES} /> : null}
          </svg>
          {/* Les signes de la planche, posés sur leur instant : C.090 en tête de tige, C.024 pour un écart. */}
          {stems.map((cluster) => (
            <span key={`g${cluster.x}`} className={f.mark} style={{ left: cluster.x, top: Y.catalyst }} title={cluster.rows.flatMap((row) => row.events).map((ev) => `${ev.timeET ?? ''} ET · ${trEventTitle(ev.title)}`).join('\n')}>
              <Glyph name="catalyst" className={f.markGlyph} />
            </span>
          ))}
          {findings.map((row) => (
            <span key={row.id} className={f.mark} style={{ left: x(Date.parse(row.at)), top: Y.desk - 4 }} title={`${etClock(Date.parse(row.at))} ET · ${row.kind}`}>
              <Glyph name="drift" className={f.driftGlyph} />
            </span>
          ))}
          {plan.closed ? (
            <span className={f.laneText} style={{ top: 0 }}>
              {plan.closed === 'weekend' ? tr('CME fermé · week-end', 'CME closed · weekend', 'CME cerrado · fin de semana') : tr('CME fermé · férié', 'CME closed · holiday', 'CME cerrado · festivo')}
            </span>
          ) : null}
        </div>
        <div className={f.axis}>
          {ticks.map((t) => (
            <i key={`k${t.at}`} className={f.tick} style={{ left: x(t.at) }} />
          ))}
          {/* L'heure lue, à la tête de la ligne, prend la place des heures qu'elle recouvrirait. */}
          {spaced(labels.filter((t) => Math.abs(x(t.at) - headX) >= 30), (t) => x(t.at))
            .map((t) => (
              <span key={`h${t.at}`} className={f.hour} style={{ left: x(t.at) }}>
                {String(t.hour).padStart(2, '0')}
              </span>
            ))}
          <span className={cx(f.head, pulled && f.headHeld)} style={{ left: Math.min(width - 18, Math.max(18, headX)) }}>
            {etClock(at)}
          </span>
        </div>
      </div>
    </section>
  );
}
