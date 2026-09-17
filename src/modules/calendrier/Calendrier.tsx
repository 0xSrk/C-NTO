import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent } from 'react';
import { IconChevron, IconPlus } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Modal } from '@/design/Modal';
import { Button, Panel, Segmented, Tag, Toggle, cx } from '@/design/primitives';
import { CATEGORY_HELP, CATEGORY_LABEL, generateNasdaqEvents, SESSION_MARKERS, type CalEvent, type EventCategory } from '@/engine/calendar';
import { mergeCalendarEvents, surpriseTone } from '@/engine/macroMerge';
import { fmtUsd, plural, signClass } from '@/lib/format';
import { addDays, dateKeyLocal, ET_ZONE, formatDateFr, formatTimeLocal, parseDateKey, weekday, zonedToUtc } from '@/lib/time';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useMacro } from '@/store/macro';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './calendrier.module.css';

const CAT_COLOR: Record<EventCategory, string> = {
  fed: '#c41e3a',
  emploi: '#e0776c',
  inflation: '#d8b45a',
  croissance: '#8fc7e8',
  sentiment: '#8a8a8a',
  resultats: '#a996e0',
  cme: '#7fcf9a',
  horaire: '#6c6c6c',
  perso: '#ffffff',
};
const CATS = Object.keys(CAT_COLOR) as EventCategory[];
const DOW = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
function localTime(date: string, timeET?: string): string | null {
  if (!timeET) return null;
  return formatTimeLocal(zonedToUtc(date, timeET, ET_ZONE));
}

function catStyle(c: EventCategory): CSSProperties {
  return { '--cat': CAT_COLOR[c] } as CSSProperties;
}

export default function Calendrier() {
  const today = dateKeyLocal(new Date());
  const settingsView = useSettings((st) => st.settings.calendarView);
  const updateSettings = useSettings((st) => st.update);
  const [view, setView] = useState<'grille' | 'flux'>(settingsView);
  const [cursor, setCursor] = useState(() => today.slice(0, 7));
  const focusDate = useUi((u) => u.focusDate);
  const [selected, setSelected] = useState<string>(focusDate ?? today);
  const [hidden, setHidden] = useState<Set<EventCategory>>(new Set());
  const [showEstimated, setShowEstimated] = useState(true);
  const [minImpact, setMinImpact] = useState<1 | 2 | 3>(1);
  const [helpCat, setHelpCat] = useState<EventCategory | null>(null);
  const sessions = useJournal((j) => j.sessions);
  const entries = useCalendar((c) => c.entries);
  const toast = useUi((u) => u.toast);
  const releases = useMacro((m) => m.releases);
  const syncing = useMacro((m) => m.syncing);
  const lastSource = useMacro((m) => m.lastSource);
  const lastError = useMacro((m) => m.lastError);
  const loadMacro = useMacro((m) => m.load);
  const syncMacro = useMacro((m) => m.sync);

  useEffect(() => {
    void loadMacro().then(() => syncMacro());
  }, [loadMacro, syncMacro]);

  useEffect(() => {
    if (focusDate) {
      setSelected(focusDate);
      setCursor(focusDate.slice(0, 7));
    }
  }, [focusDate]);

  const changeView = (v: 'grille' | 'flux') => {
    setView(v);
    updateSettings({ calendarView: v });
  };

  const [year, month] = cursor.split('-').map(Number);
  const events = useMemo(() => {
    const years = new Set([year - 1, year, year + 1]);
    const local = [...years].flatMap((y) => generateNasdaqEvents(y));
    return mergeCalendarEvents(local, releases);
  }, [year, releases]);

  const visible = useMemo(() => events.filter((e) => !hidden.has(e.category) && (showEstimated || !e.estimated) && e.impact >= minImpact), [events, hidden, showEstimated, minImpact]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of visible) {
      const arr = m.get(e.date);
      if (arr) arr.push(e);
      else m.set(e.date, [e]);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.impact - a.impact || (a.timeET ?? '99').localeCompare(b.timeET ?? '99'));
    return m;
  }, [visible]);
  const sessionByDate = useMemo(() => new Map(sessions.map((x) => [x.date, x])), [sessions]);
  const entriesByDate = useMemo(() => {
    const m = new Map<string, typeof entries>();
    for (const e of entries) {
      const arr = m.get(e.date);
      if (arr) arr.push(e);
      else m.set(e.date, [e]);
    }
    return m;
  }, [entries]);

  const history = useMemo(
    () =>
      releases
        .filter((r) => r.actual != null && r.actual !== '' && r.date <= today)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.timeET ?? '').localeCompare(a.timeET ?? ''))
        .slice(0, 40),
    [releases, today],
  );

  const gridDays = useMemo(() => {
    const first = `${cursor}-01`;
    const offset = (weekday(first) + 6) % 7;
    const start = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor]);

  const fluxDays = useMemo(() => {
    const start = view === 'flux' ? (cursor === today.slice(0, 7) ? addDays(today, -((weekday(today) + 6) % 7)) : `${cursor}-01`) : today;
    const end = cursor === today.slice(0, 7) ? addDays(start, 41) : addDays(`${cursor}-01`, new Date(year, month, 0).getDate() - 1);
    const days: string[] = [];
    let d = start;
    while (d <= end) {
      if (weekday(d) !== 0 && weekday(d) !== 6) days.push(d);
      d = addDays(d, 1);
    }
    return days;
  }, [cursor, today, view, year, month]);

  const monthLabel = parseDateKey(`${cursor}-01`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const shift = (n: number) => {
    const d = new Date(year, month - 1 + n, 1);
    setCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const sourceLabel = lastSource === 'investing' ? 'Investing.com' : lastSource === 'forexfactory' ? 'Forex Factory' : 'hors ligne';

  return (
    <>
      <ModuleHeader
        tab="calendrier"
        actions={
          <>
            <Segmented value={view} onChange={changeView} options={[{ value: 'grille', label: 'Grille mensuelle' }, { value: 'flux', label: 'Flux chronologique' }]} />
            <Segmented value={String(minImpact) as '1' | '2' | '3'} onChange={(v) => setMinImpact(Number(v) as 1 | 2 | 3)} options={[{ value: '1', label: 'Tout' }, { value: '2', label: 'Notable +' }, { value: '3', label: 'Majeur' }]} />
            <Toggle on={showEstimated} onChange={setShowEstimated} label="Dates estimées" />
            <Button
              size="sm"
              variant="ghost"
              disabled={syncing}
              onClick={async () => {
                await syncMacro(addDays(`${cursor}-01`, -10), addDays(`${cursor}-28`, 20));
                const st = useMacro.getState();
                if (st.lastError && st.lastSource === 'none') toast(st.lastError, 'warn');
                else toast(`Macro · ${st.lastSource === 'investing' ? 'Investing.com' : st.lastSource === 'forexfactory' ? 'Forex Factory' : '—'} · ${st.releases.length} publications`, 'ok');
              }}
            >
              {syncing ? 'Sync…' : 'Sync Investing'}
            </Button>
          </>
        }
      />
      <ModuleContent>
        <div className={s.layout}>
          <div className={s.main}>
            <div className={s.toolbar}>
              <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Mois précédent">
                <IconChevron size={12} style={{ transform: 'rotate(180deg)' }} />
              </Button>
              <span className={s.monthTitle}>{monthLabel}</span>
              <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Mois suivant">
                <IconChevron size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCursor(today.slice(0, 7));
                  setSelected(today);
                }}
              >
                Aujourd’hui
              </Button>
              <span className={s.feedStatus} title={lastError ?? undefined}>
                Fil {sourceLabel}
                {lastError ? ' · partiel' : ''}
              </span>
              <div className={s.filters}>
                {CATS.filter((c) => c !== 'perso').map((c) => (
                  <span key={c} className={cx(s.filterChip, !hidden.has(c) && s.on)} style={catStyle(c)}>
                    <button
                      type="button"
                      className={s.filterBtn}
                      onClick={() =>
                        setHidden((h) => {
                          const n = new Set(h);
                          if (n.has(c)) n.delete(c);
                          else n.add(c);
                          return n;
                        })
                      }
                    >
                      <i /> {CATEGORY_LABEL[c]}
                    </button>
                    <button
                      type="button"
                      className={s.helpDot}
                      aria-label={`Aide : ${CATEGORY_LABEL[c]}`}
                      title="Aide débutant"
                      onClick={(e: MouseEvent) => {
                        e.stopPropagation();
                        setHelpCat(c);
                      }}
                    >
                      ?
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {view === 'grille' ? (
              <>
                <div className={cx(s.grid, s.dow)} style={{ flex: 'none' }}>
                  {DOW.map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                <div className={s.grid}>
                  {gridDays.map((d) => {
                    const evs = byDate.get(d) ?? [];
                    const sess = sessionByDate.get(d);
                    const wd = weekday(d);
                    const holiday = evs.some((e) => e.category === 'horaire' && e.title.includes('CME fermé'));
                    const hasNote = (entriesByDate.get(d) ?? []).length > 0;
                    return (
                      <div key={d} className={cx(s.day, (wd === 0 || wd === 6) && s.weekend, !d.startsWith(cursor) && s.outside, d === today && s.today, d === selected && s.selected, holiday && s.holiday)} onClick={() => setSelected(d)}>
                        <div className={s.dayHead}>
                          <span className={s.dayNum}>{Number(d.slice(-2))}</span>
                          {sess && <span className={cx(s.dayPnl, signClass(sess.pnl))}>{fmtUsd(sess.pnl, { sign: true })}</span>}
                        </div>
                        <div className={s.evs}>
                          {evs.slice(0, 3).map((e) => (
                            <div key={e.id} className={cx(s.ev, e.impact === 3 && s.impact3, e.actual && s.evPublished)} style={catStyle(e.category)} title={`${e.timeET ? `${localTime(d, e.timeET)} · ` : ''}${e.title}${e.actual ? ` · publié ${e.actual}` : e.forecast ? ` · attendu ${e.forecast}` : ''}`}>
                              <span className={s.evTitle}>
                                {e.actual ? '' : e.estimated ? '≈ ' : ''}
                                {e.title}
                              </span>
                              <LinePrint e={e} />
                            </div>
                          ))}
                          {evs.length > 3 && <span className={s.more}>+{evs.length - 3}</span>}
                        </div>
                        {hasNote && <i className={s.noteDot} />}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className={s.flux}>
                {fluxDays.map((d) => {
                  const evs = byDate.get(d) ?? [];
                  const sess = sessionByDate.get(d);
                  const perso = entriesByDate.get(d) ?? [];
                  return (
                    <div key={d} className={cx(s.fluxDay, d === selected && s.selected)}>
                      <div className={cx(s.fluxDayHead, d === today && s.today)} onClick={() => setSelected(d)}>
                        <b>{formatDateFr(d, { weekday: true, short: true })}</b>
                        {sess ? <span className={signClass(sess.pnl)}>{fmtUsd(sess.pnl, { sign: true })} · {plural(sess.tradeCount, 'trade')}</span> : <span>{evs.length ? plural(evs.length, 'repère') : 'calme'}</span>}
                      </div>
                      <div className={s.fluxEvents}>
                        {evs.length === 0 && perso.length === 0 && <div className={s.fluxEmpty}>Aucun catalyseur programmé.</div>}
                        {[...evs]
                          .sort((a, b) => (a.timeET ?? '00:00').localeCompare(b.timeET ?? '00:00'))
                          .map((e) => (
                            <div key={e.id} className={cx(s.fluxEv, e.actual && s.evPublished)} style={catStyle(e.category)} onClick={() => setSelected(d)}>
                              <div className={s.fluxTime}>
                                {e.timeET ? localTime(d, e.timeET) : 'journée'}
                                {e.timeET && <small>{e.timeET} ET</small>}
                              </div>
                              <div className={cx(s.fluxTitle, e.impact === 3 && s.impact3)}>
                                {e.estimated ? '≈ ' : ''}
                                {e.title}
                              </div>
                              <LinePrint e={e} detailed />
                              <Impact level={e.impact} category={e.category} />
                            </div>
                          ))}
                        {perso.map((p) => (
                          <div key={p.id} className={s.fluxEv} style={catStyle('perso')} onClick={() => setSelected(d)}>
                            <div className={s.fluxTime}>{p.time ?? (p.kind === 'note' ? 'note' : 'journée')}</div>
                            <div className={s.fluxTitle}>{p.kind === 'note' ? p.body?.slice(0, 90) : p.title}</div>
                            <Tag>perso</Tag>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DaySide key={selected} date={selected} events={byDate.get(selected) ?? []} history={history} onSelectDate={setSelected} onHelp={setHelpCat} />
        </div>
      </ModuleContent>

      {helpCat && (
        <Modal title={CATEGORY_LABEL[helpCat]} sub="Repère débutant" onClose={() => setHelpCat(null)} width={440}>
          <div className={s.helpBody}>
            <p className={s.helpLead}>{CATEGORY_HELP[helpCat].lead}</p>
            <ul className={s.helpList}>
              {CATEGORY_HELP[helpCat].points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </Modal>
      )}
    </>
  );
}

function Impact({ level, category }: { level: number; category: EventCategory }) {
  return (
    <span className={s.impactBar} style={catStyle(category)} title={`Impact ${level}/3`}>
      {[1, 2, 3].map((i) => (
        <i key={i} className={cx(i <= level && s.on)} />
      ))}
    </span>
  );
}

/** Résultat / attendu sur la ligne — lecture immédiate une fois publié. */
function LinePrint({ e, detailed }: { e: CalEvent; detailed?: boolean }) {
  if (!e.forecast && !e.previous && !e.actual) return null;
  const tone = surpriseTone(e.actual, e.forecast);
  if (e.actual != null && e.actual !== '') {
    return (
      <span className={cx(s.linePrint, s.published, tone && s[tone])} title={e.forecast ? `Attendu ${e.forecast} → Publié ${e.actual}` : `Publié ${e.actual}`}>
        {detailed && e.forecast ? <em>{e.forecast} → </em> : null}
        <b>{e.actual}</b>
      </span>
    );
  }
  if (e.forecast) {
    return (
      <span className={cx(s.linePrint, s.awaiting)} title={`Attendu ${e.forecast}`}>
        ≈{e.forecast}
      </span>
    );
  }
  return null;
}

function Prints({ e }: { e: CalEvent }) {
  if (!e.forecast && !e.previous && !e.actual) return null;
  const tone = surpriseTone(e.actual, e.forecast);
  return (
    <div className={s.prints}>
      <span>
        <em>Attendu</em> {e.forecast ?? '—'}
      </span>
      <span>
        <em>Préc.</em> {e.previous ?? '—'}
      </span>
      <span className={tone ? s[tone] : undefined}>
        <em>Publié</em> {e.actual ?? '—'}
      </span>
    </div>
  );
}

function DaySide({
  date,
  events,
  history,
  onSelectDate,
  onHelp,
}: {
  date: string;
  events: CalEvent[];
  history: ReturnType<typeof useMacro.getState>['releases'];
  onSelectDate: (d: string) => void;
  onHelp: (c: EventCategory) => void;
}) {
  const sessions = useJournal((j) => j.sessions);
  const entries = useCalendar((c) => c.entries);
  const setDayNote = useCalendar((c) => c.setDayNote);
  const add = useCalendar((c) => c.add);
  const remove = useCalendar((c) => c.remove);
  const setTab = useUi((u) => u.setTab);
  const focusSession = useUi((u) => u.focusSession);
  const toast = useUi((u) => u.toast);
  const sess = sessions.find((x) => x.date === date);
  const dayEntries = entries.filter((e) => e.date === date);
  const noteEntry = dayEntries.find((e) => e.kind === 'note');
  const [note, setNote] = useState(noteEntry?.body ?? '');
  const [noteSaved, setNoteSaved] = useState(false);
  const [evTime, setEvTime] = useState('');
  const [evTitle, setEvTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    setNote(noteEntry?.body ?? '');
  }, [noteEntry?.body, noteEntry?.id]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const body = noteRef.current;
      if (body !== (noteEntry?.body ?? '')) void setDayNote(date, body);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save pending draft on unmount / day change
  }, [date]);

  const queueNoteSave = (value: string) => {
    setNote(value);
    setNoteSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void setDayNote(date, value).then(() => setNoteSaved(true));
    }, 400);
  };

  const flushNote = async (announce: boolean) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await setDayNote(date, note);
    setNoteSaved(true);
    if (announce) toast('Note du jour enregistrée', 'ok');
  };

  const addReminder = async (e?: FormEvent) => {
    e?.preventDefault();
    const title = evTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await add({ date, kind: 'event', title, time: evTime || undefined });
      setEvTitle('');
      setEvTime('');
      toast('Rappel ajouté', 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Impossible d’ajouter le rappel', 'error');
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...events].sort((a, b) => (a.timeET ?? '00:00').localeCompare(b.timeET ?? '00:00'));

  return (
    <aside className={s.side}>
      <Panel title={formatDateFr(date, { weekday: true })} sub={plural(events.length, 'repère')} accent tight>
        <div className={s.sideStack}>
          {sess && (
            <div className={s.evCard} style={catStyle('cme')}>
              <div className={s.evCardHead}>
                <b>Séance</b>
                <span className={cx('mono', signClass(sess.pnl))}>{fmtUsd(sess.pnl, { sign: true })}</span>
              </div>
              <div className={s.evDesc}>
                {plural(sess.tradeCount, 'trade')}
                {sess.account ? ` · ${sess.account}` : ''}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  focusSession(sess.id);
                  setTab('visual');
                }}
              >
                Projeter Visual
              </Button>
            </div>
          )}
          {sorted.length === 0 && !sess && <div className={s.evDesc}>Aucun catalyseur — conditions « normales ».</div>}
          {sorted.map((e) => (
            <div key={e.id} className={cx(s.evCard, e.actual && s.evPublished)} style={catStyle(e.category)}>
              <div className={s.evCardHead}>
                <b>{e.title}</b>
                {e.timeET && (
                  <time>
                    {localTime(date, e.timeET)}
                  </time>
                )}
              </div>
              <div className={s.evMeta}>
                <Impact level={e.impact} category={e.category} />
                <button type="button" className={s.catHelp} onClick={() => onHelp(e.category)} title={`Aide : ${CATEGORY_LABEL[e.category]}`}>
                  {CATEGORY_LABEL[e.category]} <span>?</span>
                </button>
                {e.actual != null && e.actual !== '' && <Tag tone="mint">publié</Tag>}
                {e.estimated && <Tag tone="amber">estimé</Tag>}
              </div>
              <Prints e={e} />
              {e.description && !e.actual && !e.forecast && <div className={s.evDesc}>{e.description}</div>}
            </div>
          ))}
        </div>
      </Panel>

      <section className={s.sideBlock}>
        <header className={s.sideBlockHead}>
          <h4>Perso</h4>
          <span>note · rappels</span>
        </header>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => queueNoteSave(e.target.value)}
          onBlur={() => void flushNote(false).catch(() => undefined)}
          placeholder="Biais, niveaux, intention…"
          className={s.noteArea}
        />
        <div className={s.noteActions}>
          <Button size="sm" variant="ghost" onClick={() => void flushNote(true)}>
            Enregistrer
          </Button>
          {noteSaved && <span className={s.noteOk}>OK</span>}
        </div>
        {dayEntries
          .filter((e) => e.kind === 'event')
          .map((e) => (
            <div key={e.id} className={s.persoItem}>
              <time>{e.time ?? '—'}</time>
              <span>{e.title}</span>
              <button type="button" onClick={() => void remove(e.id)} aria-label="Supprimer">
                ×
              </button>
            </div>
          ))}
        <form className={s.persoForm} onSubmit={(ev) => void addReminder(ev)}>
          <input type="time" value={evTime} onChange={(e) => setEvTime(e.target.value)} aria-label="Heure du rappel" />
          <input value={evTitle} onChange={(e) => setEvTitle(e.target.value)} placeholder="Rappel…" aria-label="Titre du rappel" />
          <Button size="sm" type="submit" title="Ajouter" aria-label="Ajouter le rappel" disabled={busy || !evTitle.trim()}>
            <IconPlus size={12} />
          </Button>
        </form>
      </section>

      <section className={s.sideBlock}>
        <header className={s.sideBlockHead}>
          <h4>Publiés</h4>
          <span>fil macro</span>
        </header>
        <div className={s.history}>
          {history.length === 0 && <div className={s.evDesc}>Sync Investing pour l’historique.</div>}
          {history.slice(0, 18).map((r) => {
            const tone = surpriseTone(r.actual, r.forecast);
            return (
              <button key={r.id} type="button" className={s.histRow} onClick={() => onSelectDate(r.date)}>
                <time>{r.date.slice(5)}</time>
                <span className={s.histTitle}>{r.title.replace(/^U\.S\.\s+/i, '')}</span>
                <span className={cx(s.histVals, tone && s[tone])}>
                  {r.forecast ? <em>{r.forecast}→</em> : null}
                  <b>{r.actual}</b>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={s.sideBlock}>
        <header className={s.sideBlockHead}>
          <h4>Séance</h4>
          <span>locale · ET</span>
        </header>
        <div className={s.markersCompact}>
          {SESSION_MARKERS.map((m) => (
            <div key={m.timeET} className={s.markerCompact} title={m.note}>
              <b>{localTime(date, m.timeET)}</b>
              <span>{m.label}</span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
