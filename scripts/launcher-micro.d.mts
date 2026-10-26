export const OUT: string;
export const LAUNCHER_GLYPHS: readonly string[];
export const RELEASE_LIMITS: Readonly<{ next: number; state: number; channel: number; latency: number }>;
export function generateLauncherMicro(): string;
