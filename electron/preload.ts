import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ChangelogFile } from './changelog';
import type { CryptoFeedEvent, CryptoSeriesId, CryptoTimeframe } from './crypto/markets';
import type { TemperatureReading } from './crypto/temperature';
import type { CryptoMainStatus } from './crypto-electron';

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
  marketdata: {
    subscribe: (req: { instrument: string; kind: 'bars' | 'quote' | 'tick'; timeframe?: number; contractMonth?: string }) =>
      ipcRenderer.invoke('marketdata:subscribe', req) as Promise<{ ok: true; subscriptionId: string } | { ok: false; detail: string; code?: number }>,
    unsubscribe: (id: string) => ipcRenderer.invoke('marketdata:unsubscribe', id) as Promise<{ ok: boolean; detail?: string }>,
    history: (req: { instrument: string; timeframe: number; from: number; to: number }) =>
      ipcRenderer.invoke('marketdata:history', req) as Promise<{ ok: true; bars: unknown[] } | { ok: false; detail: string }>,
    onEvent: (cb: (event: { kind: string }) => void) => subscribe('marketdata:event', cb),
  },
  ntbridge: {
    status: () => ipcRenderer.invoke('ntbridge:status'),
    rotateToken: () => ipcRenderer.invoke('ntbridge:rotate-token'),
    writeConfig: () => ipcRenderer.invoke('ntbridge:write-config'),
    allowAccount: (name: string) => ipcRenderer.invoke('ntbridge:allow-account', name),
    setMaxContracts: (n: number) => ipcRenderer.invoke('ntbridge:max-contracts', n),
    order: (payload: unknown) => ipcRenderer.invoke('ntbridge:order', payload),
    killSwitch: () => ipcRenderer.invoke('ntbridge:killswitch'),
    orders: () => ipcRenderer.invoke('ntbridge:orders'),
    onOrder: (cb: (change: unknown) => void) => subscribe('ntbridge:order-state', cb),
    onStatus: (cb: (status: unknown) => void) => subscribe('ntbridge:status', cb),
    onExecution: (cb: (payload: { csv: string; executionId: string; fill?: Record<string, unknown> }) => void) => subscribe('ntbridge:execution', cb),
  },
  copier: {
    status: () => ipcRenderer.invoke('copier:status'),
    configure: (sync: unknown) => ipcRenderer.invoke('copier:configure', sync) as Promise<boolean>,
    arm: () => ipcRenderer.invoke('copier:arm'),
    cut: () => ipcRenderer.invoke('copier:cut') as Promise<{ cancelled: string[]; open: { account: string; instrument: string; qty: number }[]; flattened: string[] }>,
    onStatus: (cb: (status: unknown) => void) => subscribe('copier:status', cb),
  },
  seat: {
    status: () => ipcRenderer.invoke('seat:status'),
    submit: (line: string) => ipcRenderer.invoke('seat:submit', line),
  },
  crypto: {
    status: () => ipcRenderer.invoke('crypto:status'),
    enable: () => ipcRenderer.invoke('crypto:enable'),
    disable: () => ipcRenderer.invoke('crypto:disable'),
    history: (req: { series: CryptoSeriesId; timeframe: CryptoTimeframe }) => ipcRenderer.invoke('crypto:history', req),
    subscribe: (req: { series: CryptoSeriesId; kind: 'ticker' | 'bars'; timeframe?: CryptoTimeframe }) => ipcRenderer.invoke('crypto:subscribe', req),
    unsubscribe: (id: string) => ipcRenderer.invoke('crypto:unsubscribe', id),
    temperature: () => ipcRenderer.invoke('crypto:temperature'),
    onEvent: (cb: (event: CryptoFeedEvent) => void) => subscribe('crypto:event', cb),
    onTemperature: (cb: (reading: TemperatureReading) => void) => subscribe('crypto:temperature', cb),
    onStatus: (cb: (status: CryptoMainStatus) => void) => subscribe('crypto:status', cb),
  },
  agentOrders: {
    status: () => ipcRenderer.invoke('agent-orders:status'),
    enable: () => ipcRenderer.invoke('agent-orders:enable'),
    disable: () => ipcRenderer.invoke('agent-orders:disable'),
    limits: (raw: unknown) => ipcRenderer.invoke('agent-orders:limits', raw),
    propose: (raw: unknown, origin: string, propShare: number | null, traderRule: unknown = null) => ipcRenderer.invoke('agent-orders:propose', raw, origin, propShare, traderRule),
  },
  agentCloud: {
    status: () => ipcRenderer.invoke('agent-cloud:status'),
    list: () => ipcRenderer.invoke('agent-cloud:list'),
    read: (id: string) => ipcRenderer.invoke('agent-cloud:read', id),
    markRead: (id: string) => ipcRenderer.invoke('agent-cloud:mark-read', id),
    setKey: (text: string) => ipcRenderer.invoke('agent-cloud:set-key', text),
    setWorkspace: (id: string) => ipcRenderer.invoke('agent-cloud:set-workspace', id),
    setDeployment: (id: string | null) => ipcRenderer.invoke('agent-cloud:set-deployment', id),
    setSchedule: (schedule: { cron: string; timezone: string }) => ipcRenderer.invoke('agent-cloud:set-schedule', schedule),
    pull: () => ipcRenderer.invoke('agent-cloud:pull'),
    provision: () => ipcRenderer.invoke('agent-cloud:provision'),
    run: () => ipcRenderer.invoke('agent-cloud:run'),
    pause: () => ipcRenderer.invoke('agent-cloud:pause'),
    unpause: () => ipcRenderer.invoke('agent-cloud:unpause'),
    openFolder: () => ipcRenderer.invoke('agent-cloud:open-folder'),
    onStatus: (cb: (status: unknown) => void) => subscribe('agent-cloud:status', cb),
    onReports: (cb: (list: unknown) => void) => subscribe('agent-cloud:reports', cb),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    changelog: () => ipcRenderer.invoke('update:changelog') as Promise<ChangelogFile | null>,
    apply: (opts?: { channel?: string; confirmStash?: boolean }) => ipcRenderer.invoke('update:apply', opts),
    relaunch: () => ipcRenderer.invoke('update:relaunch'),
    startDesk: () => ipcRenderer.invoke('update:start-desk'),
    onProgress: (cb: (p: { received: number; total: number }) => void) => subscribe('update:progress', cb),
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
  mcp: {
    start: (port: number, allowWrites?: boolean) => ipcRenderer.invoke('mcp:start', port, allowWrites),
    stop: () => ipcRenderer.invoke('mcp:stop'),
    status: () => ipcRenderer.invoke('mcp:status'),
    rotateToken: () => ipcRenderer.invoke('mcp:rotate-token'),
    connection: () => ipcRenderer.invoke('mcp:connection'),
    onStatus: (cb: (status: unknown) => void) => subscribe('mcp:status', cb),
  },
  secrets: {
    encrypt: (text: string, baseUrl?: string) => ipcRenderer.invoke('secrets:encrypt', text, baseUrl),
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
