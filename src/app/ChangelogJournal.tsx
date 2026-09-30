import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/design/Modal';
import { changelog, compareSemver, type ChangelogKind } from '@/engine/changelog';
import { tr, useI18n, type Locale } from '@/i18n';
import { getSetting, setSetting } from '@/store/db';
import s from './shell.module.css';

const SEEN_KEY = 'changelog.seen';
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Point « nouveau » tant que la dernière version vue est antérieure à la version courante. Absent = pas encore ouvert. */
export function changelogUnseen(current: string, seen: string | null): boolean {
  const cur = current.trim().replace(/^v/i, '');
  if (!VERSION_RE.test(cur)) return false;
  if (seen == null) return true;
  const prev = seen.trim().replace(/^v/i, '');
  if (!VERSION_RE.test(prev)) return true;
  return compareSemver(cur, prev) > 0;
}

function kindLabel(kind: ChangelogKind): string {
  if (kind === 'correctif') return tr('correctif', 'fix', 'correctivo');
  if (kind === 'majeur') return tr('majeur', 'major', 'mayor');
  return tr('fonctionnalité', 'feature', 'funcionalidad');
}

export function VersionMark({ version, unseen, onOpen }: { version: string; unseen: boolean; onOpen: () => void }) {
  useI18n((st) => st.locale);
  return (
    <button type="button" className={s.versionBtn} onClick={onOpen} aria-label={tr('Journal des versions', 'Version journal', 'Diario de versiones')}>
      v{version}
      {unseen ? <i className={s.versionDot} data-changelog-dot="" aria-hidden="true" /> : null}
    </button>
  );
}

export function ChangelogBody({ version }: { version: string }) {
  const locale = useI18n((st) => st.locale);
  const shown = [...changelog.entries].reverse().filter((entry) => compareSemver(entry.version, version) <= 0);
  return (
    <div className={s.journal}>
      {shown.map((entry, index) => (
        <details key={entry.version} className={s.journalEntry} open={index === 0}>
          <summary>
            <b>v{entry.version}</b>
            <span>{entry.date}</span>
            <span className={s.journalKind}>{kindLabel(entry.kind)}</span>
          </summary>
          <ul>
            {points(entry.highlights, locale).map((point, i) => (
              <li key={`${entry.version}-${i}`}>{point}</li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function points(highlights: { fr: string[]; en: string[]; es: string[] }, locale: Locale): string[] {
  if (locale === 'en') return highlights.en;
  if (locale === 'es') return highlights.es;
  return highlights.fr;
}

/** Rail, sous le compte actif : le numéro ouvre le journal. Aucun message ne s'ouvre seul. */
export function ChangelogJournal({ version }: { version: string }) {
  const [seen, setSeen] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const loadGen = useRef(0);

  useEffect(() => {
    const id = ++loadGen.current;
    void getSetting<unknown>(SEEN_KEY, null)
      .then((value) => {
        if (loadGen.current !== id) return;
        setSeen(typeof value === 'string' ? value : null);
        setReady(true);
      })
      .catch(() => {
        if (loadGen.current !== id) return;
        setSeen(null);
        setReady(true);
      });
  }, []);

  const unseen = ready && changelogUnseen(version, seen);

  const openJournal = () => {
    setOpen(true);
    if (!changelogUnseen(version, seen) && ready) return;
    loadGen.current += 1;
    setSeen(version);
    setReady(true);
    void setSetting(SEEN_KEY, version);
  };

  return (
    <>
      <VersionMark version={version} unseen={unseen} onOpen={openJournal} />
      {open && (
        <Modal title={tr('Journal des versions', 'Version journal', 'Diario de versiones')} sub={tr('toutes les versions', 'every version', 'todas las versiones')} onClose={() => setOpen(false)} width={560}>
          <ChangelogBody version={version} />
        </Modal>
      )}
    </>
  );
}
