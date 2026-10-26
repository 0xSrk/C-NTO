/**
 * Types du module émis vers `dist-electron/agent/cloudReport.js`.
 * L'implémentation est `src/engine/agent/cloudReport.ts`.
 */
export const REPORT_FORMAT: 'canto.rapport/1';
export const REPORT_FILE: 'rapport.json';
export const REPORT_MAX_BYTES: number;
export const REPORT_BOUNDS: {
  readonly title: 160;
  readonly summary: 1200;
  readonly sections: 24;
  readonly heading: 160;
  readonly body: 24000;
  readonly sources: 40;
  readonly sourceTitle: 200;
  readonly url: 2048;
};
export interface CloudReportSection {
  heading: string;
  body: string;
}
export interface CloudReportSource {
  title: string;
  url: string;
}
export interface CloudReportBody {
  date: string;
  title: string;
  summary: string;
  sections: CloudReportSection[];
  sources: CloudReportSource[];
  generatedAt: number | null;
}
export interface CloudReportSession {
  id: string;
  createdAt: number | null;
  costCents: number | null;
  agentVersion: number | null;
}
export interface CloudReport extends CloudReportBody {
  v: 1;
  id: string;
  receivedAt: number;
  session: CloudReportSession;
}
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
export function isApiId(v: unknown, prefix?: string): v is string;
export function cleanText(v: unknown, max: number, multiline?: boolean): string;
export function isCivilDate(v: unknown): v is string;
export function parseReport(raw: unknown): ReportParse;
export function coerceStoredReport(raw: unknown): CloudReport | null;
export function reportSummary(report: CloudReport, read: boolean): CloudReportSummary;
export function sortReports<T extends { date: string; receivedAt: number }>(list: readonly T[]): T[];
export function reportCodes(list: readonly { id: string; date: string; receivedAt: number }[]): Map<string, string>;
