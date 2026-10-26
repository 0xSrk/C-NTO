/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudReport, CloudReportSummary } from '@/engine/agent/cloudReport';
import type { AgentCloudStatus } from '@/lib/desk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => {
  const state = { reports: new Map<string, unknown>(), marked: [] as string[] };
  (window as unknown as { canto: unknown }).canto = {
    agentCloud: {
      status: async () => null,
      list: async () => [],
      read: async (id: string) => state.reports.get(id) ?? null,
      markRead: async (id: string) => {
        state.marked.push(id);
        return null;
      },
      onStatus: () => () => undefined,
      onReports: () => () => undefined,
    },
  };
  return state;
});

import { CloudReports, cloudState, decorateLinks } from '@/modules/agent/CloudReports';
import { useI18n } from '@/i18n';
import { resetAgentCloudForTests, useAgentCloud } from '@/store/agentCloud';

const NOW = Date.parse('2026-10-27T08:00:00Z');
const status = (over: Partial<AgentCloudStatus> = {}): AgentCloudStatus => ({
  available: true,
  keyStored: true,
  deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai',
  managed: true,
  schedule: { cron: '0 7 * * 1-5', timezone: 'Europe/Paris' },
  deployment: { name: 'canto-rapport-quotidien', state: 'active', pausedReason: null, cron: '0 7 * * 1-5', timezone: 'Europe/Paris', nextRunAt: NOW + 86_400_000, lastRunAt: NOW - 3_600_000, budgetCents: 300, agentVersion: 2 },
  pulling: false,
  busy: null,
  lastPullAt: NOW,
  nextPullAt: NOW + 900_000,
  error: null,
  pending: 0,
  failures: [],
  reports: 2,
  unread: 1,
  ...over,
});
const summary = (id: string, date: string, read: boolean, receivedAt: number): CloudReportSummary => ({ id, date, title: `Brief du ${date}`, summary: 'Deux catalyseurs.', generatedAt: null, receivedAt, read });
const report = (s: CloudReportSummary): CloudReport => ({
  v: 1,
  ...s,
  sections: [{ heading: 'Calendrier', body: '**14:30** CPI <script>alert(1)</script> [BLS](https://www.bls.gov/cpi/) [piège](javascript:alert(1))' }],
  sources: [{ title: 'BLS', url: 'https://www.bls.gov/cpi/' }],
  session: { id: s.id, createdAt: null, costCents: 64, agentVersion: 2 },
});

const NEW = summary('sesn_011CZkZAtmR3yMPDzynEDx02', '2026-10-27', false, NOW);
const OLD = summary('sesn_011CZkZAtmR3yMPDzynEDx01', '2026-10-26', true, NOW - 86_400_000);

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  resetAgentCloudForTests();
  fake.reports.clear();
  fake.marked.length = 0;
  fake.reports.set(NEW.id, report(NEW));
  fake.reports.set(OLD.id, report(OLD));
  useI18n.setState({ locale: 'fr' });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(active = true, onOptions = () => undefined): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(CloudReports, { active, onOptions }));
  });
  return host;
}

const text = (node: Element | null | undefined) => node?.textContent ?? '';

describe('agent cloud · dossier des rapports (Système 4.0)', () => {
  it('l’état de la plaque suit le pont : construction, service, pause, défaut, archivé', () => {
    expect(cloudState(null)).toBe('construction');
    expect(cloudState(status({ keyStored: false }))).toBe('construction');
    expect(cloudState(status({ deployment: null }))).toBe('construction');
    expect(cloudState(status())).toBe('service');
    expect(cloudState(status({ deployment: { ...status().deployment!, state: 'paused' } }))).toBe('paused');
    expect(cloudState(status({ error: 'HTTP 529' }))).toBe('fault');
    expect(cloudState(status({ deployment: { ...status().deployment!, state: 'archived' } }))).toBe('archived');
  });

  it('dossier en construction : plaque au trait tireté, renvoi aux options, aucune fiche', async () => {
    const onOptions = vi.fn();
    useAgentCloud.setState({ ready: true, status: status({ keyStored: false, deploymentId: null, deployment: null }), reports: [] });
    const node = await mount(true, onOptions);
    const plate = node.querySelector('section[aria-label="Agent cloud"]');
    expect(plate?.className).toMatch(/dashed/);
    expect(text(plate)).toContain('En construction');
    expect(text(node)).toContain('Dossier en construction');
    const button = [...node.querySelectorAll('button')].find((b) => b.textContent === 'Ouvrir les options');
    await act(async () => button?.click());
    expect(onOptions).toHaveBeenCalledTimes(1);
  });

  it('en service : trait plein et LED, fiche prévue au trait tireté, fiches codées, la non lue porte la LED', async () => {
    useAgentCloud.setState({ ready: true, status: status(), reports: [NEW, OLD] });
    const node = await mount(false);
    const plate = node.querySelector('section[aria-label="Agent cloud"]');
    expect(plate?.className).toMatch(/solid/);
    expect(text(plate)).toContain('En service');
    expect(text(plate)).toContain('3,00 $ / exéc.');
    const items = [...node.querySelectorAll('li')];
    expect(items[0]?.className).toMatch(/planned/);
    expect(text(items[0])).toContain('Prochain rapport');
    expect(text(items[1])).toContain('AGT-RPT-20261027');
    expect(text(items[2])).toContain('AGT-RPT-20261026');
    expect(items[1]?.querySelector('[class*="led"]')).not.toBeNull();
    expect(items[2]?.querySelector('[class*="led"]')).toBeNull();
    expect(text(node)).toContain('2 fiches');
    // Inactif (autre sous-onglet) : rien n'est ouvert ni marqué lu.
    expect(fake.marked).toEqual([]);
  });

  it('actif : le dernier rapport s’ouvre et se marque lu ; le Markdown est assaini', async () => {
    useAgentCloud.setState({ ready: true, status: status(), reports: [NEW, OLD] });
    const node = await mount(true);
    await act(async () => undefined);
    expect(fake.marked).toEqual([NEW.id]);
    const sheet = node.querySelector('article');
    expect(text(sheet?.querySelector('h2'))).toBe('Brief du 2026-10-27');
    expect(sheet?.querySelector('script')).toBeNull();
    expect(sheet?.innerHTML).not.toContain('javascript:');
    expect(text(sheet)).toContain('0,64 $');
    expect(node.querySelector('button[aria-current="true"]')?.textContent).toContain('AGT-RPT-20261027');
  });

  it('un lien https s’ouvre dans le navigateur du système ; un autre lien ne fait rien', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    useAgentCloud.setState({ ready: true, status: status(), reports: [NEW] });
    const node = await mount(true);
    await act(async () => undefined);
    const links = [...(node.querySelector('article')?.querySelectorAll('a') ?? [])];
    const bls = links.find((a) => a.textContent === 'BLS' && a.closest('footer') === null);
    const trap = links.find((a) => a.textContent === 'piège');
    await act(async () => bls?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await act(async () => trap?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(open.mock.calls).toEqual([['https://www.bls.gov/cpi/', '_blank', 'noopener,noreferrer']]);
    open.mockRestore();
  });

  it('CLD16 chaque lien du corps montre l’hôte où il mène ; un lien hors https perd son adresse', () => {
    const html = decorateLinks('<p><a href="https://fomc-statement.example/login">Communiqué FOMC officiel</a> <a href="http://127.0.0.1:47118/mcp">local</a> <a>sans adresse</a></p>');
    const box = document.createElement('div');
    box.innerHTML = html;
    const [phish, local] = [...box.querySelectorAll('a')];
    expect(phish?.getAttribute('href')).toBe('https://fomc-statement.example/login');
    expect(phish?.nextElementSibling?.textContent).toBe('fomc-statement.example');
    expect(local?.hasAttribute('href')).toBe(false);
    expect(box.textContent).toContain('local');
  });

  it('CLD16 le clic du milieu passe par la même règle : https dans le navigateur du système, rien d’autre', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    useAgentCloud.setState({ ready: true, status: status(), reports: [NEW] });
    const node = await mount(true);
    await act(async () => undefined);
    const bls = [...(node.querySelector('article')?.querySelectorAll('a') ?? [])].find((a) => a.textContent === 'BLS' && a.closest('footer') === null);
    await act(async () => bls?.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })));
    expect(open.mock.calls).toEqual([['https://www.bls.gov/cpi/', '_blank', 'noopener,noreferrer']]);
    open.mockRestore();
  });

  it('erreur et échecs : signaux de niveau 2 et 1, jamais de niveau 3', async () => {
    useAgentCloud.setState({
      ready: true,
      status: status({ error: 'Clé refusée par Anthropic (401) : enregistrez une clé valide.', failures: [{ at: NOW, kind: 'no_report', detail: 'terminated' }] }),
      reports: [],
    });
    const node = await mount(false);
    const levels = [...node.querySelectorAll('[data-level]')].map((el) => el.getAttribute('data-level'));
    expect(levels).toEqual(['2', '1']);
    expect(text(node)).toContain('Session finie sans rapport · terminated');
    expect(node.querySelector('section[aria-label="Agent cloud"]')?.className).toMatch(/dotted/);
  });

  it('CLD17 un rapport plus récent et non lu prend la place d’une fiche déjà ouverte, une fois ; un choix de l’opérateur est gardé', async () => {
    useAgentCloud.setState({ ready: true, status: status(), reports: [{ ...OLD, read: true }] });
    await mount(true);
    await act(async () => undefined);
    expect(useAgentCloud.getState().selectedId).toBe(OLD.id);
    await act(async () => useAgentCloud.setState({ reports: [NEW, { ...OLD, read: true }] }));
    await act(async () => undefined);
    expect(useAgentCloud.getState().selectedId).toBe(NEW.id);
    await act(async () => useAgentCloud.getState().select(OLD.id));
    await act(async () => undefined);
    expect(useAgentCloud.getState().selectedId).toBe(OLD.id);
  });

  it('CLD17 le lecteur repart du haut à chaque fiche, et n’annonce pas tout le rapport', async () => {
    useAgentCloud.setState({ ready: true, status: status(), reports: [NEW, OLD] });
    const node = await mount(true);
    await act(async () => undefined);
    const reader = node.querySelector<HTMLElement>('article')?.parentElement;
    expect(reader?.hasAttribute('aria-live')).toBe(false);
    reader!.scrollTop = 900;
    await act(async () => useAgentCloud.getState().select(OLD.id));
    expect(reader?.scrollTop).toBe(0);
  });

  it('CLD17 la fiche prévue prend un code libre : jamais celui d’un rapport déjà rangé ce jour-là', async () => {
    const today = summary('sesn_011CZkZAtmR3yMPDzynEDx03', '2026-10-28', true, NOW);
    useAgentCloud.setState({ ready: true, status: status(), reports: [today] });
    const node = await mount(false);
    const planned = node.querySelector('li[class*="planned"]');
    expect(text(planned)).toContain('AGT-RPT-20261028-2');
  });

  it('CLD17 compte des fiches et libellé « Agent » dans la langue du desk', async () => {
    useI18n.setState({ locale: 'en' });
    useAgentCloud.setState({ ready: true, status: status({ deployment: null }), reports: [] });
    const node = await mount(false);
    expect(text(node)).toContain('0 sheets');
    useI18n.setState({ locale: 'es' });
    useAgentCloud.setState({ ready: true, status: status(), reports: [NEW] });
    const es = await mount(true);
    await act(async () => undefined);
    expect(text(es.querySelector('article'))).toContain('Agente');
  });

  it('suit la langue du desk', async () => {
    useI18n.setState({ locale: 'en' });
    useAgentCloud.setState({ ready: true, status: status(), reports: [NEW] });
    const node = await mount(false);
    expect(text(node)).toContain('In service');
    expect(text(node)).toContain('Next report');
    expect(text(node)).toContain('1 sheet');
  });
});
