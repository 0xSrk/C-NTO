import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'dist-electron');
mkdirSync(dest, { recursive: true });
for (const f of ['launcher.html', 'launcher-ui.js', 'aube.js']) {
  cpSync(path.join(root, 'electron', f), path.join(dest, f));
}
cpSync(path.join(root, 'build', 'logo.svg'), path.join(dest, 'logo.svg'));
// Le lanceur parle la même typographie que le desk : Inter + JetBrains Mono (latin + grec pour Λ / Ξ).
const fonts = path.join(dest, 'fonts');
mkdirSync(fonts, { recursive: true });
for (const [pkg, files] of [
  ['inter', ['inter-latin-wght-normal.woff2', 'inter-greek-wght-normal.woff2']],
  ['jetbrains-mono', ['jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono-greek-wght-normal.woff2']],
]) {
  for (const f of files) cpSync(path.join(root, 'node_modules', '@fontsource-variable', pkg, 'files', f), path.join(fonts, f));
}
console.log('electron assets → dist-electron/');
