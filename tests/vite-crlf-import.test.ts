import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * OROS5.47r — sous Windows, la copie de travail porte des fins de ligne CRLF. Vite 7.3.6 avertit d'un `import()` dont
 * l'argument n'est pas une chaîne (« The above dynamic import cannot be analyzed by Vite »), et l'extrait de code de cet
 * avertissement (`generateCodeFrame`) ne finit jamais sur un fichier CRLF quand l'import est près de la fin : il compte
 * une fin de ligne pour un caractère. `tests/capture-oros5.test.ts`, qui importe `scripts/capture-oros5.mjs`, ne se
 * chargeait donc jamais, et `npm test` restait bloqué jusqu'à l'annulation du job (six heures). Un tel import porte
 * `/* @vite-ignore *\/`, que Vite lit avant de bâtir l'extrait.
 */

/** Les `import(` dont l'argument n'est pas une chaîne littérale sans `${` : Vite ne sait pas les analyser. */
function opaqueImports(source: string): string[] {
  return [...source.matchAll(/\bimport\(\s*([^\n]*)/g)]
    .map((m) => m[1]!)
    .filter((arg) => !/^(['"])[^'"]*\1\s*\)/.test(arg) && !/^`[^`$]*`\s*\)/.test(arg));
}

describe('OROS5.47r · un import dynamique opaque de scripts/ ne fait jamais tourner Vite sans fin', () => {
  it('chaque import() opaque de scripts/*.mjs porte /* @vite-ignore */', () => {
    const missing: string[] = [];
    for (const name of readdirSync('scripts').filter((f) => f.endsWith('.mjs'))) {
      const source = readFileSync(path.join('scripts', name), 'utf8').replace(/\r\n/g, '\n');
      for (const arg of opaqueImports(source)) if (!arg.startsWith('/* @vite-ignore */')) missing.push(`${name} : import(${arg.slice(0, 60)}`);
    }
    expect(missing).toEqual([]);
  });

  it('Vite charge scripts/capture-oros5.mjs en fins de ligne CRLF, comme sous Windows', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-vite-crlf-'));
    try {
      const crlf = readFileSync('scripts/capture-oros5.mjs', 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      writeFileSync(path.join(dir, 'capture.mjs'), crlf);
      const code = [
        "const { createServer } = await import('vite');",
        `const server = await createServer({ root: ${JSON.stringify(dir)}, configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true } });`,
        "const mod = await server.ssrLoadModule('/capture.mjs');",
        "console.log('exports', Object.keys(mod).length);",
        'await server.close();',
      ].join('\n');
      const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 });
      expect(run.signal, 'Vite ne finit pas de charger le script').toBeNull();
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toMatch(/exports \d+/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45_000);
});
