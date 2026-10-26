import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentCloudStatus as MainStatus } from '../electron/agent-cloud';
import type { AgentCloudStatus as DeskStatus } from '@/lib/desk';

const main = readFileSync('electron/main.ts', 'utf8');
const preload = readFileSync('electron/preload.ts', 'utf8');
const host = readFileSync('electron/agent-cloud.ts', 'utf8');

const channels = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1] ?? '').sort();

/** Égalité de types, vérifiée par `npm run typecheck` (les tests y sont compilés). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const mirrored: Same<MainStatus, DeskStatus> = true;

describe('agent cloud · câblage IPC', () => {
  it('chaque méthode du preload a son handler, et chaque handler passe d’abord par trusted(e)', () => {
    const invoked = channels(preload, /ipcRenderer\.invoke\('(agent-cloud:[a-z-]+)'/g);
    const handled = channels(main, /ipcMain\.handle\('(agent-cloud:[a-z-]+)'/g);
    expect(invoked).toEqual(handled);
    expect(handled).toEqual(
      ['list', 'mark-read', 'open-folder', 'pause', 'provision', 'pull', 'read', 'run', 'set-deployment', 'set-key', 'set-schedule', 'status', 'unpause'].map((m) => `agent-cloud:${m}`),
    );
    for (const line of main.split('\n').filter((l) => l.includes("ipcMain.handle('agent-cloud:"))) {
      expect(line, line).toMatch(/\(e(, [a-z]+: unknown)?\) => \(trusted\(e\) && agentCloud/);
    }
    expect(main).not.toMatch(/ipcMain\.on\('agent-cloud:/);
  });

  it('la clé et le déploiement sont bornés à l’entrée ; aucune URL ne vient du renderer', () => {
    expect(main).toContain("ipcMain.handle('agent-cloud:set-key', (e, text: unknown) => (trusted(e) && agentCloud && isString(text, 512) ? agentCloud.setKey(text)");
    expect(main).toContain("(id === null || isString(id, 140)) ? agentCloud.setDeployment(id)");
    expect(preload).not.toMatch(/agent-cloud:[a-z-]+', [^)]*url/i);
  });

  it('les deux canaux poussés par l’hôte sont ceux qu’écoute le preload', () => {
    expect(channels(host, /send\('(agent-cloud:[a-z]+)'/g)).toEqual(['agent-cloud:reports', 'agent-cloud:status']);
    expect(channels(preload, /subscribe\('(agent-cloud:[a-z]+)'/g)).toEqual(['agent-cloud:reports', 'agent-cloud:status']);
  });

  it('l’hôte naît dans whenReady, relève à l’ouverture et s’arrête avec les fenêtres', () => {
    const ready = main.slice(main.indexOf('app.whenReady()'), main.indexOf("app.on('window-all-closed'"));
    expect(ready).toContain('agentCloud = new AgentCloudHost({');
    expect(ready).toContain('agentCloud.start();');
    expect(ready).toContain('decrypt: (blob) => decryptLlmKey(blob)');
    const closed = main.slice(main.indexOf("app.on('window-all-closed'"), main.indexOf("app.on('will-quit'"));
    expect(closed).toContain('agentCloud?.shutdown();');
  });

  it('le statut du renderer est le miroir exact de celui du process principal', () => {
    expect(mirrored).toBe(true);
  });
});
