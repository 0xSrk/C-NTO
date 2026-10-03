import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

/** Le process Electron type ses imports moteur via des `.d.ts`. Vitest exécute les sources. */
function engineSource(importer: string | undefined, source: string): string | null {
  if (!importer) return null;
  const fromElectron = importer.includes(`${path.sep}electron${path.sep}`) || importer.includes('/electron/');
  if (!fromElectron) return null;
  const target = path.normalize(path.resolve(path.dirname(importer), source));
  const rel = path.relative(path.join(root, 'electron'), target).split(path.sep).join('/');
  const map: Record<string, string> = {
    'execution/guards': 'src/engine/execution/guards.ts',
    'execution/port': 'src/engine/execution/port.ts',
    'copier/router': 'src/engine/copier/router.ts',
    'copier/sync': 'src/engine/copier/sync.ts',
  };
  const hit = map[rel];
  return hit ? path.join(root, hit) : null;
}

export default defineConfig({
  plugins: [
    {
      name: 'canto-engine-from-electron',
      enforce: 'pre',
      resolveId(source, importer) {
        return engineSource(importer, source);
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
