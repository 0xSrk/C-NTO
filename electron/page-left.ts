/**
 * Départ de la page du desk : rechargement, navigation du cadre principal vers le desk, processus de rendu perdu. Ce que le
 * process principal tenait pour elle (abonnements de flux) n'a plus de lecteur ; la page suivante se réabonne d'elle-même.
 * Une ancre dans le même document, un cadre secondaire ou une navigation que le desk refuse ne comptent pas.
 */

/** Ce que `onPageLeft` lit d'un `webContents` : deux de ses événements. */
export interface PageEvents {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/**
 * La règle de `will-navigate` de la fenêtre du desk : en développement, l'URL du serveur Vite ; sinon `index.html`, avec sa
 * requête ou son ancre. Toute autre URL (lien https d'une note ou d'une réponse de l'agent, autre fichier) est refusée.
 */
export function deskUrlAllowed(url: string, devUrl: string | undefined, indexUrl: string): boolean {
  return devUrl ? sameOrigin(url, devUrl) : url === indexUrl || url.startsWith(`${indexUrl}#`) || url.startsWith(`${indexUrl}?`);
}

/**
 * Même origine que le serveur de développement (schéma, hôte, port), sans identifiants : un préfixe de chaîne laissait
 * passer `http://127.0.0.1:5173@ailleurs/` ou le port 51730, et `did-navigate` y aurait rouvert « Coller ».
 */
function sameOrigin(url: string, base: string): boolean {
  try {
    const target = new URL(url);
    return target.origin !== 'null' && target.origin === new URL(base).origin && !target.username && !target.password;
  } catch {
    return false;
  }
}

/**
 * Appelle `release` au début de chaque navigation du cadre principal vers un autre document que `allowed` laisse passer (le
 * rechargement compris), et à `render-process-gone`. Electron émet `did-start-navigation` avant `will-navigate` : une
 * navigation que le desk refuse ensuite (`allowed` faux) laisse la page en place, ses abonnements avec elle. Lu au début de
 * la navigation : la page suivante n'a encore rien demandé, aucun de ses abonnements ne peut être fermé. Un `release` qui
 * lève est ignoré : il n'arrête ni la navigation ni les autres écouteurs.
 */
export function onPageLeft(contents: PageEvents, allowed: (url: string) => boolean, release: () => void): void {
  const safeRelease = (): void => {
    try {
      release();
    } catch {
      // la page part quand même ; la suivante se réabonne
    }
  };
  contents.on('did-start-navigation', (details: unknown) => {
    const nav =
      typeof details === 'object' && details !== null ? (details as { isMainFrame?: unknown; isSameDocument?: unknown; url?: unknown }) : null;
    if (nav?.isMainFrame !== true || nav.isSameDocument === true || typeof nav.url !== 'string') return;
    if (allowed(nav.url)) safeRelease();
  });
  contents.on('render-process-gone', safeRelease);
}
