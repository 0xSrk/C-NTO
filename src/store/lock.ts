/**
 * Verrou coopératif du journal : sérialise les écritures séances/trades (import CSV manuel, pont
 * NinjaTrader, restauration de coffre) pour qu'aucune ne lise un état déjà périmé au moment d'écrire.
 * Module minimal sans dépendance : `db.ts` et `journal.ts` peuvent l'importer sans cycle.
 */
let chain: Promise<unknown> = Promise.resolve();
let depth = 0;

export function withJournalLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    depth++;
    try {
      return await fn();
    } finally {
      depth--;
    }
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

/** Vrai tant qu'une section verrouillée s'exécute. */
export function journalBusy(): boolean {
  return depth > 0;
}
