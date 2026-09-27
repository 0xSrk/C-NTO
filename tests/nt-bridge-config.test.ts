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
    const file = await writeAddonConfig(dir, 48231, TOKEN);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, 'utf8')).toContain(TOKEN);

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
});
