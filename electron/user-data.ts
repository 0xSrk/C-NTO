import path from 'node:path';

/** Nom de dossier ASCII : Chromium vide « CΛNTO » (Λ non ASCII) sous Linux et `userData` devient `~/.config` lui-même. */
export const USER_DATA_DIR_NAME = 'CANTO';
/** Nom historique (Windows, macOS) : conservé tel quel là où il fonctionne. */
export const LEGACY_DIR_NAME = 'CΛNTO';

/**
 * Entrées du profil Chromium / CΛNTO à rapatrier depuis `~/.config` (Linux, versions ≤ 2.0.1)
 * vers `~/.config/CANTO`. Les caches ne sont pas déplacés : ils se régénèrent.
 */
export const LINUX_LEGACY_ENTRIES = [
  'IndexedDB',
  'Local Storage',
  'Session Storage',
  'WebStorage',
  'Preferences',
  'Local State',
  'Cookies',
  'Cookies-journal',
  'Network Persistent State',
  'bridge-state.json',
  'locale.json',
  'folder-grants.json',
  'gpu-attempt',
  'gpu-software',
] as const;

export interface UserDataPlan {
  /** Dossier `userData` à utiliser. */
  dir: string;
  /** Déplacements à effectuer avant d'ouvrir le profil (source → destination), dans l'ordre. */
  moves: { from: string; to: string }[];
}

export interface UserDataInput {
  platform: NodeJS.Platform;
  /** `app.getPath('appData')` : `~/.config`, `%APPDATA%`, `~/Library/Application Support`. */
  appData: string;
  exists: (p: string) => boolean;
}

/**
 * Décide du dossier de données et de la migration éventuelle. Fonction pure, testée sans Electron.
 *
 * - Windows / macOS : `appData/CΛNTO` reste le dossier (aucun déplacement, aucun risque).
 * - Linux : `appData/CANTO`. Au premier lancement après la correction, les données écrites à tort
 *   à la racine de `~/.config` (coffre IndexedDB, réglages, état du pont) y sont déplacées.
 */
export function planUserData(input: UserDataInput): UserDataPlan {
  if (input.platform !== 'linux') {
    return { dir: path.join(input.appData, LEGACY_DIR_NAME), moves: [] };
  }
  const dir = path.join(input.appData, USER_DATA_DIR_NAME);
  if (input.exists(dir)) return { dir, moves: [] };
  // Signature du bug : un profil Chromium (IndexedDB) posé directement dans ~/.config.
  if (!input.exists(path.join(input.appData, 'IndexedDB'))) return { dir, moves: [] };
  const moves = LINUX_LEGACY_ENTRIES.filter((name) => input.exists(path.join(input.appData, name))).map((name) => ({
    from: path.join(input.appData, name),
    to: path.join(dir, name),
  }));
  return { dir, moves };
}
