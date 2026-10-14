/**
 * Départ de la page du desk : rechargement, navigation du cadre principal vers un autre document, processus de rendu
 * perdu. Ce que le process principal tenait pour elle (abonnements de flux) n'a plus de lecteur ; la page suivante se
 * réabonne d'elle-même. Une ancre dans le même document ou un cadre secondaire ne comptent pas.
 */

/** Ce que `onPageLeft` lit d'un `webContents` : deux de ses événements. */
export interface PageEvents {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/**
 * Appelle `release` au début de chaque navigation du cadre principal vers un autre document (le rechargement compris) et à
 * `render-process-gone`. Lu au début de la navigation : la page suivante n'a encore rien demandé, aucun de ses abonnements
 * ne peut être fermé. Un `release` qui lève est ignoré : il n'arrête ni la navigation ni les autres écouteurs.
 */
export function onPageLeft(contents: PageEvents, release: () => void): void {
  const safeRelease = (): void => {
    try {
      release();
    } catch {
      // la page part quand même ; la suivante se réabonne
    }
  };
  contents.on('did-start-navigation', (details: unknown) => {
    const nav = typeof details === 'object' && details !== null ? (details as { isMainFrame?: unknown; isSameDocument?: unknown }) : null;
    if (nav?.isMainFrame === true && nav.isSameDocument !== true) safeRelease();
  });
  contents.on('render-process-gone', safeRelease);
}
