import { useRef, useState, type DragEvent } from 'react';
import { Modal } from '@/design/Modal';
import { Button, Field, Progress, cx } from '@/design/primitives';
import { FORMAT_LABEL } from '@/engine/import';
import { tr, useI18n } from '@/i18n';
import { openTextFile } from '@/lib/desk';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './metrique.module.css';

function trFormatLabel(format: keyof typeof FORMAT_LABEL): string {
  const fr = FORMAT_LABEL[format];
  if (format === 'ninjatrader-trades') return tr(fr, 'NinjaTrader · Trades', 'NinjaTrader · Trades');
  if (format === 'ninjatrader-executions') return tr(fr, 'NinjaTrader · Executions', 'NinjaTrader · Ejecuciones');
  if (format === 'canto-csv') return fr;
  return tr(fr, 'unknown', 'desconocido');
}

export function ImportModal({ onClose }: { onClose: () => void }) {
  useI18n((s) => s.locale);
  const importCsv = useJournal((j) => j.importCsv);
  const settings = useSettings((st) => st.settings);
  const update = useSettings((st) => st.update);
  const toast = useUi((u) => u.toast);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<string[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = () => {
    abortRef.current?.abort();
  };

  const run = async (text: string, name: string) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setProgress(0);
    try {
      const r = await importCsv(text, {
        boundaryHour: settings.boundaryHour,
        riskPerContract: settings.riskPerContract || undefined,
        signal: ac.signal,
        onProgress: (done, total) => {
          if (!ac.signal.aborted) setProgress(total ? done / total : 0);
        },
      });
      if (ac.signal.aborted) return;
      setProgress(1);
      const lines = [
        tr(`Fichier : ${name}`, `File: ${name}`, `Archivo: ${name}`),
        tr(`Format détecté : ${FORMAT_LABEL[r.format]}`, `Detected format: ${trFormatLabel(r.format)}`, `Formato detectado: ${trFormatLabel(r.format)}`),
        tr(
          `Trades lus : ${r.trades.length} · nouveaux : ${r.newTrades} · séances créées : ${r.added} · fusionnées : ${r.merged}`,
          `Trades read: ${r.trades.length} · new: ${r.newTrades} · sessions created: ${r.added} · merged: ${r.merged}`,
          `Trades leídos: ${r.trades.length} · nuevos: ${r.newTrades} · sesiones creadas: ${r.added} · fusionadas: ${r.merged}`,
        ),
        ...r.warnings,
      ];
      setReport(lines);
      if (r.newTrades)
        toast(
          tr(
            `${r.newTrades} trade(s) importé(s) (${r.added} nouvelle(s) séance(s), ${r.merged} fusion(s)).`,
            `${r.newTrades} trade(s) imported (${r.added} new session(s), ${r.merged} merge(s)).`,
            `${r.newTrades} trade(s) importado(s) (${r.added} sesión(es) nueva(s), ${r.merged} fusión(es)).`,
          ),
          'ok',
        );
      else if (r.trades.length) toast(tr('Fichier déjà importé : aucun nouveau trade.', 'File already imported: no new trade.', 'Archivo ya importado: ningún trade nuevo.'), 'info');
      else toast(tr('Aucun trade importé.', 'No trade imported.', 'Ningún trade importado.'), 'warn');
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') toast(tr('Import annulé.', 'Import cancelled.', 'Importación cancelada.'), 'info');
      else toast(e instanceof Error ? e.message : tr('Import impossible.', 'Import failed.', 'Importación imposible.'), 'error');
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) await run(await f.text(), f.name);
  };

  return (
    <Modal
      title={tr('Importer un CSV NinjaTrader', 'Import a NinjaTrader CSV', 'Importar un CSV NinjaTrader')}
      sub={tr('Trade Performance › Trades · Executions · CΛNTO CSV', 'Trade Performance › Trades · Executions · CΛNTO CSV', 'Trade Performance › Trades · Executions · CΛNTO CSV')}
      onClose={onClose}
      width={620}
      footer={
        <>
          {busy ? (
            <Button variant="ghost" onClick={cancel}>
              {tr('Annuler', 'Cancel', 'Cancelar')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              {tr('Fermer', 'Close', 'Cerrar')}
            </Button>
          )}
          <Button
            variant="gold"
            disabled={busy}
            onClick={async () => {
              const f = await openTextFile('.csv,.txt');
              if (f) await run(f.text, f.name);
            }}
          >
            {tr('Choisir un fichier CSV', 'Choose a CSV file', 'Elegir un archivo CSV')}
          </Button>
        </>
      }
    >
      <div className={s.rows}>
        {busy && <Progress value={progress} tone="gold" />}
        <div
          className={cx(s.dropzone, over && s.over)}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          {tr(
            'Déposez ici un export CSV de NinjaTrader — « Trades » (Trade Performance) ou « Executions » (appariées automatiquement en trades, FIFO). Cultures en-US et fr-FR reconnues.',
            'Drop a NinjaTrader CSV export here — “Trades” (Trade Performance) or “Executions” (matched into trades automatically, FIFO). en-US and fr-FR cultures recognized.',
            'Suelte aquí una exportación CSV de NinjaTrader — « Trades » (Trade Performance) o « Executions » (emparejadas automáticamente en trades, FIFO). Culturas en-US y fr-FR reconocidas.',
          )}
          <br />
          <span className="dim">
            {tr(
              'Trades : Instrument · Market pos. · Qty · Entry/Exit price · Entry/Exit time · Commission · MAE · MFE — Executions : Instrument · Action · Quantity · Price · Time · ID · Commission · Account',
              'Trades: Instrument · Market pos. · Qty · Entry/Exit price · Entry/Exit time · Commission · MAE · MFE — Executions: Instrument · Action · Quantity · Price · Time · ID · Commission · Account',
              'Trades: Instrument · Market pos. · Qty · Entry/Exit price · Entry/Exit time · Commission · MAE · MFE — Executions: Instrument · Action · Quantity · Price · Time · ID · Commission · Account',
            )}
          </span>
        </div>
        <div className={s.formGrid}>
          <Field
            label={tr('Bascule de journée (heure locale)', 'Day boundary (local hour)', 'Cambio de jornada (hora local)')}
            hint={tr('0 = date civile (poste en France) · 18 = convention Globex (poste en heure ET)', '0 = calendar date (France desk) · 18 = Globex convention (ET desk)', '0 = fecha civil (puesto en Francia) · 18 = convención Globex (puesto en hora ET)')}
          >
            <select value={settings.boundaryHour} onChange={(e) => update({ boundaryHour: Number(e.target.value) })}>
              <option value={0}>{tr('00:00 — date civile', '00:00 — calendar date', '00:00 — fecha civil')}</option>
              <option value={18}>{tr('18:00 — Globex (heure ET)', '18:00 — Globex (ET hour)', '18:00 — Globex (hora ET)')}</option>
              <option value={17}>17:00</option>
              <option value={23}>23:00</option>
            </select>
          </Field>
          <Field label={tr('Risque par contrat ($)', 'Risk per contract ($)', 'Riesgo por contrato ($)')} hint={tr('0 = ne pas calculer les multiples de R', '0 = do not compute R multiples', '0 = no calcular los múltiplos de R')}>
            <input type="number" min={0} step={5} value={settings.riskPerContract} onChange={(e) => update({ riskPerContract: Number(e.target.value) || 0 })} />
          </Field>
        </div>
        <p className={s.note}>
          {tr(
            'Le PnL est recalculé depuis les prix et la valeur du point (NQ 20 $ · MNQ 2 $) puis diminué des commissions ; la colonne Profit sert de contrôle. Les instruments hors NQ/MNQ sont ignorés. Les doublons exacts sont écartés ; une séance existante (même date, même compte) absorbe les nouveaux trades — vous pouvez empiler les exports au fil des semaines. L’export Executions ne contient pas de MAE/MFE.',
            'PnL is recomputed from prices and point value (NQ $20 · MNQ $2) then reduced by commissions; the Profit column is a check. Instruments other than NQ/MNQ are ignored. Exact duplicates are dropped; an existing session (same date, same account) absorbs new trades — you can stack exports over weeks. The Executions export has no MAE/MFE.',
            'El PnL se recalcula desde los precios y el valor del punto (NQ 20 $ · MNQ 2 $) y luego se restan las comisiones; la columna Profit sirve de control. Los instrumentos fuera de NQ/MNQ se ignoran. Los duplicados exactos se descartan; una sesión existente (misma fecha, misma cuenta) absorbe los nuevos trades — puede apilar exportaciones a lo largo de las semanas. La exportación Executions no contiene MAE/MFE.',
          )}
        </p>
        {report && (
          <div style={{ border: '1px solid var(--line-1)', padding: 12, borderRadius: 0 }}>
            {report.map((l, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, color: i < 3 ? 'var(--text-1)' : 'var(--amber)' }}>
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
