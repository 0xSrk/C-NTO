import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifySeatLine } from '../electron/seat';

const node = (args: string[]) => spawnSync(process.execPath, ['scripts/issue-seat.mjs', ...args], { encoding: 'utf8' });
/** Liste vide, au format de electron/seat-keys.ts : les tests ne dépendent d'aucune clé inscrite. */
const EMPTY_KEYS = "export const SEAT_PUBLIC_KEYS: readonly string[] = [\n  // clés\n];\n";

/** Paire éphémère hors dépôt, inscrite dans une copie temporaire de la liste. */
function lab() {
  const dir = mkdtempSync(path.join(tmpdir(), 'canto-seat-key-'));
  const keys = path.join(dir, 'seat-keys.ts');
  writeFileSync(keys, EMPTY_KEYS);
  const key = path.join(dir, 'seat.pem');
  const made = node(['--new-key', '--out', key, '--keys-file', keys, '--write']);
  expect(made.status, made.stderr).toBe(0);
  const x = /'([A-Za-z0-9_-]{43})'/.exec(readFileSync(keys, 'utf8'))?.[1] ?? '';
  return { dir, keys, key, x };
}

describe('émission des sièges (ADMIN)', () => {
  it('--new-key : clé privée hors dépôt, 0600, jamais écrasée ; clé publique inscrite', () => {
    const { key, keys, x } = lab();
    expect(x).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (process.platform !== 'win32') expect(statSync(key).mode & 0o777).toBe(0o600);
    expect(node(['--new-key', '--out', key, '--keys-file', keys]).status).not.toBe(0);
    const inside = path.resolve('siege-dans-le-depot.pem');
    expect(node(['--new-key', '--out', inside]).status).not.toBe(0);
    expect(existsSync(inside)).toBe(false);
  });

  it('la ligne imprimée est acceptée par le desk, avec le nom demandé ; rien d’autre sur la sortie', () => {
    const { key, keys, x } = lab();
    const run = node(['--key', key, '--keys-file', keys, '--client', '0xSrk', '--date', '2026-10-05']);
    expect(run.status, run.stderr).toBe(0);
    const lines = run.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^SIEGE1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifySeatLine(lines[0], [x])).toEqual({ ok: true, client: '0xSrk', date: '2026-10-05' });
    const today = node(['--key', key, '--keys-file', keys, '--client', 'Λ-Testeur']);
    expect(verifySeatLine(today.stdout, [x])).toEqual({ ok: true, client: 'Λ-Testeur', date: new Date().toISOString().slice(0, 10) });
  });

  it('refus : clé non inscrite, clé lue dans le dépôt, nom ou date invalides, arguments manquants', () => {
    const { key, keys } = lab();
    const other = lab();
    const refused = [
      ['--key', other.key, '--keys-file', keys, '--client', '0xSrk'],
      ['--key', path.resolve('scripts', 'cle.pem'), '--keys-file', keys, '--client', '0xSrk'],
      ['--key', key, '--keys-file', keys, '--client', ''],
      ['--key', key, '--keys-file', keys, '--client', 'a'.repeat(25)],
      ['--key', key, '--keys-file', keys, '--client', ' 0xSrk'],
      ['--key', key, '--keys-file', keys, '--client', '‮krSx0'],
      ['--key', key, '--keys-file', keys, '--client', '0xSrk', '--date', '2026-02-30'],
      ['--keys-file', keys, '--client', '0xSrk'],
      ['--key', key, '--keys-file', keys],
    ];
    for (const args of refused) {
      const run = node(args);
      expect(run.status, args.join(' ')).not.toBe(0);
      expect(run.stdout).not.toContain('SIEGE1.');
    }
  });

  it('aucun fichier suivi ne contient de clé privée PEM', () => {
    // Un bloc : le repère, un corps base64, la fin. La carte du siège cite le repère seul.
    const pem = new RegExp('-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}\\s+[A-Za-z0-9+/=\\s]{40,}-{5}END [A-Z ]*PRIVATE KEY-{5}');
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    const hits = files.filter((file) => {
      try {
        return pem.test(readFileSync(file, 'utf8'));
      } catch {
        return false;
      }
    });
    expect(hits).toEqual([]);
  });
});
