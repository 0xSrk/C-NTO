/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * OROS5.39 — la proposition de l'agent devient un objet (Système 5 « Fiche et Frise » ; repris du prototype D · Porte, d4) :
 * la colonne Propositions d'Agent IA › Conversation et la fiche du tiroir, liée à son compte, son instrument et sa séance,
 * trouvée par Ctrl+J et ouverte par sa ligne du registre. La carte dit le dialogue du process principal mot pour mot,
 * l'auteur, la raison citée, la chaîne C.092 et les douze issues de M.040 dans l'ordre de la garde ; un refus porte C.042,
 * jamais le rouge ; aucun bouton n'y accepte l'ordre. Flux réel seulement : ni démonstration, ni branchement sur `propose`.
 */

/** Faux desk, posé avant le chargement de `@/lib/desk` : le process principal répond quand le test le décide. */
const fake = vi.hoisted(() => {
  const state = { calls: [] as unknown[][], release: null as ((outcome: unknown) => void) | null };
  const status = { enabled: true, maxQty: 1, maxPosition: 2, perMinute: 3, pending: false };
  (window as unknown as { canto: unknown }).canto = {
    agentOrders: {
      status: async () => status,
      enable: async () => status,
      disable: async () => status,
      limits: async () => status,
      propose: (...args: unknown[]) => {
        state.calls.push(args);
        return new Promise((resolve) => {
          state.release = resolve;
        });
      },
    },
  };
  return state;
});

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import { proposalDialog } from '../electron/agent-orders';
import { ObjectDrawer } from '@/app/objects/Fiche';
import { buildObjectIndex, searchObjectIndex, type IndexSources } from '@/app/objects/index';
import { authorLine, cellStates, dialogLines, PROPOSAL_CELLS, proposalFoot, reasonCaption } from '@/app/objects/proposals';
import { activityOf, eventLine, eventTarget, logEvents, type RegistreContext } from '@/app/registre';
import { AGENT_CONFIRM_TIMEOUT_MS, AGENT_ORDER_REFUSALS, type AgentOrderProposal } from '@/engine/agent/orders';
import type { Session } from '@/engine/types';
import { useI18n, type Locale } from '@/i18n';
import type { AgentOrderOrigin, AgentOrderOutcome } from '@/lib/desk';
import { Propositions } from '@/modules/agent/Propositions';
import { useAgentOrders } from '@/store/agentOrders';
import { deskEventLog } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useMacro } from '@/store/macro';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { useUi } from '@/store/ui';

/** Mercredi 14 octobre 2026, 10:05 à New York : la journée CME du 14. */
const NOW = Date.parse('2026-10-14T14:05:00Z');
const SIM = 'Sim101';
const session = (id: string, date: string, account: string): Session => ({ id, date, account, instruments: ['MNQ'], source: 'ninjatrader', tradeCount: 1, pnl: 10, grossProfit: 10, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 });
const SESSIONS = [session('s1', '2026-10-14', SIM), session('s2', '2026-10-13', SIM)];
const ORDER = { account: 'sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 3, reason: 'Reprise au-dessus du plus-bas de l’ouverture, volume en hausse.' };
const ACCEPT = /envoyer|accepter|confirmer|valider|autoriser|send|accept|confirm|approve|allow|enviar|aceptar|confirmar|autorizar/i;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount(node: ReactNode): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

/** Une proposition par le vrai chemin du desk : le store l'envoie au faux process principal, qui répond `outcome`. */
async function propose(args: Record<string, unknown>, origin: AgentOrderOrigin, outcome: AgentOrderOutcome): Promise<void> {
  const pending = useAgentOrders.getState().propose(args, origin);
  fake.release!(outcome);
  await act(async () => {
    await pending;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useUi.setState({ tab: 'agent', friseOpen: false });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useJournal.setState({ sessions: SESSIONS, trades: [] });
  useNotes.setState({ notes: [] });
  useLinks.setState({ links: [] });
  useMacro.setState({ events: [], sources: [], syncing: false, lastError: undefined, load: async () => undefined, sync: async () => undefined });
  useAgentOrders.setState({ proposals: [], last: null });
  fake.calls.length = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

describe('OROS5.39 la proposition de l’agent, objet de la fiche', () => {
  it('M.040 : les douze cases suivent l’ordre de guardProposal (la lecture, AGENT_ORDER_REFUSALS, puis vous)', () => {
    expect(PROPOSAL_CELLS).toEqual(['invalid', ...AGENT_ORDER_REFUSALS, 'declined']);
    const opening = { position: null, side: 'buy', qty: 1 } as const;
    // Un refus de la garde passe les cases qui le précèdent, s'arrête sur la sienne, ne lit pas la suite.
    for (const [i, reason] of (['invalid', ...AGENT_ORDER_REFUSALS] as const).entries()) {
      const cells = cellStates({ ...opening, outcome: { status: 'refused', reason, detail: '' } });
      expect(cells.slice(0, i), reason).toEqual(Array(i).fill('pass'));
      expect(cells[i], reason).toBe('stop');
      expect(cells.slice(i + 1), reason).toEqual(Array(PROPOSAL_CELLS.length - i - 1).fill('idle'));
    }
    // Vous : refusée ou sans réponse, la dernière case arrête ; envoyée, ou refusée par le pont après votre accord, tout passe.
    expect(cellStates({ ...opening, outcome: { status: 'declined', detail: '' } })).toEqual([...Array(11).fill('pass'), 'stop']);
    expect(cellStates({ ...opening, outcome: { status: 'failed', detail: '' } })).toEqual(Array(12).fill('pass'));
    // En cours, rien n'est encore lu.
    expect(cellStates({ ...opening, outcome: null })).toEqual(Array(12).fill('idle'));
    // Une réduction de risque (+1 → 0) contourne la position, la marge datée et la règle du trader.
    const sent: AgentOrderOutcome = { status: 'sent', orderId: 'o1', account: SIM, instrument: 'MNQ 12-26', side: 'sell', qty: 1, resulting: 0 };
    const reducing = cellStates({ position: 1, side: 'sell', qty: 1, outcome: sent });
    expect(PROPOSAL_CELLS.filter((_, i) => reducing[i] === 'skip')).toEqual(['position', 'prop_buffer', 'trader_rule']);
  });

  it('le diff, l’auteur et la légende de la raison disent le dialogue du process principal mot pour mot, dans les trois langues', () => {
    const orders: AgentOrderProposal[] = [
      { account: SIM, instrument: 'MNQ 12-26', side: 'buy', qty: 2, type: 'limit', limit: 21_000.5, reason: 'r' },
      { account: SIM, instrument: 'NQ 12-26', side: 'sell', qty: 1, type: 'stop', stop: 20_950.25, reason: 'r' },
      { account: SIM, instrument: 'MES 12-26', side: 'buy', qty: 1, type: 'market', reason: 'r' },
    ];
    for (const locale of ['fr', 'en', 'es'] as Locale[]) {
      useI18n.setState({ locale });
      for (const origin of ['llm', 'mcp', 'orch'] as const) {
        for (const order of orders) {
          const dialog = proposalDialog(order, 1, order.side === 'buy' ? 1 + order.qty : 1 - order.qty, origin, locale);
          const detail = dialog.detail!.split('\n');
          expect(authorLine(origin), `${locale} ${origin}`).toBe(dialog.message);
          expect(dialogLines({ ...order, position: 1 }), `${locale} ${order.type}`).toEqual(detail.slice(0, 3));
          expect(`${reasonCaption()} :`).toBe(detail[4]);
          // Sans position lue, le diff s'arrête au compte : il ne l'invente pas.
          expect(dialogLines({ ...order, position: null })).toEqual(detail.slice(0, 2));
        }
      }
    }
  });

  it('flux réel : la proposition naît à l’envoi, reçoit son issue, et sa ligne du registre ouvre sa fiche avec le motif typé', async () => {
    const pending = useAgentOrders.getState().propose(ORDER, 'llm');
    // Remise au desk : un objet sans issue, lu comme le process principal le lit (`parseProposal`).
    const [inFlight] = useAgentOrders.getState().proposals;
    expect(inFlight).toMatchObject({ origin: 'llm', account: 'sim101', instrument: 'MNQ 12-26', side: 'buy', qty: 3, type: 'market', reason: ORDER.reason, outcome: null, seq: null });
    expect(fake.calls).toHaveLength(1);
    fake.release!({ status: 'refused', reason: 'quantity', detail: 'au plus 1 contrat(s) par ordre de l’agent' });
    await pending;
    const [decided] = useAgentOrders.getState().proposals;
    const ev = deskEventLog.last()!;
    expect(decided).toMatchObject({ id: inFlight!.id, outcome: { status: 'refused', reason: 'quantity' }, seq: ev.seq });
    expect(useAgentOrders.getState().last?.id).toBe(inFlight!.id);

    const ctx: RegistreContext = { sessions: SESSIONS, trades: [], catalysts: [], proposals: useAgentOrders.getState().proposals };
    expect(eventTarget(ev, ctx)).toEqual({ type: 'proposition', id: inFlight!.id });
    // Sortie de la mémoire : la ligne ouvre son compte, comme avant.
    expect(eventTarget(ev, { ...ctx, proposals: [] })).toEqual({ type: 'compte', id: SIM });
    expect(activityOf({ type: 'proposition', id: inFlight!.id }, logEvents(deskEventLog), ctx)).toEqual([ev]);
    // Le motif est celui que la garde a typé, jamais un texte reconnu.
    expect(eventLine(ev).detail).toBe('achat 3 · refusée par la garde · trop de contrats par ordre');
    useI18n.setState({ locale: 'en' });
    expect(eventLine(ev).detail).toBe('buy 3 · refused by the guard · too many contracts per order');
  });

  it('la colonne et la fiche : C.092 ouvre la fiche, liée au compte, à l’instrument et à la séance ; aucun bouton n’accepte l’ordre ; un refus sans rouge', async () => {
    await propose({ ...ORDER, account: SIM, qty: 1, reason: 'Alléger d’un contrat.', side: 'sell' }, 'mcp', { status: 'sent', orderId: 'nt-7', latencyMs: 12, account: SIM, instrument: 'MNQ 12-26', side: 'sell', qty: 1, resulting: 0 });
    await propose(ORDER, 'llm', { status: 'refused', reason: 'quantity', detail: 'au plus 1 contrat(s) par ordre de l’agent' });
    const node = await mount(
      createElement('div', null, createElement(Propositions), createElement(ObjectDrawer)),
    );
    const cards = [...node.querySelectorAll<HTMLElement>('[data-proposal]')];
    expect(cards.map((c) => c.dataset.outcome)).toEqual(['refused', 'sent']);
    // Le seul bouton de la colonne est la chaîne C.092 de chaque carte, qui ouvre la fiche.
    const buttons = [...node.querySelectorAll<HTMLButtonElement>('aside[data-proposals] button')];
    expect(buttons.map((b) => b.dataset.proposalOpen)).toEqual(['', '']);
    const refused = cards[0]!;
    expect(refused.querySelector('[data-cell="quantity"]')?.getAttribute('data-state')).toBe('stop');
    expect(refused.querySelector('[data-refusal]')?.textContent).toContain('Refusée par la garde');
    expect(refused.textContent).toContain('trop de contrats par ordre');
    expect(refused.textContent).toContain(`« ${ORDER.reason} »`);
    expect(refused.querySelector('[data-dialog]')?.textContent).toBe(`ACHAT 3 × MNQ 12-26 au marchéCompte : sim101`);
    expect(refused.innerHTML).not.toMatch(/signal|--neg|ember/i);
    // L'ordre envoyé dit la position lue par la garde, et sa réduction de risque.
    expect(cards[1]!.querySelector('[data-dialog]')?.textContent).toContain('Position : +1 → 0');
    expect(cards[1]!.textContent).toContain('Ordre proposé par un agent externe (MCP)');

    await act(async () => buttons[0]!.click());
    const id = useAgentOrders.getState().proposals[0]!.id;
    expect(useObjects.getState().open).toEqual({ type: 'proposition', id });
    // ↑ ↓ y passent d'une proposition à l'autre.
    expect(useObjects.getState().siblings).toEqual(useAgentOrders.getState().proposals.map((p) => ({ type: 'proposition', id: p.id })));
    const drawer = node.querySelector<HTMLElement>('[data-drawer="proposition"]')!;
    expect(drawer.querySelector('[data-fiche="title"]')?.textContent).toBe('Proposition · ACHAT 3 × MNQ 12-26 · sim101');
    // Ses liens se lisent à l'ouverture : le compte tel que le journal l'écrit, l'instrument par sa racine, la séance du jour.
    expect([...drawer.querySelectorAll<HTMLElement>('[data-object]')].map((b) => b.dataset.object)).toEqual(['compte:Sim101', 'instrument:MNQ', 'session:s1']);
    expect(drawer.querySelector('[data-section="activity"] [data-kind="agent_order"]')).not.toBeNull();
    const all = [...node.querySelectorAll<HTMLButtonElement>('button')];
    expect(all.filter((b) => ACCEPT.test(`${b.textContent} ${b.getAttribute('aria-label') ?? ''} ${b.title}`)).map((b) => b.textContent)).toEqual([]);
    expect(node.textContent).toContain('aucun bouton ici n’accepte l’ordre');

    // Le lien du compte ouvre sa fiche, par un saut que Retour arrière défait.
    await act(async () => drawer.querySelector<HTMLButtonElement>('[data-object="compte:Sim101"]')!.click());
    expect(useObjects.getState().open).toEqual({ type: 'compte', id: SIM });
    act(() => void useObjects.getState().back());
    expect(useObjects.getState().open).toEqual({ type: 'proposition', id });
  });

  it('Ctrl+J la trouve : le groupe des propositions, son issue, son jour', async () => {
    await propose(ORDER, 'orch', { status: 'declined', detail: 'refusé par le trader' });
    const src: IndexSources = { sessions: SESSIONS, trades: [], notes: [], catalysts: [], links: [], cryptoEnabled: false, proposals: useAgentOrders.getState().proposals };
    const index = buildObjectIndex(src, NOW, 'fr');
    const item = index.find((x) => x.group === 'proposition')!;
    expect(item).toMatchObject({ glyph: 'proposal', title: 'ACHAT 3 × MNQ 12-26 · sim101', stroke: 'plein', date: '2026-10-14', target: { kind: 'object', ref: { type: 'proposition', id: useAgentOrders.getState().proposals[0]!.id } } });
    expect(item.meta).toMatch(/^non envoyée · \d{2}:\d{2}:\d{2} ET$/);
    expect(searchObjectIndex(index, 'proposition plus-bas', NOW, 'fr').map((g) => g.group)).toEqual(['proposition']);
  });

  it('le délai vient de la constante ; aucune source ne branche propose ni une démonstration ; aucun rouge sur un refus', () => {
    for (const locale of ['fr', 'en', 'es'] as Locale[]) {
      useI18n.setState({ locale });
      expect(proposalFoot()).toContain(`${AGENT_CONFIRM_TIMEOUT_MS / 1000} s`);
    }
    const files = ['src/app/objects/proposals.ts', 'src/app/objects/ProposalFiche.tsx', 'src/modules/agent/Propositions.tsx', 'src/app/objects/proposal.module.css'];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/DEMO_|\bdemo/i);
      expect(text, file).not.toMatch(/\.propose\b|\bpropose\s*\(/);
      // Le délai n'est ni écrit à la main ni reconnu dans un texte.
      expect(text, file).not.toMatch(/\b45(?:\s*s\b|_?000)|\/45\//);
    }
    const css = readFileSync('src/app/objects/proposal.module.css', 'utf8');
    expect(css).not.toMatch(/--signal|--neg|--ember/);
    const column = cssRules(readFileSync('src/modules/agent/agent.module.css', 'utf8')).filter((r) => /\.proposals|\.conversation/.test(r.selector));
    expect(column.length).toBeGreaterThan(0);
    expect(column.map((r) => r.body).join('\n')).not.toMatch(/--signal|--neg|--ember|--gold/);
  });
});
