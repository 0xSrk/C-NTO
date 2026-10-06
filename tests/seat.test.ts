import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RELEASE_PUBLIC_KEYS } from '../electron/release-keys';
import { releaseMessage, verifyReleaseSignature } from '../electron/release-signature';
import { SEAT_PUBLIC_KEYS } from '../electron/seat-keys';
import { seatSigningInput, verifySeatLine } from '../electron/seat';

/** Paire éphémère : aucune clé de production dans les tests. */
function pair(): { priv: KeyObject; x: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { priv: privateKey, x: publicKey.export({ format: 'jwk' }).x as string };
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Ligne signée à partir d'un JSON brut (canonique ou non, pour les refus). */
function lineFrom(json: string, priv: KeyObject): string {
  const payload = b64(json);
  return `SIEGE1.${payload}.${sign(null, seatSigningInput(payload), priv).toString('base64url')}`;
}

const seatJson = (client: string, date = '2026-10-05', artefact = '002') => JSON.stringify({ artefact, client, date });

describe('siège nominatif : vérification', () => {
  const lab = pair();
  const keys = [lab.x];

  it('une ligne signée rend son client, jamais le texte saisi ; espaces en bord tolérés', () => {
    const line = lineFrom(seatJson('0xSrk'), lab.priv);
    expect(verifySeatLine(line, keys)).toEqual({ ok: true, client: '0xSrk', date: '2026-10-05' });
    expect(verifySeatLine(`  ${line}\n`, keys)).toMatchObject({ ok: true, client: '0xSrk' });
  });

  it('une date passée reste valide ; 24 caractères Unicode, emoji compris', () => {
    expect(verifySeatLine(lineFrom(seatJson('Ξ Lab', '2020-01-01'), lab.priv), keys)).toMatchObject({ ok: true, client: 'Ξ Lab' });
    const long = `${'Λ'.repeat(23)}🜂`;
    expect(verifySeatLine(lineFrom(seatJson(long), lab.priv), keys)).toMatchObject({ ok: true, client: long });
  });

  it('forme : préfixe, séparateurs, base64url, longueur, signature tronquée', () => {
    const good = lineFrom(seatJson('0xSrk'), lab.priv);
    const [, payload, signature] = good.split('.');
    for (const bad of [
      '',
      'hello',
      good.replace('SIEGE1', 'CANTO1'),
      good.replace('SIEGE1.', 'SIEGE1..'),
      `SIEGE1.${payload}.${signature} x`,
      `SIEGE1.${payload}=.${signature}`,
      `SIEGE1.${payload}.${signature!.slice(0, 40)}`,
      `SIEGE1.${'A'.repeat(1100)}.${signature}`,
    ]) {
      expect(verifySeatLine(bad, keys), bad.slice(0, 30)).toEqual({ ok: false, reason: 'forme' });
    }
    expect(verifySeatLine(42, keys)).toEqual({ ok: false, reason: 'forme' });
  });

  it('liste de clés vide : aucun siège', () => {
    expect(verifySeatLine(lineFrom(seatJson('0xSrk'), lab.priv), [])).toEqual({ ok: false, reason: 'clé absente' });
  });

  it('clés inscrites : x de JWK Ed25519 bien formés, sans doublon (la liste peut être vide)', () => {
    for (const x of SEAT_PUBLIC_KEYS) {
      expect(x).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(x, 'base64url')).toHaveLength(32);
    }
    expect(new Set(SEAT_PUBLIC_KEYS).size).toBe(SEAT_PUBLIC_KEYS.length);
  });

  it('signature : autre clé, contenu altéré', () => {
    const other = pair();
    expect(verifySeatLine(lineFrom(seatJson('0xSrk'), other.priv), keys)).toEqual({ ok: false, reason: 'signature' });
    const good = lineFrom(seatJson('0xSrk'), lab.priv);
    const [, , signature] = good.split('.');
    const forged = `SIEGE1.${b64(seatJson('Intrus'))}.${signature}`;
    expect(verifySeatLine(forged, keys)).toEqual({ ok: false, reason: 'signature' });
    expect(verifySeatLine(good, [other.x, lab.x])).toMatchObject({ ok: true });
  });

  it('contenu : clé JSON en trop ou manquante, JSON non canonique, artefact, client, date', () => {
    const cases: [string, string][] = [
      ['{"artefact":"002","client":"0xSrk","date":"2026-10-05","role":"admin"}', 'forme'],
      ['{"artefact":"002","client":"0xSrk"}', 'forme'],
      ['{"client":"0xSrk","artefact":"002","date":"2026-10-05"}', 'forme'],
      ['{"artefact": "002","client":"0xSrk","date":"2026-10-05"}', 'forme'],
      ['["002","0xSrk","2026-10-05"]', 'forme'],
      ['{"artefact":2,"client":"0xSrk","date":"2026-10-05"}', 'forme'],
      [seatJson('0xSrk', '2026-10-05', '003'), 'artefact'],
      [seatJson(''), 'client'],
      [seatJson(' 0xSrk'), 'client'],
      [seatJson('a'.repeat(25)), 'client'],
      [seatJson('ab\u0007'), 'client'],
      [seatJson('ab\ncd'), 'client'],
      [seatJson('‮krSx0'), 'client'],
      [seatJson('0xSrk', '2026-02-30'), 'date'],
      [seatJson('0xSrk', '2026-2-3'), 'date'],
      [seatJson('0xSrk', 'demain'), 'date'],
    ];
    for (const [json, reason] of cases) expect(verifySeatLine(lineFrom(json, lab.priv), keys), json).toEqual({ ok: false, reason });
  });

  it('les deux preuves ne se mélangent pas', () => {
    expect(SEAT_PUBLIC_KEYS.filter((x) => RELEASE_PUBLIC_KEYS.includes(x))).toEqual([]);
    const line = lineFrom(seatJson('0xSrk'), lab.priv);
    const [, payload, signature] = line.split('.');
    // Une signature de siège ne vaut pas signature de Release, même avec la même clé.
    const asRelease = Buffer.from(signature!, 'base64url').toString('base64');
    expect(verifyReleaseSignature({ version: '3.4.0', sums: payload!, signature: asRelease, keys })).toBe(false);
    // Une signature de Release, recollée dans une ligne, ne vaut pas siège.
    const releaseSig = sign(null, releaseMessage('3.4.0', `SIEGE1.${payload}`), lab.priv).toString('base64url');
    expect(verifySeatLine(`SIEGE1.${payload}.${releaseSig}`, keys)).toEqual({ ok: false, reason: 'signature' });
  });
});
