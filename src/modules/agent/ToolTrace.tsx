import { useMemo } from 'react';
import { objectGlyph, objectLabel, useIndexSources } from '@/app/objects/index';
import { instrumentKey } from '@/app/registre';
import { Glyph } from '@/design/Micro';
import e from '@/design/etat.module.css';
import { cx } from '@/design/primitives';
import { DESK_TOOL_KINDS, TOOL_PREAMBLE, type DeskToolName } from '@/engine/agent/catalog';
import { tr, useI18n } from '@/i18n';
import { fmtInt, plural } from '@/lib/format';
import type { AgentMessage } from '@/store/db';
import { refKey, useObjects, type ObjectRef } from '@/store/objects';
import s from './agent.module.css';

/**
 * La trace des outils sous chaque réponse de l'agent (OROS5.41, Système 5 « Fiche et Frise » ; repris du prototype D ·
 * Porte, d4) : une ligne par appel — le nom de l'outil en Geist Mono au glacier (la technique), ses arguments bornés, sans
 * clé ni jeton, son issue et sa durée en millisecondes —, puis « Contexte lu » : les objets du desk que l'agent a lus,
 * chacun ouvre sa fiche. On audite une réponse sans deviner. L'appel en cours reste au halo tireté de la table d'états
 * jusqu'à son résultat : rien ne clignote, rien ne pulse, et l'or reste à l'opérateur. Tout se lit des messages rangés.
 */

type Call = NonNullable<AgentMessage['toolCalls']>[number];

/** `ok` rendu ; `refused` refusé (le desk, la garde, le trader) ; `error` en erreur ; `running` en cours ; `interrupted` sans résultat. */
export type TraceIssue = 'ok' | 'refused' | 'error' | 'running' | 'interrupted';

export interface TraceRow {
  id: string;
  name: string;
  /** Les arguments, bornés, sans clé ni jeton. */
  args: string;
  issue: TraceIssue;
  /** Le motif d'un refus ou d'une erreur, tel que le résultat le nomme (`reason`, `status`), borné. */
  why?: string;
  /** Du début de l'appel à son résultat ; `null` tant qu'il court, ou sans début connu. */
  ms: number | null;
  /** Le résultat tel que l'agent l'a reçu, sans le préambule. */
  result?: string;
}

/** Les arguments d'une ligne : 120 caractères au plus ; une valeur, 32. */
export const ARGS_MAX = 120;
const VALUE_MAX = 32;
const MASK = '••••';
/** Un nom d'argument qui porte un secret : sa valeur n'est jamais montrée, à quelque profondeur qu'il soit. */
const SECRET_KEY = /token|key|secret|pass(?:word)?|auth|bearer|credential|cookie|signature/i;
/**
 * Les formes d'un secret (clé d'API, jeton, JWT, en-tête `Bearer`, longue chaîne opaque), où qu'elles soient dans une
 * chaîne : chacune est remplacée par le masque, le reste de la chaîne se lit.
 */
const SECRET_SPAN = /\b[Bb]earer\s+\S+|\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]*|\bxox[abprs]-[A-Za-z0-9-]*|\bgh[pousr]_[A-Za-z0-9_]*|\bgithub_pat_[A-Za-z0-9_]*|\bglpat-[A-Za-z0-9_-]*|\beyJ[A-Za-z0-9_.-]*|[A-Za-z0-9+/_=-]{32,}/g;
/** Dans un texte illisible : une paire dont le nom porte un secret (`"api_key": "…"`, `token=…`), sa valeur jusqu'au bout si elle n'est pas close. */
const SECRET_PAIR = /("?)([\w$.-]*(?:token|key|secret|pass(?:word)?|auth|bearer|credential|cookie|signature)[\w$.-]*)\1(\s*[:=]\s*)("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[^\s,;}\]]+)/gi;

function bounded(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Une chaîne, ses secrets masqués, ses blancs réduits. */
const scrubText = (text: string): string => text.replace(SECRET_SPAN, MASK).replace(/\s+/g, ' ').trim();

/** Une valeur, ses secrets masqués à toute profondeur : chaque nom qui porte un secret, chaque chaîne qui en contient un. */
function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, SECRET_KEY.test(key) ? MASK : scrubValue(v)]));
  return value;
}

/** Les arguments d'un appel, bornés : `clé valeur · clé valeur` ; une clé ou un jeton n'y paraît jamais (OROS5.41a). */
export function argsSummary(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    // Illisibles (un flux coupé, un JSON mal formé) : le texte, ses paires secrètes et ses formes de secret masquées.
    return bounded(scrubText(raw.replace(SECRET_PAIR, (_m, quote: string, name: string, sep: string) => `${quote}${name}${quote}${sep}${MASK}`)), ARGS_MAX);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  const parts = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
    if (SECRET_KEY.test(key)) return `${key} ${MASK}`;
    if (typeof value === 'string') return `${key} ${bounded(scrubText(value), VALUE_MAX)}`;
    return `${key} ${bounded(JSON.stringify(scrubValue(value)) ?? '', VALUE_MAX)}`;
  });
  return bounded(parts.join(' · '), ARGS_MAX);
}

/** Le résultat d'un appel tel que l'agent l'a reçu, sans le préambule du desk. */
function resultBody(result: AgentMessage): string {
  return result.content.startsWith(TOOL_PREAMBLE) ? result.content.slice(TOOL_PREAMBLE.length) : result.content;
}

function parsed(result: AgentMessage): Record<string, unknown> | null {
  try {
    const body = JSON.parse(resultBody(result)) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** L'issue d'un appel, lue dans son résultat : un refus (`ok: false`, un statut de refus), une erreur, sinon rendu. */
export function issueOf(result: AgentMessage): { issue: TraceIssue; why?: string } {
  const body = parsed(result);
  if (!body) return { issue: 'ok' };
  const word = (v: unknown) => (typeof v === 'string' && v.trim() ? bounded(v.trim(), VALUE_MAX) : undefined);
  if (typeof body.error === 'string') return { issue: 'error', why: word(body.error) };
  if (body.status === 'refused' || body.status === 'declined' || body.status === 'failed') return { issue: 'refused', why: word(body.reason) ?? word(body.status) };
  if (body.ok === false) return { issue: 'refused', why: word(body.reason) ?? word(body.status) };
  return { issue: 'ok' };
}

/** Le résultat d'un appel : par son identifiant d'appel, ou par l'`id` des messages rangés avant `toolCallId`. */
function resultOf(call: Call, results: readonly AgentMessage[]): AgentMessage | undefined {
  return results.find((m) => m.role === 'tool' && m.toolCallId === call.id) ?? results.find((m) => m.role === 'tool' && !m.toolCallId && m.id === call.id);
}

/**
 * Les lignes de la trace d'une réponse. Les appels courent l'un après l'autre (`runAgentTurn`) : un appel commence quand le
 * précédent a rendu son résultat, le premier quand la réponse est rangée ; sa durée va de là à son résultat. Sans résultat,
 * l'appel court tant que le flux tourne ; après, il est resté sans résultat.
 */
export function traceRows(answer: AgentMessage, results: readonly AgentMessage[], streaming: boolean): TraceRow[] {
  let start: number | null = answer.createdAt;
  return (answer.toolCalls ?? []).map((call) => {
    const result = resultOf(call, results);
    const row: TraceRow = { id: call.id, name: call.name, args: argsSummary(call.args), issue: streaming ? 'running' : 'interrupted', ms: null };
    if (result) {
      Object.assign(row, issueOf(result), { ms: start === null ? null : Math.max(0, result.createdAt - start), result: resultBody(result) });
      start = result.createdAt;
    } else start = null;
    return row;
  });
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str((x as { id?: unknown } | null)?.id)).filter(Boolean) : []);

/**
 * Les objets qu'un appel de lecture rendu a lus, tirés de ses arguments et de son résultat : les séances de `list_sessions`
 * et `get_session`, les notes de `search_notes` et `read_note`, le compte de `propfirm_status`, l'instrument de
 * `market_quote` et `market_levels`. Une écriture, un refus ou une erreur ne lit rien.
 */
export function readRefs(call: Call, result: AgentMessage | undefined): ObjectRef[] {
  if (DESK_TOOL_KINDS[call.name as DeskToolName] !== 'read' || !result || issueOf(result).issue !== 'ok') return [];
  const body = parsed(result) ?? {};
  let args: Record<string, unknown> = {};
  try {
    args = (JSON.parse(call.args || '{}') as Record<string, unknown>) ?? {};
  } catch {
    /* arguments illisibles : le résultat seul dit ce qui a été lu */
  }
  switch (call.name) {
    case 'list_sessions':
      return ids(body.sessions).map((id) => ({ type: 'session', id }));
    case 'get_session': {
      const id = str((body.session as { id?: unknown } | undefined)?.id) || str(args.id);
      return id ? [{ type: 'session', id }] : [];
    }
    case 'search_notes':
      return ids(body.notes).map((id) => ({ type: 'note', id }));
    case 'read_note': {
      const id = str(body.id);
      return id ? [{ type: 'note', id }] : [];
    }
    case 'propfirm_status': {
      const account = str(body.account);
      return account ? [{ type: 'compte', id: account }] : [];
    }
    case 'market_quote':
    case 'market_levels': {
      const root = instrumentKey(str(body.instrument) || str(args.instrument));
      return root ? [{ type: 'instrument', id: root }] : [];
    }
    default:
      return [];
  }
}

function issueWord(row: TraceRow): string {
  const why = row.why ? ` · ${row.why}` : '';
  switch (row.issue) {
    case 'ok':
      return tr('rendu', 'returned', 'devuelto');
    case 'refused':
      return `${tr('refusé', 'refused', 'rechazado')}${why}`;
    case 'error':
      return `${tr('erreur', 'error', 'error')}${why}`;
    case 'running':
      return tr('en cours', 'running', 'en curso');
    case 'interrupted':
      return tr('sans résultat', 'no result', 'sin resultado');
  }
}

/** Le trait de la ligne, dans la table d'états : en cours, tireté ; resté sans résultat, éteint ; rendu ou refusé, plein. */
function rowEtat(issue: TraceIssue): string | undefined {
  return issue === 'running' ? e.tirete : issue === 'interrupted' ? e.eteint : e.plein;
}

/** Au plus tant d'objets dans « Contexte lu » ; le compte dit le reste. */
export const CONTEXT_MAX = 8;

/** « Contexte lu » : les objets du desk que l'agent a lus, chacun ouvre sa fiche ; un objet absent du desk n'y paraît pas. */
function ContextRead({ refs }: { refs: readonly ObjectRef[] }) {
  const now = useMemo(() => Date.now(), []);
  const ctx = useIndexSources(now);
  const named = refs.map((ref) => ({ ref, label: objectLabel(ref, ctx, now) })).filter((x): x is { ref: ObjectRef; label: string } => x.label !== null);
  if (named.length === 0) return null;
  const shown = named.slice(0, CONTEXT_MAX);
  const siblings = shown.map((x) => x.ref);
  return (
    <div className={s.contextRead} data-context-read={named.length}>
      <span className={s.contextHead}>
        {tr('Contexte lu', 'Context read', 'Contexto leído')} · {plural(named.length, tr('objet', 'object', 'objeto'), tr('objets', 'objects', 'objetos'))}
      </span>
      {shown.map(({ ref, label }) => (
        <button key={refKey(ref)} type="button" className={s.contextItem} data-object={refKey(ref)} onClick={(event) => useObjects.getState().openObject(ref, { origin: event.currentTarget, siblings })} title={tr('Ouvrir sa fiche', 'Open its record', 'Abrir su ficha')}>
          <Glyph name={objectGlyph(ref.type)} className={s.contextGlyph} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

/** La trace des outils d'une réponse de l'agent, puis le contexte qu'elle a lu. */
export function ToolTrace({ answer, results, streaming }: { answer: AgentMessage; results: readonly AgentMessage[]; streaming: boolean }) {
  useI18n((st) => st.locale);
  const rows = traceRows(answer, results, streaming);
  const refs = useMemo(() => {
    const seen = new Map<string, ObjectRef>();
    for (const call of answer.toolCalls ?? []) for (const ref of readRefs(call, resultOf(call, results))) seen.set(refKey(ref), ref);
    return [...seen.values()];
  }, [answer, results]);
  if (rows.length === 0) return null;
  return (
    <div className={s.trace}>
      <ol className={s.traceList} aria-label={tr('Outils appelés', 'Tools called', 'Herramientas llamadas')}>
        {rows.map((row) => (
          <li key={row.id} className={s.traceRow} data-tool={row.name} data-issue={row.issue}>
            <i className={cx(s.traceMark, rowEtat(row.issue))} data-etat={row.issue} aria-hidden />
            <code className={s.traceName}>{row.name}</code>
            <span className={s.traceArgs}>{row.args || '—'}</span>
            <span className={s.traceIssue}>
              {row.issue === 'refused' || row.issue === 'error' ? <Glyph name="refused" className={s.traceGlyph} /> : null}
              {issueWord(row)}
            </span>
            <span className={s.traceMs}>{row.ms === null ? '—' : `${fmtInt(row.ms)} ms`}</span>
            {row.result !== undefined ? (
              <details className={s.traceResult}>
                <summary>{tr('Résultat', 'Result', 'Resultado')}</summary>
                <pre>{bounded(pretty(row.result), 1200)}</pre>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
      <ContextRead refs={refs} />
    </div>
  );
}

function pretty(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 1);
  } catch {
    return content; /* texte brut */
  }
}
