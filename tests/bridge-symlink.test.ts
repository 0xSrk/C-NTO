import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NinjaBridge } from '../electron/bridge';

describe('pont fichiers · liens', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('n’importe pas un lien symbolique et refuse un dossier qui en est un', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'canto-bridge-'));
    dirs.push(root);
    const folder = path.join(root, 'export');
    const userData = path.join(root, 'user');
    await mkdir(folder);
    await mkdir(userData);
    await writeFile(path.join(folder, 'executions.csv'), 'Instrument,Action\nNQ,Buy\n');
    await symlink(path.join(folder, 'executions.csv'), path.join(folder, 'link.csv'));
    const linkedDir = path.join(root, 'linked');
    await symlink(folder, linkedDir);

    const sent: string[] = [];
    const win = {
      isDestroyed: () => false,
      webContents: {
        once: (_event: string, cb: () => void) => {
          cb();
        },
        send: (channel: string, payload?: { name?: string }) => {
          if (channel === 'bridge:file' && payload?.name) sent.push(payload.name);
        },
      },
    };
    const bridge = new NinjaBridge(userData);
    bridge.attach(win as never);
    const status = await bridge.configure({ folder, enabled: true });
    expect(status.error).toBeUndefined();
    expect(sent).toContain('executions.csv');
    expect(sent).not.toContain('link.csv');

    const viaLink = await bridge.configure({ folder: linkedDir, enabled: true });
    expect(viaLink.error).toMatch(/lien symbolique/);
    bridge.dispose();
  });
});
