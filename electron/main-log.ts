import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Journal du process principal : `<userData>/logs/main.log`.
 * Une application installée n'a pas de console : sans ce fichier, un démarrage raté
 * sur un poste ne laisse aucune trace. Écriture synchrone et best-effort (jamais d'exception).
 */
export const LOG_MAX_BYTES = 512 * 1024;

let logFile: string | null = null;

export function initMainLog(userDataDir: string): string {
  const dir = path.join(userDataDir, 'logs');
  logFile = path.join(dir, 'main.log');
  try {
    mkdirSync(dir, { recursive: true });
    const size = statSync(logFile, { throwIfNoEntry: false })?.size ?? 0;
    if (size > LOG_MAX_BYTES) {
      renameSync(logFile, path.join(dir, 'main.old.log'));
    }
  } catch {
    /* journal best-effort */
  }
  return logFile;
}

export function formatLogLine(level: 'info' | 'warn' | 'error', message: string, at: Date = new Date()): string {
  return `${at.toISOString()} ${level.toUpperCase().padEnd(5)} ${message.replace(/\r?\n/g, ' ⏎ ')}\n`;
}

export function mainLog(level: 'info' | 'warn' | 'error', message: string): void {
  if (level === 'error') console.error('[CΛNTO]', message);
  if (!logFile) return;
  try {
    appendFileSync(logFile, formatLogLine(level, message));
  } catch {
    /* disque plein ou dossier verrouillé : on n'empêche pas l'application de tourner */
  }
}

export function mainLogPath(): string | null {
  return logFile;
}
