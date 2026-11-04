/**
 * @vitest-environment jsdom
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom n'a pas d'IndexedDB : les réglages se lisent et s'écrivent dans une doublure.
vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { ObjectDrawer } from '@/app/objects/Fiche';
import { deskMirrorInput } from '@/app/useGuardMirror';
import e from '@/design/etat.module.css';
import { guardProposal, parseProposal } from '@/engine/agent/orders';
import { DEFAULT_TRADER_RULES, type TraderRules } from '@/engine/discipline';
import { gateWords, guardMirror, MIRROR_ISSUES, mirrorIssueName, mirrorProposal } from '@/engine/guardMirror';
import { BEAD_GAP, BEAD_MAX, BEAD_MIN, BEAD_SLOT, boundCircles, bounds, tradeBeads, type EntityRef } from '@/engine/ontology';
import type { Session, Trade } from '@/engine/types';
import { useI18n } from '@/i18n';
import { fmtUsd } from '@/lib/format';
import type { NtBridgeStatus } from '@/lib/desk';
import { useAgentOrders } from '@/store/agentOrders';
import { useBridge } from '@/store/bridge';
import { useCopier } from '@/store/copier';
import { useDayClose } from '@/store/dayClose';
import { propShareFor, traderRulesOf } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';
import { useKillLatch } from '@/app/killState';

/**
 * OROS5.27 — la fiche Compte : ses bornes du calcul unique (ΟΡΟΣ, en IBM Plex Sans), la garde en miroir jugée par
 * `guardProposal`, le plan suivi et son effet vrai sur la garde (décision 10), le pont et le Copieur. Elle ne fait que lire ;
 * la puce Compte, les cellules de la barre d'état et la cartouche du rail l'ouvrent (décision 11).
 */

/** Mardi 27 octobre 2026, 11 h à New York : la journée CME du 27. */
const NOW = Date.parse('2026-10-27T15:00:00Z');
const TODAY = '2026-10-27';
const APEX = 'Apex-PA-50K';
const SIM = 'Sim101';
const RULES: TraderRules = { ...DEFAULT_TRADER_RULES, maxDailyLoss: 500, maxTradesPerDay: 6, catalystBlackoutMin: 0 };
const ON = { enabled: true, maxQty: 1, maxPosition: 1, perMinute: 2, pending: false };

function session(id: string, date: string, pnl: number, account = APEX, tradeCount = 1): Session {
  return { id, date, account, instruments: ['MNQ'], source: 'demo', tradeCount, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}
function trade(id: string, sessionId: string, at: string, pnl: number, account = APEX): Trade {
  const t = Date.parse(at);
  return { id, sessionId, instrument: 'MNQ', account, direction: 'long', qty: 1, entryTime: t, exitTime: t + 60_000, entryPrice: 1, exitPrice: 1, pnl, commission: 0 };
}
function nt(positions: Record<string, { instrument: string; quantity: number }[]> = {}, unrealized: Record<string, number> = {}): NtBridgeStatus {
  const names = [...new Set([...Object.keys(positions), ...Object.keys(unrealized)])];
  return {
    link: 'live',
    port: 0,
    addonVersion: '2.2.0',
    ntVersion: '8.1',
    accountsAt: NOW - 4_000,
    accounts: names.map((name) => ({ name, cashValue: 0, realizedPnl: 0, unrealizedPnl: unrealized[name] ?? 0, positions: (positions[name] ?? []).map((p) => ({ ...p, avgPrice: 21_000 })) })),
    accountNames: names,
    heartbeatLatencyMs: 12,
    ordersOpen: true,
    ordersClosed: false,
    hasToken: true,
    extraAccounts: [],
    maxContractsPerOrder: 5,
    killSwitchShortcut: 'CommandOrControl+Shift+K',
  } as NtBridgeStatus;
}

/** Le journal du banc : Apex perd 600 $ aujourd'hui (au-delà de la limite de 500 $) ; Sim101 a une séance. */
function bench(planAccount = APEX, journal?: { sessions: Session[]; trades: Trade[] }) {
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'apex-50', planAccount, traderRules: RULES } });
  useJournal.setState(
    journal ?? {
      sessions: [session('a0', '2026-10-26', 120), session('a1', TODAY, -600, APEX, 2), session('s1', TODAY, 40, SIM)],
      trades: [trade('ta', 'a1', '2026-10-27T13:30:00Z', -350), trade('tb', 'a1', '2026-10-27T14:00:00Z', -250), trade('ts', 's1', '2026-10-27T13:40:00Z', 40, SIM)],
    },
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactNode = createElement(ObjectDrawer)): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
const drawer = () => host!.querySelector<HTMLElement>('aside[data-drawer]')!;
const open = (id: string) => act(() => void useObjects.getState().openObject({ type: 'compte', id } as EntityRef));
const section = (part: string) => drawer().querySelector<HTMLElement>(`[data-section="${part}"]`)!;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'note', metricAccount: null });
  useNotes.setState({ notes: [] });
  useLinks.setState({ links: [] });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useAgentOrders.setState({ available: true, status: { ...ON } });
  useKillLatch.setState({ engaged: false });
  useCopier.setState({ accounts: [] });
  useDayClose.setState({ closes: [] });
  useBridge.setState({ nt: nt({ [SIM]: [], [APEX]: [] }, { [APEX]: -24 }) });
  bench();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

/** Le verdict de la garde même sur l'ouverture fictive que la fiche lit : la lecture, puis `guardProposal`. */
function direct(account: string) {
  const status = useAgentOrders.getState().status;
  const input = deskMirrorInput({ now: NOW, status, nt: useBridge.getState().nt, killLatched: useKillLatch.getState().engaged, planAccount: useSettings.getState().settings.planAccount, trades: useJournal.getState().trades, account });
  const parsed = parseProposal(mirrorProposal(input));
  if (!parsed.ok) return { input, verdict: { ok: false as const, reason: 'invalid' as const, detail: parsed.detail } };
  return {
    input,
    verdict: guardProposal(parsed.proposal, input.policy, { now: input.now, link: input.link, ordersOpen: input.ordersOpen, position: input.position, recent: [], busy: input.pending, propShare: input.propShare, traderRule: input.traderRules[0] ?? null }),
  };
}

describe('OROS5.27 la fiche Compte', () => {
  it('le miroir égale guardProposal : le verdict et la garde qui refuse en tête, les douze issues au dépliage, en mots', () => {
    mount();
    // Sim101 à plat : la garde laisse passer, la décision revient à l'opérateur
    open(SIM);
    const free = direct(SIM);
    expect(free.verdict.ok).toBe(true);
    const verdict = () => section('guard').querySelector<HTMLElement>('[data-verdict]')!;
    expect(verdict().dataset.verdict).toBe('declined');
    expect(verdict().textContent).toContain('Passerait la garde · vous décidez');
    expect(verdict().textContent).toContain('refus par défaut à 45 s');
    // au-delà de la position permise : la garde refuse « position », et la fiche le dit en tête
    act(() => useBridge.setState({ nt: nt({ [SIM]: [{ instrument: 'MNQ 12-26', quantity: 1 }], [APEX]: [] }) }));
    const refused = direct(SIM);
    expect(refused.verdict).toMatchObject({ ok: false, reason: 'position' });
    expect(verdict().dataset.verdict).toBe('position');
    const mirror = guardMirror(refused.input);
    expect(verdict().textContent).toContain(`Refuserait · ${mirrorIssueName('position')}`);
    expect(verdict().textContent).toContain(gateWords(mirror.first!));
    // les douze issues, dans l'ordre de la garde, chacune avec l'état et les mots du miroir ; le trait de la table d'états
    const rows = [...section('guard').querySelectorAll<HTMLElement>('details li[data-gate]')];
    expect(rows.map((row) => row.dataset.gate)).toEqual([...MIRROR_ISSUES]);
    expect(rows.map((row) => row.dataset.state)).toEqual(mirror.gates.map((g) => g.state));
    for (const [i, row] of rows.entries()) expect(row.textContent).toContain(gateWords(mirror.gates[i]!));
    const mark = (key: string) => section('guard').querySelector(`li[data-gate="${key}"] [data-etat]`)!;
    expect(mark('position').classList.contains(e.eteint!)).toBe(true);
    expect(mark('busy').classList.contains(e.plein!)).toBe(true);
    expect(mark('declined').classList.contains(e.tirete!)).toBe(true);
    // les issues ne sont pas un paragraphe permanent : elles attendent qu'on déplie
    expect(section('guard').querySelector('details')!.hasAttribute('open')).toBe(false);
    // un compte hors Sim : l'agent n'y propose jamais, la garde le dit en premier
    act(() => void useObjects.getState().openObject({ type: 'compte', id: APEX }));
    expect(direct(APEX).verdict).toMatchObject({ ok: false, reason: 'not_sim' });
    expect(verdict().dataset.verdict).toBe('not_sim');
  });

  it('pont hors ligne : jamais « canal ouvert » ; ce qui se lit au pont est inconnu', () => {
    act(() => useBridge.setState({ nt: null }));
    mount();
    open(SIM);
    expect(direct(SIM).verdict).toMatchObject({ ok: false, reason: 'link' });
    expect(drawer().textContent).not.toMatch(/canal d’ordres ouvert/i);
    expect(section('guard').querySelector('[data-verdict]')!.getAttribute('data-verdict')).toBe('link');
    const state = (key: string) => section('guard').querySelector<HTMLElement>(`li[data-gate="${key}"]`)!.dataset.state;
    expect(state('orders_closed')).toBe('unknown');
    expect(state('position')).toBe('unknown');
    expect(section('guard').querySelector('li[data-gate="orders_closed"]')!.textContent).toContain('inconnu : pont hors ligne');
    expect(section('bridge').textContent).toContain('Pont hors ligne : aucune position lue.');
    // et l'agent désactivé, pont hors ligne : toujours rien d'ouvert
    act(() => useAgentOrders.setState({ status: { ...ON, enabled: false } }));
    expect(drawer().textContent).not.toMatch(/canal d’ordres ouvert/i);
  });

  it('OROS5.47b pont vivant qui ne rapporte pas ce compte : « absent du pont », jamais « hors ligne », dans les trois langues', () => {
    // Sous Electron, le pont vivait sur Sim101 seul, et la fiche d'Apex-PA-50K disait « pont hors ligne ».
    act(() => useBridge.setState({ nt: nt({ [SIM]: [] }) }));
    mount();
    open(APEX);
    expect(drawer().textContent).toContain('absent du pont');
    expect(drawer().textContent).not.toMatch(/pont hors ligne/i);
    expect(section('bridge').textContent).toContain('Le pont ne rapporte pas ce compte : aucune position lue.');
    act(() => useI18n.setState({ locale: 'en' }));
    expect(drawer().textContent).toContain('not at the bridge');
    expect(section('bridge').textContent).toContain('The bridge does not report this account: no position read.');
    act(() => useI18n.setState({ locale: 'es' }));
    expect(drawer().textContent).toContain('ausente del puente');
    expect(section('bridge').textContent).toContain('El puente no informa de esta cuenta: ninguna posición leída.');
    act(() => useI18n.setState({ locale: 'fr' }));
    // Le compte au pont dit « pont vif » ; le pont absent, « pont hors ligne ».
    act(() => useBridge.setState({ nt: nt({ [SIM]: [], [APEX]: [] }) }));
    expect(drawer().textContent).toContain('pont vif');
    act(() => useBridge.setState({ nt: null }));
    expect(drawer().textContent).toContain('pont hors ligne');
    expect(section('bridge').textContent).toContain('Pont hors ligne : aucune position lue.');
  });

  it('sans instrument connu, le miroir ne prend plus « lecture » pour un refus : l’instrument vient de la proposition', () => {
    useJournal.setState({ sessions: [], trades: [] });
    mount();
    open(SIM);
    const input = deskMirrorInput({ now: NOW, status: useAgentOrders.getState().status, nt: useBridge.getState().nt, killLatched: false, planAccount: APEX, trades: [], account: SIM });
    expect(input.instrument).toBeNull();
    const mirror = guardMirror(input);
    expect(mirror.gates[0]).toEqual({ key: 'invalid', state: 'proposal' });
    expect(mirror.first).toBeNull();
    expect(mirror.verdict.ok).toBe(true);
    expect(section('guard').querySelector('[data-verdict]')!.getAttribute('data-verdict')).toBe('declined');
    expect(section('guard').querySelector('li[data-gate="invalid"]')!.textContent).toContain('lue à chaque proposition');
    // la règle des instruments autorisés se lit aussi à la proposition : elle ne refuse pas un ordre sans instrument
    const withList = guardMirror({ ...input, traderRules: [{ rule: 'instrument_not_allowed', detail: ' hors des instruments autorisés (NQ)' }] });
    expect(withList.first).toBeNull();
  });

  it('M.057 et les bornes du calcul unique : la marge du jour au numéral, ΟΡΟΣ une fois en IBM Plex Sans, M.065 et M.011', () => {
    mount();
    open(APEX);
    expect(drawer().querySelector('h2')!.textContent).toBe(`Compte · ${APEX}`);
    // la section Activité de chaque fiche (OROS5.38), avant la provenance
    expect([...drawer().querySelectorAll('section')].map((sec) => sec.dataset.section)).toEqual(['identity', 'bornes', 'guard', 'plan', 'bridge', 'links', 'around', 'activity', 'provenance']);
    const ident = section('identity');
    expect(ident.querySelector('[data-sim]')!.textContent).toBe('hors Sim');
    // la marge du jour : le plan en cours sur la dernière séance réelle du compte
    expect(ident.querySelector('[data-ident="numeral"] > span')!.textContent).toBe('marge du jour · USD');
    expect(ident.querySelector('[data-ident="numeral"] b')!.textContent).not.toBe('—');
    expect(ident.textContent).toContain('2 séances · 2 trades');
    // ΟΡΟΣ : une fois, en grec, en IBM Plex Sans, en titre de la section Bornes, jamais en Geist Mono
    const greek = [...drawer().querySelectorAll('*')].filter((el) => el.childElementCount === 0 && el.textContent === 'ΟΡΟΣ');
    expect(greek).toHaveLength(1);
    expect(greek[0]!.closest('h3')).toBe(section('bornes').querySelector('h3'));
    expect(greek[0]!.getAttribute('lang')).toBe('el');
    const oros = cssRules(readFileSync('src/app/objects/fiche.module.css', 'utf8')).find((rule) => rule.selector === '.oros')!.body;
    expect(oros).toMatch(/font-family: var\(--font-name\)/);
    expect(oros).not.toMatch(/--font-mono/);
    const uses = ['src/app', 'src/modules', 'src/design'].flatMap((dir) => readdir(dir)).filter((path) => /\.tsx$/.test(path) && readFileSync(path, 'utf8').includes('ΟΡΟΣ'));
    expect(uses).toEqual(['src/app/objects/AccountFiche.tsx']);
    // les bornes : la journée lue et sa source, la perte du jour sur sa limite (règle du trader, C.109), M.065, M.011
    const bornes = section('bornes');
    expect(bornes.querySelector('[data-read]')!.textContent).toContain('Journée du 27.10 · pont il y a 4 s · Apex-PA-50K');
    expect(bornes.querySelector('[data-borne="loss"]')!.textContent).toMatch(/Perte du jour624 \/ 500\s\$/u);
    expect(bornes.querySelector('[data-borne="loss"] svg.skg-109')).not.toBeNull();
    const beads = bornes.querySelector('svg[data-figure="M.065"]')!;
    expect(beads.querySelectorAll('[data-bead="loss"]')).toHaveLength(2);
    expect(beads.querySelectorAll('[data-bead="free"]')).toHaveLength(4);
    for (const slot of beads.querySelectorAll('[data-bead="free"]')) expect(slot.classList.contains(e.tirete!)).toBe(true);
    expect(beads.querySelector('[data-bead="bound"]')).not.toBeNull();
    const disk = bornes.querySelector('figure[data-figure="M.011"] svg')!;
    // le plancher suit encore (trailing, pas verrouillé) : C.125 au trait ; la perte du jour, franchie, mord la première
    expect(disk.querySelector('svg.skg-125')).not.toBeNull();
    expect(disk.querySelector('svg.skg-126')).toBeNull();
    expect(disk.querySelector('[data-bound="daily"]')!.hasAttribute('data-first')).toBe(true);
    for (const circle of disk.querySelectorAll('[data-bound]')) expect(circle.classList.contains(e.plein!)).toBe(true);
  });

  it('plan clos : « — » au numéral, les cercles au filet graphite, la date ; un compte que le plan ne suit pas le dit', () => {
    // l'objectif est atteint le 20.10 (quatre journées de 800 $, la consistance tenue) : le rejeu s'arrête là, la marge de
    // ce jour-là n'est pas celle d'aujourd'hui
    const days = ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'];
    bench(APEX, {
      sessions: [...days.map((date, i) => session(`a${i}`, date, 800)), session('a9', TODAY, -100)],
      trades: [...days.map((date, i) => trade(`t${i}`, `a${i}`, `${date}T14:00:00Z`, 800)), trade('t9', 'a9', '2026-10-27T13:30:00Z', -100)],
    });
    mount();
    open(APEX);
    const ident = section('identity');
    expect(ident.querySelector('[data-ident="numeral"] b')!.textContent).toBe('—');
    expect(ident.querySelector('[data-ident="numeral"] > span')!.textContent).toBe('marge du jour · plan clos');
    const bornes = section('bornes');
    // la marge du plan clos passe au filet graphite ; la perte du jour, règle du trader, reste en service et mord la première
    const circle = (key: string) => bornes.querySelector(`figure[data-figure="M.011"] [data-bound="${key}"]`)!;
    expect(circle('drawdown').classList.contains(e.eteint!)).toBe(true);
    expect(circle('daily').classList.contains(e.plein!)).toBe(true);
    expect(circle('daily').hasAttribute('data-first')).toBe(true);
    expect(bornes.querySelector('[data-closed="objectif"]')!.textContent).toContain('Objectif atteint · 20.10');
    // le compte Sim101 : le plan et les bornes suivent Apex-PA-50K, la fiche le dit et y mène
    act(() => void useObjects.getState().openObject({ type: 'compte', id: SIM }));
    expect(section('identity').querySelector('[data-ident="numeral"] b')!.textContent).toBe('—');
    expect(section('bornes').querySelector('[data-bornes="away"]')!.textContent).toContain(`Les bornes du jour suivent ${APEX} : ni la perte du jour ni la marge ne bornent ${SIM}.`);
  });

  it('l’effet du plan suivi dit vrai : suivre un compte hors Sim retire la marge datée et la perte du jour de la garde des comptes Sim', () => {
    mount();
    open(SIM);
    const effect = () => section('plan').querySelector('[data-effect]')!.textContent!;
    expect(section('plan').textContent).toContain('Suivre Apex Full 50K pour Sim101');
    expect(effect()).toContain(`Le plan suit ${APEX}, hors Sim : la marge datée et la perte du jour ne gardent plus les comptes Sim, les seuls où l’agent propose.`);
    expect(effect()).toContain(`La marge datée ne borne pas l’agent sur ${SIM} ; la perte du jour ne borne que ${APEX}.`);
    // ce que dit la fiche est ce que la garde reçoit : rien pour Sim101, alors qu'Apex a franchi sa perte du jour
    expect(propShareFor(SIM)).toBeNull();
    expect(propShareFor(APEX)).not.toBeNull();
    expect(traderRulesOf({ account: SIM, instrument: 'MNQ', qty: 1 }, NOW).map((r) => r.rule)).not.toContain('after_daily_limit');
    expect(traderRulesOf({ account: APEX, instrument: 'MNQ', qty: 1 }, NOW).map((r) => r.rule)).toContain('after_daily_limit');
    // suivre Sim101 : la garde lit la marge et la perte du jour, et la fiche le dit
    act(() => bench(SIM));
    expect(propShareFor(SIM)).not.toBeNull();
    expect(effect()).not.toContain('hors Sim');
    expect(effect()).toContain(`La marge datée du plan borne l’agent sur ${SIM} ; la perte du jour borne l’agent sur ${SIM}.`);
    // la fiche d'Apex, hors Sim : l'agent n'y propose jamais
    act(() => bench(APEX));
    act(() => void useObjects.getState().openObject({ type: 'compte', id: APEX }));
    expect(effect()).toContain(`L’agent ne propose aucun ordre sur ${APEX} : la garde s’arrête aux comptes Sim.`);
  });

  it('OROS5.48j la journée fermée se dit dans les bornes de la fiche et dans l’effet du plan, même sans limite', () => {
    // Sim101 suivi, limite 600 $ : −300 $ à 10:20 ET, −320 $ à 10:40 ET (620 $, la journée ferme), +80 $ à 10:50 ET
    const journal = {
      sessions: [session('s0', '2026-10-26', 40, SIM), session('s1', TODAY, -540, SIM, 3)],
      trades: [trade('t0', 's0', '2026-10-26T14:00:00Z', 40, SIM), trade('t1', 's1', '2026-10-27T14:19:00Z', -300, SIM), trade('t2', 's1', '2026-10-27T14:39:00Z', -320, SIM), trade('t3', 's1', '2026-10-27T14:49:00Z', 80, SIM)],
    };
    bench(SIM, journal);
    useSettings.setState({ settings: { ...useSettings.getState().settings, traderRules: { ...RULES, maxDailyLoss: 600 } } });
    useBridge.setState({ nt: nt({ [SIM]: [], [APEX]: [] }) });
    mount();
    open(SIM);
    const bornes = () => section('bornes');
    expect(bornes().querySelector('[data-borne="loss"]')!.textContent).toMatch(/Perte du jour540 \/ 600\s\$/u);
    expect(bornes().querySelector('[data-closed="day"]')!.textContent).toBe('Journée fermée depuis 10:40 ET');
    // M.011 : la perte du jour ne laisse plus rien tant que la journée est fermée
    const disk = bornes().querySelector('[data-bound-value="daily"]')!;
    expect(disk.textContent).toBe(fmtUsd(0));
    expect(disk.closest('[aria-label]')!.getAttribute('aria-label')).toContain(`perte du jour, reste ${fmtUsd(0)}`);
    expect(section('plan').querySelector('[data-effect]')!.textContent).toContain('journée fermée depuis 10:40 ET');
    // la limite retirée : la fiche dit la fermeture, non « aucune limite »
    act(() => {
      useDayClose.setState({ closes: [{ day: TODAY, account: SIM, at: Date.parse('2026-10-27T14:40:00Z') }] });
      useSettings.setState({ settings: { ...useSettings.getState().settings, planId: '', traderRules: { ...RULES, maxDailyLoss: 0 } } });
    });
    expect(bornes().querySelector('[data-borne="loss"]')!.textContent).toBe('Perte du jour540');
    expect(bornes().querySelector('[data-closed="day"]')!.textContent).toBe('Journée fermée depuis 10:40 ET');
    expect(bornes().textContent).not.toContain('Aucune borne réglée');
    const effect = section('plan').querySelector('[data-effect]')!.textContent!;
    expect(effect).toContain('journée fermée depuis 10:40 ET');
    expect(effect).not.toContain('aucune limite de perte du jour réglée');
    // sans fermeture ni limite, comme avant
    act(() => useDayClose.setState({ closes: [] }));
    act(() => useJournal.setState({ sessions: [], trades: [] }));
    expect(bornes().querySelector('[data-closed="day"]')).toBeNull();
    expect(section('plan').querySelector('[data-effect]')!.textContent).toContain('aucune limite de perte du jour réglée');
  });

  it('OROS5.48l la journée en cours fermée, la section lisant une séance datée : la perte et la fermeture disent leur journée', () => {
    // Sim101 suivi, limite 600 $ : la seule séance est celle du 26.10 (−63 $, 3 trades) ; la journée du 27.10 est fermée
    // depuis 10:00 ET (la perte vue au latent), puis le pont s'est perdu
    const journal = {
      sessions: [session('s0', '2026-10-26', -63, SIM, 3)],
      trades: [trade('t0', 's0', '2026-10-26T14:00:00Z', -30, SIM), trade('t1', 's0', '2026-10-26T14:20:00Z', -20, SIM), trade('t2', 's0', '2026-10-26T14:40:00Z', -13, SIM)],
    };
    bench(SIM, journal);
    useSettings.setState({ settings: { ...useSettings.getState().settings, traderRules: { ...RULES, maxDailyLoss: 600 } } });
    useDayClose.setState({ closes: [{ day: TODAY, account: SIM, at: Date.parse('2026-10-27T14:00:00Z') }] });
    useBridge.setState({ nt: null });
    mount();
    open(SIM);
    const bornes = () => section('bornes');
    const today = () => bornes().querySelector<HTMLElement>('[data-read="today"]');
    const dated = bornes().querySelector<HTMLElement>('[data-read=""]')!;
    const loss = bornes().querySelector<HTMLElement>('[data-borne="loss"]')!;
    const closed = bornes().querySelector<HTMLElement>('[data-closed="day"]')!;
    const tradesLine = bornes().querySelector<HTMLElement>('[data-borne="trades"]')!;
    // la perte non lue et la fermeture sont celles de la journée CME en cours, sous sa propre ligne, avant la séance datée
    expect(today()!.textContent).toBe('Journée du 27.10 · journée CME en cours · Sim101');
    expect(loss.textContent).toMatch(/Perte du jour— \/ 600\s\$/u);
    expect(closed.textContent).toBe('Journée fermée depuis 10:00 ET');
    expect(dated.textContent).toBe('Journée du 26.10 · dernière séance, 26.10 · Sim101');
    const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(before(today()!, loss) && before(loss, closed) && before(closed, dated) && before(dated, tradesLine)).toBe(true);
    expect(tradesLine.textContent).toContain('3 / 6');
    for (const [locale, words] of [
      ['en', 'Day of 10/27 · current CME day · Sim101'],
      ['es', 'Jornada del 27.10 · jornada CME en curso · Sim101'],
    ] as const) {
      act(() => useI18n.setState({ locale }));
      expect(today()!.textContent, locale).toBe(words);
    }
    act(() => useI18n.setState({ locale: 'fr' }));
    // sans fermeture, la section lit la séance datée d'un bout à l'autre, comme avant
    act(() => useDayClose.setState({ closes: [] }));
    expect(today()).toBeNull();
    expect(bornes().querySelector('[data-borne="loss"]')!.textContent).toMatch(/Perte du jour63 \/ 600\s\$/u);
    expect(before(bornes().querySelector('[data-read=""]')!, bornes().querySelector('[data-borne="loss"]')!)).toBe(true);
  });

  it('OROS5.45k « Filtrer Métrique sur ce compte » saute d’abord, puis filtre : Retour arrière rend Métrique sans le filtre', () => {
    mount();
    open(SIM);
    expect(useUi.getState().metricAccount).toBeNull();
    act(() => drawer().querySelector<HTMLButtonElement>('[data-action="metrique"]')!.click());
    expect(useUi.getState().tab).toBe('metrique');
    expect(useObjects.getState().views.metrique).toBe('bord');
    expect(useUi.getState().metricAccount).toBe(SIM);
    expect(useObjects.getState().history).toHaveLength(1);
    act(() => void useObjects.getState().back());
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: SIM });
    expect(useUi.getState().metricAccount).toBeNull();
  });

  it('aucune méthode d’écriture appelée depuis la fiche : le bouton du plan mène à l’écriture existante de Firme prop', () => {
    const writes = {
      update: vi.fn(async () => undefined),
      enable: vi.fn(async () => undefined),
      disable: vi.fn(async () => undefined),
      setLimits: vi.fn(async () => undefined),
      promote: vi.fn(async () => undefined),
      reject: vi.fn(async () => undefined),
      affirm: vi.fn(async () => undefined),
      updateSession: vi.fn(async () => undefined),
      copierSave: vi.fn(async () => undefined),
    };
    useSettings.setState({ update: writes.update });
    useAgentOrders.setState({ enable: writes.enable, disable: writes.disable, setLimits: writes.setLimits } as never);
    useLinks.setState({ promote: writes.promote, reject: writes.reject, affirm: writes.affirm });
    useJournal.setState({ updateSession: writes.updateSession });
    useCopier.setState({ save: writes.copierSave } as never);
    mount();
    open(SIM);
    act(() => drawer().querySelector<HTMLButtonElement>('[data-action="prop"]')!.click());
    // le saut : Métrique › Firme prop, filtrée sur ce compte, là où vit « Suivre ce plan pour … » ; Retour arrière le défait
    expect(useUi.getState().tab).toBe('metrique');
    expect(useObjects.getState().views.metrique).toBe('prop');
    expect(useUi.getState().metricAccount).toBe(SIM);
    expect(useObjects.getState().history).toHaveLength(1);
    act(() => void useObjects.getState().back());
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: SIM });
    // OROS5.45d : Retour arrière rend aussi le filtre de compte d'avant le saut
    expect(useUi.getState().metricAccount).toBeNull();
    // chaque autre bouton de la fiche ouvre un objet ou un module
    const buttons = () => [...drawer().querySelectorAll<HTMLElement>('button, summary')].filter((b) => !['close', 'copy'].includes(b.dataset.action ?? ''));
    for (const index of buttons().keys()) {
      act(() => void useObjects.getState().openObject({ type: 'compte', id: SIM }));
      act(() => buttons()[index]?.click());
    }
    for (const [name, fn] of Object.entries(writes)) expect(fn, name).not.toHaveBeenCalled();
    expect(useSettings.getState().settings.planAccount).toBe(APEX);
    // les sources : la fiche ne nomme aucune méthode d'écriture d'un store ni du process principal (PlanAction de d4 non repris)
    const source = readFileSync('src/app/objects/AccountFiche.tsx', 'utf8');
    expect(source).not.toMatch(/\.(?:update|updateAgent|enable|disable|setLimits|propose|arm|disarm|cut|promote|reject|affirm|remove|recompute|save|put|add|delete)\(/);
    expect(source).not.toMatch(/PlanAction|window\.canto|desk\?*\.\w+\(|from '@\/lib\/desk'|from '@\/store\/db'/);
    // Firme prop porte l'ancre où le focus se pose : les gestes du plan suivi, jamais un bouton
    expect(readFileSync('src/modules/metrique/PropFirmView.tsx', 'utf8')).toMatch(/<span className=\{s\.planTarget\} data-plan-target="">/);
  });

  it('la puce Compte, les cellules de la barre d’état et la cartouche du rail l’ouvrent', async () => {
    const { Shell } = await import('@/app/Shell');
    mount(createElement(Shell, null, createElement('div', null, 'module')));
    // une cellule de la barre d'état : la fiche du compte suivi, par un saut
    act(() => host!.querySelector<HTMLButtonElement>('[data-chassis="status"] [data-borne="loss"]')!.click());
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: APEX });
    act(() => void useObjects.getState().close(false));
    // la cartouche du rail : le compte suivi, sans filtre de Métrique
    const rail = host!.querySelector<HTMLButtonElement>('aside [role="group"][aria-label="Compte actif"] [data-account-open]')!;
    expect(rail.dataset.accountOpen).toBe(APEX);
    expect(rail.textContent).toBe('Tous les comptes · 2');
    expect(rail.hasAttribute('title')).toBe(false);
    act(() => rail.click());
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: APEX });
    expect(drawer().dataset.drawer).toBe('compte');
    // le compte filtré l'emporte
    act(() => useUi.setState({ metricAccount: SIM }));
    expect(host!.querySelector<HTMLElement>('[data-account-open]')!.dataset.accountOpen).toBe(SIM);
  });
});

describe('OROS5.27 la géométrie de M.011 et de M.065, au moteur', () => {
  it('M.011 : deux cercles tangents au plancher, le diamètre de chacun ce qui reste à l’échelle du drawdown maximal ; le plus petit mord le premier', () => {
    expect(bounds({ maxDrawdown: 0, toDrawdown: 100, toDailyLoss: 100 })).toBeNull();
    const b = bounds({ maxDrawdown: 2_500, toDrawdown: 2_000, toDailyLoss: 500 })!;
    expect(b).toEqual({ drawdown: 0.8, daily: 0.2, first: 'daily' });
    expect(bounds({ maxDrawdown: 2_500, toDrawdown: 3_000, toDailyLoss: -10 })).toEqual({ drawdown: 1, daily: 0, first: 'daily' });
    expect(bounds({ maxDrawdown: 2_500, toDrawdown: null, toDailyLoss: null })).toEqual({ drawdown: null, daily: null, first: null });
    expect(bounds({ maxDrawdown: 2_500, toDrawdown: 500, toDailyLoss: 500 })!.first).toBe('drawdown');
    const circles = boundCircles(b, 100, 70, 60);
    expect(circles.map((c) => c.key)).toEqual(['drawdown', 'daily']);
    // tangents au plancher : le bord gauche de chaque cercle est la verticale du plancher
    for (const c of circles) expect(c.cx - c.r).toBe(100);
    expect(circles[0]).toMatchObject({ r: 24, cy: 70 });
    expect(circles[1]!.r).toBeCloseTo(6, 10);
  });

  it('M.065 : une perle par trade, sa largeur selon |P&L|, les places libres jusqu’au maximum, la borne au maximum', () => {
    const row = tradeBeads([-350, 100, Number.NaN], 4);
    expect(row.beads.map((b) => [b.win, b.w, b.over])).toEqual([
      [false, BEAD_MAX, false],
      [true, BEAD_MIN + (BEAD_MAX - BEAD_MIN) * (100 / 350), false],
    ]);
    expect(row.free).toHaveLength(2);
    expect(row.free.every((slot) => slot.w === BEAD_SLOT)).toBe(true);
    expect(row.bound).toBe(row.free[1]!.x + BEAD_SLOT + BEAD_GAP / 2);
    // au-delà du maximum : les perles passent la borne
    const over = tradeBeads([10, 20, 30], 2);
    expect(over.beads.map((b) => b.over)).toEqual([false, false, true]);
    expect(over.bound).toBe(over.beads[2]!.x - BEAD_GAP / 2);
    expect(over.free).toEqual([]);
    // sans maximum, pas de borne
    expect(tradeBeads([10], null).bound).toBeNull();
  });
});

function readdir(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...readdir(path));
    else out.push(path.split(/[/\\]/).join('/'));
  }
  return out;
}
