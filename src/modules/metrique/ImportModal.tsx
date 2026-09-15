import { useState, type DragEvent } from 'react';
import { Modal } from '@/design/Modal';
import { Button, Field, cx } from '@/design/primitives';
import { openTextFile } from '@/lib/desk';
import { useJournal } from '@/store/journal';
import { useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import s from './metrique.module.css';

export function ImportModal({ onClose }: { onClose: () => void }) {
  const importCsv = useJournal((j) => j.importCsv);
  const settings = useSettings((st) => st.settings);
  const update = useSettings((st) => st.update);
  const toast = useUi((u) => u.toast);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string[] | null>(null);

  const run = async (text: string, name: string) => {
    setBusy(true);
    try {
      const r = await importCsv(text, { boundaryHour: settings.boundaryHour, riskPerContract: settings.riskPerContract || undefined });
      const lines = [
        `Fichier : ${name}`,
        `Format détecté : ${r.format === 'ninjatrader-trades' ? 'NinjaTrader · Trades' : r.format === 'canto-csv' ? 'CΛNTO CSV' : 'inconnu'}`,
        `Trades lus : ${r.trades.length} · séances créées : ${r.added} · séances fusionnées : ${r.merged}`,
        ...r.warnings,
      ];
      setReport(lines);
      if (r.trades.length) toast(`${r.trades.length} trades importés (${r.added} nouvelle(s) séance(s), ${r.merged} fusion(s)).`, 'ok');
      else toast('Aucun trade importé.', 'warn');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import impossible.', 'error');
    } finally {
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
      title="Importer depuis NinjaTrader"
      sub="Trade Performance › Trades › clic droit › Export"
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button
            variant="gold"
            disabled={busy}
            onClick={async () => {
              const f = await openTextFile('.csv,.txt');
              if (f) await run(f.text, f.name);
            }}
          >
            Choisir un fichier CSV
          </Button>
        </>
      }
    >
      <div className={s.rows}>
        <div
          className={cx(s.dropzone, over && s.over)}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          Déposez ici l’export CSV de NinjaTrader (cultures en-US et fr-FR reconnues automatiquement).
          <br />
          <span className="dim">Colonnes attendues : Instrument · Market pos. · Qty · Entry price · Exit price · Entry time · Exit time · Commission · MAE · MFE</span>
        </div>
        <div className={s.formGrid}>
          <Field label="Bascule de journée (heure locale)" hint="0 = date civile (poste en France) · 18 = convention Globex (poste en heure ET)">
            <select value={settings.boundaryHour} onChange={(e) => update({ boundaryHour: Number(e.target.value) })}>
              <option value={0}>00:00 — date civile</option>
              <option value={18}>18:00 — Globex (heure ET)</option>
              <option value={17}>17:00</option>
              <option value={23}>23:00</option>
            </select>
          </Field>
          <Field label="Risque par contrat ($)" hint="0 = ne pas calculer les multiples de R">
            <input type="number" min={0} step={5} value={settings.riskPerContract} onChange={(e) => update({ riskPerContract: Number(e.target.value) || 0 })} />
          </Field>
        </div>
        <p className={s.note}>
          Le PnL est recalculé depuis les prix et la valeur du point (NQ 20 $ · MNQ 2 $) puis diminué des commissions ; la colonne Profit sert de contrôle. Les instruments hors NQ/MNQ sont ignorés. Les doublons exacts sont écartés ; une séance existante (même date, même compte) absorbe les nouveaux trades — vous pouvez empiler les exports au fil des semaines.
        </p>
        {report && (
          <div style={{ border: '1px solid var(--line-1)', padding: 10, borderRadius: 2 }}>
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
