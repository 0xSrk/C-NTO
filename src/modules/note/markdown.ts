import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { splitCode, TAG_RE, WIKILINK_RE } from '@/store/notes';

marked.setOptions({ gfm: true, breaks: true });

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Assainissement commun : pas de formulaires, d'iframes, de styles inline ni de cibles de
 * fenêtre — dans une fenêtre sans cadre, un contenu ne doit jamais pouvoir se faire passer
 * pour l'interface. Seuls http(s), mailto et les ancres sont admis comme URL.
 */
const SANITIZE: import('dompurify').Config = {
  ADD_ATTR: ['data-title', 'data-tag'],
  FORBID_ATTR: ['style', 'target'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'object', 'embed'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
};

/** Rendu Markdown simple et assaini (messages de l'agent). */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, SANITIZE);
}

/** Rend le Markdown d'une note : liens [[wiki]], #tags, puis assainissement. */
export function renderNote(body: string, knownTitles: Set<string>): string {
  const pre = splitCode(body)
    .map((part) =>
      part.code
        ? part.text
        : part.text
            .replace(WIKILINK_RE, (_m, target: string, alias?: string) => {
              const title = target.trim();
              const exists = knownTitles.has(title.toLowerCase());
              return `<a class="wikilink${exists ? '' : ' missing'}" data-title="${escapeHtml(title)}" href="#">${escapeHtml(alias?.trim() || title)}</a>`;
            })
            .replace(TAG_RE, (_m, lead: string, tag: string) => `${lead}<span class="ntag" data-tag="${escapeHtml(tag.toLowerCase())}">#${escapeHtml(tag)}</span>`),
    )
    .join('');
  const html = marked.parse(pre, { async: false }) as string;
  return DOMPurify.sanitize(html, SANITIZE);
}
