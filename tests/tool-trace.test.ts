/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRules } from './helpers/cssRules';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/db')>()),
  getSetting: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setSetting: vi.fn(async () => undefined),
}));

import e from '@/design/etat.module.css';
import { TOOL_PREAMBLE } from '@/engine/agent/catalog';
import type { Session } from '@/engine/types';
import { useI18n } from '@/i18n';
import { ARGS_MAX, argsSummary, readRefs, ToolTrace, traceRows } from '@/modules/agent/ToolTrace';
import type { AgentMessage } from '@/store/db';
import { useJournal } from '@/store/journal';
import { useLinks } from '@/store/links';
import { useNotes } from '@/store/notes';
import { useObjects } from '@/store/objects';

/**
 * OROS5.41 — la trace des outils sous chaque réponse de l'agent (repris du prototype D · Porte, d4) : le nom de l'outil en
 * Geist Mono au glacier, les arguments bornés sans clé ni jeton, l'issue et la durée en millisecondes ; l'appel en cours au
 * tireté de la table d'états, plus de point ni de curseur qui pulse ; « Contexte lu » ouvre la fiche de chaque objet lu.
 */

const session = (id: string, date: string): Session => ({ id, date, account: 'Sim101', instruments: ['MNQ'], source: 'ninjatrader', tradeCount: 1, pnl: 10, grossProfit: 10, grossLoss: 0, commission: 0, tags: [], createdAt: 0, updatedAt: 0 });

const answer = (calls: { id: string; name: string; args: unknown }[], at = 1_000): AgentMessage => ({
  id: 'a1',
  conversationId: 'c1',
  role: 'assistant',
  content: '',
  toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: JSON.stringify(c.args) })),
  createdAt: at,
});
const result = (callId: string, name: string, body: unknown, at: number): AgentMessage => ({ id: `r-${callId}`, conversationId: 'c1', role: 'tool', toolCallId: callId, toolName: name, content: TOOL_PREAMBLE + JSON.stringify(body), createdAt: at });

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(node: ReturnType<typeof createElement>): Promise<HTMLElement> {
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => root!.render(node));
  return host;
}

beforeEach(() => {
  useI18n.setState({ locale: 'fr' });
  useObjects.setState(useObjects.getInitialState(), true);
  useJournal.setState({ sessions: [session('s1', '2026-10-14'), session('s2', '2026-10-13')], trades: [] });
  useNotes.setState({ notes: [] });
  useLinks.setState({ links: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('OROS5.41 la trace des outils sous chaque réponse', () => {
  it('une clé ou un jeton dans les arguments est masqué ; les arguments sont bornés', () => {
    const args = JSON.stringify({ query: 'cpi', api_key: 'abc', token: 'xyz-1', password: 'p', note: 'sk-ant-api03-zzzz', jwt: 'eyJhbGciOiJIUzI1NiJ9.e30.x', blob: 'A'.repeat(40), from: '2026-10-01' });
    const text = argsSummary(args);
    expect(text).toContain('query cpi');
    expect(text).toContain('from 2026-10-01');
    for (const key of ['api_key', 'token', 'password', 'note', 'jwt', 'blob']) expect(text).toContain(`${key} ••••`);
    expect(text).not.toMatch(/abc|xyz-1|sk-ant|eyJ|AAAA/);
    expect(argsSummary(JSON.stringify({ query: 'q'.repeat(400), limit: 10, account: 'Sim101', from: '2026-10-01', to: '2026-10-14', more: 'x'.repeat(50) })).length).toBeLessThanOrEqual(ARGS_MAX);
    expect(argsSummary('ghp_0123456789abcdef0123456789abcdef0123')).toBe('••••');
  });

  it('la durée de chaque appel est affichée, en millisecondes, du début de l’appel à son résultat', async () => {
    const a = answer([
      { id: 'c1', name: 'list_sessions', args: { from: '2026-10-01' } },
      { id: 'c2', name: 'discipline_status', args: {} },
    ]);
    const results = [result('c1', 'list_sessions', { count: 1, sessions: [{ id: 's1' }] }, 1_250), result('c2', 'discipline_status', { day: '2026-10-14' }, 1_400)];
    expect(traceRows(a, results, false).map((row) => [row.name, row.issue, row.ms])).toEqual([
      ['list_sessions', 'ok', 250],
      ['discipline_status', 'ok', 150],
    ]);
    const node = await render(createElement(ToolTrace, { answer: a, results, streaming: false }));
    expect([...node.querySelectorAll('[data-tool]')].map((row) => row.textContent?.includes('250 ms') || row.textContent?.includes('150 ms'))).toEqual([true, true]);
    // Le nom de l'outil en Geist Mono, au glacier.
    const name = cssRules(readFileSync('src/modules/agent/agent.module.css', 'utf8')).find((r) => r.selector === '.traceName')!;
    expect(name.body).toMatch(/font-family: var\(--font-mono\)/);
    expect(name.body).toMatch(/color: var\(--ice\)/);
    // Un refus du desk se dit, avec son motif ; jamais en rouge.
    const refused = traceRows(answer([{ id: 'c3', name: 'propose_order', args: { account: 'Sim101' } }]), [result('c3', 'propose_order', { ok: false, status: 'refused', reason: 'quantity' }, 1_050)], false);
    expect(refused[0]).toMatchObject({ issue: 'refused', why: 'quantity', ms: 50 });
  });

  it('l’appel reste tireté tant qu’il court ; rendu, il passe au plein ; resté sans résultat, il s’éteint', async () => {
    const a = answer([
      { id: 'c1', name: 'get_session', args: { id: 's1' } },
      { id: 'c2', name: 'bridge_status', args: {} },
    ]);
    const first = [result('c1', 'get_session', { session: { id: 's1' } }, 1_120)];
    let node = await render(createElement(ToolTrace, { answer: a, results: first, streaming: true }));
    const mark = (tool: string) => node.querySelector<HTMLElement>(`[data-tool="${tool}"] [data-etat]`)!;
    expect(node.querySelector('[data-tool="bridge_status"]')?.getAttribute('data-issue')).toBe('running');
    expect(mark('bridge_status').className).toContain(e.tirete);
    expect(mark('get_session').className).toContain(e.plein);
    expect(node.querySelector('[data-tool="bridge_status"]')?.textContent).toContain('en cours');
    node = await render(createElement(ToolTrace, { answer: a, results: [...first, result('c2', 'bridge_status', { link: 'live' }, 1_300)], streaming: true }));
    expect(mark('bridge_status').className).toContain(e.plein);
    expect(mark('bridge_status').className).not.toContain(e.tirete);
    node = await render(createElement(ToolTrace, { answer: a, results: first, streaming: false }));
    expect(mark('bridge_status').className).toContain(e.eteint);
  });

  it('aucune animation pulse dans agent.module.css ; ni point ni curseur qui pulse dans la conversation', () => {
    const css = readFileSync('src/modules/agent/agent.module.css', 'utf8');
    expect(css).not.toMatch(/pulse-dot|animation\s*:|animation-name|@keyframes/);
    const agent = readFileSync('src/modules/agent/Agent.tsx', 'utf8');
    expect(agent).not.toMatch(/s\.cursor|s\.pending\b|toolChip, s\.pending/);
    // La trace se pose sous chaque réponse qui appelle des outils.
    expect(agent).toMatch(/<ToolTrace answer=\{m\} results=\{results \?\? \[\]\} streaming=\{streaming\} \/>/);
  });

  it('« Contexte lu » ouvre la fiche de chaque objet lu ; un objet absent du desk, une écriture ou un refus n’y paraissent pas', async () => {
    const a = answer([
      { id: 'c1', name: 'list_sessions', args: { from: '2026-10-01' } },
      { id: 'c2', name: 'create_note', args: { title: 'Synthèse' } },
      { id: 'c3', name: 'get_session', args: { id: 's2' } },
    ]);
    const results = [
      result('c1', 'list_sessions', { count: 2, sessions: [{ id: 's1' }, { id: 's9' }] }, 1_100),
      result('c2', 'create_note', { ok: true, id: 'n7' }, 1_200),
      result('c3', 'get_session', { error: 'introuvable' }, 1_300),
    ];
    expect(readRefs(a.toolCalls![1]!, results[1])).toEqual([]);
    expect(readRefs(a.toolCalls![2]!, results[2])).toEqual([]);
    const node = await render(createElement(ToolTrace, { answer: a, results, streaming: false }));
    const items = [...node.querySelectorAll<HTMLButtonElement>('[data-context-read] button')];
    expect(items.map((b) => b.dataset.object)).toEqual(['session:s1']);
    expect(node.querySelector('[data-context-read]')?.textContent).toContain('Contexte lu · 1 objet');
    await act(async () => items[0]!.click());
    expect(useObjects.getState().open).toEqual({ type: 'session', id: 's1' });
  });
});
