import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPORT_FORMAT } from '@/engine/agent/cloudReport';
import { CloudApiError, type CloudApi, type DeploymentView } from '../electron/agent-cloud-api';
import { AGENT_CLOUD_FILE, PULL_PENDING_MS } from '../electron/agent-cloud';
import { BUDGET_CENTS_PER_RUN, cloudAgentBody, cloudDeploymentBody, cloudEnvironmentBody, cloudSystemPrompt, MAX_PAGES, OFFICIAL_DOMAINS, outcomeRubric } from '../electron/agent-cloud-definition';
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

/** Faux installateur : le déploiement garde son état d'un appel à l'autre, comme chez Anthropic. */
const installer = (over: Partial<DeploymentView> = {}, extra: Partial<CloudApi> = {}) => {
  let current: DeploymentView = { ...DEPLOYMENT, ...over };
  const set = (next: Partial<DeploymentView>) => (current = { ...current, ...next });
  return fakeApi({
    getDeployment: async () => current,
    createEnvironment: async () => ({ id: ENV }),
    updateEnvironment: async () => ({ id: ENV }),
    createAgent: async () => ({ id: AGENT, version: 1 }),
    updateAgent: async () => ({ id: AGENT, version: 2 }),
    createDeployment: async () => set({ ...DEPLOYMENT, ...over }),
    updateDeployment: async () => set(over),
    pauseDeployment: async () => set({ status: 'paused', pausedReason: 'manual', nextRunAt: null }),
    unpauseDeployment: async () => set({ status: 'active', pausedReason: null }),
    ...extra,
  });
};

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
    const plan = cloudDeploymentBody({ agentId: AGENT, environmentId: ENV, cron: '0 7 * * 1-5', timezone: 'Europe/Paris', locale: 'fr' });
    expect(plan).toMatchObject({
      agent: AGENT,
      environment_id: ENV,
      schedule: { type: 'cron', expression: '0 7 * * 1-5', timezone: 'Europe/Paris' },
      budget: { type: 'limit', max_list_cost: { amount: String(BUDGET_CENTS_PER_RUN), currency: 'USD' } },
    });
    expect(plan.initial_events).toEqual([expect.objectContaining({ type: 'user.define_outcome', rubric: { type: 'text', content: outcomeRubric('fr') }, max_iterations: 2 })]);
    expect(outcomeRubric('fr')).toContain(REPORT_FORMAT);
  });

  it('CLD14 le correcteur connaît la langue du rapport : elle est écrite dans la grille et dans la description', () => {
    expect(outcomeRubric('fr')).toContain('est rédigé en français.');
    expect(outcomeRubric('en')).toContain('est rédigé en anglais.');
    expect(outcomeRubric('es')).toContain('est rédigé en espagnol.');
    const plan = cloudDeploymentBody({ agentId: AGENT, environmentId: ENV, cron: '0 7 * * 1-5', timezone: 'Europe/Paris', locale: 'en' });
    const [outcome] = plan.initial_events as { description: string; rubric: { content: string } }[];
    expect(outcome?.description).toContain('en anglais');
    expect(outcome?.rubric.content).toBe(outcomeRubric('en'));
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

  it('CLD27 sous plafond, l’agent écrit tôt un rapport valide, puis l’affine, en lisant un nombre borné de pages', () => {
    const prompt = cloudSystemPrompt('fr');
    const early = prompt.indexOf('Écris aussitôt `/mnt/session/outputs/rapport.json`');
    expect(early).toBeGreaterThan(0);
    // L'écriture précoce vient avant l'affinage et avant la description du livrable : c'est l'ordre de travail.
    expect(early).toBeLessThan(prompt.indexOf('Ensuite seulement, affine-le'));
    expect(early).toBeLessThan(prompt.indexOf('## Livrable'));
    expect(prompt).toContain('la session peut s’arrêter sans prévenir');
    expect(prompt).toContain(`Lis au plus ${MAX_PAGES} pages web en tout`);
    expect(MAX_PAGES).toBeGreaterThan(0);
    expect(MAX_PAGES).toBeLessThanOrEqual(20);
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
    expect(h.dialogs[0]?.detail).toContain('Plafond appliqué : 3,00 $ par exécution');
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

  it('CLD24 clé d’utilisateur sans espace de travail : la cause est dite en clair, et où la régler ; avec un espace refusé, la réponse de l’API suit', async () => {
    const unscoped = 'HTTP 400 · invalid_request_error : This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.';
    let workspaceOk = false;
    const api = fakeApi({
      createEnvironment: async () => {
        if (!workspaceOk) throw new CloudApiError(400, 'invalid_request_error', unscoped);
        return { id: ENV };
      },
      createAgent: async () => ({ id: AGENT, version: 1 }),
      createDeployment: async () => DEPLOYMENT,
      pauseDeployment: async () => ({ ...DEPLOYMENT, status: 'paused' as const, pausedReason: 'manual' }),
    });
    const h = harness({ api, answers: [1, 1, 1] });
    expect((await h.host.provision()).error).toBe(
      'Environnement · Clé d’utilisateur sans espace de travail : indiquez son ID (Console › Settings › Workspaces) dans Options › Agent cloud › Espace de travail.',
    );
    await h.host.setWorkspace('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
    expect((await h.host.provision()).error).toBe(`Environnement · Espace de travail refusé : vérifiez son ID (Console › Settings › Workspaces). ${unscoped}`);
    workspaceOk = true;
    expect(await h.host.provision()).toMatchObject({ error: null, deploymentId: DEPL });
    const other = harness({ api: fakeApi({ createEnvironment: async () => Promise.reject(new CloudApiError(400, 'invalid_request_error', 'HTTP 400 · invalid_request_error : config.networking: invalid')) }), answers: [1] });
    expect((await other.host.provision()).error).toBe('Environnement · HTTP 400 · invalid_request_error : config.networking: invalid');
  });

  it('lancer maintenant : dialogue, Annuler par défaut ; une session lancée rapproche le relevé', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const api = fakeApi({ runDeployment: async () => ({ id: 'drun_01abc12345', createdAt: NOW, trigger: 'manual', sessionId: sid(9), errorType: null, errorMessage: '' }) });
    const h = harness({ api, answers: [1, 0] });
    await h.host.setDeployment(DEPL);
    await h.host.runNow();
    expect(api.calls).toEqual(['getDeployment']);
    expect(h.dialogs[0]).toMatchObject({ defaultId: 1, cancelId: 1, buttons: ['Lancer', 'Annuler'] });
    h.host.start();
    const status = await h.host.runNow();
    expect(api.calls).toEqual(['getDeployment', 'getDeployment', 'runDeployment']);
    expect(status).toMatchObject({ pending: 1, nextPullAt: NOW + PULL_PENDING_MS, error: null });
    h.host.shutdown();
  });

  it('CLD14 lancer : le dialogue dit le plafond relu du déploiement, son absence, ou qu’il est inconnu', async () => {
    const run = async () => ({ id: 'drun_01abc12345', createdAt: NOW, trigger: 'manual' as const, sessionId: sid(9), errorType: null, errorMessage: '' });
    const capped = harness({ api: fakeApi({ runDeployment: run, getDeployment: async () => ({ ...DEPLOYMENT, budgetCents: 2000 }) }), answers: [1] });
    await capped.host.setDeployment(DEPL);
    await capped.host.runNow();
    expect(capped.dialogs[0]?.detail).toContain('plafond 20,00 $ par exécution');
    const uncapped = harness({ api: fakeApi({ runDeployment: run, getDeployment: async () => ({ ...DEPLOYMENT, budgetCents: null }) }), answers: [1] });
    await uncapped.host.setDeployment(DEPL);
    await uncapped.host.runNow();
    expect(uncapped.dialogs[0]?.detail).toContain('aucun plafond : la session n’est pas plafonnée');
    expect(uncapped.dialogs[0]?.detail).not.toContain('3,00');
    const unread = harness({ api: fakeApi({ runDeployment: run, getDeployment: async () => Promise.reject(new CloudApiError(0, 'network', 'Réseau indisponible')) }), answers: [1] });
    await unread.host.setDeployment(DEPL);
    await unread.host.runNow();
    expect(unread.dialogs[0]?.detail).toContain('plafond inconnu');
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
    expect(api.calls).toEqual(['pauseDeployment', 'getDeployment', 'getDeployment', 'unpauseDeployment']);
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
    expect(await h.host.setDeployment('depl_011CZkZcDH3vPqd7xnEfwXYZ')).toMatchObject({ deploymentId: null, error: null });
    expect(h.host.setKey('').keyStored).toBe(true);
    expect(await h.host.setWorkspace('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ')).toMatchObject({ workspaceId: null, busy: 'provision', error: null });
    release({ response: 2 });
    expect(await first).toMatchObject({ busy: null, deploymentId: null, error: null });
  });

  it('CLD19 l’échec d’une installation reste affiché : le relevé automatique qui suit ne l’efface pas', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const api = installer({}, { pauseDeployment: async () => Promise.reject(new CloudApiError(529, 'overloaded_error', 'HTTP 529')) });
    const h = harness({ api, answers: [1] });
    h.host.start();
    const status = await h.host.provision();
    const warning = 'Installé, mais la suspension a échoué : le déploiement est actif et planifié. Suspendez-le.';
    expect(status.error).toBe(warning);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(api.calls).toContain('listSessions');
    expect(h.host.status()).toMatchObject({ error: warning, deployment: { state: 'active' } });
    h.host.shutdown();
  });

  it('CLD19 un 404 sur le déploiement du desk ne le recrée jamais : il facture peut-être sous une autre clé', async () => {
    const api = installer({}, { updateDeployment: async () => Promise.reject(new CloudApiError(404, 'not_found_error', 'HTTP 404')) });
    const h = harness({ api, answers: [0, 0] });
    await h.host.provision();
    api.calls.length = 0;
    const status = await h.host.provision();
    expect(api.calls).not.toContain('createDeployment');
    expect(status).toMatchObject({ deploymentId: DEPL, managed: true });
    expect(status.error).toBe('Déploiement · introuvable avec cette clé (autre organisation, autre espace de travail) : rien n’a été recréé. Quittez-le d’abord.');
  });

  it('CLD19 quitter un déploiement que la clé ne voit plus : rien n’est dit suspendu ; le quitter quand même se confirme à part', async () => {
    const api = installer({}, { pauseDeployment: async () => Promise.reject(new CloudApiError(404, 'not_found_error', 'HTTP 404')) });
    const h = harness({ api, answers: [0, 0, 1, 0, 0] });
    await h.host.provision();
    expect(await h.host.setDeployment(null)).toMatchObject({ deploymentId: DEPL, managed: true });
    expect(h.dialogs[2]).toMatchObject({ message: 'Déploiement invisible avec cette clé', defaultId: 1, cancelId: 1, buttons: ['Quitter sans suspendre', 'Annuler'] });
    expect(await h.host.setDeployment(null)).toMatchObject({ deploymentId: null, managed: false });
    expect(h.logs).toContain('agent cloud · déploiement du desk quitté sans suspension (invisible avec cette clé)');
    expect(h.logs).not.toContain('agent cloud · déploiement du desk suspendu');
  });

  it('CLD19 un déploiement qui ne répond pas avant le dialogue : « plafond inconnu », jamais le plafond du dernier relevé', async () => {
    let answer = true;
    const api = fakeApi({
      getDeployment: async () => (answer ? DEPLOYMENT : Promise.reject(new CloudApiError(529, 'overloaded_error', 'HTTP 529'))),
      runDeployment: async () => ({ id: 'drun_01abc12345', createdAt: NOW, trigger: 'manual', sessionId: sid(9), errorType: null, errorMessage: '' }),
    });
    const h = harness({ api, answers: [1] });
    await h.host.setDeployment(DEPL);
    await h.host.pull();
    expect(h.host.status().deployment?.budgetCents).toBe(300);
    answer = false;
    await h.host.runNow();
    expect(h.dialogs[0]?.detail).toContain('plafond inconnu');
    expect(h.dialogs[0]?.detail).not.toContain('3,00');
  });

  it('CLD19 un relevé en vol n’écrit rien sur le déploiement qui a remplacé le sien', async () => {
    let release: () => void = () => undefined;
    const api = fakeApi({
      getDeployment: async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return { ...DEPLOYMENT, name: 'ancien' };
      },
    });
    const h = harness({ api });
    await h.host.setDeployment(DEPL);
    const pulling = h.host.pull();
    await h.host.setDeployment('depl_011CZkZcDH3vPqd7xnEfwXYZ');
    release();
    await pulling;
    expect(h.host.status()).toMatchObject({ deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwXYZ', deployment: null, lastPullAt: null });
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
