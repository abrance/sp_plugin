import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Host-side bundle: `plugin.js`.
 *
 * Super Productivity loads it with `new Function('plugin', 'PluginAPI', …)` and
 * it must be a single self-contained IIFE, so no code splitting, no imports at
 * runtime. `PluginAPI` stays a free identifier on purpose — it resolves to the
 * host instance that the loader injects.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@sp/plugin-kit/bridge-protocol',
        replacement: fileURLToPath(
          new URL('../../packages/plugin-kit/src/bridge-protocol.ts', import.meta.url),
        ),
      },
      {
        find: '@sp/plugin-kit',
        replacement: fileURLToPath(
          new URL('../../packages/plugin-kit/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
  build: {
    target: 'esnext',
    outDir: 'host-dist',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('src/host/main.ts', import.meta.url)),
      formats: ['iife'],
      name: 'spMcpHost',
      fileName: () => 'plugin.js',
    },
  },
});
