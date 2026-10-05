/**
 * Clés publiques Ed25519 du Lab qui signent les sièges nominatifs (`SIEGE1.<payload>.<signature>`).
 * Format : `x` d'une JWK OKP/Ed25519 (base64url, 32 octets). Plusieurs clés : rotation.
 * Ce ne sont pas les clés de publication (`release-keys.ts`) : aucune ne vérifie l'autre preuve.
 * La clé privée ne vit jamais dans ce dépôt ni sur GitHub. Liste éditée par
 * `node scripts/issue-seat.mjs --new-key --write`. Vide : aucun siège n'est accepté.
 */
export const SEAT_PUBLIC_KEYS: readonly string[] = [
  // clés
];
