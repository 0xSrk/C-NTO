import { describe, expect, it, vi } from 'vitest';
import { ANTHROPIC_VERSION, CloudApiError, createCloudApi, isWorkspaceId, MANAGED_AGENTS_BETA, parseDeployment, parseSession, WORKSPACE_HEADER, type FetchLike } from '../electron/agent-cloud-api';

const KEY = 'sk-ant-api03-cle-de-test-0123456789';
const DEPL = 'depl_011CZkZcDH3vPqd7xnEfwTai';
const SESN = 'sesn_011CZkZAtmR3yMPDzynEDxu7';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function harness(reply: (url: URL, init: RequestInit) => Response | Promise<Response>, key = KEY) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    return reply(parsed, init);
  });
  return { api: createCloudApi({ key: () => key, fetchImpl }), calls, fetchImpl };
}

const DEPLOYMENT = {
  type: 'deployment',
  id: DEPL,
  name: 'canto-rapport-quotidien',
  status: 'active',
  archived_at: null,
  paused_reason: null,
  agent: { type: 'agent', id: 'agent_011CZkYpogX7uDKUyvBTophP', version: 3 },
  environment_id: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
  schedule: { type: 'cron', expression: '0 7 * * 1-5', timezone: 'Europe/Paris', last_run_at: '2026-10-26T06:00:04Z', upcoming_runs_at: ['2026-10-28T06:00:00Z', '2026-10-27T06:00:00Z'] },
  budget: { type: 'limit', max_list_cost: { amount: '300', currency: 'USD' } },
};

describe('agent cloud · client Managed Agents', () => {
  it('un seul hôte, la clé en en-tête, la bêta Managed Agents, aucune redirection suivie ni cookie', async () => {
    const h = harness(() => json(DEPLOYMENT));
    const view = await h.api.getDeployment(DEPL);
    const [call] = h.calls;
    expect(call?.url.href).toBe(`https://api.anthropic.com/v1/deployments/${DEPL}`);
    expect(call?.init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
    expect(call?.init.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-beta': MANAGED_AGENTS_BETA });
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(view).toEqual({
      id: DEPL,
      name: 'canto-rapport-quotidien',
      status: 'active',
      archived: false,
      pausedReason: null,
      agentId: 'agent_011CZkYpogX7uDKUyvBTophP',
      agentVersion: 3,
      environmentId: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
      cron: '0 7 * * 1-5',
      timezone: 'Europe/Paris',
      nextRunAt: Date.parse('2026-10-27T06:00:00Z'),
      lastRunAt: Date.parse('2026-10-26T06:00:04Z'),
      budgetCents: 300,
      tagged: false,
    });
  });

  it('refuse sans clé, et un identifiant hors forme n’entre jamais dans un chemin', async () => {
    const empty = harness(() => json(DEPLOYMENT), '');
    await expect(empty.api.getDeployment(DEPL)).rejects.toMatchObject({ type: 'no_key' });
    const h = harness(() => json(DEPLOYMENT));
    await expect(h.api.getDeployment('depl_../../v1/agents')).rejects.toMatchObject({ type: 'invalid_id' });
    await expect(h.api.getDeployment(SESN)).rejects.toMatchObject({ type: 'invalid_id' });
    await expect(h.api.listOutputFiles(DEPL)).rejects.toMatchObject({ type: 'invalid_id' });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it('CLD23 espace de travail : nommé dans anthropic-workspace-id quand il est donné, jamais sinon ; hors forme, rien ne part', async () => {
    const WRK = 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ';
    const UUID = '6f1d2c3b-4a5e-4f60-9b7a-0c1d2e3f4a5b';
    const sent: RequestInit[] = [];
    const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
      sent.push(init);
      return json(DEPLOYMENT);
    });
    let workspace: string | null = WRK;
    const api = createCloudApi({ key: () => KEY, workspace: () => workspace, fetchImpl });
    await api.getDeployment(DEPL);
    expect(sent[0]?.headers).toMatchObject({ [WORKSPACE_HEADER]: WRK, 'x-api-key': KEY, 'anthropic-beta': MANAGED_AGENTS_BETA });
    workspace = UUID;
    await api.getDeployment(DEPL);
    expect(sent[1]?.headers).toMatchObject({ 'anthropic-workspace-id': UUID });
    workspace = null;
    await api.getDeployment(DEPL);
    expect(sent[2]?.headers).not.toHaveProperty(WORKSPACE_HEADER);
    workspace = '';
    await api.getDeployment(DEPL);
    expect(sent[3]?.headers).not.toHaveProperty(WORKSPACE_HEADER);
    for (const bad of [`${WRK}\r\nx-api-key: autre`, 'wrkspc_court', 'org_01JwQvzr7rXLA5AGx3HKfFUJ', ` ${WRK}`, `${UUID}0`]) {
      workspace = bad;
      await expect(api.getDeployment(DEPL)).rejects.toMatchObject({ type: 'invalid_id' });
      expect(isWorkspaceId(bad)).toBe(false);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const plain = harness(() => json(DEPLOYMENT));
    await plain.api.getDeployment(DEPL);
    expect(plain.calls[0]?.init.headers).not.toHaveProperty(WORKSPACE_HEADER);
  });

  it('une redirection est refusée : la clé ne suit pas un 3xx', async () => {
    const h = harness(() => new Response(null, { status: 307, headers: { location: 'https://ailleurs.example/' } }));
    await expect(h.api.getDeployment(DEPL)).rejects.toMatchObject({ status: 307, type: 'redirect' });
    expect(h.calls).toHaveLength(1);
  });

  it('erreur de l’API : statut, type et message borné ; jamais la clé ; Retry-After sur un 429', async () => {
    const h = harness(() => json({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${'z'.repeat(500)}` } }, 401));
    const error = await h.api.getDeployment(DEPL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudApiError);
    expect(error).toMatchObject({ status: 401, type: 'authentication_error' });
    expect((error as Error).message.startsWith('HTTP 401 · authentication_error : invalid x-api-key')).toBe(true);
    expect((error as Error).message.length).toBeLessThanOrEqual(260);
    expect((error as Error).message).not.toContain(KEY);
    const limited = harness(() => json({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429, { 'retry-after': '90000' }));
    await expect(limited.api.getDeployment(DEPL)).rejects.toMatchObject({ status: 429, retryAfterSec: 3600 });
  });

  it('transport : délai et panne réseau réduits à l’hôte et à un code', async () => {
    const down = harness(() => {
      throw Object.assign(new Error(`connect ECONNREFUSED https://api.anthropic.com/v1/deployments/${DEPL}?key=${KEY}`), { code: 'ECONNREFUSED' });
    });
    const error = (await down.api.getDeployment(DEPL).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('Réseau indisponible (api.anthropic.com, ECONNREFUSED)');
    const slow = createCloudApi({ key: () => KEY, timeoutMs: 20, fetchImpl: () => new Promise<Response>(() => undefined) });
    await expect(slow.getDeployment(DEPL)).rejects.toMatchObject({ type: 'timeout' });
  });

  it('sessions du déploiement, la plus récente d’abord ; les lignes hors forme sont écartées', async () => {
    const h = harness(() =>
      json({
        data: [
          { id: SESN, status: 'idle', created_at: '2026-10-27T06:00:05Z', updated_at: '2026-10-27T06:14:00Z', usage: { list_cost: { amount: '87', currency: 'USD' } }, agent: { version: 3 }, outcome_evaluations: [{ result: 'needs_revision' }, { result: 'satisfied' }] },
          { id: 'sesn_011CZkZAtmR3yMPDzynEDxu8', status: 'running', outcome_evaluations: [{ result: 'evaluating' }] },
          { id: 'pas-une-session', status: 'idle' },
          { id: 'sesn_011CZkZAtmR3yMPDzynEDxu9', status: 'inconnu' },
        ],
        next_page: null,
      }),
    );
    const { sessions: list, nextPage } = await h.api.listSessions(DEPL, { limit: 500, page: 'page_abc' });
    expect(Object.fromEntries(h.calls[0]?.url.searchParams ?? [])).toEqual({ deployment_id: DEPL, order: 'desc', include_archived: 'true', limit: '100', page: 'page_abc' });
    expect(nextPage).toBeNull();
    await h.api.listSessions(DEPL, { order: 'asc', createdFrom: '2026-10-27T06:00:05.123Z' });
    expect(Object.fromEntries(h.calls[1]?.url.searchParams ?? [])).toEqual({ deployment_id: DEPL, order: 'asc', include_archived: 'true', limit: '20', 'created_at[gte]': '2026-10-27T06:00:05.123Z' });
    expect(list.map((s) => [s.id, s.status, s.costCents, s.outcomePending, s.outcomeResult])).toEqual([
      [SESN, 'idle', 87, false, 'satisfied'],
      ['sesn_011CZkZAtmR3yMPDzynEDxu8', 'running', null, true, null],
    ]);
  });

  it('fichiers de sortie d’une session, filtrés par session, du plus récent au plus ancien', async () => {
    const h = harness(() =>
      json({
        data: [
          { id: 'file_011CNha8iCJcU1wXNR6q4V8w', filename: 'rapport.json', size_bytes: 2048, created_at: '2026-10-27T06:10:00Z' },
          { id: 'file_011CNha8iCJcU1wXNR6q4V8x', filename: 'rapport.json', size_bytes: 2100, created_at: '2026-10-27T06:13:00Z' },
          { id: 'file_bad', filename: 'x', size_bytes: 1 },
        ],
      }),
    );
    const files = await h.api.listOutputFiles(SESN);
    expect(h.calls[0]?.url.pathname).toBe('/v1/files');
    expect(h.calls[0]?.url.searchParams.get('scope_id')).toBe(SESN);
    expect(files.map((f) => f.id)).toEqual(['file_011CNha8iCJcU1wXNR6q4V8x', 'file_011CNha8iCJcU1wXNR6q4V8w']);
  });

  it('téléchargement borné et UTF-8 strict', async () => {
    const FILE = 'file_011CNha8iCJcU1wXNR6q4V8w';
    const ok = harness(() => new Response('{"format":"canto.rapport/1"}'));
    expect(await ok.api.downloadText(FILE, 1024)).toBe('{"format":"canto.rapport/1"}');
    expect(ok.calls[0]?.url.pathname).toBe(`/v1/files/${FILE}/content`);
    const big = harness(() => new Response('x'.repeat(2048)));
    await expect(big.api.downloadText(FILE, 1024)).rejects.toMatchObject({ type: 'too_large' });
    const declared = harness(() => new Response('x', { headers: { 'content-length': '999999' } }));
    await expect(declared.api.downloadText(FILE, 1024)).rejects.toMatchObject({ type: 'too_large' });
    const latin = harness(() => new Response(new Uint8Array([0x7b, 0xe9, 0x7d])));
    await expect(latin.api.downloadText(FILE, 1024)).rejects.toMatchObject({ type: 'unreadable' });
  });

  it('écritures : corps JSON en POST, réponse relue (agent versionné, exécution manuelle)', async () => {
    const h = harness((url) => {
      if (url.pathname === '/v1/agents') return json({ id: 'agent_011CZkYpogX7uDKUyvBTophP', version: 1 });
      return json({ type: 'deployment_run', id: 'drun_01abc12345', trigger_context: { type: 'manual' }, session_id: SESN, error: null, created_at: '2026-10-27T09:00:00Z' });
    });
    expect(await h.api.createAgent({ name: 'x' })).toEqual({ id: 'agent_011CZkYpogX7uDKUyvBTophP', version: 1 });
    expect(h.calls[0]?.init).toMatchObject({ method: 'POST', body: '{"name":"x"}' });
    expect(h.calls[0]?.init.headers).toMatchObject({ 'content-type': 'application/json' });
    const run = await h.api.runDeployment(DEPL);
    expect(h.calls[1]?.url.pathname).toBe(`/v1/deployments/${DEPL}/run`);
    expect(run).toEqual({ id: 'drun_01abc12345', createdAt: Date.parse('2026-10-27T09:00:00Z'), trigger: 'manual', sessionId: SESN, errorType: null, errorMessage: '' });
  });

  it('déploiement en pause sur erreur : la cause est lue ; sans planification, rien de prévu', () => {
    const paused = parseDeployment({ ...DEPLOYMENT, status: 'paused', paused_reason: { type: 'error', error: { type: 'environment_archived_error' } }, schedule: null, budget: undefined });
    expect(paused).toMatchObject({ status: 'paused', pausedReason: 'environment_archived_error', cron: null, nextRunAt: null, budgetCents: null });
    expect(parseDeployment({ ...DEPLOYMENT, archived_at: '2026-10-27T00:00:00Z' }).archived).toBe(true);
    expect(() => parseDeployment({ id: 'x' })).toThrow(CloudApiError);
    expect(parseSession({ id: SESN, status: 'terminated', archived_at: '2026-10-27T00:00:00Z' })?.archived).toBe(true);
  });
});
