import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'release-notes.mjs');

function run(args: string[], cwd = root) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}

describe('notes de Release', () => {
  it('écrit le journal complet et les notes français puis anglais', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'canto-notes-'));
    const notes = path.join(out, 'release-notes.md');
    const result = run(['--version', '3.1.0', '--out', out, '--notes', notes]);
    expect(result.status).toBe(0);
    const published = JSON.parse(readFileSync(path.join(out, 'changelog.json'), 'utf8')) as { schemaVersion: number; entries: { version: string }[] };
    const source = JSON.parse(readFileSync(path.join(root, 'src', 'engine', 'changelog', 'changelog.json'), 'utf8')) as { entries: unknown[] };
    expect(published.schemaVersion).toBe(1);
    expect(published.entries).toHaveLength(source.entries.length);
    expect(published.entries.at(-1)?.version).toBe('3.2.1');
    const text = readFileSync(notes, 'utf8');
    expect(text).toContain('### Français');
    expect(text).toContain('### English');
    expect(text.indexOf('### Français')).toBeLessThan(text.indexOf('### English'));
    expect(text).toContain('- Lanceur AUBE III.');
    expect(text).toContain('- AUBE III launcher.');
    expect(text).not.toContain('### Español');
  });

  it('échoue explicitement si l’entrée de la version manque', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'canto-notes-miss-'));
    const notes = path.join(out, 'release-notes.md');
    const result = run(['--check', '--version', '9.9.9', '--out', out, '--notes', notes]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('aucune entrée pour 9.9.9');
    expect(existsSync(path.join(out, 'changelog.json'))).toBe(false);
    expect(existsSync(notes)).toBe(false);
  });

  it('échoue si les trois langues ne sont pas là', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'canto-notes-lang-'));
    const changelog = path.join(out, 'source.json');
    writeFileSync(
      changelog,
      JSON.stringify({
        schemaVersion: 1,
        entries: [{ version: '1.2.3', date: '2026-09-27', kind: 'correctif', highlights: { fr: ['un point'], en: ['one point'] } }],
      }),
    );
    const result = run(['--check', '--version', '1.2.3', '--changelog', changelog]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("l'entrée 1.2.3 n'a pas les trois langues");
  });
});
