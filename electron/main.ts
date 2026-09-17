import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, session, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NinjaBridge } from './bridge';
import { Orchestrator } from './orchestrator';
import { fetchMacroReleases } from './macro-calendar';
import { applyUpdate, checkForUpdate, relaunchDesk, type UpdateStatus } from './updater';
import { computeAutoZoom, resolveZoom, snapZoom, stepZoom, suggestWindowSize, type UiZoomMode } from './ui-scale';

const DEV_URL = process.env.CANTO_DEV_URL;
const LAUNCHER_MODE = process.argv.includes('--launcher');
let win: BrowserWindow | null = null;
let launcherWin: BrowserWindow | null = null;
const orchestrator = new Orchestrator();
let bridge: NinjaBridge | null = null;
let updateBusy = false;

const isString = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;
const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isPort = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535;
const trusted = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => {
  const s = e.sender;
  return (!!win && s === win.webContents) || (!!launcherWin && s === launcherWin.webContents);
};

const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

/** Préférence zoom envoyée par le renderer (persistée dans IndexedDB). */
let zoomUser = 1;
let zoomAuto = true;

function displayFor(winRef: BrowserWindow | null) {
  if (winRef && !winRef.isDestroyed()) {
    try {
      return screen.getDisplayMatching(winRef.getBounds());
    } catch {
      /* fallback */
    }
  }
  return screen.getPrimaryDisplay();
}

function autoZoomFor(winRef: BrowserWindow | null): number {
  const d = displayFor(winRef);
  return computeAutoZoom(d.workAreaSize.width, d.workAreaSize.height, d.scaleFactor);
}

function effectiveZoom(winRef: BrowserWindow | null = win): number {
  const mode: UiZoomMode = zoomAuto ? 'auto' : 'manual';
  return resolveZoom(autoZoomFor(winRef), zoomUser, mode);
}

function applyZoom(winRef: BrowserWindow | null = win): number {
  const factor = effectiveZoom(winRef);
  if (winRef && !winRef.isDestroyed()) {
    try {
      winRef.webContents.setZoomFactor(factor);
    } catch {
      /* webContents pas prêt */
    }
  }
  return factor;
}

function zoomSnapshot(winRef: BrowserWindow | null = win) {
  const auto = autoZoomFor(winRef);
  const factor = effectiveZoom(winRef);
  const d = displayFor(winRef);
  return {
    factor,
    auto,
    user: zoomUser,
    mode: (zoomAuto ? 'auto' : 'manual') as UiZoomMode,
    display: {
      width: d.workAreaSize.width,
      height: d.workAreaSize.height,
      scaleFactor: d.scaleFactor,
      label: `${d.workAreaSize.width}×${d.workAreaSize.height}`,
    },
  };
}

function createLauncherWindow(): void {
  launcherWin = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#000000',
    show: false,
    title: 'CΛNTO',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  launcherWin.once('ready-to-show', () => launcherWin?.show());
  launcherWin.on('closed', () => {
    launcherWin = null;
    if (!win) app.quit();
  });
  void launcherWin.loadFile(path.join(__dirname, 'launcher.html'));
}

function createWindow(opts: { fromLauncher?: boolean } = {}): void {
  const primary = screen.getPrimaryDisplay();
  const auto = computeAutoZoom(primary.workAreaSize.width, primary.workAreaSize.height, primary.scaleFactor);
  const initialZoom = resolveZoom(auto, zoomUser, zoomAuto ? 'auto' : 'manual');
  const size = suggestWindowSize(primary.workAreaSize.width, primary.workAreaSize.height, initialZoom);

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 1180,
    minHeight: 720,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#000000',
    show: false,
    title: 'CΛNTO',
    icon: iconPath,
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

  win.once('ready-to-show', () => {
    applyZoom(win);
    win?.show();
  });
  win.webContents.on('did-finish-load', () => {
    applyZoom(win);
    win?.webContents.send('zoom:changed', zoomSnapshot(win));
  });
  win.on('maximize', () => win?.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false));
  let moveTimer: ReturnType<typeof setTimeout> | null = null;
  const onDisplayMaybeChanged = () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const before = win.webContents.getZoomFactor();
      const after = applyZoom(win);
      if (Math.abs(before - after) > 0.001) {
        win.webContents.send('zoom:changed', zoomSnapshot(win));
      }
    }, 280);
  };
  win.on('moved', onDisplayMaybeChanged);
  win.on('resized', onDisplayMaybeChanged);
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  const indexFile = path.join(__dirname, '..', 'dist', 'index.html');
  const indexUrl = pathToFileURL(indexFile).href;
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL
      ? url.startsWith(DEV_URL)
      : url === indexUrl || url.startsWith(`${indexUrl}#`) || url.startsWith(`${indexUrl}?`);
    if (!allowed) event.preventDefault();
  });

  const hash = opts.fromLauncher ? '#from-launcher' : '';
  if (DEV_URL) {
    const base = DEV_URL.replace(/\/$/, '');
    const tryLoad = (attempt: number) => {
      win?.loadURL(`${base}/${hash}`).catch(() => {
        if (attempt < 40) setTimeout(() => tryLoad(attempt + 1), 500);
      });
    };
    tryLoad(0);
  } else {
    void win.loadFile(indexFile, { hash: opts.fromLauncher ? 'from-launcher' : '' });
  }

  orchestrator.attach(win);
  bridge = bridge ?? new NinjaBridge(app.getPath('userData'));
  bridge.attach(win);
}

app.setName('CΛNTO');
app.commandLine.appendSwitch('lang', 'fr-FR');
if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  screen.on('display-metrics-changed', () => {
    if (!win || win.isDestroyed()) return;
    applyZoom(win);
    win.webContents.send('zoom:changed', zoomSnapshot(win));
  });
  if (LAUNCHER_MODE) createLauncherWindow();
  else createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (LAUNCHER_MODE) createLauncherWindow();
      else createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  orchestrator.stop();
  bridge?.dispose();
  if (process.platform !== 'darwin') app.quit();
});

/* ─── Fenêtre ─── */
ipcMain.on('window:minimize', (e) => {
  if (!trusted(e)) return;
  (BrowserWindow.fromWebContents(e.sender) ?? win)?.minimize();
});
ipcMain.on('window:toggle-maximize', (e) => {
  if (!trusted(e)) return;
  const w = BrowserWindow.fromWebContents(e.sender) ?? win;
  if (!w) return;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});
ipcMain.on('window:close', (e) => {
  if (!trusted(e)) return;
  (BrowserWindow.fromWebContents(e.sender) ?? win)?.close();
});

ipcMain.handle('app:version', (e) => (trusted(e) ? app.getVersion() : ''));

/* ─── Zoom / calibrage écran ─── */
ipcMain.handle('zoom:get', (e) => (trusted(e) ? zoomSnapshot(BrowserWindow.fromWebContents(e.sender) ?? win) : null));
ipcMain.handle('zoom:set', (e, payload: unknown) => {
  if (!trusted(e) || !payload || typeof payload !== 'object') return null;
  const p = payload as { user?: unknown; auto?: unknown };
  if (typeof p.user === 'number' && Number.isFinite(p.user)) zoomUser = snapZoom(p.user);
  if (typeof p.auto === 'boolean') zoomAuto = p.auto;
  const w = BrowserWindow.fromWebContents(e.sender) ?? win;
  applyZoom(w);
  const snap = zoomSnapshot(w);
  w?.webContents.send('zoom:changed', snap);
  return snap;
});
ipcMain.handle('zoom:step', (e, direction: unknown) => {
  if (!trusted(e) || (direction !== 1 && direction !== -1)) return null;
  const w = BrowserWindow.fromWebContents(e.sender) ?? win;
  const current = effectiveZoom(w);
  zoomAuto = false;
  zoomUser = stepZoom(current, direction);
  applyZoom(w);
  const snap = zoomSnapshot(w);
  w?.webContents.send('zoom:changed', snap);
  return snap;
});
ipcMain.handle('zoom:reset', (e) => {
  if (!trusted(e)) return null;
  zoomAuto = true;
  zoomUser = 1;
  const w = BrowserWindow.fromWebContents(e.sender) ?? win;
  applyZoom(w);
  const snap = zoomSnapshot(w);
  w?.webContents.send('zoom:changed', snap);
  return snap;
});

/* ─── Mise à jour ─── */
ipcMain.handle('update:check', async (e): Promise<UpdateStatus | null> => {
  if (!trusted(e)) return null;
  try {
    return await checkForUpdate();
  } catch (err) {
    return {
      current: app.getVersion(),
      latest: null,
      available: false,
      busy: false,
      error: err instanceof Error ? err.message : 'Contrôle impossible',
      source: 'none',
    };
  }
});
ipcMain.handle('update:apply', async (e): Promise<UpdateStatus | null> => {
  if (!trusted(e) || updateBusy) return null;
  updateBusy = true;
  try {
    return await applyUpdate();
  } finally {
    updateBusy = false;
  }
});
ipcMain.handle('update:relaunch', (e) => {
  if (!trusted(e)) return false;
  relaunchDesk();
  return true;
});
ipcMain.handle('update:start-desk', (e) => {
  if (!trusted(e)) return false;
  if (!win) createWindow({ fromLauncher: true });
  else {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  // Laisse la transition du lanceur se terminer sous le desk déjà visible.
  if (launcherWin && !launcherWin.isDestroyed()) {
    const l = launcherWin;
    launcherWin = null;
    setTimeout(() => {
      if (!l.isDestroyed()) l.close();
    }, 220);
  }
  return true;
});

/* ─── Calendrier macro (Investing.com → Forex Factory) ─── */
ipcMain.handle('calendar:macro', async (e, fromDate: unknown, toDate: unknown) => {
  if (!trusted(e) || !isDateKey(fromDate) || !isDateKey(toDate)) return { releases: [], source: 'none' as const, error: 'Plage invalide' };
  if (fromDate > toDate) return { releases: [], source: 'none' as const, error: 'Plage inversée' };
  try {
    return await fetchMacroReleases(fromDate, toDate);
  } catch (err) {
    return { releases: [], source: 'none' as const, error: err instanceof Error ? err.message : 'Sync macro impossible' };
  }
});

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
ipcMain.handle('orch:status', (e) => (trusted(e) ? orchestrator.status() : { running: false, port: 0, clients: 0, token: '' }));
ipcMain.handle('orch:rotate-token', (e) => (trusted(e) ? orchestrator.rotateToken() : orchestrator.status()));
ipcMain.on('orch:respond', (e, id: unknown, clientId: unknown, result: unknown, error?: unknown) => {
  if (!trusted(e) || !isString(id, 64) || !isString(clientId, 32)) return;
  orchestrator.respond(id, clientId, result, isString(error, 2000) ? error : undefined);
});
ipcMain.on('orch:broadcast', (e, event: unknown, payload: unknown) => {
  if (trusted(e) && isString(event, 64)) orchestrator.broadcast(event, payload);
});

/* ─── Secrets (clé API chiffrée par le trousseau du système) ─── */
ipcMain.handle('secrets:encrypt', (e, text: unknown) => {
  if (!trusted(e) || !isString(text, 4096)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(text).toString('base64');
});
ipcMain.handle('secrets:decrypt', (e, payload: unknown) => {
  if (!trusted(e) || !isString(payload, 16384)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(payload, 'base64'));
  } catch {
    return null;
  }
});

/* ─── Pont NinjaTrader ─── */
ipcMain.handle('bridge:status', (e) => (trusted(e) ? bridge?.status() ?? null : null));
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
