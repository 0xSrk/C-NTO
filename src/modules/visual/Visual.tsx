import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Modal } from '@/design/Modal';
import { Button, Empty, Field, Progress, Tag } from '@/design/primitives';
import { INDICATORS, indicatorById, type IndicatorInstance, type IndicatorLine } from '@/engine/indicators';
import type { Bar } from '@/engine/bars';
import { DEFAULT_FUTURE, listInstruments } from '@/engine/instruments';
import { createPort, type Nt8Transport } from '@/engine/marketdata';
import type { Instrument } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { desk, openTextFile } from '@/lib/desk';
import { fmtInt, fmtPrice, fmtUsd, plural, signClass } from '@/lib/format';
import { dateKeyLocal, formatDateFr, formatTimeLocal } from '@/lib/time';
import { useBars } from '@/store/bars';
import { useBridge } from '@/store/bridge';
import { deskEventLog } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useUi } from '@/store/ui';
import { Chart, type HoverInfo } from './Chart';
import { IndicatorCards, trIndicatorDesc, trIndicatorName } from './IndicatorCards';
import { contractsSeen } from './ntContract';
import { NtFollowPanel, shownSource, useNtFollow } from './NtFollowPanel';
import s from './visual.module.css';

/** Ports démo et CSV : toute la série, sans borne. Le pont, lui, demande une fenêtre finie (`historyWindow`). */
const HISTORY_SPAN = { from: 0, to: Number.MAX_SAFE_INTEGER } as const;

/** Contrats des exécutions reçues du pont pendant ce lancement, la plus récente d'abord. */
function recentFills(): string[] {
  return deskEventLog
    .read({ kinds: ['fill'], limit: 200 })
    .events.map((event) => event.data.instrument)
    .filter((name): name is string => typeof name === 'string')
    .reverse();
}

async function demoBars(timeframe: number, opts?: { days?: number; endDate?: string }): Promise<Bar[]> {
  const port = createPort('demo', { demo: { days: opts?.days ?? 12, endDate: opts?.endDate } });
  try {
    if (!port.history) throw new Error('Port démo sans historique');
    return await port.history({ instrument: DEFAULT_FUTURE, timeframe, ...HISTORY_SPAN });
  } finally {
    port.dispose();
  }
}

function seriesLabel(label: string): string {
  return label.replaceAll('démo synthétique', tr('démo synthétique', 'synthetic demo', 'demo sintética'));
}

interface IndicatorCacheEntry {
  bars: Bar[];
  paramsKey: string;
  lines: IndicatorLine[];
}

/**
 * Lignes d'indicateur mémorisées par instance (id + barres + paramètres) : modifier un
 * indicateur ne recalcule pas les autres, et les lignes inchangées gardent leur référence
 * (le graphique saute alors le setData, voir Chart.tsx).
 */
function useIndicatorLines(bars: Bar[] | null, indicators: IndicatorInstance[]): IndicatorLine[] {
  const cache = useRef<Map<string, IndicatorCacheEntry>>(new Map());
  return useMemo(() => {
    if (!bars) return [];
    const out: IndicatorLine[] = [];
    const seen = new Set<string>();
    for (const inst of indicators) {
      if (!inst.visible) continue;
      const def = indicatorById(inst.definitionId);
      if (!def) continue;
      seen.add(inst.id);
      const paramsKey = `${inst.definitionId}|${JSON.stringify(inst.params)}`;
      let entry = cache.current.get(inst.id);
      if (!entry || entry.bars !== bars || entry.paramsKey !== paramsKey) {
        const res = def.compute(bars, inst.params);
        entry = { bars, paramsKey, lines: res.lines.map((l) => ({ ...l, key: `${inst.id}:${l.key}` })) };
        cache.current.set(inst.id, entry);
      }
      out.push(...entry.lines);
    }
    for (const id of cache.current.keys()) if (!seen.has(id)) cache.current.delete(id);
    return out;
  }, [bars, indicators]);
}

export default function Visual() {
  useI18n((s) => s.locale);
  const ready = useBars((b) => b.ready);
  const series = useBars((b) => b.series);
  const activeId = useBars((b) => b.activeId);
  const indicators = useBars((b) => b.indicators);
  const load = useBars((b) => b.load);
  const setActive = useBars((b) => b.setActive);
  const saveDemoSeries = useBars((b) => b.saveDemoSeries);
  const importCsv = useBars((b) => b.importCsv);
  const remove = useBars((b) => b.remove);
  const addIndicator = useBars((b) => b.addIndicator);
  const updateIndicator = useBars((b) => b.updateIndicator);
  const toggleIndicator = useBars((b) => b.toggleIndicator);
  const removeIndicator = useBars((b) => b.removeIndicator);
  const ntFeed = useBars((b) => b.ntFeed);
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const focusSessionId = useUi((u) => u.focusSessionId);
  const focusSession = useUi((u) => u.focusSession);
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sessionPick, setSessionPick] = useState<string>('');
  const nt = useBridge((b) => b.nt);

  useEffect(() => {
    if (!ready) load();
  }, [ready, load]);

  const active = series.find((sr) => sr.id === activeId) ?? null;
  const session = sessions.find((x) => x.id === (focusSessionId ?? sessionPick)) ?? null;
  const sessionTrades = useMemo(() => (session ? trades.filter((t) => t.sessionId === session.id).sort((a, b) => a.entryTime - b.entryTime) : []), [session, trades]);
  const recentSessions = useMemo(() => [...sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200), [sessions]);
  const regeneratedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!session || !active || active.source !== 'demo' || active.bars.length === 0) return;
    // Comparaison sur les clés de date : une séance datée d'un week-end ne relance pas la génération en boucle.
    const firstBar = active.bars[0];
    const lastBar = active.bars[active.bars.length - 1];
    if (!firstBar || !lastBar) return;
    const firstKey = dateKeyLocal(new Date(firstBar.time * 1000));
    const lastKey = dateKeyLocal(new Date(lastBar.time * 1000));
    if (session.date >= firstKey && session.date <= lastKey) return;
    if (regeneratedFor.current === session.date) return;
    regeneratedFor.current = session.date;
    demoBars(active.timeframe, { endDate: session.date, days: 6 })
      .then((bars) => saveDemoSeries(bars, active.timeframe, session.date))
      .then(() =>
        toast(
          tr(
            `Barres de démonstration régénérées autour du ${formatDateFr(session.date, { short: true })}.`,
            `Demo bars regenerated around ${formatDateFr(session.date, { short: true })}.`,
            `Barras de demostración regeneradas en torno al ${formatDateFr(session.date, { short: true })}.`,
          ),
          'info',
        ),
      );
  }, [session, active, saveDemoSeries, toast]);

  const feed = desk?.marketdata;
  const transport = feed?.history ? (feed as Nt8Transport) : undefined;
  const seen = useMemo(() => contractsSeen(nt?.accounts ?? [], recentFills()), [nt]);
  const follow = useNtFollow({ instrument: active?.instrument ?? null, timeframe: active?.timeframe ?? null, transport, seen });

  const chartBars = follow.bars ?? active?.bars ?? null;
  const source = active ? shownSource(active.source, follow.following) : null;
  const lines = useIndicatorLines(chartBars, indicators);

  const onHover = useCallback((info: HoverInfo | null) => setHover(info), []);
  const firstBar = chartBars?.[0];
  const lastBar = chartBars?.[chartBars.length - 1];
  const shownBar = hover?.bar ?? lastBar ?? null;
  const barDateKey = (time: number) => dateKeyLocal(new Date(time * 1000));

  const removeActive = async () => {
    if (!active) return;
    const ok = await confirmDialog(
      tr(`Supprimer la série « ${seriesLabel(active.label)} » ?`, `Delete the series “${seriesLabel(active.label)}”?`, `¿Eliminar la serie « ${seriesLabel(active.label)} »?`),
      tr(
        `${fmtInt(active.bars.length)} barres importées seront retirées du coffre. Cette action est irréversible.`,
        `${fmtInt(active.bars.length)} imported bars will be removed from the vault. This action cannot be undone.`,
        `${fmtInt(active.bars.length)} barras importadas se quitarán de la caja. Esta acción es irreversible.`,
      ),
    );
    if (!ok) return;
    await remove(active.id);
    toast(tr('Série supprimée.', 'Series deleted.', 'Serie eliminada.'), 'warn');
  };

  return (
    <>
      <ModuleHeader
        tab="visual"
        actions={
          <>
            {source === 'nt8' && ntFeed === 'stale' && <Tag tone="ember">{tr('données périmées', 'stale data', 'datos caducados')}</Tag>}
            {source === 'nt8' && ntFeed === 'live' && <Tag tone="mint">{tr('direct', 'live', 'directo')}</Tag>}
            <select value={activeId ?? ''} onChange={(e) => setActive(e.target.value)} style={{ minWidth: 260 }}>
              {series.map((sr) => (
                <option key={sr.id} value={sr.id}>
                  {seriesLabel(sr.label)} · {plural(sr.bars.length, tr('barre', 'bar', 'barra'), tr('barres', 'bars', 'barras'))}
                </option>
              ))}
            </select>
          </>
        }
        options={[
          { id: 'importer', label: tr('Importer des barres', 'Import bars', 'Importar barras'), glyph: 'arrowImport', onSelect: () => setImportOpen(true) },
          {
            id: 'demo',
            label: tr('Régénérer la démo', 'Regenerate the demo', 'Regenerar la demo'),
            title: tr('Régénérer des barres synthétiques', 'Regenerate synthetic bars', 'Regenerar barras sintéticas'),
            onSelect: () => void demoBars(5, { days: 12 }).then((bars) => saveDemoSeries(bars, 5)).then(() => toast(tr('Démo régénérée.', 'Demo regenerated.', 'Demo regenerada.'), 'ok')),
          },
          ...(active && active.source !== 'demo' ? [{ id: 'supprimer', group: true, label: tr('Supprimer la série', 'Delete series', 'Eliminar la serie'), tone: 'ember' as const, onSelect: () => void removeActive() }] : []),
        ]}
      />
      <ModuleContent noPad>
        <div className={s.layout}>
          <div className={s.chartWrap}>
            {ready && !active && (
              <div style={{ padding: 24 }}>
                <Empty
                  title={tr('Aucune série de barres', 'No bar series', 'Ninguna serie de barras')}
                  text={tr('Importez un export OHLCV NinjaTrader ou régénérez le jeu synthétique pour afficher le graphique.', 'Import a NinjaTrader OHLCV export or regenerate the synthetic set to display the chart.', 'Importe una exportación OHLCV de NinjaTrader o regenere el juego sintético para mostrar el gráfico.')}
                  action={
                    <Button variant="gold" onClick={() => demoBars(5, { days: 12 }).then((bars) => saveDemoSeries(bars, 5))}>
                      {tr('Générer la démo', 'Generate demo', 'Generar la demo')}
                    </Button>
                  }
                />
              </div>
            )}
            {active && (
              <>
                <div className={s.legend}>
                  <div className={s.legendMain}>
                    <b>{follow.following ? follow.contract : active.instrument} · {active.timeframe}m</b>
                    {shownBar && (
                      <>
                        <span>{formatDateFr(barDateKey(shownBar.time), { short: true })} {formatTimeLocal(shownBar.time * 1000)}</span>
                        <span>
                          O <b className={signClass(shownBar.close - shownBar.open)}>{fmtPrice(shownBar.open)}</b> H <b>{fmtPrice(shownBar.high)}</b> L <b>{fmtPrice(shownBar.low)}</b> C <b className={signClass(shownBar.close - shownBar.open)}>{fmtPrice(shownBar.close)}</b>
                        </span>
                        <span>Vol {fmtInt(shownBar.volume)}</span>
                      </>
                    )}
                  </div>
                  {hover && hover.values.length > 0 && (
                    <div className={s.legendRow}>
                      {hover.values
                        .filter((v) => v.value !== null)
                        .slice(0, 8)
                        .map((v) => (
                          <span key={v.key}>
                            <i style={{ background: v.color }} />
                            {v.label} <b>{fmtPrice(v.value)}</b>
                          </span>
                        ))}
                    </div>
                  )}
                </div>
                <div className={s.stamp}>
                  {source === 'nt8' ? (
                    <Tag tone="mint">{tr('Données NinjaTrader', 'NinjaTrader data', 'Datos NinjaTrader')}</Tag>
                  ) : source === 'demo' ? (
                    <Tag tone="amber">{tr('Données synthétiques · démo', 'Synthetic data · demo', 'Datos sintéticos · demo')}</Tag>
                  ) : (
                    <Tag tone="ice">{tr('Import CSV', 'CSV import', 'Importación CSV')}</Tag>
                  )}
                </div>
                <Chart bars={chartBars ?? []} timeframe={active.timeframe} lines={lines} trades={sessionTrades} onHover={onHover} />
              </>
            )}
          </div>

          <aside className={s.side}>
            <IndicatorCards
              instances={indicators}
              catalog={INDICATORS}
              nameOf={trIndicatorName}
              descOf={trIndicatorDesc}
              onAdd={addIndicator}
              onToggle={toggleIndicator}
              onUpdate={updateIndicator}
              onRemove={removeIndicator}
            />

            <div className={s.sideSection}>
              <div className={s.sideTitle}>
                <span>{tr('Séance projetée', 'Projected session', 'Sesión proyectada')}</span>
                {session && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      focusSession(null);
                      setSessionPick('');
                    }}
                  >
                    {tr('Retirer', 'Clear', 'Quitar')}
                  </Button>
                )}
              </div>
              <select
                value={session?.id ?? ''}
                onChange={(e) => {
                  focusSession(null);
                  setSessionPick(e.target.value);
                }}
              >
                <option value="">{tr('— choisir une séance du journal —', '— pick a journal session —', '— elegir una sesión del diario —')}</option>
                {recentSessions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {formatDateFr(x.date, { weekday: true, short: true })} · {plural(x.tradeCount, tr('trade', 'trade', 'trade'), tr('trades', 'trades', 'trades'))} · {fmtUsd(x.pnl, { sign: true })}
                  </option>
                ))}
              </select>
              {session ? (
                <div className={s.session}>
                  <div className={s.desc}>
                    {plural(sessionTrades.length, tr('trade projeté', 'projected trade', 'trade proyectado'), tr('trades projetés', 'projected trades', 'trades proyectados'))}
                    {tr(' en marqueurs : flèche = entrée (L/S), cercle = sortie avec PnL. ', ' as markers: arrow = entry (L/S), circle = exit with PnL. ', ' en marcadores: flecha = entrada (L/S), círculo = salida con PnL. ')}
                    {source === 'demo' && tr('Les bougies étant synthétiques, seuls les horaires sont significatifs.', 'Since candles are synthetic, only the timestamps are meaningful.', 'Al ser las velas sintéticas, solo los horarios son significativos.')}
                  </div>
                  {sessionTrades.map((t) => (
                      <div key={t.id} className={s.tradeRow}>
                        <span>{formatTimeLocal(t.entryTime)}</span>
                        <span>
                          {t.direction === 'long' ? 'L' : 'S'} {t.qty} {t.instrument} @ {fmtPrice(t.entryPrice)}
                        </span>
                        <span className={signClass(t.pnl)}>{fmtUsd(t.pnl, { sign: true })}</span>
                      </div>
                  ))}
                </div>
              ) : (
                <div className={s.desc}>{tr('Depuis Métrique › Séances, « Voir dans Visual » projette les trades d’une journée sur le graphique.', 'From Metrics › Sessions, “View in Visual” projects a day’s trades onto the chart.', 'Desde Métrica › Sesiones, « Ver en Visual » proyecta los trades de un día en el gráfico.')}</div>
              )}
            </div>

            <div className={s.sideSection}>
              <div className={s.sideTitle}>
                <span>{tr('Source', 'Source', 'Fuente')}</span>
              </div>
              <div className={s.desc}>
                {active ? (
                  <>
                    {follow.following ? `${follow.contract} · ${active.timeframe} min · NinjaTrader` : seriesLabel(active.label)} — {fmtInt(chartBars?.length ?? 0)} {tr('barres', 'bars', 'barras')}, {tr('du', 'from', 'del')} {firstBar ? formatDateFr(barDateKey(firstBar.time), { short: true }) : '—'} {tr('au', 'to', 'al')} {lastBar ? formatDateFr(barDateKey(lastBar.time), { short: true }) : '—'}.
                  </>
                ) : (
                  tr('Aucune série.', 'No series.', 'Ninguna serie.')
                )}
                <br />
                {tr('Export NinjaTrader : Tools › Historical Data › Export (format texte : ', 'NinjaTrader export: Tools › Historical Data › Export (text format: ', 'Exportación NinjaTrader: Tools › Historical Data › Export (formato texto: ')}
                <code>yyyyMMdd HHmmss;O;H;L;C;V</code>
                {tr(') ou tout CSV OHLCV.', ') or any OHLCV CSV.', ') o cualquier CSV OHLCV.')}
              </div>
            </div>

            <NtFollowPanel follow={follow} disabled={!active} />
          </aside>
        </div>
      </ModuleContent>
      {importOpen && (
        <ImportBarsModal
          onClose={() => setImportOpen(false)}
          onImport={async (text, name, instrument, timeframe, opts) => {
            const port = createPort('csv', { csvText: text });
            try {
              const r = await importCsv(port, text, name, instrument, timeframe, opts);
              toast(r.bars ? tr(`${fmtInt(r.bars)} barres importées.`, `${fmtInt(r.bars)} bars imported.`, `${fmtInt(r.bars)} barras importadas.`) : r.warnings.join(' '), r.bars ? 'ok' : 'warn');
              if (r.bars) setImportOpen(false);
            } finally {
              port.dispose();
            }
          }}
        />
      )}
    </>
  );
}

function ImportBarsModal({ onClose, onImport }: { onClose: () => void; onImport: (text: string, name: string, instrument: Instrument, timeframe: number, opts?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }) => Promise<void> }) {
  useI18n((s) => s.locale);
  const [instrument, setInstrument] = useState<Instrument>('NQ');
  const [timeframe, setTimeframe] = useState(5);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const toast = useUi((u) => u.toast);

  const cancel = () => abortRef.current?.abort();
  // Fermeture pendant un import : le worker est interrompu, plus aucun setState après démontage.
  useEffect(() => () => abortRef.current?.abort(), []);

  const pick = async () => {
    const f = await openTextFile('.csv,.txt');
    if (!f) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setProgress(0);
    try {
      await onImport(f.text, f.name, instrument, timeframe, {
        signal: ac.signal,
        onProgress: (done, total) => {
          if (!ac.signal.aborted) setProgress(total ? done / total : 0);
        },
      });
      if (!ac.signal.aborted) setProgress(1);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') toast(tr('Import annulé.', 'Import cancelled.', 'Importación anulada.'), 'info');
      else toast(e instanceof Error ? e.message : tr('Import impossible.', 'Import failed.', 'Importación imposible.'), 'error');
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <Modal
      title={tr('Importer des barres OHLCV', 'Import OHLCV bars', 'Importar barras OHLCV')}
      sub={tr('NinjaTrader · Historical Data · Export', 'NinjaTrader · Historical Data · Export', 'NinjaTrader · Historical Data · Export')}
      onClose={onClose}
      dismissable={!busy}
      width={480}
      footer={
        <>
          {busy ? (
            <Button variant="ghost" onClick={cancel}>
              {tr('Annuler', 'Cancel', 'Cancelar')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              {tr('Annuler', 'Cancel', 'Cancelar')}
            </Button>
          )}
          <Button variant="gold" disabled={busy} onClick={() => void pick()}>
            {tr('Choisir un fichier', 'Choose a file', 'Elegir un archivo')}
          </Button>
        </>
      }
    >
      {busy && <Progress value={progress} tone="gold" />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label={tr('Instrument', 'Instrument', 'Instrumento')}>
          <select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
            {listInstruments({ assetClass: 'future' }).map((spec) => (
              <option key={spec.symbol} value={spec.symbol}>
                {spec.symbol}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Unité (minutes)', 'Unit (minutes)', 'Unidad (minutos)')}>
          <input type="number" min={1} max={1440} value={timeframe} onChange={(e) => setTimeframe(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
      </div>
      <p className={s.desc} style={{ marginTop: 12 }}>
        {tr('Les horodatages sont lus dans l’heure locale du poste (convention NinjaTrader). Colonnes reconnues : Time/Date, Open, High, Low, Close, Volume — ou le format sans en-tête ', 'Timestamps are read in the machine’s local time (NinjaTrader convention). Recognized columns: Time/Date, Open, High, Low, Close, Volume — or the headerless format ', 'Las marcas de tiempo se leen en la hora local del equipo (convención NinjaTrader). Columnas reconocidas: Time/Date, Open, High, Low, Close, Volume — o el formato sin encabezado ')}
        <code>yyyyMMdd HHmmss;O;H;L;C;V</code>.
      </p>
    </Modal>
  );
}
