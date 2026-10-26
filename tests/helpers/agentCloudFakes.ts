import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { REPORT_FORMAT } from '@/engine/agent/cloudReport';
import type { CloudApi, DeploymentView, FileView, SessionPage, SessionView } from '../../electron/agent-cloud-api';
import { AgentCloudHost, type AgentCloudDeps, type CloudDialogOptions } from '../../electron/agent-cloud';

export const KEY = 'sk-ant-api03-cle-de-test-0123456789';
export const DEPL = 'depl_011CZkZcDH3vPqd7xnEfwTai';
export const AGENT = 'agent_011CZkYpogX7uDKUyvBTophP';
export const ENV = 'env_011CZkZ9X2dpNyB7HsEFoRfW';
export const NOW = Date.parse('2026-10-27T08:00:00Z');
export const sid = (n: number) => `sesn_011CZkZAtmR3yMPDzynEDx${String(n).padStart(2, '0')}`;
export const fid = (n: number) => `file_011CNha8iCJcU1wXNR6q4V${String(n).padStart(2, '0')}`;

export const DEPLOYMENT: DeploymentView = {
  id: DEPL,
  name: 'canto-rapport-quotidien',
  status: 'active',
  archived: false,
  pausedReason: null,
  agentId: AGENT,
  agentVersion: 2,
  environmentId: ENV,
  cron: '0 7 * * 1-5',
  timezone: 'Europe/Paris',
  nextRunAt: NOW + 86_400_000,
  lastRunAt: NOW - 3_600_000,
  budgetCents: 300,
  tagged: true,
};

export const session = (n: number, over: Partial<SessionView> = {}): SessionView => ({
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

/** Le JSON qu'un agent dépose, au contrat. */
export const reportText = (date: string, title = 'Brief pré-séance') =>
  JSON.stringify({ format: REPORT_FORMAT, date, title, summary: 'Résumé.', sections: [{ heading: 'Calendrier', body: '- 14:30 CPI' }], sources: [], generatedAt: '2026-10-27T06:10:00Z' });

export type FakeCloudApi = CloudApi & { calls: string[] };

/** Faux client de l’API : chaque appel est noté par son nom ; une écriture non prévue par le test échoue. */
/** Les remplacements d'un test ; `listSessions` peut rendre une simple liste (une seule page). */
export type FakeOverrides = Partial<Omit<CloudApi, 'listSessions'>> & {
  listSessions?: (deploymentId: string, opts?: { limit?: number; page?: string }) => Promise<SessionView[] | SessionPage>;
};

export function fakeApi(over: FakeOverrides = {}): FakeCloudApi {
  const calls: string[] = [];
  const note = <T>(name: string, value: T) => {
    calls.push(name);
    return value;
  };
  const refuse = (name: string) => () => {
    calls.push(name);
    return Promise.reject(new Error(`${name} non attendu`));
  };
  const api: CloudApi = {
    getDeployment: vi.fn(async () => note('getDeployment', DEPLOYMENT)),
    listDeployments: vi.fn(async () => note('listDeployments', [] as DeploymentView[])),
    listSessions: vi.fn(async () => note('listSessions', { sessions: [] as SessionView[], nextPage: null })),
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
  };
  const wrapped = Object.fromEntries(
    Object.entries(over).map(([name, fn]) => [
      name,
      vi.fn(async (...args: unknown[]) => {
        calls.push(name);
        const result = await (fn as (...a: unknown[]) => unknown)(...args);
        // Un test peut rendre une simple liste de sessions : une seule page.
        return name === 'listSessions' && Array.isArray(result) ? { sessions: result, nextPage: null } : result;
      }),
    ]),
  );
  return { ...api, ...wrapped, calls };
}

/** Faux trousseau : un blob opaque, réversible, qui ne contient pas la clé en clair. */
export const seal = (available = true) => ({
  available: () => available,
  encrypt: (text: string) => (available ? Buffer.from(`sealed:${[...text].reverse().join('')}`).toString('base64') : null),
  decrypt: (blob: string) => {
    const text = Buffer.from(blob, 'base64').toString('utf8');
    return text.startsWith('sealed:') ? [...text.slice(7)].reverse().join('') : '';
  },
});

export interface HarnessOptions {
  api?: FakeCloudApi;
  dir?: string;
  available?: boolean;
  clock?: { now: number };
  /** Réponses des dialogues, dans l'ordre ; à défaut, l'annulation. */
  answers?: number[];
  /** Sans fenêtre : aucun dialogue ne peut s'ouvrir. */
  noWindow?: boolean;
}

/** Un hôte sur un `userData` temporaire (à effacer par l'appelant : `dirs`). */
export function cloudHarness(dirs: string[], opts: HarnessOptions = {}) {
  const dir = opts.dir ?? mkdtempSync(path.join(tmpdir(), 'canto-agent-cloud-'));
  if (!opts.dir) dirs.push(dir);
  const sent: { channel: string; payload: unknown }[] = [];
  const logs: string[] = [];
  const dialogs: CloudDialogOptions[] = [];
  const answers = [...(opts.answers ?? [])];
  const clock = opts.clock ?? { now: NOW };
  const api = opts.api ?? fakeApi();
  const deps: AgentCloudDeps = {
    userDataDir: dir,
    locale: () => 'fr',
    window: () => (opts.noWindow ? null : { isDestroyed: () => false }),
    showMessageBox: async (_win, options) => {
      dialogs.push(options);
      return { response: answers.shift() ?? options.cancelId };
    },
    send: (channel, payload) => sent.push({ channel, payload }),
    log: (line) => logs.push(line),
    seal: seal(opts.available ?? true),
    fetchImpl: () => Promise.reject(new Error('réseau interdit dans ce test')),
    openPath: async () => true,
    timers: { setTimeout, clearTimeout },
    now: () => clock.now,
    api,
  };
  return { host: new AgentCloudHost(deps), dir, sent, logs, dialogs, api, clock };
}
