import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudApiError, type FetchLike, type FileView } from '../electron/agent-cloud-api';
import { AGENT_CLOUD_FILE, AGENT_REPORTS_DIR, NO_REPORT_AFTER_MS, PULL_EVERY_MS, PULL_PENDING_MS, SETTLE_MS } from '../electron/agent-cloud';
import { parseFormationState } from '../electron/agent-cloud-formation';
import type { MemoryEntry } from '../electron/agent-cloud-api';
import { AGENT, cloudHarness, DEPL, DEPLOYMENT, ENV, fakeApi, fid, KEY, MEMSTORE, NOW, reportText as report, seal, session, sid, type FakeCloudApi, type HarnessOptions } from './helpers/agentCloudFakes';

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

  it('CLD23 espace de travail : gardé à part du trousseau, rendu au statut, relu au redémarrage, nommé par le client à chaque appel', async () => {
    const WRK = 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ';
    const seen: Record<string, string>[] = [];
    const realFetch = vi.fn<FetchLike>(async (_url, init) => {
      seen.push({ ...(init.headers as Record<string, string>) });
      return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'introuvable' } }), { status: 404 });
    });
    const h = harness({ realFetch });
    h.host.setKey(KEY);
    expect(await h.host.setWorkspace(`  ${WRK}  `)).toMatchObject({ workspaceId: WRK, error: null });
    expect(JSON.parse(readFileSync(path.join(h.dir, AGENT_CLOUD_FILE), 'utf8')).workspaceId).toBe(WRK);
    await h.host.setDeployment(DEPL);
    await h.host.pull();
    h.host.shutdown();
    expect(seen.length).toBeGreaterThan(0);
    for (const headers of seen) expect(headers).toMatchObject({ 'anthropic-workspace-id': WRK, 'x-api-key': KEY });
    expect(harness({ dir: h.dir, realFetch }).host.status().workspaceId).toBe(WRK);
    expect((await h.host.setWorkspace('')).workspaceId).toBeNull();
    expect(JSON.parse(readFileSync(path.join(h.dir, AGENT_CLOUD_FILE), 'utf8')).workspaceId).toBeNull();
  });

  it('CLD23 espace de travail : forme vérifiée ; changé sans installation en cours, il oublie l’environnement d’ailleurs ; nommé au dialogue', async () => {
    const OTHER = 'wrkspc_01KxRwas8sYMB6BHy4ILgGVK';
    const first = harness();
    expect(await first.host.setWorkspace('wrkspc_x\nx')).toMatchObject({ workspaceId: null, error: expect.stringContaining('wrkspc_') });
    expect(await first.host.setWorkspace(42)).toMatchObject({ workspaceId: null });
    const file = path.join(first.dir, AGENT_CLOUD_FILE);
    writeFileSync(file, JSON.stringify({ v: 1, key: seal().encrypt(KEY), environmentId: ENV, managed: false }));
    const started = harness({ dir: first.dir });
    expect(await started.host.setWorkspace(OTHER)).toMatchObject({ workspaceId: OTHER, error: null, busy: null });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ workspaceId: OTHER, environmentId: null, agentId: null, agentVersion: null });
    expect(started.logs).toContain('agent cloud · espace de travail enregistré');
    expect(started.logs.join('\n')).not.toContain(OTHER);
    await started.host.provision();
    expect(started.dialogs[0]?.detail).toContain(`Espace de travail : ${OTHER}`);
    expect(started.api.calls).toEqual([]);
    await started.host.setWorkspace('');
    await started.host.provision();
    expect(started.dialogs[1]?.detail).not.toContain('Espace de travail');
  });

  it('CLD25 changer d’espace ne perd jamais de vue un déploiement qui facture', async () => {
    const WRK = 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ';
    const OTHER = 'wrkspc_01KxRwas8sYMB6BHy4ILgGVK';
    const first = harness();
    const file = path.join(first.dir, AGENT_CLOUD_FILE);
    const base = { v: 1, key: seal().encrypt(KEY), environmentId: ENV, agentId: AGENT, agentVersion: 2 };
    const saved = () => JSON.parse(readFileSync(file, 'utf8'));

    // Déploiement du desk installé avec une clé d'espace (espace implicite), puis clé d'utilisateur : nommer son espace le garde en vue.
    writeFileSync(file, JSON.stringify({ ...base, deploymentId: DEPL, managed: true }));
    const visible = fakeApi({ getDeployment: async () => DEPLOYMENT });
    const named = harness({ dir: first.dir, api: visible });
    expect(await named.host.setWorkspace(WRK)).toMatchObject({ workspaceId: WRK, deploymentId: DEPL, managed: true, error: null });
    expect(vi.mocked(visible.getDeployment).mock.calls).toEqual([[DEPL, { workspace: WRK }]]);
    expect(saved()).toMatchObject({ workspaceId: WRK, environmentId: ENV, agentId: AGENT });

    // Le nouvel espace ne voit pas le déploiement du desk : rien ne change.
    const hidden = fakeApi({ getDeployment: async () => Promise.reject(new CloudApiError(404, 'not_found_error', 'HTTP 404 · not_found_error')) });
    const moved = harness({ dir: first.dir, api: hidden });
    expect(await moved.host.setWorkspace(OTHER)).toMatchObject({ workspaceId: WRK, error: expect.stringContaining('n’est pas visible dans cet espace') });
    expect(await moved.host.setWorkspace('')).toMatchObject({ workspaceId: WRK });
    expect(vi.mocked(hidden.getDeployment).mock.calls).toEqual([[DEPL, { workspace: OTHER }], [DEPL, { workspace: null }]]);
    expect(saved()).toMatchObject({ workspaceId: WRK, deploymentId: DEPL, managed: true, agentId: AGENT });

    // Installation coupée (réponse de création perdue) : le déploiement est cherché par son agent, retrouvé, et devient celui du desk.
    writeFileSync(file, JSON.stringify({ ...base, workspaceId: WRK, managed: false }));
    const lost = fakeApi({ listDeployments: async () => [DEPLOYMENT] });
    const recovered = harness({ dir: first.dir, api: lost });
    expect(await recovered.host.setWorkspace(OTHER)).toMatchObject({ workspaceId: WRK, deploymentId: DEPL, managed: true, error: expect.stringContaining('retrouvé dans l’espace actuel') });
    expect(saved()).toMatchObject({ workspaceId: WRK, deploymentId: DEPL, managed: true, agentId: AGENT });

    // Recherche impossible : rien n'est oublié.
    writeFileSync(file, JSON.stringify({ ...base, workspaceId: WRK, managed: false }));
    const down = harness({ dir: first.dir, api: fakeApi({ listDeployments: async () => Promise.reject(new CloudApiError(0, 'network', 'Réseau indisponible')) }) });
    expect(await down.host.setWorkspace(OTHER)).toMatchObject({ workspaceId: WRK, error: expect.stringContaining('invérifiable') });
    expect(saved()).toMatchObject({ agentId: AGENT, environmentId: ENV });

    // Rien de trouvé : l'espace change, l'installation commencée ailleurs est oubliée.
    const none = fakeApi({ listDeployments: async () => [{ ...DEPLOYMENT, tagged: false }] });
    const clear = harness({ dir: first.dir, api: none });
    expect(await clear.host.setWorkspace(OTHER)).toMatchObject({ workspaceId: OTHER, deploymentId: null, error: null });
    expect(saved()).toMatchObject({ workspaceId: OTHER, agentId: null, environmentId: null });
    expect(none.calls).toEqual(['listDeployments']);
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
    expect(status.failures.map((f) => [f.kind, f.detail])).toEqual(expect.arrayContaining([['no_report', 'terminated · 0,64 $'], ['archived', '']]));
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
    expect(status.failures.map((f) => [f.kind, f.detail])).toEqual([['no_report', 'idle · outcome ouvert · 0,64 $']]);
  });

  it('CLD26 CLD28 session coupée à son plafond : dite « plafond atteint » avec la dépense, sans attendre 30 min ; un rapport déjà écrit est relevé', async () => {
    const api = fakeApi({
      listSessions: vi.fn(async () => [
        // Coût relevé au plafond, évaluation ouverte : en pause au plafond.
        session(1, { status: 'idle', outcomePending: true, outcomeResult: null, costCents: 300, budgetCents: 300, updatedAt: NOW - 2 * 60_000 }),
        // Un centime sous le plafond, évaluation close : au repos pour une autre raison, « sans rapport », avec sa dépense.
        session(2, { status: 'idle', outcomePending: false, outcomeResult: 'failed', costCents: 299, budgetCents: 300, updatedAt: NOW - 2 * 60_000 }),
        // Au plafond, mais le rapport était écrit avant la coupure : il est relevé.
        session(3, { status: 'idle', outcomePending: true, outcomeResult: null, costCents: 301, budgetCents: 300, updatedAt: NOW - 2 * 60_000 }),
        // Loin du plafond, évaluation ouverte : toujours attendue 30 min.
        session(4, { status: 'idle', outcomePending: true, outcomeResult: null, costCents: 120, budgetCents: 300, updatedAt: NOW - 2 * 60_000 }),
      ]),
      listOutputFiles: vi.fn(async (id: string) => (id === sid(3) ? [{ id: fid(3), filename: 'rapport.json', sizeBytes: 100, createdAt: NOW }] : [])),
      downloadText: vi.fn(async () => report('2026-10-27')),
    });
    const h = await configured(api);
    const status = await h.host.pull();
    expect(status).toMatchObject({ reports: 1, pending: 1 });
    expect(status.failures.map((f) => [f.kind, f.detail])).toEqual(expect.arrayContaining([['budget', '3,00 $ / 3,00 $'], ['no_report', 'outcome failed · 2,99 $']]));
    expect(status.failures).toHaveLength(2);
    expect(vi.mocked(api.listOutputFiles).mock.calls.map(([id]) => id)).toEqual([sid(1), sid(2), sid(3)]);
  });

  it('CLD20 desk resté fermé : tout le retard arrive, de la plus ancienne session à la plus récente, sans rien perdre', async () => {
    // Fausse API fidèle : ordre, marque basse (created_at[gte] inclus) et pages de 20.
    const all = Array.from({ length: 45 }, (_, i) => session(i + 1, { createdAt: NOW - (50 - i) * 3_600_000, updatedAt: NOW - (50 - i) * 3_600_000 + 600_000 }));
    const listSessions = vi.fn(async (_id: string, opts?: { limit?: number; page?: string; order?: 'asc' | 'desc'; createdFrom?: string }) => {
      const from = opts?.createdFrom ? Date.parse(opts.createdFrom) : -Infinity;
      const ordered = all.filter((s) => (s.createdAt ?? 0) >= from).sort((a, b) => ((a.createdAt ?? 0) - (b.createdAt ?? 0)) * (opts?.order === 'asc' ? 1 : -1));
      const offset = opts?.page ? Number(opts.page.slice(5)) : 0;
      const limit = opts?.limit ?? 20;
      return { sessions: ordered.slice(offset, offset + limit), nextPage: offset + limit < ordered.length ? `page_${offset + limit}` : null };
    });
    const api = fakeApi({
      listSessions,
      listOutputFiles: vi.fn(async (id: string) => [{ id: `file_011CNha8iCJcU1wXNR6q${id.slice(-4)}`, filename: 'rapport.json', sizeBytes: 100, createdAt: NOW }]),
      downloadText: vi.fn(async () => report('2026-10-27')),
    });
    const h = await configured(api);
    const trail: [number, number][] = [];
    for (let pull = 0; pull < 6; pull += 1) {
      const status = await h.host.pull();
      trail.push([status.reports, status.pending]);
    }
    expect(trail).toEqual([
      [10, 35],
      [20, 25],
      [30, 15],
      [40, 5],
      [45, 0],
      [45, 0],
    ]);
    expect(vi.mocked(listSessions).mock.calls.every(([, opts]) => opts?.order === 'asc')).toBe(true);
    // La marque basse a suivi : le dernier relevé ne repart que de la dernière session réglée.
    expect(vi.mocked(listSessions).mock.calls.at(-1)?.[1]?.createdFrom).toBe(new Date(all[44]!.createdAt!).toISOString());
    expect(JSON.parse(readFileSync(path.join(h.dir, AGENT_CLOUD_FILE), 'utf8')).floor).toBe(new Date(all[44]!.createdAt!).toISOString());
  });

  it('CLD20 une session qui tourne retient la marque : les plus récentes finies sont relevées, elle est reprise ensuite', async () => {
    let running = true;
    const api = fakeApi({
      listSessions: vi.fn(async () => [session(1, { createdAt: NOW - 7_200_000 }), session(2, { createdAt: NOW - 5_400_000, status: running ? 'running' : 'idle', updatedAt: NOW - 120_000 }), session(3, { createdAt: NOW - 3_600_000 })]),
      listOutputFiles: vi.fn(async (id: string) => [{ id: `file_011CNha8iCJcU1wXNR6q${id.slice(-4)}`, filename: 'rapport.json', sizeBytes: 100, createdAt: NOW }]),
      downloadText: vi.fn(async () => report('2026-10-27')),
    });
    const h = await configured(api);
    expect(await h.host.pull()).toMatchObject({ reports: 2, pending: 1 });
    const floor = () => JSON.parse(readFileSync(path.join(h.dir, AGENT_CLOUD_FILE), 'utf8')).floor;
    expect(floor()).toBe(new Date(NOW - 7_200_000).toISOString());
    running = false;
    expect(await h.host.pull()).toMatchObject({ reports: 3, pending: 0 });
    expect(floor()).toBe(new Date(NOW - 3_600_000).toISOString());
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

  it('CLD45 la formation se relève hors déploiement : coût suivi, rapport rangé marqué, plafond sans échec quotidien', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const DAY = 86_400_000;
    const clock = { now: NOW };
    const formation = {
      sessionId: sid(40),
      startedAt: NOW - 3_600_000,
      settled: false,
      history: [
        { id: sid(30), startedAt: NOW - 31 * DAY, costCents: 2500 },
        { id: sid(31), startedAt: NOW - 2 * DAY, costCents: 1000 },
        { id: sid(40), startedAt: NOW - 3_600_000, costCents: null },
      ],
    };
    const write = (dir: string, extra: Record<string, unknown> = {}) =>
      writeFileSync(path.join(dir, AGENT_CLOUD_FILE), JSON.stringify({ v: 1, key: seal().encrypt(KEY), memoryStoreId: MEMSTORE, formation, ...extra }));
    let current = session(40, { status: 'running', deploymentId: null, costCents: 120, budgetCents: 2500, outcomePending: true, outcomeResult: null, createdAt: NOW - 3_600_000, updatedAt: NOW });
    const api = fakeApi({
      getSession: async () => current,
      listOutputFiles: async (id: string) => (id === sid(40) ? [{ id: fid(40), filename: 'rapport.json', sizeBytes: 300, createdAt: NOW }] : []),
      downloadText: async () => report('2026-10-27', 'Formation quant · session du 2026-10-27'),
    });
    const probe = harness();
    write(probe.dir);
    const h = harness({ api, dir: probe.dir, clock });
    // Sans déploiement (quitté, ou jamais installé) : la formation garde le relevé vivant, toutes les 3 min.
    h.host.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.calls).toEqual(['getSession']);
    expect(h.host.status()).toMatchObject({ deploymentId: null, error: null, nextPullAt: NOW + PULL_PENDING_MS, training: { state: 'running', costCents: 120, budgetCents: 2500, capped: false } });
    // Changer d'espace de travail pendant qu'elle facture : refusé, rien n'est oublié.
    expect(await h.host.setWorkspace('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ')).toMatchObject({ workspaceId: null, error: 'Une formation tourne dans l’espace actuel : attendez sa fin ou arrêtez-la avant de changer d’espace.' });
    // Le coût monte ; le cumul des 30 jours le compte, pas une session de 31 jours.
    current = { ...current, costCents: 640 };
    await vi.advanceTimersByTimeAsync(PULL_PENDING_MS);
    expect(h.host.status().training).toMatchObject({ state: 'running', costCents: 640, spent30dCents: 1640, unknownCost: 0 });
    // Au repos : on attend que le dernier fichier soit indexé, puis le rapport est rangé, marqué formation.
    current = { ...current, status: 'idle', outcomePending: false, outcomeResult: 'satisfied', costCents: 1875, updatedAt: clock.now - 10_000 };
    await vi.advanceTimersByTimeAsync(PULL_PENDING_MS);
    expect(h.host.status().training).toMatchObject({ state: 'settling', report: null });
    expect(api.calls).not.toContain('listOutputFiles');
    clock.now += SETTLE_MS;
    await vi.advanceTimersByTimeAsync(PULL_PENDING_MS);
    const ended = h.host.status();
    expect(ended).toMatchObject({ reports: 1, failures: [], training: { state: 'ended', report: 'filed', reportId: sid(40), costCents: 1875, capped: false, spent30dCents: 2875 } });
    expect(JSON.parse(readFileSync(path.join(h.dir, AGENT_REPORTS_DIR, `${sid(40)}.json`), 'utf8'))).toMatchObject({ id: sid(40), kind: 'formation', title: 'Formation quant · session du 2026-10-27', session: { costCents: 1875 } });
    expect(h.host.list()).toEqual([expect.objectContaining({ id: sid(40), kind: 'formation' })]);
    const file = JSON.parse(readFileSync(path.join(h.dir, AGENT_CLOUD_FILE), 'utf8'));
    expect(file.collected).toEqual({});
    expect(file.formation).toMatchObject({ settled: true, result: { report: 'filed', reportId: sid(40), capped: false }, history: [{ id: sid(30) }, { id: sid(31) }, { id: sid(40), costCents: 1875 }] });
    // Réglée et sans déploiement : plus rien ne facture, le relevé automatique s'arrête.
    expect(h.host.status().nextPullAt).toBeNull();
    expect(JSON.stringify(h.host.status())).not.toContain(KEY);
    expect(h.logs.join('\n')).not.toContain(KEY);
    h.host.shutdown();
    vi.useRealTimers();

    // Une autre session coupée à son plafond, sans rapport : un état de la formation, jamais un échec du rapport quotidien.
    const capped = fakeApi({ getSession: async () => session(41, { status: 'idle', deploymentId: null, costCents: 2500, budgetCents: 2500, outcomePending: true, outcomeResult: null, updatedAt: NOW - 120_000 }) });
    const cut = harness();
    write(cut.dir, { formation: { ...formation, sessionId: sid(41), history: [{ id: sid(41), startedAt: NOW - 3_600_000, costCents: null }] } });
    const c = harness({ api: capped, dir: cut.dir });
    const status = await c.host.pull();
    expect(status).toMatchObject({ failures: [], reports: 0, training: { state: 'ended', report: 'missing', reportId: null, capped: true, costCents: 2500 } });
    expect(capped.calls).toEqual(['getSession', 'listOutputFiles', 'listMemories', 'listMemories']);
    expect(JSON.parse(readFileSync(path.join(c.dir, AGENT_CLOUD_FILE), 'utf8')).collected).toEqual({});

    // Les sessions du déploiement sont relevées comme avant, dans le même relevé.
    const both = fakeApi({
      getSession: async () => session(42, { status: 'running', deploymentId: null, budgetCents: 2500 }),
      listSessions: async () => [session(1)],
      listOutputFiles: async () => [{ id: fid(1), filename: 'rapport.json', sizeBytes: 100, createdAt: NOW }],
      downloadText: async () => report('2026-10-27'),
    });
    const mixed = harness();
    write(mixed.dir, { deploymentId: DEPL, formation: { ...formation, sessionId: sid(42), history: [{ id: sid(42), startedAt: NOW, costCents: null }] } });
    const m = harness({ api: both, dir: mixed.dir });
    expect(await m.host.pull()).toMatchObject({ reports: 1, pending: 0, training: { state: 'running' } });
    expect(both.calls).toEqual(['getDeployment', 'listSessions', 'listOutputFiles', 'downloadText', 'listFailedRuns', 'getSession']);
    expect(m.host.list()[0]).not.toHaveProperty('kind');

    // Une panne passagère fait échouer le relevé, la session sera reprise ; rien n'est réglé.
    write(cut.dir);
    const down = harness({ api: fakeApi({ getSession: async () => Promise.reject(new CloudApiError(529, 'overloaded_error', 'HTTP 529 · overloaded_error')) }), dir: cut.dir });
    expect((await down.host.pull())).toMatchObject({ error: 'HTTP 529 · overloaded_error', training: { state: 'running' } });

    // La session de formation change pendant le relevé : rien n'est écrit sur la nouvelle.
    let release: () => void = () => undefined;
    const slow = fakeApi({
      getSession: async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return session(40, { status: 'idle', deploymentId: null, costCents: 999, updatedAt: NOW - 600_000 });
      },
    });
    const racing = harness();
    write(racing.dir);
    const r = harness({ api: slow, dir: racing.dir });
    const pulling = r.host.pull();
    await Promise.resolve();
    (r.host as unknown as { config: { formation: { sessionId: string } } }).config.formation.sessionId = sid(43);
    release();
    await pulling;
    expect(slow.calls).toEqual(['getSession']);
    expect(r.host.status().training).toMatchObject({ sessionId: sid(43), state: 'running', costCents: null, report: null });

    // Formation réglée, installation restée dans l'ancien espace : ses objets, sa session et son résultat sont oubliés, la dépense reste.
    const moving = harness();
    write(moving.dir, { formation: { ...formation, environmentId: ENV, readerId: AGENT, coordinatorId: 'agent_011CZkYpogX7uDKUyvBToCOO', settled: true, result: { report: 'filed', reportId: sid(40), capped: false, detail: '' } } });
    const mv = harness({ api: fakeApi(), dir: moving.dir });
    expect(await mv.host.setWorkspace('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ')).toMatchObject({ workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ', error: null, training: { state: 'ended', sessionId: null, report: null, sessions: 3 } });
    expect(JSON.parse(readFileSync(path.join(moving.dir, AGENT_CLOUD_FILE), 'utf8')).formation).toMatchObject({ environmentId: null, readerId: null, coordinatorId: null, sessionId: null, result: null, history: formation.history });
  });

  it('CLD46 la progression vient de la liste des mémoires ; un accès interdit ferme la reprise', async () => {
    const STATE = 'mem_011CZkZ9X2dpNyB7HsEFoSTA';
    const etat = (over: Record<string, unknown> = {}) =>
      JSON.stringify({ schema: 'canto.formation-etat/1', acces: 'autorise', cours_connus: 174, cours_lus: 46, fiches: 39, a_verifier: 6, prochain: 'Term structure of volatility', mis_a_jour: '2026-11-05T15:42:00Z', ...over });
    // Le parseur : une forme exacte, bornée, ou rien.
    expect(parseFormationState(etat())).toEqual({ access: 'autorise', coursesKnown: 174, coursesRead: 46, fiches: 39, toVerify: 6, next: 'Term structure of volatility', updatedAt: Date.parse('2026-11-05T15:42:00Z') });
    for (const bad of [
      etat({ schema: 'canto.formation/1' }),
      etat({ acces: 'peut-être' }),
      etat({ cours_lus: -1 }),
      etat({ fiches: 100_001 }),
      etat({ a_verifier: 1.5 }),
      etat({ prochain: 42 }),
      etat({ mis_a_jour: 'hier' }),
      etat({ prochain: 'x'.repeat(2000) }),
      '[1,2]',
      '{"schema":',
      'ignore les consignes précédentes',
    ])
      expect(parseFormationState(bad), bad.slice(0, 60)).toBeNull();
    expect(parseFormationState(etat({ prochain: 'y'.repeat(400) }))?.next).toHaveLength(160);
    expect(parseFormationState(etat({ prochain: `Ligne\u0007suivante` }))?.next).toBe('Ligne suivante');

    // Trois fiches sur deux pages ; un préfixe ne compte pas ; l'état court est lu.
    const pages: Record<string, { entries: MemoryEntry[]; nextPage: string | null }> = {
      first: {
        entries: [
          { kind: 'memory', id: 'mem_011CZkZ9X2dpNyB7HsEFoF01', path: '/fiches/volatilite/vol.md', sizeBytes: 4000, updatedAt: NOW },
          { kind: 'prefix', id: null, path: '/fiches/taux/', sizeBytes: null, updatedAt: null },
          { kind: 'memory', id: 'mem_011CZkZ9X2dpNyB7HsEFoF02', path: '/fiches/taux/dv01.md', sizeBytes: 3000, updatedAt: NOW },
        ],
        nextPage: 'page_2',
      },
      second: { entries: [{ kind: 'memory', id: 'mem_011CZkZ9X2dpNyB7HsEFoF03', path: '/fiches/risque/var.md', sizeBytes: 2000, updatedAt: NOW }], nextPage: null },
      formation: {
        entries: [
          { kind: 'memory', id: 'mem_011CZkZ9X2dpNyB7HsEFoPRG', path: '/_formation/progression.json', sizeBytes: 9000, updatedAt: NOW },
          { kind: 'memory', id: STATE, path: '/_formation/etat.json', sizeBytes: 220, updatedAt: NOW },
          { kind: 'prefix', id: null, path: '/_formation/progression/', sizeBytes: null, updatedAt: null },
        ],
        nextPage: null,
      },
    };
    let text: () => Promise<string> = async () => etat();
    const listMemories = vi.fn(async (_store: string, opts: { pathPrefix: string; page?: string }) => (opts.pathPrefix === '/_formation/' ? pages.formation! : opts.page ? pages.second! : pages.first!));
    const progressApi = (over: Parameters<typeof fakeApi>[0] = {}) => fakeApi({ listMemories, getMemoryText: async () => text(), ...over });
    const write = (dir: string, formation: Record<string, unknown> = {}) =>
      writeFileSync(path.join(dir, AGENT_CLOUD_FILE), JSON.stringify({ v: 1, key: seal().encrypt(KEY), memoryStoreId: MEMSTORE, formation }));
    const probe = harness();
    write(probe.dir, { history: [{ id: sid(40), startedAt: NOW - 86_400_000, costCents: 1875 }], settled: true, sessionId: sid(40) });
    const api = progressApi();
    const h = harness({ api, dir: probe.dir });
    await h.host.train();
    expect(api.calls).toEqual(['listStoreSessions', 'listMemories', 'listMemories', 'listMemories', 'getMemoryText']);
    expect(vi.mocked(api.listMemories).mock.calls.map(([store, opts]) => [store, opts])).toEqual([
      [MEMSTORE, { pathPrefix: '/fiches/', page: undefined, limit: 100 }],
      [MEMSTORE, { pathPrefix: '/fiches/', page: 'page_2', limit: 100 }],
      [MEMSTORE, { pathPrefix: '/_formation/', depth: 1 }],
    ]);
    expect(vi.mocked(api.getMemoryText).mock.calls).toEqual([[MEMSTORE, STATE, 8 * 1024]]);
    expect(h.host.status().training.progress).toEqual({ fiches: 3, fichesAtStart: null, coursesRead: 46, coursesKnown: 174, toVerify: 6, next: 'Term structure of volatility', access: 'autorise', at: NOW });
    // Le dialogue la dit ; le desk compte les fiches lui-même, l'état court donne les cours.
    expect(h.dialogs[0]?.detail).toContain('Savoir : 3 fiches, 46 cours lus sur 174 connus');

    // Un état malformé, trop lourd ou d'un autre schéma : les fiches comptées, rien d'autre.
    for (const bad of [async () => '{"schema":', async () => etat({ schema: 'autre/1' }), async () => Promise.reject(new CloudApiError(0, 'too_large', 'Réponse trop volumineuse'))]) {
      text = bad;
      const d = harness();
      write(d.dir);
      const other = harness({ api: progressApi(), dir: d.dir });
      await other.host.train();
      expect(other.host.status().training.progress).toMatchObject({ fiches: 3, coursesRead: null, coursesKnown: null, toVerify: null, next: null, access: null });
      expect(other.dialogs[0]?.detail).toContain('Savoir : 3 fiches');
    }
    text = async () => etat();
    // Une lecture impossible garde la dernière progression, et le lancement continue.
    const kept = harness();
    write(kept.dir, { progress: { fiches: 12, fichesAtStart: 4, coursesRead: 10, coursesKnown: 50, toVerify: 1, next: 'Greeks', access: 'autorise', at: NOW - 1000 } });
    const k = harness({ api: progressApi({ listMemories: async () => Promise.reject(new CloudApiError(529, 'overloaded_error', 'HTTP 529')) }), dir: kept.dir });
    await k.host.train();
    expect(k.host.status().training.progress).toMatchObject({ fiches: 12, next: 'Greeks' });
    expect(k.dialogs).toHaveLength(1);
    // Rien de relu, aucune session : « première session ».
    const first = harness();
    write(first.dir);
    const f = harness({ api: fakeApi(), dir: first.dir });
    await f.host.train();
    expect(f.dialogs[0]?.detail).toContain('Savoir : première session');

    // Accès interdit (robots.txt ou conditions) : la reprise est fermée, sans dialogue ni écriture ; la raison est dite.
    text = async () => etat({ acces: 'interdit', cours_lus: 0, fiches: 0 });
    const closed = harness();
    write(closed.dir, { history: [{ id: sid(40), startedAt: NOW, costCents: 300 }], settled: true, sessionId: sid(40) });
    const c = harness({ api: progressApi(), dir: closed.dir, answers: [0] });
    const refused = await c.host.train();
    expect(refused.error).toBe('La formation a trouvé l’accès à quantmemo.com interdit (robots.txt ou conditions d’utilisation) : elle ne reprend pas. Rouvrir est une décision de l’ADMIN.');
    expect(refused.training).toMatchObject({ state: 'refused', progress: { access: 'interdit' } });
    expect(c.dialogs).toEqual([]);
    expect(c.api.calls.filter((name) => /^(create|update|interrupt)/.test(name))).toEqual([]);

    // Le lancement prend les fiches de départ ; la session réglée relit la progression, et l'écart se lit dans le statut.
    text = async () => etat();
    const launch = harness();
    write(launch.dir, { history: [{ id: sid(40), startedAt: NOW - 86_400_000, costCents: 1875 }], settled: true, sessionId: sid(40), progress: { fiches: 1, fichesAtStart: null, coursesRead: 1, coursesKnown: 9, toVerify: 0, next: 'x', access: 'autorise', at: NOW - 1000 } });
    let live = session(41, { status: 'running', deploymentId: null, budgetCents: 2500, createdAt: NOW, updatedAt: NOW });
    const runApi = progressApi({
      createEnvironment: async () => ({ id: ENV }),
      createAgent: async (body: Record<string, unknown>) => ({ id: body.name === 'CΛNTO · lecteur de cours' ? 'agent_011CZkYpogX7uDKUyvBToREA' : AGENT, version: 1 }),
      createSession: async () => live,
      getSession: async () => live,
    });
    const run = harness({ api: runApi, dir: launch.dir, answers: [0] });
    await run.host.train();
    expect(run.host.status().training).toMatchObject({ state: 'running', progress: { fiches: 3, fichesAtStart: 3 } });
    // Le relevé d'une session qui tourne ne relit pas la progression.
    runApi.calls.length = 0;
    await run.host.pull();
    expect(runApi.calls).toEqual(['getSession']);
    // Réglée : la progression est relue (deux fiches de plus) ; un échec de cette lecture ne fait pas échouer le relevé.
    pages.second = { entries: [...pages.second!.entries, { kind: 'memory', id: 'mem_011CZkZ9X2dpNyB7HsEFoF04', path: '/fiches/taux/convexite.md', sizeBytes: 2000, updatedAt: NOW }, { kind: 'memory', id: 'mem_011CZkZ9X2dpNyB7HsEFoF05', path: '/fiches/derives/parite.md', sizeBytes: 2000, updatedAt: NOW }], nextPage: null };
    live = { ...live, status: 'idle', outcomePending: false, updatedAt: NOW - 120_000 };
    runApi.calls.length = 0;
    const settled = await run.host.pull();
    expect(runApi.calls).toEqual(['getSession', 'listOutputFiles', 'listMemories', 'listMemories', 'listMemories', 'getMemoryText']);
    expect(settled).toMatchObject({ error: null, training: { state: 'ended', progress: { fiches: 5, fichesAtStart: 3 } } });
    expect(JSON.parse(readFileSync(path.join(launch.dir, AGENT_CLOUD_FILE), 'utf8')).formation.progress).toMatchObject({ fiches: 5, fichesAtStart: 3, coursesRead: 46 });
  });
});
