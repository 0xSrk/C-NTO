import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconGraph, IconPlus, IconSearch, IconTrash } from '@/app/icons';
import { ModuleContent, ModuleHeader } from '@/app/Shell';
import { Button, Empty, Segmented, Tag, cx } from '@/design/primitives';
import { tr, useI18n } from '@/i18n';
import { saveTextFile } from '@/lib/desk';
import { plural } from '@/lib/format';
import { dateKeyLocal, dateTimeFormatter, formatDateFr } from '@/lib/time';
import type { Note as NoteType } from '@/store/db';
import { byTitle, extractLinks, useNotes } from '@/store/notes';
import { useUi } from '@/store/ui';
import { Graph } from './Graph';
import { renderNote } from './markdown';
import { suggestNoteTitle } from './title';
import s from './note.module.css';

type Mode = 'editer' | 'scinde' | 'apercu';

const UPDATED_OPTS: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };

function formatUpdated(ms: number): string {
  return dateTimeFormatter(UPDATED_OPTS).format(ms);
}

export default function Note() {
  useI18n((s) => s.locale);
  const { notes, activeId, setActive, create, update, remove, openByTitle, dailyNote } = useNotes();
  const toast = useUi((u) => u.toast);
  const confirmDialog = useUi((u) => u.confirm);
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('scinde');
  const [graph, setGraph] = useState(false);
  const active = notes.find((n) => n.id === activeId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) && (!tagFilter || n.tags.includes(tagFilter)));
  }, [notes, query, tagFilter]);
  const pinned = filtered.filter((n) => n.pinned);
  const others = filtered.filter((n) => !n.pinned);
  const allTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  }, [notes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault();
        create();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [create]);

  const openGraphNode = useCallback(
    (id: string) => {
      setActive(id);
      setGraph(false);
    },
    [setActive],
  );

  return (
    <>
      <ModuleHeader
        tab="note"
        actions={
          <>
            <Button variant="gold" onClick={() => create()}>
              <IconPlus size={14} /> {tr('Nouvelle note', 'New note', 'Nueva nota')}
            </Button>
            <Button onClick={() => dailyNote(dateKeyLocal(new Date()))}>{tr('Note du jour', 'Daily note', 'Nota del día')}</Button>
            <Button variant="ghost" active={graph} onClick={() => setGraph((g) => !g)}>
              <IconGraph size={14} /> {tr('Graphe', 'Graph', 'Grafo')}
            </Button>
            {!graph && <Segmented value={mode} onChange={setMode} options={[{ value: 'editer', label: tr('Éditer', 'Edit', 'Editar') }, { value: 'scinde', label: tr('Scindé', 'Split', 'Dividido') }, { value: 'apercu', label: tr('Aperçu', 'Preview', 'Vista previa') }]} />}
          </>
        }
      />
      <ModuleContent noPad>
        <div className={s.layout}>
          <aside className={s.list}>
            <div className={s.listHead}>
              <div className={s.search}>
                <IconSearch size={13} />
                <input type="search" placeholder={tr('Rechercher dans le coffre…', 'Search the vault…', 'Buscar en la caja…')} aria-label={tr('Rechercher dans le coffre', 'Search the vault', 'Buscar en la caja')} value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <span className="micro">
                {plural(notes.length, tr('note', 'note', 'nota'), tr('notes', 'notes', 'notas'))} · {plural(allTags.length, tr('tag', 'tag', 'etiqueta'), tr('tags', 'tags', 'etiquetas'))}
              </span>
            </div>
            <div className={s.listBody}>
              {pinned.length > 0 && <div className={s.group}>{tr('Épinglées', 'Pinned', 'Fijadas')}</div>}
              {pinned.map((n) => (
                <NoteItem key={n.id} note={n} on={n.id === activeId} onClick={() => setActive(n.id)} />
              ))}
              {others.length > 0 && <div className={s.group}>{tr('Récentes', 'Recent', 'Recientes')}</div>}
              {others.map((n) => (
                <NoteItem key={n.id} note={n} on={n.id === activeId} onClick={() => setActive(n.id)} />
              ))}
              {filtered.length === 0 && <div className={s.empty}>{tr('Aucune note ne correspond.', 'No notes match.', 'Ninguna nota coincide.')}</div>}
              {allTags.length > 0 && (
                <>
                  <div className={s.group}>{tr('Tags', 'Tags', 'Etiquetas')}</div>
                  <div className={s.tagCloud}>
                    {allTags.map(([t, c]) => (
                      <button key={t} className={cx(s.tagBtn, tagFilter === t && s.on)} onClick={() => setTagFilter(tagFilter === t ? null : t)}>
                        #{t} <span className="dim">{c}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </aside>

          {graph ? (
            <div className={s.editor}>
              <Graph notes={notes} activeId={activeId} onOpen={openGraphNode} />
            </div>
          ) : active ? (
            <Editor key={active.id} note={active} mode={mode} notes={notes} onChange={(patch) => update(active.id, patch)} onOpenTitle={(t) => openByTitle(t)} onTag={(t) => setTagFilter(t)} onDelete={async () => {
              if (await confirmDialog(tr(`Supprimer « ${active.title} » ?`, `Delete “${active.title}”?`, `¿Eliminar « ${active.title} »?`), tr('La note et ses liens entrants seront perdus.', 'The note and its incoming links will be lost.', 'La nota y sus enlaces entrantes se perderán.'))) {
                await remove(active.id);
                toast(tr('Note supprimée.', 'Note deleted.', 'Nota eliminada.'), 'warn');
              }
            }} onExport={() => saveTextFile(`${active.title.replace(/[\\/:*?"<>|]/g, '-')}.md`, active.body, 'text/markdown')} />
          ) : (
            <div className={s.editor} style={{ padding: 24 }}>
              <Empty
                title={tr('Aucune note ouverte', 'No note open', 'Ninguna nota abierta')}
                text={tr('Sélectionnez une note dans le coffre ou créez-en une nouvelle (Ctrl+N).', 'Select a note from the vault or create a new one (Ctrl+N).', 'Seleccione una nota en la caja o cree una nueva (Ctrl+N).')}
                action={
                  <Button variant="gold" onClick={() => create()}>
                    {tr('Nouvelle note', 'New note', 'Nueva nota')}
                  </Button>
                }
              />
            </div>
          )}

          <aside className={s.meta}>{active && <Meta note={active} notes={notes} onOpen={(id) => setActive(id)} onOpenTitle={(t) => openByTitle(t)} />}</aside>
        </div>
      </ModuleContent>
    </>
  );
}

function NoteItem({ note, on, onClick }: { note: NoteType; on: boolean; onClick: () => void }) {
  useI18n((s) => s.locale);
  return (
    <button className={cx(s.item, on && s.on)} onClick={onClick}>
      <span className={s.itemTitle}>{note.title}</span>
      <span className={s.itemMeta}>
        {formatUpdated(note.updatedAt)}
        {note.tags.length ? ` · ${note.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}` : ''}
      </span>
    </button>
  );
}

function Editor({ note, mode, notes, onChange, onOpenTitle, onTag, onDelete, onExport }: { note: NoteType; mode: Mode; notes: NoteType[]; onChange: (patch: { title?: string; body?: string; pinned?: boolean }) => void; onOpenTitle: (t: string) => void; onTag: (t: string) => void; onDelete: () => void; onExport: () => void }) {
  useI18n((s) => s.locale);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const timer = useRef<number | null>(null);
  const titles = useMemo(() => new Set(notes.map((n) => n.title.toLowerCase())), [notes]);
  const html = useMemo(() => renderNote(body, titles), [body, titles]);

  const pending = useRef<{ title?: string; body?: string } | null>(null);
  const titleLocked = useRef(!/^nouvelle note(?: \d+)?$/i.test(note.title.trim()));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const flush = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      const patch = pending.current;
      pending.current = null;
      onChangeRef.current(patch);
    }
  };
  const schedule = (patch: { title?: string; body?: string }) => {
    pending.current = { ...pending.current, ...patch };
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 350);
  };
  // Au changement de note ou au démontage, les dernières frappes sont écrites immédiatement.
  useEffect(() => flush, []);

  const onPreviewClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('a.wikilink, .ntag') as HTMLElement | null;
    if (!el) return;
    e.preventDefault();
    if (el.dataset.title) onOpenTitle(el.dataset.title);
    else if (el.dataset.tag) onTag(el.dataset.tag);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const next = `${body.slice(0, start)}  ${body.slice(ta.selectionEnd)}`;
      setBody(next);
      schedule({ body: next });
      requestAnimationFrame(() => ta.setSelectionRange(start + 2, start + 2));
    }
  };

  return (
    <div className={s.editor}>
      <div className={s.editorHead}>
        <input
          className={s.titleInput}
          value={title}
          placeholder={tr('Titre — sinon la première ligne du texte', 'Title — otherwise the first line of text', 'Título — si no, la primera línea del texto')}
          onChange={(e) => {
            titleLocked.current = true;
            setTitle(e.target.value);
            schedule({ title: e.target.value });
          }}
        />
        <Button size="sm" variant="ghost" active={!!note.pinned} onClick={() => onChange({ pinned: !note.pinned })}>
          {note.pinned ? tr('Épinglée', 'Pinned', 'Fijada') : tr('Épingler', 'Pin', 'Fijar')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onExport}>
          .md
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label={tr('Supprimer la note', 'Delete note', 'Eliminar la nota')} title={tr('Supprimer la note', 'Delete note', 'Eliminar la nota')}>
          <IconTrash size={13} />
        </Button>
      </div>
      <div className={cx(s.editorBody, mode === 'scinde' && s.split)}>
        {mode !== 'apercu' && (
          <textarea
            className={s.textarea}
            value={body}
            onChange={(e) => {
              const nextBody = e.target.value;
              setBody(nextBody);
              if (!titleLocked.current) {
                const blank = tr('Nouvelle note', 'New note', 'Nueva nota');
                const suggested = suggestNoteTitle(blank, nextBody) ?? blank;
                setTitle(suggested);
                schedule({ body: nextBody, title: suggested });
              } else schedule({ body: nextBody });
            }}
            onKeyDown={onKeyDown}
            placeholder={tr('Markdown · [[lien vers une note]] · #tag', 'Markdown · [[link to a note]] · #tag', 'Markdown · [[enlace a una nota]] · #tag')}
            spellCheck={false}
          />
        )}
        {mode !== 'editer' && <div className={s.preview} dangerouslySetInnerHTML={{ __html: html }} onClick={onPreviewClick} />}
      </div>
    </div>
  );
}

function Meta({ note, notes, onOpen, onOpenTitle }: { note: NoteType; notes: NoteType[]; onOpen: (id: string) => void; onOpenTitle: (t: string) => void }) {
  useI18n((s) => s.locale);
  const outgoing = extractLinks(note.body);
  const backlinks = notes.filter((n) => n.id !== note.id && extractLinks(n.body).includes(note.title.toLowerCase()));
  const context = (n: NoteType) => {
    const idx = n.body.toLowerCase().indexOf(`[[${note.title.toLowerCase()}`);
    return idx >= 0 ? n.body.slice(Math.max(0, idx - 50), idx + 70).replace(/\n/g, ' ') : '';
  };
  return (
    <>
      <div className={s.metaSection}>
        <div className={s.metaTitle}>
          <span>{tr('Liens entrants', 'Incoming links', 'Enlaces entrantes')}</span>
          <span>{backlinks.length}</span>
        </div>
        {backlinks.length === 0 && <small>{tr(`Aucune note ne pointe vers celle-ci. Écrivez [[${note.title}]] ailleurs pour créer un lien.`, `No note points here. Write [[${note.title}]] elsewhere to create a link.`, `Ninguna nota apunta aquí. Escriba [[${note.title}]] en otro sitio para crear un enlace.`)}</small>}
        {backlinks.map((n) => (
          <div key={n.id}>
            <button className={s.linkItem} onClick={() => onOpen(n.id)}>
              {n.title}
            </button>
            <div className={s.linkCtx}>…{context(n)}…</div>
          </div>
        ))}
      </div>
      <div className={s.metaSection}>
        <div className={s.metaTitle}>
          <span>{tr('Liens sortants', 'Outgoing links', 'Enlaces salientes')}</span>
          <span>{outgoing.length}</span>
        </div>
        {outgoing.length === 0 && <small>{tr('Aucun lien [[…]] dans cette note.', 'No [[…]] link in this note.', 'Ningún enlace [[…]] en esta nota.')}</small>}
        {outgoing.map((t) => {
          const target = byTitle(notes, t);
          return (
            <button key={t} className={cx(s.linkItem, !target && s.missing)} onClick={() => onOpenTitle(target?.title ?? t)}>
              {target?.title ?? `${t} ${tr('(à créer)', '(to create)', '(por crear)')}`}
            </button>
          );
        })}
      </div>
      <div className={s.metaSection}>
        <div className={s.metaTitle}>
          <span>{tr('Tags', 'Tags', 'Etiquetas')}</span>
          <span>{note.tags.length}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {note.tags.map((t) => (
            <Tag key={t} tone="gold">
              #{t}
            </Tag>
          ))}
        </div>
      </div>
      <div className={s.metaSection}>
        <div className={s.metaTitle}>
          <span>{tr('Propriétés', 'Properties', 'Propiedades')}</span>
        </div>
        <small>
          {tr('Créée le', 'Created', 'Creada el')} {formatDateFr(dateKeyLocal(new Date(note.createdAt)), { short: true })} · {tr('modifiée', 'updated', 'modificada')} {formatUpdated(note.updatedAt)}
          <br />
          {note.body.length} {tr('caractères', 'characters', 'caracteres')} · {note.body.split(/\s+/).filter(Boolean).length} {tr('mots', 'words', 'palabras')}
        </small>
      </div>
    </>
  );
}
