import { createPublicKey, verify } from 'node:crypto';
import { parseChecksums } from './release-check';

/**
 * Signature des Releases. Le Lab signe, avec sa clé privée Ed25519 tenue hors de GitHub, le message
 * `canto-release\n<version>\n<contenu exact de SHA256SUMS.txt>`. La version liée au message empêche de
 * rejouer une ancienne signature sous un nouveau tag (retour vers un installeur plus ancien).
 */
export const SIGNATURE_ASSET = 'SHA256SUMS.txt.sig';
/** Une signature Ed25519 en base64 tient en 88 caractères : au-delà, le fichier n'est pas lu. */
export const SIGNATURE_MAX_BYTES = 1024;

export function releaseMessage(version: string, sums: string): Buffer {
  return Buffer.from(`canto-release\n${version}\n${sums}`, 'utf8');
}

function publicKey(x: string) {
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
}

/** Vrai si une des clés embarquées a signé ce `SHA256SUMS.txt` pour cette version. */
export function verifyReleaseSignature(input: { version: string; sums: string; signature: string; keys: readonly string[] }): boolean {
  const text = input.signature.trim();
  if (!text || text.length > SIGNATURE_MAX_BYTES || !/^[A-Za-z0-9+/=_-]+$/.test(text)) return false;
  const sig = Buffer.from(text, 'base64');
  if (sig.length !== 64) return false;
  const message = releaseMessage(input.version, input.sums);
  for (const x of input.keys) {
    try {
      if (verify(null, message, publicKey(x), sig)) return true;
    } catch {
      /* clé mal formée : on essaie la suivante */
    }
  }
  return false;
}

export type IntegrityError = 'no_checksums' | 'no_signature' | 'bad_signature';

/**
 * Empreinte attendue de l'installeur, après la signature du Lab quand des clés sont embarquées.
 * Sans clé embarquée (avant la première clé du Lab), l'ancien contrôle par empreinte seule s'applique.
 */
export function trustedChecksum(input: {
  version: string;
  installer: string;
  sums: string;
  signature: string | null;
  keys: readonly string[];
}): { ok: true; sha256: string; signed: boolean } | { ok: false; error: IntegrityError } {
  if (input.keys.length) {
    if (input.signature === null) return { ok: false, error: 'no_signature' };
    if (!verifyReleaseSignature({ version: input.version, sums: input.sums, signature: input.signature, keys: input.keys })) return { ok: false, error: 'bad_signature' };
  }
  const sha256 = parseChecksums(input.sums).get(input.installer);
  if (!sha256) return { ok: false, error: 'no_checksums' };
  return { ok: true, sha256, signed: input.keys.length > 0 };
}

