import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  coerceStoredReport,
  isApiId,
  isDateNear,
  parseReport,
  REPORT_BOUNDS,
  REPORT_FORMAT,
  reportCodes,
  reportSummary,
  sortReports,
  type CloudReport,
} from '@/engine/agent/cloudReport';

const VALID = {
  format: REPORT_FORMAT,
  date: '2026-10-27',
  title: 'Brief pré-séance',
  summary: 'Trois catalyseurs ;\nun seul majeur.',
  sections: [{ heading: 'Calendrier', body: '- 14:30 CPI\n- 16:00 ISM' }],
  sources: [
    { title: 'BLS', url: 'https://www.bls.gov/cpi/' },
    { title: 'en clair', url: 'http://example.com/' },
    { title: 'script', url: 'javascript:alert(1)' },
    { url: 'https://www.federalreserve.gov/' },
  ],
  generatedAt: '2026-10-27T05:12:00Z',
  inconnu: 'ignoré',
};

describe('agent cloud · contrat canto.rapport/1', () => {
  it('lit un rapport complet : https seulement pour les sources, clés inconnues ignorées', () => {
    const parsed = parseReport(VALID);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.report).toEqual({
      date: '2026-10-27',
      title: 'Brief pré-séance',
      summary: 'Trois catalyseurs ;\nun seul majeur.',
      sections: [{ heading: 'Calendrier', body: '- 14:30 CPI\n- 16:00 ISM' }],
      sources: [
        { title: 'BLS', url: 'https://www.bls.gov/cpi/' },
        { title: 'www.federalreserve.gov', url: 'https://www.federalreserve.gov/' },
      ],
      generatedAt: Date.parse('2026-10-27T05:12:00Z'),
    });
  });

  it('refuse sans le format, la date civile, le titre ou une section lisible', () => {
    expect(parseReport(null)).toEqual({ ok: false, reason: 'not_object' });
    expect(parseReport([VALID])).toEqual({ ok: false, reason: 'not_object' });
    expect(parseReport({ ...VALID, format: 'canto.rapport/2' })).toEqual({ ok: false, reason: 'format' });
    expect(parseReport({ ...VALID, date: '2026-02-30' })).toEqual({ ok: false, reason: 'date' });
    expect(parseReport({ ...VALID, date: '27/10/2026' })).toEqual({ ok: false, reason: 'date' });
    expect(parseReport({ ...VALID, title: ' \u0000 ' })).toEqual({ ok: false, reason: 'title' });
    expect(parseReport({ ...VALID, sections: [] })).toEqual({ ok: false, reason: 'sections' });
    expect(parseReport({ ...VALID, sections: [{ heading: 'Vide', body: '   ' }] })).toEqual({ ok: false, reason: 'section' });
    expect(parseReport({ ...VALID, sections: ['texte'] })).toEqual({ ok: false, reason: 'section' });
  });

  it('borne chaque texte et retire les contrôles et les marques bidirectionnelles', () => {
    const long = 'x'.repeat(REPORT_BOUNDS.body + 50);
    const parsed = parseReport({
      ...VALID,
      title: `Titre\u0007 sur\nune ligne‮`,
      sections: Array.from({ length: REPORT_BOUNDS.sections + 3 }, (_, i) => ({ heading: `S${i}`, body: i === 0 ? long : `corps\r\n\u001b[31m${i}` })),
      sources: Array.from({ length: REPORT_BOUNDS.sources + 5 }, (_, i) => ({ title: `s${i}`, url: `https://example.org/${i}` })),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.report.title).toBe('Titre sur une ligne');
    expect(parsed.report.sections).toHaveLength(REPORT_BOUNDS.sections);
    expect(parsed.report.sections[0]?.body).toHaveLength(REPORT_BOUNDS.body);
    expect(parsed.report.sections[0]?.body.endsWith('…')).toBe(true);
    expect(parsed.report.sections[1]?.body).toBe('corps\n[31m1');
    expect(parsed.report.sources).toHaveLength(REPORT_BOUNDS.sources);
  });

  it('ne garde pas une URL https porteuse d’identifiants', () => {
    const parsed = parseReport({ ...VALID, sources: [{ title: 'piège', url: 'https://user:pass@example.org/' }] });
    expect(parsed.ok && parsed.report.sources).toEqual([]);
  });

  it('relit un rapport rangé ; une fiche altérée ou d’une autre forme est écartée', () => {
    const parsed = parseReport(VALID);
    if (!parsed.ok) throw new Error('rapport valide attendu');
    const stored: CloudReport = {
      v: 1,
      id: 'sesn_011CZkZAtmR3yMPDzynEDxu7',
      ...parsed.report,
      receivedAt: 1_800_000_000_000,
      session: { id: 'sesn_011CZkZAtmR3yMPDzynEDxu7', createdAt: 1_799_999_000_000, costCents: 42, agentVersion: 3 },
    };
    expect(coerceStoredReport(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(coerceStoredReport({ ...stored, id: '../../etc/passwd' })).toBeNull();
    expect(coerceStoredReport({ ...stored, v: 2 })).toBeNull();
    expect(coerceStoredReport({ ...stored, receivedAt: 'hier' })).toBeNull();
    expect(coerceStoredReport({ ...stored, generatedAt: 1e20 })?.generatedAt).toBeNull();
    expect(coerceStoredReport({ ...stored, session: null })?.session).toEqual({ id: stored.id, createdAt: null, costCents: null, agentVersion: null });
  });

  it('CLD16 la journée d’un rapport doit tomber à sept jours au plus de sa session', () => {
    const at = Date.parse('2026-10-27T05:00:00Z');
    expect(isDateNear('2026-10-27', at)).toBe(true);
    expect(isDateNear('2026-10-26', at)).toBe(true);
    expect(isDateNear('2026-11-03', at)).toBe(true);
    expect(isDateNear('2026-11-06', at)).toBe(false);
    expect(isDateNear('2100-12-31', at)).toBe(false);
    expect(isDateNear('2026-10-27', Number.NaN)).toBe(false);
  });

  it('identifiants d’objets de l’API : préfixe et alphabet fermés', () => {
    expect(isApiId('sesn_011CZkZAtmR3yMPDzynEDxu7', 'sesn')).toBe(true);
    expect(isApiId('depl_011CZkZcDH3vPqd7xnEfwTai', 'sesn')).toBe(false);
    expect(isApiId('sesn_../x')).toBe(false);
    expect(isApiId('sesn_abc')).toBe(false);
  });

  it('codes en clair par journée, et tri du plus récent au plus ancien', () => {
    const rows = [
      { id: 'sesn_aaaaaaaa', date: '2026-10-26', receivedAt: 3 },
      { id: 'sesn_bbbbbbbb', date: '2026-10-27', receivedAt: 5 },
      { id: 'sesn_cccccccc', date: '2026-10-27', receivedAt: 9 },
    ];
    const codes = reportCodes(rows);
    expect(codes.get('sesn_aaaaaaaa')).toBe('AGT-RPT-20261026');
    expect(codes.get('sesn_bbbbbbbb')).toBe('AGT-RPT-20261027');
    expect(codes.get('sesn_cccccccc')).toBe('AGT-RPT-20261027-2');
    expect(sortReports(rows).map((r) => r.id)).toEqual(['sesn_cccccccc', 'sesn_bbbbbbbb', 'sesn_aaaaaaaa']);
  });

  it('la ligne du dossier ne porte pas le corps', () => {
    const parsed = parseReport(VALID);
    if (!parsed.ok) throw new Error('rapport valide attendu');
    const report: CloudReport = { v: 1, id: 'sesn_aaaaaaaa', ...parsed.report, receivedAt: 1, session: { id: 'sesn_aaaaaaaa', createdAt: null, costCents: null, agentVersion: null } };
    expect(Object.keys(reportSummary(report, false)).sort()).toEqual(['date', 'generatedAt', 'id', 'read', 'receivedAt', 'summary', 'title']);
  });

  it('module partagé avec le process principal : déclaré aux trois endroits', () => {
    expect(JSON.parse(readFileSync('electron/tsconfig.sources.json', 'utf8')).files).toContain('../src/engine/agent/cloudReport.ts');
    expect(readFileSync('vitest.config.mts', 'utf8')).toContain(`'agent/cloudReport': 'src/engine/agent/cloudReport.ts'`);
    expect(readFileSync('electron/agent/cloudReport.d.ts', 'utf8')).toContain('export function parseReport(raw: unknown): ReportParse;');
    expect(readFileSync('src/engine/agent/cloudReport.ts', 'utf8')).not.toMatch(/^import /m);
  });
});
