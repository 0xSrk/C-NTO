import path from 'node:path';

/**
 * Dossier d'export du pont, sous le répertoire Documents du système.
 * Même arborescence sur Windows, macOS et Linux : le desk natif surveille ce
 * dossier, que NinjaTrader 8 écrive dessus en local (Windows) ou qu'un partage
 * / une synchro y dépose les CSV produits par l'AddOn.
 */
export function defaultNinjaExportFolder(documentsDir: string): string {
  return path.join(documentsDir, 'NinjaTrader 8', 'export', 'CANTO');
}

/** Dossier AddOns de NinjaTrader 8 (la plateforme elle-même est Windows). */
export function ninjaAddOnFolder(documentsDir: string): string {
  return path.join(documentsDir, 'NinjaTrader 8', 'bin', 'Custom', 'AddOns');
}
