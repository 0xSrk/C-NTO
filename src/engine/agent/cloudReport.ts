/**
 * Rapport de l'agent cloud (Managed Agents, Anthropic) : le contrat `canto.rapport/1`. L'agent l'écrit dans
 * `/mnt/session/outputs/rapport.json` ; le process principal le relève, le lit ici et ne range que la forme
 * normalisée. Le texte vient d'un modèle qui a pu lire le web : tout est borné, les caractères de contrôle
 * tombent, une source n'est gardée qu'en https. Aucun import : ce module tourne dans le process principal
 * (émis vers `dist-electron/agent/cloudReport.js` par `electron/tsconfig.sources.json`) comme dans le renderer.
 */

export const REPORT_FORMAT = 'canto.rapport/1';
/** Nom du fichier que l'agent dépose dans `/mnt/session/outputs/`. */
export const REPORT_FILE = 'rapport.json';
/** Un rapport plus lourd n'est pas téléchargé. */
export const REPORT_MAX_BYTES = 512 * 1024;

export const REPORT_BOUNDS = {
  title: 160,
  summary: 1200,
  sections: 24,
  heading: 160,
  body: 24_000,
  sources: 40,
  sourceTitle: 200,
  url: 2048,
} as const;

export interface CloudReportSection {
  heading: string;
  body: string;
}

export interface CloudReportSource {
  title: string;
  url: string;
}

/** Ce que l'agent a écrit, une fois lu et borné. */
export interface CloudReportBody {
  date: string;
  title: string;
  summary: string;
  sections: CloudReportSection[];
  sources: CloudReportSource[];
  /** Instant d'écriture déclaré par l'agent (ms), `null` s'il est absent ou illisible. */
  generatedAt: number | null;
}

/** La session qui a produit le rapport, telle que l'API la décrit. */
export interface CloudReportSession {
  id: string;
  createdAt: number | null;
  /** Coût de la session aux tarifs publics, en cents ; `null` tant que l'API ne le donne pas. */
  costCents: number | null;
  agentVersion: number | null;
}

/** Le rapport rangé par le desk : un fichier `agent-reports/<session>.json`. */
export interface CloudReport extends CloudReportBody {
  v: 1;
  /** L'identifiant de la session, unique : un rapport par session. */
  id: string;
  receivedAt: number;
  session: CloudReportSession;
}

/** Une ligne du dossier, sans le corps. */
export interface CloudReportSummary {
  id: string;
  date: string;
  title: string;
  summary: string;
  generatedAt: number | null;
  receivedAt: number;
  read: boolean;
}

export type ReportRefusal = 'not_object' | 'format' | 'date' | 'title' | 'sections' | 'section';

export type ReportParse = { ok: true; report: CloudReportBody } | { ok: false; reason: ReportRefusal };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Identifiant d'objet de l'API (`sesn_…`, `depl_…`, `file_…`) : préfixe, souligné, alphanumérique. */
export function isApiId(v: unknown, prefix?: string): v is string {
  if (typeof v !== 'string' || !/^[a-z]{2,8}_[A-Za-z0-9]{6,128}$/.test(v)) return false;
  return prefix === undefined || v.startsWith(`${prefix}_`);
}

/** Texte lisible : caractères de contrôle retirés (sauf saut de ligne et tabulation), fins de ligne unifiées, borné. */
export function cleanText(v: unknown, max: number, multiline = false): string {
  if (typeof v !== 'string') return '';
  const unified = v.replace(/\r\n?/g, '\n');
  // Contrôles C0 et C1, et les marques bidirectionnelles qui renversent un texte à l'affichage.
  const stripped = multiline
    ? unified.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '')
    : unified.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]+/g, ' ').replace(/\s+/g, ' ');
  const trimmed = stripped.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Date civile `AAAA-MM-JJ` qui existe au calendrier. */
export function isCivilDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && y >= 2000 && y <= 2100;
}

function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > REPORT_BOUNDS.url) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

function instant(v: unknown): number | null {
  if (typeof v !== 'string' || v.length > 64) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Lit le JSON que l'agent a écrit. Refus (rien n'est rangé) : forme, `format` autre que `canto.rapport/1`, date
 * absente, titre vide, aucune section lisible. Une section sans titre ou sans corps fait refuser tout le rapport ;
 * une source sans https est seulement écartée. Les clés inconnues sont ignorées.
 */
export function parseReport(raw: unknown): ReportParse {
  if (!isRecord(raw)) return { ok: false, reason: 'not_object' };
  if (raw.format !== REPORT_FORMAT) return { ok: false, reason: 'format' };
  if (!isCivilDate(raw.date)) return { ok: false, reason: 'date' };
  const title = cleanText(raw.title, REPORT_BOUNDS.title);
  if (!title) return { ok: false, reason: 'title' };
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) return { ok: false, reason: 'sections' };
  const sections: CloudReportSection[] = [];
  for (const item of raw.sections.slice(0, REPORT_BOUNDS.sections)) {
    if (!isRecord(item)) return { ok: false, reason: 'section' };
    const heading = cleanText(item.heading, REPORT_BOUNDS.heading);
    const body = cleanText(item.body, REPORT_BOUNDS.body, true);
    if (!heading || !body) return { ok: false, reason: 'section' };
    sections.push({ heading, body });
  }
  const sources: CloudReportSource[] = [];
  for (const item of Array.isArray(raw.sources) ? raw.sources : []) {
    if (sources.length >= REPORT_BOUNDS.sources) break;
    if (!isRecord(item)) continue;
    const url = httpsUrl(item.url);
    if (!url) continue;
    sources.push({ title: cleanText(item.title, REPORT_BOUNDS.sourceTitle) || new URL(url).host, url });
  }
  return {
    ok: true,
    report: {
      date: raw.date,
      title,
      summary: cleanText(raw.summary, REPORT_BOUNDS.summary, true),
      sections,
      sources,
      generatedAt: instant(raw.generatedAt),
    },
  };
}

const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Relit un rapport rangé par le desk (fichier local) ; `null` s'il n'a plus la forme attendue. */
export function coerceStoredReport(raw: unknown): CloudReport | null {
  if (!isRecord(raw) || raw.v !== 1 || !isApiId(raw.id, 'sesn')) return null;
  const generatedAt = finiteOrNull(raw.generatedAt);
  // Au-delà de ±8,64e15 ms, `toISOString` lève : l'instant est alors tenu pour absent.
  const generatedIso = generatedAt !== null && Math.abs(generatedAt) <= 8.64e15 ? new Date(generatedAt).toISOString() : null;
  const parsed = parseReport({ ...raw, format: REPORT_FORMAT, generatedAt: generatedIso });
  const receivedAt = finiteOrNull(raw.receivedAt);
  if (!parsed.ok || receivedAt === null) return null;
  const session = isRecord(raw.session) ? raw.session : {};
  return {
    v: 1,
    id: raw.id,
    ...parsed.report,
    receivedAt,
    session: {
      id: raw.id,
      createdAt: finiteOrNull(session.createdAt),
      costCents: finiteOrNull(session.costCents),
      agentVersion: finiteOrNull(session.agentVersion),
    },
  };
}

export function reportSummary(report: CloudReport, read: boolean): CloudReportSummary {
  return { id: report.id, date: report.date, title: report.title, summary: report.summary, generatedAt: report.generatedAt, receivedAt: report.receivedAt, read };
}

/** Plus récent d'abord : la journée, puis la réception. */
export function sortReports<T extends { date: string; receivedAt: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (a.date === b.date ? b.receivedAt - a.receivedAt : a.date < b.date ? 1 : -1));
}

/**
 * Code de la fiche, en clair : `AGT-RPT-AAAAMMJJ`, suffixé `-2`, `-3`… quand la journée compte plusieurs rapports
 * (rangés du plus ancien au plus récent). Le seul code-barres du desk reste celui de la bande d'état.
 */
export function reportCodes(list: readonly { id: string; date: string; receivedAt: number }[]): Map<string, string> {
  const byDay = new Map<string, { id: string; receivedAt: number }[]>();
  for (const r of list) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);
  const codes = new Map<string, string>();
  for (const [date, rows] of byDay) {
    const base = `AGT-RPT-${date.replace(/-/g, '')}`;
    [...rows].sort((a, b) => a.receivedAt - b.receivedAt).forEach((row, index) => codes.set(row.id, index === 0 ? base : `${base}-${index + 1}`));
  }
  return codes;
}
