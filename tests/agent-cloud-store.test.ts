/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudReport, CloudReportSummary } from '@/engine/agent/cloudReport';
import type { AgentCloudStatus } from '@/lib/desk';

/** Faux pont : posé avant le chargement de `@/lib/desk`, il note chaque appel et rend des statuts. */
const fake = vi.hoisted(() => {
  const status = (over: Record<string, unknown> = {}) => ({
    available: true,
    keyStored: true,
    workspaceId: null,
    deploymentId: 'depl_011CZkZcDH3vPqd7xnEfwTai',
    managed: true,
    schedule: { cron: '0 7 * * 1-5', timezone: 'Europe/Paris' },
    deployment: null,
    pulling: false,
    busy: null,
    lastPullAt: null,
    nextPullAt: null,
    error: null,
    pending: 0,
    failures: [],
    reports: 2,
    unread: 2,
    ...over,
  });
  const state = {
    calls: [] as unknown[][],
    listeners: { status: [] as ((s: unknown) => void)[], reports: [] as ((l: unknown) => void)[] },
    list: [] as unknown[],
    reads: new Map<string, unknown>(),
    readDelay: new Map<string, Promise<void>>(),
    status,
  };
  const note =
    (name: string, value: (...args: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      state.calls.push([name, ...args]);
      return value(...args);
    };
  (window as unknown as { canto: unknown }).canto = {
    agentCloud: {
      status: note('status', () => status()),
      list: note('list', () => state.list),
      read: async (id: string) => {
        state.calls.push(['read', id]);
        await state.readDelay.get(id);
        return state.reads.get(id) ?? null;
      },
      markRead: note('markRead', () => status({ unread: 1 })),
      setKey: note('setKey', () => status()),
      setWorkspace: note('setWorkspace', () => status({ workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ' })),
      setDeployment: note('setDeployment', () => null),
      setSchedule: note('setSchedule', () => status()),
      pull: note('pull', () => status({ lastPullAt: 1 })),
      provision: note('provision', () => status()),
      run: note('run', () => status({ pending: 1 })),
      pause: note('pause', () => status()),
      unpause: note('unpause', () => status()),
      openFolder: note('openFolder', () => true),
      onStatus: (cb: (s: unknown) => void) => {
        state.listeners.status.push(cb);
        return () => (state.listeners.status = state.listeners.status.filter((x) => x !== cb));
      },
      onReports: (cb: (l: unknown) => void) => {
        state.listeners.reports.push(cb);
        return () => (state.listeners.reports = state.listeners.reports.filter((x) => x !== cb));
      },
    },
  };
  return state;
});

import { resetAgentCloudForTests, useAgentCloud } from '@/store/agentCloud';

const SUMMARY = (n: number, read = false): CloudReportSummary => ({ id: `sesn_0000000${n}`, date: `2026-10-2${n}`, title: `Rapport ${n}`, summary: '', generatedAt: null, receivedAt: n, read });
const REPORT = (n: number): CloudReport => ({ v: 1, ...SUMMARY(n), sections: [{ heading: 'A', body: 'b' }], sources: [], session: { id: `sesn_0000000${n}`, createdAt: null, costCents: null, agentVersion: null } });

beforeEach(() => {
  fake.calls.length = 0;
  fake.list = [SUMMARY(7), SUMMARY(6)];
  fake.reads.clear();
  fake.readDelay.clear();
});
afterEach(() => resetAgentCloudForTests());

describe('agent cloud · store du renderer', () => {
  it('charge le statut et le dossier, une seule fois abonné aux poussées du process principal', async () => {
    await useAgentCloud.getState().load();
    await useAgentCloud.getState().load();
    expect(useAgentCloud.getState()).toMatchObject({ ready: true, reports: fake.list });
    expect(useAgentCloud.getState().status?.unread).toBe(2);
    expect(fake.listeners.status).toHaveLength(1);
    expect(fake.listeners.reports).toHaveLength(1);
    fake.listeners.status[0]?.(fake.status({ unread: 5 }));
    expect(useAgentCloud.getState().status?.unread).toBe(5);
    fake.listeners.reports[0]?.([SUMMARY(8)]);
    expect(useAgentCloud.getState().reports.map((r) => r.id)).toEqual(['sesn_00000008']);
  });

  it('ouvrir une fiche la lit et la marque lue ; la fiche disparue du dossier referme le lecteur', async () => {
    fake.reads.set('sesn_00000007', REPORT(7));
    await useAgentCloud.getState().load();
    await useAgentCloud.getState().select('sesn_00000007');
    expect(useAgentCloud.getState()).toMatchObject({ selectedId: 'sesn_00000007', open: REPORT(7) });
    expect(useAgentCloud.getState().reports.find((r) => r.id === 'sesn_00000007')?.read).toBe(true);
    expect(fake.calls).toContainEqual(['markRead', 'sesn_00000007']);
    expect(useAgentCloud.getState().status?.unread).toBe(1);
    fake.listeners.reports[0]?.([SUMMARY(6)]);
    expect(useAgentCloud.getState()).toMatchObject({ selectedId: null, open: null });
  });

  it('une fiche déjà lue n’est pas re-marquée ; seule la dernière fiche choisie s’affiche', async () => {
    fake.list = [SUMMARY(7, true), SUMMARY(6)];
    fake.reads.set('sesn_00000007', REPORT(7));
    fake.reads.set('sesn_00000006', REPORT(6));
    let release: () => void = () => undefined;
    fake.readDelay.set('sesn_00000007', new Promise<void>((resolve) => (release = resolve)));
    await useAgentCloud.getState().load();
    const slow = useAgentCloud.getState().select('sesn_00000007');
    await useAgentCloud.getState().select('sesn_00000006');
    release();
    await slow;
    expect(useAgentCloud.getState().open?.id).toBe('sesn_00000006');
    expect(fake.calls.filter((c) => c[0] === 'markRead')).toEqual([['markRead', 'sesn_00000006']]);
  });

  it('chaque action passe par sa méthode nommée ; un refus (null) ne change pas le statut', async () => {
    await useAgentCloud.getState().load();
    const s = useAgentCloud.getState();
    await s.pull();
    expect(useAgentCloud.getState().status?.lastPullAt).toBe(1);
    await s.run();
    expect(useAgentCloud.getState().status?.pending).toBe(1);
    await s.setKey('sk-ant-x');
    await s.setWorkspace('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
    expect(useAgentCloud.getState().status?.workspaceId).toBe('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
    await s.setSchedule({ cron: '0 7 * * 1-5', timezone: 'Europe/Paris' });
    await s.provision();
    await s.pause();
    await s.unpause();
    const before = useAgentCloud.getState().status;
    await s.setDeployment(null);
    expect(useAgentCloud.getState().status).toBe(before);
    expect(await s.openFolder()).toBe(true);
    expect(fake.calls.map((c) => c[0])).toEqual(['status', 'list', 'pull', 'run', 'setKey', 'setWorkspace', 'setSchedule', 'provision', 'pause', 'unpause', 'setDeployment', 'openFolder']);
  });

  it('chargé au démarrage du desk, sans étape de démarrage qui attende le réseau', () => {
    const app = readFileSync('src/app/App.tsx', 'utf8');
    expect(app).toContain('void useAgentCloud.getState().load();');
    expect(app).not.toMatch(/step\('agentCloud'/);
  });

  it('le statut ne porte jamais de clé', () => {
    const keys: (keyof AgentCloudStatus)[] = ['available', 'keyStored', 'workspaceId', 'deploymentId', 'managed', 'schedule', 'deployment', 'pulling', 'busy', 'lastPullAt', 'nextPullAt', 'error', 'pending', 'failures', 'reports', 'unread'];
    expect(Object.keys(fake.status()).sort()).toEqual([...keys].sort());
  });
});
