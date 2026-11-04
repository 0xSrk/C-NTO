/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Le faux desk, posé avant le chargement de `@/lib/desk` : le process principal tient les ordres de l'agent et le Copieur
 * (lecture et écriture, ces dernières espionnées), la fenêtre, les deux passerelles de l'agent.
 */
const fake = vi.hoisted(() => {
  const copierListeners: ((status: unknown) => void)[] = [];
  const state = {
    orders: { enabled: false, maxQty: 1, maxPosition: 1, perMinute: 1, pending: false },
    copier: { armed: false, link: 'live', routed: 0, lastRefusal: null, flattenOnCut: true },
    writes: [] as string[],
    copierListeners,
  };
  const write = (name: string) => async () => {
    state.writes.push(name);
    return null;
  };
  const idle = { running: false, port: 0, clients: 0 };
  (window as unknown as { canto: unknown }).canto = {
    window: { onMaximized: () => () => undefined, minimize: () => undefined, toggleMaximize: () => undefined, close: () => undefined },
    agentOrders: { status: async () => ({ ...state.orders }), enable: write('agentOrders.enable'), disable: write('agentOrders.disable'), limits: write('agentOrders.limits'), propose: write('agentOrders.propose') },
    copier: {
      status: async () => ({ ...state.copier }),
      onStatus: (cb: (status: unknown) => void) => {
        copierListeners.push(cb);
        return () => undefined;
      },
      arm: write('copier.arm'),
      cut: write('copier.cut'),
      configure: write('copier.configure'),
    },
    orchestrator: { start: async () => idle, stop: async () => idle, status: async () => idle, rotateToken: async () => idle, copyToken: async () => '', onRequest: () => () => undefined, respond: () => undefined, onStatus: () => () => undefined, broadcast: () => undefined },
    mcp: { start: async () => idle, stop: async () => idle, status: async () => ({ running: false, port: 0, calls: 0 }), rotateToken: async () => idle, connection: async () => ({ url: '', token: '' }), onStatus: () => () => undefined },
  };
  return state;
});

// Dexie est remplacé par une coquille, comme pour l'onglet Agent IA ; les tables utiles sont posées dans `beforeEach`.
vi.mock('dexie', () => {
  class FakeDexie {
    constructor(_name: string) {}
    version() {
      const chain = {
        stores() {
          return chain;
        },
        upgrade() {
          return chain;
        },
      };
      return chain;
    }
    on() {}
    close() {}
  }
  return { default: FakeDexie, Dexie: FakeDexie };
});
// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));
// Le tableau de bord (graphiques sur canevas) n'est pas l'objet du test.
vi.mock('@/modules/metrique/Dashboard', () => ({ Dashboard: () => null }));

import { useKillLatch } from '@/app/killState';
import { readGates, type GateInput } from '@/app/RailGates';
import { GATE_LINE_H, GATE_ROW_GAP, GATE_ROW_H, GATE_ROWS_H, railFit, railFree, REGISTRY_ROW_H } from '@/app/railFit';
import { Shell } from '@/app/Shell';
import e from '@/design/etat.module.css';
import { useI18n } from '@/i18n';
import type { NtBridgeStatus } from '@/lib/desk';
import Agent from '@/modules/agent/Agent';
import Copieur from '@/modules/copieur/Copieur';
import Metrique from '@/modules/metrique/Metrique';
import { useAgent } from '@/store/agent';
import { useAgentOrders } from '@/store/agentOrders';
import { useBridge } from '@/store/bridge';
import { useCopier } from '@/store/copier';
import { db } from '@/store/db';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/**
 * OROS5.25 — les quatre portes du process principal, en lecture, sous les cartouches du rail (décision 11) : les ordres
 * de l'agent, le Copieur, l'écriture des agents, le canal d'ordres. « Hors ligne » se distingue de « fermé jusqu'au
 * redémarrage » ; à l'étroit, `railFit` les compacte sans déplacer le compte ni le sceau ; chaque porte ouvre ce qui la
 * règle sans jamais armer ni activer, et le focus ne se pose jamais sur Armer.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

/** Le desk : le châssis et le module de l'onglet ouvert, comme `App`. */
function Desk({ inert = false }: { inert?: boolean }) {
  const tab = useUi((u) => u.tab);
  return createElement(Shell, { inert, children: tab === 'agent' ? createElement(Agent) : tab === 'copieur' ? createElement(Copieur) : tab === 'metrique' ? createElement(Metrique) : createElement('div', null, 'module') });
}
async function mount(inert = false): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(Desk, { inert })));
  return host;
}
const gate = (id: string) => host!.querySelector<HTMLButtonElement>(`[data-gate="${id}"]`)!;
/** Laisse filer les minuteries et les promesses (le module se monte, la section prend le focus). */
async function settle(ms = 400) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const status = (over: Partial<NtBridgeStatus>): NtBridgeStatus =>
  ({ link: 'live', port: 0, addonVersion: '2.2.0', ntVersion: '8.1', accounts: [], accountNames: [], heartbeatLatencyMs: 5, ordersOpen: true, ordersClosed: false, hasToken: true, extraAccounts: [], maxContractsPerOrder: 5, killSwitchShortcut: 'CommandOrControl+Shift+K', ...over }) as NtBridgeStatus;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(Date.parse('2026-10-27T15:00:00Z'));
  fake.writes.length = 0;
  fake.orders = { enabled: false, maxQty: 1, maxPosition: 1, perMinute: 1, pending: false };
  fake.copier = { armed: false, link: 'live', routed: 0, lastRefusal: null, flattenOnCut: true };
  HTMLElement.prototype.scrollTo = () => undefined;
  Object.assign(db as unknown as Record<string, unknown>, {
    settings: { get: async () => undefined, put: async () => undefined },
    agentMessages: { add: async () => undefined, where: () => ({ equals: () => ({ sortBy: async () => [] }) }) },
  });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'note', modalRequest: null, timeCursor: null, friseOpen: false });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, update: vi.fn(async () => undefined) });
  useJournal.setState({ sessions: [], trades: [] });
  useNotes.setState({ notes: [] });
  useLinks.setState({ links: [] });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useCopier.setState({ ready: true, accounts: [], load: async () => undefined });
  useAgent.setState({ messages: [], streaming: false, streamText: '', pendingTool: null, error: null, notice: null });
  useAgentOrders.setState({ status: { ...fake.orders } });
  useBridge.setState({ nt: null });
  useKillLatch.setState({ engaged: false });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  useKillLatch.setState({ engaged: false });
});

const base: GateInput = { orders: { enabled: false, maxQty: 1, maxPosition: 1, perMinute: 1, pending: false }, ordersAvailable: true, copier: { armed: false, link: 'live', routed: 0, lastRefusal: null, flattenOnCut: true }, allowWrite: false, link: 'live', ordersOpen: true, killed: false };
const states = (input: Partial<GateInput>) => Object.fromEntries(readGates({ ...base, ...input }).map((g) => [g.id, g.state]));

describe('OROS5.25 · les quatre portes du rail, en lecture', () => {
  it('états lus de useAgentOrders.status, du Copieur, d’orchestratorAllowWrite et du kill switch ; le trait vient de la table d’états', async () => {
    expect(readGates(base).map((g) => g.id)).toEqual(['agentOrders', 'copier', 'agentWrite', 'channel']);
    expect(states({})).toEqual({ agentOrders: 'off', copier: 'off', agentWrite: 'off', channel: 'open' });
    expect(states({ orders: { ...base.orders, enabled: true } }).agentOrders).toBe('open');
    expect(states({ orders: { ...base.orders, enabled: true, pending: true } }).agentOrders).toBe('pending');
    expect(states({ copier: { ...base.copier!, armed: true } }).copier).toBe('open');
    expect(states({ allowWrite: true }).agentWrite).toBe('open');
    expect(readGates(base).map((g) => g.etat)).toEqual(['eteint', 'eteint', 'eteint', 'plein']);
    expect(readGates({ ...base, orders: { ...base.orders, enabled: true, pending: true } })[0]!.etat).toBe('tirete');
    // rendues : chaque porte dit son état, en mots et par le trait de son écrou
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, orchestratorAllowWrite: true } });
    useBridge.setState({ nt: status({}) });
    fake.copier = { ...fake.copier, armed: true };
    fake.orders = { ...fake.orders, enabled: true, pending: true };
    await mount();
    await settle();
    const rendered = Object.fromEntries((['agentOrders', 'copier', 'agentWrite', 'channel'] as const).map((id) => [id, gate(id).dataset.state]));
    expect(rendered).toEqual({ agentOrders: 'pending', copier: 'open', agentWrite: 'open', channel: 'open' });
    for (const id of ['agentOrders', 'copier', 'agentWrite', 'channel']) {
      const nut = gate(id).querySelector<HTMLElement>('[data-etat]')!;
      expect(nut.classList.contains(e[nut.dataset.etat as 'plein']!), id).toBe(true);
      expect(nut.querySelector('.skg-70'), id).not.toBeNull();
    }
    expect(gate('agentOrders').getAttribute('aria-label')).toBe('Ordres de l’agent : en attente de vous — ouvre leurs réglages, dans Agent IA ; les autoriser passe par un dialogue du desk');
    // une décision attend l'opérateur : l'or (décision 1), et lui seul
    const css = cssRules(readFileSync('src/app/shell.module.css', 'utf8'));
    expect(css.find((r) => r.selector === ".gate[data-state='pending']")?.body).toMatch(/--k: var\(--gold\)/);
    expect(css.filter((r) => /^\.gate/.test(r.selector) && r.selector !== ".gate[data-state='pending']" && /--gold/.test(r.body))).toEqual([]);
    // « Registre n » ouvre le registre du lancement en tiroir bas (OROS5.38 ; tests/registre.test.ts)
    const registry = host!.querySelector<HTMLElement>('[data-registry]')!;
    expect(registry.tagName).toBe('BUTTON');
    expect([...registry.querySelectorAll('[aria-hidden]')].map((el) => el.textContent)).toEqual(['Registre', '0']);
    expect(registry.getAttribute('aria-label')).toBe('Registre du lancement : 0 événement(s), en mémoire — ouvrir le registre');
  });

  it('pont hors ligne ≠ fermé jusqu’au redémarrage', async () => {
    expect(states({ link: null }).channel).toBe('offline');
    expect(states({ link: 'lost' }).channel).toBe('offline');
    expect(states({ link: 'live', ordersOpen: false }).channel).toBe('off');
    expect(states({ killed: true })).toEqual({ agentOrders: 'closedRestart', copier: 'closedRestart', agentWrite: 'off', channel: 'closedRestart' });
    expect(states({ ordersAvailable: false, copier: null })).toMatchObject({ agentOrders: 'offline', copier: 'offline' });
    const words = (input: Partial<GateInput>) => readGates({ ...base, ...input }).find((g) => g.id === 'channel')!.word;
    expect(words({ link: null })).toBe('hors ligne');
    expect(words({ killed: true })).toBe('fermé jusqu’au redémarrage');
    expect(words({ link: null })).not.toBe(words({ killed: true }));
    // rendu : hors ligne, puis la coupure
    await mount();
    expect(gate('channel').dataset.state).toBe('offline');
    expect(gate('channel').textContent).toContain('hors ligne');
    act(() => useKillLatch.setState({ engaged: true }));
    expect(gate('channel').dataset.state).toBe('closedRestart');
    expect(gate('channel').textContent).toContain('fermé jusqu’au redémarrage');
  });

  it('railFit à 720 px, bande du kill switch comprise : la ligne d’écrous sous les cartouches, sans les faire défiler ni bouger le compte et le sceau', () => {
    // Les hauteurs du rail, recalculées de ses feuilles comme le fait tests/rail-hauteur.test.ts.
    const shell = cssRules(readFileSync('src/app/shell.module.css', 'utf8').replace(/\r\n/g, '\n'));
    const tokens = readFileSync('src/design/tokens.css', 'utf8');
    const seal = readFileSync('src/design/Seal.tsx', 'utf8');
    const COMPACT = /^@container rail \(max-height: (\d+)px\)$/;
    const value = (selector: string, prop: string, compact: boolean): string => {
      const rules = [compact ? shell.find((r) => r.selector === selector && r.at.some((at) => COMPACT.test(at))) : undefined, shell.find((r) => r.selector === selector && r.at.length === 0)];
      for (const r of rules) {
        const hit = r ? new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(r.body) : null;
        if (hit) return hit[1]!.trim();
      }
      throw new Error(`${selector} { ${prop} } introuvable`);
    };
    const px = (text: string) => Number(/^(-?[\d.]+)px$/.exec(text.split(/\s+/)[0]!)?.[1]);
    const block = (selector: string, compact: boolean) => {
      try {
        const [a, b = a] = value(selector, 'padding-block', compact).split(/\s+/);
        return px(a!) + px(b!);
      } catch {
        const parts = value(selector, 'padding', compact).split(/\s+/);
        return px(parts[0]!) + px(parts[2] ?? parts[0]!);
      }
    };
    const lh = (selector: string, fontFrom = selector) => Number(value(selector, 'line-height', false)) * px(value(fontFrom, 'font-size', false));
    const item = (lines: number, compact: boolean) => Math.max(px(value('.navItem', 'min-height', compact)), block('.navItem', compact) + lh('.navLabel', '.navItem') + (lines > 0 ? px(value('.navText', 'gap', false)) + lines * lh('.navQty') : 0));
    const nav = (lines: number[], compact: boolean) => lines.reduce((sum, n) => sum + item(n, compact), 0) + px(value('.nav', 'gap', compact)) * (lines.length - 1);
    const foot = (compact: boolean) => {
      const account = Math.max(px(value('.account', 'min-height', compact)), block('.account', compact) + lh('.accountName') + px(value('.account', 'row-gap', false)) + lh('.accountSource'));
      const [, , w, h] = /SEAL_VIEWBOX = '([^']+)'/.exec(seal)![1]!.split(' ').map(Number);
      return account + px(value('.railFoot', 'gap', compact)) + (px(value('.sealMark', 'width', false)) * h!) / w! + px(value('.signature', 'gap', false)) + px(value('.langBtn', 'height', false));
    };
    const token = (name: string) => px(new RegExp(`${name}:\\s*([\\d.]+px)`).exec(tokens)![1]!);
    const content = (windowH: number, band = 0) => windowH - token('--titlebar-h') - token('--statusbar-h') - band - block('.rail', false);
    const band = px(value('.band', 'height', false));
    const gap = px(value('.rail', 'gap', false));
    const threshold = Number(COMPACT.exec(shell.flatMap((r) => r.at).find((at) => COMPACT.test(at))!)![1]);
    const space = (windowH: number, lines: number[], withBand = false) => {
      const c = content(windowH, withBand ? band : 0);
      const compact = c <= threshold;
      return { content: c, nav: nav(lines, compact), foot: foot(compact), gap };
    };
    // Les hauteurs que railFit compte sont celles des feuilles : la porte en ligne, l'écart, le registre, la ligne d'écrous.
    expect(px(value('.gate', 'height', false))).toBe(GATE_ROW_H);
    expect(px(value('.gates', 'gap', false))).toBe(GATE_ROW_GAP);
    expect(px(value('.registry', 'height', false))).toBe(REGISTRY_ROW_H);
    expect(px(value('.gatesLine', 'height', false))).toBe(GATE_LINE_H);
    expect(px(value('.gatesLine .gate', 'height', false))).toBe(GATE_LINE_H);
    expect(px(value('.gateNut', 'height', false))).toBeLessThanOrEqual(GATE_LINE_H);
    // Chaque mot d'état tient entier sous le nom de sa porte, en trois langues : « fermés jusqu'au redémarrage » compris.
    // La colonne : le rail, moins son filet et ses marges, celles de la porte, l'écrou et l'écart ; un signe de Geist Mono
    // avance de 0,6 em, plus l'approche.
    const cascade = (selector: string, prop: string): string => {
      let found: string | undefined;
      for (const r of shell) {
        if (r.at.length > 0 || !r.selector.split(',').some((part) => part.trim() === selector)) continue;
        const hit = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(r.body);
        if (hit) found = hit[1]!.trim();
      }
      if (found === undefined) throw new Error(`${selector} { ${prop} } introuvable`);
      return found;
    };
    const railPadX = px(value('.rail', 'padding', false).split(/\s+/)[1]!);
    const gatePadX = px(value('.gate', 'padding', false).split(/\s+/)[1]!);
    const column = token('--rail-w') - px(value('.rail', 'border-right', false)) - 2 * railPadX - 2 * gatePadX - px(value('.gate', 'grid-template-columns', false)) - px(value('.gate', 'column-gap', false));
    const fontSize = px(cascade('.gateWord', 'font-size'));
    const tracking = cascade('.gateWord', 'letter-spacing');
    const advance = 0.6 * fontSize + (tracking === '0' ? 0 : Number(/^([\d.]+)em$/.exec(tracking)![1]) * fontSize);
    const inputs: Partial<GateInput>[] = [{}, { orders: { ...base.orders, enabled: true } }, { orders: { ...base.orders, enabled: true, pending: true } }, { copier: { ...base.copier!, armed: true } }, { allowWrite: true }, { link: null }, { ordersAvailable: false, copier: null }, { link: 'live', ordersOpen: false }, { killed: true }];
    for (const locale of ['fr', 'en', 'es'] as const) {
      useI18n.setState({ locale });
      const words = new Set(inputs.flatMap((input) => readGates({ ...base, ...input }).map((g) => g.word)));
      for (const word of words) expect(word.length * advance, `${locale} « ${word} » dans ${column} px`).toBeLessThanOrEqual(column);
    }
    useI18n.setState({ locale: 'fr' });
    // Neuf cartouches, comme tests/rail-hauteur.test.ts : en veille, l'orchestrateur en service (sa quantité sur deux
    // lignes), puis aussi « 128 notes · 1 472 liens » sur deux.
    const idle = [1, 0, 1, 1, 0, 1, 0, 1, 1];
    const orchestrator = [1, 0, 1, 1, 0, 2, 0, 1, 1];
    const busy = [1, 0, 1, 2, 0, 2, 0, 1, 1];
    for (const lines of [idle, orchestrator, busy]) {
      // 1180 × 720 au zoom 100 % : la ligne d'écrous tient sous les cartouches, sans les faire défiler
      expect(railFit(space(720, lines)), `720 ${lines}`).toBe('line');
      expect(railFree(space(720, lines))).toBeGreaterThanOrEqual(gap + GATE_LINE_H);
      // la bande du kill switch comprise : plus de place ; les portes s'effacent, la bande dit ce qui est fermé
      expect(railFit(space(720, lines, true)), `720 + bande ${lines}`).toBe('none');
      // 1600 × 1000 au zoom 100 % : les portes en lignes, et le registre ; avec la bande, la ligne d'écrous
      expect(railFit(space(1000, lines)), `1000 ${lines}`).toBe('rows');
      expect(railFit(space(1000, lines, true)), `1000 + bande ${lines}`).toBe('line');
    }
    expect(GATE_ROWS_H).toBeGreaterThan(GATE_LINE_H);
    // le compte et le sceau restent au pied du rail : les portes se posent entre la nav et lui, sans marge automatique
    const shellTsx = readFileSync('src/app/Shell.tsx', 'utf8');
    const rail = shellTsx.slice(shellTsx.indexOf('<aside className={s.rail}'), shellTsx.indexOf('</aside>'));
    expect(rail.indexOf('</nav>')).toBeLessThan(rail.indexOf('<RailGates />'));
    expect(rail.indexOf('<RailGates />')).toBeLessThan(rail.indexOf('<div className={s.railFoot}'));
    expect(value('.railFoot', 'margin-top', false)).toBe('auto');
    expect(shell.find((r) => r.selector === '.gates' && r.at.length === 0)?.body).not.toMatch(/margin-top: auto/);
  });

  it('chaque porte ouvre ce qui la règle, sans armer ni activer : aucune méthode d’écriture, et le focus ne se pose jamais sur Armer', async () => {
    useBridge.setState({ nt: status({}) });
    const update = vi.fn(async () => undefined);
    useSettings.setState({ update });
    const arming = /^(Armer|Autoriser…|Couper|Cut|Arm)$/;
    await mount();
    await settle();
    // les ordres de l'agent : Agent IA › Options, la section qui les règle
    act(() => gate('agentOrders').click());
    await settle();
    expect(useUi.getState().tab).toBe('agent');
    expect(host!.querySelector<HTMLElement>('#agent-panel-options')!.hidden).toBe(false);
    expect(document.activeElement).toBe(host!.querySelector('[data-gate-target="agentOrders"]'));
    expect(document.activeElement!.tagName).not.toBe('BUTTON');
    // l'écriture des agents : la passerelle MCP, sa section, jamais l'interrupteur
    act(() => gate('agentWrite').click());
    await settle();
    expect(document.activeElement).toBe(host!.querySelector('[data-gate-target="agentWrite"]'));
    // le Copieur : son titre, jamais Armer
    act(() => gate('copier').click());
    await settle();
    expect(useUi.getState().tab).toBe('copieur');
    expect(document.activeElement).toBe(host!.querySelector('main h1[data-plate="copieur"]'));
    expect(document.activeElement!.textContent).not.toMatch(/Armer/);
    // le canal d'ordres : la fenêtre du pont NinjaTrader, le focus sur Fermer
    act(() => gate('channel').click());
    await settle();
    expect(useUi.getState().tab).toBe('metrique');
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('NinjaTrader');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement!.getAttribute('aria-label')).toBe('Fermer');
    // jamais un bouton qui arme ou active ; aucune écriture
    expect(arming.test(document.activeElement!.textContent?.trim() ?? '')).toBe(false);
    expect(fake.writes).toEqual([]);
    expect(update).not.toHaveBeenCalled();
    // Retour arrière défait chaque saut
    expect(useObjects.getState().history.length).toBeGreaterThanOrEqual(4);
    // les sources : les portes lisent, elles n'appellent aucune méthode d'écriture
    const source = readFileSync('src/app/RailGates.tsx', 'utf8');
    expect(source).not.toMatch(/\.(?:enable|disable|setLimits|propose|arm|cut|configure|update|updateAgent|updateConfig|allowRealAccount|setMaxContracts)\(/);
  });

  it('depuis une autre vue d’Agent IA, le focus attend que la vue Options soit visible', async () => {
    useUi.setState({ tab: 'agent' });
    useObjects.getState().setView('agent', 'rapports');
    await mount();
    await settle();
    const section = host!.querySelector<HTMLElement>('[data-gate-target="agentOrders"]')!;
    // la section est posée, dans une vue cachée : un navigateur n'y poserait pas le focus, la porte attend qu'elle se montre
    expect(section.closest('[hidden]')).not.toBeNull();
    const hiddenAtFocus: boolean[] = [];
    const focus = section.focus.bind(section);
    section.focus = (options?: FocusOptions) => {
      hiddenAtFocus.push(section.closest('[hidden]') !== null);
      focus(options);
    };
    act(() => gate('agentOrders').click());
    await settle();
    expect(section.closest('[hidden]')).toBeNull();
    expect(hiddenAtFocus).toEqual([false]);
    expect(document.activeElement).toBe(section);
    expect(fake.writes).toEqual([]);
  });

  it('sous le verrou, aucune porte ne répond', async () => {
    await mount(true);
    act(() => gate('channel').click());
    expect(useUi.getState().tab).toBe('note');
    expect(useUi.getState().modalRequest).toBeNull();
    expect(fake.writes).toEqual([]);
  });

  it('les bandes d’Options ne redisent plus ces états : la bande d’état d’Agent IA ne dit que le modèle et les passerelles', () => {
    const agent = readFileSync('src/modules/agent/Agent.tsx', 'utf8');
    const band = agent.slice(agent.indexOf('État des services de l’agent'), agent.indexOf('</dl>'));
    expect(band).not.toMatch(/Écriture des agents|Ordres de l’agent/);
    expect(agent).toContain('data-gate-target="agentOrders"');
    expect(agent).toContain('data-gate-target="agentWrite"');
  });
});
