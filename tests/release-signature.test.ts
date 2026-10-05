import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RELEASE_PUBLIC_KEYS } from '../electron/release-keys';
import { releaseMessage, trustedChecksum, verifyReleaseSignature } from '../electron/release-signature';

function labKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const x = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
  return { x, sign: (version: string, sums: string) => sign(null, releaseMessage(version, sums), privateKey).toString('base64') };
}

const SUMS = `${'a'.repeat(64)}  ./CANTO-3.4.0-win-x64-setup.exe\n${'b'.repeat(64)}  ./CANTO-3.4.0-mac-universal.dmg\n`;
const INSTALLER = 'CANTO-3.4.0-win-x64-setup.exe';

describe('signature des Releases', () => {
  it('une signature du Lab sur ces empreintes et cette version est acceptée', () => {
    const lab = labKey();
    const signature = lab.sign('3.4.0', SUMS);
    expect(verifyReleaseSignature({ version: '3.4.0', sums: SUMS, signature, keys: [lab.x] })).toBe(true);
    expect(trustedChecksum({ version: '3.4.0', installer: INSTALLER, sums: SUMS, signature, keys: [lab.x] })).toEqual({ ok: true, sha256: 'a'.repeat(64), signed: true });
  });

  it('empreinte modifiée, autre version (rejeu sous un nouveau tag), autre clé : refus', () => {
    const lab = labKey();
    const other = labKey();
    const signature = lab.sign('3.4.0', SUMS);
    const tampered = SUMS.replace('a'.repeat(64), 'c'.repeat(64));
    expect(verifyReleaseSignature({ version: '3.4.0', sums: tampered, signature, keys: [lab.x] })).toBe(false);
    expect(verifyReleaseSignature({ version: '9.9.9', sums: SUMS, signature, keys: [lab.x] })).toBe(false);
    expect(verifyReleaseSignature({ version: '3.4.0', sums: SUMS, signature: other.sign('3.4.0', SUMS), keys: [lab.x] })).toBe(false);
    expect(trustedChecksum({ version: '3.4.0', installer: INSTALLER, sums: tampered, signature, keys: [lab.x] })).toEqual({ ok: false, error: 'bad_signature' });
  });

  it('avec une clé embarquée, une Release sans signature est refusée', () => {
    const lab = labKey();
    expect(trustedChecksum({ version: '3.4.0', installer: INSTALLER, sums: SUMS, signature: null, keys: [lab.x] })).toEqual({ ok: false, error: 'no_signature' });
  });

  it('signature illisible, clé mal formée, rotation de clés', () => {
    const lab = labKey();
    const next = labKey();
    for (const bad of ['', 'pas-du-base64!', 'AAAA', 'x'.repeat(2000)]) {
      expect(verifyReleaseSignature({ version: '3.4.0', sums: SUMS, signature: bad, keys: [lab.x] }), bad.slice(0, 10)).toBe(false);
    }
    const signature = next.sign('3.4.0', SUMS);
    expect(verifyReleaseSignature({ version: '3.4.0', sums: SUMS, signature, keys: ['clé-cassée', lab.x, next.x] })).toBe(true);
  });

  it('sans clé embarquée : l’ancien contrôle par empreinte, signalé non signé', () => {
    expect(trustedChecksum({ version: '3.4.0', installer: INSTALLER, sums: SUMS, signature: null, keys: [] })).toEqual({ ok: true, sha256: 'a'.repeat(64), signed: false });
    expect(trustedChecksum({ version: '3.4.0', installer: 'absent.exe', sums: SUMS, signature: null, keys: [] })).toEqual({ ok: false, error: 'no_checksums' });
  });

  it('la mise à jour native passe par la signature avant de télécharger l’installeur', () => {
    const src = readFileSync('electron/native-update.ts', 'utf8');
    const trust = src.indexOf('trustedChecksum(');
    expect(trust).toBeGreaterThan(0);
    expect(trust).toBeLessThan(src.indexOf('await download(pick.asset.url'));
    expect(src).toContain('keys: RELEASE_PUBLIC_KEYS');
    expect(RELEASE_PUBLIC_KEYS.every((x) => /^[A-Za-z0-9_-]{43}$/.test(x))).toBe(true);
  });
});
