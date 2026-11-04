import { Glyph } from '@/design/Micro';
import e from '@/design/etat.module.css';
import { cx } from '@/design/primitives';
import { tr, useI18n } from '@/i18n';
import type { CriteriaView } from './criteriaMirror';
import s from './criteria.module.css';

/**
 * Les critères en miroir d'Armer et d'Activer (OROS5.43) : C.070, l'écrou de la garde, puis chaque critère lu en direct,
 * puis le premier manquant en mots. Désarmé ou désactivé — l'état de chaque ouverture du desk —, le cadre est au filet
 * graphite ; armé ou activé, au trait plein. Il ne fait que lire : le bouton voisin ouvre toujours le dialogue du process
 * principal, qui seul décide.
 */
export function CriteriaMirror({ id, mirror, on, opening }: { id: string; mirror: CriteriaView; on: boolean; opening: string }) {
  useI18n((st) => st.locale);
  return (
    <div className={cx(s.criteria, on ? e.plein : e.eteint)} data-criteria={id} data-state={on ? 'on' : 'off'}>
      <header className={s.head}>
        <Glyph name="guard" className={s.nut} />
        <span>{opening}</span>
      </header>
      <ul className={s.list}>
        {mirror.criteria.map((c) => (
          <li key={c.id} data-criterion={c.id} data-state={c.state}>
            {/* C.042, muet : la phrase « Manque d'abord » dit le premier critère manquant. */}
            {c.state === 'missing' ? <Glyph name="refused" className={s.stop} /> : <i className={cx(s.mark, e.plein)} aria-hidden />}
            <b>{c.name}</b>
            <span>{c.words}</span>
          </li>
        ))}
      </ul>
      <p className={s.first} data-first={mirror.first?.id ?? ''}>
        {mirror.first
          ? tr(`Manque d’abord : ${mirror.first.name} — ${mirror.first.words}`, `Missing first: ${mirror.first.name} — ${mirror.first.words}`, `Falta primero: ${mirror.first.name} — ${mirror.first.words}`)
          : tr('Chaque critère est rempli ; le dialogue du desk décide.', 'Every criterion is met; the desk dialog decides.', 'Cada criterio se cumple; el diálogo del desk decide.')}
      </p>
    </div>
  );
}
