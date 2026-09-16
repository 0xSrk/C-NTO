import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NinjaBridge } from './bridge';
import { Orchestrator } from './orchestrator';

const DEV_URL = process.env.CANTO_DEV_URL;
let win: BrowserWindow | null = null;
const orchestrator = new Orchestrator();
let bridge: NinjaBridge | null = null;

const isString = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;
const isPort = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535;
const trusted = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => !!win && e.sender === win.webContents;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#04050a',
    show: false,
    title: 'CΛNTO',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      v8CacheOptions: 'bypassHeatCheck',
      backgroundThrottling: true,
    },
  });

  win.once('ready-to-show', () => win?.show());
  win.on('maximize', () => win?.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false));
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  if (DEV_URL) {
    const tryLoad = (attempt: number) => {
      win?.loadURL(DEV_URL).catch(() => {
        if (attempt < 40) setTimeout(() => tryLoad(attempt + 1), 500);
      });
    };
    tryLoad(0);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  orchestrator.attach(win);
  bridge = bridge ?? new NinjaBridge(app.getPath('userData'));
  bridge.attach(win);
}

app.setName('CΛNTO');
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  orchestrator.stop();
  bridge?.dispose();
  if (process.platform !== 'darwin') app.quit();
});

/* ─── Fenêtre ─── */
ipcMain.on('window:minimize', (e) => trusted(e) && win?.minimize());
ipcMain.on('window:toggle-maximize', (e) => trusted(e) && (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on('window:close', (e) => trusted(e) && win?.close());

/* ─── Fichiers (toujours derrière un dialogue système) ─── */
ipcMain.handle('files:save-text', async (e, defaultName: unknown, text: unknown) => {
  if (!trusted(e) || !win || !isString(defaultName, 255) || !isString(text, MAX_TEXT)) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.basename(defaultName) });
  if (canceled || !filePath) return false;
  await fs.writeFile(filePath, text, 'utf8');
  return true;
});
ipcMain.handle('files:open-text', async (e, filters: unknown) => {
  if (!trusted(e) || !win) return null;
  const safeFilters = Array.isArray(filters) ? filters.filter((f): f is { name: string; extensions: string[] } => !!f && isString(f.name, 64) && Array.isArray(f.extensions) && f.extensions.every((x: unknown) => isString(x, 16))) : [];
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: safeFilters });
  if (canceled || filePaths.length === 0) return null;
  const st = await fs.stat(filePaths[0]);
  if (st.size > MAX_TEXT) throw new Error('Fichier trop volumineux (limite 50 Mo)');
  const text = await fs.readFile(filePaths[0], 'utf8');
  return { name: path.basename(filePaths[0]), text };
});
const MAX_TEXT = 50 * 1024 * 1024;

/* ─── Orchestrateur ─── */
ipcMain.handle('orch:start', (e, port: unknown) => (trusted(e) && isPort(port) ? orchestrator.start(port) : orchestrator.status()));
ipcMain.handle('orch:stop', (e) => (trusted(e) ? orchestrator.stop() : orchestrator.status()));
ipcMain.handle('orch:status', () => orchestrator.status());
ipcMain.on('orch:respond', (e, id: unknown, clientId: unknown, result: unknown, error?: unknown) => {
  if (!trusted(e) || !isString(id, 64) || !isString(clientId, 32)) return;
  orchestrator.respond(id, clientId, result, isString(error, 2000) ? error : undefined);
});
ipcMain.on('orch:broadcast', (e, event: unknown, payload: unknown) => {
  if (trusted(e) && isString(event, 64)) orchestrator.broadcast(event, payload);
});

/* ─── Pont NinjaTrader ─── */
ipcMain.handle('bridge:status', () => bridge?.status() ?? null);
ipcMain.handle('bridge:configure', (e, cfg: unknown) => {
  if (!trusted(e) || !bridge || !cfg || typeof cfg !== 'object') return bridge?.status() ?? null;
  const c = cfg as { folder?: unknown; enabled?: unknown };
  return bridge.configure({
    folder: c.folder === null ? null : isString(c.folder, 1024) ? c.folder : undefined,
    enabled: typeof c.enabled === 'boolean' ? c.enabled : undefined,
  });
});
ipcMain.handle('bridge:pick-folder', async (e) => {
  if (!trusted(e) || !win) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Dossier surveillé par le pont NinjaTrader' });
  return canceled || filePaths.length === 0 ? null : filePaths[0];
});
ipcMain.handle('bridge:default-folder', async (e) => {
  if (!trusted(e)) return null;
  const folder = path.join(app.getPath('documents'), 'NinjaTrader 8', 'export', 'CANTO');
  await fs.mkdir(folder, { recursive: true });
  return folder;
});
ipcMain.handle('bridge:rescan', (e) => (trusted(e) && bridge ? bridge.rescan() : bridge?.status() ?? null));
ipcMain.on('bridge:result', (e, fileId: unknown, result: unknown) => {
  if (!trusted(e) || !bridge || !isString(fileId, 32) || !result || typeof result !== 'object') return;
  const r = result as Record<string, unknown>;
  void bridge.onResult(fileId, {
    format: isString(r.format, 64) ? r.format : 'inconnu',
    trades: typeof r.trades === 'number' ? r.trades : 0,
    sessionsAdded: typeof r.sessionsAdded === 'number' ? r.sessionsAdded : 0,
    sessionsMerged: typeof r.sessionsMerged === 'number' ? r.sessionsMerged : 0,
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => isString(w, 500)).slice(0, 20) : [],
  });
});
ipcMain.handle('shell:open-path', async (e, target: unknown) => {
  if (!trusted(e) || !isString(target, 1024)) return false;
  const status = bridge?.status();
  if (!status?.folder || path.resolve(target) !== path.resolve(status.folder)) return false;
  return (await shell.openPath(target)) === '';
});
