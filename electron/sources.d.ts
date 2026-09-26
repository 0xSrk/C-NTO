/**
 * Le JavaScript est émis depuis `src/engine/sources.ts` vers `dist-electron/sources.js`
 * (`electron/tsconfig.sources.json`). Ce fichier ne fait que typer l'import de `main.ts`,
 * dont le `rootDir` ne peut pas avaler `src/`.
 */
export function allowedHosts(): string[];
export function dataFetchAllowed(url: string): boolean;
