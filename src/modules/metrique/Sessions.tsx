import { useMemo, useState } from 'react';
import { IconTrash } from '@/app/icons';
import { Button, Empty, Panel, Tag, cx, tableClass } from '@/design/primitives';
import { computeTradeStats } from '@/engine/metrics';
import type { Session, Trade } from '@/engine/types';
import { fmtInt, fmtPct, fmtPrice, fmtRatio, fmtUsd, signClass } from '@/lib/format';
import { formatDuration, formatDateFr, formatTimeLocal } from '@/lib/time';
import { useJournal } from '@/store/journal';
import { useNotes } from '@/store/notes';
import { useUi } from '@/store/ui';
import s from './metrique.module.css';

const SOURCE_LABEL: Record<Session['source'], string> = { ninjatrader: 'NinjaTrader', csv: 'CSV', manuel: 'Manuel', demo: 'Démo' };

export function Sessions() {
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<'date' | 'pnl'>('date');

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = [...sessions];
    if (q) arr = arr.filter((x) => x.date.includes(q) || (x.account ?? '').toLowerCase().includes(q) || x.tags.some((t) => t.toLowerCase().includes(q)) || (x.note ?? '').toLowerCase().includes(q));
    arr.sort((a, b) => (sort === 'date' ? b.date.localeCompare(a.date) : b.pnl - a.pnl));
    return arr;
  }, [sessions, query, sort]);

  const tradesBySession = useMemo(() => {
    const m = new Map<string, Trade[]>();
    for (const t of trades) {
      const arr = m.get(t.sessionId);
      if (arr) arr.push(t);
      else m.set(t.sessionId, [t]);
    }
    return m;
  }, [trades]);

  const current = sessions.find((x) => x.id === selected) ?? null;

  if (sessions.length === 0) return <Empty title="Aucune séance" text="Importez vos trades ou créez une séance manuelle." />;

  return (
    <div className={cx(s.split, s.splitWide)}>
      <Panel
        title="Séances"
        sub={`${list.length} affichée(s)`}
        tight
        actions={
          <>
            <input placeholder="Filtrer : date, compte, tag, note…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 240 }} />
            <Button size="sm" variant="ghost" active={sort === 'date'} onClick={() => setSort('date')}>
              Date
            </Button>
            <Button size="sm" variant="ghost" active={sort === 'pnl'} onClick={() => setSort('pnl')}>
              PnL
            </Button>
          </>
        }
      >
        <div className={s.tableWrap}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Compte</th>
                <th className="num">Trades</th>
                <th className="num">PnL net</th>
                <th className="num">Réussite</th>
                <th className="num">Comm.</th>
                <th>Tags</th>
                <th>Éval.</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => {
                const own = tradesBySession.get(x.id) ?? [];
                const wr = own.length ? own.filter((t) => t.pnl > 0).length / own.length : null;
                return (
                  <tr key={x.id} className={cx('clickable', selected === x.id && 'selected')} onClick={() => setSelected(x.id)}>
                    <td className="mono">{formatDateFr(x.date, { weekday: true, short: true })}</td>
                    <td className="muted">{x.account ?? '—'}</td>
                    <td className="num">{x.tradeCount}</td>
                    <td className={cx('num', signClass(x.pnl))}>{fmtUsd(x.pnl, { sign: true })}</td>
                    <td className="num">{wr === null ? '—' : fmtPct(wr, 0)}</td>
                    <td className="num muted">{fmtUsd(-x.commission, { cents: true })}</td>
                    <td>
                      <div className={s.tags}>
                        {x.tags.slice(0, 3).map((t) => (
                          <Tag key={t}>{t}</Tag>
                        ))}
                      </div>
                    </td>
                    <td className="gold">{x.rating ? '★'.repeat(x.rating) : ''}</td>
                    <td className="muted">{SOURCE_LABEL[x.source]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      {current ? <SessionDetail session={current} trades={tradesBySession.get(current.id) ?? []} onDeleted={() => setSelected(null)} /> : <Panel title="Détail" sub="sélectionnez une séance"><p className={s.note}>Cliquez sur une séance pour afficher ses trades, ses métriques, éditer la note, les tags et l’auto-évaluation.</p></Panel>}
    </div>
  );
}

function SessionDetail({ session, trades, onDeleted }: { session: Session; trades: Trade[]; onDeleted: () => void }) {
  const updateSession = useJournal((j) => j.updateSession);
  const deleteSession = useJournal((j) => j.deleteSession);
  const setTab = useUi((u) => u.setTab);
  const focusSession = useUi((u) => u.focusSession);
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);
  const dailyNote = useNotes((n) => n.dailyNote);
  const [note, setNote] = useState(session.note ?? '');
  const [tagInput, setTagInput] = useState('');
  const stats = useMemo(() => computeTradeStats(trades), [trades]);
  const sorted = useMemo(() => [...trades].sort((a, b) => a.exitTime - b.exitTime), [trades]);

  const key = session.id;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setNote(session.note ?? '');
  }

  const saveNote = () => {
    if (note !== (session.note ?? '')) updateSession(session.id, { note });
  };
  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (!session.tags.includes(t)) updateSession(session.id, { tags: [...session.tags, t] });
    setTagInput('');
  };
  const openJournal = async () => {
    const lines = [
      `# Journal ${session.date}`,
      '',
      `**PnL net** : ${fmtUsd(session.pnl, { sign: true, cents: true })} · **Trades** : ${session.tradeCount} · **Réussite** : ${fmtPct(stats.winRate, 0)}`,
      `**Compte** : ${session.account ?? '—'} · **Profit factor** : ${fmtRatio(stats.profitFactor)}`,
      '',
      '## Contexte',
      '',
      '',
      '## Exécution',
      '',
      ...sorted.map((t) => `- ${formatTimeLocal(t.entryTime)} ${t.direction === 'long' ? 'Long' : 'Short'} ${t.qty} ${t.instrument} @ ${fmtPrice(t.entryPrice)} → ${fmtPrice(t.exitPrice)} : ${fmtUsd(t.pnl, { sign: true, cents: true })}${t.strategy ? ` (${t.strategy})` : ''}`),
      '',
      '## Leçon du jour',
      '',
      '',
      session.note ? `> ${session.note}` : '',
      '',
      '#journal [[Plan de trading]]',
    ];
    await dailyNote(session.date, lines.join('\n'));
    setTab('note');
    toast(`Note « Journal ${session.date} » ouverte.`, 'ok');
  };

  return (
    <Panel
      title={formatDateFr(session.date, { weekday: true })}
      sub={session.account ?? SOURCE_LABEL[session.source]}
      accent
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={openJournal}>
            Note du jour
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              focusSession(session.id);
              setTab('visual');
            }}
          >
            Voir dans Visual
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (await confirmDialog(`Supprimer la séance du ${formatDateFr(session.date)} ?`, `${session.tradeCount} trade(s) seront retirés du journal. Cette action est irréversible.`)) {
                await deleteSession(session.id);
                onDeleted();
              }
            }}
            aria-label="Supprimer"
          >
            <IconTrash size={13} />
          </Button>
        </>
      }
    >
      <div className={s.rows}>
        <div className={s.detailHead}>
          <span className={cx(s.detailPnl, signClass(session.pnl))}>{fmtUsd(session.pnl, { sign: true, cents: true })}</span>
          <span className="muted">
            brut {fmtUsd(session.grossProfit + session.grossLoss, { cents: true })} · comm. {fmtUsd(-session.commission, { cents: true })}
          </span>
          <span className={s.stars} style={{ marginLeft: 'auto' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={cx(!!session.rating && session.rating >= n && s.on)} onClick={() => updateSession(session.id, { rating: session.rating === n ? undefined : n })} title={`Auto-évaluation ${n}/5`}>
                ★
              </button>
            ))}
          </span>
        </div>

        <div className={s.miniStats}>
          <MiniKv k="Réussite" v={fmtPct(stats.winRate, 0)} />
          <MiniKv k="Profit factor" v={fmtRatio(stats.profitFactor)} />
          <MiniKv k="Espérance" v={fmtUsd(stats.expectancy, { cents: true })} />
          <MiniKv k="Drawdown intra" v={fmtUsd(-stats.maxDrawdown)} />
          <MiniKv k="Durée moy." v={formatDuration(stats.avgDurationMs)} />
          <MiniKv k="Volume" v={`${fmtInt(stats.totalVolume)} ct`} />
        </div>

        <div>
          <div className="micro" style={{ marginBottom: 6 }}>
            Tags
          </div>
          <div className={s.tags}>
            {session.tags.map((t) => (
              <Tag key={t} tone="gold">
                {t}
                <button onClick={() => updateSession(session.id, { tags: session.tags.filter((x) => x !== t) })} style={{ color: 'inherit', opacity: 0.7 }} aria-label={`Retirer ${t}`}>
                  ×
                </button>
              </Tag>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              onBlur={addTag}
              placeholder="+ tag"
              style={{ height: 20, padding: '0 6px', fontSize: 11, width: 90 }}
            />
          </div>
        </div>

        <div>
          <div className="micro" style={{ marginBottom: 6 }}>
            Note de séance
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} rows={3} placeholder="Contexte, état d’esprit, erreurs, ce qui a marché…" style={{ width: '100%', resize: 'vertical' }} />
        </div>

        {sorted.length > 0 ? (
          <div className={s.tableWrap} style={{ maxHeight: 320 }}>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Entrée</th>
                  <th>Sens</th>
                  <th className="num">Qté</th>
                  <th className="num">Prix</th>
                  <th className="num">PnL</th>
                  <th className="num">MAE / MFE</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">
                      {formatTimeLocal(t.entryTime)} <span className="dim">→ {formatTimeLocal(t.exitTime)}</span>
                    </td>
                    <td>
                      <Tag tone={t.direction === 'long' ? 'mint' : 'ember'}>{t.direction === 'long' ? 'L' : 'S'}</Tag> <span className="dim">{t.instrument}</span>
                    </td>
                    <td className="num">{t.qty}</td>
                    <td className="num muted">
                      {fmtPrice(t.entryPrice)}
                      <span className="dim"> → </span>
                      {fmtPrice(t.exitPrice)}
                    </td>
                    <td className={cx('num', signClass(t.pnl))}>{fmtUsd(t.pnl, { sign: true, cents: true })}</td>
                    <td className="num muted" title={t.strategy ?? ''}>
                      {t.mae !== undefined ? fmtUsd(-t.mae) : '—'} / {t.mfe !== undefined ? fmtUsd(t.mfe) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={s.note}>Séance saisie manuellement : pas de détail par trade.</p>
        )}
      </div>
    </Panel>
  );
}

function MiniKv({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="micro">{k}</span>
      <span className="mono" style={{ color: 'var(--text-0)', fontSize: 13 }}>
        {v}
      </span>
    </div>
  );
}
