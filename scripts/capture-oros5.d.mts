export const REPO: string;
export const LANGS: string[];
export const SIZES: { width: number; height: number }[];
export const USER_DATA_DIR_NAME: string;
export const ZONES: string[];
export const GESTURES: Record<'gateway' | 'allowAgentOrders' | 'letExpire' | 'lossAttention' | 'lossCrossed' | 'killSwitch', string>;
export interface CaptureOptions {
  out: string;
  langs: string[];
  sizes: { width: number; height: number }[];
  data: string | null;
  demo: boolean;
  reel: boolean;
  instrument: string | null;
  waitMs: number;
}
export function frontContract(date?: Date): string;
export function parseArgs(argv: readonly string[]): CaptureOptions;
export function dataEnv(platform: string, dir: string): Record<string, string>;
export const DEBUG_PORTS_NOTICE: string;
export function launchEnv(base: Record<string, string | undefined>, extra: Record<string, string | undefined>): Record<string, string | undefined>;
export function electronArgs(platform: string, uid: number | undefined): string[];
export function shotName(lang: string, size: { width: number; height: number }, scene: string): string;
export const consoleOperator: { perform(id: string, ctx?: unknown): Promise<void> };
export function run(opts: CaptureOptions, deps: { playwright: unknown; operator?: { perform(id: string, ctx: unknown): Promise<void> }; onLaunch?: (ctx: { app: unknown; page: unknown; lang: string }) => Promise<void>; phrase: string }): Promise<Record<string, unknown>>;
