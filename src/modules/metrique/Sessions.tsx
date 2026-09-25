import { memo, useCallback, useDeferredValue, useMemo, useRef, useState, type MouseEvent } from 'react';
import { IconTrash } from '@/app/icons';
import { Button, Empty, Panel, Tag, cx, tableClass } from '@/design/primitives';
import type { Session, Trade } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { fmtInt, fmtPct, fmtPrice, fmtRatio, fmtUsd, plural, signClass } from '@/lib/format';
import { formatDuration, formatDateFr, formatTimeLocal } from '@/lib/time';
import { db } from '@/store/db';
import { useJournal } from '@/store/journal';
import { useNotes } from '@/store/notes';
import { useUi } from '@/store/ui';
import s from './metrique.module.css';
import { cachedTradeStats } from './useStats';

function sourceLabel(source: Session['source']): string {
  if (source === 'ninjatrader') return 'NinjaTrader';
  if (source === 'csv') return 'CSV';
  if (source === 'manuel') return tr('Manuel', 'Manual', 'Manual');
  return tr('Démo', 'Demo', 'Demo');
}

export function Sessions() {
  useI18n((s) => s.locale);
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const deleteSessions = useJournal((j) => j.deleteSessions);
  const restoreSessions = useJournal((j) => j.restoreSessions);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<'date' | 'pnl'>('date');
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);
  // La saisie du filtre reste fluide : la liste (jusqu'à 1000 lignes) suit avec un temps de retard.
  const deferredQuery = useDeferredValue(query);

  const list = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let arr = [...sessions];
    if (q) arr = arr.filter((x) => x.date.includes(q) || (x.account ?? '').toLowerCase().includes(q) || x.tags.some((t) => t.toLowerCase().includes(q)) || (x.note ?? '').toLowerCase().includes(q));
    arr.sort((a, b) => (sort === 'date' ? b.date.localeCompare(a.date) : b.pnl - a.pnl));
    return arr;
  }, [sessions, deferredQuery, sort]);

  const tradesBySession = useMemo(() => {
    const m = new Map<string, Trade[]>();
    for (const t of trades) {
      const arr = m.get(t.sessionId);
      if (arr) arr.push(t);
      else m.set(t.sessionId, [t]);
    }
    return m;
  }, [trades]);

  /** Taux de réussite par séance, calculé une fois par jeu de trades (pas à chaque rendu de ligne). */
  const winRateBySession = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, own] of tradesBySession) if (own.length) m.set(id, own.filter((t) => t.pnl > 0).length / own.length);
    return m;
  }, [tradesBySession]);

  const current = sessions.find((x) => x.id === selected) ?? null;
  const allVisibleChecked = list.length > 0 && list.every((x) => checked.has(x.id));
  const checkedCount = checked.size;

  // Rappel stable (lu par ref) pour que les lignes mémorisées ne se réaffichent pas à chaque rendu parent.
  const listRef = useRef(list);
  listRef.current = list;
  const lastCheckedRef = useRef(lastChecked);
  lastCheckedRef.current = lastChecked;
  const toggleOne = useCallback((id: string, e: MouseEvent) => {
    e.stopPropagation();
    const rows = listRef.current;
    const last = lastCheckedRef.current;
    setChecked((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && last) {
        const a = rows.findIndex((x) => x.id === last);
        const b = rows.findIndex((x) => x.id === id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) {
            const row = rows[i];
            if (row) next.add(row.id);
          }
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastChecked(id);
  }, []);

  const toggleAllVisible = () => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) for (const x of list) next.delete(x.id);
      else for (const x of list) next.add(x.id);
      return next;
    });
  };

  const bulkDelete = async () => {
    const ids = [...checked];
    if (!ids.length) return;
    const ok = await confirmDialog(
      tr(`Effacer ${plural(ids.length, 'séance')} ?`, `Delete ${plural(ids.length, 'session', 'sessions')}?`, `¿Borrar ${plural(ids.length, 'sesión', 'sesiones')}?`),
      tr(
        `${ids.length} séance(s) et leurs trades seront retirés du journal. Vous pourrez annuler juste après.`,
        `${ids.length} session(s) and their trades will be removed from the journal. You can undo right after.`,
        `${ids.length} sesión(es) y sus trades se quitarán del diario. Podrá deshacer justo después.`,
      ),
    );
    if (!ok) return;
    const idSet = new Set(ids);
    const snapSessions = sessions.filter((x) => idSet.has(x.id));
    const snapTrades = trades.filter((t) => idSet.has(t.sessionId));
    const snapExec = await db.importedExecutions.where('sessionId').anyOf(ids).toArray();
    await deleteSessions(ids);
    setChecked(new Set());
    if (selected && ids.includes(selected)) setSelected(null);
    toast(
      tr(
        `${plural(ids.length, 'séance')} effacée${ids.length > 1 ? 's' : ''}`,
        `${plural(ids.length, 'session', 'sessions')} deleted`,
        `${plural(ids.length, 'sesión', 'sesiones')} eliminada${ids.length > 1 ? 's' : ''}`,
      ),
      'warn',
      {
        label: tr('Annuler', 'Undo', 'Deshacer'),
        run: () => {
          void restoreSessions(snapSessions, snapTrades, snapExec).then(() => toast(tr('Séances restaurées.', 'Sessions restored.', 'Sesiones restauradas.'), 'ok'));
        },
      },
    );
  };

  if (sessions.length === 0) return <Empty title={tr('Aucune séance', 'No sessions', 'Ninguna sesión')} text={tr('Importez vos trades ou créez une séance manuelle.', 'Import your trades or create a manual session.', 'Importe sus trades o cree una sesión manual.')} />;

  return (
    <div className={cx(s.split, s.splitWide)}>
      <Panel
        title={tr('Séances', 'Sessions', 'Sesiones')}
        sub={plural(list.length, tr('affichée', 'shown', 'mostrada'), tr('affichées', 'shown', 'mostradas'))}
        tight
        actions={
          <>
            <input
              type="search"
              placeholder={tr('Filtrer : date, compte, tag, note…', 'Filter: date, account, tag, note…', 'Filtrar: fecha, cuenta, tag, nota…')}
              aria-label={tr('Filtrer les séances', 'Filter sessions', 'Filtrar las sesiones')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 220 }}
            />
            <Button size="sm" variant="ghost" active={sort === 'date'} onClick={() => setSort('date')}>
              {tr('Date', 'Date', 'Fecha')}
            </Button>
            <Button size="sm" variant="ghost" active={sort === 'pnl'} onClick={() => setSort('pnl')}>
              PnL
            </Button>
            {checkedCount > 0 && (
              <span className={s.selCount}>
                {checkedCount} {checkedCount > 1 ? tr('cochées', 'checked', 'marcadas') : tr('cochée', 'checked', 'marcada')}
              </span>
            )}
          </>
        }
      >
        {checkedCount > 0 && (
          <div className={s.bulkBar}>
            <span>
              {plural(checkedCount, tr('séance cochée', 'checked session', 'sesión marcada'), tr('séances cochées', 'checked sessions', 'sesiones marcadas'))}.{' '}
              {tr('L’effacement demande une confirmation, puis peut être annulé.', 'Deletion requires confirmation, then can be undone.', 'El borrado pide confirmación y luego puede deshacerse.')}
            </span>
            <Button size="sm" variant="danger" onClick={() => void bulkDelete()}>
              <IconTrash size={12} /> {tr('Effacer la sélection', 'Delete selection', 'Borrar la selección')}
            </Button>
          </div>
        )}
        <div className={s.tableWrap}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={s.checkCol}>
                  <input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} aria-label={tr('Tout sélectionner', 'Select all', 'Seleccionar todo')} />
                </th>
                <th>{tr('Date', 'Date', 'Fecha')}</th>
                <th>{tr('Compte', 'Account', 'Cuenta')}</th>
                <th className="num">Trades</th>
                <th className="num">{tr('PnL net', 'Net PnL', 'PnL neto')}</th>
                <th className="num">{tr('Réussite', 'Win rate', 'Acierto')}</th>
                <th className="num">{tr('Comm.', 'Comm.', 'Com.')}</th>
                <th>Tags</th>
                <th>{tr('Éval.', 'Rating', 'Eval.')}</th>
                <th>{tr('Source', 'Source', 'Fuente')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <SessionRow key={x.id} session={x} winRate={winRateBySession.get(x.id) ?? null} selected={selected === x.id} checked={checked.has(x.id)} onSelect={setSelected} onToggle={toggleOne} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {current ? (
        <SessionDetail
          key={current.id}
          session={current}
          trades={tradesBySession.get(current.id) ?? []}
          onDeleted={() => {
            setSelected(null);
            setChecked((prev) => {
              const next = new Set(prev);
              next.delete(current.id);
              return next;
            });
          }}
        />
      ) : (
        <Panel title={tr('Détail', 'Detail', 'Detalle')} sub={tr('sélectionnez une séance', 'select a session', 'seleccione una sesión')}>
          <p className={s.note}>{tr('Cliquez sur une séance pour afficher ses trades. Cochez une ou plusieurs lignes pour les effacer en lot.', 'Click a session to show its trades. Check one or more rows to delete them in bulk.', 'Haga clic en una sesión para ver sus trades. Marque una o varias filas para borrarlas en lote.')}</p>
        </Panel>
      )}
    </div>
  );
}

/** Ligne mémorisée : seules les lignes dont la séance, la sélection ou la coche changent se réaffichent. */
const SessionRow = memo(function SessionRow({
  session: x,
  winRate,
  selected,
  checked,
  onSelect,
  onToggle,
}: {
  session: Session;
  winRate: number | null;
  selected: boolean;
  checked: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, e: MouseEvent) => void;
}) {
  useI18n((s) => s.locale);
  return (
    <tr className={cx('clickable', selected && 'selected', checked && s.rowChecked)} onClick={() => onSelect(x.id)} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(x.id)}>
      <td className={s.checkCol} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={() => undefined} onClick={(e) => onToggle(x.id, e)} aria-label={`${tr('Sélectionner', 'Select', 'Seleccionar')} ${x.date}`} />
      </td>
      <td className="mono">{formatDateFr(x.date, { weekday: true, short: true })}</td>
      <td className="muted">{x.account ?? '—'}</td>
      <td className="num">{x.tradeCount}</td>
      <td className={cx('num', signClass(x.pnl))}>{fmtUsd(x.pnl, { sign: true })}</td>
      <td className="num">{winRate === null ? '—' : fmtPct(winRate, 0)}</td>
      <td className="num muted">{fmtUsd(-x.commission, { cents: true })}</td>
      <td>
        <div className={s.tags}>
          {x.tags.slice(0, 3).map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      </td>
      <td className="gold">{x.rating ? '★'.repeat(x.rating) : ''}</td>
      <td className="muted">{sourceLabel(x.source)}</td>
    </tr>
  );
});

function SessionDetail({ session, trades, onDeleted }: { session: Session; trades: Trade[]; onDeleted: () => void }) {
  useI18n((s) => s.locale);
  const updateSession = useJournal((j) => j.updateSession);
  const deleteSession = useJournal((j) => j.deleteSession);
  const setTab = useUi((u) => u.setTab);
  const focusSession = useUi((u) => u.focusSession);
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);
  const dailyNote = useNotes((n) => n.dailyNote);
  const [note, setNote] = useState(session.note ?? '');
  const [tagInput, setTagInput] = useState('');
  const stats = useMemo(() => cachedTradeStats(trades), [trades]);
  const sorted = useMemo(() => [...trades].sort((a, b) => a.exitTime - b.exitTime), [trades]);
  const net = trades.length ? trades.reduce((sum, t) => sum + t.pnl, 0) : session.pnl;
  const comm = trades.length ? trades.reduce((sum, t) => sum + (t.commission || 0), 0) : session.commission;
  const brut = net + comm;

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
      `# ${tr('Journal', 'Journal', 'Diario')} ${session.date}`,
      '',
      `**${tr('PnL net', 'Net PnL', 'PnL neto')}** : ${fmtUsd(session.pnl, { sign: true, cents: true })} · **Trades** : ${session.tradeCount} · **${tr('Réussite', 'Win rate', 'Acierto')}** : ${fmtPct(stats.winRate, 0)}`,
      `**${tr('Compte', 'Account', 'Cuenta')}** : ${session.account ?? '—'} · **Profit factor** : ${fmtRatio(stats.profitFactor)}`,
      '',
      `## ${tr('Contexte', 'Context', 'Contexto')}`,
      '',
      '',
      `## ${tr('Exécution', 'Execution', 'Ejecución')}`,
      '',
      ...sorted.map((t) => `- ${formatTimeLocal(t.entryTime)} ${t.direction === 'long' ? 'Long' : 'Short'} ${t.qty} ${t.instrument} @ ${fmtPrice(t.entryPrice)} → ${fmtPrice(t.exitPrice)} : ${fmtUsd(t.pnl, { sign: true, cents: true })}${t.strategy ? ` (${t.strategy})` : ''}`),
      '',
      `## ${tr('Leçon du jour', 'Lesson of the day', 'Lección del día')}`,
      '',
      '',
      session.note ? `> ${session.note}` : '',
      '',
      `#journal [[${tr('Plan de trading', 'Trading plan', 'Plan de trading')}]]`,
    ];
    await dailyNote(session.date, lines.join('\n'));
    setTab('note');
    toast(tr(`Note « Journal ${session.date} » ouverte.`, `Note “Journal ${session.date}” opened.`, `Nota « Diario ${session.date} » abierta.`), 'ok');
  };

  return (
    <Panel
      title={formatDateFr(session.date, { weekday: true })}
      sub={session.account ?? sourceLabel(session.source)}
      accent
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={openJournal}>
            {tr('Note du jour', 'Daily note', 'Nota del día')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              focusSession(session.id);
              setTab('visual');
            }}
          >
            {tr('Voir dans Visual', 'View in Visual', 'Ver en Visual')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (
                await confirmDialog(
                  tr(`Supprimer la séance du ${formatDateFr(session.date)} ?`, `Delete the session of ${formatDateFr(session.date)}?`, `¿Eliminar la sesión del ${formatDateFr(session.date)}?`),
                  tr(
                    `${session.tradeCount} trade(s) seront retirés du journal. Cette action est irréversible.`,
                    `${session.tradeCount} trade(s) will be removed from the journal. This action cannot be undone.`,
                    `${session.tradeCount} trade(s) se quitarán del diario. Esta acción es irreversible.`,
                  ),
                )
              ) {
                await deleteSession(session.id);
                onDeleted();
              }
            }}
            aria-label={tr('Supprimer la séance', 'Delete session', 'Eliminar la sesión')}
            title={tr('Supprimer la séance', 'Delete session', 'Eliminar la sesión')}
          >
            <IconTrash size={13} />
          </Button>
        </>
      }
    >
      <div className={s.rows}>
        <div className={s.detailHead}>
          <span className={cx(s.detailPnl, signClass(net))}>{fmtUsd(net, { sign: true, cents: true })}</span>
          <span className="muted">
            {tr('net', 'net', 'neto')} {fmtUsd(net, { cents: true })} · {tr('brut', 'gross', 'bruto')} {fmtUsd(brut, { cents: true })} · {tr('comm.', 'comm.', 'com.')} {fmtUsd(-comm, { cents: true })}
          </span>
          <span className={s.stars} style={{ marginLeft: 'auto' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={cx(!!session.rating && session.rating >= n && s.on)}
                onClick={() => updateSession(session.id, { rating: session.rating === n ? undefined : n })}
                title={tr(`Auto-évaluation ${n}/5`, `Self-rating ${n}/5`, `Autoevaluación ${n}/5`)}
                aria-label={tr(`Auto-évaluation ${n}/5`, `Self-rating ${n}/5`, `Autoevaluación ${n}/5`)}
                aria-pressed={session.rating === n}
              >
                ★
              </button>
            ))}
          </span>
        </div>

        <div className={s.miniStats}>
          <MiniKv k={tr('Réussite', 'Win rate', 'Acierto')} v={fmtPct(stats.winRate, 0)} />
          <MiniKv k="Profit factor" v={fmtRatio(stats.profitFactor)} />
          <MiniKv k={tr('Espérance', 'Expectancy', 'Esperanza')} v={fmtUsd(stats.expectancy, { cents: true })} />
          <MiniKv k={tr('Drawdown intra', 'Intraday drawdown', 'Drawdown intra')} v={fmtUsd(-stats.maxDrawdown)} />
          <MiniKv k={tr('Durée moy.', 'Avg duration', 'Dur. media')} v={formatDuration(stats.avgDurationMs)} />
          <MiniKv k={tr('Volume', 'Volume', 'Volumen')} v={`${fmtInt(stats.totalVolume)} ct`} />
        </div>

        <div>
          <div className="micro" style={{ marginBottom: 6 }}>
            Tags
          </div>
          <div className={s.tags}>
            {session.tags.map((t) => (
              <Tag key={t} tone="gold">
                {t}
                <button onClick={() => updateSession(session.id, { tags: session.tags.filter((x) => x !== t) })} style={{ color: 'inherit', opacity: 0.7 }} aria-label={`${tr('Retirer', 'Remove', 'Quitar')} ${t}`}>
                  ×
                </button>
              </Tag>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              onBlur={addTag}
              placeholder={tr('+ tag', '+ tag', '+ etiqueta')}
              style={{ height: 28, padding: '0 6px', fontSize: 11, width: 90 }}
            />
          </div>
        </div>

        <div>
          <div className="micro" style={{ marginBottom: 6 }}>
            {tr('Note de séance', 'Session note', 'Nota de sesión')}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            rows={3}
            placeholder={tr('Contexte, état d’esprit, erreurs, ce qui a marché…', 'Context, mindset, mistakes, what worked…', 'Contexto, estado de ánimo, errores, lo que funcionó…')}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>

        {sorted.length > 0 ? (
          <div className={s.tableWrap} style={{ maxHeight: 320 }}>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>{tr('Entrée', 'Entry', 'Entrada')}</th>
                  <th>{tr('Sens · qté', 'Side · qty', 'Sentido · cant.')}</th>
                  <th className="num">{tr('Prix', 'Price', 'Precio')}</th>
                  <th className="num">PnL</th>
                  <th className="num">MAE / MFE</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.id}>
                    <td className="mono" style={{ lineHeight: 1.25 }}>
                      {formatTimeLocal(t.entryTime)}
                      <br />
                      <span className="dim">→ {formatTimeLocal(t.exitTime)}</span>
                    </td>
                    <td>
                      <Tag tone={t.direction === 'long' ? 'mint' : 'ember'}>
                        {t.direction === 'long' ? 'L' : 'S'} {t.qty}
                      </Tag>{' '}
                      <span className="dim">{t.instrument}</span>
                    </td>
                    <td className="num muted" style={{ lineHeight: 1.25 }}>
                      {fmtPrice(t.entryPrice)}
                      <br />
                      <span className="dim">→ {fmtPrice(t.exitPrice)}</span>
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
          <p className={s.note}>{tr('Séance saisie manuellement : pas de détail par trade.', 'Manually entered session: no per-trade detail.', 'Sesión introducida manualmente: sin detalle por trade.')}</p>
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
