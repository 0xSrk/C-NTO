import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPORT_FORMAT } from '@/engine/agent/cloudReport';
import { CloudApiError, type CloudApi, type DeploymentView } from '../electron/agent-cloud-api';
import { AGENT_CLOUD_FILE, PULL_PENDING_MS } from '../electron/agent-cloud';
import { BUDGET_CENTS_PER_RUN, cloudAgentBody, cloudDeploymentBody, cloudEnvironmentBody, cloudSystemPrompt, OFFICIAL_DOMAINS, OUTCOME_RUBRIC } from '../electron/agent-cloud-definition';
import { AGENT, cloudHarness, DEPL, DEPLOYMENT, ENV, fakeApi, KEY, NOW, sid, type HarnessOptions } from './helpers/agentCloudFakes';

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

const harness = (opts: HarnessOptions = {}) => {
  const h = cloudHarness(dirs, opts);
  h.host.setKey(KEY);
  return h;
};

const installer = (over: Partial<DeploymentView> = {}, extra: Partial<CloudApi> = {}) =>
  fakeApi({
    createEnvironment: async () => ({ id: ENV }),
    updateEnvironment: async () => ({ id: ENV }),
    createAgent: async () => ({ id: AGENT, version: 1 }),
    updateAgent: async () => ({ id: AGENT, version: 2 }),
    createDeployment: async () => ({ ...DEPLOYMENT, ...over }),
    updateDeployment: async () => ({ ...DEPLOYMENT, ...over }),
    pauseDeployment: async () => ({ ...DEPLOYMENT, status: 'paused', pausedReason: 'manual', nextRunAt: null }),
    unpauseDeployment: async () => ({ ...DEPLOYMENT, status: 'active' }),
    ...extra,
  });

const saved = (dir: string) => JSON.parse(readFileSync(path.join(dir, AGENT_CLOUD_FILE), 'utf8'));

describe('agent cloud · définition installée par le desk', () => {
  it('l’agent ne lit que des domaines officiels, n’attend aucune autorisation et n’a aucun outil d’ordre', () => {
    const agent = cloudAgentBody('fr');
    expect(agent.model).toEqual({ id: 'claude-opus-5-5', effort: 'high' });
    expect(agent.tools).toEqual([
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: true, permission_policy: { type: 'always_allow' } },
        configs: [
          { name: 'web_search', enabled: true, allowed_domains: [...OFFICIAL_DOMAINS] },
          { name: 'web_fetch', enabled: true, allowed_domains: [...OFFICIAL_DOMAINS] },
        ],
      },
    ]);
    expect(agent).not.toHaveProperty('mcp_servers');
    expect(JSON.stringify(agent)).not.toMatch(/propose_order|copy\.order|ntbridge/);
  });

  it('le bac à sable : réseau limité aux domaines officiels et à leurs sous-domaines, ni paquets ni MCP', () => {
    const env = cloudEnvironmentBody();
    expect(env.config).toEqual({
      type: 'cloud',
      networking: {
        type: 'limited',
        allowed_hosts: OFFICIAL_DOMAINS.flatMap((d) => [d, `*.${d}`]),
        allow_package_managers: false,
        allow_mcp_servers: false,
      },
    });
  });

  it('le déploiement : résultat attendu au contrat, planification, plafond par exécution', () => {
    const plan = cloudDeploymentBody({ agentId: AGENT, environmentId: ENV, cron: '0 7 * * 1-5', timezone: 'Europe/Paris' });
    expect(plan).toMatchObject({
      agent: AGENT,
      environment_id: ENV,
      schedule: { type: 'cron', expression: '0 7 * * 1-5', timezone: 'Europe/Paris' },
      budget: { type: 'limit', max_list_cost: { amount: String(BUDGET_CENTS_PER_RUN), currency: 'USD' } },
    });
    expect(plan.initial_events).toEqual([expect.objectContaining({ type: 'user.define_outcome', rubric: { type: 'text', content: OUTCOME_RUBRIC }, max_iterations: 2 })]);
    expect(OUTCOME_RUBRIC).toContain(REPORT_FORMAT);
    expect(BUDGET_CENTS_PER_RUN).toBe(300);
  });

  it('la consigne fixe le contrat de sortie et la langue du desk', () => {
    for (const [locale, line] of [
      ['fr', 'Rédige le rapport en français.'],
      ['en', 'Write the report in English.'],
      ['es', 'Redacta el informe en español.'],
    ] as const) {
      const prompt = cloudSystemPrompt(locale);
      expect(prompt).toContain('/mnt/session/outputs/rapport.json');
      expect(prompt).toContain(`"format": "${REPORT_FORMAT}"`);
      expect(prompt.endsWith(line)).toBe(true);
    }
  });
});

describe('agent cloud · installation et commandes, par dialogue du process principal', () => {
  it('sans clé, ou sur un déploiement externe : refus, aucun appel', async () => {
    const bare = cloudHarness(dirs, { api: installer() });
    expect((await bare.host.provision()).error).toBe('Aucune clé API enregistrée.');
    const external = harness({ api: installer() });
    await external.host.setDeployment(DEPL);
    expect((await external.host.provision()).error).toContain('Déploiement externe');
    expect([...bare.api.calls, ...external.api.calls]).toEqual([]);
    expect(external.dialogs).toEqual([]);
  });

  it('annulé (choix par défaut) : rien n’est créé', async () => {
    const h = harness({ api: installer() });
    const status = await h.host.provision();
    expect(h.dialogs[0]).toMatchObject({ type: 'warning', defaultId: 2, cancelId: 2, noLink: true, buttons: ['Installer et planifier', 'Installer en pause', 'Annuler'] });
    expect(h.dialogs[0]?.detail).toContain('0 7 * * 1-5 · Europe/Paris');
    expect(h.dialogs[0]?.detail).toContain('3.00 $ par exécution');
    expect(h.dialogs[0]?.detail).toContain('Aucune donnée du desk n’est envoyée');
    expect(h.api.calls).toEqual([]);
    expect(status).toMatchObject({ busy: null, deploymentId: null });
  });

  it('sans fenêtre : aucun dialogue, rien n’est créé', async () => {
    const h = harness({ api: installer(), noWindow: true, answers: [0] });
    await h.host.provision();
    expect(h.api.calls).toEqual([]);
  });

  it('installer et planifier : environnement, agent, déploiement, dans cet ordre ; les identifiants sont gardés', async () => {
    const h = harness({ api: installer(), answers: [0] });
    h.host.setSchedule({ cron: '30 13 * * 1-5', timezone: 'America/New_York' });
    const status = await h.host.provision();
    expect(h.api.calls).toEqual(['createEnvironment', 'createAgent', 'listDeployments', 'createDeployment']);
    expect(vi.mocked(h.api.createDeployment).mock.calls[0]?.[0]).toMatchObject({ agent: AGENT, environment_id: ENV, schedule: { expression: '30 13 * * 1-5', timezone: 'America/New_York' } });
    expect(status).toMatchObject({ deploymentId: DEPL, managed: true, error: null, busy: null, deployment: { state: 'active' } });
    expect(saved(h.dir)).toMatchObject({ deploymentId: DEPL, environmentId: ENV, agentId: AGENT, agentVersion: 1, managed: true });
    expect(h.logs).toContain('agent cloud · installé (agent v1, planifié)');
  });

  it('mettre à jour en pause : tout est mis à jour, puis le déploiement est suspendu', async () => {
    const h = harness({ api: installer(), answers: [0, 1] });
    await h.host.provision();
    const status = await h.host.provision();
    expect(h.api.calls).toEqual(['createEnvironment', 'createAgent', 'listDeployments', 'createDeployment', 'updateEnvironment', 'updateAgent', 'updateDeployment', 'pauseDeployment']);
    expect(h.dialogs[1]?.message).toBe('Mettre à jour l’agent cloud ?');
    expect(status.deployment).toMatchObject({ state: 'paused', pausedReason: 'manual', nextRunAt: null });
    expect(saved(h.dir).agentVersion).toBe(2);
  });

  it('installation coupée en route : ce qui existe est gardé et repris, l’erreur est dite', async () => {
    let agentDown = true;
    const api = fakeApi({
      createEnvironment: async () => ({ id: ENV }),
      updateEnvironment: async () => ({ id: ENV }),
      createAgent: async () => {
        if (agentDown) throw new CloudApiError(529, 'overloaded_error', 'HTTP 529 · overloaded_error');
        return { id: AGENT, version: 1 };
      },
      createDeployment: async () => DEPLOYMENT,
    });
    const h = harness({ api, answers: [0, 0] });
    expect((await h.host.provision()).error).toBe('Agent · HTTP 529 · overloaded_error');
    expect(saved(h.dir)).toMatchObject({ environmentId: ENV, agentId: null, deploymentId: null });
    agentDown = false;
    expect(await h.host.provision()).toMatchObject({ error: null, deploymentId: DEPL });
    expect(api.calls).toEqual(['createEnvironment', 'createAgent', 'updateEnvironment', 'createAgent', 'listDeployments', 'createDeployment']);
  });

  it('lancer maintenant : dialogue, Annuler par défaut ; une session lancée rapproche le relevé', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const api = fakeApi({ runDeployment: async () => ({ id: 'drun_01abc12345', createdAt: NOW, trigger: 'manual', sessionId: sid(9), errorType: null, errorMessage: '' }) });
    const h = harness({ api, answers: [1, 0] });
    await h.host.setDeployment(DEPL);
    await h.host.runNow();
    expect(api.calls).toEqual([]);
    expect(h.dialogs[0]).toMatchObject({ defaultId: 1, cancelId: 1, buttons: ['Lancer', 'Annuler'] });
    h.host.start();
    const status = await h.host.runNow();
    expect(api.calls).toEqual(['runDeployment']);
    expect(status).toMatchObject({ pending: 1, nextPullAt: NOW + PULL_PENDING_MS, error: null });
    h.host.shutdown();
  });

  it('exécution refusée par Anthropic : la cause est dite', async () => {
    const api = fakeApi({ runDeployment: async () => ({ id: 'drun_01abc12345', createdAt: NOW, trigger: 'manual', sessionId: null, errorType: 'session_rate_limited_error', errorMessage: 'slow' }) });
    const h = harness({ api, answers: [0] });
    await h.host.setDeployment(DEPL);
    expect((await h.host.runNow()).error).toBe('Exécution refusée par Anthropic : session_rate_limited_error');
  });

  it('suspendre sans dialogue ; reprendre seulement après le dialogue', async () => {
    const api = installer();
    const h = harness({ api, answers: [0, 1, 0] });
    await h.host.provision();
    api.calls.length = 0;
    h.dialogs.length = 0;
    expect((await h.host.pause()).deployment?.state).toBe('paused');
    expect(h.dialogs).toEqual([]);
    expect((await h.host.unpause()).deployment?.state).toBe('paused');
    expect((await h.host.unpause()).deployment?.state).toBe('active');
    expect(api.calls).toEqual(['pauseDeployment', 'unpauseDeployment']);
  });

  it('CLD13 déploiement externe : relevé et lancé, jamais suspendu ni repris par le desk', async () => {
    const api = installer();
    const h = harness({ api, answers: [0] });
    await h.host.setDeployment(DEPL);
    expect((await h.host.pause()).error).toContain('Déploiement externe');
    expect((await h.host.unpause()).error).toContain('Déploiement externe');
    expect(api.calls).toEqual([]);
    expect(h.dialogs).toEqual([]);
  });

  it('CLD13 quitter le déploiement du desk : dialogue, Annuler par défaut ; confirmé, il est suspendu puis oublié', async () => {
    const api = installer();
    const h = harness({ api, answers: [0, 1, 0] });
    await h.host.provision();
    api.calls.length = 0;
    expect(await h.host.setDeployment(null)).toMatchObject({ deploymentId: DEPL, managed: true });
    expect(h.dialogs[1]).toMatchObject({ type: 'warning', defaultId: 1, cancelId: 1, buttons: ['Suspendre et quitter', 'Annuler'] });
    expect(api.calls).toEqual([]);
    expect(await h.host.setDeployment(null)).toMatchObject({ deploymentId: null, managed: false });
    expect(api.calls).toEqual(['pauseDeployment']);
    expect(saved(h.dir)).toMatchObject({ deploymentId: null, managed: false, agentId: AGENT, environmentId: ENV });
  });

  it('CLD13 remplacer le déploiement du desk par un externe passe par le même dialogue ; suspension en échec, rien n’est quitté', async () => {
    const api = fakeApi({
      createEnvironment: async () => ({ id: ENV }),
      createAgent: async () => ({ id: AGENT, version: 1 }),
      createDeployment: async () => DEPLOYMENT,
      pauseDeployment: async () => {
        throw new CloudApiError(529, 'overloaded_error', 'HTTP 529 · overloaded_error');
      },
    });
    const h = harness({ api, answers: [0, 0] });
    await h.host.provision();
    const status = await h.host.setDeployment('depl_011CZkZcDH3vPqd7xnEfwXYZ');
    expect(status).toMatchObject({ deploymentId: DEPL, managed: true, error: 'HTTP 529 · overloaded_error' });
  });

  it('CLD13 un déploiement du desk déjà là est repris, jamais doublé (réponse perdue, déploiement quitté)', async () => {
    const api = installer(
      {},
      {
        listDeployments: async () => [
          { ...DEPLOYMENT, id: 'depl_011CZkZcDH3vPqd7xnEfwOLD', tagged: false },
          { ...DEPLOYMENT, status: 'paused', pausedReason: 'manual' },
        ],
        updateDeployment: async () => ({ ...DEPLOYMENT, status: 'paused', pausedReason: 'manual' }),
      },
    );
    const h = harness({ api, answers: [0] });
    const status = await h.host.provision();
    expect(api.calls).toEqual(['createEnvironment', 'createAgent', 'listDeployments', 'updateDeployment', 'unpauseDeployment']);
    expect(status).toMatchObject({ deploymentId: DEPL, managed: true, deployment: { state: 'active' } });
    expect(h.logs).toContain('agent cloud · mis à jour (agent v1, planifié)');
  });

  it('CLD13 agent ou environnement disparus (404, archivé) : recréés, l’installation aboutit', async () => {
    const api = fakeApi({
      createEnvironment: async () => ({ id: ENV }),
      updateEnvironment: async () => {
        throw new CloudApiError(404, 'not_found_error', 'HTTP 404 · not_found_error');
      },
      createAgent: async () => ({ id: AGENT, version: 1 }),
      updateAgent: async () => {
        throw new CloudApiError(400, 'invalid_request_error', 'HTTP 400 · invalid_request_error : agent is archived');
      },
      createDeployment: async () => DEPLOYMENT,
    });
    const h = harness({ api, answers: [0] });
    const config = (h.host as unknown as { config: { environmentId: string; agentId: string } }).config;
    config.environmentId = 'env_011CZkZ9X2dpNyB7HsEFoOLD';
    config.agentId = 'agent_011CZkYpogX7uDKUyvBToOLD';
    expect(await h.host.provision()).toMatchObject({ error: null, deploymentId: DEPL });
    expect(api.calls).toEqual(['updateEnvironment', 'createEnvironment', 'updateAgent', 'createAgent', 'listDeployments', 'createDeployment']);
    expect(saved(h.dir)).toMatchObject({ environmentId: ENV, agentId: AGENT });
  });

  it('CLD13 installer en pause : si la suspension échoue, le statut montre un déploiement actif et le dit', async () => {
    const api = fakeApi({
      createEnvironment: async () => ({ id: ENV }),
      createAgent: async () => ({ id: AGENT, version: 1 }),
      createDeployment: async () => DEPLOYMENT,
      pauseDeployment: async () => {
        throw new CloudApiError(529, 'overloaded_error', 'HTTP 529');
      },
    });
    const h = harness({ api, answers: [1] });
    const status = await h.host.provision();
    expect(status.deployment?.state).toBe('active');
    expect(status.error).toBe('Installé, mais la suspension a échoué : le déploiement est actif et planifié. Suspendez-le.');
  });

  it('CLD13 rien ne change pendant une action : clé et déploiement refusés tant qu’un dialogue est ouvert', async () => {
    let release: (v: { response: number }) => void = () => undefined;
    const h = harness({ api: installer() });
    const deps = (h.host as unknown as { deps: { showMessageBox: unknown } }).deps;
    deps.showMessageBox = () => new Promise((resolve) => (release = resolve));
    const first = h.host.provision();
    expect((await h.host.setDeployment('depl_011CZkZcDH3vPqd7xnEfwXYZ')).error).toBe('Une action sur l’agent cloud est en cours.');
    expect(h.host.setKey('').keyStored).toBe(true);
    release({ response: 2 });
    expect(await first).toMatchObject({ busy: null, deploymentId: null });
  });

  it('une commande à la fois : une seconde demande pendant un dialogue ne fait rien', async () => {
    let release: (v: { response: number }) => void = () => undefined;
    const h = harness({ api: installer() });
    const deps = (h.host as unknown as { deps: { showMessageBox: unknown } }).deps;
    deps.showMessageBox = () => new Promise((resolve) => (release = resolve));
    const first = h.host.provision();
    expect((await h.host.runNow()).busy).toBe('provision');
    release({ response: 2 });
    expect((await first).busy).toBeNull();
  });
});
