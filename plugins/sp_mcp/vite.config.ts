import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Super Productivity iframe plugins must be a single self-contained
 * `index.html`: the host serves it via `srcdoc` and does not serve sibling
 * assets. `viteSingleFile` inlines the bundled JS and CSS.
 *
 * The protocol module is shared with the Node bridge, so it is aliased twice:
 * the exact subpath first, then the package root (alias matching is by prefix,
 * so order matters).
 */
export default defineConfig({
  plugins: [solid(), viteSingleFile()],
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
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    minify: true,
    sourcemap: false,
  },
});
