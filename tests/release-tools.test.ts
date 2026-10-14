import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyReleaseSignature } from '../electron/release-signature';

const node = (script: string, args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const SUMS = `${'a'.repeat(64)}  ./CANTO-3.4.0-win-x64-setup.exe\n`;
/** Liste de clés vide, au format de electron/release-keys.ts : les tests ne dépendent pas des clés réellement inscrites. */
const EMPTY_KEYS = "export const RELEASE_PUBLIC_KEYS: readonly string[] = [\n  // clés\n];\n";

function lab() {
  const dir = mkdtempSync(path.join(tmpdir(), 'canto-key-'));
  const keys = path.join(dir, 'release-keys.ts');
  writeFileSync(keys, EMPTY_KEYS);
  const key = path.join(dir, 'lab.pem');
  const made = node('scripts/release-key.mjs', ['--out', key, '--keys-file', keys, '--write']);
  expect(made.status, made.stderr).toBe(0);
  const x = /'([A-Za-z0-9_-]{43})'/.exec(readFileSync(keys, 'utf8'))?.[1] ?? '';
  return { dir, keys, key, x };
}

describe('outils de signature de l’ADMIN', () => {
  it('la clé privée est écrite hors du dépôt, en 0600, jamais écrasée ; la clé publique est inscrite', () => {
    const { key, keys, x } = lab();
    expect(readFileSync(key, 'utf8')).toContain('BEGIN PRIVATE KEY');
    if (process.platform !== 'win32') expect(statSync(key).mode & 0o777).toBe(0o600);
    expect(x).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(node('scripts/release-key.mjs', ['--out', key, '--keys-file', keys]).status).not.toBe(0);
    expect(node('scripts/release-key.mjs', ['--public', '--key', key, '--keys-file', keys, '--write']).stdout).toContain('déjà inscrite');
    expect(readFileSync(keys, 'utf8').split(x).length - 1).toBe(1);
    expect(node('scripts/release-key.mjs', ['--out', path.resolve('cle-dans-le-depot.pem')]).status).not.toBe(0);
    expect(existsSync('cle-dans-le-depot.pem')).toBe(false);
  });

  it('fichier des clés extrait en CRLF (Windows) : la clé est inscrite avec la même fin de ligne', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-crlf-'));
    const keys = path.join(dir, 'release-keys.ts');
    writeFileSync(keys, EMPTY_KEYS.replace(/\n/g, '\r\n'));
    const made = node('scripts/release-key.mjs', ['--out', path.join(dir, 'lab.pem'), '--keys-file', keys, '--write']);
    expect(made.status, made.stderr).toBe(0);
    const src = readFileSync(keys, 'utf8');
    expect(src).toMatch(/\/\/ clés\r\n  '[A-Za-z0-9_-]{43}',\r\n\];/);
    expect(src.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('fichier des clés sans repère : aucune clé privée n’est créée', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-nomark-'));
    const keys = path.join(dir, 'release-keys.ts');
    writeFileSync(keys, 'export const RELEASE_PUBLIC_KEYS: readonly string[] = [];\n');
    const pem = path.join(dir, 'lab.pem');
    expect(node('scripts/release-key.mjs', ['--out', pem, '--keys-file', keys, '--write']).status).not.toBe(0);
    expect(existsSync(pem)).toBe(false);
  });

  it('la signature hors ligne est celle que le desk accepte, pour cette version seulement', () => {
    const { dir, key, keys, x } = lab();
    const sums = path.join(dir, 'SHA256SUMS.txt');
    writeFileSync(sums, SUMS);
    const out = path.join(dir, 'SHA256SUMS.txt.sig');
    const signed = node('scripts/sign-release.mjs', ['--sums', sums, '--version', '3.4.0', '--key', key, '--keys-file', keys, '--out', out, '--yes']);
    expect(signed.status, signed.stderr).toBe(0);
    const signature = readFileSync(out, 'utf8');
    expect(verifyReleaseSignature({ version: '3.4.0', sums: SUMS, signature, keys: [x] })).toBe(true);
    expect(verifyReleaseSignature({ version: '3.4.1', sums: SUMS, signature, keys: [x] })).toBe(false);
  });

  it('refuse de signer avec une clé que les desks ne connaissent pas', () => {
    const a = lab();
    const b = lab();
    const sums = path.join(a.dir, 'SHA256SUMS.txt');
    writeFileSync(sums, SUMS);
    const r = node('scripts/sign-release.mjs', ['--sums', sums, '--version', '3.4.0', '--key', b.key, '--keys-file', a.keys, '--yes']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('les desks refuseraient');
  });

  it('le vrai fichier des clés garde son repère : --write peut y inscrire une clé (rotation)', () => {
    expect(readFileSync('electron/release-keys.ts', 'utf8')).toMatch(/^ *\/\/ clés\r?$/m);
  });

  it('la CI publie la Release en brouillon et affiche les empreintes à comparer', () => {
    const wf = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(wf).toMatch(/gh release create[\s\S]*--draft/);
    expect(wf).toContain('cat SHA256SUMS.txt');
    expect(wf).not.toMatch(/SIGNING|PRIVATE KEY|release-signing-key/i);
  });

  it('la Release dépose ses installeurs dans le brouillon, sans artefact Actions soumis au quota', () => {
    const wf = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(wf).not.toMatch(/upload-artifact|download-artifact/);
    // Le brouillon existe avant les builds : chacun y dépose ses installeurs.
    const create = wf.indexOf('gh release create "$TAG"');
    expect(create).toBeGreaterThan(-1);
    expect(create).toBeLessThan(wf.indexOf('\n  build:'));
    expect(wf).toMatch(/gh release upload "\$TAG" "\$\{files\[@\]\}"[^\n]*--clobber/);
    expect(wf).toContain('if [ "${#files[@]}" -eq 0 ]; then');
    expect(wf).toMatch(/gh release download "\$TAG"/);
    expect(wf).toMatch(/gh release upload "\$TAG" publish\/changelog\.json publish\/SHA256SUMS\.txt/);
    // Une relance reconstruit un brouillon laissé par un passage précédent ; une Release publiée l'arrête.
    expect(wf).toMatch(/if \[ "\$draft" = "false" \]; then\s+echo "::error::La release \$tag existe déjà/);
    expect(wf).toMatch(/if \[ "\$draft" = "true" \]; then[\s\S]*?gh release delete "\$TAG"/);
    expect(wf).not.toMatch(/gh release edit[^\n]*--draft=false/);
  });

  it('la CI n’envoie ses installeurs qu’à la demande, pour quelques jours', () => {
    const wf = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(wf).toMatch(/^on:[\s\S]*?^\s+workflow_dispatch:/m);
    const steps = wf.split(/\n(?=\s+- )/).filter((step) => step.includes('actions/upload-artifact'));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step).toContain("if: github.event_name == 'workflow_dispatch'");
      const days = Number(/retention-days:\s*(\d+)/.exec(step)?.[1]);
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(7);
    }
  });
});
