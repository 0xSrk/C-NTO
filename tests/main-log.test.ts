import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatLogLine, initMainLog, LOG_MAX_BYTES, mainLog } from '../electron/main-log';

describe('journal du process principal', () => {
  it('une ligne horodatée par événement, sans retour à la ligne parasite', () => {
    const line = formatLogLine('error', 'échec\nstack', new Date('2026-09-25T20:00:00Z'));
    expect(line).toBe('2026-09-25T20:00:00.000Z ERROR échec ⏎ stack\n');
  });

  it('écrit dans <userData>/logs/main.log et archive un journal trop gros', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-log-'));
    const first = initMainLog(dir);
    expect(first).toBe(path.join(dir, 'logs', 'main.log'));
    mainLog('info', 'démarrage');
    expect(readFileSync(first, 'utf8')).toContain('INFO  démarrage');
    writeFileSync(first, 'x'.repeat(LOG_MAX_BYTES + 1));
    initMainLog(dir);
    expect(statSync(path.join(dir, 'logs', 'main.old.log')).size).toBe(LOG_MAX_BYTES + 1);
    mainLog('warn', 'après rotation');
    expect(readFileSync(first, 'utf8')).toMatch(/^.* WARN  après rotation\n$/);
  });
});
