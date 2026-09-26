import { listInstruments } from '@/engine/instruments';
import { ONTOLOGY_WORKER_NOTES, ONTOLOGY_WORKER_TRADES, recomputeOntology, type EntityRef, type Link, type Predicate, type StructuralInput } from '@/engine/ontology';
import { linkId, unorderedPairKey } from '@/engine/ontology/schema';
import { listenWorker } from '@/lib/worker';
import { create } from 'zustand';
import { db } from './db';
import { currentOntologyGeneration, registerOntologyRunner, scheduleOntologyRecompute } from './ontology-schedule';

interface LinksState {
  ready: boolean;
  links: Link[];
  load: () => Promise<void>;
  promote: (id: string, predicate: Predicate) => Promise<void>;
  reject: (id: string) => Promise<void>;
  affirm: (from: EntityRef, to: EntityRef, predicate: Predicate) => Promise<void>;
  /** Retire un lien affirmé. Les structurels se recalculent, ils ne se suppriment pas à la main. */
  remove: (id: string) => Promise<void>;
  recompute: () => Promise<void>;
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function computeLinks(input: StructuralInput, existing: Link[], now: number): Promise<Link[]> {
  const heavy = input.notes.length > ONTOLOGY_WORKER_NOTES || input.trades.length > ONTOLOGY_WORKER_TRADES;
  if (heavy && typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('../engine/ontology/ontology.worker.ts', import.meta.url), { type: 'module' });
      const pending = listenWorker<Link[]>(worker);
      worker.postMessage({ input, existing, now });
      return await pending;
    } catch {
      return recomputeOntology(input, existing, now);
    }
  }
  return recomputeOntology(input, existing, now);
}

function withoutScore(link: Link): Link {
  const next = { ...link };
  delete next.score;
  return next;
}

export const useLinks = create<LinksState>((set, get) => ({
  ready: false,
  links: [],

  load: () =>
    enqueue(async () => {
      const links = await db.links.toArray();
      set({ links, ready: true });
    }),

  promote: (id, predicate) =>
    enqueue(async () => {
      const cur = get().links.find((l) => l.id === id) ?? (await db.links.get(id));
      if (!cur || cur.kind !== 'hypothese') return;
      const now = Date.now();
      const next = withoutScore({
        ...cur,
        predicate,
        kind: 'affirme',
        by: 'utilisateur',
        id: linkId(cur.from, predicate, cur.to),
        updatedAt: now,
      });
      const pair = unorderedPairKey(cur.from, cur.to);
      await db.transaction('rw', db.links, async () => {
        if (next.id !== cur.id) await db.links.delete(cur.id);
        const all = await db.links.toArray();
        for (const link of all) {
          if (link.id !== next.id && link.kind === 'hypothese' && unorderedPairKey(link.from, link.to) === pair) await db.links.delete(link.id);
        }
        await db.links.put(next);
      });
      set({ links: await db.links.toArray() });
    }),

  reject: (id) =>
    enqueue(async () => {
      const cur = get().links.find((l) => l.id === id) ?? (await db.links.get(id));
      if (!cur || cur.kind !== 'hypothese') return;
      const next: Link = { ...cur, kind: 'rejete', by: 'utilisateur', updatedAt: Date.now() };
      await db.links.put(next);
      set({ links: get().links.map((l) => (l.id === id ? next : l)) });
    }),

  affirm: (from, to, predicate) =>
    enqueue(async () => {
      const now = Date.now();
      const link: Link = {
        id: linkId(from, predicate, to),
        from,
        to,
        predicate,
        kind: 'affirme',
        by: 'utilisateur',
        createdAt: now,
        updatedAt: now,
      };
      const pair = unorderedPairKey(from, to);
      await db.transaction('rw', db.links, async () => {
        const all = await db.links.toArray();
        for (const row of all) {
          if (row.kind === 'hypothese' && unorderedPairKey(row.from, row.to) === pair) await db.links.delete(row.id);
        }
        await db.links.put(link);
      });
      set({ links: await db.links.toArray() });
    }),

  remove: (id) =>
    enqueue(async () => {
      const cur = get().links.find((l) => l.id === id) ?? (await db.links.get(id));
      if (!cur || cur.kind !== 'affirme') return;
      await db.links.delete(id);
      set({ links: get().links.filter((l) => l.id !== id) });
    }),

  recompute: () =>
    enqueue(async () => {
      const gen = currentOntologyGeneration();
      const [notes, sessions, trades, events, existing] = await Promise.all([
        db.notes.toArray(),
        db.sessions.toArray(),
        db.trades.toArray(),
        db.calendarEvents.toArray(),
        db.links.toArray(),
      ]);
      if (gen !== currentOntologyGeneration()) return;
      const input: StructuralInput = {
        notes,
        sessions,
        trades,
        events,
        instruments: listInstruments().map((spec) => spec.symbol),
      };
      const now = Date.now();
      const next = await computeLinks(input, existing, now);
      if (gen !== currentOntologyGeneration()) return;
      await db.transaction('rw', db.links, async () => {
        const ids = new Set(next.map((l) => l.id));
        const stale = (await db.links.toArray()).filter((l) => !ids.has(l.id)).map((l) => l.id);
        if (stale.length) await db.links.bulkDelete(stale);
        if (next.length) await db.links.bulkPut(next);
      });
      if (gen !== currentOntologyGeneration()) return;
      set({ links: next, ready: true });
    }),
}));

registerOntologyRunner(() => {
  void useLinks.getState().recompute();
});

export { scheduleOntologyRecompute };
