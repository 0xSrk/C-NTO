import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLE_ORIGINS, bundleCoverage, calendarBundle, materializeBundle, type BundleEvent } from '@/engine/calendar-bundle';
import { eventProvenance } from '@/engine/macroMerge';

const FOMC_2026 = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'];
const ECB_MEETINGS = ['2026-10-29', '2026-12-17', '2027-02-04', '2027-03-18'];

function monthsOf(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

describe('instantané calendrier embarqué', () => {
  it('valide le schéma, la couverture et les institutions', () => {
    const year = new Date().getUTCFullYear();
    const raw = JSON.parse(readFileSync('src/engine/calendar-bundle/2026.json', 'utf8')) as {
      schemaVersion: number;
      generatedAt: string;
      coverage: { from: string; to: string };
      attribution: { ecb: string };
      events: Array<BundleEvent & { sourceId?: string; id?: string; syncedAt?: number }>;
    };
    expect(raw.schemaVersion).toBe(1);
    expect(calendarBundle.schemaVersion).toBe(1);
    expect(raw.attribution.ecb).toBe('Source : Banque centrale européenne, réutilisation avec attribution');
    expect(raw.coverage.from <= `${year}-01-01`).toBe(true);
    expect(raw.coverage.to >= `${year + 1}-03-31`).toBe(true);
    expect(bundleCoverage()).toEqual(raw.coverage);
    expect(raw.events.length).toBeGreaterThan(0);

    for (const event of raw.events) {
      expect(BUNDLE_ORIGINS).toContain(event.origin);
      expect(event.sourceId).toBeUndefined();
      expect(event.id).toBeUndefined();
      expect(event.syncedAt).toBeUndefined();
      expect(event.key.length).toBeGreaterThan(0);
      expect(event.estimated).toEqual(expect.any(Boolean));
    }

    const rows = materializeBundle(raw.coverage, 0);
    expect(rows.length).toBe(raw.events.length);
    expect(rows.every((row) => row.sourceId === 'bundle')).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);

    for (const month of monthsOf(year)) {
      expect(rows.some((row) => row.origin === 'bls' && row.category === 'emploi' && row.date.startsWith(month)), month).toBe(true);
    }
    const decisions = rows.filter((row) => row.origin === 'fed' && row.title.startsWith('Décision') && row.date.startsWith(String(year))).map((row) => row.date);
    expect(decisions).toEqual(FOMC_2026);
    for (const date of ECB_MEETINGS) {
      expect(rows.some((row) => row.origin === 'ecb' && row.category === 'banque-centrale' && row.date === date), date).toBe(true);
    }

    const eia = rows.filter((row) => row.origin === 'eia').map((row) => row.date).sort();
    expect(eia.length).toBeGreaterThan(50);
    expect(dayNumber(eia[0]!) - dayNumber(raw.coverage.from)).toBeLessThanOrEqual(7);
    for (let i = 1; i < eia.length; i++) {
      // Un report férié (jeudi au lieu du mercredi) écarte deux publications de 8 jours, pas d'une semaine manquante.
      expect(dayNumber(eia[i]!) - dayNumber(eia[i - 1]!), `${eia[i - 1]} → ${eia[i]}`).toBeLessThanOrEqual(8);
    }
    expect(dayNumber(raw.coverage.to) - dayNumber(eia[eia.length - 1]!)).toBeLessThanOrEqual(7);
    expect(rows.some((row) => row.origin === 'eia' && row.estimated)).toBe(true);
    expect(rows.some((row) => row.origin === 'eia' && !row.estimated)).toBe(true);

    const nfp = rows.find((row) => row.origin === 'bls' && row.date === '2026-02-11');
    expect(eventProvenance(nfp?.sourceId, nfp?.origin)).toBe('Calendrier embarqué · BLS');
  });

  it('deux exécutions --from-fixtures sont identiques hors generatedAt', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-snapshot-'));
    const run = (file: string) => {
      const result = spawnSync(process.execPath, ['scripts/calendar-snapshot.mjs', '--from-fixtures', '--out', file], {
        cwd: path.resolve('.'),
        encoding: 'utf8',
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { generatedAt: string; events: unknown[] };
      const { generatedAt, ...rest } = parsed;
      expect(generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      return rest;
    };
    const first = run(path.join(dir, 'a.json'));
    const second = run(path.join(dir, 'b.json'));
    expect(second).toEqual(first);
    const committed = JSON.parse(readFileSync('src/engine/calendar-bundle/2026.json', 'utf8')) as { generatedAt: string };
    const { generatedAt, ...rest } = committed;
    expect(generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rest).toEqual(first);
  });

  it('n’écrit pas un fichier partiel quand une source manque', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-snapshot-empty-'));
    const out = path.join(dir, 'missing.json');
    const result = spawnSync(process.execPath, ['scripts/calendar-snapshot.mjs', '--from-fixtures', '--fixtures', dir, '--out', out], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/bls/);
    expect(existsSync(out)).toBe(false);
  });

  it('conserve l’institution en échec depuis le fichier précédent', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-snapshot-partial-'));
    const out = path.join(dir, '2026.json');
    const kept = {
      origin: 'bls',
      key: 'nfp-2026-02-11',
      date: '2026-02-11',
      timeET: '08:30',
      title: 'Rapport emploi US (NFP)',
      category: 'emploi',
      impact: 3,
      currency: 'USD',
      instruments: [],
      estimated: false,
    };
    writeFileSync(out, JSON.stringify({ schemaVersion: 1, generatedAt: '2026-01-01T00:00:00.000Z', coverage: { from: '2026-01-01', to: '2027-03-31' }, attribution: { ecb: 'x' }, events: [kept] }));
    const result = spawnSync(process.execPath, ['scripts/calendar-snapshot.mjs', '--from-fixtures', '--fixtures', dir, '--allow-partial', '--out', out], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/bls : 1 événement\(s\) conservé/);
    const parsed = JSON.parse(readFileSync(out, 'utf8')) as { events: BundleEvent[] };
    expect(parsed.events).toEqual([kept]);
  });
});
