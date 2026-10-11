/**
 * L'évaluation des alertes de l'onglet crypto, côté renderer (`docs/ONGLET-CRYPTO.md` § 8). Elle tourne quel que soit l'onglet
 * ouvert : elle est nourrie par le store (`./crypto`), que le flux léger (`./cryptoLive`, permanent dès que l'interrupteur est
 * allumé) remplit de tickers et de lectures de la température, jamais par un composant.
 *
 * - `CryptoAlertRunner` tient une `CrossWatch` par alerte armée et dit quelles alertes un prix ou une lecture franchit. Il ne
 *   sait ni l'heure ni le store : l'appelant lui dit si la donnée est fraîche.
 * - `startAlertRunner` le branche sur le store (`syncFlows`, `./crypto`) : à chaque changement des alertes, des tickers ou de la
 *   température, il évalue ce qui a changé, puis signale chaque franchissement d'un toast `warn` et d'un événement `crypto_alert`
 *   (journal du desk, lu par `desk_events`, diffusé par l'orchestrateur) et enregistre l'état de l'alerte.
 */
import { alertDirection, alertEvaluability, alertValue, CrossWatch, hysteresisBand, roundAlertValue, type CryptoAlert, type EvaluabilityData } from '@/engine/crypto/alerts';
import { CHARTABLE_MARKETS, type CryptoTicker } from '@/engine/crypto/markets';
import type { TemperatureReading } from '@/engine/crypto/temperature';
import { tr } from '@/i18n';
import { alertKindText, alertLevelText, alertTargetText } from '@/lib/cryptoAlertText';
import { logLine } from '@/lib/log';
import { useCrypto, type CryptoState } from './crypto';
import { recordDeskEvent } from './deskEvents';
import { useUi } from './ui';

/**
 * La fraîcheur de la donnée : un booléen pour toute la donnée, ou une fonction par alerte. Une lecture de température n'a pas
 * un âge mais trois (funding et liquidations, largeur), et chaque genre lit la sienne : `alertEvaluability` dit alerte par alerte.
 */
export type Fresh = boolean | ((alert: CryptoAlert) => boolean);

/** Une alerte armée et sa veille. */
interface Watch {
  /** Ce qui définit la veille : une alerte dont l'un de ces champs change repart d'une première lecture. */
  key: string;
  /** La dernière copie de l'alerte rangée dans le store (état, `lastTriggeredAt`), rendue telle quelle quand elle franchit. */
  alert: CryptoAlert;
  cross: CrossWatch;
  /** Une alerte `once` signalée ne l'est plus tant que le store ne l'a pas passée à `triggered` : l'enregistrement peut tarder ou échouer. */
  spent: boolean;
}

/** Le niveau, le genre, le mode et la cible font la veille ; l'état et `lastTriggeredAt` ne la changent pas. */
const watchKey = (alert: CryptoAlert): string => `${alert.target}|${alert.kind}|${alert.level}|${alert.mode}`;

export class CryptoAlertRunner {
  private readonly watches = new Map<string, Watch>();

  /**
   * Accorde les veilles aux alertes du store : une `CrossWatch` par alerte armée, gardée d'un appel à l'autre ; celle d'une alerte dont
   * le niveau, le genre, le mode ou la cible a changé est remplacée (première lecture neuve) ; celle d'une alerte supprimée, en pause
   * ou déclenchée est abandonnée.
   */
  sync(alerts: readonly CryptoAlert[]): void {
    const armed = new Set<string>();
    for (const alert of alerts) {
      if (alert.state !== 'armed') continue;
      armed.add(alert.id);
      const key = watchKey(alert);
      const current = this.watches.get(alert.id);
      if (current?.key === key) {
        current.alert = alert;
        continue;
      }
      this.watches.set(alert.id, { key, alert, cross: new CrossWatch(alertDirection(alert.kind), alert.level, hysteresisBand(alert.kind, alert.level)), spent: false });
    }
    for (const id of [...this.watches.keys()]) if (!armed.has(id)) this.watches.delete(id);
  }

  /** Les alertes de prix de ce marché que ce ticker franchit. Un prix n'est évalué que sur le ticker de son marché. */
  onTicker(t: CryptoTicker, fresh: Fresh): CryptoAlert[] {
    return this.evaluate((alert) => alert.target === t.market, { tickers: { [t.market]: t }, temperature: null }, fresh);
  }

  /** Les alertes de température que cette lecture franchit. */
  onTemperature(r: TemperatureReading, fresh: Fresh): CryptoAlert[] {
    return this.evaluate((alert) => alert.target === 'temperature', { tickers: {}, temperature: r }, fresh);
  }

  /**
   * Un pas de chaque veille voulue dont la donnée est fraîche et lisible. Une alerte non fraîche n'est pas évaluée : ni franchissement,
   * ni côté posé. `once` passe à « signalée » en franchissant ; `rearm` ne franchit de nouveau qu'après la bande d'hystérésis.
   */
  private evaluate(wanted: (alert: CryptoAlert) => boolean, data: Parameters<typeof alertValue>[1], fresh: Fresh): CryptoAlert[] {
    const crossed: CryptoAlert[] = [];
    for (const watch of this.watches.values()) {
      const { alert } = watch;
      if (watch.spent || !wanted(alert)) continue;
      if (!(typeof fresh === 'function' ? fresh(alert) : fresh)) continue;
      const value = alertValue(alert, data);
      if (value === null || !watch.cross.step(value)) continue;
      if (alert.mode === 'once') watch.spent = true;
      crossed.push(alert);
    }
    return crossed;
  }
}

// --- Le signal ---------------------------------------------------------------------------------------------------------

/** « Alerte crypto · BTC-USD · Coinbase : Prix au-dessus de 85 000,00 USD (valeur 85 100,00 USD). » Le niveau et la valeur dans l'unité de l'alerte. */
function toastText(alert: CryptoAlert, value: number | null): string {
  const target = alertTargetText(alert.target);
  const kind = alertKindText(alert.kind);
  const level = alertLevelText(alert);
  const seen = value === null ? '—' : alertLevelText({ ...alert, level: value });
  return tr(
    `Alerte crypto · ${target} : ${kind} ${level} (valeur ${seen}).`,
    `Crypto alert · ${target}: ${kind} ${level} (value ${seen}).`,
    `Alerta cripto · ${target}: ${kind} ${level} (valor ${seen}).`,
  );
}

const saveFailedText = (): string =>
  tr(
    'Alerte crypto déclenchée, mais la base du desk a refusé l’enregistrement de son état.',
    'Crypto alert fired, but the desk database refused to save its state.',
    'Alerta cripto disparada, pero la base del desk rechazó guardar su estado.',
  );

/**
 * Signale un franchissement : le toast et l'événement d'abord (un franchissement est signalé une fois, quoi qu'il advienne de
 * l'enregistrement), puis l'état. La valeur de l'événement est arrondie à la précision affichée (`roundAlertValue`). `once` passe
 * à `triggered`, `rearm` reste `armed` avec `lastTriggeredAt` ; `now` est l'instant du franchissement. Un refus de la base devient
 * un toast `warn`, jamais un rejet non géré.
 */
function signal(alert: CryptoAlert, value: number | null, now: number): void {
  useUi.getState().toast(toastText(alert, value), 'warn');
  // L'agent lit la valeur par `desk_events` : à la précision affichée, sans bruit de flottant.
  recordDeskEvent('crypto_alert', { alertId: alert.id, target: alert.target, kind: alert.kind, level: alert.level, value: roundAlertValue(alert, value), author: alert.author });
  useCrypto
    .getState()
    .setAlertState(alert.id, alert.mode === 'once' ? 'triggered' : 'armed', now)
    .catch(() => useUi.getState().toast(saveFailedText(), 'warn'));
}

/** Une erreur dans le journal technique du desk : une alerte qui échoue ne casse ni les autres écoutes du store ni les autres alertes. */
function logFailure(error: unknown): void {
  logLine('error', `alertes crypto : ${error instanceof Error ? error.message : String(error)}`);
}

/**
 * Évalue ce qui a changé entre `prev` et `state` : les alertes (veilles accordées, puis tout ce qui est déjà là est lu, ce qui pose
 * le côté d'une alerte neuve sur le dernier prix), chaque ticker neuf, la lecture de température neuve. La fraîcheur est celle de
 * `alertEvaluability`, la règle de l'écran. Les franchissements sont tous relevés avant d'être signalés : l'enregistrement d'un état
 * réécrit les alertes et rappelle cette écoute, qui ne doit pas voir un pas à moitié fait.
 */
function feed(runner: CryptoAlertRunner, state: CryptoState, prev: CryptoState | null): void {
  const alertsChanged = prev === null || state.alerts !== prev.alerts;
  if (alertsChanged) runner.sync(state.alerts);
  const tickers = CHARTABLE_MARKETS.flatMap((market) => {
    const ticker = state.tickers[market];
    return ticker && (alertsChanged || ticker !== prev?.tickers[market]) ? [ticker] : [];
  });
  const reading = state.temperature && (alertsChanged || state.temperature !== prev?.temperature) ? state.temperature : null;
  // Les bougies du chart réécrivent l'état à chaque message : rien de neuf pour les alertes, rien à faire.
  if (tickers.length === 0 && !reading) return;
  const now = Date.now();
  const data: EvaluabilityData = { venues: state.venues, tickers: state.tickers, temperature: state.temperature, now };
  const fresh = (alert: CryptoAlert) => alertEvaluability(alert, data).ok;
  const crossed: CryptoAlert[] = tickers.flatMap((ticker) => runner.onTicker(ticker, fresh));
  if (reading) crossed.push(...runner.onTemperature(reading, fresh));
  for (const alert of crossed) {
    try {
      signal(alert, alertValue(alert, state), now);
    } catch (error) {
      logFailure(error);
    }
  }
}

/**
 * Branche l'évaluation sur le store tant que le module est allumé (`syncFlows`, `./crypto`) : une première lecture de l'état, puis
 * chaque changement. Rend l'arrêt, idempotent. Ne change pas l'état à l'appel, hors l'enregistrement d'un franchissement.
 */
export function startAlertRunner(): () => void {
  const runner = new CryptoAlertRunner();
  const run = (state: CryptoState, prev: CryptoState | null) => {
    try {
      feed(runner, state, prev);
    } catch (error) {
      logFailure(error);
    }
  };
  const stop = useCrypto.subscribe(run);
  run(useCrypto.getState(), null);
  return stop;
}
