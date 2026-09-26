import { generateDemoBars } from '../../bars';
import { getInstrument } from '../../instruments';
import { dedupeBars, type HistoryRequest, type MarketDataPort } from '../port';

export interface DemoPortOptions {
  /** Nombre de séances de semaine, comme `generateDemoBars`. */
  days?: number;
  /** Graine. Défaut 42, ou l'empreinte de `endDate` si elle est fournie sans graine. */
  seed?: number;
  endDate?: string;
  startPrice?: number;
}

/** Même empreinte que l'ancien bouton « Démo » du graphique (graine 42 sans date). */
export function demoSeedFromDate(date?: string): number {
  if (!date) return 42;
  let h = 7;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Historique synthétique. Pas de flux live.
 * Le pas de prix est le `tickSize` de la fiche (`getInstrument`) : aucune constante 0,25.
 * La marche aléatoire reste un pourcentage du prix (modèle de démo, pas une spec CME) ;
 * avec NQ et la graine 42, la série est identique à `generateDemoBars()`.
 */
export function createDemoPort(options: DemoPortOptions = {}): MarketDataPort {
  let disposed = false;
  const days = options.days ?? 12;
  const seed = options.seed ?? demoSeedFromDate(options.endDate);

  return {
    sourceId: 'demo',
    capabilities: { history: true, live: [], instruments: 'any' },
    async history(req: HistoryRequest) {
      if (disposed) throw new Error('Port démo libéré');
      const spec = getInstrument(req.instrument);
      if (!(spec.tickSize > 0)) throw new Error(`Tick invalide : ${spec.symbol}`);
      const bars = generateDemoBars({
        days,
        timeframe: req.timeframe,
        seed,
        endDate: options.endDate,
        startPrice: options.startPrice,
        instrument: spec.symbol,
      });
      return dedupeBars(bars.filter((b) => b.time >= req.from && b.time <= req.to));
    },
    dispose() {
      disposed = true;
    },
  };
}
