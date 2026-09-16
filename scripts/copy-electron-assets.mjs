import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'dist-electron');
mkdirSync(dest, { recursive: true });
for (const f of ['launcher.html', 'launcher-ui.js']) {
  cpSync(path.join(root, 'electron', f), path.join(dest, f));
}
console.log('electron assets → dist-electron/');
