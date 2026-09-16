import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { IconChevron, IconPlus } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Panel, Segmented, Tag, Toggle, cx } from '@/design/primitives';
import { CATEGORY_LABEL, generateNasdaqEvents, SESSION_MARKERS, type CalEvent, type EventCategory } from '@/engine/calendar';
import { fmtUsd, plural, signClass } from '@/lib/format';
import { addDays, dateKeyLocal, ET_ZONE, formatDateFr, formatTimeLocal, parseDateKey, weekday, zonedToUtc } from '@/lib/time';
import { useCalendar } from '@/store/calendar';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './calendrier.module.css';

const CAT_COLOR: Record<EventCategory, string> = {
  fed: '#c9a24d',
  emploi: '#ff3b4e',
  inflation: '#f5b84b',
  croissance: '#7fd1ff',
  sentiment: '#8b91a3',
  resultats: '#a78bfa',
  cme: '#3ddc97',
  horaire: '#5b6174',
  perso: '#f3f4f8',
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
  const sessions = useJournal((j) => j.sessions);
  const entries = useCalendar((c) => c.entries);

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
    return [...years].flatMap((y) => generateNasdaqEvents(y));
  }, [year]);

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

  return (
    <>
      <ModuleHeader
        tab="calendrier"
        actions={
          <>
            <Segmented value={view} onChange={changeView} options={[{ value: 'grille', label: 'Grille mensuelle' }, { value: 'flux', label: 'Flux chronologique' }]} />
            <Segmented value={String(minImpact) as '1' | '2' | '3'} onChange={(v) => setMinImpact(Number(v) as 1 | 2 | 3)} options={[{ value: '1', label: 'Tout' }, { value: '2', label: 'Notable +' }, { value: '3', label: 'Majeur' }]} />
            <Toggle on={showEstimated} onChange={setShowEstimated} label="Dates estimées" />
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
              <div className={s.filters}>
                {CATS.filter((c) => c !== 'perso').map((c) => (
                  <button
                    key={c}
                    className={cx(s.filterBtn, !hidden.has(c) && s.on)}
                    style={catStyle(c)}
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
                            <div key={e.id} className={cx(s.ev, e.impact === 3 && s.impact3)} style={catStyle(e.category)} title={`${e.timeET ? `${localTime(d, e.timeET)} · ` : ''}${e.title}`}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {e.estimated ? '≈ ' : ''}
                                {e.title}
                              </span>
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
                            <div key={e.id} className={s.fluxEv} style={catStyle(e.category)} onClick={() => setSelected(d)}>
                              <div className={s.fluxTime}>
                                {e.timeET ? localTime(d, e.timeET) : 'journée'}
                                {e.timeET && <small>{e.timeET} ET</small>}
                              </div>
                              <div className={cx(s.fluxTitle, e.impact === 3 && s.impact3)}>
                                {e.estimated ? '≈ ' : ''}
                                {e.title}
                              </div>
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

          <DaySide key={selected} date={selected} events={byDate.get(selected) ?? []} />
        </div>
      </ModuleContent>
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

function DaySide({ date, events }: { date: string; events: CalEvent[] }) {
  const sessions = useJournal((j) => j.sessions);
  const entries = useCalendar((c) => c.entries);
  const setDayNote = useCalendar((c) => c.setDayNote);
  const add = useCalendar((c) => c.add);
  const remove = useCalendar((c) => c.remove);
  const setTab = useUi((u) => u.setTab);
  const focusSession = useUi((u) => u.focusSession);
  const sess = sessions.find((x) => x.date === date);
  const dayEntries = entries.filter((e) => e.date === date);
  const noteEntry = dayEntries.find((e) => e.kind === 'note');
  const [note, setNote] = useState(noteEntry?.body ?? '');
  const [evTime, setEvTime] = useState('');
  const [evTitle, setEvTitle] = useState('');

  const sorted = [...events].sort((a, b) => (a.timeET ?? '00:00').localeCompare(b.timeET ?? '00:00'));

  return (
    <aside className={s.side}>
      <Panel title={formatDateFr(date, { weekday: true })} sub={plural(events.length, 'repère')} accent>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sess && (
            <div className={s.evCard} style={catStyle('cme')}>
              <div className={s.evCardHead}>
                <b>Séance du journal</b>
                <span className={cx('mono', signClass(sess.pnl))}>{fmtUsd(sess.pnl, { sign: true })}</span>
              </div>
              <div className={s.evDesc}>
                {plural(sess.tradeCount, 'trade')} · {sess.account ?? 'compte non renseigné'}
                {sess.tags.length ? ` · ${sess.tags.join(', ')}` : ''}
              </div>
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    focusSession(sess.id);
                    setTab('visual');
                  }}
                >
                  Projeter dans Visual
                </Button>
              </div>
            </div>
          )}
          {sorted.length === 0 && !sess && <div className={s.evDesc}>Journée sans catalyseur programmé : conditions « normales », se référer aux repères de séance.</div>}
          {sorted.map((e) => (
            <div key={e.id} className={s.evCard} style={catStyle(e.category)}>
              <div className={s.evCardHead}>
                <b>{e.title}</b>
                {e.timeET && (
                  <time>
                    {localTime(date, e.timeET)} <span className="dim">· {e.timeET} ET</span>
                  </time>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Impact level={e.impact} category={e.category} />
                <Tag>{CATEGORY_LABEL[e.category]}</Tag>
                {e.estimated && <Tag tone="amber">date estimée</Tag>}
              </div>
              <div className={s.evDesc}>{e.description}</div>
              {e.beginnerTip && <div className={s.tip}>{e.beginnerTip}</div>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Suivi personnel" sub="note & rappels du jour">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (noteEntry?.body ?? '') && setDayNote(date, note)} placeholder="Biais du jour, niveaux clés, intention de séance…" style={{ width: '100%', resize: 'vertical' }} />
          {dayEntries
            .filter((e) => e.kind === 'event')
            .map((e) => (
              <div key={e.id} className={s.persoItem}>
                <time>{e.time ?? '—'}</time>
                <span>{e.title}</span>
                <button onClick={() => remove(e.id)} aria-label="Supprimer">
                  ×
                </button>
              </div>
            ))}
          <div className={s.persoForm}>
            <input type="time" value={evTime} onChange={(e) => setEvTime(e.target.value)} />
            <input value={evTitle} onChange={(e) => setEvTitle(e.target.value)} placeholder="Rappel personnel (revue, coaching…)" />
            <Button
              size="sm"
              title="Ajouter le rappel"
              aria-label="Ajouter le rappel"
              onClick={async () => {
                if (!evTitle.trim()) return;
                await add({ date, kind: 'event', title: evTitle.trim(), time: evTime || undefined });
                setEvTitle('');
                setEvTime('');
              }}
            >
              <IconPlus size={12} />
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Repères de séance" sub="heure locale · New York">
        <div className={s.markers}>
          {SESSION_MARKERS.map((m) => (
            <div key={m.timeET} className={s.marker}>
              <b>{localTime(date, m.timeET)}</b>
              <small>{m.timeET} ET</small>
              <span title={m.note}>{m.label}</span>
            </div>
          ))}
        </div>
        <div className={s.legendCats} style={{ marginTop: 12 }}>
          {CATS.map((c) => (
            <span key={c} style={catStyle(c)}>
              <i />
              {CATEGORY_LABEL[c]}
            </span>
          ))}
        </div>
      </Panel>
    </aside>
  );
}
