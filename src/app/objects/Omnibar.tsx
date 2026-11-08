import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Glyph } from '@/design/Micro';
import { cx } from '@/design/primitives';
import { tr, useI18n } from '@/i18n';
import { fmtInt } from '@/lib/format';
import { useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';
import { matchShortcut } from '../shortcuts';
import { EtatMark } from './Fiche';
import { normalize, omniGroupTitle, searchObjectIndex, useObjectIndex, type OmniGroupResult, type OmniItem } from './index';
import s from './omnibar.module.css';

/**
 * L'omnibar (OROS5.17, Système 5 « Fiche et Frise » ; repris de d1) : Ctrl+J, jamais Ctrl+K, voisin du kill switch
 * Ctrl+Maj+K. Une superposition de 500 px à 20 vh, le champ marqué de la cible (C.085), les résultats de l'index des objets
 * (OROS5.15), un pied qui ne dit que les touches. Elle ne fait que naviguer : chaque résultat ouvre un module ou la fiche
 * d'un objet. Sous le verrou, elle ne s'ouvre pas.
 */
export function Omnibar() {
  useI18n((st) => st.locale);
  const open = useObjects((o) => o.omnibar);
  if (!open || typeof document === 'undefined') return null;
  // Hors du châssis, comme une fenêtre : la superposition ne suit pas sa grille.
  return createPortal(<OmnibarPanel />, document.body);
}

/** Le titre d'une ligne, la part trouvée en ivoire plein. */
function Marked({ text, words }: { text: string; words: readonly string[] }) {
  const hay = normalize(text);
  const word = words.find((w) => hay.includes(w));
  // Le texte normalisé garde la longueur du titre (lettres accentuées précomposées) ; sinon, rien n'est marqué.
  if (!word || hay.length !== text.length) return <>{text}</>;
  const at = hay.indexOf(word);
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + word.length)}</mark>
      {text.slice(at + word.length)}
    </>
  );
}

function OmnibarPanel() {
  const locale = useI18n((st) => st.locale);
  const setOmnibar = useObjects((o) => o.setOmnibar);
  const openObject = useObjects((o) => o.openObject);
  const setTab = useUi((u) => u.setTab);
  const [now] = useState(() => Date.now());
  const index = useObjectIndex(now);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  /** L'élément qui avait le focus : Échap le lui rend, et la fiche ouverte d'ici le prend pour ligne d'origine. */
  const before = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const groups = useMemo<OmniGroupResult[]>(() => searchObjectIndex(index, query, now, locale), [index, query, now, locale]);
  const flat = useMemo(() => groups.flatMap((group) => group.items.map((item) => ({ item, group }))), [groups]);
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const words = useMemo(() => normalize(query).split(/\s+/).filter(Boolean), [query]);

  // La ligne choisie au clavier reste en vue, comme au registre (OROS5.38c) : quand le choix ou la requête change, pas à
  // chaque objet rangé. Celle qui ouvre un groupe ramène sa tête avec elle. À l'ouverture, elle est déjà en vue.
  useEffect(() => {
    const row = document.getElementById(`omni-${current}`);
    row?.scrollIntoView?.({ block: 'nearest' });
    const head = row?.previousElementSibling;
    if (head?.getAttribute('aria-hidden') === 'true') head.scrollIntoView?.({ block: 'nearest' });
  }, [current, query]);

  const dismiss = () => {
    setOmnibar(false);
    if (before.current?.isConnected) before.current.focus();
  };

  /** La liste fermée des commandes : ouvrir un module, ou la fiche d'un objet. Rien d'autre. */
  const run = (item: OmniItem, group: OmniGroupResult) => {
    setOmnibar(false);
    if (item.target.kind === 'tab') {
      setTab(item.target.tab);
      if (before.current?.isConnected) before.current.focus();
      return;
    }
    const siblings = group.hits.flatMap((hit) => (hit.target.kind === 'object' ? [hit.target.ref] : []));
    openObject(item.target.ref, { jump: true, focus: true, origin: before.current, siblings });
  };

  // Les touches de l'omnibar, lues dans le registre des raccourcis (OROS5.18).
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const key = matchShortcut('omnibar', event);
    if (!key) return;
    event.preventDefault();
    if (key.id === 'dismiss') {
      // Échap, ou Ctrl+J une seconde fois : l'omnibar se ferme et rend le focus.
      event.stopPropagation();
      dismiss();
    } else if (key.id === 'choose') {
      // ↑ (rang 0) ou ↓ (rang 1), en boucle.
      if (flat.length > 0) setActive((current + (key.index === 1 ? 1 : flat.length - 1)) % flat.length);
    } else if (key.id === 'open') {
      const hit = flat[current];
      if (hit) run(hit.item, hit.group);
    }
    // `stay` : une fenêtre, le focus reste au champ.
  };

  let n = -1;
  return (
    <div className={s.veil} onMouseDown={(event) => event.target === event.currentTarget && dismiss()}>
      <div className={s.panel} role="dialog" aria-modal="true" aria-label={tr('Aller à un objet', 'Go to an object', 'Ir a un objeto')} data-omnibar>
        <div className={s.field}>
          <Glyph name="target" className={s.target} />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={tr('Module, séance, trade, note, catalyseur, instrument, stratégie, compte…', 'Module, session, trade, note, catalyst, instrument, strategy, account…', 'Módulo, sesión, trade, nota, catalizador, instrumento, estrategia, cuenta…')}
            role="combobox"
            aria-expanded="true"
            aria-controls="omnibar-list"
            aria-autocomplete="list"
            aria-activedescendant={flat[current] ? `omni-${current}` : undefined}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className={s.kbd}>Ctrl J</kbd>
        </div>
        <div id="omnibar-list" className={s.list} role="listbox" aria-label={tr('Résultats', 'Results', 'Resultados')}>
          {groups.length === 0 ? <p className={s.empty}>{tr('Aucun objet ne répond.', 'No object matches.', 'Ningún objeto coincide.')}</p> : null}
          {groups.map((group) => (
            <div key={group.group} role="group" aria-label={omniGroupTitle(group.group)} data-omni-group={group.group}>
              <div className={s.groupHead} aria-hidden>
                <span>{omniGroupTitle(group.group)}</span>
                {group.total > group.items.length ? <span>+ {fmtInt(group.total - group.items.length)}</span> : null}
              </div>
              {group.items.map((item) => {
                n += 1;
                const i = n;
                return (
                  <div key={item.key} id={`omni-${i}`} role="option" aria-selected={i === current} className={cx(s.item, i === current && s.active)} data-key={item.key} onClick={() => run(item, group)}>
                    <EtatMark stroke={item.stroke} />
                    <Glyph name={item.glyph} className={s.glyph} />
                    <b>
                      <Marked text={item.title} words={words} />
                    </b>
                    {item.meta ? <span className={cx(s.meta, item.tone && s[item.tone])}>{item.meta}</span> : <span />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className={s.foot} aria-hidden>
          <span>↑ ↓ {tr('choisir', 'choose', 'elegir')}</span>
          <span>↵ {tr('ouvrir', 'open', 'abrir')}</span>
          <span>{tr('Échap fermer', 'Esc close', 'Esc cerrar')}</span>
        </div>
      </div>
    </div>
  );
}
