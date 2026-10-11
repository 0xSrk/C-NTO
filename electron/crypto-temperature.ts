import { LiquidationWindow, breadthFromTickers, emptyReading, fundingFromPremiumIndex, oiChange, type TemperatureReading } from './crypto/temperature';
import { FORCE_ORDER_URL, PREMIUM_INDEX_URL, TICKER_24H_URL, openInterestUrl } from './crypto/venues';
import { VenueHttpError, type VenueGate } from './crypto-net';
import { ManagedSocket, errorText, safeText, type Timers, type WsFactory } from './crypto-socket';

/**
 * La température du marché lue chez Binance, côté process principal (`docs/ONGLET-CRYPTO.md` § 6). `start()` lance quatre
 * relevés REST, chacun tout de suite puis à sa cadence — `premiumIndex` (le funding) toutes les 60 s, `ticker/24hr` (la
 * largeur) et `openInterestHist` de BTCUSDT et d'ETHUSDT toutes les 5 min — et la socket `!forceOrder@arr` (les
 * liquidations) ; `stop()` arrête minuteurs et socket et efface la lecture. Les calculs sont ceux de
 * `src/engine/crypto/temperature.ts`, partagé avec le moteur : ce module n'y ajoute que le réseau, les minuteurs et la fusion.
 * Aucun import d'Electron ni de `ws`, aucun minuteur ni horloge globaux : tout est injecté (CRY2.5 lie le client réel).
 * Tout ce qui vient du réseau est tenu pour suspect : un texte journalisé est borné, et une URL n'y laisse que son hôte.
 */

/** La seule venue interrogée, et la clé de sa porte : la même que celle de `CryptoFeedHost`. */
const VENUE = 'binance' as const;
/** Cadence de `premiumIndex`. */
const FUNDING_EVERY_MS = 60_000;
/** Cadence de `ticker/24hr` et de `openInterestHist`. */
const SLOW_EVERY_MS = 300_000;
/** Les messages de liquidation d'une même seconde se regroupent : la lecture est recalculée et émise au plus une fois par seconde. */
const LIQUIDATIONS_EVERY_MS = 1_000;
/** Borne d'une ligne de journal. */
const LINE_MAX = 400;

export interface TemperatureDeps {
  /**
   * Le fetch gardé (`cryptoFetchJson` en CRY2.5) : le JSON décodé, ou une erreur, `VenueHttpError` pour un statut non OK.
   * Il doit toujours se régler (`cryptoFetchJson` borne le délai) : une requête qui ne revient jamais garderait sa source
   * « en route », et plus aucun tour ne la relèverait.
   */
  fetchJson: (url: string) => Promise<unknown>;
  ws: WsFactory;
  hostOk: (url: string) => boolean;
  timers: Timers;
  now: () => number;
  /** La porte de Binance : celle de `CryptoFeedHost`, une seule par process. */
  gate: VenueGate;
  /** Reçoit chaque lecture remise ; l'hôte ne la modifie plus ensuite. Un `emit` qui lève est journalisé, il n'arrête rien. */
  emit: (reading: TemperatureReading) => void;
  log: (l: string) => void;
}

/** Les quatre relevés REST, nommés comme la lecture qu'ils nourrissent. */
type Source = 'funding' | 'breadth' | 'oiBtc' | 'oiEth';

const SOURCES: Record<Source, { label: string; url: string }> = {
  funding: { label: 'premiumIndex', url: PREMIUM_INDEX_URL },
  breadth: { label: 'ticker/24hr', url: TICKER_24H_URL },
  oiBtc: { label: 'openInterestHist BTCUSDT', url: openInterestUrl('BTCUSDT') },
  oiEth: { label: 'openInterestHist ETHUSDT', url: openInterestUrl('ETHUSDT') },
};

/** Les relevés de la cadence de 5 min, dans l'ordre où ils partent. */
const SLOW_SOURCES: readonly Source[] = ['breadth', 'oiBtc', 'oiEth'];

/** Ce que `clearTimeout` et `clearInterval` acceptent, quel que soit le jeu de types (Node, DOM) qui les déclare. */
type TimerHandle = Parameters<Timers['clearTimeout']>[0];

/**
 * Tout ce qui naît avec un `start()` et meurt avec le `stop()` qui suit. Un résultat dont le lancement n'est plus le
 * courant (arrêté, ou arrêté puis relancé) est écarté : il se reconnaît à ce que `this.run` n'est plus son objet.
 */
interface Run {
  /** Les liquidations de l'heure : une seule fenêtre par lancement, gardée à travers les reconnexions de la socket. */
  window: LiquidationWindow;
  funding: TemperatureReading['funding'];
  breadth: TemperatureReading['breadth'];
  openInterest: TemperatureReading['openInterest'];
  /** La dernière lecture remise : la lecture vide tant que rien n'a été relevé. */
  reading: TemperatureReading;
  /** Les sources dont une requête n'est pas encore revenue. */
  inFlight: Set<Source>;
  /** Pour chaque source en panne, la cause déjà journalisée. */
  failing: Map<Source, string>;
  socket: ManagedSocket | null;
  fundingTimer: TimerHandle | null;
  slowTimer: TimerHandle | null;
  /** L'échéance de la prochaine émission des liquidations, quand des messages l'attendent. */
  flushTimer: TimerHandle | null;
}

/**
 * La température du marché, relevée et tenue à jour. Chaque relevé réussi se fusionne dans la lecture courante, puis la
 * lecture est émise ; un relevé qui échoue ou ne se lit pas ne touche à rien (la valeur précédente et son heure restent,
 * une lecture n'est jamais effacée par une panne) et n'émet rien. L'open interest se fusionne symbole par symbole, et son
 * heure est celle du dernier relevé réussi. Une lecture émise n'est plus jamais modifiée : chaque relevé en produit une neuve.
 * `current()` rend `null` avant `start()` et après `stop()`, la lecture vide (`emptyReading`) juste après `start()` ; rien
 * n'est émis avant le premier relevé.
 * Porte de la venue : avant chaque appel, `gate.allowed` ; refusée (429 en pause, 418), le tour est sauté sans appel, les
 * minuteurs continuent et le tour suivant tente de nouveau, sans rattrapage. Un `VenueHttpError` va à la porte ; un 418
 * coupe aussi la socket des liquidations, la venue étant coupée jusqu'au redémarrage, comme pour `CryptoFeedHost` ;
 * `gate.onSuccess` ne part qu'après une réponse lue. Une source n'a jamais plus d'une requête en route : un tour qui la
 * trouve encore en attente est sauté.
 * Journal : la panne d'une source est écrite une fois, et de nouveau quand sa cause change, puis une ligne quand elle est
 * rétablie : jamais une ligne par relevé.
 * Liquidations : chaque message de la socket est donné à la fenêtre avec l'horloge de l'hôte, et le recalcul puis l'émission
 * suivent au plus une seconde plus tard (un seul minuteur de fin de seconde, quel que soit le nombre de messages).
 * Toute émission recalcule `liquidations` à l'instant de l'émission : l'heure glisse donc au moins à chaque relevé de
 * `premiumIndex`, soit toutes les minutes tant qu'il répond, même sans nouvelle liquidation. Aucun repère n'est posé sur
 * `since` après une longue coupure de la socket : le total reste un minorant.
 * Une réponse qui arrive après `stop()`, ou après un `stop()` suivi d'un `start()`, est écartée : ni fusion, ni émission.
 */
export class TemperatureHost {
  private run: Run | null = null;
  private emitFailing = false;

  constructor(private readonly deps: TemperatureDeps) {}

  /** Lance les relevés et la socket ; sans effet si l'hôte tourne déjà. */
  start(): void {
    if (this.run !== null) return;
    const { timers, now } = this.deps;
    const startedAt = now();
    const run: Run = {
      window: new LiquidationWindow(startedAt),
      funding: null,
      breadth: null,
      openInterest: null,
      reading: emptyReading(startedAt),
      inFlight: new Set(),
      failing: new Map(),
      socket: null,
      fundingTimer: null,
      slowTimer: null,
      flushTimer: null,
    };
    this.run = run;
    this.emitFailing = false;
    run.fundingTimer = timers.setInterval(() => this.poll(run, 'funding'), FUNDING_EVERY_MS);
    run.slowTimer = timers.setInterval(() => this.pollSlow(run), SLOW_EVERY_MS);
    this.poll(run, 'funding');
    this.pollSlow(run);
    run.socket = new ManagedSocket({
      url: FORCE_ORDER_URL,
      venue: VENUE,
      ws: this.deps.ws,
      hostOk: this.deps.hostOk,
      timers,
      now,
      gate: this.deps.gate,
      onMessage: (raw) => this.onFrame(run, raw),
      // Le flux se choisit dans l'URL : rien à demander à l'ouverture. Son état ne se remonte pas ; `ManagedSocket` journalise ce qui compte.
      onState: () => undefined,
      onOpen: () => undefined,
      log: (line) => this.write(line),
    });
    run.socket.open();
  }

  /** Arrête minuteurs et socket, efface la lecture. L'hôte reste utilisable : `start()` repart de zéro. */
  stop(): void {
    const run = this.run;
    if (run === null) return;
    this.run = null;
    const { timers } = this.deps;
    if (run.fundingTimer !== null) timers.clearInterval(run.fundingTimer);
    if (run.slowTimer !== null) timers.clearInterval(run.slowTimer);
    if (run.flushTimer !== null) timers.clearTimeout(run.flushTimer);
    run.fundingTimer = null;
    run.slowTimer = null;
    run.flushTimer = null;
    run.socket?.close();
  }

  current(): TemperatureReading | null {
    return this.run?.reading ?? null;
  }

  private pollSlow(run: Run): void {
    for (const source of SLOW_SOURCES) this.poll(run, source);
  }

  /** Un tour de relevé : sauté si la porte est fermée ou si la requête précédente de la source n'est pas revenue. */
  private poll(run: Run, source: Source): void {
    if (this.run !== run || run.inFlight.has(source) || !this.deps.gate.allowed(VENUE)) return;
    run.inFlight.add(source);
    this.read(run, source).catch((error: unknown) => this.log(`${SOURCES[source].label} erreur interne · ${errorText(error)}`));
  }

  private async read(run: Run, source: Source): Promise<void> {
    try {
      let json: unknown;
      try {
        json = await this.deps.fetchJson(SOURCES[source].url);
      } catch (error) {
        this.failed(run, source, error);
        return;
      }
      if (this.run !== run) return;
      const at = this.deps.now();
      if (!this.merge(run, source, json, at)) {
        this.fail(run, source, 'aucune lecture exploitable dans la réponse');
        return;
      }
      this.deps.gate.onSuccess(VENUE);
      this.recover(run, source);
      this.publish(run, at);
    } finally {
      run.inFlight.delete(source);
    }
  }

  /**
   * Fusionne la réponse d'une source dans la lecture du lancement ; faux si elle ne contient rien de lisible, auquel cas
   * rien n'a changé. L'open interest se fusionne par symbole, son heure étant celle de ce relevé.
   */
  private merge(run: Run, source: Source, json: unknown, at: number): boolean {
    switch (source) {
      case 'funding': {
        const funding = fundingFromPremiumIndex(json, at);
        if (funding === null) return false;
        run.funding = funding;
        return true;
      }
      case 'breadth': {
        const breadth = breadthFromTickers(json, at);
        if (breadth === null) return false;
        run.breadth = breadth;
        return true;
      }
      case 'oiBtc':
      case 'oiEth': {
        const change = oiChange(json);
        if (change === null) return false;
        const kept = run.openInterest;
        run.openInterest = {
          btc: source === 'oiBtc' ? change : (kept?.btc ?? null),
          eth: source === 'oiEth' ? change : (kept?.eth ?? null),
          at,
        };
        return true;
      }
    }
  }

  /** Remet la lecture : les relevés gardés, les liquidations recalculées à `at`. */
  private publish(run: Run, at: number): void {
    if (this.run !== run) return;
    const reading: TemperatureReading = {
      funding: run.funding,
      breadth: run.breadth,
      liquidations: { ...run.window.totals(at), at, lowerBound: true },
      openInterest: run.openInterest,
    };
    run.reading = reading;
    try {
      this.deps.emit(reading);
      this.emitFailing = false;
    } catch (error) {
      // Journalisé une fois par panne : un renderer parti ne doit pas noyer le journal.
      if (!this.emitFailing) this.log(`non transmise · ${errorText(error)}`);
      this.emitFailing = true;
    }
  }

  /** Un message de la socket des liquidations : donné à la fenêtre, daté de l'horloge de l'hôte ; la lecture suit au plus une seconde après. */
  private onFrame(run: Run, raw: string): void {
    if (this.run !== run) return;
    run.window.push(raw, this.deps.now());
    if (run.flushTimer !== null) return;
    run.flushTimer = this.deps.timers.setTimeout(() => {
      run.flushTimer = null;
      this.publish(run, this.deps.now());
    }, LIQUIDATIONS_EVERY_MS);
  }

  /**
   * Une requête en échec. La porte en est informée d'abord, même quand le lancement n'est plus le courant : un 429 ou un 418
   * dit quelque chose de la venue, pas du lancement. Un 418 coupe la socket des liquidations du lancement courant, quel que
   * soit le lancement qui l'a reçu.
   */
  private failed(run: Run, source: Source, error: unknown): void {
    if (error instanceof VenueHttpError) {
      this.deps.gate.onHttpError(VENUE, error);
      if (error.status === 418) this.run?.socket?.close();
    }
    if (this.run === run) this.fail(run, source, errorText(error));
  }

  /** La panne d'une source est écrite à sa première apparition et quand sa cause change. */
  private fail(run: Run, source: Source, detail: string): void {
    if (run.failing.get(source) === detail) return;
    run.failing.set(source, detail);
    this.log(`${SOURCES[source].label} indisponible · ${detail}`);
  }

  /** Une source en panne qui répond de nouveau : une ligne. */
  private recover(run: Run, source: Source): void {
    if (run.failing.delete(source)) this.log(`${SOURCES[source].label} rétabli`);
  }

  private log(text: string): void {
    this.write(`crypto ${VENUE}: température ${text}`);
  }

  private write(line: string): void {
    try {
      this.deps.log(safeText(line, LINE_MAX));
    } catch {
      // un journal en panne ne doit pas arrêter les relevés
    }
  }
}
