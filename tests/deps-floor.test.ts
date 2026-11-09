import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareSemver } from '../electron/semver';

/**
 * SEC1.7 — planchers de version des deux dépendances qui exécutent le desk chez le trader, alors que npm les range
 * parmi les outils de développement : Electron (Chromium et Node de chaque installeur ; electron-builder l'exige en
 * `devDependencies`) et Vite (le serveur qui sert le desk en voie source, `npm run launch`). `npm audit --omit=dev`, le
 * contrôle de la CI, ne voit ni l'un ni l'autre : le 2026-11-09 il rendait 0 avis, Electron 43.7.1 en portait quatre.
 *
 * Avis connus au 2026-11-09 (`npm audit`), et la première version qui les corrige :
 * - Electron : GHSA-3qxv-5xgr-q7w9 et GHSA-h3v5-h239-pg29 (43.7.3), GHSA-x562-297c-g43g (43.7.6),
 *   GHSA-jr5w-w6x2-84p9 (43.8.1, certificats intermédiaires eMudhra compromis) ;
 * - Vite ≤ 7.3.6 : GHSA-9jrq-w75r-8gcw (script d'une autre origine exécuté par le serveur de développement),
 *   GHSA-rq7h-c2jc-7f22 (fichiers servis hors de `server.fs.allow`), et les avis de `launch-editor`
 *   (GHSA-r825-w8mm-5pxw, GHSA-698v-4r3x-3vcv, GHSA-587h-7wmj-h5pm).
 * Un plancher ne descend pas : une montée le relève, avec l'avis qui la motive.
 */
const FLOORS = { electron: '43.8.1', vite: '7.3.7' } as const;

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { version?: string; dev?: boolean; devDependencies?: Record<string, string> }> };
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

/** Plus petite version qu'admet une plage `^x.y.z`, `~x.y.z` ou `x.y.z` ; les autres formes ne sont pas attendues ici. */
function rangeFloor(range: string): string {
  const m = /^[~^]?(\d+\.\d+\.\d+)$/.exec(range);
  if (!m) throw new Error(`plage inattendue : ${range}`);
  return m[1]!;
}

describe('SEC1.7 planchers de version du runtime du desk', () => {
  for (const [name, floor] of Object.entries(FLOORS)) {
    it(`${name} : la version verrouillée est au moins ${floor}`, () => {
      const locked = lock.packages[`node_modules/${name}`]?.version;
      expect(locked, `${name} absent de package-lock.json`).toBeTruthy();
      expect(compareSemver(locked!, floor), `${name} ${locked} < ${floor}`).toBeGreaterThanOrEqual(0);
    });

    it(`${name} : package.json n’admet aucune version sous ${floor}`, () => {
      const range = manifest.devDependencies[name];
      expect(range, `${name} absent de package.json`).toBeTruthy();
      expect(compareSemver(rangeFloor(range!), floor), `${name} ${range} admet moins que ${floor}`).toBeGreaterThanOrEqual(0);
      // La plage du verrou est celle du manifeste : `npm ci` refuserait un écart, la CI le verrait trop tard.
      expect(lock.packages['']?.devDependencies?.[name]).toBe(range);
    });
  }

  it('Electron reste rangé parmi les outils : la CI le contrôle à part, `--omit=dev` ne le voit pas', () => {
    expect(manifest.dependencies.electron).toBeUndefined();
    expect(lock.packages['node_modules/electron']?.dev).toBe(true);
  });

  it('Electron reste dans sa branche majeure : une montée majeure change Chromium et se décide', () => {
    expect(lock.packages['node_modules/electron']?.version).toMatch(/^43\./);
  });
});
