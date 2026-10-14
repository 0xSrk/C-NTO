import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Sceau d'hôte des clés API (A11), tenu par le process principal dans `userData` : pour chaque blob que rend
 * `secrets:encrypt`, l'hôte de l'URL de base où la clé a été saisie. À l'usage, l'hôte scellé fait foi et le renderer ne
 * peut plus l'élargir. Le coffre ne change pas : `apiKeyEncrypted` et `apiKeyHost` restent ce qu'ils étaient, un desk plus
 * ancien les relit sans rien savoir de ce fichier, et un secret chiffré avant lui (sans lien) suit l'hôte du renderer
 * comme avant. Le fichier ne porte ni clé ni blob : l'empreinte SHA-256 des octets du blob, et l'hôte.
 */
export const LLM_KEY_SEALS_FILE = 'llm-key-hosts.json';

/**
 * Liens gardés. Les réglages ne portent qu'une clé : seule la dernière saisie compte, et une saisie touche par touche en
 * ajoute une par frappe ; 64 couvrent largement l'usage. Au-delà, les plus anciens partent et le registre le note
 * (`evicted`) : un blob inconnu est alors refusé au lieu de suivre le renderer, si bien qu'une rafale de chiffrements ne
 * délie pas la clé en usage. Un fichier illisible vaut des liens perdus, de même.
 */
export const LLM_KEY_SEALS_MAX = 64;

const DIGEST = /^[0-9a-f]{64}$/;
const HOST_MAX = 300;

interface SealState {
  evicted: boolean;
  keys: Map<string, string>;
  /** Lecture en échec (fichier verrouillé, droits) : ni gardé en mémoire, ni réécrit ; relu au prochain besoin. */
  unread?: true;
}

/** Empreinte des octets du blob : deux écritures base64 du même blob (blancs, remplissage) ont la même. */
function digestOf(blob: string): string {
  return createHash('sha256').update(Buffer.from(blob, 'base64')).digest('hex');
}

function readState(file: string): SealState {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    // Aucun lien encore : les secrets existants suivent le renderer, comme avant.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { evicted: false, keys: new Map() };
    // Fichier là mais illisible pour l'instant (EBUSY, EPERM d'un antivirus…) : refus, sans effacer les liens qu'il porte.
    return { evicted: true, keys: new Map(), unread: true };
  }
  try {
    const raw = JSON.parse(text) as { v?: unknown; evicted?: unknown; keys?: unknown };
    if (raw.v !== 1 || typeof raw.evicted !== 'boolean' || !Array.isArray(raw.keys)) throw new Error('forme');
    const keys = new Map<string, string>();
    for (const entry of raw.keys) {
      if (!Array.isArray(entry) || entry.length !== 2) throw new Error('forme');
      const [digest, host] = entry as unknown[];
      if (typeof digest !== 'string' || !DIGEST.test(digest) || typeof host !== 'string' || !host || host.length > HOST_MAX) throw new Error('forme');
      keys.set(digest, host);
    }
    return { evicted: raw.evicted || keys.size > LLM_KEY_SEALS_MAX, keys };
  } catch {
    return { evicted: true, keys: new Map() };
  }
}

export class LlmKeySeals {
  private state: SealState | null = null;

  constructor(private readonly dir: string) {}

  private get file(): string {
    return path.join(this.dir, LLM_KEY_SEALS_FILE);
  }

  private load(): SealState {
    if (this.state) return this.state;
    const state = readState(this.file);
    if (!state.unread) this.state = state;
    return state;
  }

  /**
   * Lie le blob à l'hôte où la clé a été saisie. Faux si le lien n'a pas pu être écrit : il vaut alors pour ce lancement,
   * sauf registre illisible, où rien n'est gardé (la clé suit le renderer comme avant, ou reste refusée tant qu'il l'est).
   */
  bind(blob: string, host: string): boolean {
    if (!blob || !host || host.length > HOST_MAX) return false;
    const state = this.load();
    if (state.unread) return false; // réécrire maintenant effacerait les liens du fichier qu'on n'a pas pu lire
    const digest = digestOf(blob);
    state.keys.delete(digest);
    state.keys.set(digest, host);
    while (state.keys.size > LLM_KEY_SEALS_MAX) {
      const oldest = state.keys.keys().next().value;
      if (oldest === undefined) break;
      state.keys.delete(oldest);
      state.evicted = true;
    }
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ v: 1, evicted: state.evicted, keys: [...state.keys] }), { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, this.file);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * L'hôte auquel la clé est liée : celui scellé au chiffrement ; sinon, secret ancien, celui que donne le renderer, comme
   * avant ; `''` (aucun hôte, la clé ne part pas) si le registre a perdu des liens.
   */
  hostFor(blob: unknown, rendererHost: unknown): unknown {
    if (typeof blob !== 'string' || !blob) return rendererHost;
    const state = this.load();
    const sealed = state.keys.get(digestOf(blob));
    if (sealed !== undefined) return sealed;
    return state.evicted ? '' : rendererHost;
  }
}
