import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * La CSP livrée (`index.html`, que le build copie telle quelle) ne laisse au renderer que son origine :
 * `connect-src 'self'` (`CLAUDE.md` § 5). Le serveur de développement recharge la page par un WebSocket local : ce plugin
 * le rend à `connect-src`, et ne s'applique qu'à ce serveur (`apply: 'serve'`), jamais au build.
 */
export function devConnectSrc(): Plugin & { transformIndexHtml: (html: string) => string } {
  return {
    name: 'canto:dev-connect-src',
    apply: 'serve',
    transformIndexHtml: (html: string) => html.replace("connect-src 'self';", "connect-src 'self' ws://127.0.0.1:* ws://localhost:*;"),
  };
}

export default defineConfig({
  plugins: [react(), devConnectSrc()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/dexie')) return 'dexie';
          if (id.includes('node_modules/lightweight-charts')) return 'charts';
          if (id.includes('node_modules/marked') || id.includes('node_modules/dompurify')) return 'markdown';
          return undefined;
        },
      },
    },
  },
});
