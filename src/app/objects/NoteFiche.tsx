import { noteTradingDay, parseNoteHeader, slugifyTitle, type EntityRef, type NoteStatut } from '@/engine/ontology';
import { tr, useI18n } from '@/i18n';
import { formatDateFr } from '@/lib/time';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { ActivitySection, copyAction, FicheHead, FicheSection, ficheTitle, linkProvenance, LinksByPredicate, ObjectLink, Properties, Provenance, stamped, type FicheAction, type PropertyRow } from './Fiche';
import { isStrategyNote, type IndexSources } from './index';
import s from './fiche.module.css';
import { AroundOf } from './AroundOf';

/**
 * La fiche Note (OROS5.28, correction du juge Palantir) : la note est un objet, sa source et son auteur dits, ses liens
 * par prédicat (les hypothèses comprises). Elle ne fait que lire ; l'action ouvre la note dans Note.
 */

/** Le statut épistémique d'une note, dans la langue du desk ; absent, une opinion. */
export function statutWord(statut: NoteStatut | undefined): string {
  switch (statut) {
    case 'fait':
      return tr('fait', 'fact', 'hecho');
    case 'modele':
      return tr('modèle', 'model', 'modelo');
    case 'chiffre-non-verifie':
      return tr('chiffre non vérifié', 'unverified figure', 'cifra no verificada');
    default:
      return tr('opinion', 'opinion', 'opinión');
  }
}

/** L'auteur d'une note : vous, ou un agent (adoptée ou non). */
export function noteAuthor(note: { by?: 'agent'; adoptedAt?: number }): string {
  if (note.by !== 'agent') return tr('vous', 'you', 'usted');
  return note.adoptedAt != null ? tr('agent · adoptée', 'agent · adopted', 'agente · adoptada') : tr('agent · non adoptée', 'agent · not adopted', 'agente · no adoptada');
}

/** Ouvrir la note dans Note : un saut, que Retour arrière défait. */
export function openInNote(id: string): FicheAction {
  return {
    id: 'note',
    glyph: 'note',
    label: tr('Ouvrir dans Note', 'Open in Note', 'Abrir en Nota'),
    run: () => {
      useNotes.getState().setActive(id);
      useObjects.getState().jumpTo('note');
    },
  };
}

export function NoteFiche({ target, ctx, now }: { target: EntityRef; ctx: IndexSources; now: number }) {
  useI18n((st) => st.locale);
  const full = useNotes((n) => n.notes.find((x) => x.id === target.id));
  const note = ctx.notes.find((x) => x.id === target.id);
  if (!note) return null;
  const header = parseNoteHeader(note.body);
  const statut = full?.statut ?? header.statut;
  const day = noteTradingDay({ id: note.id, title: note.title, body: note.body, tags: note.tags });
  const parent = full?.parentId ? ctx.notes.find((x) => x.id === full.parentId) : undefined;
  const source = day ? tr('coffre de notes · note du jour', 'note vault · day note', 'caja de notas · nota del día') : tr('coffre de notes', 'note vault', 'caja de notas');
  const rows: PropertyRow[] = [
    [tr('Source', 'Source', 'Fuente'), source],
    [tr('Auteur', 'Author', 'Autor'), noteAuthor(note)],
    [tr('Statut', 'Status', 'Estado'), statutWord(statut)],
    [tr('Étiquettes', 'Tags', 'Etiquetas'), note.tags.length ? note.tags.map((tag) => `#${tag}`).join(' ') : '—'],
    [tr('Jour de séance', 'Session day', 'Día de sesión'), day ? formatDateFr(day, { weekday: true }) : '—'],
    [tr('Suite de', 'Follows', 'Sigue a'), parent ? <ObjectLink key="parent" to={{ type: 'note', id: parent.id }} label={parent.title.trim() || tr('Sans titre', 'Untitled', 'Sin título')} /> : '—'],
    [tr('Modifiée', 'Updated', 'Modificada'), stamped(note.updatedAt)],
  ];
  if (isStrategyNote(note)) rows.push([tr('Stratégie', 'Strategy', 'Estrategia'), <ObjectLink key="strategy" to={{ type: 'strategie', id: note.id }} label={`#${header.tag ?? slugifyTitle(note.title)}`} />]);
  return (
    <>
      <FicheHead type="note" title={ficheTitle(target, ctx, now)} actions={[openInNote(note.id), copyAction(target)]} />
      <div className={s.body} data-fiche="note">
        <FicheSection part="properties" title={tr('Propriétés', 'Properties', 'Propiedades')}>
          <Properties rows={rows} />
        </FicheSection>
        <FicheSection part="links" title={tr('Liens', 'Links', 'Enlaces')}>
          <LinksByPredicate target={target} ctx={ctx} now={now} />
        </FicheSection>

        <FicheSection part="around" title={tr('Autour de…', 'Around…', 'Alrededor de…')}>
          <AroundOf target={target} ctx={ctx} now={now} />
        </FicheSection>
        <ActivitySection target={target} ctx={ctx} />
        <FicheSection part="provenance" title={tr('Provenance', 'Provenance', 'Procedencia')}>
          <Provenance lines={[`${tr('Note', 'Note', 'Nota')} · ${source} · ${noteAuthor(note)}`, ...linkProvenance(target, ctx.links)]} />
        </FicheSection>
      </div>
    </>
  );
}
