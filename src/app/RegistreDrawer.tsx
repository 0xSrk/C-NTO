import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Glyph } from '@/design/Micro';
import { cx } from '@/design/primitives';
import { DESK_EVENT_KINDS } from '@/engine/agent/catalog';
import type { DeskEvent } from '@/engine/agent/events';
import { tr, useI18n } from '@/i18n';
import { fmtInt } from '@/lib/format';
import { deskEventLog, useDeskEvents } from '@/store/deskEvents';
import { useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';
import { useIndexSources } from './objects/index';
import { closeRegistre, eventLine, eventTarget, KIND_GLYPH, kindLabel, logEvents, registreClock, registreScope, useRegistre, type RegistreContext } from './registre';
import { matchShortcut } from './shortcuts';
import r from './registre.module.css';

/**
 * Le registre entier, en tiroir bas de 240 px (OROS5.38, Système 5 « Fiche et Frise » ; repris du prototype D · Porte, d4 ;
 * mesure locale, décision 4). Mode liste, du plus récent au plus ancien : l'heure de New York, le glyphe du genre (aucun
 * signe réservé), le genre, l'objet touché, ce qui s'est passé. Les filtres par genre ne retirent que l'affichage. La
 * portée est écrite : depuis l'ouverture, en mémoire, 500 au plus. Chaque ligne ouvre la fiche de son objet ; ↑ ↓
 * parcourent les lignes, Entrée ouvre, Échap ferme et rend le focus à ce qui avait ouvert le tiroir — les touches lues
 * dans le registre des raccourcis. Lecture seule : le tiroir ne range ni ne retire rien.
 */

/** Les événements du registre, relus à chaque événement rangé, du plus récent au plus ancien. */
export function useRegistreEvents(): DeskEvent[] {
  const count = useDeskEvents((d) => d.count);
  return useMemo(() => logEvents(deskEventLog).reverse(), [count]);
}

/** Le tiroir, monté seulement ouvert : le lien « Registre n » du rail et la section Activité d'une fiche l'ouvrent. */
export function RegistreDrawer({ className }: { className?: string }) {
  const open = useRegistre((st) => st.open);
  return open ? <Drawer className={className} /> : null;
}

function Drawer({ className }: { className?: string }) {
  useI18n((st) => st.locale);
  const events = useRegistreEvents();
  const kinds = useRegistre((st) => st.kinds);
  const toggleKind = useRegistre((st) => st.toggleKind);
  const friseOpen = useUi((u) => u.friseOpen);
  const now = useMemo(() => Date.now(), [events]);
  const sources = useIndexSources(now);
  const ctx: RegistreContext = useMemo(() => ({ sessions: sources.sessions, trades: sources.trades, catalysts: sources.catalysts }), [sources]);
  const rows = kinds.length ? events.filter((ev) => kinds.includes(ev.kind)) : events;
  const [active, setActive] = useState(0);
  const at = Math.min(active, Math.max(0, rows.length - 1));
  const listRef = useRef<HTMLOListElement>(null);

  // Ouvert, la liste prend le focus : ↑ ↓ y parcourent les lignes aussitôt.
  useEffect(() => {
    if (!useObjects.getState().locked) listRef.current?.focus();
  }, []);
  // Le tiroir de la frise et le registre ne s'ouvrent pas ensemble : la frise dépliée replie le registre.
  useEffect(() => {
    if (friseOpen) closeRegistre(false);
  }, [friseOpen]);
  // La ligne active reste en vue.
  useEffect(() => {
    const row = rows[at];
    if (row) document.getElementById(`registre-${row.seq}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [at, rows]);

  const openRow = (ev: DeskEvent | undefined) => {
    const target = ev ? eventTarget(ev, ctx) : null;
    // Une ligne d'une liste, comme une ligne de A.04 : Échap, dans la fiche, rend le focus au registre.
    if (target) useObjects.getState().openObject(target, { origin: listRef.current });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (useObjects.getState().locked) return;
    const hit = matchShortcut('registre', event);
    if (!hit) return;
    // Échap ferme d'où qu'on soit dans le tiroir ; ↑ ↓ et Entrée n'agissent que dans la liste.
    if (hit.id === 'registreClose') {
      event.preventDefault();
      closeRegistre();
      return;
    }
    if (event.target !== listRef.current) return;
    event.preventDefault();
    if (hit.id === 'registreChoose') setActive(Math.max(0, Math.min(rows.length - 1, at + (hit.index === 1 ? 1 : -1))));
    else if (hit.id === 'registreOpen') openRow(rows[at]);
  };

  return (
    <section className={cx(r.drawer, className)} data-registre="" aria-label={tr('Registre du lancement', 'Launch log', 'Registro del lanzamiento')} onKeyDown={onKeyDown}>
      <header className={r.head}>
        <h2 className={r.title}>{tr('Registre', 'Log', 'Registro')}</h2>
        <span className={r.scope} data-registre-scope="">
          {registreScope()}
        </span>
        <span className={r.total}>{fmtInt(events.length)}</span>
        <div className={r.kinds} role="group" aria-label={tr('Genres', 'Kinds', 'Tipos')}>
          {DESK_EVENT_KINDS.map((kind) => {
            const n = events.filter((ev) => ev.kind === kind).length;
            const on = kinds.includes(kind);
            return (
              <button key={kind} type="button" className={cx(r.kind, on && r.kindOn)} data-kind-filter={kind} aria-pressed={on} disabled={n === 0 && !on} onClick={() => toggleKind(kind)}>
                <Glyph name={KIND_GLYPH[kind]} className={r.kindGlyph} />
                {kindLabel(kind)} <b>{fmtInt(n)}</b>
              </button>
            );
          })}
        </div>
        <button type="button" className={r.close} onClick={() => closeRegistre()} aria-label={tr('Fermer le registre (Échap)', 'Close the log (Esc)', 'Cerrar el registro (Esc)')}>
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden>
            <path d="M1 1 9 9M9 1 1 9" />
          </svg>
        </button>
      </header>
      {rows.length === 0 ? (
        <p className={r.empty}>
          {tr(
            'Rien depuis l’ouverture. Le registre range les exécutions et les ordres du pont NinjaTrader, la marge du plan suivi, la perte du jour, les catalyseurs proches, le lien du pont, les propositions de l’agent, les écarts de discipline et les alertes crypto.',
            'Nothing since opening. The log keeps fills and orders from the NinjaTrader bridge, the tracked plan margin, the day loss, upcoming catalysts, the bridge link, the agent’s proposals, discipline breaches and crypto alerts.',
            'Nada desde la apertura. El registro guarda las ejecuciones y órdenes del puente NinjaTrader, el margen del plan seguido, la pérdida del día, los catalizadores próximos, el enlace del puente, las propuestas del agente, los desvíos de disciplina y las alertas cripto.',
          )}
        </p>
      ) : (
        <ol ref={listRef} className={r.list} role="listbox" tabIndex={0} aria-label={tr('Événements du lancement', 'Launch events', 'Eventos del lanzamiento')} aria-activedescendant={rows[at] ? `registre-${rows[at]!.seq}` : undefined}>
          {rows.map((ev, i) => {
            const line = eventLine(ev);
            const target = eventTarget(ev, ctx);
            return (
              <li
                key={ev.seq}
                id={`registre-${ev.seq}`}
                role="option"
                aria-selected={i === at}
                className={cx(r.row, i === at && r.rowOn, target && r.rowGo)}
                data-seq={ev.seq}
                data-kind={ev.kind}
                onClick={() => {
                  setActive(i);
                  openRow(ev);
                }}
              >
                <time className={r.time} dateTime={new Date(ev.at).toISOString()}>
                  {registreClock(ev.at)}
                </time>
                <Glyph name={KIND_GLYPH[ev.kind]} className={r.glyph} />
                <span className={r.kindName}>{kindLabel(ev.kind)}</span>
                {/* L'objet, puis ce qui s'est passé : à l'étroit, la ligne passe à la ligne, jamais dans une ellipse. */}
                <span className={r.text}>
                  <span className={r.object}>{line.object}</span>
                  <span className={r.detail}>{line.detail}</span>
                </span>
                <span className={r.seq}>#{ev.seq}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
