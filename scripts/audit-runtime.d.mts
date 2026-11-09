export const RUNTIME_PACKAGES: string[];
export function runtimeAdvisories(report: unknown, packages?: readonly string[]): { name: string; severity: string; range: string; advisories: string[] }[];
