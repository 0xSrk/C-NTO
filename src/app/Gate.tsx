import { useState, type FormEvent } from 'react';
import { Button, Field } from '@/design/primitives';
import { opens } from '@/engine/gate';
import { tr, useI18n } from '@/i18n';
import s from './gate.module.css';

export function Gate({ onOpen }: { onOpen: () => void }) {
  useI18n((st) => st.locale);
  const [value, setValue] = useState('');
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await opens(value);
    setBusy(false);
    if (ok) {
      onOpen();
      return;
    }
    setRefused(true);
    setValue('');
  };

  return (
    <div className={s.gate}>
      <form className={s.card} onSubmit={(event) => void submit(event)}>
        <div className={s.mark}>{tr('Desk verrouillé', 'Desk locked', 'Desk bloqueado')}</div>
        <Field label={tr('Phrase', 'Phrase', 'Frase')} hint={refused ? tr('Refusé', 'Refused', 'Rechazado') : undefined}>
          <input
            type="password"
            autoFocus
            autoComplete="off"
            value={value}
            onChange={(event) => {
              setRefused(false);
              setValue(event.target.value);
            }}
          />
        </Field>
        <div className={s.row}>
          <Button type="submit" variant="gold" disabled={busy || value.length === 0}>
            {tr('Ouvrir', 'Open', 'Abrir')}
          </Button>
        </div>
      </form>
    </div>
  );
}
