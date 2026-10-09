import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cryptoHostAllowed, type CryptoVenue } from '@/engine/crypto/markets';
import { VenueGate, VenueHttpError, cryptoFetchJson, type FetchLike } from '../electron/crypto-net';

const API = 'https://api.binance.com/api/v3/ticker/price?symbol=ONEUSDT&signature=abc123';
const HOST = 'api.binance.com';
const MIB = 1024 * 1024;
const MAX_BODY = 8 * MIB;
const VENUES: readonly CryptoVenue[] = ['coinbase', 'binance', 'bybit'];
const text = new TextEncoder();

const allow = (): boolean => true;

const json = (body: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(body), { status: 200, ...init });

/** Faux fetch : une réponse neuve à chaque appel (un corps ne se lit qu’une fois). */
const answering = (make: () => Response) => vi.fn<FetchLike>(async () => make());

/** L’erreur d’une promesse rejetée ; échoue si elle aboutit. */
async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejet qui n’est pas une Error : ${String(error)}`);
  }
  throw new Error('la promesse aurait dû être rejetée');
}

/** Corps en flux dont on observe les lectures et l’annulation. `next` rend un bloc, `'end'`, ou `'stall'` (ne plus jamais répondre). */
function watched(next: (pull: number) => Uint8Array | 'end' | 'stall') {
  const seen = { pulls: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls += 1;
      const step = next(seen.pulls);
      if (step === 'stall') return new Promise<void>(() => undefined);
      if (step === 'end') controller.close();
      else controller.enqueue(step);
      return undefined;
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { body, seen };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetch gardé · l’hôte', () => {
  it('refuse un hôte non autorisé avant tout appel', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const hostOk = vi.fn<(url: string) => boolean>(() => false);
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk }));
    expect(error.message).toBe('Hôte non autorisé');
    expect(error).not.toBeInstanceOf(VenueHttpError);
    expect(hostOk).toHaveBeenCalledTimes(1);
    expect(hostOk).toHaveBeenCalledWith(API);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('un hostOk qui lève refuse aussi : la garde échoue fermée', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const hostOk = (): boolean => {
      throw new Error('boum');
    };
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk }));
    expect(error.message).toBe('Hôte non autorisé');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'http://api.binance.com/api/v3/time',
    'wss://stream.binance.com:9443/ws',
    'ws://stream.binance.com:9443/ws',
    'ftp://api.binance.com/',
    'file:///C:/Windows/win.ini',
    'data:application/json,{}',
    '//api.binance.com/api/v3/time',
    'pas une url',
    '',
  ])('refuse %j même quand hostOk l’accepte : le REST est en https seulement', async (url) => {
    const fetchImpl = vi.fn<FetchLike>();
    const error = await failure(cryptoFetchJson(url, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe('Hôte non autorisé');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('avec le hostOk du runtime (https ou wss selon l’URL), une URL wss d’un hôte de la liste n’atteint pas fetch', async () => {
    const hostOk = (url: string): boolean => cryptoHostAllowed(url, url.startsWith('wss:') ? 'wss:' : 'https:');
    expect(hostOk('wss://stream.binance.com:9443/ws')).toBe(true); // la liste l’admet : c’est cryptoFetchJson qui refuse
    const fetchImpl = vi.fn<FetchLike>();
    const error = await failure(cryptoFetchJson('wss://stream.binance.com:9443/ws', { fetchImpl, hostOk }));
    expect(error.message).toBe('Hôte non autorisé');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('avec la liste réelle : un hôte de la liste passe, ses imitations et les URL à identifiants non', async () => {
    const hostOk = (url: string): boolean => cryptoHostAllowed(url, 'https:');
    const fetchImpl = answering(() => json({ price: '82528.01' }));
    await expect(cryptoFetchJson('https://api.exchange.coinbase.com/products/BTC-USD/ticker', { fetchImpl, hostOk })).resolves.toEqual({ price: '82528.01' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    for (const url of [
      'https://api.binance.com.evil.io/api/v3/time',
      'https://evil.io/?next=https://api.binance.com/',
      'https://user:pw@api.binance.com/api/v3/time',
      'http://api.binance.com/api/v3/time',
      'https://www.binance.com/',
    ]) {
      const error = await failure(cryptoFetchJson(url, { fetchImpl, hostOk }));
      expect(error.message, url).toBe('Hôte non autorisé');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1); // aucun des cinq refus n’a atteint fetch
  });
});

describe('fetch gardé · la requête', () => {
  it('appelle fetch une fois, sans suivre de redirection, avec deux en-têtes et un signal', async () => {
    const fetchImpl = answering(() => json({ ok: true }));
    await cryptoFetchJson(API, { fetchImpl, hostOk: allow });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(API);
    expect(init?.redirect).toBe('manual');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.body ?? null).toBeNull();
    const headers = new Headers(init?.headers);
    expect(headers.get('user-agent')).toBe('CANTO-Desk (crypto)');
    expect(headers.get('accept')).toBe('application/json');
    expect([...headers.keys()].sort()).toEqual(['accept', 'user-agent']); // ni cookie ni autorisation
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('demande credentials: omit : la session ne joint ni cookie ni identifiant, et n’en garde aucun', async () => {
    const fetchImpl = answering(() => json({ ok: true }));
    await cryptoFetchJson(API, { fetchImpl, hostOk: allow });
    expect(fetchImpl.mock.calls[0]![1]?.credentials).toBe('omit');
  });
});

describe('fetch gardé · la réponse', () => {
  it.each([
    ['un objet de chaînes numériques', { symbol: 'ONEUSDT', price: '0.00216300', count: 3, nested: { rows: [['1', '2.5', null]] } }],
    ['des bougies', [[1696118400000, '27000.1', '27100', '26950', '27050.9', '123.456']]],
    ['un tableau vide', []],
    ['un objet vide', {}],
    ['null', null],
    ['un nombre', 0],
    ['une chaîne', 'texte'],
    ['un booléen', true],
  ])('rend le JSON tel quel (%s)', async (_name, payload) => {
    const fetchImpl = answering(() => json(payload));
    await expect(cryptoFetchJson(API, { fetchImpl, hostOk: allow })).resolves.toEqual(payload);
  });

  it('rend le JSON sans toucher aux nombres d’exchange donnés en chaînes', async () => {
    const fetchImpl = answering(() => new Response('{"price":"0.00216300","qty":"1e-8"}', { status: 200 }));
    const out = (await cryptoFetchJson(API, { fetchImpl, hostOk: allow })) as { price: unknown; qty: unknown };
    expect(out.price).toBe('0.00216300');
    expect(out.qty).toBe('1e-8');
  });

  it.each([
    ['une page HTML', '<html><body>502 Bad Gateway</body></html>'],
    ['un corps vide', ''],
    ['un JSON coupé', '{"price":"0.0021'],
    ['un objet mal écrit', '{price: 1}'],
    ['des apostrophes', "{'price': 1}"],
    ['NaN', 'NaN'],
    ['undefined', 'undefined'],
    ['du texte brut', 'Service Unavailable'],
  ])('texte non JSON (%s) → Réponse illisible', async (_name, body) => {
    const fetchImpl = answering(() => new Response(body, { status: 200 }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe('Réponse illisible');
    expect(error).not.toBeInstanceOf(VenueHttpError);
  });

  it('un corps absent (null) ou en UTF-8 invalide est illisible', async () => {
    const empty = answering(() => new Response(null, { status: 200 }));
    expect((await failure(cryptoFetchJson(API, { fetchImpl: empty, hostOk: allow }))).message).toBe('Réponse illisible');
    const invalid = answering(() => new Response(new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d]), { status: 200 }));
    expect((await failure(cryptoFetchJson(API, { fetchImpl: invalid, hostOk: allow }))).message).toBe('Réponse illisible');
  });

  it('un corps qui échoue en route est illisible', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(text.encode('{"a":'));
        controller.error(new Error('ECONNRESET https://api.binance.com/api/v3/x?apikey=SECRET'));
      },
    });
    const error = await failure(cryptoFetchJson(API, { fetchImpl: answering(() => new Response(broken, { status: 200 })), hostOk: allow }));
    expect(error.message).toBe('Réponse illisible');
  });
});

describe('fetch gardé · redirections', () => {
  it.each([300, 301, 302, 303, 304, 307, 308])('refuse une réponse %i sans la suivre ni nommer sa destination', async (status) => {
    const fetchImpl = answering(() => new Response(null, { status, headers: { Location: 'https://evil.io/steal?key=SECRET' } }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe('Redirection refusée');
    expect(error).not.toBeInstanceOf(VenueHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuse une réponse opaqueredirect', async () => {
    const fetchImpl = answering(() => {
      const res = new Response(null, { status: 200 });
      Object.defineProperty(res, 'type', { value: 'opaqueredirect' });
      return res;
    });
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe('Redirection refusée');
  });

  it('refuse l’annulation de redirection du fetch d’Electron (« Redirect was cancelled »)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error('Redirect was cancelled');
    });
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe('Redirection refusée');
  });

  it('libère le corps d’une redirection refusée au lieu de l’attendre', async () => {
    const { body, seen } = watched(() => 'stall');
    const fetchImpl = answering(() => new Response(body, { status: 302, headers: { Location: 'https://evil.io/' } }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe('Redirection refusée');
    await vi.waitFor(() => expect(seen.cancelled).toBe(true));
  });
});

describe('fetch gardé · statuts HTTP', () => {
  it('429 : VenueHttpError(429) qui porte Retry-After en secondes', async () => {
    const fetchImpl = answering(() => new Response('{"msg":"Too many requests"}', { status: 429, headers: { 'Retry-After': '7' } }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error).toBeInstanceOf(VenueHttpError);
    expect(error).toBeInstanceOf(Error);
    const venue = error as VenueHttpError;
    expect(venue.name).toBe('VenueHttpError');
    expect(venue.status).toBe(429);
    expect(venue.retryAfterSec).toBe(7);
    expect(venue.message).toBe(`HTTP 429 (${HOST})`);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // aucune relance interne : la porte décide
  });

  it.each([
    ['7', 7],
    ['0', 0],
    ['120', 120],
  ])('lit Retry-After: %s comme %i secondes', async (header, seconds) => {
    const fetchImpl = answering(() => new Response(null, { status: 429, headers: { 'Retry-After': header } }));
    const error = (await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }))) as VenueHttpError;
    expect(error.retryAfterSec).toBe(seconds);
  });

  it.each([
    ['sans en-tête', null],
    ['une date HTTP', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['un négatif', '-5'],
    ['un décimal', '1.5'],
    ['une unité', '7s'],
    ['une notation scientifique', '1e3'],
    ['un hexadécimal', '0x10'],
    ['du texte', 'soon'],
    ['une valeur vide', ''],
    ['un entier hors des entiers sûrs', '99999999999999999999'],
  ])('Retry-After inutilisable (%s) : retryAfterSec absent', async (_name, header) => {
    const headers: Record<string, string> = header === null ? {} : { 'Retry-After': header };
    const fetchImpl = answering(() => new Response(null, { status: 429, headers }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error).toBeInstanceOf(VenueHttpError);
    expect((error as VenueHttpError).status).toBe(429);
    expect((error as VenueHttpError).retryAfterSec).toBeUndefined();
  });

  it('418 (ban d’IP Binance) : VenueHttpError(418), sans durée à transmettre', async () => {
    const fetchImpl = answering(() => new Response('{"code":-1003}', { status: 418, headers: { 'Retry-After': '3600' } }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error).toBeInstanceOf(VenueHttpError);
    const venue = error as VenueHttpError;
    expect(venue.status).toBe(418);
    expect(venue.retryAfterSec).toBeUndefined(); // la porte coupe jusqu’au redémarrage, quelle que soit la durée annoncée
    expect(venue.message).toBe(`HTTP 418 (${HOST})`);
  });

  it.each([400, 401, 403, 404, 451, 500, 502, 503, 504])('autre statut non OK (%i) : VenueHttpError, sans Retry-After', async (status) => {
    const fetchImpl = answering(() => new Response('SECRET-BODY', { status, headers: { 'Retry-After': '30' } }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error).toBeInstanceOf(VenueHttpError);
    expect((error as VenueHttpError).status).toBe(status);
    expect((error as VenueHttpError).retryAfterSec).toBeUndefined();
  });

  it('le message ne porte ni requête, ni chemin, ni corps de réponse', async () => {
    for (const status of [429, 418, 500]) {
      const fetchImpl = answering(() => new Response('SECRET-BODY', { status }));
      const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
      expect(error.message).toBe(`HTTP ${status} (${HOST})`);
      for (const leak of ['?', 'signature', 'abc123', 'ONEUSDT', '/api', 'SECRET']) expect(error.message).not.toContain(leak);
    }
  });

  it('ne lit pas le corps d’une erreur : un corps qui ne finit pas ne retient pas la réponse', async () => {
    const { body, seen } = watched(() => 'stall');
    const fetchImpl = answering(() => new Response(body, { status: 429, headers: { 'Retry-After': '3' } }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error).toBeInstanceOf(VenueHttpError);
    await vi.waitFor(() => expect(seen.cancelled).toBe(true));
  });
});

describe('fetch gardé · taille de la réponse', () => {
  const block = new Uint8Array(MIB);

  it('refuse une taille annoncée au-delà de 8 Mio sans lire le corps', async () => {
    const { body, seen } = watched(() => block);
    const fetchImpl = answering(() => new Response(body, { status: 200, headers: { 'content-length': String(MAX_BODY + 1) } }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe('Réponse trop volumineuse');
    expect(error).not.toBeInstanceOf(VenueHttpError);
    await vi.waitFor(() => expect(seen.cancelled).toBe(true));
    expect(seen.pulls).toBeLessThanOrEqual(1); // le flux n’a pas été vidé
  });

  it('coupe un flux sans taille annoncée dès qu’il dépasse 8 Mio, et ne le vide pas', async () => {
    const { body, seen } = watched((pull) => (pull <= 100 ? block : 'end'));
    const fetchImpl = answering(() => new Response(body, { status: 200 }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe('Réponse trop volumineuse');
    await vi.waitFor(() => expect(seen.cancelled).toBe(true));
    expect(seen.pulls).toBeLessThan(20);
  });

  it('ne croit pas la taille annoncée : un corps plus gros que son content-length est coupé aussi', async () => {
    const { body } = watched((pull) => (pull <= 100 ? block : 'end'));
    const fetchImpl = answering(() => new Response(body, { status: 200, headers: { 'content-length': '10' } }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe('Réponse trop volumineuse');
  });

  it('accepte 8 Mio pile et refuse un octet de plus', async () => {
    const atCap = answering(() => new Response(`"${'a'.repeat(MAX_BODY - 2)}"`, { status: 200 }));
    const out = await cryptoFetchJson(API, { fetchImpl: atCap, hostOk: allow });
    expect(typeof out === 'string' && out.length).toBe(MAX_BODY - 2);

    const over = answering(() => new Response(`"${'a'.repeat(MAX_BODY - 1)}"`, { status: 200 }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl: over, hostOk: allow }));
    expect(error.message).toBe('Réponse trop volumineuse');
  });

  it('accepte une taille annoncée de 8 Mio pile : seuls les octets reçus décident', async () => {
    const fetchImpl = answering(() => new Response('{"a":1}', { status: 200, headers: { 'content-length': String(MAX_BODY) } }));
    await expect(cryptoFetchJson(API, { fetchImpl, hostOk: allow })).resolves.toEqual({ a: 1 });
  });

  it('un bloc qui n’est pas binaire interrompt la lecture et libère le flux', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (pulls <= 3) controller.enqueue('{"a":1}'); // une chaîne, pas des octets : sans byteLength, le plafond ne compterait rien
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const error = await failure(cryptoFetchJson(API, { fetchImpl: answering(() => new Response(body, { status: 200 })), hostOk: allow }));
    expect(error.message).toBe('Réponse illisible');
    expect(cancelled).toBe(true);
  });

  it('lit un bloc Uint8Array venu d’un autre royaume : ArrayBuffer.isView, pas instanceof', async () => {
    const foreign: unknown = runInNewContext('new Uint8Array([123, 34, 97, 34, 58, 49, 125])'); // {"a":1}
    expect(foreign instanceof Uint8Array).toBe(false);
    expect(ArrayBuffer.isView(foreign)).toBe(true);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(foreign);
        controller.close();
      },
    });
    await expect(cryptoFetchJson(API, { fetchImpl: answering(() => new Response(body, { status: 200 })), hostOk: allow })).resolves.toEqual({ a: 1 });
  });

  it('lit les octets de toute vue, à sa place dans son tampon : DataView, vue décalée', async () => {
    const framed = text.encode('xx{"a":1}yy');
    const view = new DataView(framed.buffer, 2, framed.byteLength - 4);
    const shifted = text.encode('zz{"b":[2,3]}').subarray(2);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(view);
        controller.close();
      },
    });
    await expect(cryptoFetchJson(API, { fetchImpl: answering(() => new Response(body, { status: 200 })), hostOk: allow })).resolves.toEqual({ a: 1 });
    const other = new ReadableStream({
      start(controller) {
        controller.enqueue(shifted);
        controller.close();
      },
    });
    await expect(cryptoFetchJson(API, { fetchImpl: answering(() => new Response(other, { status: 200 })), hostOk: allow })).resolves.toEqual({ b: [2, 3] });
  });

  it('lit un corps en plusieurs blocs', async () => {
    const parts = ['{"rows":[', '"é",', '"€"', ']}'];
    const { body } = watched((pull) => (pull <= parts.length ? text.encode(parts[pull - 1]!) : 'end'));
    const fetchImpl = answering(() => new Response(body, { status: 200 }));
    await expect(cryptoFetchJson(API, { fetchImpl, hostOk: allow })).resolves.toEqual({ rows: ['é', '€'] });
  });

  it('recolle un caractère UTF-8 coupé entre deux blocs', async () => {
    const euro = text.encode('{"s":"€"}'); // « € » tient sur trois octets
    const cut = euro.indexOf(0xe2) + 1;
    const { body } = watched((pull) => (pull === 1 ? euro.slice(0, cut) : pull === 2 ? euro.slice(cut) : 'end'));
    const fetchImpl = answering(() => new Response(body, { status: 200 }));
    await expect(cryptoFetchJson(API, { fetchImpl, hostOk: allow })).resolves.toEqual({ s: '€' });
  });
});

describe('fetch gardé · délai et réseau', () => {
  it('applique 10 s par défaut, par AbortSignal.timeout, et passe ce signal à fetch', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchImpl = answering(() => json({}));
    await cryptoFetchJson(API, { fetchImpl, hostOk: allow });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchImpl.mock.calls[0]![1]?.signal).toBe(timeout.mock.results[0]!.value);
  });

  it.each([100, 2500, 2 ** 31 - 1])('prend le délai demandé quand il est valide (%d ms)', async (timeoutMs) => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await cryptoFetchJson(API, { fetchImpl: answering(() => json({})), hostOk: allow, timeoutMs });
    expect(timeout).toHaveBeenCalledWith(timeoutMs);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, 2 ** 32])('un délai invalide (%d) retombe sur 10 s', async (timeoutMs) => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await cryptoFetchJson(API, { fetchImpl: answering(() => json({})), hostOk: allow, timeoutMs });
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it('un fetch qui ne répond jamais et ignore le signal est coupé au délai', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => new Promise<Response>(() => undefined));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow, timeoutMs: 30 }));
    expect(error.message).toBe(`Délai dépassé (${HOST})`);
    expect(error).not.toBeInstanceOf(VenueHttpError);
  });

  it('un fetch qui obéit au signal donne le même message', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow, timeoutMs: 30 }));
    expect(error.message).toBe(`Délai dépassé (${HOST})`);
  });

  it('un corps qui s’arrête en route est abandonné au délai, puis annulé', async () => {
    let sent = false;
    const { body, seen } = watched(() => {
      if (sent) return 'stall';
      sent = true;
      return text.encode('{"a":');
    });
    const fetchImpl = answering(() => new Response(body, { status: 200 }));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow, timeoutMs: 30 }));
    expect(error.message).toBe(`Délai dépassé (${HOST})`);
    await vi.waitFor(() => expect(seen.cancelled).toBe(true));
  });

  it.each([
    ['une erreur Node et son code', Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.binance.com'), { code: 'ENOTFOUND' }) }), `Réseau indisponible (${HOST}, ENOTFOUND)`],
    ['un code porté par l’erreur elle-même', Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }), `Réseau indisponible (${HOST}, ECONNREFUSED)`],
    ['une erreur de la pile réseau d’Electron', new Error('net::ERR_INTERNET_DISCONNECTED'), `Réseau indisponible (${HOST}, ERR_INTERNET_DISCONNECTED)`],
    ['une erreur sans code', new Error('boom'), `Réseau indisponible (${HOST})`],
    ['un code qui n’a pas la forme d’un code', Object.assign(new Error('boom'), { code: 'https://evil.io/?k=SECRET' }), `Réseau indisponible (${HOST})`],
    ['un rejet qui n’est pas une Error', 'boom', `Réseau indisponible (${HOST})`],
    ['un rejet vide', undefined, `Réseau indisponible (${HOST})`],
  ])('erreur réseau : %s', async (_name, rejection, message) => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.reject(rejection));
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe(message);
    expect(error).not.toBeInstanceOf(VenueHttpError);
  });

  it('une erreur réseau qui cite l’URL complète n’en laisse rien passer, au-delà de l’hôte', async () => {
    const leaky = new TypeError(`fetch failed: GET ${API}&apikey=SECRET`);
    const error = await failure(cryptoFetchJson(API, { fetchImpl: () => Promise.reject(leaky), hostOk: allow }));
    expect(error.message).toBe(`Réseau indisponible (${HOST})`);
    for (const leak of ['?', 'symbol', 'signature', 'SECRET', 'apikey', '/api']) expect(error.message).not.toContain(leak);
  });

  it('un fetch qui lève avant de rendre une promesse est traité comme une erreur réseau', async () => {
    const fetchImpl: FetchLike = () => {
      throw new Error('net::ERR_FAILED');
    };
    const error = await failure(cryptoFetchJson(API, { fetchImpl, hostOk: allow }));
    expect(error.message).toBe(`Réseau indisponible (${HOST}, ERR_FAILED)`);
  });

  it('borne le message, même avec un hôte démesuré', async () => {
    const long = `https://${'a'.repeat(200)}.binance.com/x`;
    const error = await failure(cryptoFetchJson(long, { fetchImpl: () => Promise.reject(new Error('boom')), hostOk: allow }));
    expect(error.message.length).toBeLessThanOrEqual(120);
    expect(error.message.startsWith('Réseau indisponible (')).toBe(true);
  });
});

describe('fetch gardé · module du process principal', () => {
  const source = readFileSync('electron/crypto-net.ts', 'utf8');

  it('n’importe ni electron ni rien d’exécutable : le fetch réel est injecté par l’appelant', () => {
    expect(source).not.toMatch(/from\s+['"]electron['"]/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bimport\s*\(/);
    const imports = [...source.matchAll(/^import\b.*$/gm)].map((m) => m[0]);
    expect(imports).toEqual(["import type { CryptoVenue } from './crypto/markets';"]); // un type : effacé à la compilation
  });

  it('n’appelle jamais le fetch global : tout passe par fetchImpl', () => {
    expect(source).not.toMatch(/(?<![.\w])fetch\s*\(/);
  });
});

describe('portes de venue', () => {
  /** Horloge à la main, en millisecondes. */
  function clock(start = 1_700_000_000_000) {
    let now = start;
    return {
      now: () => now,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }
  const rateLimited = (retryAfterSec?: number): VenueHttpError => new VenueHttpError(429, 'HTTP 429', retryAfterSec);
  const banned = (): VenueHttpError => new VenueHttpError(418, 'HTTP 418');

  it('VenueHttpError garde son statut, sa durée et reste une Error', () => {
    const error = new VenueHttpError(429, 'trop de requêtes', 7);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VenueHttpError);
    expect([error.name, error.status, error.message, error.retryAfterSec]).toEqual(['VenueHttpError', 429, 'trop de requêtes', 7]);
    expect(new VenueHttpError(500, 'x').retryAfterSec).toBeUndefined();
  });

  it('ouvre les trois venues à la construction', () => {
    const gate = new VenueGate(clock().now);
    for (const venue of VENUES) {
      expect(gate.allowed(venue), venue).toBe(true);
      expect(gate.blocked(venue), venue).toBe(false);
    }
  });

  it('un 429 avec Retry-After: 7 ferme la venue 7 s exactement, sans la bloquer', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', rateLimited(7));
    expect(gate.allowed('binance')).toBe(false);
    c.advance(6_999);
    expect(gate.allowed('binance')).toBe(false);
    expect(gate.blocked('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
    expect(gate.blocked('binance')).toBe(false);
  });

  it('deux 429 sans en-tête : 1 s, puis 2 s', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', rateLimited());
    c.advance(999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);

    gate.onHttpError('binance', rateLimited());
    c.advance(1_999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
  });

  it('le backoff double de 1 s jusqu’à 60 s, puis reste à 60 s', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    for (const wait of [1, 2, 4, 8, 16, 32, 60, 60, 60]) {
      gate.onHttpError('bybit', rateLimited());
      c.advance(wait * 1000 - 1);
      expect(gate.allowed('bybit'), `${wait} s : fermée juste avant`).toBe(false);
      c.advance(1);
      expect(gate.allowed('bybit'), `${wait} s : ouverte à l’échéance`).toBe(true);
    }
  });

  it('prend le plus long de Retry-After et du backoff', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', rateLimited(30)); // 30 s ; le backoff passe à 2 s
    c.advance(29_999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);

    gate.onHttpError('binance', rateLimited(1)); // Retry-After 1 s < backoff 2 s : 2 s
    c.advance(1_999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
  });

  it('un succès remet le backoff à 1 s', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    for (let i = 0; i < 3; i += 1) {
      gate.onHttpError('binance', rateLimited()); // 1 s, 2 s, 4 s : le prochain serait de 8 s
      c.advance(60_000);
    }
    gate.onSuccess('binance');
    gate.onHttpError('binance', rateLimited());
    c.advance(999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
  });

  it('un succès ne rouvre pas une venue encore en pause', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', rateLimited(10));
    c.advance(1_000);
    gate.onSuccess('binance'); // une autre requête, partie avant la pause
    expect(gate.allowed('binance')).toBe(false);
    c.advance(8_999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
  });

  it('un 429 reçu pendant une pause ne la raccourcit pas', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', rateLimited(30));
    c.advance(1_000);
    gate.onHttpError('binance', rateLimited()); // 2 s demandées, mais 29 s restent à courir
    c.advance(28_999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
  });

  it.each([Number.NaN, -3, Number.POSITIVE_INFINITY, 0])('un Retry-After inutilisable (%d) laisse le backoff décider, sans jamais fermer pour toujours', (retryAfter) => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', rateLimited(retryAfter));
    expect(gate.allowed('binance')).toBe(false);
    c.advance(999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
  });

  it('chaque venue a sa porte et son backoff', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', rateLimited(30)); // le backoff de Binance passe à 2 s
    expect(gate.allowed('coinbase')).toBe(true);
    expect(gate.allowed('bybit')).toBe(true);
    gate.onSuccess('coinbase'); // ne remet pas à zéro le backoff de Binance
    gate.onHttpError('bybit', rateLimited(5));

    c.advance(30_000);
    expect(gate.allowed('binance')).toBe(true);
    expect(gate.allowed('bybit')).toBe(true);
    gate.onHttpError('binance', rateLimited());
    c.advance(1_999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
  });

  it('un 418 bloque la venue jusqu’au redémarrage : ni le temps, ni un succès, ni un autre statut ne la rouvrent', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', banned());
    expect(gate.blocked('binance')).toBe(true);
    expect(gate.allowed('binance')).toBe(false);

    c.advance(30 * 24 * 3600 * 1000);
    expect(gate.blocked('binance')).toBe(true);
    expect(gate.allowed('binance')).toBe(false);
    gate.onSuccess('binance');
    gate.onHttpError('binance', rateLimited(1));
    c.advance(3600 * 1000);
    expect(gate.blocked('binance')).toBe(true);
    expect(gate.allowed('binance')).toBe(false);

    for (const other of ['coinbase', 'bybit'] as const) {
      expect(gate.blocked(other), other).toBe(false);
      expect(gate.allowed(other), other).toBe(true);
    }
    const restarted = new VenueGate(c.now); // « jusqu’au redémarrage » : une porte neuve est ouverte
    expect(restarted.blocked('binance')).toBe(false);
    expect(restarted.allowed('binance')).toBe(true);
  });

  it.each([400, 401, 403, 404, 500, 502, 503])('un statut %i ne ferme pas la venue', (status) => {
    const gate = new VenueGate(clock().now);
    gate.onHttpError('binance', new VenueHttpError(status, `HTTP ${status}`, 30));
    expect(gate.allowed('binance')).toBe(true);
    expect(gate.blocked('binance')).toBe(false);
  });

  it('un succès sur une porte intacte ne change rien', () => {
    const gate = new VenueGate(clock().now);
    gate.onSuccess('coinbase');
    expect(gate.allowed('coinbase')).toBe(true);
    expect(gate.blocked('coinbase')).toBe(false);
  });

  it('plafonne Retry-After à 3 600 s : une venue dérangée ne se ferme pas pour des années', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', rateLimited(10 * 365 * 24 * 3600));
    c.advance(3_600_000 - 1);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);

    gate.onHttpError('coinbase', rateLimited(3_601));
    c.advance(3_600_000);
    expect(gate.allowed('coinbase')).toBe(true);
  });

  it('ne double le backoff qu’une fois par pause : une rafale de 429 en vol ne le redouble pas', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    for (let i = 0; i < 5; i += 1) gate.onHttpError('bybit', rateLimited()); // cinq requêtes parties ensemble, cinq 429
    c.advance(999);
    expect(gate.allowed('bybit')).toBe(false);
    c.advance(1);
    expect(gate.allowed('bybit')).toBe(true); // 1 s, pas 16 s
    gate.onHttpError('bybit', rateLimited()); // pause suivante : 2 s, pas 32 s
    gate.onHttpError('bybit', rateLimited());
    c.advance(1_999);
    expect(gate.allowed('bybit')).toBe(false);
    c.advance(1);
    expect(gate.allowed('bybit')).toBe(true);
    gate.onHttpError('bybit', rateLimited()); // puis 4 s
    c.advance(3_999);
    expect(gate.allowed('bybit')).toBe(false);
    c.advance(1);
    expect(gate.allowed('bybit')).toBe(true);
  });

  it('un 429 reçu pendant la pause peut l’allonger par son Retry-After, plafonné, sans redoubler le backoff', () => {
    const c = clock();
    const gate = new VenueGate(c.now);
    gate.onHttpError('binance', rateLimited()); // 1 s ; le backoff passe à 2 s
    c.advance(500);
    gate.onHttpError('binance', rateLimited(10)); // la venue demande 10 s : la pause court jusqu’à 10,5 s
    c.advance(9_999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
    gate.onHttpError('binance', rateLimited()); // 2 s : le 429 en pause n’a pas redoublé le backoff
    c.advance(1_999);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
    gate.onHttpError('binance', rateLimited()); // 4 s
    c.advance(100);
    gate.onHttpError('binance', rateLimited(86_400)); // demandé en pause : plafonné à 3 600 s depuis maintenant
    c.advance(3_600_000 - 1);
    expect(gate.allowed('binance')).toBe(false);
    c.advance(1);
    expect(gate.allowed('binance')).toBe(true);
  });
});

describe('fetch gardé avec les portes', () => {
  const rateLimitedFetch = (headers: Record<string, string> = {}) => answering(() => new Response('slow down', { status: 429, headers }));

  it('429 avec Retry-After: 7 : retryAfterSec 7, puis la porte reste fermée 7 s', async () => {
    let now = 5_000_000;
    const gate = new VenueGate(() => now);
    const error = await failure(cryptoFetchJson(API, { fetchImpl: rateLimitedFetch({ 'Retry-After': '7' }), hostOk: allow }));
    expect(error).toBeInstanceOf(VenueHttpError);
    expect((error as VenueHttpError).retryAfterSec).toBe(7);

    gate.onHttpError('binance', error as VenueHttpError);
    now += 6_999;
    expect(gate.allowed('binance')).toBe(false);
    now += 1;
    expect(gate.allowed('binance')).toBe(true);
  });

  it('deux 429 sans en-tête : 1 s, puis 2 s', async () => {
    let now = 5_000_000;
    const gate = new VenueGate(() => now);
    for (const wait of [1_000, 2_000]) {
      const error = await failure(cryptoFetchJson(API, { fetchImpl: rateLimitedFetch(), hostOk: allow }));
      expect((error as VenueHttpError).retryAfterSec).toBeUndefined();
      gate.onHttpError('binance', error as VenueHttpError);
      now += wait - 1;
      expect(gate.allowed('binance'), `${wait} ms`).toBe(false);
      now += 1;
      expect(gate.allowed('binance'), `${wait} ms`).toBe(true);
    }
  });

  it('un 418 : bloquée définitivement ; un 200 ensuite ne la rouvre pas', async () => {
    const gate = new VenueGate(() => 5_000_000);
    const error = await failure(cryptoFetchJson(API, { fetchImpl: answering(() => new Response('{"code":-1003}', { status: 418 })), hostOk: allow }));
    gate.onHttpError('binance', error as VenueHttpError);
    expect(gate.blocked('binance')).toBe(true);
    await cryptoFetchJson(API, { fetchImpl: answering(() => json({ price: '1' })), hostOk: allow });
    gate.onSuccess('binance');
    expect(gate.blocked('binance')).toBe(true);
    expect(gate.allowed('binance')).toBe(false);
  });
});
