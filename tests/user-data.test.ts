import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_DIR_NAME, planUserData, USER_DATA_DIR_NAME } from '../electron/user-data';

const cfg = path.join('/home', 't', '.config');
const j = (...p: string[]) => path.join(cfg, ...p);

describe('dossier userData du desk', () => {
  it('garde CΛNTO sous Windows et macOS, sans déplacement', () => {
    const roaming = path.join('C:', 'Users', 't', 'AppData', 'Roaming');
    const win = planUserData({ platform: 'win32', appData: roaming, exists: () => true });
    expect(win.dir).toBe(path.join(roaming, LEGACY_DIR_NAME));
    expect(win.moves).toEqual([]);
    const support = path.join('/Users', 't', 'Library', 'Application Support');
    const mac = planUserData({ platform: 'darwin', appData: support, exists: () => false });
    expect(mac.dir).toBe(path.join(support, LEGACY_DIR_NAME));
  });

  it('utilise un nom ASCII sous Linux', () => {
    const plan = planUserData({ platform: 'linux', appData: cfg, exists: () => false });
    expect(plan.dir).toBe(j(USER_DATA_DIR_NAME));
    expect(plan.moves).toEqual([]);
  });

  it('rapatrie le coffre écrit à la racine de ~/.config par les versions précédentes', () => {
    const present = new Set([j('IndexedDB'), j('Local Storage'), j('bridge-state.json'), j('Cache')]);
    const plan = planUserData({ platform: 'linux', appData: cfg, exists: (p) => present.has(p) });
    expect(plan.dir).toBe(j('CANTO'));
    expect(plan.moves).toEqual([
      { from: j('IndexedDB'), to: j('CANTO', 'IndexedDB') },
      { from: j('Local Storage'), to: j('CANTO', 'Local Storage') },
      { from: j('bridge-state.json'), to: j('CANTO', 'bridge-state.json') },
    ]);
  });

  it('ne migre plus rien une fois le dossier CANTO présent', () => {
    const present = new Set([j('CANTO'), j('IndexedDB')]);
    const plan = planUserData({ platform: 'linux', appData: cfg, exists: (p) => present.has(p) });
    expect(plan.moves).toEqual([]);
  });
});
