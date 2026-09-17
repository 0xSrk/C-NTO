const CAP = 200;

export interface LogEntry {
  at: number;
  level: 'error' | 'warn' | 'info';
  message: string;
}

const ring: LogEntry[] = [];

export function logLine(level: LogEntry['level'], message: string): void {
  ring.push({ at: Date.now(), level, message: String(message).slice(0, 4000) });
  if (ring.length > CAP) ring.splice(0, ring.length - CAP);
}

export function getLogEntries(): readonly LogEntry[] {
  return ring;
}

export function formatTechJournal(): string {
  if (ring.length === 0) return '(journal technique vide)';
  return ring.map((e) => `${new Date(e.at).toISOString()} [${e.level}] ${e.message}`).join('\n');
}

export async function copyTechJournal(): Promise<boolean> {
  const text = formatTechJournal();
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
