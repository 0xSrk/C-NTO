import { useEffect, useMemo, useState } from 'react';
import { Glyph, Signal } from '@/design/Micro';
import { calendarSourcesState, type CalendarSources } from '@/engine/bornes';
import type { CalEvent } from '@/engine/calendar';
import { dailyLimit } from '@/engine/discipline';
import { findPlan } from '@/engine/propfirm';
import { tr, useI18n } from '@/i18n';
import { cmeSession } from '@/lib/cmeClosed';
import { trEventTitle } from '@/lib/eventTitles';
import { catalystSource } from '@/engine/macroMerge';
import { addDays, dateTimeFormatter, ET_ZONE, etDateKey } from '@/lib/time';
import { daySpan, hourAt, isWeekday, MIN, nextCatalyst, type Boundary, type HourAnswer, type InForce, type InForceKind } from '@/lib/frise';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { useSettings } from '@/store/settings';
import { useKillSwitch } from './killState';
import { etClock, shortDay } from './objects/index';
import { BORNES_TICK_MS, useDayBornes } from './useDayBornes';
import s from './shell.module.css';

/**
 * La réponse du temps, au bout de la ligne de la journée (OROS5.23, Système 5 « Fiche et Frise » ; repris du prototype
 * C · Frise, d3) : ce qui borne l'heure qui vient, tiré du modèle pur de la frise (`hourAt`, `src/lib/frise.ts`). D'abord
 * ce qui est en vigueur — C.123 « soumission fermée », « perte du jour atteinte depuis 10:56 », « fenêtre ± 15 · CPI
 * jusqu'à 08:45 » —, sinon ce qui vient et son délai — « 20 min · 09:30 Ouverture RTH » —, puis sa source : « calendrier
 * local · estimé ». L'heure est celle de New York (décision 7). L'axe des heures n'entre pas dans la barre : il vit dans le
 * tiroir de la frise. La journée CME n'est que celle de la frise : l'« aujourd'hui » du rail et du Calendrier reste la
 * date locale.
 *
 * La perte du jour n'est dite en vigueur que tant que la perte relue reste au moins égale à la limite, comme la garde la
 * relit à chaque entrée (`dailyLossReached`), latent négatif du pont compris : la frise ne dit jamais « en vigueur » pour
 * une perte que la garde laisserait passer. Lecture seule.
 */

/** Ce que dit la réponse : ce qui vaut, ce qui vient dans l'heure, le prochain catalyseur majeur, ou rien. */
export type FriseLineKind = InForceKind | 'ahead' | 'next' | 'none';

/** La source d'une réponse tirée du calendrier : le calendrier local (estimé ou non) ou l'officiel. */
export interface FriseSource {
  kind: 'local' | 'official';
  estimated: boolean;
}

export interface FriseLine {
  kind: FriseLineKind;
  /** Le délai de ce qui vient : « 20 min », « 1 h 05 », « 3 j », « maintenant ». */
  delay: string | null;
  /** Ce qui vaut ou ce qui vient, dans la langue du desk ; puis sa forme courte, à l'étroit. */
  text: string;
  short: string;
  source: FriseSource | null;
  /** Le nom accessible complet : la ligne, ce qui vaut d'autre, la source, l'heure de New York. */
  label: string;
}

/** Un délai : « maintenant », « 20 min », « 1 h 05 », « 3 j ». */
export function delayText(ms: number): string {
  const m = Math.round(Math.max(0, ms) / MIN);
  if (m < 1) return tr('maintenant', 'now', 'ahora');
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  const d = Math.round(m / (24 * 60));
  return tr(`${d} j`, `${d} d`, `${d} d`);
}

/** Le nom d'une publication dans la langue du desk ; plusieurs à la même minute, réunies. */
const titles = (events: readonly CalEvent[] | undefined) => (events ?? []).map((event) => trEventTitle(event.title)).join(' · ');

/** La source d'une publication : un repère local (estimé ou non), sinon l'officiel. */
function sourceOf(event: CalEvent | undefined): FriseSource | null {
  if (!event) return null;
  return event.source === 'local' ? { kind: 'local', estimated: event.estimated === true } : { kind: 'official', estimated: false };
}

/** La source, en mots. */
export function sourceText(source: FriseSource): string {
  if (source.kind === 'official') return tr('calendrier officiel', 'official calendar', 'calendario oficial');
  return source.estimated ? tr('calendrier local · estimé', 'local calendar · estimated', 'calendario local · estimado') : tr('calendrier local', 'local calendar', 'calendario local');
}

/** Le jour de la semaine et la date d'un instant, à New York, comme la barre d'état les écrit : « dim 01.11 », « Sun 11/01 ». */
function etDay(ms: number): string {
  const weekday = dateTimeFormatter({ weekday: 'short', timeZone: ET_ZONE }).format(ms).replace(/\./g, '');
  return `${weekday} ${shortDay(etDateKey(ms))}`;
}

/** La prochaine ouverture de Globex après une journée fermée : 18:00 ET la veille d'une séance. */
function reopenAfter(day: string): number {
  let d = day;
  for (let i = 0; i < 10; i++) {
    d = addDays(d, 1);
    if (isWeekday(d) && !cmeSession(d).closed) return daySpan(d).start;
  }
  return daySpan(addDays(day, 1)).start;
}

/** Ce qui vaut, en mots : la forme entière et la courte. */
function inForceWords(item: InForce, day: string): { text: string; short: string } {
  switch (item.kind) {
    case 'kill':
      // La bande du kill switch dit le reste (jusqu'au redémarrage, les comptes à aplatir) : la réponse dit ce qui vaut.
      return { text: tr('Soumission fermée', 'Submission closed', 'Envío cerrado'), short: tr('Soumission fermée', 'Submission closed', 'Envío cerrado') };
    case 'lossReached':
      if (item.since === undefined)
        return { text: tr('Perte du jour atteinte · latent compris', 'Day loss reached · open P&L included', 'Pérdida del día alcanzada · latente incluido'), short: tr('Perte atteinte · latent', 'Loss reached · open', 'Pérdida alcanzada · latente') };
      return {
        text: tr(`Perte du jour atteinte depuis ${etClock(item.since)}`, `Day loss reached since ${etClock(item.since)}`, `Pérdida del día alcanzada desde ${etClock(item.since)}`),
        short: tr(`Perte atteinte · ${etClock(item.since)}`, `Loss reached · ${etClock(item.since)}`, `Pérdida alcanzada · ${etClock(item.since)}`),
      };
    case 'window': {
      const name = titles(item.event ? [item.event] : []);
      const until = etClock(item.until ?? 0);
      return {
        text: tr(`Fenêtre ± ${item.minutes} · ${name} jusqu’à ${until}`, `± ${item.minutes} window · ${name} until ${until}`, `Ventana ± ${item.minutes} · ${name} hasta ${until}`),
        short: tr(`± ${item.minutes} · ${name} · ${until}`, `± ${item.minutes} · ${name} · ${until}`, `± ${item.minutes} · ${name} · ${until}`),
      };
    }
    case 'closed': {
      const reopen = reopenAfter(day);
      const when = `${etDay(reopen)} ${etClock(reopen)}`;
      const why = item.closed === 'weekend' ? tr('week-end', 'weekend', 'fin de semana') : tr('férié', 'holiday', 'festivo');
      return { text: tr(`CME fermé · ${why} · reprise ${when}`, `CME closed · ${why} · reopens ${when}`, `CME cerrado · ${why} · reapertura ${when}`), short: tr(`CME fermé · ${when}`, `CME closed · ${when}`, `CME cerrado · ${when}`) };
    }
    case 'pause': {
      const until = etClock(item.until ?? 0);
      return { text: tr(`Pause du CME · reprise ${until}`, `CME pause · reopens ${until}`, `Pausa del CME · reapertura ${until}`), short: tr(`Pause · ${until}`, `Pause · ${until}`, `Pausa · ${until}`) };
    }
  }
}

/** Le nom d'une borne à venir. */
export function boundaryWords(b: Boundary): string {
  switch (b.kind) {
    case 'catalyst':
      return titles(b.events ?? (b.event ? [b.event] : []));
    case 'windowOpen':
      return tr(`Fenêtre ± ${b.minutes} · ${titles(b.event ? [b.event] : [])}`, `± ${b.minutes} window · ${titles(b.event ? [b.event] : [])}`, `Ventana ± ${b.minutes} · ${titles(b.event ? [b.event] : [])}`);
    case 'windowClose':
      return tr(`Fin de fenêtre · ${titles(b.event ? [b.event] : [])}`, `Window ends · ${titles(b.event ? [b.event] : [])}`, `Fin de ventana · ${titles(b.event ? [b.event] : [])}`);
    case 'rthOpen':
      return tr('Ouverture RTH', 'RTH open', 'Apertura RTH');
    case 'rthReopen':
      return tr('Fin de la pause déjeuner', 'Lunch pause ends', 'Fin de la pausa del almuerzo');
    case 'lunch':
      return tr('Pause déjeuner', 'Lunch pause', 'Pausa del almuerzo');
    case 'moc':
      return tr('Clôture cash (MOC)', 'Cash close (MOC)', 'Cierre cash (MOC)');
    case 'rthClose':
      return tr('Clôture RTH', 'RTH close', 'Cierre RTH');
    case 'globexClose':
      return tr('Fermeture Globex', 'Globex close', 'Cierre Globex');
  }
}

/**
 * La ligne de la réponse, à l'instant lu : ce qui vaut d'abord (le premier, dans l'ordre de la frise : le kill switch en
 * tête), sinon ce qui vient dans l'heure et son délai, sinon le prochain catalyseur majeur, sinon rien. Pur.
 */
export function friseLine(answer: HourAnswer, ctx: { at: number; events: readonly CalEvent[]; sources: CalendarSources }): FriseLine {
  const day = answer.span.day;
  const ny = tr('heure de New York', 'New York time', 'hora de Nueva York');
  const partial = ctx.sources === 'complete' ? '' : tr(', sources officielles incomplètes', ', official sources incomplete', ', fuentes oficiales incompletas');
  const close = (text: string, source: FriseSource | null) => `${text}${source ? `, ${sourceText(source)}` : ''}${partial}, ${ny}`;
  const [first, ...others] = answer.inForce;
  if (first) {
    const words = inForceWords(first, day);
    const source = first.kind === 'window' ? sourceOf(first.event) : null;
    const said = first.kind === 'kill' ? tr('Soumission fermée jusqu’au redémarrage du desk', 'Submission closed until the desk restarts', 'Envío cerrado hasta el reinicio del desk') : words.text;
    const also = others.map((item) => inForceWords(item, day).text);
    return { kind: first.kind, delay: null, text: words.text, short: words.short, source, label: close([said, ...also].join(' ; '), source) };
  }
  const next = answer.ahead[0];
  if (next) {
    const delay = delayText(next.delayMs);
    const text = `${etClock(next.at)} ${boundaryWords(next)}`;
    const source = sourceOf(next.event);
    return { kind: 'ahead', delay, text, short: text, source, label: close(`${delay} · ${text}`, source) };
  }
  const major = nextCatalyst(ctx.events, ctx.at);
  if (major) {
    const delay = delayText(major.at - ctx.at);
    const same = major.event.date === day;
    const text = `${same ? '' : `${etDay(major.at)} `}${etClock(major.at)} ${trEventTitle(major.event.title)}`;
    const source = sourceOf(major.event);
    return {
      kind: 'next',
      delay,
      text,
      short: trEventTitle(major.event.title),
      source,
      label: close(tr(`Rien ne borne l’heure qui vient ; prochain majeur dans ${delay} : ${text}`, `Nothing bounds the coming hour; next major in ${delay}: ${text}`, `Nada acota la próxima hora; próximo mayor en ${delay}: ${text}`), source),
    };
  }
  const none = tr('Rien ne borne l’heure qui vient', 'Nothing bounds the coming hour', 'Nada acota la próxima hora');
  return { kind: 'none', delay: null, text: none, short: tr('Rien dans l’heure', 'Nothing this hour', 'Nada en la hora'), source: null, label: close(none, null) };
}

/**
 * Les publications que la frise lit à l'instant `at` : la source unique du catalyseur (OROS5.13), sur l'année de l'instant
 * et la suivante (le prochain majeur peut tomber en janvier), et la veille d'un 1er janvier (la journée CME commence la
 * veille à 18:00 ET).
 */
export function useFriseEvents(at: number): CalEvent[] {
  const official = useMacro((m) => m.events);
  const year = Number(etDateKey(at).slice(0, 4));
  const first = Number(etDateKey(at - 86_400_000).slice(0, 4));
  return useMemo(() => catalystSource(official, [first, year, year + 1]), [official, first, year]);
}

/** L'horloge de la réponse : elle parle en minutes, un tic toutes les 15 s suffit. */
function useTick(): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), BORNES_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return Math.max(tick, Date.now());
}

/**
 * La réponse de la frise à l'instant lu, depuis les stores du desk : la source unique du catalyseur, les trades du compte
 * suivi (comme la garde : `limitAccount`), la limite du jour retenue, le kill switch, et le latent négatif du pont tel
 * que la garde le lit (les bornes du jour : nom exact du compte suivi).
 */
export function useHourAnswer(): { answer: HourAnswer; line: FriseLine; at: number } {
  useI18n((st) => st.locale);
  const now = useTick();
  const events = useFriseEvents(now);
  const trades = useJournal((j) => j.trades);
  const planAccount = useSettings((st) => st.settings.planAccount);
  const planId = useSettings((st) => st.settings.planId);
  const userPlans = useSettings((st) => st.settings.userPlans);
  const rules = useSettings((st) => st.settings.traderRules);
  const kill = useKillSwitch().engaged;
  const bornes = useDayBornes();
  const official = useMacro((m) => m.events);
  const sources = useMacro((m) => m.sources);
  const lastError = useMacro((m) => m.lastError);
  const own = useMemo(() => trades.filter((t) => !planAccount || (t.account ?? '') === planAccount), [trades, planAccount]);
  // `userPlans` : un plan saisi change ce que rend `findPlan`.
  const limit = useMemo(() => dailyLimit(rules, findPlan(planId))?.amount ?? null, [rules, planId, userPlans]);
  const unrealized = bornes.day.live ? (bornes.loss.unrealized ?? 0) : 0;
  const at = now;
  const answer = useMemo(() => hourAt({ at, now, events, trades: own, rules, limit, kill, unrealized }), [at, now, events, own, rules, limit, kill, unrealized]);
  const line = friseLine(answer, { at, events, sources: calendarSourcesState(sources, lastError, official.length) });
  return { answer, line, at };
}

/** La réponse, au bout de la ligne de la journée : ce qui vaut, ou ce qui vient et son délai, puis sa source. */
export function FriseAnswer() {
  const { answer, line } = useHourAnswer();
  return (
    <span className={s.answer} data-status="answer" data-answer={line.kind} data-day={answer.span.day} aria-label={line.label} title={line.label}>
      {line.kind === 'kill' ? <Signal level={3} className={s.answerSignal} /> : null}
      {line.delay ? <b className={s.answerDelay}>{line.delay}</b> : null}
      {line.delay ? <span className={s.answerDot}> · </span> : null}
      <span className={s.answerLong}>{line.text}</span>
      <span className={s.answerShort} aria-hidden>
        {line.short}
      </span>
      {line.source ? (
        <span className={s.answerSource} data-source={line.source.kind}>
          {line.source.kind === 'local' ? <Glyph name="partial" className={s.answerGlyph} /> : null}
          <span className={s.answerSourceText}>
            {line.source.kind === 'local' ? '' : ' · '}
            {sourceText(line.source)}
          </span>
        </span>
      ) : null}
    </span>
  );
}
