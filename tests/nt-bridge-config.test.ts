import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { writeAddonConfig } from '../electron/nt-bridge/index';
import { NtBridgeServer } from '../electron/nt-bridge/server';

const TOKEN = 'jeton-config-0600';

describe('bridge.json et journal du pont', () => {
  const dirs: string[] = [];
  const servers: NtBridgeServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('écrit bridge.json en 0600 et le jeton n’entre pas dans le journal', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'canto-bridge-'));
    dirs.push(dir);
    const written = await writeAddonConfig(dir, 48231, TOKEN);
    expect((await stat(written.path)).mode & 0o777).toBe(0o600);
    expect(written.aclRestricted).toBe(true);
    expect(await readFile(written.path, 'utf8')).toContain(TOKEN);

    const lines: string[] = [];
    const server = new NtBridgeServer({ token: TOKEN, port: 0, log: (message) => lines.push(message) });
    servers.push(server);
    const port = await server.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=mauvais`);
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.once('error', () => resolve());
    });
    server.killSwitch();
    const journal = lines.join('\n');
    expect(journal).not.toContain(TOKEN);
    expect(journal).not.toContain('mauvais');
  });

  it('sur win32, icacls retire l’héritage et n’accorde que le compte', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'canto-bridge-acl-'));
    dirs.push(dir);
    const calls: string[][] = [];
    const logs: string[] = [];
    const written = await writeAddonConfig(dir, 48231, TOKEN, {
      platform: 'win32',
      username: 'Ada',
      log: (_level, message) => logs.push(message),
      execFile: (cmd, args, cb) => {
        calls.push([cmd, ...args]);
        cb(null);
      },
    });
    expect(calls).toEqual([['icacls', written.path, '/inheritance:r', '/grant:r', 'Ada:F']]);
    expect(written.aclRestricted).toBe(true);
    expect(logs.join('\n')).not.toContain(TOKEN);
  });

  it('si icacls échoue, le fichier reste écrit et les ACL sont signalées non restreintes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'canto-bridge-acl-fail-'));
    dirs.push(dir);
    const calls: string[][] = [];
    const written = await writeAddonConfig(dir, 48231, TOKEN, {
      platform: 'win32',
      username: 'Ada',
      execFile: (cmd, args, cb) => {
        calls.push([cmd, ...args]);
        cb(new Error('accès refusé'));
      },
    });
    expect(calls).toEqual([['icacls', written.path, '/inheritance:r', '/grant:r', 'Ada:F']]);
    expect(written.aclRestricted).toBe(false);
    expect(await readFile(written.path, 'utf8')).toContain(TOKEN);
  });
});
