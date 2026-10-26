export const MARQUE_COLORS: Readonly<{ led: string; ink: string; night: string; plate: string; ground: string }>;
export const MARQUE_SIZES: readonly number[];
export const ICO_SIZES: readonly number[];
export function marque(px: number): string;
export function packIco(pngs: { size: number; png: Buffer }[]): Buffer;
