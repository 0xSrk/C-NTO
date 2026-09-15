import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconImport, IconPlus, IconTrash } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Modal } from '@/design/Modal';
import { Button, Field, Tag, Toggle, cx } from '@/design/primitives';
import { INDICATORS, indicatorById, type IndicatorLine } from '@/engine/indicators';
import type { Instrument } from '@/engine/types';
import { openTextFile } from '@/lib/desk';
import { fmtInt, fmtPrice, fmtUsd, signClass } from '@/lib/format';
import { formatDateFr, formatTimeLocal } from '@/lib/time';
import { useBars } from '@/store/bars';
import { useJournal } from '@/store/journal';
import { useUi } from '@/store/ui';
import { Chart, type HoverInfo } from './Chart';
import s from './visual.module.css';

export default function Visual() {
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
  const sessionTrades = useMemo(() => (session ? trades.filter((t) => t.sessionId === session.id) : []), [session, trades]);

  useEffect(() => {
    if (!session || !active || active.source !== 'demo' || active.bars.length === 0) return;
    const first = new Date(active.bars[0].time * 1000);
    const last = new Date(active.bars[active.bars.length - 1].time * 1000);
    const day = new Date(`${session.date}T12:00:00`);
    if (day < first || day > last) {
      regenerateDemo({ endDate: session.date, days: 6, timeframe: active.timeframe }).then(() => toast(`Barres de démonstration régénérées autour du ${formatDateFr(session.date, { short: true })}.`, 'info'));
    }
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
                  {sr.label} · {fmtInt(sr.bars.length)} barres
                </option>
              ))}
            </select>
            <Button variant="gold" onClick={() => setImportOpen(true)}>
              <IconImport size={14} /> Importer des barres
            </Button>
            <Button variant="ghost" onClick={() => regenerateDemo({ days: 12, timeframe: 5 }).then(() => toast('Démo régénérée.', 'ok'))}>
              Démo
            </Button>
            {active && active.source !== 'demo' && (
              <Button variant="ghost" onClick={() => remove(active.id)} aria-label="Supprimer la série">
                <IconTrash size={13} />
              </Button>
            )}
          </>
        }
      />
      <ModuleContent noPad>
        <div className={s.layout}>
          <div className={s.chartWrap}>
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
                <div className={s.stamp}>{active.source === 'demo' ? <Tag tone="amber">Données synthétiques · démo</Tag> : <Tag tone="ice">Import CSV</Tag>}</div>
                <Chart bars={active.bars} timeframe={active.timeframe} lines={lines} trades={sessionTrades} onHover={onHover} />
              </>
            )}
          </div>

          <aside className={s.side}>
            <div className={s.sideSection}>
              <div className={s.sideTitle}>
                <span>Indicateurs · {indicators.length}</span>
                <Button size="sm" variant="ghost" onClick={() => setCatalog((c) => !c)}>
                  <IconPlus size={12} /> Ajouter
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
                      <span>{def.name}</span>
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
                      <b>{def.name}</b>
                      <button onClick={() => removeIndicator(inst.id)} aria-label="Retirer">
                        ×
                      </button>
                    </div>
                    {def.params.length > 0 && (
                      <div className={s.params}>
                        {def.params.map((p) => (
                          <label key={p.key}>
                            {p.label}
                            {p.type === 'number' ? (
                              <input type="number" min={p.min} max={p.max} step={p.step} value={Number(inst.params[p.key])} onChange={(e) => updateIndicator(inst.id, { [p.key]: Number(e.target.value) || p.default })} />
                            ) : (
                              <select value={String(inst.params[p.key])} onChange={(e) => updateIndicator(inst.id, { [p.key]: e.target.value })}>
                                {p.options?.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                    <div className={s.desc}>{def.description}</div>
                  </div>
                );
              })}
              <p className={s.desc}>
                Les indicateurs sont des modules du moteur (<code>src/engine/indicators.ts</code>) : chaque nouvel indicateur créé par le Lab s’ajoute au catalogue avec ses paramètres.
              </p>
            </div>

            <div className={s.sideSection}>
              <div className={s.sideTitle}>
                <span>Séance projetée</span>
                {session && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      focusSession(null);
                      setSessionPick('');
                    }}
                  >
                    Retirer
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
                <option value="">— choisir une séance du journal —</option>
                {[...sessions]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .slice(0, 200)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.date} · {x.tradeCount} trade(s) · {fmtUsd(x.pnl, { sign: true })}
                    </option>
                  ))}
              </select>
              {session ? (
                <div className={s.session}>
                  <div className={s.desc}>
                    {sessionTrades.length} trade(s) projetés en marqueurs : flèche = entrée (L/S), cercle = sortie avec PnL. {active?.source === 'demo' && 'Les bougies étant synthétiques, seuls les horaires sont significatifs.'}
                  </div>
                  {sessionTrades
                    .sort((a, b) => a.entryTime - b.entryTime)
                    .map((t) => (
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
                <div className={s.desc}>Depuis Métrique › Séances, « Voir dans Visual » projette les trades d’une journée sur le graphique.</div>
              )}
            </div>

            <div className={s.sideSection}>
              <div className={s.sideTitle}>
                <span>Source</span>
              </div>
              <div className={s.desc}>
                {active ? (
                  <>
                    {active.label} — {fmtInt(active.bars.length)} barres, du {active.bars[0] ? formatDateFr(new Date(active.bars[0].time * 1000).toISOString().slice(0, 10), { short: true }) : '—'} au {lastBar ? formatDateFr(new Date(lastBar.time * 1000).toISOString().slice(0, 10), { short: true }) : '—'}.
                  </>
                ) : (
                  'Aucune série.'
                )}
                <br />
                Export NinjaTrader : Tools › Historical Data › Export (format texte : <code>yyyyMMdd HHmmss;O;H;L;C;V</code>) ou tout CSV OHLCV.
              </div>
            </div>
          </aside>
        </div>
      </ModuleContent>
      {importOpen && (
        <ImportBarsModal
          onClose={() => setImportOpen(false)}
          onImport={async (text, name, instrument, timeframe) => {
            const r = await importCsv(text, name, instrument, timeframe);
            toast(r.bars ? `${fmtInt(r.bars)} barres importées.` : r.warnings.join(' '), r.bars ? 'ok' : 'warn');
            if (r.bars) setImportOpen(false);
          }}
        />
      )}
    </>
  );
}

function ImportBarsModal({ onClose, onImport }: { onClose: () => void; onImport: (text: string, name: string, instrument: Instrument, timeframe: number) => Promise<void> }) {
  const [instrument, setInstrument] = useState<Instrument>('NQ');
  const [timeframe, setTimeframe] = useState(5);
  return (
    <Modal
      title="Importer des barres OHLCV"
      sub="NinjaTrader · Historical Data · Export"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="gold"
            onClick={async () => {
              const f = await openTextFile('.csv,.txt');
              if (f) await onImport(f.text, f.name, instrument, timeframe);
            }}
          >
            Choisir un fichier
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Instrument">
          <select value={instrument} onChange={(e) => setInstrument(e.target.value as Instrument)}>
            <option value="NQ">NQ</option>
            <option value="MNQ">MNQ</option>
          </select>
        </Field>
        <Field label="Unité (minutes)">
          <input type="number" min={1} max={1440} value={timeframe} onChange={(e) => setTimeframe(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
      </div>
      <p className={s.desc} style={{ marginTop: 12 }}>
        Les horodatages sont lus dans l’heure locale du poste (convention NinjaTrader). Colonnes reconnues : Time/Date, Open, High, Low, Close, Volume — ou le format sans en-tête <code>yyyyMMdd HHmmss;O;H;L;C;V</code>.
      </p>
    </Modal>
  );
}
