/**
 * Sauvegarde scellée par le trousseau du système (option « trousseau système » de la copie du coffre).
 *
 * Le process principal scelle le coffre à l'écriture (`files:write-in-folder`) et ouvre l'enveloppe à la lecture du
 * fichier choisi par le trader (`files:open-text`) : la restauration du renderer reçoit le coffre en clair, comme pour
 * une copie non chiffrée. Le scellé ne s'ouvre que sur le poste et le compte qui l'ont écrit : c'est le trousseau du
 * système (DPAPI, Trousseau, libsecret) qui tient la clé, pas une phrase de passe.
 *
 * Seul un coffre est rendu. Le même trousseau scelle la clé API du modèle et celle de l'agent cloud : un autre secret
 * glissé dans une enveloppe est refusé (`not_a_vault`) et son clair ne sort pas du process principal.
 */

export const SEALED_VAULT_FORMAT = 'canto-vault-v2-enc';

/** Ce que ce module lit du trousseau : `safeStorage` dans le desk, une doublure dans les tests. */
export interface VaultKeychain {
  available(): boolean;
  encrypt(text: string): Buffer;
  /** Lève si le scellé n'est pas de ce poste ou de ce compte. */
  decrypt(blob: Buffer): string;
}

export type SealedVaultOpening = { sealed: false } | { sealed: true; ok: true; json: string } | { sealed: true; ok: false; reason: 'keychain' | 'not_a_vault' };

/** Enveloppe d'un coffre scellé, ou `null` si le trousseau n'est pas disponible (la copie part alors en clair, et le desk le dit). */
export function sealVault(text: string, keychain: VaultKeychain): string | null {
  if (!keychain.available()) return null;
  try {
    return JSON.stringify({ format: SEALED_VAULT_FORMAT, payload: keychain.encrypt(text).toString('base64') });
  } catch {
    return null;
  }
}

/** Un coffre exporté par le desk : `canto-vault-v2`, ou les formes plus anciennes que la restauration accepte encore. */
function isVaultJson(text: string): boolean {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return false;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
  const rec = data as Record<string, unknown>;
  return rec.format === 'canto-vault-v2' || rec.schemaVersion === 2 || rec.artefact === 'CΛNTO';
}

/**
 * Ouvre le texte d'un fichier s'il est un coffre scellé. Tout autre texte (coffre en clair, CSV, JSON quelconque) n'est pas
 * un scellé : l'appelant le rend tel quel. Un scellé que ce poste n'ouvre pas, ou qui ne contient pas un coffre, reste
 * fermé : rien de son contenu n'est rendu.
 */
export function openSealedVault(text: string, keychain: VaultKeychain): SealedVaultOpening {
  // Lecture bon marché d'abord : un import de 50 Mo de CSV n'est pas analysé comme du JSON.
  if (!text.startsWith('{') || !text.slice(0, 64).includes(SEALED_VAULT_FORMAT)) return { sealed: false };
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return { sealed: false };
  }
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) return { sealed: false };
  const { format, payload } = envelope as { format?: unknown; payload?: unknown };
  if (format !== SEALED_VAULT_FORMAT || typeof payload !== 'string' || payload.length === 0) return { sealed: false };
  if (!keychain.available()) return { sealed: true, ok: false, reason: 'keychain' };
  let json: string;
  try {
    json = keychain.decrypt(Buffer.from(payload, 'base64'));
  } catch {
    return { sealed: true, ok: false, reason: 'keychain' };
  }
  return isVaultJson(json) ? { sealed: true, ok: true, json } : { sealed: true, ok: false, reason: 'not_a_vault' };
}
