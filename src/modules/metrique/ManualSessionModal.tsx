import { useState } from 'react';
import { Modal } from '@/design/Modal';
import { Button, Field } from '@/design/primitives';
import { tr, useI18n } from '@/i18n';
import { dateKeyLocal } from '@/lib/time';
import { useJournal } from '@/store/journal';
import { useUi } from '@/store/ui';
import s from './metrique.module.css';

export function ManualSessionModal({ onClose }: { onClose: () => void }) {
  useI18n((s) => s.locale);
  const add = useJournal((j) => j.addManualSession);
  const toast = useUi((u) => u.toast);
  const [date, setDate] = useState(dateKeyLocal(new Date()));
  const [account, setAccount] = useState('');
  const [pnl, setPnl] = useState('');
  const [count, setCount] = useState('1');
  const [tags, setTags] = useState('');
  const [rating, setRating] = useState('');
  const [note, setNote] = useState('');

  const submit = async () => {
    const v = Number(pnl.replace(',', '.'));
    if (!date || !Number.isFinite(v)) return toast(tr('Date et PnL requis.', 'Date and PnL required.', 'Fecha y PnL requeridos.'), 'warn');
    try {
      await add({ date, account: account.trim() || undefined, pnl: v, tradeCount: Math.max(0, parseInt(count) || 0), note: note.trim() || undefined, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), rating: rating ? Number(rating) : undefined });
      toast(tr(`Séance du ${date} enregistrée.`, `Session of ${date} saved.`, `Sesión del ${date} registrada.`), 'ok');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : tr('Enregistrement impossible.', 'Save failed.', 'Registro imposible.'), 'error');
    }
  };

  return (
    <Modal
      title={tr('Séance manuelle', 'Manual session', 'Sesión manual')}
      sub={tr('saisie rapide sans détail par trade', 'quick entry without per-trade detail', 'entrada rápida sin detalle por trade')}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tr('Annuler', 'Cancel', 'Cancelar')}
          </Button>
          <Button variant="gold" onClick={submit}>
            {tr('Enregistrer', 'Save', 'Guardar')}
          </Button>
        </>
      }
    >
      <div className={s.formGrid}>
        <Field label={tr('Date', 'Date', 'Fecha')}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={tr('Compte', 'Account', 'Cuenta')}>
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Apex-50K, Topstep-100K…" />
        </Field>
        <Field label={tr('PnL net ($)', 'Net PnL ($)', 'PnL neto ($)')}>
          <input type="number" step="0.01" value={pnl} onChange={(e) => setPnl(e.target.value)} placeholder="-250.00" />
        </Field>
        <Field label={tr('Nombre de trades', 'Number of trades', 'Número de trades')}>
          <input type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
        <Field label={tr('Tags (séparés par des virgules)', 'Tags (comma-separated)', 'Tags (separados por comas)')}>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={tr('plan respecté, news', 'plan followed, news', 'plan respetado, news')} />
        </Field>
        <Field label={tr('Auto-évaluation', 'Self-rating', 'Autoevaluación')}>
          <select value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {'★'.repeat(n)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr('Note', 'Note', 'Nota')} className={s.full}>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
