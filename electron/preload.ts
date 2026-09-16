import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('canto', {
  isDesk: true,
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version') as Promise<string>,
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximized: (cb: (max: boolean) => void) => subscribe<boolean>('window:maximized', cb),
  },
  files: {
    saveText: (defaultName: string, text: string) => ipcRenderer.invoke('files:save-text', defaultName, text),
    openText: (filters: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('files:open-text', filters),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    apply: () => ipcRenderer.invoke('update:apply'),
    relaunch: () => ipcRenderer.invoke('update:relaunch'),
    startDesk: () => ipcRenderer.invoke('update:start-desk'),
  },
  orchestrator: {
    start: (port: number) => ipcRenderer.invoke('orch:start', port),
    stop: () => ipcRenderer.invoke('orch:stop'),
    status: () => ipcRenderer.invoke('orch:status'),
    rotateToken: () => ipcRenderer.invoke('orch:rotate-token'),
    respond: (id: string, clientId: string, result: unknown, error?: string) => ipcRenderer.send('orch:respond', id, clientId, result, error),
    broadcast: (event: string, payload: unknown) => ipcRenderer.send('orch:broadcast', event, payload),
    onRequest: (cb: (req: unknown) => void) => subscribe('orch:request', cb),
    onStatus: (cb: (status: unknown) => void) => subscribe('orch:status', cb),
  },
  secrets: {
    encrypt: (text: string) => ipcRenderer.invoke('secrets:encrypt', text),
    decrypt: (payload: string) => ipcRenderer.invoke('secrets:decrypt', payload),
  },
  bridge: {
    status: () => ipcRenderer.invoke('bridge:status'),
    configure: (cfg: { folder?: string | null; enabled?: boolean }) => ipcRenderer.invoke('bridge:configure', cfg),
    pickFolder: () => ipcRenderer.invoke('bridge:pick-folder'),
    defaultFolder: () => ipcRenderer.invoke('bridge:default-folder'),
    rescan: () => ipcRenderer.invoke('bridge:rescan'),
    result: (fileId: string, result: unknown) => ipcRenderer.send('bridge:result', fileId, result),
    openFolder: (target: string) => ipcRenderer.invoke('shell:open-path', target),
    onFile: (cb: (file: unknown) => void) => subscribe('bridge:file', cb),
    onStatus: (cb: (status: unknown) => void) => subscribe('bridge:status', cb),
  },
});
