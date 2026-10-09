import type { CryptoVenue } from './crypto/markets';

/**
 * Réseau REST de l'onglet 09 · CRY, côté process principal (`docs/ONGLET-CRYPTO.md` § 5, « Débit »).
 * Chaque appel du desk à Coinbase, Binance ou Bybit passe par `cryptoFetchJson` : hôte vérifié d'abord, https
 * seulement, redirections refusées, délai, taille bornée. `VenueGate` traduit ensuite les 429 en pause et le 418
 * en coupure de la venue. Aucun import d'Electron : le fetch réseau d'Electron est injecté par l'appelant
 * (`fetchImpl`, CRY2.5), ce qui garde le module testable avec de fausses `Response`.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const CRYPTO_UA = 'CANTO-Desk (crypto)';
const DEFAULT_TIMEOUT_MS = 10_000;
/** Au-delà, le minuteur de Node retombe à 1 ms : un délai plus long est tenu pour invalide. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** `ticker/24hr`, la réponse légitime la plus lourde, pèse environ 1 Mio : au-delà de 8 Mio, ce n'est plus un exchange. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** Borne des messages qui citent l'hôte ou une cause externe. */
const MESSAGE_MAX = 120;
const BACKOFF_START_SEC = 1;
const BACKOFF_MAX_SEC = 60;
/** Plafond d'un `Retry-After` : une venue dérangée qui demande des années ne ferme la porte qu'une heure. */
const RETRY_AFTER_MAX_SEC = 3600;

/**
 * Réponse non OK d'une venue. `cryptoFetchJson` ne renseigne `retryAfterSec` que pour un 429 dont l'en-tête
 * `Retry-After` est un nombre entier de secondes. Son message ne porte que le statut et l'hôte : jamais de chemin,
 * de requête ni de corps.
 */
export class VenueHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'VenueHttpError';
  }
}

/** L'hôte (avec son port éventuel) d'une URL https que `hostOk` admet ; `null` sinon, y compris si `hostOk` lève. */
function permittedHost(url: string, hostOk: (url: string) => boolean): string | null {
  try {
    if (hostOk(url) !== true) return null;
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.host : null;
  } catch {
    return null;
  }
}

function timeoutOf(ms: number | undefined): number {
  return ms !== undefined && Number.isInteger(ms) && ms > 0 && ms <= MAX_TIMEOUT_MS ? ms : DEFAULT_TIMEOUT_MS;
}

/** Attend `work` jusqu'à l'échéance du signal au plus, même si `fetchImpl` ou le flux ignorent ce signal. */
function within<T>(work: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const expire = (): void => reject(signal.reason);
    if (signal.aborted) expire();
    else signal.addEventListener('abort', expire, { once: true });
    Promise.resolve(work)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', expire));
  });
}

/** Libère une réponse qu'on ne lira pas, sans l'attendre et sans jamais lever. */
function discard(res: Response): void {
  try {
    void res.body?.cancel().catch(() => undefined);
  } catch {
    /* corps déjà verrouillé ou réponse factice : rien à libérer */
  }
}

/** `Retry-After` en secondes entières ; une date HTTP ou tout autre texte donne `undefined` (la porte garde alors son backoff). */
function retryAfterSeconds(raw: string | null): number | undefined {
  const text = raw?.trim() ?? '';
  if (!/^\d+$/.test(text)) return undefined;
  const seconds = Number(text);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

function timeoutError(host: string): Error {
  return new Error(`Délai dépassé (${host})`.slice(0, MESSAGE_MAX));
}

/** Code court d'une erreur de transport : `code` de Node (ENOTFOUND…) ou `net::ERR_…` d'Electron. Jamais un texte libre. */
function errorCode(error: unknown): string {
  const shaped = (value: unknown): string => {
    const code = typeof value === 'object' && value !== null ? (value as { code?: unknown }).code : undefined;
    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? code : '';
  };
  const own = shaped(error) || shaped((error as { cause?: unknown } | null | undefined)?.cause);
  if (own) return own;
  const chromium = error instanceof Error ? /net::(ERR_[A-Z0-9_]{1,40})/.exec(error.message) : null;
  return chromium?.[1] ?? '';
}

/**
 * Erreur de transport (échec de `fetchImpl`) en message sûr : le délai, le refus de redirection d'Electron
 * (`manual` annule la redirection au lieu de rendre le 3xx, comme dans `guardedFetch` de `calendar/sync.ts`), ou une
 * panne réseau réduite à l'hôte et à un code. Le texte de l'erreur d'origine, qui peut citer l'URL entière, ne sort pas.
 */
function transportError(error: unknown, host: string, signal: AbortSignal): Error {
  if (signal.aborted) return timeoutError(host);
  if (error instanceof Error && error.message === 'Redirect was cancelled') return new Error('Redirection refusée');
  const where = [host, errorCode(error)].filter(Boolean).join(', ');
  return new Error(`Réseau indisponible (${where})`.slice(0, MESSAGE_MAX));
}

/**
 * Corps d'une réponse OK, lu sur `MAX_BODY_BYTES` octets au plus, décodé en UTF-8 strict. Un bloc est reconnu par
 * `ArrayBuffer.isView` et lu octet par octet à sa place dans son tampon : un `Uint8Array` d'un autre royaume (le fetch
 * d'Electron) échoue à `instanceof`, et une autre vue (`DataView`, tableau typé décalé) ne se copie pas élément par élément.
 */
async function readBody(res: Response, host: string, signal: AbortSignal): Promise<string> {
  if (Number(res.headers.get('content-length')) > MAX_BODY_BYTES) {
    discard(res);
    throw new Error('Réponse trop volumineuse');
  }
  if (!res.body) throw new Error('Réponse illisible');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let oversize = false;
  try {
    for (;;) {
      const step = await within(reader.read(), signal);
      if (step.done) break;
      const chunk: unknown = step.value;
      if (!ArrayBuffer.isView(chunk)) throw new TypeError('bloc inattendu');
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        oversize = true;
        break;
      }
      chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
  } catch {
    // La cause d'origine ne sort pas : elle peut citer l'URL entière (voir `transportError`).
    throw signal.aborted ? timeoutError(host) : new Error('Réponse illisible');
  } finally {
    void reader.cancel().catch(() => undefined); // sans effet sur un flux déjà clos ; libère la connexion sinon
  }
  if (oversize) throw new Error('Réponse trop volumineuse');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Réponse illisible');
  }
}

/**
 * GET JSON vers un exchange, sans cookie ni identifiant de session (`credentials: 'omit'`). Les erreurs sont :
 * - `Error('Hôte non autorisé')` : `hostOk` refuse (ou lève), l'URL n'est pas analysable ou n'est pas en https ;
 *   rien n'est envoyé ;
 * - `Error('Redirection refusée')` : réponse 3xx, `opaqueredirect`, ou redirection annulée par Electron ;
 * - `VenueHttpError` : statut non OK (429 avec `Retry-After`, 418, tout autre) ; le corps n'est pas lu ;
 * - `Error('Délai dépassé (hôte)')`, `Error('Réseau indisponible (hôte, code)')` : transport ;
 * - `Error('Réponse trop volumineuse')` au-delà de 8 Mio, `Error('Réponse illisible')` : corps absent, coupé, non UTF-8 ou non JSON.
 * Un succès rend le JSON décodé tel quel. Aucune relance : la porte de la venue (`VenueGate`) décide de la suite.
 */
export async function cryptoFetchJson(
  url: string,
  deps: { fetchImpl: FetchLike; hostOk: (url: string) => boolean; timeoutMs?: number },
): Promise<unknown> {
  const host = permittedHost(url, deps.hostOk);
  if (host === null) throw new Error('Hôte non autorisé');
  const signal = AbortSignal.timeout(timeoutOf(deps.timeoutMs));

  let res: Response;
  try {
    const init: RequestInit = { headers: { 'User-Agent': CRYPTO_UA, Accept: 'application/json' }, redirect: 'manual', credentials: 'omit', signal };
    res = await within(deps.fetchImpl(url, init), signal);
  } catch (error) {
    throw transportError(error, host, signal);
  }

  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    discard(res);
    throw new Error('Redirection refusée');
  }
  if (!res.ok) {
    discard(res);
    const retryAfterSec = res.status === 429 ? retryAfterSeconds(res.headers.get('retry-after')) : undefined;
    throw new VenueHttpError(res.status, `HTTP ${res.status} (${host})`.slice(0, MESSAGE_MAX), retryAfterSec);
  }

  const body = await readBody(res, host, signal);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Réponse illisible');
  }
}

interface VenueLine {
  /** Instant (ms) avant lequel un 429 interdit tout appel. */
  until: number;
  /** Attente du prochain 429 sans `Retry-After`, en secondes. */
  backoffSec: number;
  /** 418 reçu : la venue reste coupée jusqu'au redémarrage. */
  banned: boolean;
}

/**
 * Portes de venue, en mémoire : le redémarrage du desk les remet à zéro, ce que veut aussi le 418.
 * - 429 : la venue est fermée jusqu'à `now + max(Retry-After, backoff)`, `Retry-After` plafonné à 3 600 s. Le backoff
 *   vaut 1 s, double une fois par pause et plafonne à 60 s. Un 429 reçu pendant la pause (une requête partie avant
 *   elle) ne redouble pas le backoff et ne la raccourcit jamais : seul son `Retry-After`, plafonné, peut l'allonger.
 * - Succès : le backoff retombe à 1 s. Une pause déjà décidée n'est pas levée : une autre requête, partie avant
 *   elle, peut aboutir pendant ce temps.
 * - 418 (IP bannie) : `blocked` jusqu'au redémarrage ; ni le temps ni un succès ne rouvrent la venue.
 * Les autres statuts ne touchent pas la porte. `allowed` dit si un appel peut partir (jamais vrai quand `blocked`) ;
 * `blocked` ne vaut que pour le 418 : une pause 429 n'est pas un blocage.
 */
export class VenueGate {
  private readonly lines = new Map<CryptoVenue, VenueLine>();

  constructor(private readonly now: () => number) {}

  private line(venue: CryptoVenue): VenueLine {
    let line = this.lines.get(venue);
    if (!line) {
      line = { until: 0, backoffSec: BACKOFF_START_SEC, banned: false };
      this.lines.set(venue, line);
    }
    return line;
  }

  allowed(venue: CryptoVenue): boolean {
    const line = this.lines.get(venue);
    return line === undefined || (!line.banned && this.now() >= line.until);
  }

  blocked(venue: CryptoVenue): boolean {
    return this.lines.get(venue)?.banned === true;
  }

  onHttpError(venue: CryptoVenue, err: VenueHttpError): void {
    if (err.status === 418) {
      this.line(venue).banned = true;
      return;
    }
    if (err.status !== 429) return;
    const line = this.line(venue);
    const now = this.now();
    const asked = err.retryAfterSec ?? 0;
    const askedSec = Number.isFinite(asked) && asked > 0 ? Math.min(asked, RETRY_AFTER_MAX_SEC) : 0;
    if (now < line.until) {
      // Même pause : une rafale de requêtes parties ensemble ne redouble pas le backoff.
      line.until = Math.max(line.until, now + askedSec * 1000);
      return;
    }
    line.until = now + Math.max(askedSec, line.backoffSec) * 1000;
    line.backoffSec = Math.min(line.backoffSec * 2, BACKOFF_MAX_SEC);
  }

  onSuccess(venue: CryptoVenue): void {
    const line = this.lines.get(venue);
    if (line) line.backoffSec = BACKOFF_START_SEC;
  }
}
