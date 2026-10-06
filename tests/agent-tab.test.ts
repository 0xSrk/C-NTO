/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React : act() est attendu dans ce fichier.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Faux desk, posé avant le chargement de `@/lib/desk` : deux passerelles, deux jetons distincts. */
const fake = vi.hoisted(() => {
  const state = {
    mcpToken: 'jeton-mcp-0123456789abcdef',
    orchToken: 'jeton-orch-fedcba9876543210',
    copied: [] as string[],
    /** Appels au fournisseur (`streamChat`). */
    provider: 0,
    /** Messages rangés dans la conversation, et lignes écrites dans `db.settings`. */
    added: [] as { role: string; content: string }[],
    puts: [] as { key: string; value: unknown }[],
    stored: new Map<string, unknown>(),
  };
  const idle = { running: false, port: 0, clients: 0 };
  (window as unknown as { canto: unknown }).canto = {
    orchestrator: {
      start: async () => idle,
      stop: async () => idle,
      status: async () => idle,
      rotateToken: async () => idle,
      copyToken: async () => state.orchToken,
      onRequest: () => () => undefined,
      respond: () => undefined,
      onStatus: () => () => undefined,
      broadcast: () => undefined,
    },
    mcp: {
      start: async () => ({ running: true, port: 47118, calls: 0 }),
      stop: async () => ({ running: false, port: 0, calls: 0 }),
      status: async () => ({ running: true, port: 47118, calls: 0 }),
      rotateToken: async () => ({ running: true, port: 47118, calls: 0 }),
      connection: async () => ({ url: 'http://127.0.0.1:47118/mcp', token: state.mcpToken }),
      onStatus: () => () => undefined,
    },
  };
  return state;
});

// Dexie est remplacé par une coquille ; les tables utiles sont posées dans `beforeEach`.
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

// Fournisseur simulé : chaque appel est compté, la réponse est finale (aucun outil).
vi.mock('@/engine/agent/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/engine/agent/llm')>()),
  streamChat: vi.fn(async () => {
    fake.provider += 1;
    return { text: 'ok', toolCalls: [] };
  }),
}));

import Agent from '@/modules/agent/Agent';
import { renderRoutine } from '@/engine/agent/routines';
import { DEFAULT_TRADER_RULES } from '@/engine/discipline';
import type { Session } from '@/engine/types';
import { useI18n } from '@/i18n';
import { ET_ZONE, zonedToUtc } from '@/lib/time';
import { useAgent } from '@/store/agent';
import { db } from '@/store/db';
import { deskEventLog } from '@/store/deskEvents';
import { useJournal } from '@/store/journal';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  fake.copied.length = 0;
  fake.provider = 0;
  fake.added.length = 0;
  fake.puts.length = 0;
  fake.stored.clear();
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        fake.copied.push(text);
      },
    },
  });
  // jsdom ne fait pas défiler.
  HTMLElement.prototype.scrollTo = () => undefined;
  Object.assign(db as unknown as Record<string, unknown>, {
    settings: {
      get: async (key: string) => (fake.stored.has(key) ? { key, value: fake.stored.get(key) } : undefined),
      put: async (row: { key: string; value: unknown }) => {
        fake.puts.push(row);
        fake.stored.set(row.key, row.value);
      },
    },
    agentMessages: {
      add: async (message: { role: string; content: string }) => {
        fake.added.push(message);
      },
      where: () => ({ equals: () => ({ sortBy: async () => [] }) }),
    },
  });
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
  useJournal.setState({ sessions: [], trades: [] });
  useAgent.setState({ messages: [], streaming: false, streamText: '', pendingTool: null, error: null, notice: null });
  useI18n.setState({ locale: 'fr' });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

async function mount(): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(Agent));
  });
  return host;
}

/** Bloc de l'onglet dont le titre est `title` (titre de section : `span` dans l'en-tête du bloc). */
function section(node: HTMLElement, title: string): HTMLElement {
  const label = [...node.querySelectorAll('span')].find((el) => el.textContent === title);
  const block = label?.parentElement?.parentElement;
  if (!block) throw new Error(`section introuvable : ${title}`);
  return block;
}

function buttons(node: HTMLElement, text: RegExp): HTMLButtonElement[] {
  return [...node.querySelectorAll('button')].filter((b) => text.test(b.textContent ?? ''));
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

/** Laisse filer les promesses en cours (envoi, tour du fournisseur simulé, écritures du coffre). */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  });
}

/** Horloge simulée (minuteries et `Date`) arrêtée à `at`. */
function clock(at: number): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(at);
}

function session(id: string, date: string, pnl: number, tradeCount: number, account = 'PA-1'): Session {
  return { id, date, account, instruments: ['NQ'], source: 'ninjatrader', tradeCount, pnl, grossProfit: Math.max(0, pnl), grossLoss: Math.min(0, pnl), commission: 0, tags: [], createdAt: 0, updatedAt: 0 };
}

/** Bouton de routine (« Brief », « Débrief ») ; sa pastille est un `i` décoratif. */
function routineButton(node: HTMLElement, label: string): HTMLButtonElement {
  const button = [...node.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`bouton introuvable : ${label}`);
  return button;
}

const cue = (button: HTMLButtonElement) => button.querySelector('i[aria-hidden]') !== null;

/** Messages de l'opérateur rangés dans la conversation. */
const userMessages = () => fake.added.filter((m) => m.role === 'user').map((m) => m.content);

/**
 * Journée CME `day` perdue au-delà de la limite du trader (500 $) : le journal porte la perte, et le desk
 * a rangé l'événement `daily_loss` à 100 % comme il le fait en direct.
 */
function lossBeyondLimit(day: string, at: number): void {
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 500 } } });
  useJournal.setState({ sessions: [session(`s-${day}`, day, -650, 3)], trades: [] });
  deskEventLog.push('daily_loss', { day, account: null, threshold: 1, breached: true, consumed: 1.3, loss: 650, limit: 500, source: 'trader', realized: -650, unrealized: 0 }, at);
}

describe('onglet Agent · passerelle MCP', () => {
  it('A14.9 la section MCP copie le jeton de la passerelle MCP, celle de l’orchestrateur garde le sien', async () => {
    const node = await mount();
    const mcp = section(node, 'Agents externes · MCP');
    for (const button of buttons(mcp, /^Copier le jeton/)) await click(button);
    expect(fake.copied).toEqual([fake.mcpToken]);
    expect(buttons(mcp, /^Copier le jeton MCP$/)).toHaveLength(1);

    fake.copied.length = 0;
    const orchestrator = section(node, 'Orchestrateur externe');
    for (const button of buttons(orchestrator, /^Copier le jeton/)) await click(button);
    expect(fake.copied).toEqual([fake.orchToken]);

    for (const [locale, title, label] of [
      ['en', 'External agents · MCP', 'Copy MCP token'],
      ['es', 'Agentes externos · MCP', 'Copiar el token MCP'],
    ] as const) {
      await act(async () => {
        useI18n.setState({ locale });
      });
      fake.copied.length = 0;
      const block = section(node, title);
      const [button] = buttons(block, new RegExp(`^${label}$`));
      expect(button, locale).toBeDefined();
      await click(button!);
      expect(fake.copied).toEqual([fake.mcpToken]);
    }
  });
});

describe('onglet Agent · routines', () => {
  it('A12.4 débrief proposé à 20 h ET un jour de séance : le texte et la journée vue portent la journée CME', async () => {
    // Mardi 6 octobre, 20 h à New York : la journée CME en cours est celle du mercredi 7 (18 h → 17 h).
    const now = zonedToUtc('2026-10-06', '20:00', ET_ZONE);
    clock(now);
    lossBeyondLimit('2026-10-07', now);
    const node = await mount();
    const debrief = routineButton(node, 'Débrief');
    expect(cue(debrief)).toBe(true);
    expect(cue(routineButton(node, 'Brief'))).toBe(false);

    await click(debrief);
    await settle();
    const expected = renderRoutine('session_debrief', { date: '2026-10-07' }, { locale: 'fr', allowWrites: true, now });
    expect(expected.ok).toBe(true);
    expect(userMessages()).toEqual([expected.ok ? expected.text : '']);
    expect(userMessages()[0]).toMatch(/get_session avec date = "2026-10-07"/);
    expect(userMessages()[0]).not.toMatch(/2026-10-06/);
    expect(fake.puts).toEqual([{ key: 'agent.routineSeen', value: { debrief: '2026-10-07' } }]);
    expect(fake.provider).toBe(1);
    expect(cue(routineButton(node, 'Débrief'))).toBe(false);
  });

  it('A12.5 la journée n’est vue que si la routine part : outils coupés ou flux en cours, rien n’est retenu', async () => {
    const now = zonedToUtc('2026-10-06', '08:45', ET_ZONE);
    clock(now);
    // Outils coupés : un avis, rien n'est envoyé ni retenu, la pastille reste.
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, agent: { ...DEFAULT_SETTINGS.agent, toolsEnabled: false } } });
    const node = await mount();
    expect(cue(routineButton(node, 'Brief'))).toBe(true);
    await click(routineButton(node, 'Brief'));
    await settle();
    expect(fake.puts).toEqual([]);
    expect(userMessages()).toEqual([]);
    expect(useAgent.getState().notice).toMatch(/outils du desk sont coupés/);
    expect(cue(routineButton(node, 'Brief'))).toBe(true);
    expect(await useAgent.getState().runRoutine('pre_session_brief', { date: '2026-10-06' })).toBe(false);

    // Flux en cours : boutons désactivés ; la routine ne part pas et rien n'est retenu.
    await act(async () => {
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS } });
      useAgent.setState({ streaming: true, notice: null });
    });
    expect(routineButton(node, 'Brief').disabled).toBe(true);
    expect(routineButton(node, 'Débrief').disabled).toBe(true);
    await click(routineButton(node, 'Brief'));
    await settle();
    expect(await useAgent.getState().runRoutine('pre_session_brief', { date: '2026-10-06' })).toBe(false);
    expect(fake.puts).toEqual([]);
    expect(userMessages()).toEqual([]);
    expect(fake.provider).toBe(0);

    // Flux terminé : le clic part, et la journée CME est retenue.
    await act(async () => {
      useAgent.setState({ streaming: false });
    });
    expect(routineButton(node, 'Brief').disabled).toBe(false);
    await click(routineButton(node, 'Brief'));
    await settle();
    expect(userMessages()).toHaveLength(1);
    expect(fake.provider).toBe(1);
    expect(fake.puts).toEqual([{ key: 'agent.routineSeen', value: { brief: '2026-10-06' } }]);
    expect(cue(routineButton(node, 'Brief'))).toBe(false);
  });

  it('A12.6 aucune routine ne part sans clic : pastilles allumées, minuteries avancées, rien au fournisseur', async () => {
    // Mardi 6 octobre, 8 h 20 à New York : perte du jour déjà atteinte, la pastille du débrief est allumée.
    const start = zonedToUtc('2026-10-06', '08:20', ET_ZONE);
    clock(start);
    lossBeyondLimit('2026-10-06', start);
    const node = await mount();
    expect(cue(routineButton(node, 'Débrief'))).toBe(true);
    expect(cue(routineButton(node, 'Brief'))).toBe(false);
    // Par pas de 5 minutes jusqu'à 9 h 40 : la pastille du brief s'allume à 8 h 30 et s'éteint après 9 h 30.
    const lit: number[] = [];
    for (let minutes = 5; minutes <= 80; minutes += 5) {
      await act(async () => {
        vi.advanceTimersByTime(5 * 60_000);
      });
      if (cue(routineButton(node, 'Brief'))) lit.push(minutes);
    }
    // Puis jusqu'à 17 h d'un seul tenant : la minuterie de l'onglet bat toutes les 30 s.
    await act(async () => {
      vi.advanceTimersByTime((7 * 60 + 20) * 60_000);
    });
    await settle();
    expect(fake.provider).toBe(0);
    expect(userMessages()).toEqual([]);
    expect(fake.puts).toEqual([]);
    expect(lit[0]).toBe(10);
    expect(lit.at(-1)).toBe(70);
    expect(cue(routineButton(node, 'Débrief'))).toBe(true);

    // Le clic, et lui seul, envoie.
    await click(routineButton(node, 'Débrief'));
    await settle();
    expect(fake.provider).toBe(1);
    expect(userMessages()).toHaveLength(1);
    expect(fake.puts).toEqual([{ key: 'agent.routineSeen', value: { debrief: '2026-10-06' } }]);
  });

  it('A12.7 perte du jour recalculée du journal : après un redémarrage (anneau vide), le débrief reste proposé', async () => {
    // Jeudi 8 octobre, 11 h à New York : avant l'heure du débrief, aucun daily_loss rangé pour cette journée.
    const now = zonedToUtc('2026-10-08', '11:00', ET_ZONE);
    clock(now);
    expect(deskEventLog.read({ kinds: ['daily_loss'], limit: 200 }).events.some((event) => event.data.day === '2026-10-08')).toBe(false);
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, traderRules: { ...DEFAULT_TRADER_RULES, maxDailyLoss: 500 } } });
    useJournal.setState({ sessions: [session('s-thu', '2026-10-08', -520, 2)], trades: [] });
    const node = await mount();
    expect(cue(routineButton(node, 'Débrief'))).toBe(true);

    // Sous la limite : rien.
    await act(async () => {
      useJournal.setState({ sessions: [session('s-thu', '2026-10-08', -480, 2)], trades: [] });
    });
    expect(cue(routineButton(node, 'Débrief'))).toBe(false);
    // Limite du plan suivi (Take Profit Trader 50K : 1 100 $), sans règle du trader ; un autre compte ne compte pas.
    await act(async () => {
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'tpt-50', planAccount: 'PA-1' } });
      useJournal.setState({ sessions: [session('s-thu', '2026-10-08', -1_150, 2), session('s-sim', '2026-10-08', 900, 1, 'Sim101')], trades: [] });
    });
    expect(cue(routineButton(node, 'Débrief'))).toBe(true);
    await act(async () => {
      useSettings.setState({ settings: { ...DEFAULT_SETTINGS, planId: 'tpt-50', planAccount: 'Sim101' } });
      useJournal.setState({ sessions: [session('s-thu', '2026-10-08', -1_150, 2), session('s-sim', '2026-10-08', 900, 1, 'Sim101')], trades: [] });
    });
    expect(cue(routineButton(node, 'Débrief'))).toBe(false);
    expect(fake.provider).toBe(0);
  });

  it('A12.7 le texte de la routine suit la langue du desk : anglais, puis espagnol', async () => {
    const now = zonedToUtc('2026-10-06', '08:45', ET_ZONE);
    clock(now);
    const node = await mount();
    for (const locale of ['en', 'es'] as const) {
      await act(async () => {
        useI18n.setState({ locale });
      });
      await click(routineButton(node, 'Brief'));
      await settle();
    }
    const text = (locale: 'en' | 'es') => {
      const out = renderRoutine('pre_session_brief', { date: '2026-10-06' }, { locale, allowWrites: true, now });
      return out.ok ? out.text : '';
    };
    expect(userMessages()).toEqual([text('en'), text('es')]);
    expect(userMessages()[0]).toMatch(/^Prepare the pre-session brief for Tuesday 2026-10-06 \(New York time\)/);
    expect(userMessages()[1]).toMatch(/^Prepara el brief previo a la sesión del martes 2026-10-06 \(hora de Nueva York\)/);
    expect(fake.provider).toBe(2);
  });
});
