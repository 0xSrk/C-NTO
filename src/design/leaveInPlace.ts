/**
 * Une surcouche que son appelant démonte sort comme elle est entrée (POL2.3) : sa dernière image, figée, inerte et muette,
 * prend sa place le temps de l'animation que sa feuille pose sur `[data-leaving]`, puis part. À appeler au démontage, dans
 * le nettoyage d'un effet de mise en page : React n'a pas encore retiré le nœud. La répétition des effets de StrictMode,
 * qui ne retire rien, ne laisse aucune image ; sans animation en cours (mouvement réduit, jsdom sans `getAnimations`), rien
 * ne reste.
 */
export function leaveInPlace(node: HTMLElement | null): void {
  const parent = node?.parentNode;
  if (!node || !parent || typeof node.getAnimations !== 'function') return;
  const ghost = node.cloneNode(true) as HTMLElement;
  const from = [node, ...node.querySelectorAll('*')];
  const to = [ghost, ...ghost.querySelectorAll('*')];
  // Ce que le clone ne reprend pas : le défilement, le choix d'une liste déroulante.
  const scrolled = from.flatMap((el, i) => (el.scrollTop || el.scrollLeft ? [{ i, top: el.scrollTop, left: el.scrollLeft }] : []));
  const chosen = from.flatMap((el, i) => (el instanceof HTMLSelectElement ? [{ i, index: el.selectedIndex }] : []));
  // Pour le châssis et les lecteurs d'écran, la surcouche est partie : ni dialogue, ni identifiant, ni nom de champ en
  // double (un bouton radio coché, inséré, décocherait son voisin du même nom).
  for (const el of to) {
    if (/^(alert)?dialog$/.test(el.getAttribute('role') ?? '')) el.removeAttribute('role');
    el.removeAttribute('aria-modal');
    if (el instanceof HTMLElement) for (const attr of ['id', 'name', 'autofocus']) el.removeAttribute(attr);
  }
  ghost.setAttribute('data-leaving', '');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  parent.insertBefore(ghost, node);
  queueMicrotask(() => {
    if (node.isConnected) return void ghost.remove();
    scrolled.forEach(({ i, top, left }) => {
      const el = to[i];
      if (el) Object.assign(el, { scrollTop: top, scrollLeft: left });
    });
    chosen.forEach(({ i, index }) => {
      const el = to[i];
      if (el instanceof HTMLSelectElement) el.selectedIndex = index;
    });
    const running = ghost.getAnimations().filter((animation) => animation.playState === 'running');
    const remove = () => ghost.remove();
    if (running.length === 0) remove();
    else void Promise.all(running.map((animation) => animation.finished)).then(remove, remove);
  });
}
