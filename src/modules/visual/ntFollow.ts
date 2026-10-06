/**
 * Visual suit un contrat sur le pont : historique borné, puis direct.
 * L'AddOn 2.2.0 lit `from` et `to` en secondes epoch (`FromUnixSeconds`, soit `DateTime.AddSeconds`) :
 * une borne hors de `DateTime` fait échouer la requête. La fenêtre est donc finie : cinq jours jusqu'à maintenant.
 * Le changement d'instrument ou d'unité lâche l'abonnement précédent. L'arrêt aussi.
 * Un échec (historique ou abonnement) est rendu à l'appelant, jamais avalé. L'agent n'appelle pas ce module.
 */

import type { Bar } from '@/engine/bars';
import type { FeedEvent, SubscribeRequest } from '@/engine/marketdata';

/** Profondeur de l'historique demandé au pont, en jours. */
export const HISTORY_DAYS = 5;

/** Fenêtre d'historique en secondes epoch, l'unité de `Bar.time` et de l'AddOn : `days` jours jusqu'à `now` (ms). */
export function historyWindow(now: number, days = HISTORY_DAYS): { from: number; to: number } {
  const to = Math.floor(now / 1000);
  return { from: to - days * 86_400, to };
}

/** Range une barre en direct : une barre de même heure est remplacée, l'ordre reste chronologique. */
export function mergeLiveBar(prev: readonly Bar[] | null, bar: Bar): Bar[] {
  const list = prev ? [...prev] : [];
  const at = list.findIndex((row) => row.time === bar.time);
  if (at >= 0) list[at] = bar;
  else list.push(bar);
  list.sort((a, b) => a.time - b.time);
  return list;
}

export interface FollowPort {
  history?(req: { instrument: string; timeframe: number; from: number; to: number }): Promise<Bar[]>;
  subscribe?(req: SubscribeRequest, onEvent: (event: FeedEvent) => void): () => void;
  dispose(): void;
}

export interface NtFollow {
  retarget(instrument: string, timeframe: number): void;
  stop(): void;
}

function failure(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function followNt(
  port: FollowPort,
  instrument: string,
  timeframe: number,
  onHistory: (bars: Bar[]) => void,
  onEvent?: (event: FeedEvent) => void,
  onError?: (detail: string) => void,
): NtFollow {
  let generation = 0;
  let unsub: (() => void) | null = null;
  let key = '';

  const arm = (nextInstrument: string, nextTimeframe: number) => {
    const next = `${nextInstrument}|${nextTimeframe}`;
    if (next === key) return;
    key = next;
    const gen = ++generation;
    unsub?.();
    unsub = null;
    void (async () => {
      let bars: Bar[] = [];
      try {
        bars = port.history ? await port.history({ instrument: nextInstrument, timeframe: nextTimeframe, ...historyWindow(Date.now()) }) : [];
      } catch (err) {
        if (gen === generation) onError?.(failure(err));
        return;
      }
      if (gen !== generation) return;
      onHistory(bars);
      if (!port.subscribe || gen !== generation) return;
      unsub = port.subscribe({ instrument: nextInstrument, kind: 'bars', timeframe: nextTimeframe }, (event) => {
        if (gen !== generation) return;
        if (event.kind === 'status' && event.state === 'error') {
          onError?.(event.detail ?? '');
          return;
        }
        onEvent?.(event);
      });
    })();
  };

  arm(instrument, timeframe);
  return {
    retarget: arm,
    stop() {
      generation += 1;
      key = '';
      unsub?.();
      unsub = null;
    },
  };
}
