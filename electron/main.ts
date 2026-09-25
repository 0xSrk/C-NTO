import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, session, shell } from 'electron';
import { existsSync, mkdirSync, promises as fs, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NinjaBridge } from './bridge';
import { llmHostOk } from './llm-host';
import { Orchestrator } from './orchestrator';
import { fetchMacroReleases } from './macro-calendar';
import { applyUpdate, checkForUpdate, relaunchDesk, type UpdateStatus } from './updater';
import { computeAutoZoom, resolveZoom, snapZoom, stepZoom, suggestWindowSize, type UiZoomMode } from './ui-scale';
import { defaultNinjaExportFolder } from './bridge-folder';
import { hardwareAccelerationEnabled, hasDrmRenderNode } from './gpu-fallback';
import { parseLocale, readLocaleFile, uiText, writeLocaleFile, type AppLocale } from './locale';
import { FolderGrants, isSafeBackupName } from './folder-grants';
import { planUserData } from './user-data';

const DEV_URL = process.env.CANTO_DEV_URL;
const LAUNCHER_MODE = process.argv.includes('--launcher');
/** Taille maximale d'un texte échangé par IPC fichier (import CSV, coffre). */
const MAX_TEXT = 50 * 1024 * 1024;
const LLM_PROBE_TIMEOUT_MS = 15_000;

app.setName('CΛNTO');
// Le dossier de données est fixé avant tout `getPath('userData')` : sous Linux, Chromium vidait le
// nom « CΛNTO » et le coffre atterrissait à la racine de ~/.config (migré ici, une fois).
{
  const plan = planUserData({ platform: process.platform, appData: app.getPath('appData'), exists: (p) => existsSync(p) });
  if (plan.moves.length) {
    try {
      mkdirSync(plan.dir, { recursive: true });
      for (const m of plan.moves) {
        try {
          renameSync(m.from, m.to);
        } catch (err) {
          console.error('[CΛNTO] migration userData impossible pour', m.from, err);
        }
      }
    } catch (err) {
      console.error('[CΛNTO] migration userData impossible', err);
    }
  }
  app.setPath('userData', plan.dir);
  app.setPath('sessionData', plan.dir);
}

const gpuDir = app.getPath('userData');
const gpuAttemptPath = path.join(gpuDir, 'gpu-attempt');
const gpuSoftwarePath = path.join(gpuDir, 'gpu-software');
try {
  mkdirSync(gpuDir, { recursive: true });
} catch {
  /* le dossier userData sera recréé par Electron */
}
const gpuHardware = hardwareAccelerationEnabled({
  platform: process.platform,
  renderNode: hasDrmRenderNode((file) => existsSync(file)),
  openAttempt: existsSync(gpuAttemptPath),
  softwareMarker: existsSync(gpuSoftwarePath),
  envDisabled: process.env.CANTO_DISABLE_GPU === '1',
});
if (!gpuHardware) {
  app.disableHardwareAcceleration();
  // Chromium 128+ refuse SwiftShader sans ce drapeau : sans GPU le processus
  // meurt (« GPU process isn't usable ») et la fenêtre reste noire.
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  if (existsSync(gpuAttemptPath)) {
    try {
      writeFileSync(gpuSoftwarePath, 'software\n');
      unlinkSync(gpuAttemptPath);
    } catch {
      /* marqueur best-effort */
    }
  }
} else {
  try {
    writeFileSync(gpuAttemptPath, `${Date.now()}\n`);
  } catch {
    /* sans marqueur, un crash GPU ne basculera qu'au signal child-process-gone */
  }
}

function acknowledgeGpuFrame(): void {
  try {
    if (existsSync(gpuAttemptPath)) unlinkSync(gpuAttemptPath);
  } catch {
    /* déjà retiré */
  }
}

let gpuRelaunching = false;
function fallBackToSoftware(reason: string): void {
  if (gpuRelaunching || !gpuHardware) return;
  gpuRelaunching = true;
  try {
    writeFileSync(gpuSoftwarePath, `${reason}\n`);
    if (existsSync(gpuAttemptPath)) unlinkSync(gpuAttemptPath);
  } catch {
    /* on relance quand même */
  }
  app.relaunch();
  app.exit(0);
}
let win: BrowserWindow | null = null;
let launcherWin: BrowserWindow | null = null;
const orchestrator = new Orchestrator();
let bridge: NinjaBridge | null = null;
let updateBusy = false;
/** Dossiers accordés par un dialogue système : seuls ceux-là sont accessibles en écriture / surveillance. */
const grants = new FolderGrants(gpuDir);

const isString = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;

function openExternalSafe(url: string): void {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      void shell.openExternal(url);
      return;
    }
    if (u.protocol === 'http:' && u.hostname === '127.0.0.1') {
      void shell.openExternal(url);
    }
  } catch {
    /* URL invalide */
  }
}
const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isPort = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535;
const trusted = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => {
  const s = e.sender;
  return (!!win && s === win.webContents) || (!!launcherWin && s === launcherWin.webContents);
};

function ui(fr: string, en: string, es: string): string {
  return uiText(readLocaleFile(app.getPath('userData')), fr, en, es);
}

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
    height: 620,
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
  launcherWin.once('ready-to-show', () => {
    launcherWin?.show();
    acknowledgeGpuFrame();
  });
  launcherWin.on('closed', () => {
    launcherWin = null;
    if (!win) app.quit();
  });
  void launcherWin.loadFile(path.join(__dirname, 'launcher.html'), { query: { lang: readLocaleFile(app.getPath('userData')) } });
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
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => {
    applyZoom(win);
    win?.show();
    acknowledgeGpuFrame();
  });
  win.webContents.on('did-finish-load', () => {
    applyZoom(win);
    win?.webContents.setBackgroundThrottling(true);
    win?.webContents.send('zoom:changed', zoomSnapshot(win));
  });
  let rendererReloads = 0;
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    console.error('[CΛNTO] processus de rendu arrêté', details.reason);
    if (rendererReloads < 1 && win && !win.isDestroyed()) {
      rendererReloads += 1;
      win.webContents.reload();
    }
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
  const indexFile = path.join(__dirname, '..', 'dist', 'index.html');
  const indexUrl = pathToFileURL(indexFile).href;
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL
      ? url.startsWith(DEV_URL)
      : url === indexUrl || url.startsWith(`${indexUrl}#`) || url.startsWith(`${indexUrl}?`);
    if (!allowed) event.preventDefault();
  });

  const lang = readLocaleFile(app.getPath('userData'));
  const hash = opts.fromLauncher ? '#from-launcher' : '';
  if (DEV_URL) {
    const base = DEV_URL.replace(/\/$/, '');
    const tryLoad = (attempt: number) => {
      win?.loadURL(`${base}/?lang=${lang}${hash}`).catch(() => {
        if (attempt < 40) setTimeout(() => tryLoad(attempt + 1), 500);
      });
    };
    tryLoad(0);
  } else {
    void win.loadFile(indexFile, { query: { lang }, hash: opts.fromLauncher ? 'from-launcher' : '' });
  }

  orchestrator.attach(win);
  bridge = bridge ?? new NinjaBridge(app.getPath('userData'));
  bridge.attach(win);
}

const chromiumLang: Record<AppLocale, string> = { fr: 'fr-FR', en: 'en-US', es: 'es-ES' };
app.commandLine.appendSwitch('lang', chromiumLang[readLocaleFile(app.getPath('userData'))]);
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU' || details.reason === 'clean-exit') return;
  console.error('[CΛNTO] processus GPU arrêté', details.reason);
  fallBackToSoftware(details.reason);
});
if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
/**
 * Durcissement commun à toutes les vues (desk, lanceur, et toute vue future) :
 * aucune fenêtre enfant (les liens https partent vers le navigateur), aucun <webview>,
 * aucune navigation hors du document chargé.
 */
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event, url) => {
    const own = BrowserWindow.fromWebContents(contents);
    if (own && win && own === win) return; // le desk a sa propre règle (DEV_URL / index.html)
    const current = contents.getURL();
    // Le lanceur ne navigue jamais : seul un rechargement du même document est toléré.
    if (!current || url.split('#')[0] !== current.split('#')[0]) event.preventDefault();
  });
});
app.whenReady().then(() => {
  // Aucune permission navigateur (caméra, notifications, géoloc…) ; seule l'écriture presse-papiers
  // assainie reste possible (bouton « Copier le jeton », « Copier le journal »).
  const PERMISSIONS_ALLOWED = new Set(['clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(PERMISSIONS_ALLOWED.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => PERMISSIONS_ALLOWED.has(permission));
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
ipcMain.handle('locale:get', (e) => (trusted(e) ? readLocaleFile(app.getPath('userData')) : 'fr'));
ipcMain.handle('locale:set', (e, value: unknown) => {
  if (!trusted(e)) return 'fr';
  const locale = parseLocale(value);
  if (!locale) return readLocaleFile(app.getPath('userData'));
  writeLocaleFile(app.getPath('userData'), locale);
  return locale;
});

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
      error: err instanceof Error ? err.message : ui('Contrôle impossible', 'Check failed', 'Comprobación imposible'),
      source: 'none',
    };
  }
});
ipcMain.handle('update:apply', async (e, payload: unknown): Promise<UpdateStatus | null> => {
  if (!trusted(e) || updateBusy) return null;
  updateBusy = true;
  try {
    const p = payload && typeof payload === 'object' ? (payload as { channel?: unknown; confirmStash?: unknown }) : {};
    return await applyUpdate({
      channel: typeof p.channel === 'string' ? p.channel : undefined,
      confirmStash: p.confirmStash === true,
    });
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
  const created = !win;
  if (!win) createWindow({ fromLauncher: true });
  else {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  // Le lanceur garde sa LED allumée jusqu'à ce que le desk soit à l'écran : aucun
  // instant sans fenêtre entre les deux. Filet de sécurité si le desk tarde.
  if (launcherWin && !launcherWin.isDestroyed()) {
    const l = launcherWin;
    launcherWin = null;
    const closeLauncher = () => {
      setTimeout(() => {
        if (!l.isDestroyed()) l.close();
      }, 240);
    };
    const desk = win;
    if (created && desk && !desk.isVisible()) {
      const fallback = setTimeout(closeLauncher, 6000);
      desk.once('show', () => {
        clearTimeout(fallback);
        closeLauncher();
      });
    } else closeLauncher();
  }
  return true;
});

/* ─── Calendrier macro (Investing.com → Forex Factory) ─── */
ipcMain.handle('calendar:macro', async (e, fromDate: unknown, toDate: unknown) => {
  if (!trusted(e) || !isDateKey(fromDate) || !isDateKey(toDate)) return { releases: [], source: 'none' as const, error: ui('Plage invalide', 'Invalid range', 'Rango inválido') };
  if (fromDate > toDate) return { releases: [], source: 'none' as const, error: ui('Plage inversée', 'Reversed range', 'Rango invertido') };
  try {
    return await fetchMacroReleases(fromDate, toDate, readLocaleFile(app.getPath('userData')));
  } catch (err) {
    return { releases: [], source: 'none' as const, error: err instanceof Error ? err.message : ui('Sync macro impossible', 'Macro sync failed', 'Sincronización macro imposible') };
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
  const filePath = filePaths[0];
  if (!filePath) return null;
  const st = await fs.stat(filePath);
  if (st.size > MAX_TEXT) throw new Error(ui('Fichier trop volumineux (limite 50 Mo)', 'File too large (50 MB limit)', 'Archivo demasiado grande (límite 50 MB)'));
  const text = await fs.readFile(filePath, 'utf8');
  return { name: path.basename(filePath), text };
});

ipcMain.handle('files:pick-folder', async (e) => {
  if (!trusted(e) || !win) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: ui('Dossier de sauvegarde du coffre', 'Vault backup folder', 'Carpeta de copia de la caja') });
  const picked = canceled || filePaths.length === 0 ? null : filePaths[0];
  return picked ? grants.grant(picked) : null;
});

/**
 * Écriture bornée : uniquement dans un dossier accordé par `files:pick-folder` (persisté dans
 * userData) et sous un nom `canto-vault-….json`. Un renderer compromis ne peut donc pas écrire
 * un fichier arbitraire (profil shell, dossier de démarrage…).
 */
ipcMain.handle('files:write-in-folder', async (e, folder: unknown, name: unknown, text: unknown, encrypt: unknown) => {
  if (!trusted(e) || !isString(folder, 1024) || !isSafeBackupName(name) || !isString(text, MAX_TEXT)) return { ok: false, encrypted: false, reason: 'invalid' };
  if (!grants.has(folder)) return { ok: false, encrypted: false, reason: 'not_granted' };
  let body = text;
  let encrypted = false;
  if (encrypt === true) {
    if (safeStorage.isEncryptionAvailable()) {
      body = JSON.stringify({ format: 'canto-vault-v2-enc', payload: safeStorage.encryptString(text).toString('base64') });
      encrypted = true;
    }
  }
  await fs.mkdir(folder, { recursive: true });
  const dest = path.join(folder, name);
  // Écriture atomique : le fichier précédent reste intact si l'écriture échoue à mi-chemin.
  const tmp = `${dest}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, dest);
  return { ok: true, encrypted, path: dest };
});

/* ─── Orchestrateur ─── */
ipcMain.handle('orch:start', (e, port: unknown, allowWrites: unknown) => (trusted(e) && isPort(port) ? orchestrator.start(port, allowWrites === true) : orchestrator.status()));
ipcMain.handle('orch:stop', (e) => (trusted(e) ? orchestrator.stop() : orchestrator.status()));
ipcMain.handle('orch:status', (e) => (trusted(e) ? orchestrator.status() : { running: false, port: 0, clients: 0 }));
ipcMain.handle('orch:rotate-token', (e) => (trusted(e) ? orchestrator.rotateToken() : orchestrator.status()));
ipcMain.handle('orch:copy-token', (e) => (trusted(e) ? orchestrator.copyToken() : null));
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

/* ─── LLM (process main : la clé ne transite pas par le renderer) ─── */
const llmAbort = new Map<string, AbortController>();

function decryptLlmKey(blob: unknown): string {
  if (typeof blob !== 'string' || !blob || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(blob, 'base64'));
  } catch {
    return '';
  }
}

function joinLlmUrl(base: string, p: string): string {
  return `${base.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`;
}

async function readLlmError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return j.error?.message ?? j.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || res.statusText;
  }
}

async function sseData(res: Response, signal: AbortSignal, onData: (data: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal.aborted) {
      await reader.cancel();
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  }
}

ipcMain.handle('llm:probe', async (e, config: unknown) => {
  if (!trusted(e) || !config || typeof config !== 'object') return { ok: false, detail: ui('Requête invalide', 'Invalid request', 'Solicitud inválida') };
  const c = config as { provider?: unknown; baseUrl?: unknown; apiKeyEncrypted?: unknown; allowedHosts?: unknown };
  if (!isString(c.baseUrl, 2048) || !llmHostOk(c.baseUrl, c.allowedHosts)) return { ok: false, detail: ui('Hôte LLM non autorisé.', 'LLM host not allowed.', 'Host LLM no autorizado.') };
  const key = decryptLlmKey(c.apiKeyEncrypted);
  // Un fournisseur muet ne doit pas laisser le bouton « Tester » tourner indéfiniment.
  const signal = AbortSignal.timeout(LLM_PROBE_TIMEOUT_MS);
  try {
    if (c.provider === 'anthropic') {
      if (!key) return { ok: false, detail: ui('Clé API requise.', 'API key required.', 'Clave API requerida.') };
      const res = await fetch(joinLlmUrl(c.baseUrl, 'v1/models'), { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal });
      if (!res.ok) return { ok: false, detail: `${res.status} — ${await readLlmError(res)}` };
      const j = (await res.json()) as { data?: { id: string }[] };
      return { ok: true, detail: ui(`${j.data?.length ?? 0} modèle(s) disponibles`, `${j.data?.length ?? 0} model(s) available`, `${j.data?.length ?? 0} modelo(s) disponibles`), models: j.data?.map((m) => m.id) };
    }
    const headers: Record<string, string> = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(joinLlmUrl(c.baseUrl, 'models'), { headers, signal });
    if (!res.ok) return { ok: false, detail: `${res.status} — ${await readLlmError(res)}` };
    const j = (await res.json()) as { data?: { id: string }[] };
    const models = j.data?.map((m) => m.id) ?? [];
    return { ok: true, detail: ui(`${models.length} modèle(s) disponibles`, `${models.length} model(s) available`, `${models.length} modelo(s) disponibles`), models };
  } catch (err) {
    if (signal.aborted) return { ok: false, detail: ui('Fournisseur muet (délai dépassé).', 'Provider did not answer (timeout).', 'Proveedor sin respuesta (tiempo agotado).') };
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.on('llm:abort', (e, requestId: unknown) => {
  if (!trusted(e) || !isString(requestId, 64)) return;
  llmAbort.get(requestId)?.abort();
  llmAbort.delete(requestId);
});

ipcMain.handle('llm:start', async (e, payload: unknown) => {
  if (!trusted(e) || !payload || typeof payload !== 'object') return;
  const p = payload as {
    requestId?: unknown;
    config?: { provider?: unknown; baseUrl?: unknown; model?: unknown; temperature?: unknown; apiKeyEncrypted?: unknown };
    messages?: unknown;
    tools?: unknown;
    allowedHosts?: unknown;
  };
  if (!isString(p.requestId, 64) || !p.config || typeof p.config !== 'object' || !isString(p.config.baseUrl, 2048) || !isString(p.config.model, 256)) return;
  const requestId = p.requestId;
  const sender = e.sender;
  if (!llmHostOk(p.config.baseUrl, p.allowedHosts)) {
    sender.send('llm:error', { requestId, error: ui('Hôte LLM non autorisé.', 'LLM host not allowed.', 'Host LLM no autorizado.') });
    return;
  }
  const ac = new AbortController();
  llmAbort.set(requestId, ac);
  const key = decryptLlmKey(p.config.apiKeyEncrypted);
  const provider = p.config.provider === 'anthropic' ? 'anthropic' : 'openai-compatible';
  const model = p.config.model;
  const temperature = typeof p.config.temperature === 'number' ? p.config.temperature : 0.3;
  const messages = Array.isArray(p.messages) ? p.messages : [];
  const tools = Array.isArray(p.tools) ? p.tools : [];
  try {
    if (provider === 'anthropic') {
      await streamAnthropicMain(sender, requestId, p.config.baseUrl, model, temperature, key, messages, tools, ac.signal);
    } else {
      await streamOpenAiMain(sender, requestId, p.config.baseUrl, model, temperature, key, messages, tools, ac.signal);
    }
  } catch (err) {
    if (!ac.signal.aborted) sender.send('llm:error', { requestId, error: err instanceof Error ? err.message : String(err) });
  } finally {
    llmAbort.delete(requestId);
  }
});

type Wc = Electron.WebContents;

async function streamOpenAiMain(
  sender: Wc,
  requestId: string,
  baseUrl: string,
  model: string,
  temperature: number,
  key: string,
  messages: unknown[],
  tools: unknown[],
  signal: AbortSignal,
): Promise<void> {
  const oaMessages = (messages as { role?: string; content?: string; toolCalls?: { id: string; name: string; args: string }[]; toolCallId?: string; name?: string }[]).map((m) => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls?.length ? m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })) : undefined,
      };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    return { role: m.role, content: m.content };
  });
  const body: Record<string, unknown> = { model, messages: oaMessages, stream: true, temperature };
  if (tools.length) body.tools = (tools as { name: string; description: string; parameters: unknown }[]).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(joinLlmUrl(baseUrl, 'chat/completions'), { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`${res.status} — ${await readLlmError(res)}`);
  let text = '';
  const calls = new Map<number, { id: string; name: string; args: string }>();
  await sseData(res, signal, (data) => {
    if (!data || data === '[DONE]') return;
    let json: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      text += delta.content;
      sender.send('llm:delta', { requestId, text: delta.content });
    }
    for (const tc of delta.tool_calls ?? []) {
      const cur = calls.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}`, name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      calls.set(tc.index, cur);
    }
  });
  sender.send('llm:done', { requestId, result: { text, toolCalls: [...calls.values()].filter((c) => c.name) } });
}

async function streamAnthropicMain(
  sender: Wc,
  requestId: string,
  baseUrl: string,
  model: string,
  temperature: number,
  key: string,
  messages: unknown[],
  tools: unknown[],
  signal: AbortSignal,
): Promise<void> {
  const msgs = messages as { role?: string; content?: string; toolCalls?: { id: string; name: string; args: string }[]; toolCallId?: string }[];
  const system = msgs.find((m) => m.role === 'system')?.content;
  const converted: { role: 'user' | 'assistant'; content: unknown }[] = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'user') converted.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        let input: unknown = {};
        try {
          input = tc.args ? JSON.parse(tc.args) : {};
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
      }
      converted.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] });
    } else {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = converted[converted.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block);
      else converted.push({ role: 'user', content: [block] });
    }
  }
  const body: Record<string, unknown> = { model, max_tokens: 4096, stream: true, temperature: Math.max(0, Math.min(1, temperature)), messages: converted };
  if (system) body.system = system;
  if (tools.length) {
    body.tools = (tools as { name: string; description: string; parameters: unknown }[]).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  const res = await fetch(joinLlmUrl(baseUrl, 'v1/messages'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${res.status} — ${await readLlmError(res)}`);
  let text = '';
  const calls: { id: string; name: string; args: string }[] = [];
  const blocks = new Map<number, { id: string; name: string; args: string }>();
  await sseData(res, signal, (data) => {
    if (!data) return;
    let ev: { type: string; index?: number; content_block?: { type: string; id?: string; name?: string }; delta?: { type: string; text?: string; partial_json?: string } };
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.type === 'error') throw new Error((ev as unknown as { error?: { message?: string } }).error?.message ?? ui('Erreur du fournisseur pendant le flux', 'Provider error during the stream', 'Error del proveedor durante el flujo'));
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use' && ev.index !== undefined) {
      blocks.set(ev.index, { id: ev.content_block.id ?? `toolu_${ev.index}`, name: ev.content_block.name ?? '', args: '' });
    } else if (ev.type === 'content_block_delta' && ev.delta) {
      if (ev.delta.type === 'text_delta' && ev.delta.text) {
        text += ev.delta.text;
        sender.send('llm:delta', { requestId, text: ev.delta.text });
      } else if (ev.delta.type === 'input_json_delta' && ev.index !== undefined) {
        const b = blocks.get(ev.index);
        if (b) b.args += ev.delta.partial_json ?? '';
      }
    } else if (ev.type === 'content_block_stop' && ev.index !== undefined) {
      const b = blocks.get(ev.index);
      if (b) {
        calls.push({ ...b, args: b.args || '{}' });
        blocks.delete(ev.index);
      }
    }
  });
  sender.send('llm:done', { requestId, result: { text, toolCalls: calls } });
}

/* ─── Pont NinjaTrader ─── */
ipcMain.handle('bridge:status', (e) => (trusted(e) ? bridge?.status() ?? null : null));
ipcMain.handle('bridge:configure', (e, cfg: unknown) => {
  if (!trusted(e) || !bridge || !cfg || typeof cfg !== 'object') return bridge?.status() ?? null;
  const c = cfg as { folder?: unknown; enabled?: unknown };
  // Le dossier surveillé ne peut venir que d'un dialogue (`bridge:pick-folder`) ou du dossier
  // par défaut : le renderer ne pointe pas le lecteur de CSV vers un chemin de son choix.
  const folder = c.folder === null ? null : isString(c.folder, 1024) && grants.has(c.folder) ? c.folder : undefined;
  return bridge.configure({
    folder,
    enabled: typeof c.enabled === 'boolean' ? c.enabled : undefined,
  });
});
ipcMain.handle('bridge:pick-folder', async (e) => {
  if (!trusted(e) || !win) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: ui('Dossier surveillé par le pont NinjaTrader', 'Folder watched by the NinjaTrader bridge', 'Carpeta vigilada por el puente NinjaTrader') });
  const picked = canceled || filePaths.length === 0 ? null : filePaths[0];
  return picked ? grants.grant(picked) : null;
});
ipcMain.handle('bridge:default-folder', async (e) => {
  if (!trusted(e)) return null;
  const folder = defaultNinjaExportFolder(app.getPath('documents'));
  await fs.mkdir(folder, { recursive: true });
  return grants.grant(folder);
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
    path: isString(r.path, 1024) ? r.path : undefined,
    acceptedIds: Array.isArray(r.acceptedIds) ? r.acceptedIds.filter((id): id is string => isString(id, 200)).slice(0, 20_000) : [],
    skipped: typeof r.skipped === 'number' ? r.skipped : 0,
  });
});
ipcMain.handle('shell:open-path', async (e, target: unknown) => {
  if (!trusted(e) || !isString(target, 1024)) return false;
  const status = bridge?.status();
  if (!status?.folder || path.resolve(target) !== path.resolve(status.folder)) return false;
  return (await shell.openPath(target)) === '';
});
