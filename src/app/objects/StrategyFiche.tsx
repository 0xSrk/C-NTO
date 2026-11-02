import { useMemo } from 'react';
import { Montant } from '@/design/primitives';
import { mirror, parseNoteHeader, slugifyTitle, type EntityRef } from '@/engine/ontology';
import { tr, useI18n } from '@/i18n';
import { fmtPct, fmtUsd, plural } from '@/lib/format';
import { copyAction, FicheHead, FicheSection, ficheTitle, LinksByPredicate, linkProvenance, Properties, Provenance, stamped } from './Fiche';
import { type IndexSources } from './index';
import { IdentityGrid } from './Instruments';
import { noteAuthor, openInNote } from './NoteFiche';
import { sampleWord } from './sample';
import s from './fiche.module.css';
import { AroundOf } from './AroundOf';

/**
 * La fiche Stratégie (OROS5.28, correction du juge Palantir) : une note étiquetée `strategie`, que des séances appliquent
 * (liens « applique »). Elle dit ces séances et leur résultat, lu par le moteur sur leur ensemble (`mirror` : séances,
 * trades, réussite, net, échantillon) ; rien n'est recalculé ici.
 */

const signedClass = (v: number) => (v > 0 ? s.pos : v < 0 ? s.neg : undefined);
const montantChars = (v: number) => fmtUsd(v, { cents: true, sign: true }).length;

/** Les séances qui appliquent la stratégie : les liens vivants « applique », d'une séance vers elle. */
export function applyingSessions(target: EntityRef, ctx: Pick<IndexSources, 'links'>): Set<string> {
  const out = new Set<string>();
  for (const link of ctx.links) {
    if (link.kind === 'rejete' || link.predicate !== 'applique' || link.from.type !== 'session') continue;
    if (link.to.type === target.type && link.to.id === target.id) out.add(link.from.id);
  }
  return out;
}

export function StrategyFiche({ target, ctx, now }: { target: EntityRef; ctx: IndexSources; now: number }) {
  useI18n((st) => st.locale);
  const note = ctx.notes.find((x) => x.id === target.id);
  const applying = useMemo(() => applyingSessions(target, ctx), [target, ctx]);
  const result = useMemo(() => mirror(ctx.sessions, ctx.trades, applying).inside, [ctx.sessions, ctx.trades, applying]);
  if (!note) return null;
  const header = parseNoteHeader(note.body);
  return (
    <>
      <FicheHead type="strategie" title={ficheTitle(target, ctx, now)} actions={[openInNote(note.id), copyAction(target)]} />
      <div className={s.body} data-fiche="strategie">
        <IdentityGrid
          label={tr('Résultat de la stratégie', 'Strategy result', 'Resultado de la estrategia')}
          lead={<span className={s.identText}>#{header.tag ?? slugifyTitle(note.title)}</span>}
          when={plural(result.sessions, tr('séance', 'session', 'sesión'), tr('séances', 'sessions', 'sesiones'))}
          numeral={result.sessions > 0 ? <Montant value={result.net} className={signedClass(result.net)} /> : '—'}
          chars={result.sessions > 0 ? montantChars(result.net) : 1}
          sub={`${tr('net des séances qui l’appliquent', 'net of the sessions applying it', 'neto de las sesiones que la aplican')} · USD`}
          aside={
            <>
              <span className={s.identStrong}>{result.winRate !== null ? fmtPct(result.winRate, 0) : '—'}</span>
              <span className={s.identUnit}>{tr('réussite', 'win rate', 'acierto')}</span>
            </>
          }
          foot={[plural(result.trades, 'trade', 'trades'), `${tr('échantillon', 'sample', 'muestra')} ${sampleWord(result.sample)}`]}
        />
        <FicheSection part="properties" title={tr('Propriétés', 'Properties', 'Propiedades')}>
          <Properties
            rows={[
              [tr('Séances qui l’appliquent', 'Sessions applying it', 'Sesiones que la aplican'), String(result.sessions)],
              [tr('Moyenne par séance', 'Average per session', 'Media por sesión'), result.perSession !== null ? <Montant key="avg" value={result.perSession} className={signedClass(result.perSession)} /> : '—'],
              [tr('Auteur', 'Author', 'Autor'), noteAuthor(note)],
              [tr('Modifiée', 'Updated', 'Modificada'), stamped(note.updatedAt)],
            ]}
          />
        </FicheSection>
        <FicheSection part="links" title={tr('Liens', 'Links', 'Enlaces')}>
          <LinksByPredicate target={target} ctx={ctx} now={now} />
        </FicheSection>

        <FicheSection part="around" title={tr('Autour de…', 'Around…', 'Alrededor de…')}>
          <AroundOf target={target} ctx={ctx} now={now} />
        </FicheSection>
        <FicheSection part="provenance" title={tr('Provenance', 'Provenance', 'Procedencia')}>
          <Provenance
            lines={[
              tr('Stratégie : une note étiquetée #strategie du coffre de notes', 'Strategy: a note tagged #strategie in the note vault', 'Estrategia: una nota etiquetada #strategie de la caja de notas'),
              tr('Résultat : les séances liées « applique », lues par le moteur sur leur ensemble', 'Result: the sessions linked “applies”, read by the engine as a set', 'Resultado: las sesiones ligadas «aplica», leídas por el motor en conjunto'),
              ...linkProvenance(target, ctx.links),
            ]}
          />
        </FicheSection>
      </div>
    </>
  );
}
