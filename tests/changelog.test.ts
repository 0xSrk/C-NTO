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

  it('R3.10a 3.10.0 suit 3.9.0 : la comparaison est numérique, au journal comme au process principal qui propose la mise à jour', async () => {
    const { compareSemver: mainCompare } = await import('../electron/semver');
    for (const compare of [compareSemver, mainCompare]) {
      expect(compare('3.10.0', '3.9.0')).toBe(1);
      expect(compare('v3.9.0', '3.10.0')).toBe(-1);
      expect(compare('3.10.0', 'v3.10.0')).toBe(0);
    }
    expect(changelog.entries.at(-1)?.version).toBe(pkg.version);
  });

  it('R3.10.1a 3.10.1 suit 3.10.0, et reste sous 3.11.0 : un correctif se propose aux desks 3.10.0, au journal comme au process principal', async () => {
    const { compareSemver: mainCompare } = await import('../electron/semver');
    for (const compare of [compareSemver, mainCompare]) {
      expect(compare('3.10.1', '3.10.0')).toBe(1);
      expect(compare('v3.10.0', '3.10.1')).toBe(-1);
      expect(compare('3.10.1', '3.9.0')).toBe(1);
      expect(compare('3.10.1', '3.11.0')).toBe(-1);
      expect(compare('3.10.1', 'v3.10.1')).toBe(0);
    }
    expect(changelog.entries.at(-1)?.version).toBe(pkg.version);
    expect(pkg.version).toBe('3.10.1');
    // Les deux entrées racine du verrou suivent : `npm ci` refuserait un écart.
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
  });

  it('n’admet que des versions uniques, triées', () => {
    const versions = changelog.entries.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
    const sorted = [...versions].sort(compareSemver);
    expect(versions).toEqual(sorted);
  });

  it('entriesSince(2.2.1) renvoie 3.0.0 jusqu’à 3.10.1', () => {
    expect(entriesSince('2.2.1').map((entry) => entry.version)).toEqual(['3.0.0', '3.1.0', '3.2.0', '3.2.1', '3.2.2', '3.3.0', '3.3.1', '3.3.2', '3.3.3', '3.3.4', '3.4.0', '3.5.0', '3.6.0', '3.7.0', '3.8.0', '3.9.0', '3.10.0', '3.10.1']);
    expect(entriesSince('v2.2.1').map((entry) => entry.version)).toEqual(['3.0.0', '3.1.0', '3.2.0', '3.2.1', '3.2.2', '3.3.0', '3.3.1', '3.3.2', '3.3.3', '3.3.4', '3.4.0', '3.5.0', '3.6.0', '3.7.0', '3.8.0', '3.9.0', '3.10.0', '3.10.1']);
    expect(entryFor('3.1.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.2.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.2.0')?.date).toBe('2026-09-29');
    expect(entryFor('3.2.0')?.highlights.fr).toHaveLength(5);
    expect(entryFor('3.2.1')?.kind).toBe('correctif');
    expect(entryFor('3.2.1')?.date).toBe('2026-09-30');
    expect(entryFor('3.2.1')?.highlights.fr).toHaveLength(3);
    expect(entryFor('3.2.2')?.kind).toBe('correctif');
    expect(entryFor('3.2.2')?.highlights.fr).toHaveLength(4);
    expect(entryFor('3.2.2')?.highlights.es).toHaveLength(4);
    expect(entryFor('3.3.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.3.0')?.highlights.fr).toHaveLength(5);
    expect(entryFor('3.3.1')?.kind).toBe('correctif');
    expect(entryFor('3.3.1')?.date).toBe('2026-10-04');
    expect(entryFor('3.3.1')?.highlights.fr).toHaveLength(5);
    expect(entryFor('3.3.2')?.kind).toBe('correctif');
    expect(entryFor('3.3.2')?.date).toBe('2026-10-04');
    expect(entryFor('3.3.2')?.highlights.fr).toHaveLength(3);
    expect(entryFor('3.3.3')?.kind).toBe('correctif');
    expect(entryFor('3.3.3')?.date).toBe('2026-10-05');
    expect(entryFor('3.3.3')?.highlights.fr).toHaveLength(4);
    expect(entryFor('3.3.4')?.kind).toBe('correctif');
    expect(entryFor('3.3.4')?.date).toBe('2026-10-05');
    expect(entryFor('3.3.4')?.highlights.fr).toHaveLength(3);
    expect(entryFor('3.4.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.4.0')?.date).toBe('2026-10-06');
    expect(entryFor('3.4.0')?.highlights.fr).toHaveLength(4);
    expect(entryFor('3.4.0')?.highlights.es).toHaveLength(4);
    expect(entryFor('3.5.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.5.0')?.date).toBe('2026-10-06');
    expect(entryFor('3.5.0')?.highlights.fr).toHaveLength(5);
    expect(entryFor('3.5.0')?.highlights.en).toHaveLength(5);
    expect(entryFor('3.5.0')?.highlights.es).toHaveLength(5);
    expect(entryFor('3.6.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.6.0')?.date).toBe('2026-10-13');
    expect(entryFor('3.6.0')?.highlights.fr).toHaveLength(5);
    expect(entryFor('3.6.0')?.highlights.en).toHaveLength(5);
    expect(entryFor('3.6.0')?.highlights.es).toHaveLength(5);
    expect(entryFor('3.7.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.7.0')?.date).toBe('2026-10-26');
    expect(entryFor('3.7.0')?.highlights.fr).toHaveLength(4);
    expect(entryFor('3.7.0')?.highlights.en).toHaveLength(4);
    expect(entryFor('3.7.0')?.highlights.es).toHaveLength(4);
    // R3.7b la 3.7.0 se publie sans l'agent cloud, destiné à la version suivante (décision de l'ADMIN, 2026-10-26).
    for (const lang of ['fr', 'en', 'es'] as const) expect(entryFor('3.7.0')?.highlights[lang].join(' ')).not.toMatch(/agent cloud|cloud agent|agente en la nube|Managed Agents/i);
    // R3.8b la 3.8.0 porte le Système 4.1 et l'ouverture par un circuit ; la 3.7.0, jamais publiée, la suit dans le journal.
    expect(entryFor('3.8.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.8.0')?.date).toBe('2026-11-01');
    for (const lang of ['fr', 'en', 'es'] as const) expect(entryFor('3.8.0')?.highlights[lang]).toHaveLength(5);
    expect(entryFor('3.8.0')?.highlights.en.join(' ')).toMatch(/Visual system 4\.1/);
    expect(entryFor('3.8.0')?.highlights.en.join(' ')).toMatch(/Hover is a dimmed light again/);
    // R3.9a la 3.9.0 porte la formation quant du desk du Lab et la garde A18 du latent du pont.
    expect(entryFor('3.9.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.9.0')?.date).toBe('2026-11-04');
    for (const lang of ['fr', 'en', 'es'] as const) expect(entryFor('3.9.0')?.highlights[lang]).toHaveLength(3);
    expect(entryFor('3.9.0')?.highlights.en.join(' ')).toMatch(/Train the agent/);
    expect(entryFor('3.9.0')?.highlights.en.join(' ')).toMatch(/\$25 cap/);
    expect(entryFor('3.9.0')?.highlights.fr.join(' ')).toMatch(/Former l’agent/);
    expect(entryFor('3.9.0')?.highlights.es.join(' ')).toMatch(/Formar al agente/);
    // R3.10a la 3.10.0 porte le Système 5 « Fiche et Frise », la journée fermée et les derniers réglages du rail.
    expect(entryFor('3.10.0')?.kind).toBe('fonctionnalite');
    expect(entryFor('3.10.0')?.date).toBe('2026-11-07');
    for (const lang of ['fr', 'en', 'es'] as const) expect(entryFor('3.10.0')?.highlights[lang]).toHaveLength(5);
    expect(entryFor('3.10.0')?.highlights.fr.join(' ')).toMatch(/journée fermée depuis hh:mm ET/);
    expect(entryFor('3.10.0')?.highlights.en.join(' ')).toMatch(/day closed since hh:mm ET/);
    expect(entryFor('3.10.0')?.highlights.es.join(' ')).toMatch(/jornada cerrada desde hh:mm ET/);
    expect(entryFor('3.10.0')?.highlights.en.join(' ')).toMatch(/opens its record in a third column/);
    expect(entryFor('3.10.0')?.highlights.en.join(' ')).toMatch(/a micrograph with a green lamp/);
    // R3.10.1a la 3.10.1 est un correctif : le polissage, l'audit du 9 novembre et ses points ouverts.
    expect(entryFor('3.10.1')?.kind).toBe('correctif');
    expect(entryFor('3.10.1')?.date).toBe('2026-11-09');
    for (const lang of ['fr', 'en', 'es'] as const) expect(entryFor('3.10.1')?.highlights[lang]).toHaveLength(5);
    expect(entryFor('3.10.1')?.highlights.fr.join(' ')).toMatch(/le desk au repos ne change pas/);
    expect(entryFor('3.10.1')?.highlights.en.join(' ')).toMatch(/the desk at rest does not change/);
    expect(entryFor('3.10.1')?.highlights.es.join(' ')).toMatch(/el desk en reposo no cambia/);
    expect(entryFor('3.10.1')?.highlights.fr.join(' ')).toMatch(/un état des comptes de moins de dix secondes/);
    expect(entryFor('3.10.1')?.highlights.en.join(' ')).toMatch(/an account state from the bridge less than ten seconds old/);
    expect(entryFor('3.10.1')?.highlights.es.join(' ')).toMatch(/un estado de las cuentas de menos de diez segundos/);
    expect(entryFor('3.10.1')?.highlights.en.join(' ')).toMatch(/bounded to 2,000 bars/);
    expect(entryFor('3.10.1')?.highlights.en.join(' ')).toMatch(/January to March 2027, published by the BLS/);
    expect(entryFor('3.10.1')?.highlights.en.join(' ')).toMatch(/shows its real host before it opens/);
    // Le journal ne promet pas ce que le code ne fait pas : l'AddOn n'est pas borné par cette version, ni les installeurs signés par un éditeur.
    for (const lang of ['fr', 'en', 'es'] as const) expect(entryFor('3.10.1')?.highlights[lang].join(' ')).not.toMatch(/AddOn 2\.[3-9]|Authenticode|notari[sz]/i);
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
