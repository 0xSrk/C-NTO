/** L'opacité où en est une surcouche, si elle est en chemin (ni 0 ni 1) ; sinon rien. */
export function opacityInFlight(el: Element | null): number | null {
  if (!el || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return null;
  const value = Number.parseFloat(window.getComputedStyle(el).opacity);
  return Number.isFinite(value) && value > 0 && value < 1 ? Math.round(value * 1000) / 1000 : null;
}

const LIGHT = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'textShadow', 'outlineColor', 'outlineStyle', 'outlineWidth', 'outlineOffset'] as const;

/** La lumière d'un élément que tient le pointeur ou le focus clavier ; rien pour les autres. */
function lightOf(el: Element): Partial<Record<(typeof LIGHT)[number], string>> | null {
  let held = false;
  try {
    held = el.matches(':hover') || el.matches(':focus-visible');
  } catch {
    held = false;
  }
  if (!held) return null;
  const style = window.getComputedStyle(el);
  return Object.fromEntries(LIGHT.map((key) => [key, style[key]]).filter(([, value]) => Boolean(value)));
}

/**
 * Une surcouche que son appelant démonte sort comme elle est entrée (POL2.3) : sa dernière image, figée, inerte et muette,
 * prend sa place le temps de l'animation que sa feuille pose sur `[data-leaving]`, puis part. À appeler au démontage, dans
 * le nettoyage d'un effet de mise en page : React n'a pas encore retiré le nœud. La répétition des effets de StrictMode,
 * qui ne retire rien, ne laisse aucune image ; sans animation en cours (mouvement réduit, jsdom sans `getAnimations`), rien
 * ne reste. L'image est bien la dernière (POL2.3a) : fermée pendant son entrée, elle part de l'opacité où la surcouche en
 * est (`--leave-from`, que sa feuille lit) ; le bouton survolé ou au focus garde sa lumière, que le clone, ni survolé ni
 * au focus, perdrait — les seules propriétés de lumière (DESIGN.md § 00), recopiées en ligne.
 */
export function leaveInPlace(node: HTMLElement | null): void {
  const parent = node?.parentNode;
  if (!node || !parent || typeof node.getAnimations !== 'function') return;
  const ghost = node.cloneNode(true) as HTMLElement;
  const from = [node, ...node.querySelectorAll('*')];
  const to = [ghost, ...ghost.querySelectorAll('*')];
  // Lu sur le nœud vivant, avant qu'il ne parte : l'opacité de son entrée, la lumière de ce que tient le pointeur.
  const at = opacityInFlight(node);
  if (at !== null) ghost.style.setProperty('--leave-from', String(at));
  from.forEach((el, i) => {
    const light = lightOf(el);
    const target = to[i];
    if (light && target instanceof HTMLElement) Object.assign(target.style, light);
  });
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
