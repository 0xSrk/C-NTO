import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Orchestrator } from './orchestrator';

const DEV_URL = process.env.CANTO_DEV_URL;
let win: BrowserWindow | null = null;
const orchestrator = new Orchestrator();

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
    },
  });

  win.once('ready-to-show', () => win?.show());
  win.on('maximize', () => win?.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('window:maximized', false));
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    const tryLoad = (attempt: number) => {
      win?.loadURL(DEV_URL).catch(() => {
        if (attempt < 40) setTimeout(() => tryLoad(attempt + 1), 500);
      });
    };
    tryLoad(0);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  orchestrator.attach(win);
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
  if (process.platform !== 'darwin') app.quit();
});

/* ─── Fenêtre ─── */
ipcMain.on('window:minimize', () => win?.minimize());
ipcMain.on('window:toggle-maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on('window:close', () => win?.close());

/* ─── Fichiers ─── */
ipcMain.handle('files:save-text', async (_e, defaultName: string, text: string) => {
  if (!win) return false;
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: defaultName });
  if (canceled || !filePath) return false;
  await fs.writeFile(filePath, text, 'utf8');
  return true;
});
ipcMain.handle('files:open-text', async (_e, filters: { name: string; extensions: string[] }[]) => {
  if (!win) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (canceled || filePaths.length === 0) return null;
  const text = await fs.readFile(filePaths[0], 'utf8');
  return { name: path.basename(filePaths[0]), text };
});

/* ─── Orchestrateur ─── */
ipcMain.handle('orch:start', (_e, port: number) => orchestrator.start(port));
ipcMain.handle('orch:stop', () => orchestrator.stop());
ipcMain.handle('orch:status', () => orchestrator.status());
ipcMain.on('orch:respond', (_e, id: string, clientId: string, result: unknown, error?: string) => orchestrator.respond(id, clientId, result, error));
ipcMain.on('orch:broadcast', (_e, event: string, payload: unknown) => orchestrator.broadcast(event, payload));
