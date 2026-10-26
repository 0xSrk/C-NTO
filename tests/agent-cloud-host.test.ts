import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudApiError, type FileView } from '../electron/agent-cloud-api';
import { AGENT_CLOUD_FILE, AGENT_REPORTS_DIR, NO_REPORT_AFTER_MS, PULL_EVERY_MS, PULL_PENDING_MS, SETTLE_MS } from '../electron/agent-cloud';
import { cloudHarness, DEPL, DEPLOYMENT, fakeApi, fid, KEY, NOW, reportText as report, seal, session, sid, type FakeCloudApi, type HarnessOptions } from './helpers/agentCloudFakes';

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

const harness = (opts: HarnessOptions = {}) => cloudHarness(dirs, opts);

async function configured(api: FakeCloudApi, opts: { dir?: string; clock?: { now: number } } = {}) {
  const h = harness({ api, ...opts });
  h.host.setKey(KEY);
  await h.host.setDeployment(DEPL);
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

  it('identifiant de déploiement et planification : forme vérifiée, sinon rien ne change', async () => {
    const { host } = harness();
    expect(await host.setDeployment('depl_../x')).toMatchObject({ deploymentId: null, error: expect.stringContaining('depl_') });
    expect(await host.setDeployment(DEPL)).toMatchObject({ deploymentId: DEPL, managed: false });
    expect(host.setSchedule({ cron: '0 7 * * 1-5; rm -rf /', timezone: 'Europe/Paris' }).schedule).toEqual({ cron: '0 7 * * 1-5', timezone: 'Europe/Paris' });
    expect(host.setSchedule({ cron: '30 13 * * 1-5', timezone: 'America/New_York' }).schedule).toEqual({ cron: '30 13 * * 1-5', timezone: 'America/New_York' });
    expect(await host.setDeployment(null)).toMatchObject({ deploymentId: null, managed: false });
  });

  it('relève : le rapport d’une session finie est rangé ; en cours ou pas encore indexé, attendu ; fini sans rapport, noté', async () => {
    const api = fakeApi({
      listSessions: vi.fn(async () => [
        session(1),
        session(2, { status: 'running', outcomePending: true }),
        session(3, { updatedAt: NOW - 10_000 }),
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

  it('une session relevée ne l’est plus ; celle qui attendait son index est reprise ; au-delà de 60 s, notée sans rapport', async () => {
    const files = new Map<string, FileView[]>([[sid(1), [{ id: fid(1), filename: 'rapport.json', sizeBytes: 400, createdAt: NOW }]]]);
    const api = fakeApi({
      listSessions: vi.fn(async () => [session(1), session(3, { updatedAt: NOW - 10_000 })]),
      listOutputFiles: vi.fn(async (id: string) => files.get(id) ?? []),
      downloadText: vi.fn(async () => report('2026-10-27')),
    });
    const clock = { now: NOW };
    const h = await configured(api, { clock });
    expect((await h.host.pull()).pending).toBe(1);
    clock.now += SETTLE_MS;
    const status = await h.host.pull();
    expect(status.pending).toBe(0);
    expect(status.failures.map((f) => f.kind)).toEqual(['no_report']);
    expect(api.downloadText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.listOutputFiles).mock.calls.map(([id]) => id)).toEqual([sid(1), sid(3)]);
  });

  it('CLD15 session finie avec une évaluation restée ouverte (plafond atteint) : attendue 30 min, puis relevée ou notée', async () => {
    const clock = { now: NOW };
    const api = fakeApi({
      listSessions: vi.fn(async () => [
        session(1, { status: 'idle', outcomePending: true, outcomeResult: null, updatedAt: NOW - 60_000 }),
        session(2, { status: 'idle', outcomePending: true, outcomeResult: null, updatedAt: NOW - 60_000 }),
      ]),
      listOutputFiles: vi.fn(async (id: string) => (id === sid(1) ? [{ id: fid(1), filename: 'rapport.json', sizeBytes: 100, createdAt: NOW }] : [])),
      downloadText: vi.fn(async () => report('2026-10-27')),
    });
    const h = await configured(api, { clock });
    expect(await h.host.pull()).toMatchObject({ pending: 2, reports: 0 });
    expect(api.listOutputFiles).not.toHaveBeenCalled();
    expect(h.host.status().nextPullAt).toBeNull();
    clock.now += NO_REPORT_AFTER_MS;
    const status = await h.host.pull();
    expect(status).toMatchObject({ pending: 0, reports: 1 });
    expect(status.failures.map((f) => [f.kind, f.detail])).toEqual([['no_report', 'idle · outcome ouvert']]);
  });

  it('CLD15 desk resté fermé : les pages suivantes sont lues tant qu’aucune session n’est connue (cinq au plus)', async () => {
    const pages: Record<string, { sessions: ReturnType<typeof session>[]; nextPage: string | null }> = {
      first: { sessions: [session(30), session(29)], nextPage: 'page_2' },
      page_2: { sessions: [session(28), session(27)], nextPage: 'page_3' },
      page_3: { sessions: [session(26), session(1)], nextPage: 'page_4' },
    };
    const api = fakeApi({
      listSessions: vi.fn(async (_id: string, opts?: { page?: string }) => pages[opts?.page ?? 'first']!),
      listOutputFiles: vi.fn(async (id: string) => [{ id: `file_011CNha8iCJcU1wXNR6q${id.slice(-4)}`, filename: 'rapport.json', sizeBytes: 100, createdAt: NOW }]),
      downloadText: vi.fn(async () => report('2026-10-27')),
    });
    const h = await configured(api);
    const config = (h.host as unknown as { config: { collected: Record<string, unknown> } }).config;
    config.collected[sid(1)] = { at: NOW - 86_400_000, ok: true };
    await h.host.pull();
    expect(vi.mocked(api.listSessions).mock.calls.map(([, opts]) => opts?.page)).toEqual([undefined, 'page_2', 'page_3']);
    // Cinq téléchargements par relevé : le sixième attend le suivant.
    expect(h.host.status()).toMatchObject({ reports: 5, pending: 0 });
  });

  it('CLD15 un relevé réussi après une clé refusée relance le relevé automatique', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let refuse = true;
    const api = fakeApi({ getDeployment: vi.fn(async () => (refuse ? Promise.reject(new CloudApiError(403, 'permission_error', 'HTTP 403')) : DEPLOYMENT)) });
    const h = await configured(api);
    h.host.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.host.status().nextPullAt).toBeNull();
    refuse = false;
    expect((await h.host.pull()).nextPullAt).toBe(NOW + PULL_EVERY_MS);
    h.host.shutdown();
  });

  it('CLD15 les non-lus ne comptent que les fiches que le dossier montre (400)', () => {
    const h = harness();
    const dir = path.join(h.dir, AGENT_REPORTS_DIR);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 401; i += 1) {
      const id = `sesn_${String(i).padStart(8, '0')}`;
      const day = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      const body = { v: 1, id, date: day, title: `R${i}`, summary: '', sections: [{ heading: 'A', body: 'b' }], sources: [], generatedAt: null, receivedAt: i, session: { id, createdAt: null, costCents: null, agentVersion: null } };
      writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(body));
    }
    const status = cloudHarness(dirs, { dir: h.dir }).host.status();
    expect(status).toMatchObject({ reports: 401, unread: 400 });
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

  it('CLD16 un rapport qui se date loin de sa session (2100) est refusé : il ne peut pas rester en tête du dossier', async () => {
    const api = fakeApi({
      listSessions: vi.fn(async () => [session(1)]),
      listOutputFiles: vi.fn(async () => [{ id: fid(1), filename: 'rapport.json', sizeBytes: 100, createdAt: NOW }]),
      downloadText: vi.fn(async () => report('2100-12-31')),
    });
    const h = await configured(api);
    const status = await h.host.pull();
    expect(status.reports).toBe(0);
    expect(status.failures.map((f) => [f.kind, f.detail])).toEqual([['invalid', 'date 2100-12-31']]);
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
    // Fiches altérées : un JSON coupé, et une vraie fiche recopiée sous le nom d'une autre session.
    const folder = path.join(h.dir, AGENT_REPORTS_DIR);
    writeFileSync(path.join(folder, `${sid(2)}.json`), '{"v":1,"id":');
    writeFileSync(path.join(folder, `${sid(3)}.json`), readFileSync(path.join(folder, `${sid(1)}.json`), 'utf8'));
    writeFileSync(path.join(folder, 'notes.json'), '{}');
    const tampered = harness({ dir: h.dir, api: fakeApi() });
    expect(() => tampered.host.status()).not.toThrow();
    expect(tampered.host.list().map((r) => r.id)).toEqual([sid(1)]);
    expect(tampered.host.read(sid(3))).toBeNull();
  });
});
