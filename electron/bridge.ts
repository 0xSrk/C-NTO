import type { BrowserWindow } from 'electron';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

export interface BridgeConfig {
  folder: string | null;
  enabled: boolean;
}

export interface BridgeImportSummary {
  at: number;
  file: string;
  format: string;
  trades: number;
  sessionsAdded: number;
  sessionsMerged: number;
  warnings: string[];
}

export interface BridgeStatus {
  enabled: boolean;
  folder: string | null;
  watching: boolean;
  error?: string;
  files: number;
  pending: number;
  processed: number;
  lastEvent?: { at: number; file: string; kind: 'nouveau' | 'modifié' | 'rescan' };
  lastImport?: BridgeImportSummary;
}

export interface BridgeFilePayload {
  id: string;
  name: string;
  path: string;
  size: number;
  text: string;
  kind: 'nouveau' | 'modifié' | 'rescan';
}

interface PersistedState {
  config: BridgeConfig;
  processed: Record<string, { size: number; mtimeMs: number }>;
  lastImport?: BridgeImportSummary;
}

const ACCEPTED = new Set(['.csv', '.txt']);
const MAX_BYTES = 50 * 1024 * 1024;
const DEBOUNCE_MS = 700;
const STABILITY_MS = 350;
const POLL_MS = 4000;
const POLL_WATCHED_MS = 15000;

/**
 * Pont NinjaTrader par fichiers : surveille un dossier dans lequel NinjaTrader (export manuel)
 * ou l'AddOn CΛNTO Bridge (journal temps réel des exécutions) dépose des CSV, et transmet chaque
 * fichier nouveau ou modifié au renderer pour import (le dédoublonnage est fait côté journal).
 */
export class NinjaBridge {
  private win: BrowserWindow | null = null;
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private timers = new Map<string, NodeJS.Timeout>();
  private inflight = new Map<string, { path: string; size: number; mtimeMs: number }>();
  private state: PersistedState = { config: { folder: null, enabled: false }, processed: {} };
  private error: string | undefined;
  private lastEvent: BridgeStatus['lastEvent'];
  private fileCount = 0;
  private seq = 0;
  private readonly stateFile: string;
  private loaded: Promise<void>;

  constructor(userDataDir: string) {
    this.stateFile = path.join(userDataDir, 'bridge-state.json');
    this.loaded = this.load();
  }

  attach(win: BrowserWindow): void {
    this.win = win;
    win.webContents.once('did-finish-load', () => {
      this.loaded.then(() => {
        if (this.state.config.enabled && this.state.config.folder) this.startWatching();
        this.emitStatus();
      });
    });
  }

  status(): BridgeStatus {
    return {
      enabled: this.state.config.enabled,
      folder: this.state.config.folder,
      watching: !!this.watcher || !!this.poll,
      error: this.error,
      files: this.fileCount,
      pending: this.inflight.size + this.timers.size,
      processed: Object.keys(this.state.processed).length,
      lastEvent: this.lastEvent,
      lastImport: this.state.lastImport,
    };
  }

  async configure(cfg: Partial<BridgeConfig>): Promise<BridgeStatus> {
    await this.loaded;
    if (cfg.folder !== undefined && cfg.folder !== this.state.config.folder) {
      this.state.config.folder = cfg.folder;
      this.state.processed = {};
      this.state.lastImport = undefined;
    }
    if (cfg.enabled !== undefined) this.state.config.enabled = cfg.enabled;
    this.error = undefined;
    this.stopWatching();
    if (this.state.config.enabled && this.state.config.folder) await this.startWatching();
    await this.save();
    this.emitStatus();
    return this.status();
  }

  /** Relit tous les fichiers du dossier, y compris ceux déjà traités (le journal dédoublonne). */
  async rescan(): Promise<BridgeStatus> {
    await this.loaded;
    this.state.processed = {};
    await this.save();
    await this.scan('rescan');
    return this.status();
  }

  /** Résultat d'import renvoyé par le renderer pour un fichier transmis. */
  async onResult(fileId: string, result: { format: string; trades: number; sessionsAdded: number; sessionsMerged: number; warnings: string[] }): Promise<void> {
    const entry = this.inflight.get(fileId);
    if (!entry) return;
    this.inflight.delete(fileId);
    this.state.processed[entry.path] = { size: entry.size, mtimeMs: entry.mtimeMs };
    this.state.lastImport = { at: Date.now(), file: path.basename(entry.path), ...result };
    await this.save();
    this.emitStatus();
  }

  dispose(): void {
    this.stopWatching();
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed.config && typeof parsed.config === 'object') {
        this.state.config = { folder: typeof parsed.config.folder === 'string' ? parsed.config.folder : null, enabled: parsed.config.enabled === true };
      }
      if (parsed.processed && typeof parsed.processed === 'object') this.state.processed = parsed.processed;
      if (parsed.lastImport) this.state.lastImport = parsed.lastImport;
    } catch {
      /* premier lancement */
    }
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
      await fs.writeFile(this.stateFile, JSON.stringify(this.state), 'utf8');
    } catch (e) {
      this.error = `Impossible d'enregistrer l'état du pont : ${(e as Error).message}`;
    }
  }

  private async startWatching(): Promise<void> {
    const folder = this.state.config.folder;
    if (!folder) return;
    try {
      const st = await fs.stat(folder);
      if (!st.isDirectory()) throw new Error('Le chemin surveillé n’est pas un dossier');
    } catch (e) {
      this.error = `Dossier inaccessible : ${(e as Error).message}`;
      this.emitStatus();
      return;
    }
    try {
      this.watcher = watch(folder, { persistent: true }, (_event, filename) => {
        if (filename) this.schedule(path.join(folder, filename.toString()));
      });
      this.watcher.on('error', (err) => {
        this.error = `Surveillance interrompue : ${err.message}`;
        this.emitStatus();
      });
    } catch (e) {
      this.error = `Surveillance impossible : ${(e as Error).message}`;
    }
    // fs.watch réagit instantanément ; le balayage périodique n'est qu'un filet de sécurité.
    this.poll = setInterval(() => void this.scan(), this.watcher ? POLL_WATCHED_MS : POLL_MS);
    await this.scan();
  }

  private stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private schedule(file: string): void {
    if (!ACCEPTED.has(path.extname(file).toLowerCase())) return;
    const existing = this.timers.get(file);
    if (existing) clearTimeout(existing);
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file);
        void this.consider(file);
      }, DEBOUNCE_MS),
    );
  }

  private async scan(kind: 'rescan' | undefined = undefined): Promise<void> {
    const folder = this.state.config.folder;
    if (!folder) return;
    let names: string[];
    try {
      names = await fs.readdir(folder);
      this.error = undefined;
    } catch (e) {
      this.error = `Dossier inaccessible : ${(e as Error).message}`;
      this.emitStatus();
      return;
    }
    const files = names.filter((n) => ACCEPTED.has(path.extname(n).toLowerCase()));
    this.fileCount = files.length;
    for (const n of files) await this.consider(path.join(folder, n), kind);
    this.emitStatus();
  }

  private async consider(file: string, forced?: 'rescan'): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return;
    let st;
    try {
      st = await fs.stat(file);
    } catch {
      return;
    }
    if (!st.isFile() || st.size === 0 || st.size > MAX_BYTES) return;
    const done = this.state.processed[file];
    if (!forced && done && done.size === st.size && done.mtimeMs === st.mtimeMs) return;
    if ([...this.inflight.values()].some((f) => f.path === file && f.size === st.size && f.mtimeMs === st.mtimeMs)) return;

    // Attendre que NinjaTrader ait fini d'écrire (taille stable).
    await new Promise((r) => setTimeout(r, STABILITY_MS));
    let st2;
    try {
      st2 = await fs.stat(file);
    } catch {
      return;
    }
    if (st2.size !== st.size || st2.mtimeMs !== st.mtimeMs) {
      this.schedule(file);
      return;
    }
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (e) {
      this.error = `Lecture impossible (${path.basename(file)}) : ${(e as Error).message}`;
      this.emitStatus();
      return;
    }
    const id = `f${++this.seq}`;
    const kind: BridgeFilePayload['kind'] = forced ?? (done ? 'modifié' : 'nouveau');
    this.inflight.set(id, { path: file, size: st2.size, mtimeMs: st2.mtimeMs });
    this.lastEvent = { at: Date.now(), file: path.basename(file), kind };
    const payload: BridgeFilePayload = { id, name: path.basename(file), path: file, size: st2.size, text, kind };
    this.win.webContents.send('bridge:file', payload);
    this.emitStatus();
    setTimeout(() => {
      if (this.inflight.delete(id)) this.emitStatus();
    }, 60_000);
  }

  private emitStatus(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('bridge:status', this.status());
  }
}
