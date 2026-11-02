import { useMemo, type ReactNode } from 'react';
import { Glyph } from '@/design/Micro';
import { TYPE_GLYPH } from '@/design/micro/meaning';
import { cx } from '@/design/primitives';
import { entityKey, groupNeighbors, mirror, neighborsOf, sampleOf, setNeighborGroups, type EntityRef, type NeighborGroup } from '@/engine/ontology';
import { tr, useI18n } from '@/i18n';
import { fmtInt, plural } from '@/lib/format';
import { sameRef, useObjects, type ObjectSet, type PathStep } from '@/store/objects';
import { capital, objectInstant, predicateLabel } from './Fiche';
import { objectLabel, typeWord, type IndexSources } from './index';
import { Mirror } from './Instruments';
import { sampleWord } from './sample';
import s from './fiche.module.css';

/**
 * « Autour de… » (OROS5.31, Système 5 « Fiche et Frise » ; repris de d1, ouvert à tous les prédicats sur la correction du
 * juge Palantir). Depuis toute fiche, chaque prédicat de l'objet est proposé avec son compte — pendant, de la séance,
 * mentionne, applique… — tels que le moteur groupe les liens (`groupNeighbors`). Suivre un prédicat affiche l'ensemble
 * qu'il atteint ; depuis un ensemble, ses propres prédicats sont proposés (`setNeighborGroups`) : les sauts s'enchaînent.
 * Le chemin s'écrit au glacier, dans l'ordre du saut, et finit sur l'ensemble affiché ; chaque saut est un saut du store
 * (`openSet`), que Retour arrière défait. M.036 met l'ensemble face au reste, l'échantillon de chaque côté. Rien n'écrit.
 */

/** Au-delà, l'ensemble se lit par ↑ ↓ depuis sa première ligne : la fiche n'en écrit qu'autant. */
export const SET_ROWS_MAX = 24;

/** Une entrée de plus, propre à la fiche (la famille d'un catalyseur) : un ensemble déjà calculé, sous un prédicat. */
export interface AroundExtra {
  id: string;
  label: string;
  edge: PathStep & { kind: 'edge' };
  type: EntityRef['type'];
  members: readonly EntityRef[];
}

/** Les objets distincts d'un groupe, dans son ordre (l'ordre du temps, `orderGroups`). */
function membersOf(group: NeighborGroup): EntityRef[] {
  const seen = new Set<string>();
  const out: EntityRef[] = [];
  for (const n of group.items) {
    const key = entityKey(n.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n.ref);
  }
  return out;
}

/** Les séances d'un ensemble, pour M.036 : ses séances, ou celles de ses trades ; aucune pour un autre type. */
export function setSessions(set: Pick<ObjectSet, 'type' | 'members'>, ctx: Pick<IndexSources, 'trades'>): Set<string> | null {
  if (set.type === 'session') return new Set(set.members.map((m) => m.id));
  if (set.type === 'trade') {
    const ids = new Set(set.members.map((m) => m.id));
    return new Set(ctx.trades.filter((t) => ids.has(t.id)).map((t) => t.sessionId));
  }
  return null;
}

/** Le nom d'un nœud du chemin : l'objet en clair, ou l'ensemble et son compte. */
function nodeLabel(step: PathStep & { kind: 'node' }, ctx: IndexSources, now: number): string {
  if (step.ref) return objectLabel(step.ref, ctx, now) ?? capital(typeWord(step.type));
  return `${fmtInt(step.count)} ${typeWord(step.type, step.count)}`;
}

/** Le chemin, au glacier, dans l'ordre du saut ; il finit sur l'ensemble affiché. Retour arrière défait le dernier saut. */
function SetPath({ set, ctx, now }: { set: ObjectSet; ctx: IndexSources; now: number }) {
  const back = useObjects((o) => o.back);
  const clearSet = useObjects((o) => o.clearSet);
  return (
    <nav className={s.path} data-path="" aria-label={tr('Chemin de l’ensemble', 'Path of the set', 'Camino del conjunto')}>
      <span className={s.pathTools}>
        <button type="button" className={s.pathTool} data-path-tool="back" onClick={() => back()} title={tr('Défaire le dernier saut · Retour arrière', 'Undo the last jump · Backspace', 'Deshacer el último salto · Retroceso')}>
          ⌫ {tr('retour', 'back', 'atrás')}
        </button>
        <button type="button" className={s.pathTool} data-path-tool="clear" onClick={() => clearSet()} aria-label={tr('Retirer l’ensemble', 'Remove the set', 'Quitar el conjunto')} title={tr('Retirer l’ensemble', 'Remove the set', 'Quitar el conjunto')}>
          ×
        </button>
      </span>
      {set.path.map((step, i) =>
        step.kind === 'node' ? (
          <span key={i} className={cx(s.pathNode, i === set.path.length - 1 && s.pathLast)} data-step="node">
            <Glyph name={TYPE_GLYPH[step.type]} className={s.pathGlyph} />
            {nodeLabel(step, ctx, now)}
          </span>
        ) : (
          <span key={i} className={s.pathEdge} data-step="edge">
            {step.side === 'out' ? '→' : '←'} {predicateLabel(step.predicate)}
            {step.note ? ` · ${step.note}` : ''}
          </span>
        ),
      )}
    </nav>
  );
}

export function AroundOf({ target, ctx, now, extra, children }: { target: EntityRef; ctx: IndexSources; now: number; extra?: readonly AroundExtra[]; children?: ReactNode }) {
  useI18n((st) => st.locale);
  const shown = useObjects((o) => (o.set && sameRef(o.set.from, target) ? o.set : null));
  const openSet = useObjects((o) => o.openSet);
  const openObject = useObjects((o) => o.openObject);
  // Les prédicats proposés : ceux de l'objet, ou, un ensemble affiché, les siens.
  const groups = useMemo(() => {
    const raw = shown ? setNeighborGroups(shown.members, ctx.links) : groupNeighbors(neighborsOf(target, ctx.links));
    return raw.filter((g) => g.count > 0).map((g) => ({ ...g, items: [...g.items].sort((a, b) => (objectInstant(a.ref, ctx) ?? Infinity) - (objectInstant(b.ref, ctx) ?? Infinity) || a.ref.id.localeCompare(b.ref.id)) }));
  }, [shown, target, ctx]);
  const sessions = useMemo(() => (shown ? setSessions(shown, ctx) : null), [shown, ctx]);
  const reading = useMemo(() => (sessions ? mirror(ctx.sessions, ctx.trades, sessions) : null), [sessions, ctx.sessions, ctx.trades]);
  const base: PathStep[] = shown ? [...shown.path] : [{ kind: 'node', type: target.type, count: 1, ref: target }];
  const jump = (edge: PathStep & { kind: 'edge' }, type: EntityRef['type'], members: readonly EntityRef[]) =>
    openSet({ from: target, type, members, path: [...base, edge, { kind: 'node', type, count: members.length }] });
  const rows = [
    ...(shown ? [] : (extra ?? [])).map((x) => ({ id: x.id, side: x.edge.side, predicate: x.edge.predicate, note: x.label, type: x.type, count: x.members.length, run: () => jump(x.edge, x.type, x.members) })),
    ...groups.map((g) => {
      const members = membersOf(g);
      return { id: g.id, side: g.side, predicate: g.predicate, note: undefined as string | undefined, type: g.type, count: members.length, run: () => jump({ kind: 'edge', predicate: g.predicate, side: g.side }, g.type, members) };
    }),
  ];
  const memberRefs = shown ? [...shown.members] : [];
  return (
    <div className={s.around} data-around={shown ? 'set' : 'object'}>
      {shown ? <SetPath set={shown} ctx={ctx} now={now} /> : null}
      {shown ? (
        <div className={s.setMembers} data-set={shown.type}>
          {memberRefs.slice(0, SET_ROWS_MAX).map((ref) => (
            <button key={entityKey(ref)} type="button" className={cx(s.row, s.setRow)} data-member={entityKey(ref)} onClick={(event) => openObject(ref, { jump: true, origin: event.currentTarget, siblings: memberRefs })} title={tr('Ouvrir sa fiche', 'Open its record', 'Abrir su ficha')}>
              <Glyph name={TYPE_GLYPH[ref.type]} className={s.rowGlyph} />
              <span className={s.rowMain}>{objectLabel(ref, ctx, now) ?? tr('Absent du coffre', 'Missing from the vault', 'Ausente de la caja')}</span>
              <span className={s.rowGo} aria-hidden>
                →
              </span>
            </button>
          ))}
          {memberRefs.length > SET_ROWS_MAX ? (
            <p className={s.setMore}>
              {tr(
                `et ${fmtInt(memberRefs.length - SET_ROWS_MAX)} de plus, que ↑ ↓ parcourent depuis une fiche de l’ensemble`,
                `and ${fmtInt(memberRefs.length - SET_ROWS_MAX)} more, which ↑ ↓ walk from a record of the set`,
                `y ${fmtInt(memberRefs.length - SET_ROWS_MAX)} más, que ↑ ↓ recorren desde una ficha del conjunto`,
              )}
            </p>
          ) : null}
          {reading ? (
            <Mirror
              inside={reading.inside}
              outside={reading.outside}
              leftTitle={tr('l’ensemble', 'the set', 'el conjunto')}
              rightTitle={tr('le reste', 'the rest', 'el resto')}
              leftSample={sampleWord(sampleOf(reading.inside.trades))}
              rightSample={sampleWord(sampleOf(reading.outside.trades))}
            />
          ) : null}
        </div>
      ) : (
        children
      )}
      {rows.length ? (
        <div className={s.predicates} data-predicates="">
          <p className={s.predicatesHead}>{shown ? tr('Depuis l’ensemble', 'From the set', 'Desde el conjunto') : tr('Depuis l’objet', 'From the object', 'Desde el objeto')}</p>
          {rows.map((row) => (
            <button key={row.id} type="button" className={cx(s.row, s.predicateRow)} data-predicate={row.id} onClick={row.run}>
              <span className={s.predicate}>
                {row.side === 'out' ? '→' : '←'} {predicateLabel(row.predicate)}
              </span>
              <span className={s.rowMain}>
                {capital(typeWord(row.type, row.count))}
                {row.note ? <small className={s.predicateNote}> · {row.note}</small> : null}
              </span>
              <span className={s.groupCount}>{fmtInt(row.count)}</span>
              <span className={s.rowGo} aria-hidden>
                →
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className={s.empty}>{tr('Aucun prédicat à suivre.', 'No predicate to follow.', 'Ningún predicado que seguir.')}</p>
      )}
      {shown ? (
        <p className={s.setFoot}>
          {plural(shown.members.length, typeWord(shown.type), typeWord(shown.type, 2))} · {tr('Retour arrière défait le dernier saut', 'Backspace undoes the last jump', 'Retroceso deshace el último salto')}
        </p>
      ) : null}
    </div>
  );
}
