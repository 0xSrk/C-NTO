import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultNinjaExportFolder, ninjaAddOnFolder } from '../electron/bridge-folder';

describe('dossier du pont', () => {
  it('place l’export CANTO sous Documents, quel que soit l’OS', () => {
    const documents = path.join('Users', 'trader', 'Documents');
    expect(defaultNinjaExportFolder(documents)).toBe(path.join(documents, 'NinjaTrader 8', 'export', 'CANTO'));
    expect(ninjaAddOnFolder(documents)).toBe(path.join(documents, 'NinjaTrader 8', 'bin', 'Custom', 'AddOns'));
  });
});
