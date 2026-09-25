import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconImport, IconPlus, IconTrash } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Modal } from '@/design/Modal';
import { Button, Empty, Field, Progress, Tag, Toggle, cx } from '@/design/primitives';
import { INDICATORS, indicatorById, type IndicatorLine } from '@/engine/indicators';
import type { Instrument } from '@/engine/types';
import { tr, useI18n } from '@/i18n';
import { openTextFile } from '@/lib/desk';
import { fmtInt, fmtPrice, fmtUsd, plural, signClass } from '@/lib/format';
import { dateKeyLocal, formatDateFr, formatTimeLocal } from '@/lib/time';
import { useBars } from '@/store/bars';
import { useJournal } from '@/store/journal';
import { useUi } from '@/store/ui';
import { Chart, type HoverInfo } from './Chart';
import s from './visual.module.css';

function seriesLabel(label: string): string {
  return label.replaceAll('démo synthétique', tr('démo synthétique', 'synthetic demo', 'demo sintética'));
}

function trIndicatorName(id: string, name: string): string {
  switch (id) {
    case 'ema':
      return tr('Moyenne mobile exponentielle', 'Exponential moving average', 'Media móvil exponencial');
    case 'sma':
      return tr('Moyenne mobile simple', 'Simple moving average', 'Media móvil simple');
    case 'vwap':
      return tr('VWAP de séance', 'Session VWAP', 'VWAP de sesión');
    case 'opening-range':
      return tr('Opening Range (RTH)', 'Opening Range (RTH)', 'Opening Range (RTH)');
    case 'prev-session':
      return tr('Niveaux séance précédente', 'Previous session levels', 'Niveles de la sesión anterior');
    case 'atr':
      return tr('Average True Range', 'Average True Range', 'Average True Range');
    case 'volume-ma':
      return tr('Volume relatif', 'Relative volume', 'Volumen relativo');
    default:
      return name;
  }
}

function trIndicatorDesc(id: string, description: string): string {
  switch (id) {
    case 'ema':
      return tr('Tendance court/moyen terme. Les scalpers Nasdaq surveillent souvent EMA 9 / 21 sur 1–5 min.', 'Short/medium-term trend. Nasdaq scalpers often watch EMA 9 / 21 on 1–5 min.', 'Tendencia corto/medio plazo. Los scalpers del Nasdaq suelen vigilar EMA 9 / 21 en 1–5 min.');
    case 'sma':
      return tr('Moyenne arithmétique des clôtures. SMA 200 = référence de tendance long terme.', 'Arithmetic average of closes. SMA 200 = long-term trend reference.', 'Media aritmética de los cierres. SMA 200 = referencia de tendencia a largo plazo.');
    case 'vwap':
      return tr('Prix moyen pondéré par le volume, réinitialisé à chaque séance Globex (18:00 ET). Bandes ±1σ / ±2σ.', 'Volume-weighted average price, reset each Globex session (18:00 ET). Bands ±1σ / ±2σ.', 'Precio medio ponderado por volumen, reiniciado en cada sesión Globex (18:00 ET). Bandas ±1σ / ±2σ.');
    case 'opening-range':
      return tr('Plus haut / plus bas des premières minutes après 9:30 ET. Cassure = signal directionnel classique sur NQ.', 'High / low of the first minutes after 9:30 ET. Breakout = classic directional signal on NQ.', 'Máximo / mínimo de los primeros minutos tras las 9:30 ET. Ruptura = señal direccional clásica en NQ.');
    case 'prev-session':
      return tr('Plus haut, plus bas et clôture de la séance précédente : supports/résistances suivis par la majorité des intervenants.', 'Previous session high, low and close: supports/resistances watched by most participants.', 'Máximo, mínimo y cierre de la sesión anterior: soportes/resistencias seguidos por la mayoría de los participantes.');
    case 'atr':
      return tr('Volatilité moyenne par bougie, en points. Sert à dimensionner stops et objectifs.', 'Average volatility per candle, in points. Used to size stops and targets.', 'Volatilidad media por vela, en puntos. Sirve para dimensionar stops y objetivos.');
    case 'volume-ma':
      return tr('Volume de la bougie rapporté à sa moyenne mobile : > 1,5 signale une participation inhabituelle.', 'Candle volume relative to its moving average: > 1.5 signals unusual participation.', 'Volumen de la vela respecto a su media móvil: > 1,5 señala una participación inhabitual.');
    default:
      return description;
  }
}

function trParamLabel(label: string): string {
  switch (label) {
    case 'Période':
      return tr('Période', 'Period', 'Periodo');
    case 'Bandes':
      return tr('Bandes', 'Bands', 'Bandas');
    case 'Durée (min)':
      return tr('Durée (min)', 'Duration (min)', 'Duración (min)');
    case 'Aucune':
      return tr('Aucune', 'None', 'Ninguna');
    case '±1σ':
      return tr('±1σ', '±1σ', '±1σ');
    case '±1σ et ±2σ':
      return tr('±1σ et ±2σ', '±1σ and ±2σ', '±1σ y ±2σ');
    default:
      return label;
  }
}

export default function Visual() {
  useI18n((s) => s.locale);
  const { ready, series, activeId, indicators, load, setActive, regenerateDemo, importCsv, remove, addIndicator, updateIndicator, toggleIndicator, removeIndicator } = useBars();
  const sessions = useJournal((j) => j.sessions);
  const trades = useJournal((j) => j.trades);
  const focusSessionId = useUi((u) => u.focusSessionId);
  const focusSession = useUi((u) => u.focusSession);
  const toast = useUi((u) => u.toast);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [catalog, setCatalog] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sessionPick, setSessionPick] = useState<string>('');

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
    regenerateDemo({ endDate: session.date, days: 6, timeframe: active.timeframe }).then(() =>
      toast(
        tr(
          `Barres de démonstration régénérées autour du ${formatDateFr(session.date, { short: true })}.`,
          `Demo bars regenerated around ${formatDateFr(session.date, { short: true })}.`,
          `Barras de demostración regeneradas en torno al ${formatDateFr(session.date, { short: true })}.`,
        ),
        'info',
      ),
    );
  }, [session, active, regenerateDemo, toast]);

  const lines: IndicatorLine[] = useMemo(() => {
    if (!active) return [];
    const out: IndicatorLine[] = [];
    for (const inst of indicators) {
      if (!inst.visible) continue;
      const def = indicatorById(inst.definitionId);
      if (!def) continue;
      const res = def.compute(active.bars, inst.params);
      for (const l of res.lines) out.push({ ...l, key: `${inst.id}:${l.key}` });
    }
    return out;
  }, [active, indicators]);

  const onHover = useCallback((info: HoverInfo | null) => setHover(info), []);
  const lastBar = active?.bars[active.bars.length - 1];
  const shownBar = hover?.bar ?? lastBar ?? null;

  return (
    <>
      <ModuleHeader
        tab="visual"
        actions={
          <>
            <select value={activeId ?? ''} onChange={(e) => setActive(e.target.value)} style={{ minWidth: 260 }}>
              {series.map((sr) => (
                <option key={sr.id} value={sr.id}>
                  {seriesLabel(sr.label)} · {plural(sr.bars.length, tr('barre', 'bar', 'barra'), tr('barres', 'bars', 'barras'))}
                </option>
              ))}
            </select>
            <Button variant="gold" onClick={() => setImportOpen(true)}>
              <IconImport size={14} /> {tr('Importer des barres', 'Import bars', 'Importar barras')}
            </Button>
            <Button variant="ghost" onClick={() => regenerateDemo({ days: 12, timeframe: 5 }).then(() => toast(tr('Démo régénérée.', 'Demo regenerated.', 'Demo regenerada.'), 'ok'))} title={tr('Régénérer des barres synthétiques', 'Regenerate synthetic bars', 'Regenerar barras sintéticas')}>
              {tr('Démo', 'Demo', 'Demo')}
            </Button>
            {active && active.source !== 'demo' && (
              <Button variant="ghost" onClick={() => remove(active.id)} aria-label={tr('Supprimer la série', 'Delete series', 'Eliminar la serie')} title={tr('Supprimer la série', 'Delete series', 'Eliminar la serie')}>
                <IconTrash size={13} />
              </Button>
            )}
          </>
        }
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
                    <Button variant="gold" onClick={() => regenerateDemo({ days: 12, timeframe: 5 })}>
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
                    <b>{active.instrument} · {active.timeframe}m</b>
                    {shownBar && (
                      <>
                        <span>{formatDateFr(new Date(shownBar.time * 1000).toISOString().slice(0, 10), { short: true })} {formatTimeLocal(shownBar.time * 1000)}</span>
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
                <div className={s.stamp}>{active.source === 'demo' ? <Tag tone="amber">{tr('Données synthétiques · démo', 'Synthetic data · demo', 'Datos sintéticos · demo')}</Tag> : <Tag tone="ice">{tr('Import CSV', 'CSV import', 'Importación CSV')}</Tag>}</div>
                <Chart bars={active.bars} timeframe={active.timeframe} lines={lines} trades={sessionTrades} onHover={onHover} />
              </>
            )}
          </div>

          <aside className={s.side}>
            <div className={s.sideSection}>
              <div className={s.sideTitle}>
                <span>{tr('Indicateurs', 'Indicators', 'Indicadores')} · {indicators.length}</span>
                <Button size="sm" variant="ghost" onClick={() => setCatalog((c) => !c)}>
                  <IconPlus size={12} /> {tr('Ajouter', 'Add', 'Añadir')}
                </Button>
              </div>
              {catalog && (
                <div className={s.catalog}>
                  {INDICATORS.map((def) => (
                    <button
                      key={def.id}
                      className={s.catalogItem}
                      onClick={() => {
                        addIndicator(def.id);
                        setCatalog(false);
                      }}
                    >
                      <small>{def.short}</small>
                      <span>{trIndicatorName(def.id, def.name)}</span>
                    </button>
                  ))}
                </div>
              )}
              {indicators.map((inst) => {
                const def = indicatorById(inst.definitionId);
                if (!def) return null;
                return (
                  <div key={inst.id} className={cx(s.indicator, !inst.visible && s.off)}>
                    <div className={s.indicatorHead}>
                      <Toggle on={inst.visible} onChange={() => toggleIndicator(inst.id)} />
                      <b>{trIndicatorName(def.id, def.name)}</b>
                      <button onClick={() => removeIndicator(inst.id)} aria-label={tr('Retirer', 'Remove', 'Quitar')}>
                        ×
                      </button>
                    </div>
                    {def.params.length > 0 && (
                      <div className={s.params}>
                        {def.params.map((p) => (
                          <label key={p.key}>
                            {trParamLabel(p.label)}
                            {p.type === 'number' ? (
                              <input type="number" min={p.min} max={p.max} step={p.step} value={Number(inst.params[p.key])} onChange={(e) => updateIndicator(inst.id, { [p.key]: Number(e.target.value) || p.default })} />
                            ) : (
                              <select value={String(inst.params[p.key])} onChange={(e) => updateIndicator(inst.id, { [p.key]: e.target.value })}>
                                {p.options?.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {trParamLabel(o.label)}
                                  </option>
                                ))}
                              </select>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                    <div className={s.desc}>{trIndicatorDesc(def.id, def.description)}</div>
                  </div>
                );
              })}
              <p className={s.desc}>{tr('Chaque nouvel indicateur forgé par le Lab rejoint ce catalogue avec ses paramètres : le graphique évolue avec la méthode du trader.', 'Each new indicator forged by the Lab joins this catalog with its parameters: the chart evolves with the trader’s method.', 'Cada nuevo indicador forjado por el Lab se une a este catálogo con sus parámetros: el gráfico evoluciona con el método del trader.')}</p>
            </div>

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
                    {active?.source === 'demo' && tr('Les bougies étant synthétiques, seuls les horaires sont significatifs.', 'Since candles are synthetic, only the timestamps are meaningful.', 'Al ser las velas sintéticas, solo los horarios son significativos.')}
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
                    {seriesLabel(active.label)} — {fmtInt(active.bars.length)} {tr('barres', 'bars', 'barras')}, {tr('du', 'from', 'del')} {active.bars[0] ? formatDateFr(new Date(active.bars[0].time * 1000).toISOString().slice(0, 10), { short: true }) : '—'} {tr('au', 'to', 'al')} {lastBar ? formatDateFr(new Date(lastBar.time * 1000).toISOString().slice(0, 10), { short: true }) : '—'}.
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
          </aside>
        </div>
      </ModuleContent>
      {importOpen && (
        <ImportBarsModal
          onClose={() => setImportOpen(false)}
          onImport={async (text, name, instrument, timeframe, opts) => {
            const r = await importCsv(text, name, instrument, timeframe, opts);
            toast(r.bars ? tr(`${fmtInt(r.bars)} barres importées.`, `${fmtInt(r.bars)} bars imported.`, `${fmtInt(r.bars)} barras importadas.`) : r.warnings.join(' '), r.bars ? 'ok' : 'warn');
            if (r.bars) setImportOpen(false);
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
          <select value={instrument} onChange={(e) => setInstrument(e.target.value as Instrument)}>
            <option value="NQ">NQ</option>
            <option value="MNQ">MNQ</option>
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
