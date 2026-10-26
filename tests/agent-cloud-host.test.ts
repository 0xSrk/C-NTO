import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPORT_FORMAT } from '@/engine/agent/cloudReport';
import { CloudApiError, type CloudApi, type DeploymentView, type FileView, type SessionView } from '../electron/agent-cloud-api';
import { AGENT_CLOUD_FILE, AGENT_REPORTS_DIR, AgentCloudHost, NO_REPORT_AFTER_MS, PULL_EVERY_MS, PULL_PENDING_MS, type AgentCloudDeps } from '../electron/agent-cloud';

const KEY = 'sk-ant-api03-cle-de-test-0123456789';
const DEPL = 'depl_011CZkZcDH3vPqd7xnEfwTai';
const NOW = Date.parse('2026-10-27T08:00:00Z');
const sid = (n: number) => `sesn_011CZkZAtmR3yMPDzynEDx${String(n).padStart(2, '0')}`;
const fid = (n: number) => `file_011CNha8iCJcU1wXNR6q4V${String(n).padStart(2, '0')}`;

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

const DEPLOYMENT: DeploymentView = {
  id: DEPL,
  name: 'canto-rapport-quotidien',
  status: 'active',
  archived: false,
  pausedReason: null,
  agentId: 'agent_011CZkYpogX7uDKUyvBTophP',
  agentVersion: 2,
  environmentId: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
  cron: '0 7 * * 1-5',
  timezone: 'Europe/Paris',
  nextRunAt: NOW + 86_400_000,
  lastRunAt: NOW - 3_600_000,
  budgetCents: 300,
};

const session = (n: number, over: Partial<SessionView> = {}): SessionView => ({
  id: sid(n),
  status: 'idle',
  createdAt: NOW - 3_600_000,
  updatedAt: NOW - 3_000_000,
  archived: false,
  costCents: 64,
  agentVersion: 2,
  outcomePending: false,
  outcomeResult: 'satisfied',
  ...over,
});

const report = (date: string, title = 'Brief pré-séance') => JSON.stringify({ format: REPORT_FORMAT, date, title, summary: 'Résumé.', sections: [{ heading: 'Calendrier', body: '- 14:30 CPI' }], sources: [], generatedAt: '2026-10-27T06:10:00Z' });

function fakeApi(over: Partial<CloudApi> = {}): CloudApi & { calls: string[] } {
  const calls: string[] = [];
  const note = <T>(name: string, value: T) => {
    calls.push(name);
    return value;
  };
  const refuse = (name: string) => () => Promise.reject(new Error(`${name} non attendu`));
  return {
    calls,
    getDeployment: vi.fn(async () => note('getDeployment', DEPLOYMENT)),
    listSessions: vi.fn(async () => note('listSessions', [] as SessionView[])),
    listFailedRuns: vi.fn(async () => note('listFailedRuns', [])),
    listOutputFiles: vi.fn(async () => note('listOutputFiles', [] as FileView[])),
    downloadText: vi.fn(async () => note('downloadText', '')),
    createEnvironment: refuse('createEnvironment'),
    updateEnvironment: refuse('updateEnvironment'),
    createAgent: refuse('createAgent'),
    updateAgent: refuse('updateAgent'),
    createDeployment: refuse('createDeployment'),
    updateDeployment: refuse('updateDeployment'),
    runDeployment: refuse('runDeployment'),
    pauseDeployment: refuse('pauseDeployment'),
    unpauseDeployment: refuse('unpauseDeployment'),
    ...over,
  };
}

/** Faux trousseau : un blob opaque, réversible, qui ne contient pas la clé en clair. */
const seal = (available = true) => ({
  available: () => available,
  encrypt: (text: string) => (available ? Buffer.from(`sealed:${[...text].reverse().join('')}`).toString('base64') : null),
  decrypt: (blob: string) => {
    const text = Buffer.from(blob, 'base64').toString('utf8');
    return text.startsWith('sealed:') ? [...text.slice(7)].reverse().join('') : '';
  },
});

function harness(opts: { api?: CloudApi; dir?: string; available?: boolean; clock?: { now: number } } = {}) {
  const dir = opts.dir ?? mkdtempSync(path.join(tmpdir(), 'canto-agent-cloud-'));
  if (!opts.dir) dirs.push(dir);
  const sent: { channel: string; payload: unknown }[] = [];
  const logs: string[] = [];
  const clock = opts.clock ?? { now: NOW };
  const api = opts.api ?? fakeApi();
  const deps: AgentCloudDeps = {
    userDataDir: dir,
    locale: () => 'fr',
    window: () => ({ isDestroyed: () => false }),
    showMessageBox: async () => ({ response: 1 }),
    send: (channel, payload) => sent.push({ channel, payload }),
    log: (line) => logs.push(line),
    seal: seal(opts.available ?? true),
    fetchImpl: () => Promise.reject(new Error('réseau interdit dans ce test')),
    openPath: async () => true,
    timers: { setTimeout, clearTimeout },
    now: () => clock.now,
    api,
  };
  return { host: new AgentCloudHost(deps), dir, sent, logs, api, clock };
}

async function configured(api: CloudApi, opts: { dir?: string; clock?: { now: number } } = {}) {
  const h = harness({ api, ...opts });
  h.host.setKey(KEY);
  h.host.setDeployment(DEPL);
  return h;
}

describe('agent cloud · hôte du process principal', () => {
  it('sans clé ni déploiement : rien ne part, le statut le dit', async () => {
    const api = fakeApi();
    const { host } = harness({ api });
    const status = await host.pull();
    expect(status).toMatchObject({ keyStored: false, deploymentId: null, reports: 0, unread: 0, error: 'Aucune clé API enregistrée.' });
    expect(api.calls).toEqual([]);
  });

  it('la clé est chiffrée par le trousseau, jamais écrite ni rendue ni journalisée en clair', () => {
    const h = harness();
    const status = h.host.setKey(`  ${KEY}  `);
    expect(status.keyStored).toBe(true);
    const file = readFileSync(path.join(h.dir, AGENT_CLOUD_FILE), 'utf8');
    expect(file).not.toContain(KEY);
    expect(JSON.parse(file).key).toBe(seal().encrypt(KEY));
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(h.logs.join('\n')).not.toContain(KEY);
    expect(JSON.stringify(h.sent)).not.toContain(KEY);
    expect(h.host.setKey('').keyStored).toBe(false);
    expect(JSON.parse(readFileSync(path.join(h.dir, AGENT_CLOUD_FILE), 'utf8')).key).toBeNull();
  });

  it('refuse une clé illisible, et ne garde rien sans trousseau', () => {
    const h = harness();
    expect(h.host.setKey('court')).toMatchObject({ keyStored: false, error: expect.stringContaining('Clé API illisible') });
    expect(h.host.setKey(`${KEY}\nautre`)).toMatchObject({ keyStored: false });
    const locked = harness({ available: false });
    expect(locked.host.setKey(KEY)).toMatchObject({ available: false, keyStored: false, error: expect.stringContaining('Trousseau') });
    expect(existsSync(path.join(locked.dir, AGENT_CLOUD_FILE))).toBe(false);
  });

  it('identifiant de déploiement et planification : forme vérifiée, sinon rien ne change', () => {
    const { host } = harness();
    expect(host.setDeployment('depl_../x')).toMatchObject({ deploymentId: null, error: expect.stringContaining('depl_') });
    expect(host.setDeployment(DEPL)).toMatchObject({ deploymentId: DEPL, managed: false });
    expect(host.setSchedule({ cron: '0 7 * * 1-5; rm -rf /', timezone: 'Europe/Paris' }).schedule).toEqual({ cron: '0 7 * * 1-5', timezone: 'Europe/Paris' });
    expect(host.setSchedule({ cron: '30 13 * * 1-5', timezone: 'America/New_York' }).schedule).toEqual({ cron: '30 13 * * 1-5', timezone: 'America/New_York' });
    expect(host.setDeployment(null)).toMatchObject({ deploymentId: null, managed: false });
  });

  it('relève : le rapport d’une session finie est rangé ; en cours ou pas encore indexé, attendu ; fini sans rapport, noté', async () => {
    const api = fakeApi({
      listSessions: vi.fn(async () => [
        session(1),
        session(2, { status: 'running', outcomePending: true }),
        session(3, { updatedAt: NOW - 60_000 }),
        session(4, { status: 'terminated', outcomeResult: null }),
        session(5, { archived: true }),
      ]),
      listOutputFiles: vi.fn(async (id: string) => (id === sid(1) ? [{ id: fid(1), filename: 'rapport.json', sizeBytes: 400, createdAt: NOW - 3_100_000 }, { id: fid(2), filename: 'notes.md', sizeBytes: 10, createdAt: NOW }] : [])),
      downloadText: vi.fn(async () => report('2026-10-27')),
    });
    const h = await configured(api);
    const status = await h.host.pull();
    expect(status).toMatchObject({ error: null, reports: 1, unread: 1, pending: 2, lastPullAt: NOW, deployment: { state: 'active', budgetCents: 300, agentVersion: 2 } });
    expect(status.failures.map((f) => [f.kind, f.detail])).toEqual(expect.arrayContaining([['no_report', 'terminated'], ['archived', '']]));
    expect(api.downloadText).toHaveBeenCalledTimes(1);
    expect(api.downloadText).toHaveBeenCalledWith(fid(1), 512 * 1024);
    const stored = JSON.parse(readFileSync(path.join(h.dir, AGENT_REPORTS_DIR, `${sid(1)}.json`), 'utf8'));
    expect(stored).toMatchObject({ v: 1, id: sid(1), date: '2026-10-27', title: 'Brief pré-séance', receivedAt: NOW, session: { costCents: 64, agentVersion: 2 } });
    expect(h.host.list()).toEqual([{ id: sid(1), date: '2026-10-27', title: 'Brief pré-séance', summary: 'Résumé.', generatedAt: Date.parse('2026-10-27T06:10:00Z'), receivedAt: NOW, read: false }]);
    expect(h.sent.filter((s) => s.channel === 'agent-cloud:reports').at(-1)?.payload).toEqual(h.host.list());
    expect(h.logs).toContain('agent cloud · 1 rapport(s) reçu(s)');
  });

  it('une session relevée ne l’est plus ; celle qui attendait son index est reprise ; au-delà de 30 min, notée sans rapport', async () => {
    const files = new Map<string, FileView[]>([[sid(1), [{ id: fid(1), filename: 'rapport.json', sizeBytes: 400, createdAt: NOW }]]]);
    const api = fakeApi({
      listSessions: vi.fn(async () => [session(1), session(3, { updatedAt: NOW - 60_000 })]),
      listOutputFiles: vi.fn(async (id: string) => files.get(id) ?? []),
      downloadText: vi.fn(async () => report('2026-10-27')),
    });
    const clock = { now: NOW };
    const h = await configured(api, { clock });
    expect((await h.host.pull()).pending).toBe(1);
    clock.now += NO_REPORT_AFTER_MS;
    const status = await h.host.pull();
    expect(status.pending).toBe(0);
    expect(status.failures.map((f) => f.kind)).toEqual(['no_report']);
    expect(api.downloadText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.listOutputFiles).mock.calls.map(([id]) => id)).toEqual([sid(1), sid(3), sid(3)]);
  });

  it('rapport hors contrat ou non téléchargeable : noté une fois, jamais rangé', async () => {
    const api = fakeApi({
      listSessions: vi.fn(async () => [session(1), session(2), session(3)]),
      listOutputFiles: vi.fn(async (id: string) => [{ id: id === sid(1) ? fid(1) : id === sid(2) ? fid(2) : fid(3), filename: 'rapport.json', sizeBytes: id === sid(3) ? 600 * 1024 : 100, createdAt: NOW }]),
      downloadText: vi.fn(async (id: string) => {
        if (id === fid(2)) throw new CloudApiError(400, 'invalid_request_error', 'HTTP 400 · Not downloadable');
        return JSON.stringify({ format: 'autre' });
      }),
    });
    const h = await configured(api);
    const status = await h.host.pull();
    expect(status.reports).toBe(0);
    expect(status.failures.map((f) => [f.kind, f.detail]).sort()).toEqual([
      ['invalid', 'HTTP 400'],
      ['invalid', 'format'],
      ['too_large', `${600 * 1024} o`],
    ]);
    await h.host.pull();
    expect(api.downloadText).toHaveBeenCalledTimes(2);
    expect(existsSync(path.join(h.dir, AGENT_REPORTS_DIR))).toBe(false);
  });

  it('panne du serveur au téléchargement : le relevé échoue, la session sera reprise', async () => {
    let down = true;
    const api = fakeApi({
      listSessions: vi.fn(async () => [session(1)]),
      listOutputFiles: vi.fn(async () => [{ id: fid(1), filename: 'rapport.json', sizeBytes: 100, createdAt: NOW }]),
      downloadText: vi.fn(async () => {
        if (down) throw new CloudApiError(529, 'overloaded_error', 'HTTP 529 · overloaded_error');
        return report('2026-10-27');
      }),
    });
    const h = await configured(api);
    expect((await h.host.pull()).error).toBe('HTTP 529 · overloaded_error');
    down = false;
    expect(await h.host.pull()).toMatchObject({ error: null, reports: 1 });
  });

  it('clé refusée (401) : message clair, plus de relevé automatique avant une nouvelle clé', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const api = fakeApi({ getDeployment: vi.fn(async () => Promise.reject(new CloudApiError(401, 'authentication_error', 'HTTP 401'))) });
    const h = await configured(api);
    h.host.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.host.status()).toMatchObject({ error: 'Clé refusée par Anthropic (401) : enregistrez une clé valide.', nextPullAt: null });
    expect(vi.getTimerCount()).toBe(0);
    h.host.setKey(KEY);
    expect(vi.getTimerCount()).toBe(1);
    h.host.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cadence : premier relevé 10 s après l’ouverture, 3 min tant qu’une session tourne, 15 min sinon', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let running = true;
    const api = fakeApi({ listSessions: vi.fn(async () => [session(1, { status: running ? 'running' : 'idle' })]) });
    const clock = { now: NOW };
    const h = await configured(api, { clock });
    h.host.start();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(api.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.calls.filter((c) => c === 'getDeployment')).toHaveLength(1);
    expect(h.host.status().nextPullAt).toBe(NOW + PULL_PENDING_MS);
    running = false;
    await vi.advanceTimersByTimeAsync(PULL_PENDING_MS);
    expect(api.calls.filter((c) => c === 'getDeployment')).toHaveLength(2);
    expect(h.host.status().nextPullAt).toBe(NOW + PULL_EVERY_MS);
    h.host.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('deux relevés demandés ensemble n’en font qu’un', async () => {
    const api = fakeApi();
    const h = await configured(api);
    await Promise.all([h.host.pull(), h.host.pull()]);
    expect(api.calls.filter((c) => c === 'getDeployment')).toHaveLength(1);
  });

  it('lu : retenu sur le disque, relu au redémarrage ; une fiche altérée sur le disque est ignorée', async () => {
    const api = fakeApi({
      listSessions: vi.fn(async () => [session(1)]),
      listOutputFiles: vi.fn(async () => [{ id: fid(1), filename: 'rapport.json', sizeBytes: 100, createdAt: NOW }]),
      downloadText: vi.fn(async () => report('2026-10-27')),
    });
    const h = await configured(api);
    await h.host.pull();
    expect(h.host.markRead(sid(1)).unread).toBe(0);
    expect(h.host.markRead('sesn_inconnue_x').unread).toBe(0);
    const again = harness({ dir: h.dir, api: fakeApi() });
    expect(again.host.list()).toEqual([expect.objectContaining({ id: sid(1), read: true })]);
    expect(again.host.read(sid(1))?.sections).toEqual([{ heading: 'Calendrier', body: '- 14:30 CPI' }]);
    expect(again.host.read('../agent-cloud')).toBeNull();
    expect(again.host.status()).toMatchObject({ keyStored: true, deploymentId: DEPL, reports: 1, unread: 0 });
  });
});
