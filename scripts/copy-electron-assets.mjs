import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Destination : dist-electron/ par défaut ; un dossier en argument pour la vérifier (tests/launcher-page.test.ts).
const dest = path.resolve(process.argv[2] ?? path.join(root, 'dist-electron'));
mkdirSync(dest, { recursive: true });
for (const f of ['launcher.html', 'launcher-ui.js', 'launcher-micro.js', 'aube.js']) {
  cpSync(path.join(root, 'electron', f), path.join(dest, f));
}
cpSync(path.join(root, 'build', 'logo.svg'), path.join(dest, 'logo.svg'));
mkdirSync(path.join(dest, 'changelog'), { recursive: true });
cpSync(path.join(root, 'src', 'engine', 'changelog', 'changelog.json'), path.join(dest, 'changelog', 'changelog.json'));
// Le lanceur parle avec les trois voix du Système 4.0 (Instrument Sans, Geist Mono, IBM Plex Sans), les mêmes
// fichiers woff2 que le desk (src/design/fonts), avec leur licence SIL OFL 1.1. Le desk embarque Doto par le
// bundle Vite : sa licence suit le paquet ici.
const fonts = path.join(dest, 'fonts');
mkdirSync(fonts, { recursive: true });
const voices = path.join(root, 'src', 'design', 'fonts');
for (const name of readdirSync(voices)) {
  if (name.endsWith('.woff2') || /^OFL-.*\.txt$/.test(name)) cpSync(path.join(voices, name), path.join(fonts, name));
}
cpSync(path.join(root, 'electron', 'fonts', 'OFL-Doto.txt'), path.join(fonts, 'OFL-Doto.txt'));
console.log(`electron assets → ${path.relative(root, dest) || dest}/`);
