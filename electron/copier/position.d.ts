/**
 * Types du module émis vers `dist-electron/copier/position.js`.
 * L'implémentation est `src/engine/copier/position.ts`.
 */
export interface MasterExposure {
  pos: number;
  copied: number;
}
export const FLAT: MasterExposure;
export function applyMasterFill(prev: MasterExposure, signed: number, armed: boolean): MasterExposure;
export function rebaseExposure(prev: MasterExposure, actualPos: number): MasterExposure;
export function positionKey(account: string, instrument: string): string;
