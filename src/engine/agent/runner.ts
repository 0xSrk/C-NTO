import { clampToolArgs } from './ports';
import { runTool, toolKind, DESK_TOOLS } from './tools';
import type { DeskPorts } from './ports';

export type ToolSource = 'llm' | 'orch';

export interface ExecuteCtx {
  source: ToolSource;
  allowWrite?: boolean;
  confirmFn?: (title: string, detail: string) => Promise<boolean>;
}

const KNOWN = new Set(DESK_TOOLS.map((t) => t.name));

function previewArgs(args: string | Record<string, unknown>): string {
  if (typeof args === 'string') return args.slice(0, 400);
  try {
    return JSON.stringify(args).slice(0, 400);
  } catch {
    return '';
  }
}

function parseArgs(args: string | Record<string, unknown>): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof args === 'string') {
    try {
      const parsed = args ? (JSON.parse(args) as unknown) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'Arguments JSON invalides' };
      return { ok: true, args: parsed as Record<string, unknown> };
    } catch {
      return { ok: false, error: 'Arguments JSON invalides' };
    }
  }
  return { ok: true, args: args ?? {} };
}

/** Seul point d’entrée : confirm LLM, allowWrite orch, allowlist de noms, cap body/note. */
export async function executeDeskTool(ports: DeskPorts, name: string, args: string | Record<string, unknown>, ctx: ExecuteCtx): Promise<unknown> {
  if (!KNOWN.has(name)) return { ok: false, reason: 'unknown_tool' };
  const parsed = parseArgs(args);
  if (!parsed.ok) return { error: parsed.error };
  const clamped = clampToolArgs(parsed.args);
  if (!clamped.ok) return { ok: false, reason: clamped.reason };
  if (toolKind(name) === 'write') {
    if (ctx.source === 'orch' && ctx.allowWrite !== true) return { ok: false, reason: 'write_disabled' };
    if (ctx.source === 'llm') {
      const ok = ctx.confirmFn ? await ctx.confirmFn(`L’agent veut exécuter « ${name} »`, `Arguments : ${previewArgs(clamped.args)}`) : false;
      if (!ok) return { ok: false, reason: 'operator_denied' };
    }
  }
  return runTool(ports, name, clamped.args);
}
