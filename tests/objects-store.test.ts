/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityRef } from '@/engine/ontology';
import { JUMP_HISTORY_MAX, previousObject, useObjects } from '@/store/objects';
import { useUi } from '@/store/ui';

/**
 * OROS5.14 — l'objet ouvert et ses sauts, tenus par un store en mémoire (`src/store/objects.ts`, repris de d1, AF2).
 * Un saut se défait par Retour arrière, qui rend le module, sa vue, la fiche et le fil, sur 24 sauts au plus ; ↑ ↓
 * passent à l'objet voisin sans fermer ; Échap rend le focus à la ligne d'origine ; sous le verrou, rien ne répond ;
 * rien n'écrit au coffre.
 */

const S1: EntityRef = { type: 'session', id: 's1' };
const S2: EntityRef = { type: 'session', id: 's2' };
const S3: EntityRef = { type: 'session', id: 's3' };
const CPI: EntityRef = { type: 'evenement', id: 'bundle:bls:cpi' };
const ACCOUNT: EntityRef = { type: 'compte', id: 'SimApex1' };

const store = () => useObjects.getState();
const rows: HTMLElement[] = [];

/** Une ligne d'une liste du desk, qui ouvre une fiche et reçoit le focus quand elle se ferme. */
function row(name: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.textContent = name;
  document.body.append(el);
  rows.push(el);
  return el;
}

beforeEach(() => {
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'metrique' });
});

afterEach(() => {
  for (const el of rows.splice(0)) el.remove();
  vi.restoreAllMocks();
});

describe('OROS5.14 l’objet ouvert et ses sauts', () => {
  it('un saut se défait par Retour arrière : le module, la vue, la fiche et le fil reviennent', () => {
    useObjects.getState().setView('metrique', 'analyse');
    expect(store().openObject(S1, { siblings: [S1, S2] })).toBe(true);
    // une ouverture qui n'est pas un saut (une ligne) : le fil ne prétend aucun chemin, rien à défaire
    expect(store().open).toEqual(S1);
    expect(previousObject(store())).toBeNull();
    expect(store().history).toHaveLength(0);
    // un lien suivi : un saut, le fil porte l'objet d'avant
    store().openObject(CPI, { jump: true });
    expect(store().open).toEqual(CPI);
    expect(store().jumpedFrom).toEqual(S1);
    expect(previousObject(store())).toEqual(S1);
    expect(store().history).toHaveLength(1);
    // quitter la fiche pour la vue d'un module : un saut, la fiche lui cède sa place
    expect(store().jumpTo('calendrier')).toBe(true);
    expect(useUi.getState().tab).toBe('calendrier');
    expect(store().open).toBeNull();
    expect(store().history).toHaveLength(2);
    // le module change de vue de lui-même : la vue de Métrique quitte le store avec lui
    store().setView('metrique', null);
    // Retour arrière : Métrique, sa vue « analyse », la fiche du catalyseur et le fil qui vient de la séance
    expect(store().back()).toBe(true);
    expect(useUi.getState().tab).toBe('metrique');
    expect(store().views.metrique).toBe('analyse');
    expect(store().open).toEqual(CPI);
    expect(previousObject(store())).toEqual(S1);
    // encore : la séance, ouverte depuis sa ligne, sans fil
    expect(store().back()).toBe(true);
    expect(store().open).toEqual(S1);
    expect(previousObject(store())).toBeNull();
    // plus rien à défaire
    expect(store().back()).toBe(false);
    expect(store().open).toEqual(S1);
  });

  it('jumpTo pose la vue demandée, et Retour arrière rend celle d’avant ; sans vue confiée, le module reprend la sienne', () => {
    store().setView('metrique', 'bord');
    store().jumpTo('metrique', { view: 'seances' });
    expect(useUi.getState().tab).toBe('metrique');
    expect(store().views.metrique).toBe('seances');
    store().back();
    expect(store().views.metrique).toBe('bord');
    // un module qui ne confie pas sa vue : Retour arrière n'en invente pas
    useUi.setState({ tab: 'visual' });
    store().jumpTo('calendrier');
    store().back();
    expect(useUi.getState().tab).toBe('visual');
    expect('visual' in store().views).toBe(false);
  });

  it('24 sauts au plus : le plus ancien s’oublie', () => {
    expect(JUMP_HISTORY_MAX).toBe(24);
    for (let i = 0; i < 30; i++) store().openObject({ type: 'trade', id: `t${i}` }, { jump: true });
    expect(store().history).toHaveLength(24);
    // le plus ancien gardé est l'état d'avant le septième saut : la fiche du sixième trade
    expect(store().history[0]!.open).toEqual({ type: 'trade', id: 't5' });
    let n = 0;
    while (store().back()) n++;
    expect(n).toBe(24);
    expect(store().open).toEqual({ type: 'trade', id: 't5' });
  });

  it('rouvrir l’objet déjà ouvert n’est pas un saut', () => {
    store().openObject(S1, { jump: true });
    store().openObject(S1, { jump: true });
    expect(store().history).toHaveLength(1);
    expect(store().jumpedFrom).toBeNull();
  });

  it('↑ ↓ passent à l’objet voisin de la liste d’origine sans fermer ; aux bords, rien', () => {
    const list = [S1, S2, S3];
    store().openObject(S2, { siblings: list });
    expect(store().step(1)).toEqual(S3);
    expect(store().open).toEqual(S3);
    expect(store().step(1)).toBeNull();
    expect(store().open).toEqual(S3);
    expect(store().step(-1)).toEqual(S2);
    expect(store().step(-1)).toEqual(S1);
    expect(store().step(-1)).toBeNull();
    expect(store().open).toEqual(S1);
    // ↑ ↓ ne sont pas des sauts : rien à défaire, aucun fil
    expect(store().history).toHaveLength(0);
    expect(store().jumpedFrom).toBeNull();
    // un saut quitte la liste : ↑ ↓ n'ont plus de voisin
    store().openObject(CPI, { jump: true });
    expect(store().step(1)).toBeNull();
    // Retour arrière rend la liste avec la fiche
    store().back();
    expect(store().open).toEqual(S1);
    expect(store().step(1)).toEqual(S2);
  });

  it('Échap rend le focus à la ligne d’origine, même après un saut ; une ligne retirée entre-temps ne le reçoit pas', () => {
    const first = row('14.10 · Apex-PA-50K');
    const elsewhere = row('ailleurs');
    first.focus();
    store().openObject(S1, { origin: first, siblings: [S1] });
    elsewhere.focus();
    // le saut garde la ligne d'où tout est parti
    store().openObject(CPI, { jump: true });
    expect(store().close()).toBe(true);
    expect(store().open).toBeNull();
    expect(document.activeElement).toBe(first);
    // fermer sans rendre le focus
    store().openObject(S2, { origin: first });
    elsewhere.focus();
    store().close(false);
    expect(document.activeElement).toBe(elsewhere);
    // la ligne a disparu (la liste a changé) : le focus ne va pas dans le vide
    const gone = row('retirée');
    store().openObject(S3, { origin: gone });
    gone.remove();
    elsewhere.focus();
    store().close();
    expect(document.activeElement).toBe(elsewhere);
    // ↑ ↓ peuvent déplacer la ligne d'origine : Échap rend le focus à la ligne du voisin
    const a = row('a');
    const b = row('b');
    store().openObject(S1, { origin: a, siblings: [S1, S2] });
    store().step(1, b);
    store().close();
    expect(document.activeElement).toBe(b);
  });

  it('une ouverture sans ligne (l’omnibar) demande le focus pour la fiche', () => {
    const before = store().focusStamp;
    store().openObject(ACCOUNT, { jump: true, focus: true });
    expect(store().focusStamp).toBe(before + 1);
    store().openObject(S1, { siblings: [S1] });
    expect(store().focusStamp).toBe(before + 1);
  });

  it('sous le verrou, rien ne répond : ni ouverture, ni voisin, ni saut, ni Retour arrière, ni fermeture', () => {
    const origin = row('origine');
    const elsewhere = row('ailleurs');
    store().openObject(S1, { origin, siblings: [S1, S2] });
    store().openObject(CPI, { jump: true });
    const before = { open: store().open, history: store().history, stamp: store().stamp };
    store().setLocked(true);
    expect(store().locked).toBe(true);
    elsewhere.focus();
    expect(store().openObject(ACCOUNT, { jump: true, focus: true })).toBe(false);
    expect(store().step(1)).toBeNull();
    expect(store().jumpTo('visual')).toBe(false);
    expect(store().back()).toBe(false);
    expect(store().close()).toBe(false);
    expect(useUi.getState().tab).toBe('metrique');
    expect(store().open).toEqual(before.open);
    expect(store().history).toBe(before.history);
    expect(store().stamp).toBe(before.stamp);
    expect(document.activeElement).toBe(elsewhere);
    // le verrou passé, tout répond à nouveau
    store().setLocked(false);
    expect(store().back()).toBe(true);
    expect(store().open).toEqual(S1);
  });

  it('rien n’écrit au coffre : le store ne lit ni n’écrit le coffre, le stockage du navigateur ni le process principal', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    store().openObject(S1, { siblings: [S1, S2] });
    store().step(1);
    store().openObject(CPI, { jump: true, focus: true });
    store().jumpTo('calendrier', { view: 'mois' });
    store().back();
    store().close();
    store().setView('metrique', 'seances');
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    const src = readFileSync('src/store/objects.ts', 'utf8');
    const imports = [...src.matchAll(/^import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./ui', '@/engine/ontology/schema', 'zustand']);
    // Le code seul, commentaires ôtés : ni coffre, ni stockage, ni process principal, ni persistance.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bdb\b|indexedDB|localStorage|sessionStorage|\bdesk\b|window\.canto|persist\(/);
  });
});
