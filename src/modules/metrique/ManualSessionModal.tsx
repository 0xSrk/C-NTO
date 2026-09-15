import { useState } from 'react';
import { Modal } from '@/design/Modal';
import { Button, Field } from '@/design/primitives';
import { dateKeyLocal } from '@/lib/time';
import { useJournal } from '@/store/journal';
import { useUi } from '@/store/ui';
import s from './metrique.module.css';

export function ManualSessionModal({ onClose }: { onClose: () => void }) {
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
    if (!date || !Number.isFinite(v)) return toast('Date et PnL requis.', 'warn');
    try {
      await add({ date, account: account.trim() || undefined, pnl: v, tradeCount: Math.max(0, parseInt(count) || 0), note: note.trim() || undefined, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), rating: rating ? Number(rating) : undefined });
      toast(`Séance du ${date} enregistrée.`, 'ok');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Enregistrement impossible.', 'error');
    }
  };

  return (
    <Modal
      title="Séance manuelle"
      sub="saisie rapide sans détail par trade"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="gold" onClick={submit}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className={s.formGrid}>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Compte">
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Apex-50K, Topstep-100K…" />
        </Field>
        <Field label="PnL net ($)">
          <input type="number" step="0.01" value={pnl} onChange={(e) => setPnl(e.target.value)} placeholder="-250.00" />
        </Field>
        <Field label="Nombre de trades">
          <input type="number" min={0} value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
        <Field label="Tags (séparés par des virgules)">
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="plan respecté, news" />
        </Field>
        <Field label="Auto-évaluation">
          <select value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {'★'.repeat(n)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note" className={s.full}>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
