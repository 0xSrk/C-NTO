export const PAGE_URL: string;
export const DEFAULT_OUT: string;
export const DEFAULT_OUT_COLUMN: string;
export function standardBrowserPaths(platform: string, env: Record<string, string | undefined>): { edge: string[]; chrome: string[] };
export function resolveBrowser(env?: Record<string, string | undefined>, exists?: (path: string) => boolean, platform?: string): string;
export function pageUrl(scroll?: string): string;
export function browserArgs(out: string, profile: string, url?: string): string[];
export function waitForServer(url: string, timeoutMs?: number): Promise<void>;
