import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RUNTIME_PACKAGES, runtimeAdvisories } from '../scripts/audit-runtime.mjs';

/**
 * SEC1.8 — la CI contrôle les avis de sécurité du runtime livré. Son étape `npm audit --omit=dev` ne voit pas
 * Electron, qu'electron-builder exige parmi les `devDependencies` alors que c'est lui, Chromium et Node, qui part dans
 * chaque installeur : le 2026-11-09, elle rendait « 0 vulnérabilité » pour Electron 43.7.1, qui portait quatre avis
 * (SEC1.7). `scripts/audit-runtime.mjs` relit l'audit complet et échoue sur un avis haut ou critique d'Electron.
 */

/** Le rapport du 2026-11-09, réduit à sa forme : Electron (haut), Vite (haut, hors runtime), minimatch (modéré). */
const REPORT = {
  auditReportVersion: 2,
  vulnerabilities: {
    electron: {
      name: 'electron',
      severity: 'high',
      isDirect: true,
      via: [
        { source: 1, name: 'electron', title: 'Electron: Frame subscription trusts GPU-supplied frame geometry', url: 'https://github.com/advisories/GHSA-3qxv-5xgr-q7w9', severity: 'high', range: '>=43.0.0-alpha.1 <43.7.3' },
        { source: 2, name: 'electron', title: 'Electron: Mitigation for compromised eMudhra intermediate certificates', url: 'https://github.com/advisories/GHSA-jr5w-w6x2-84p9', severity: 'moderate', range: '>=43.0.0-alpha.1 <43.8.1' },
      ],
      range: '43.0.0-alpha.1 - 43.8.0',
      fixAvailable: true,
    },
    vite: { name: 'vite', severity: 'high', isDirect: true, via: [{ title: 'Vite: Cross origin script execution through Vite custom middleware', url: 'https://github.com/advisories/GHSA-9jrq-w75r-8gcw', range: '>=7.0.0 <=7.3.6' }], range: '7.0.0 - 7.3.6', fixAvailable: true },
    minimatch: { name: 'minimatch', severity: 'moderate', isDirect: false, via: [{ title: 'minimatch has potential denial of service', url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249', range: '>=7.0.0 <11.0.1' }], range: '7.0.0 - 11.0.0', fixAvailable: false },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 2, critical: 0, total: 3 } },
};

describe('SEC1.8 la CI voit les avis du runtime livré', () => {
  it('le runtime contrôlé est Electron', () => {
    expect(RUNTIME_PACKAGES).toEqual(['electron']);
  });

  it('un avis haut ou critique d’Electron bloque, avec la plage touchée et le lien de chaque avis', () => {
    const found = runtimeAdvisories(REPORT);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'electron', severity: 'high', range: '43.0.0-alpha.1 - 43.8.0' });
    expect(found[0]!.advisories).toEqual([
      'Electron: Frame subscription trusts GPU-supplied frame geometry · https://github.com/advisories/GHSA-3qxv-5xgr-q7w9 · >=43.0.0-alpha.1 <43.7.3',
      'Electron: Mitigation for compromised eMudhra intermediate certificates · https://github.com/advisories/GHSA-jr5w-w6x2-84p9 · >=43.0.0-alpha.1 <43.8.1',
    ]);
    const critical = { vulnerabilities: { electron: { ...REPORT.vulnerabilities.electron, severity: 'critical' } } };
    expect(runtimeAdvisories(critical)).toHaveLength(1);
  });

  it('un avis modéré d’Electron, ou un avis haut d’un outil de build, ne bloque pas ici', () => {
    const moderate = { vulnerabilities: { ...REPORT.vulnerabilities, electron: { ...REPORT.vulnerabilities.electron, severity: 'moderate' } } };
    expect(runtimeAdvisories(moderate)).toEqual([]);
    const { electron: _electron, ...others } = REPORT.vulnerabilities;
    expect(runtimeAdvisories({ vulnerabilities: others })).toEqual([]);
    expect(runtimeAdvisories({ vulnerabilities: {} })).toEqual([]);
  });

  it('un rapport illisible ne passe jamais pour « aucun avis »', () => {
    for (const bad of [null, undefined, 'texte', 42, [], {}, { error: { code: 'ENOAUDIT', summary: 'audit endpoint returned an error' } }, { vulnerabilities: null }, { vulnerabilities: [] }]) {
      expect(() => runtimeAdvisories(bad), JSON.stringify(bad)).toThrow('rapport npm audit illisible');
    }
  });

  it('le job check de la CI lance ce contrôle, après npm ci', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n');
    const check = ci.slice(ci.indexOf('\n  check:'), ci.indexOf('\n  dist:'));
    const install = check.indexOf('- run: npm ci');
    const gate = check.indexOf('run: node scripts/audit-runtime.mjs');
    expect(install).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(install);
    // L'étape des dépendances embarquées reste : les deux se complètent.
    expect(check).toMatch(/npm audit --omit=dev --audit-level=high/);
  });
});
