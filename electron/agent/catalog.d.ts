/**
 * Types du module émis vers `dist-electron/agent/catalog.js`.
 * L'implémentation est `src/engine/agent/catalog.ts`.
 */
export const DESK_TOOL_KINDS: Readonly<Record<string, 'read' | 'write'>>;
export const ORCH_PROTOCOL_METHODS: readonly ['desk.auth', 'desk.describe', 'desk.ping'];
export const ORCH_READ_METHODS: readonly string[];
export const ORCH_WRITE_METHODS: readonly string[];
export function orchMethodAllowed(method: string, allowWrites: boolean): boolean;
