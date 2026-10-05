import { createPublicKey, verify } from 'node:crypto';

/**
 * Siège nominatif (`docs/SIEGE-NOMINATIF.md`). Une ligne `SIEGE1.<payload>.<signature>` :
 * `payload` = base64url du JSON canonique `{"artefact":"002","client":"<nom>","date":"YYYY-MM-DD"}`,
 * `signature` = Ed25519 des octets ASCII de `SIEGE1.<payload>`. Le nom affiché est `client`, jamais
 * le texte saisi. Vérifié ici, dans le process principal ; le renderer ne voit aucune clé.
 */

export const SEAT_PREFIX = 'SIEGE1';
export const SEAT_ARTEFACT = '002';
export const SEAT_CLIENT_MAX = 24;
export const SEAT_LINE_MAX = 1024;

/** Motifs courts, pour le journal du process principal seulement. */
export type SeatRefusal = 'forme' | 'clé absente' | 'signature' | 'artefact' | 'client' | 'date';

export type SeatVerdict = { ok: true; client: string; date: string } | { ok: false; reason: SeatRefusal };

const B64URL = /^[A-Za-z0-9_-]+$/;
const LINE = /^SIEGE1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
/** Contrôles, formats (dont les inversions bidirectionnelles), surrogats isolés, séparateurs de ligne. */
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/** Octets signés : le préfixe est signé avec le contenu. */
export function seatSigningInput(payload: string): Buffer {
  return Buffer.from(`${SEAT_PREFIX}.${payload}`, 'ascii');
}

/** JSON canonique du siège : trois clés, dans cet ordre, sans espace. */
export function canonicalSeatJson(seat: { artefact: string; client: string; date: string }): string {
  return JSON.stringify({ artefact: seat.artefact, client: seat.client, date: seat.date });
}

/** 1 à 24 caractères Unicode, sans espace en bord, sans contrôle ni caractère de format. */
export function seatClientValid(client: string): boolean {
  const length = [...client].length;
  return length >= 1 && length <= SEAT_CLIENT_MAX && client === client.trim() && !FORBIDDEN.test(client);
}

/** `YYYY-MM-DD`, date réelle du calendrier. Pas une expiration. */
export function seatDateValid(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** base64url sans `=`, sous sa seule forme canonique. */
function decode(text: string): Buffer | null {
  if (!B64URL.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}

function signedByOne(message: Buffer, signature: Buffer, keys: readonly string[]): boolean {
  for (const x of keys) {
    try {
      if (verify(null, message, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }), signature)) return true;
    } catch {
      /* clé mal formée : on essaie la suivante */
    }
  }
  return false;
}

/** Vérifie une ligne collée (espaces en bord tolérés) contre les clés de siège. */
export function verifySeatLine(raw: unknown, keys: readonly string[]): SeatVerdict {
  if (typeof raw !== 'string') return { ok: false, reason: 'forme' };
  const line = raw.trim();
  const m = line.length <= SEAT_LINE_MAX ? LINE.exec(line) : null;
  if (!m) return { ok: false, reason: 'forme' };
  const payloadText = m[1]!;
  const payload = decode(payloadText);
  const signature = decode(m[2]!);
  if (!payload || !signature || signature.length !== 64) return { ok: false, reason: 'forme' };
  if (!keys.length) return { ok: false, reason: 'clé absente' };
  if (!signedByOne(seatSigningInput(payloadText), signature, keys)) return { ok: false, reason: 'signature' };

  let json: string;
  let seat: unknown;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(payload);
    seat = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'forme' };
  }
  if (!seat || typeof seat !== 'object' || Array.isArray(seat)) return { ok: false, reason: 'forme' };
  const rec = seat as Record<string, unknown>;
  const fields = Object.keys(rec).sort().join(',');
  if (fields !== 'artefact,client,date') return { ok: false, reason: 'forme' };
  const { artefact, client, date } = rec;
  if (typeof artefact !== 'string' || typeof client !== 'string' || typeof date !== 'string') return { ok: false, reason: 'forme' };
  if (canonicalSeatJson({ artefact, client, date }) !== json) return { ok: false, reason: 'forme' };
  if (artefact !== SEAT_ARTEFACT) return { ok: false, reason: 'artefact' };
  if (!seatClientValid(client)) return { ok: false, reason: 'client' };
  if (!seatDateValid(date)) return { ok: false, reason: 'date' };
  return { ok: true, client, date };
}
