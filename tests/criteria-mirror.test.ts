/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Faux desk, posé avant le chargement de `@/lib/desk` : le Copieur du process principal, désarmé, que le test arme. */
const fake = vi.hoisted(() => {
  const state = { arms: 0, armed: false };
  const status = () => ({ armed: state.armed, link: 'live', routed: 0, lastRefusal: null, flattenOnCut: false });
  (window as unknown as { canto: unknown }).canto = {
    copier: {
      status: async () => status(),
      configure: async () => true,
      arm: async () => {
        state.arms += 1;
        return status();
      },
      cut: async () => ({ cancelled: [], open: [], flattened: [] }),
      onStatus: () => () => undefined,
    },
  };
  return state;
});

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { agentCriteria, copierCriteria, floorRefusals, type CopierCriteriaInput } from '@/app/criteriaMirror';
import { useKillLatch } from '@/app/killState';
import e from '@/design/etat.module.css';
import { AGENT_ORDER_DEFAULTS, guardProposal } from '@/engine/agent/orders';
import { routeFill } from '@/engine/copier/router';
import { coerceCopierSync, followerExclusion, ignoredFollowers, packCopierSync } from '@/engine/copier/sync';
import { DEFAULT_COPIER } from '@/engine/copier/types';
import { gateWords, guardMirror, type MirrorInput } from '@/engine/guardMirror';
import { findPlan } from '@/engine/propfirm';
import { useI18n } from '@/i18n';
import Copieur from '@/modules/copieur/Copieur';
import { AgentOrdersPanel } from '@/modules/agent/AgentOrdersPanel';
import { useAgentOrders } from '@/store/agentOrders';
import { useBridge } from '@/store/bridge';
import { useCopier } from '@/store/copier';
import type { CopierAccount } from '@/store/db';
import { useJournal } from '@/store/journal';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

/**
 * OROS5.43 — les critères en miroir d'Armer (Copieur) et d'Activer (ordres de l'agent), repris de d4 (D11) : C.070 et les
 * critères lus en direct, le premier manquant dit en mots. Chaque critère se lit de la garde qui l'applique ; le bouton
 * ouvre toujours le dialogue du process principal, qui seul décide. Désarmé et désactivé à chaque ouverture, au filet
 * graphite.
 */

const NOW = Date.parse('2026-10-14T20:00:00Z');
let n = 0;
const account = (ntAccount: string, role: CopierAccount['role'], over: Partial<CopierAccount> = {}): CopierAccount => ({
  id: `a${++n}`,
  name: ntAccount,
  role,
  ntAccount,
  enabled: true,
  sizing: { mode: 'ratio', value: 1, maxContracts: 5 },
  symbolMap: { mode: 'identique' },
  createdAt: 0,
  ...over,
});

function input(accounts: CopierAccount[], unrealized: Record<string, number> = {}): CopierCriteriaInput {
  return { accounts, config: DEFAULT_COPIER, sessions: [], trades: [], planById: findPlan, unrealized, maxContractsPerOrder: 20, now: NOW };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: ReturnType<typeof createElement>): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

beforeEach(() => {
  useI18n.setState({ locale: 'fr' });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useJournal.setState({ sessions: [], trades: [] });
  useKillLatch.setState({ engaged: false });
  useBridge.setState({ nt: null });
  fake.arms = 0;
  fake.armed = false;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('OROS5.43 les critères en miroir d’Armer et d’Activer', () => {
  it('Copieur : les critères égalent ses gardes — exclusion des suiveurs, maître et doublons, plancher du routeur', () => {
    const accounts = [
      account('Sim100', 'maitre'),
      account('Sim101', 'suiveur', { planId: 'apex-50' }),
      account('Sim102', 'suiveur'),
      account('APEX-2', 'suiveur'),
      account('Sim102', 'suiveur'),
      account('Sim100', 'suiveur'),
    ];
    // Sim101 suit Apex 50K (drawdown 2 500) avec un latent de −2 000 : 500 de marge, sous le plancher de 30 % (750).
    const src = input(accounts, { Sim101: -2_000 });
    const mirror = copierCriteria(src);
    const state = Object.fromEntries(mirror.criteria.map((c) => [c.id, c.state]));
    expect(state).toEqual({ master: 'met', sim: 'missing', distinct: 'missing', floor: 'missing' });
    // Ce que le process principal relit : APEX-2 n'est jamais un suiveur, ni le maître, ni le doublon.
    const sync = coerceCopierSync(packCopierSync({ accounts, config: DEFAULT_COPIER, sessions: [], trades: [], planById: findPlan, catalysts: [], maxContractsPerOrder: 20 }))!;
    expect(sync.topology.followers.map((f) => f.account)).toEqual(['Sim101', 'Sim102']);
    expect(followerExclusion('APEX-2', 'Sim100', new Set())).toBe('non-sim');
    expect(mirror.criteria.find((c) => c.id === 'sim')!.words).toBe('hors Sim, jamais copiés : APEX-2');
    expect(ignoredFollowers(accounts)).toEqual(['Sim102', 'Sim100']);
    expect(mirror.criteria.find((c) => c.id === 'distinct')!.words).toBe('écartés : Sim102, Sim100');
    // Le plancher : le routeur même refuse l'ouverture copiée de Sim101, dans la fenêtre, sans blackout.
    const fill = { account: 'Sim100', instrument: 'NQ 12-26', side: 'buy' as const, qty: 1, price: 20_000, time: NOW, executionId: 'x1' };
    const routed = routeFill(fill, sync.topology, { now: NOW, localMinutes: 16 * 60, catalysts: [], maxContractsPerOrder: 20, states: sync.states, unrealized: { Sim101: -2_000 } });
    expect(routed.refused.filter((r) => r.reason === 'floor').map((r) => r.account)).toEqual(floorRefusals(src));
    expect(floorRefusals(src)).toEqual(['Sim101']);
    // Le premier manquant, en mots, dans l'ordre de la liste.
    expect(mirror.first?.id).toBe('sim');
    // Latent relevé : la marge repasse au-dessus du plancher ; maître seul et suiveurs Sim* : rien ne manque.
    const clean = copierCriteria(input([account('Apex-PA-50K', 'maitre'), account('Sim101', 'suiveur', { planId: 'apex-50' })], { Sim101: -100 }));
    expect(clean.first).toBeNull();
    expect(copierCriteria(input([account('Sim101', 'suiveur')])).first).toMatchObject({ id: 'master', words: 'aucun compte maître actif' });
  });

  it('ordres de l’agent : les critères égalent guardProposal — comptes Sim*, limites, kill switch', () => {
    const policy = { ...AGENT_ORDER_DEFAULTS, enabled: true, maxQty: 2 };
    const base: MirrorInput = { now: NOW, policy, pending: false, link: 'live', ordersOpen: true, account: 'Sim101', instrument: 'MNQ 12-26', position: 0, propShare: null, traderRules: [] };
    const open = agentCriteria(guardMirror(base), policy, false);
    expect(open.criteria.map((c) => [c.id, c.state])).toEqual([
      ['sim', 'met'],
      ['limits', 'met'],
      ['kill', 'met'],
    ]);
    expect(open.criteria.find((c) => c.id === 'limits')!.words).toBe('2 contrat(s) par ordre · position 2 · 3 par minute');
    // Hors Sim : la garde refuse `not_sim`, le miroir le dit d'abord.
    const real = guardMirror({ ...base, account: 'Apex-PA-50K' });
    expect(guardProposal(real.proposal, policy, { now: NOW, link: 'live', ordersOpen: true, position: 0, recent: [], busy: false, propShare: null })).toMatchObject({ ok: false, reason: 'not_sim' });
    expect(agentCriteria(real, policy, false).first).toMatchObject({ id: 'sim', words: 'Apex-PA-50K hors Sim : l’agent ne propose que sur les comptes Sim*' });
    // Kill switch : la garde refuse `orders_closed` jusqu'au redémarrage ; le miroir le dit.
    const killed = guardMirror({ ...base, ordersOpen: false });
    expect(killed.first?.key).toBe('orders_closed');
    expect(agentCriteria(killed, policy, true).first).toMatchObject({ id: 'kill', words: 'engagé : canal fermé jusqu’au redémarrage' });
    // Les limites dites sont celles que la garde applique : au-delà de maxQty, refus `quantity`.
    expect(guardProposal({ ...real.proposal, account: 'Sim101', qty: 3 }, policy, { now: NOW, link: 'live', ordersOpen: true, position: 0, recent: [], busy: false, propShare: null })).toMatchObject({ ok: false, reason: 'quantity' });
  });

  it('sans instrument connu, le miroir montre la règle des instruments autorisés, lue à chaque proposition', () => {
    const policy = { ...AGENT_ORDER_DEFAULTS, enabled: true };
    const rule = { rule: 'instrument_not_allowed' as const, detail: ' hors des instruments autorisés (NQ)' };
    const mirror = guardMirror({ now: NOW, policy, pending: false, link: 'live', ordersOpen: true, account: 'Sim101', instrument: null, position: 0, propShare: null, traderRules: [rule] });
    const gate = mirror.gates.find((g) => g.key === 'trader_rule')!;
    expect(gate.state).toBe('proposal');
    expect(gate.distance).toEqual({ kind: 'rules', rules: [], deferred: [rule] });
    expect(gateWords(gate)).toBe('la liste des instruments autorisés, lue à chaque proposition');
    // Elle ne refuse toujours pas un ordre sans instrument : la décision revient à l'opérateur.
    expect(mirror.first).toBeNull();
    expect(mirror.verdict.ok).toBe(true);
    // Instrument connu : la règle refuse, comme la garde.
    expect(guardMirror({ now: NOW, policy, pending: false, link: 'live', ordersOpen: true, account: 'Sim101', instrument: 'MNQ 12-26', position: 0, propShare: null, traderRules: [{ ...rule, detail: 'MNQ hors des instruments autorisés (NQ)' }] }).first?.key).toBe('trader_rule');
  });

  it('Armer et Autoriser… ouvrent toujours le dialogue du process principal, critères manquants ou non ; désarmé et désactivé au filet graphite', async () => {
    // Le Copieur : un suiveur hors Sim manque, Armer reste le chemin du dialogue.
    useCopier.setState({ ready: true, accounts: [account('Apex-PA-50K', 'maitre'), account('APEX-2', 'suiveur')], config: DEFAULT_COPIER, load: async () => undefined });
    let node = await mount(createElement(Copieur));
    let block = node.querySelector<HTMLElement>('[data-criteria="copier"]')!;
    expect(block.className).toContain(e.eteint);
    expect(block.querySelector('[data-first]')?.textContent).toBe('Manque d’abord : suiveurs Sim* — hors Sim, jamais copiés : APEX-2');
    expect(block.querySelector('[class*="nut"] svg')).not.toBeNull();
    const arm = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Armer')!;
    expect(arm.disabled).toBe(false);
    expect(arm.querySelector('[class*="gateNut"] svg')).not.toBeNull();
    fake.armed = true;
    await act(async () => arm.click());
    expect(fake.arms).toBe(1);
    block = node.querySelector<HTMLElement>('[data-criteria="copier"]')!;
    expect(block.className).toContain(e.plein);
    act(() => root?.unmount());
    host?.remove();

    // Les ordres de l'agent : kill switch engagé, Autoriser… appelle toujours la méthode du dialogue.
    const enable = vi.fn(async () => undefined);
    useAgentOrders.setState({ status: { ...AGENT_ORDER_DEFAULTS, enabled: false, pending: false }, enable });
    useKillLatch.setState({ engaged: true });
    node = await mount(createElement(AgentOrdersPanel, { available: true }));
    block = node.querySelector<HTMLElement>('[data-criteria="agent"]')!;
    expect(block.className).toContain(e.eteint);
    expect([...block.querySelectorAll<HTMLElement>('[data-criterion]')].map((li) => `${li.dataset.criterion}:${li.dataset.state}`)).toEqual(['sim:missing', 'limits:met', 'kill:missing']);
    expect(block.querySelector('[data-first]')?.textContent).toBe('Manque d’abord : comptes Sim* — aucun compte Sim* connu du pont');
    const allow = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Autoriser…')!;
    expect(allow.disabled).toBe(false);
    await act(async () => allow.click());
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it('OROS5.43a activés puis coupés par le kill switch : le cadre d’Activer passe au filet graphite, comme M.060 et la porte du rail', async () => {
    // Le kill switch ne désactive pas la politique du process principal : `enabled` reste vrai, la garde refuse tout.
    useAgentOrders.setState({ status: { ...AGENT_ORDER_DEFAULTS, enabled: true, pending: false } });
    let node = await mount(createElement(AgentOrdersPanel, { available: true }));
    let block = node.querySelector<HTMLElement>('[data-criteria="agent"]')!;
    expect([block.dataset.state, block.className.includes(e.plein!)]).toEqual(['on', true]);
    act(() => root?.unmount());
    host?.remove();
    useKillLatch.setState({ engaged: true });
    node = await mount(createElement(AgentOrdersPanel, { available: true }));
    block = node.querySelector<HTMLElement>('[data-criteria="agent"]')!;
    expect([block.dataset.state, block.className.includes(e.eteint!), block.className.includes(e.plein!)]).toEqual(['off', true, false]);
    expect(block.querySelector('[data-criterion="kill"]')?.getAttribute('data-state')).toBe('missing');
  });

  it('aucun nouvel appel d’écriture : le miroir et ses lignes ne font que lire', () => {
    for (const file of ['src/app/criteriaMirror.ts', 'src/app/Criteria.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/getState\(\)\.\w+\(|setState\(|window\.canto|\bdesk\?\.|\bdesk\.[a-z]\w*\.|\.(?:arm|enable|disable|setLimits|cut|configure|propose|update\w*)\(/);
    }
    // Les modules gardent leurs seuls chemins d'écriture : Armer par le dialogue du Copieur, Autoriser… par celui des ordres.
    const copieur = readFileSync('src/modules/copieur/Copieur.tsx', 'utf8');
    expect([...copieur.matchAll(/\bapi\.arm\(\)/g)]).toHaveLength(1);
    const panel = readFileSync('src/modules/agent/AgentOrdersPanel.tsx', 'utf8');
    expect([...panel.matchAll(/void enable\(\)/g)]).toHaveLength(1);
  });
});
