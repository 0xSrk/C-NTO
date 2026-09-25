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
  locale: {
    get: () => ipcRenderer.invoke('locale:get') as Promise<'fr' | 'en' | 'es'>,
    set: (locale: 'fr' | 'en' | 'es') => ipcRenderer.invoke('locale:set', locale) as Promise<'fr' | 'en' | 'es'>,
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximized: (cb: (max: boolean) => void) => subscribe<boolean>('window:maximized', cb),
  },
  zoom: {
    get: () => ipcRenderer.invoke('zoom:get'),
    set: (payload: { user?: number; auto?: boolean }) => ipcRenderer.invoke('zoom:set', payload),
    step: (direction: 1 | -1) => ipcRenderer.invoke('zoom:step', direction),
    reset: () => ipcRenderer.invoke('zoom:reset'),
    onChange: (cb: (snap: unknown) => void) => subscribe('zoom:changed', cb),
  },
  files: {
    saveText: (defaultName: string, text: string) => ipcRenderer.invoke('files:save-text', defaultName, text),
    openText: (filters: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('files:open-text', filters),
    pickFolder: () => ipcRenderer.invoke('files:pick-folder'),
    writeInFolder: (folder: string, name: string, text: string, encrypt: boolean) => ipcRenderer.invoke('files:write-in-folder', folder, name, text, encrypt),
  },
  calendar: {
    fetchMacro: (fromDate: string, toDate: string) => ipcRenderer.invoke('calendar:macro', fromDate, toDate),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    apply: (opts?: { channel?: string; confirmStash?: boolean }) => ipcRenderer.invoke('update:apply', opts),
    relaunch: () => ipcRenderer.invoke('update:relaunch'),
    startDesk: () => ipcRenderer.invoke('update:start-desk'),
  },
  orchestrator: {
    start: (port: number, allowWrites?: boolean) => ipcRenderer.invoke('orch:start', port, allowWrites),
    stop: () => ipcRenderer.invoke('orch:stop'),
    status: () => ipcRenderer.invoke('orch:status'),
    rotateToken: () => ipcRenderer.invoke('orch:rotate-token'),
    copyToken: () => ipcRenderer.invoke('orch:copy-token'),
    respond: (id: string, clientId: string, result: unknown, error?: string) => ipcRenderer.send('orch:respond', id, clientId, result, error),
    broadcast: (event: string, payload: unknown) => ipcRenderer.send('orch:broadcast', event, payload),
    onRequest: (cb: (req: unknown) => void) => subscribe('orch:request', cb),
    onStatus: (cb: (status: unknown) => void) => subscribe('orch:status', cb),
  },
  secrets: {
    encrypt: (text: string) => ipcRenderer.invoke('secrets:encrypt', text),
  },
  llm: {
    start: (payload: unknown) => ipcRenderer.invoke('llm:start', payload),
    abort: (requestId: string) => ipcRenderer.send('llm:abort', requestId),
    probe: (config: unknown) => ipcRenderer.invoke('llm:probe', config),
    onDelta: (cb: (payload: { requestId: string; text: string }) => void) => subscribe('llm:delta', cb),
    onDone: (cb: (payload: unknown) => void) => subscribe('llm:done', cb),
    onError: (cb: (payload: { requestId: string; error: string }) => void) => subscribe('llm:error', cb),
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
