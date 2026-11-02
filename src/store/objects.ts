import { create } from 'zustand';
import { entityKey, type EntityRef, type EntityType, type Predicate } from '@/engine/ontology/schema';
import { useUi, type TabId } from './ui';

/**
 * L'objet ouvert et ses sauts (OROS5.14, Système 5 « Fiche et Frise » ; repris du prototype d1, AF2). La fiche du châssis
 * lit l'objet ouvert ; l'omnibar, les liens de la fiche et les lignes des modules l'ouvrent.
 *
 * - Un saut (un lien suivi, l'omnibar, la vue d'un module) se défait par Retour arrière, qui rend le module, sa vue, la
 *   fiche et le fil d'Ariane (l'objet d'où l'on avait sauté), sur `JUMP_HISTORY_MAX` sauts au plus.
 * - ↑ ↓ passent à l'objet voisin de la liste d'où vient la fiche, sans la fermer ; ce n'est pas un saut.
 * - Échap ferme la fiche et rend le focus à la ligne d'origine, celle de la première ouverture, saut après saut.
 * - Sous le verrou (le châssis inerte), rien ne répond.
 *
 * En mémoire seulement : rien n'est persisté, rien n'écrit au coffre ni au process principal.
 */

/** Retour arrière défait au plus vingt-quatre sauts ; le plus ancien s'oublie. */
export const JUMP_HISTORY_MAX = 24;

/**
 * Une étape du chemin d'un « Autour de… » (OROS5.31) : un nœud (l'objet d'où l'on part, puis chaque ensemble), ou
 * l'arête du prédicat suivi, dans son sens. Le chemin s'écrit dans l'ordre du saut et finit sur l'ensemble affiché.
 */
export type PathStep =
  | { kind: 'node'; type: EntityType; count: number; ref?: EntityRef }
  | { kind: 'edge'; predicate: Predicate; side: 'out' | 'in'; note?: string };

/** L'ensemble qu'affiche un « Autour de… » : les objets d'un même type, atteints depuis `from` par le chemin. */
export interface ObjectSet {
  /** L'objet de la fiche d'où partent les sauts. */
  from: EntityRef;
  path: readonly PathStep[];
  type: EntityType;
  members: readonly EntityRef[];
}

/** Ce que Retour arrière rend : le module, sa vue, la fiche, le fil, l'ensemble d'« Autour de… », et la liste où ↑ ↓ reprennent. */
export interface JumpSnapshot {
  tab: TabId;
  /** La vue que le module avait confiée au store (un sous-onglet), `null` s'il n'en confie aucune. */
  view: string | null;
  open: EntityRef | null;
  jumpedFrom: EntityRef | null;
  siblings: readonly EntityRef[];
  /** L'ensemble d'« Autour de… » affiché avant le saut (OROS5.31) ; absent ou `null` : sans ensemble. */
  set?: ObjectSet | null;
}

export interface OpenOptions {
  /** L'élément qui ouvre la fiche : Échap lui rend le focus. Un saut garde celui de la première ouverture. */
  origin?: HTMLElement | null;
  /** La liste d'où vient l'objet, dans son ordre : ↑ ↓ y passent au voisin. Un saut la quitte. */
  siblings?: readonly EntityRef[];
  /** Un saut : Retour arrière le défait, et le fil porte l'objet d'avant. */
  jump?: boolean;
  /** Le focus passe à la fiche : une ouverture sans ligne d'origine (l'omnibar). */
  focus?: boolean;
}

export interface ObjectsState {
  /** L'objet ouvert dans la fiche, un `EntityRef` de l'ontologie ; `null` : la fiche est fermée. */
  open: EntityRef | null;
  /**
   * L'objet d'où l'on a sauté pour ouvrir l'objet ouvert : le fil d'Ariane le porte. Nul après une ouverture qui n'est
   * pas un saut (une ligne, ↑ ↓) : le fil ne prétend aucun chemin.
   */
  jumpedFrom: EntityRef | null;
  /** La ligne d'où la fiche a été ouverte : Échap lui rend le focus. */
  origin: HTMLElement | null;
  /** La liste d'où vient l'objet ouvert, dans son ordre. */
  siblings: readonly EntityRef[];
  /** Les sauts à défaire, du plus ancien au plus récent. */
  history: readonly JumpSnapshot[];
  /** La vue que chaque module confie au store, par onglet : Retour arrière la rend avec lui. */
  views: Readonly<Partial<Record<TabId, string>>>;
  /** Le verrou : tant que le châssis est inerte, aucune action ne répond. Le châssis le règle. */
  locked: boolean;
  /** Chaque changement de l'objet ouvert : la fiche s'y règle (la transition d'entrée, le défilement). */
  stamp: number;
  /** Chaque demande de focus pour la fiche (une ouverture sans ligne d'origine). */
  focusStamp: number;
  /** L'omnibar (Ctrl+J) est ouverte : elle ne fait que naviguer (OROS5.17). */
  omnibar: boolean;
  /** L'ensemble qu'« Autour de… » affiche dans la fiche de son objet (OROS5.31) ; `null` sans ensemble. */
  set: ObjectSet | null;
  /** Affiche un ensemble d'« Autour de… » : un saut, que Retour arrière défait ; rend `false` sous le verrou. */
  openSet: (set: ObjectSet) => boolean;
  /** Retire l'ensemble affiché, sans saut. */
  clearSet: () => void;
  /** Ouvre un objet ; rend `false` sous le verrou. */
  openObject: (ref: EntityRef, opts?: OpenOptions) => boolean;
  /** Remplace l'objet ouvert par son voisin de liste (↑ ↓), sans fermer ; `null` au bord, sans liste ou sous le verrou. */
  step: (delta: 1 | -1, origin?: HTMLElement | null) => EntityRef | null;
  /** Ferme la fiche et, par défaut, rend le focus à la ligne d'origine ; `false` s'il n'y avait rien à fermer. */
  close: (restoreFocus?: boolean) => boolean;
  /** Quitte la fiche pour la vue d'un module (le jour au Calendrier…) : un saut, que Retour arrière défait. */
  jumpTo: (tab: TabId, opts?: { view?: string }) => boolean;
  /** Défait le dernier saut ; `false` s'il n'y en a pas, ou sous le verrou. */
  back: () => boolean;
  /** La vue d'un module, qu'il confie au store (`null` : il la reprend). Son propre état : le verrou n'y touche pas. */
  setView: (tab: TabId, view: string | null) => void;
  /** Ouvre ou ferme l'omnibar ; rend `false` sous le verrou. */
  setOmnibar: (open: boolean) => boolean;
  setLocked: (locked: boolean) => void;
}

/** Deux références du même objet. */
export function sameRef(a: EntityRef | null | undefined, b: EntityRef | null | undefined): boolean {
  return !!a && !!b && entityKey(a) === entityKey(b);
}

/**
 * L'objet d'avant que porte le fil d'Ariane : celui d'où l'on a sauté pour ouvrir l'objet ouvert, s'il en diffère.
 * Rien quand l'objet a été ouvert sans saut.
 */
export function previousObject(state: Pick<ObjectsState, 'open' | 'jumpedFrom'>): EntityRef | null {
  return state.open && state.jumpedFrom && !sameRef(state.open, state.jumpedFrom) ? state.jumpedFrom : null;
}

function withView(views: ObjectsState['views'], tab: TabId, view: string | null | undefined): ObjectsState['views'] {
  const next: Partial<Record<TabId, string>> = { ...views };
  if (view == null) delete next[tab];
  else next[tab] = view;
  return next;
}

export const useObjects = create<ObjectsState>((set, get) => {
  /** L'état que rendra Retour arrière, pris avant un saut. */
  const snapshot = (): JumpSnapshot => {
    const { open, jumpedFrom, siblings, views, set: shown } = get();
    const tab = useUi.getState().tab;
    return { tab, view: views[tab] ?? null, open, jumpedFrom, siblings, set: shown };
  };
  const remember = (): readonly JumpSnapshot[] => [...get().history, snapshot()].slice(-JUMP_HISTORY_MAX);

  return {
    open: null,
    jumpedFrom: null,
    origin: null,
    siblings: [],
    history: [],
    views: {},
    locked: false,
    stamp: 0,
    focusStamp: 0,
    omnibar: false,
    set: null,

    openObject(ref, opts = {}) {
      const state = get();
      if (state.locked) return false;
      const target: EntityRef = { type: ref.type, id: ref.id };
      const focusStamp = opts.focus ? state.focusStamp + 1 : state.focusStamp;
      // L'objet déjà ouvert : ni saut ni fil ; la ligne et la liste suivent la dernière ouverture.
      if (sameRef(state.open, target)) {
        set({
          origin: opts.origin !== undefined ? opts.origin : state.origin,
          siblings: opts.siblings ? [...opts.siblings] : state.siblings,
          focusStamp,
        });
        return true;
      }
      set({
        history: opts.jump ? remember() : state.history,
        open: target,
        // L'ensemble d'« Autour de… » appartient à la fiche qui l'affiche : un autre objet ouvre sans lui.
        set: null,
        jumpedFrom: opts.jump ? state.open : null,
        // Un saut garde la ligne de la première ouverture : Échap rend le focus à la ligne d'où tout est parti.
        origin: opts.origin !== undefined ? opts.origin : state.origin,
        siblings: opts.siblings ? [...opts.siblings] : opts.jump ? [] : state.siblings,
        stamp: state.stamp + 1,
        focusStamp,
      });
      return true;
    },

    step(delta, origin) {
      const { open, siblings, locked, stamp } = get();
      if (locked || !open) return null;
      const i = siblings.findIndex((ref) => sameRef(ref, open));
      const next = i < 0 ? undefined : siblings[i + delta];
      if (!next) return null;
      set({ open: next, jumpedFrom: null, set: null, stamp: stamp + 1, ...(origin !== undefined ? { origin } : {}) });
      return next;
    },

    close(restoreFocus = true) {
      const { open, origin, locked } = get();
      if (locked || !open) return false;
      set({ open: null, jumpedFrom: null, origin: null, siblings: [], set: null });
      if (restoreFocus && origin?.isConnected) origin.focus();
      return true;
    },

    jumpTo(tab, opts = {}) {
      const state = get();
      if (state.locked) return false;
      set({
        history: remember(),
        open: null,
        jumpedFrom: null,
        origin: null,
        siblings: [],
        set: null,
        views: opts.view != null ? withView(state.views, tab, opts.view) : state.views,
      });
      if (useUi.getState().tab !== tab) useUi.getState().setTab(tab);
      return true;
    },

    back() {
      const state = get();
      const last = state.history[state.history.length - 1];
      if (state.locked || !last) return false;
      set({
        history: state.history.slice(0, -1),
        open: last.open,
        jumpedFrom: last.jumpedFrom,
        siblings: last.siblings,
        set: last.set ?? null,
        views: withView(state.views, last.tab, last.view),
        stamp: state.stamp + 1,
      });
      if (useUi.getState().tab !== last.tab) useUi.getState().setTab(last.tab);
      return true;
    },

    openSet(next) {
      const state = get();
      if (state.locked) return false;
      set({ history: remember(), set: next });
      return true;
    },

    clearSet() {
      if (get().set !== null) set({ set: null });
    },

    setView(tab, view) {
      if ((get().views[tab] ?? null) === view) return;
      set({ views: withView(get().views, tab, view) });
    },

    setOmnibar(open) {
      if (get().locked) return false;
      if (get().omnibar !== open) set({ omnibar: open });
      return true;
    },

    setLocked(locked) {
      if (get().locked !== locked) set({ locked });
    },
  };
});

/**
 * La vue d'un module vit tant qu'on y reste : quitter son onglet l'oublie, comme un module qui se démonte reprend sa vue
 * par défaut. Retour arrière la rend, depuis l'état pris avant le saut ; `jumpTo` pose celle qu'il demande.
 */
useUi.subscribe((state, prev) => {
  if (state.tab === prev.tab) return;
  const { views } = useObjects.getState();
  if (views[prev.tab] !== undefined) useObjects.setState({ views: withView(views, prev.tab, null) });
});
