/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCloudStatus } from '@/lib/desk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => {
  const state = { calls: [] as unknown[][] };
  const note =
    (name: string) =>
    async (...args: unknown[]) => {
      state.calls.push([name, ...args]);
      return null;
    };
  (window as unknown as { canto: unknown }).canto = {
    agentCloud: {
      status: async () => null,
      list: async () => [],
      read: async () => null,
      markRead: note('markRead'),
      setKey: note('setKey'),
      setWorkspace: note('setWorkspace'),
      setDeployment: note('setDeployment'),
      setSchedule: note('setSchedule'),
      pull: note('pull'),
      provision: note('provision'),
      run: note('run'),
      pause: note('pause'),
      unpause: note('unpause'),
      train: note('train'),
      stopTraining: note('stopTraining'),
      openFolder: async () => true,
      onStatus: () => () => undefined,
      onReports: () => () => undefined,
    },
  };
  return state;
});

import { CloudOptions } from '@/modules/agent/CloudOptions';
import { LabPlate } from '@/modules/agent/CloudReports';
import { useI18n } from '@/i18n';
import { resetAgentCloudForTests, useAgentCloud } from '@/store/agentCloud';

const DEPLOYMENT = { name: 'canto-rapport-quotidien', state: 'active' as const, pausedReason: null, cron: '0 7 * * 1-5', timezone: 'Europe/Paris', nextRunAt: 1, lastRunAt: null, budgetCents: 300, agentVersion: 2, memoryStoreId: null };
const status = (over: Partial<AgentCloudStatus> = {}): AgentCloudStatus => ({
  available: true,
  lab: true,
  keyStored: false,
  workspaceId: null,
  deploymentId: null,
  managed: false,
  memoryStoreId: null,
  schedule: { cron: '0 7 * * 1-5', timezone: 'Europe/Paris' },
  deployment: null,
  pulling: false,
  busy: null,
  lastPullAt: null,
  nextPullAt: null,
  error: null,
  pending: 0,
  failures: [],
  reports: 0,
  unread: 0,
  training: { state: 'idle', sessionId: null, startedAt: null, sessions: 0, solo: false, spent30dCents: 0, unknownCost: 0, costCents: null, budgetCents: null, capped: false, report: null, reportId: null, detail: null, progress: null },
  ...over,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  resetAgentCloudForTests();
  fake.calls.length = 0;
  useI18n.setState({ locale: 'fr' });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(s: AgentCloudStatus): Promise<HTMLDivElement> {
  useAgentCloud.setState({ ready: true, status: s });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(CloudOptions));
  });
  return host;
}

const button = (node: HTMLElement, label: string) => [...node.querySelectorAll('button')].find((b) => b.textContent === label);
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const press = (b: HTMLButtonElement | undefined) => act(async () => b?.click());

describe('agent cloud · Options › Agent cloud', () => {
  it('la clé ne part qu’au clic sur Enregistrer, nettoyée, et le champ se vide ; Effacer l’oublie', async () => {
    const node = await mount(status());
    const input = node.querySelector<HTMLInputElement>('input[type="password"]')!;
    await type(input, '  sk-ant-api03-cle-de-test-0123456789  ');
    expect(fake.calls).toEqual([]);
    await press(button(node, 'Enregistrer'));
    expect(fake.calls).toEqual([['setKey', 'sk-ant-api03-cle-de-test-0123456789']]);
    expect(input.value).toBe('');
    expect(button(node, 'Effacer')).toBeUndefined();
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true }) }));
    expect(node.textContent).toContain('chiffrée par le trousseau du système');
    await press(button(node, 'Effacer'));
    expect(fake.calls.at(-1)).toEqual(['setKey', '']);
  });

  it('CLD23 espace de travail : part nettoyé au clic sur Enregistrer ; gardé, il s’affiche ; Effacer l’oublie', async () => {
    const WRK = 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ';
    const node = await mount(status({ keyStored: true }));
    const input = node.querySelector<HTMLInputElement>('input[aria-label="Espace de travail de la clé"]')!;
    const own = (label: string) => [...input.parentElement!.querySelectorAll('button')].find((b) => b.textContent === label);
    expect(node.textContent).toContain('nécessaire avec une clé d’utilisateur (sk-ant-usr-…)');
    expect(own('Enregistrer')?.disabled).toBe(true);
    expect(own('Effacer')).toBeUndefined();
    await type(input, `  ${WRK}  `);
    await press(own('Enregistrer'));
    expect(fake.calls).toEqual([['setWorkspace', WRK]]);
    expect(input.value).toBe('');
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true, workspaceId: WRK }) }));
    expect(input.placeholder).toBe(WRK);
    expect(node.textContent).toContain('en-tête anthropic-workspace-id');
    await press(own('Effacer'));
    expect(fake.calls.at(-1)).toEqual(['setWorkspace', '']);
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true, workspaceId: WRK, busy: 'provision' }) }));
    expect(own('Effacer')?.disabled).toBe(true);
  });

  it('installer : impossible sans clé ; « mettre à jour » une fois installé ; jamais sur un déploiement externe', async () => {
    const bare = await mount(status());
    expect(button(bare, 'Installer l’agent cloud')?.disabled).toBe(true);
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true }) }));
    expect(button(bare, 'Installer l’agent cloud')?.disabled).toBe(false);
    await press(button(bare, 'Installer l’agent cloud'));
    expect(fake.calls).toEqual([['provision']]);
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai', managed: true, deployment: DEPLOYMENT }) }));
    expect(button(bare, 'Mettre à jour l’agent')).toBeDefined();
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai', managed: false, deployment: DEPLOYMENT }) }));
    expect(button(bare, 'Installer l’agent cloud')?.disabled).toBe(true);
    expect(bare.textContent).toContain('déploiement externe : relevé et lancé sur demande, jamais modifié, suspendu ni repris par le desk');
    expect(button(bare, 'Suspendre')?.disabled).toBe(true);
    expect(button(bare, 'Lancer maintenant')?.disabled).toBe(false);
  });

  it('commandes : lancer, suspendre ou reprendre selon l’état ; une commande en cours fige les autres', async () => {
    const node = await mount(status({ keyStored: true, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai', managed: true, deployment: DEPLOYMENT }));
    await press(button(node, 'Lancer maintenant'));
    await press(button(node, 'Suspendre'));
    expect(button(node, 'Reprendre')).toBeUndefined();
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai', managed: true, deployment: { ...DEPLOYMENT, state: 'paused', pausedReason: 'manual' } }) }));
    await press(button(node, 'Reprendre'));
    expect(fake.calls).toEqual([['run'], ['pause'], ['unpause']]);
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai', managed: true, deployment: DEPLOYMENT, busy: 'run' }) }));
    expect(button(node, 'Lancement…')?.disabled).toBe(true);
    expect(button(node, 'Suspendre')?.disabled).toBe(true);
  });

  it('planification : retenue seulement si elle change ; un écart avec le déploiement est signalé', async () => {
    const node = await mount(status({ keyStored: true, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai', managed: true, deployment: DEPLOYMENT }));
    const keep = () => button(node, 'Retenir la planification');
    expect(keep()?.disabled).toBe(true);
    const [cron, zone] = [...node.querySelectorAll<HTMLInputElement>('input.mono')].filter((i) => i.getAttribute('aria-label') !== 'Espace de travail de la clé');
    await type(cron!, ' 30 13 * * 1-5 ');
    await type(zone!, 'America/New_York');
    await press(keep());
    expect(fake.calls).toEqual([['setSchedule', { cron: '30 13 * * 1-5', timezone: 'America/New_York' }]]);
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai', managed: true, deployment: DEPLOYMENT, schedule: { cron: '30 13 * * 1-5', timezone: 'America/New_York' } }) }));
    expect(node.textContent).toContain('différente du déploiement : appliquée à la prochaine mise à jour');
  });

  it('déploiement de la Console : relevé sur demande, oubliable ; l’erreur du pont est affichée', async () => {
    const node = await mount(status({ keyStored: true, error: 'Déploiement introuvable dans cette organisation.' }));
    const input = [...node.querySelectorAll<HTMLInputElement>('input.mono')].at(-1)!;
    await type(input, ' depl_011CZkZcDH3vPqd7xnEfwTai ');
    await press(button(node, 'Relever celui-ci'));
    expect(fake.calls).toEqual([['setDeployment', 'depl_011CZkZcDH3vPqd7xnEfwTai']]);
    expect(node.textContent).toContain('Déploiement introuvable dans cette organisation.');
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai' }) }));
    await press(button(node, 'Oublier'));
    expect(fake.calls.at(-1)).toEqual(['setDeployment', null]);
    // Le déploiement du desk se « quitte » (dialogue de suspension dans le process principal) ; rien ne bouge pendant une action.
    await act(async () => useAgentCloud.setState({ status: status({ keyStored: true, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai', managed: true, busy: 'run' }) }));
    expect(button(node, 'Quitter')?.disabled).toBe(true);
    expect(button(node, 'Effacer')?.disabled).toBe(true);
    await type(node.querySelector<HTMLInputElement>('input[type="password"]')!, 'sk-ant-api03-cle-de-test-0123456789');
    expect(button(node, 'Enregistrer')?.disabled).toBe(true);
    expect(button(node, 'Relever celui-ci')?.disabled).toBe(true);
  });

  it('CLD48 D · Lab dit la formation et la lance, la reprend ou l’arrête par le process principal', async () => {
    const IDLE = status().training;
    const STORE = 'memstore_011CZkZ9X2dpNyB7HsEFoRfW';
    const ready = (training: Partial<AgentCloudStatus['training']> = {}, over: Partial<AgentCloudStatus> = {}) =>
      status({ keyStored: true, memoryStoreId: STORE, deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai', managed: true, deployment: DEPLOYMENT, training: { ...IDLE, ...training }, ...over });
    const node = await mount(status({ keyStored: true }));
    // Sans magasin (installation pas encore faite), « Former » est figé et la ligne dit pourquoi.
    expect(button(node, 'Former l’agent')?.disabled).toBe(true);
    expect(node.textContent).toContain('La formation demande le magasin de savoir : installez ou mettez à jour l’agent d’abord.');
    // Première fois : « Former l'agent », qui passe par la méthode nommée ; aucun arrêt proposé.
    await act(async () => useAgentCloud.setState({ status: ready() }));
    expect(button(node, 'Former l’agent')?.disabled).toBe(false);
    expect(button(node, 'Arrêter la formation')).toBeUndefined();
    await press(button(node, 'Former l’agent'));
    expect(fake.calls).toEqual([['train']]);
    // Pendant le dialogue : « Formation… », et tout est figé.
    await act(async () => useAgentCloud.setState({ status: ready({}, { busy: 'train' }) }));
    expect(button(node, 'Formation…')?.disabled).toBe(true);
    expect(button(node, 'Lancer maintenant')?.disabled).toBe(true);
    // En cours : pas de second lancement ; « Arrêter la formation » passe par sa méthode, sans rien d'autre.
    await act(async () => useAgentCloud.setState({ status: ready({ state: 'running', sessionId: 'sesn_011CZkZAtmR3yMPDzynEDx40', sessions: 1, costCents: 640, budgetCents: 2500 }) }));
    expect(button(node, 'Reprendre la formation')?.disabled).toBe(true);
    expect(node.textContent).toContain('Formation en cours · session 6,40 $ / 25,00 $');
    await press(button(node, 'Arrêter la formation'));
    expect(fake.calls.at(-1)).toEqual(['stopTraining']);
    await act(async () => useAgentCloud.setState({ status: ready({ state: 'running', sessionId: 'sesn_011CZkZAtmR3yMPDzynEDx40', sessions: 1 }, { busy: 'stop' }) }));
    expect(button(node, 'Arrêt…')?.disabled).toBe(true);
    // Au repos, rapport attendu : ni lancement ni arrêt.
    await act(async () => useAgentCloud.setState({ status: ready({ state: 'settling', sessionId: 'sesn_011CZkZAtmR3yMPDzynEDx40', sessions: 1 }) }));
    expect(button(node, 'Reprendre la formation')?.disabled).toBe(true);
    expect(button(node, 'Arrêter la formation')).toBeUndefined();
    // Réglée : « Reprendre la formation ».
    await act(async () => useAgentCloud.setState({ status: ready({ state: 'ended', sessions: 1, report: 'filed', reportId: 'sesn_011CZkZAtmR3yMPDzynEDx40' }) }));
    expect(button(node, 'Reprendre la formation')?.disabled).toBe(false);
    await press(button(node, 'Reprendre la formation'));
    expect(fake.calls.at(-1)).toEqual(['train']);
    // Accès refusé par le site : fermé, et dit.
    await act(async () => useAgentCloud.setState({ status: ready({ state: 'refused', sessions: 1 }) }));
    expect(button(node, 'Reprendre la formation')?.disabled).toBe(true);
    expect(node.textContent).toContain('Formation close : l’accès à quantmemo.com est refusé (robots.txt ou conditions d’utilisation) ; la rouvrir est une décision de l’ADMIN.');
    // Sans clé : figé.
    await act(async () => useAgentCloud.setState({ status: ready({}, { keyStored: false }) }));
    expect(button(node, 'Former l’agent')?.disabled).toBe(true);
    // Aucun champ nouveau : les champs cron, fuseau et Console restent les seuls `input.mono` après l'espace de travail.
    expect(node.querySelectorAll('input.mono')).toHaveLength(4);
    expect(fake.calls).toEqual([['train'], ['stopTraining'], ['train']]);

    // La plaque : l'état, le savoir, la dépense, le montage chez l'analyste.
    act(() => root?.unmount());
    const plate = async (s: AgentCloudStatus) => {
      root = createRoot(host!);
      await act(async () => root?.render(createElement(LabPlate, { status: s })));
      const text = host!.textContent ?? '';
      const signals = host!.querySelectorAll('[data-level="2"]').length;
      act(() => root?.unmount());
      return { text, signals };
    };
    const progress = { fiches: 39, fichesAtStart: 31, coursesRead: 46, coursesKnown: 174, toVerify: 6, next: 'Greeks', access: 'autorise' as const, at: 1 };
    const running = await plate(ready({ state: 'running', sessionId: 'sesn_011CZkZAtmR3yMPDzynEDx41', sessions: 2, costCents: 640, budgetCents: 2500, spent30dCents: 2515, progress }));
    expect(running.text).toContain('FormationEn cours');
    expect(running.text).toContain('Savoir39 fiches · 46 cours lus sur 174');
    expect(running.text).toContain('Dépense formationsession 6,40 $ / 25,00 $ · 30 j 25,15 $');
    expect(running.text).toContain('Savoir montéNon monté : mettre à jour l’agent');
    const ended = await plate(ready({ state: 'ended', sessions: 2, costCents: 1875, report: 'filed', progress }, { deployment: { ...DEPLOYMENT, memoryStoreId: STORE } }));
    expect(ended.text).toContain('FormationTerminée');
    expect(ended.text).toContain('Savoir39 fiches · 46 cours lus sur 174 · +8 cette session');
    expect(ended.text).toContain('Savoir montéLecture seule');
    expect((await plate(ready({ state: 'ended', sessions: 1, capped: true, report: 'missing' }))).text).toContain('FormationÀ son plafond');
    expect((await plate(ready({ state: 'ended', sessions: 1, report: 'missing', detail: 'outcome interrupted' }))).text).toContain('FormationArrêtée');
    // CLD52 : une session oubliée parce que la clé ne la voit plus le dit, au lieu de « Terminée sans rapport ».
    expect((await plate(ready({ state: 'ended', sessions: 1, report: 'lost', detail: 'HTTP 404' }))).text).toContain('FormationIntrouvable avec cette clé');
    expect((await plate(ready({ state: 'settling', sessions: 1 }))).text).toContain('FormationEn attente du rapport');
    const idle = await plate(ready());
    expect(idle.text).toContain('Formation—');
    expect(idle.text).toContain('Savoir—');
    const refused = await plate(ready({ state: 'refused', sessions: 1 }));
    expect(refused.text).toContain('FormationAccès refusé');
    expect(refused.signals).toBe(1);
    expect(refused.text).toContain('Formation close : accès à quantmemo.com refusé');
    // Rien de la formation n'entre dans les échecs du rapport quotidien.
    expect(running.signals).toBe(0);
  });
});
