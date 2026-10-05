import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEAT_FILE, SeatHost, seatSigningInput } from '../electron/seat';

function pair(): { priv: KeyObject; x: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { priv: privateKey, x: publicKey.export({ format: 'jwk' }).x as string };
}

function seatLine(client: string, priv: KeyObject): string {
  const payload = Buffer.from(JSON.stringify({ artefact: '002', client, date: '2026-10-05' })).toString('base64url');
  return `SIEGE1.${payload}.${sign(null, seatSigningInput(payload), priv).toString('base64url')}`;
}

function host(dir: string, keys: readonly string[]) {
  const logs: string[] = [];
  return { seat: new SeatHost({ userDataDir: dir, keys, log: (level, message) => logs.push(`${level} ${message}`) }), logs };
}

describe('siège nominatif : persistance dans le process principal', () => {
  const lab = pair();

  it('un code accepté est gardé tel quel (0600), relu et revérifié au lancement suivant', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-seat-'));
    const line = seatLine('0xSrk', lab.priv);
    const first = host(dir, [lab.x]);
    expect(first.seat.status()).toBeNull();
    expect(first.seat.submit(`${line}\n`)).toEqual({ ok: true, client: '0xSrk' });
    const file = path.join(dir, SEAT_FILE);
    expect(readFileSync(file, 'utf8')).toBe(line);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(first.seat.status()).toEqual({ client: '0xSrk' });

    const next = host(dir, [lab.x]);
    expect(next.seat.status()).toEqual({ client: '0xSrk' });
  });

  it('un code refusé ne touche ni au nom ni au fichier ; un second code valide remplace le nom', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-seat-'));
    const { seat } = host(dir, [lab.x]);
    seat.submit(seatLine('0xSrk', lab.priv));
    const before = readFileSync(path.join(dir, SEAT_FILE), 'utf8');
    expect(seat.submit(seatLine('Intrus', pair().priv))).toEqual({ ok: false });
    expect(seat.submit('Je veux le nom Admin')).toEqual({ ok: false });
    expect(seat.status()).toEqual({ client: '0xSrk' });
    expect(readFileSync(path.join(dir, SEAT_FILE), 'utf8')).toBe(before);
    expect(seat.submit(seatLine('Λ-Testeur', lab.priv))).toEqual({ ok: true, client: 'Λ-Testeur' });
    expect(host(dir, [lab.x]).seat.status()).toEqual({ client: 'Λ-Testeur' });
  });

  it('signature morte au lancement (clé retirée, ligne altérée) : pas de nom, fichier supprimé', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-seat-'));
    host(dir, [lab.x]).seat.submit(seatLine('0xSrk', lab.priv));
    const rotated = host(dir, [pair().x]);
    expect(rotated.seat.status()).toBeNull();
    expect(existsSync(path.join(dir, SEAT_FILE))).toBe(false);
    expect(rotated.logs).toEqual(['warn siège retiré au lancement (signature)']);

    writeFileSync(path.join(dir, SEAT_FILE), 'SIEGE1.bidon.bidon');
    expect(host(dir, [lab.x]).seat.status()).toBeNull();
    expect(existsSync(path.join(dir, SEAT_FILE))).toBe(false);
  });

  it('liste de clés vide : tout code est refusé, sans erreur', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-seat-'));
    const { seat, logs } = host(dir, []);
    expect(seat.submit(seatLine('0xSrk', lab.priv))).toEqual({ ok: false });
    expect(seat.status()).toBeNull();
    expect(logs).toEqual(['warn siège refusé (clé absente)']);
  });

  it('le journal ne porte ni la ligne, ni la signature, ni le nom', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'canto-seat-'));
    const { seat, logs } = host(dir, [lab.x]);
    const line = seatLine('0xSrk', lab.priv);
    seat.submit(line);
    seat.submit(seatLine('Intrus', pair().priv));
    expect(logs).toEqual(['info siège accepté', 'warn siège refusé (signature)']);
    const text = logs.join('\n');
    for (const secret of [line, line.split('.')[1]!, line.split('.')[2]!, '0xSrk', 'Intrus']) expect(text).not.toContain(secret);
  });

  it('canaux : preload nommé, chaque handler derrière trusted(e)', () => {
    const preload = readFileSync('electron/preload.ts', 'utf8');
    expect(preload).toContain("invoke('seat:status')");
    expect(preload).toContain("invoke('seat:submit', line)");
    const main = readFileSync('electron/main.ts', 'utf8');
    expect(main).toContain("ipcMain.handle('seat:status', (e) => (trusted(e) ?");
    expect(main).toMatch(/ipcMain\.handle\('seat:submit', \(e, line: unknown\) => \(trusted\(e\) && typeof line === 'string'/);
  });
});
