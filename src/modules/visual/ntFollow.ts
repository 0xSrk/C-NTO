/**
 * Visual suit l'instrument affiché sur le pont : historique, puis direct.
 * Le changement d'instrument ou d'unité lâche l'abonnement précédent. L'arrêt aussi.
 * L'agent n'appelle pas ce module.
 */

import type { Bar } from '@/engine/bars';
import type { FeedEvent, SubscribeRequest } from '@/engine/marketdata';

export interface FollowPort {
  history?(req: { instrument: string; timeframe: number; from: number; to: number }): Promise<Bar[]>;
  subscribe?(req: SubscribeRequest, onEvent: (event: FeedEvent) => void): () => void;
  dispose(): void;
}

export interface NtFollow {
  retarget(instrument: string, timeframe: number): void;
  stop(): void;
}

export function followNt(port: FollowPort, instrument: string, timeframe: number, onHistory: (bars: Bar[]) => void, onEvent?: (event: FeedEvent) => void): NtFollow {
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
        bars = port.history ? await port.history({ instrument: nextInstrument, timeframe: nextTimeframe, from: 0, to: Number.MAX_SAFE_INTEGER }) : [];
      } catch {
        return;
      }
      if (gen !== generation) return;
      onHistory(bars);
      if (!port.subscribe || gen !== generation) return;
      unsub = port.subscribe({ instrument: nextInstrument, kind: 'bars', timeframe: nextTimeframe }, (event) => onEvent?.(event));
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
