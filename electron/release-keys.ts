/**
 * Clés publiques Ed25519 du Lab qui signent les Releases (`SHA256SUMS.txt.sig`).
 * Format : `x` d'une JWK OKP/Ed25519 (base64url, 32 octets). Plusieurs clés : rotation.
 * La clé privée ne vit jamais dans ce dépôt ni sur GitHub. Liste éditée par
 * `node scripts/release-key.mjs --write`. Vide : la signature n'est pas exigée (journalisé).
 */
export const RELEASE_PUBLIC_KEYS: readonly string[] = [
  // clés
  '_uCBJVIJ8hYLufN7jV5i78SHEnwI0pNR6rQndhGWXgw',
];
