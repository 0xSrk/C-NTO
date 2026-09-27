import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHANGELOG_LOCALES,
  changelog,
  compareSemver,
  entriesSince,
  entryFor,
  isGithubHttpsUrl,
  parseChangelog,
  parseChangelogPayload,
} from '@/engine/changelog';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

describe('journal des versions', () => {
  it('valide le schéma embarqué', () => {
    const raw = JSON.parse(readFileSync('src/engine/changelog/changelog.json', 'utf8')) as unknown;
    expect(parseChangelog(raw)).toEqual(changelog);
    expect(changelog.schemaVersion).toBe(1);
    expect(changelog.entries.length).toBeGreaterThan(0);
  });

  it('contient une entrée pour la version de package.json', () => {
    const entry = entryFor(pkg.version);
    expect(entry).not.toBeNull();
    expect(entry?.version).toBe(pkg.version);
  });

  it('aligne les trois langues sur le même nombre de points', () => {
    for (const entry of changelog.entries) {
      const counts = CHANGELOG_LOCALES.map((locale) => entry.highlights[locale].length);
      expect(new Set(counts).size).toBe(1);
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts[0]).toBeLessThanOrEqual(5);
    }
  });

  it('n’admet que des versions uniques, triées', () => {
    const versions = changelog.entries.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort(compareSemver);
    expect(versions).toEqual(sorted);
  });

  it('entriesSince(2.2.1) renvoie 3.0.0 puis 3.1.0', () => {
    expect(entriesSince('2.2.1').map((entry) => entry.version)).toEqual(['3.0.0', '3.1.0']);
    expect(entriesSince('v2.2.1').map((entry) => entry.version)).toEqual(['3.0.0', '3.1.0']);
    expect(entryFor('3.1.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.0.1')).toBeNull();
  });

  it('rejette un document sans les trois langues, et un asset trop gros ou illisible', () => {
    expect(parseChangelog({ schemaVersion: 1, entries: [{ version: '1.0.0', date: '2026-09-27', kind: 'correctif', highlights: { fr: ['a'], en: ['a'] } }] })).toBeNull();
    expect(parseChangelogPayload('pas du json')).toBeNull();
    expect(parseChangelogPayload(' '.repeat(64 * 1024 + 1))).toBeNull();
  });

  it('n’accepte que les hôtes GitHub en https', () => {
    expect(isGithubHttpsUrl('https://github.com/0xSrk/C-NTO/releases/download/v3.1.0/changelog.json')).toBe(true);
    expect(isGithubHttpsUrl('https://release-assets.githubusercontent.com/github-production-release-asset/x')).toBe(true);
    expect(isGithubHttpsUrl('http://github.com/0xSrk/C-NTO/changelog.json')).toBe(false);
    expect(isGithubHttpsUrl('https://evil.example/changelog.json')).toBe(false);
    expect(isGithubHttpsUrl('https://user:secret@github.com/0xSrk/C-NTO/changelog.json')).toBe(false);
  });
});
