import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Super Productivity iframe plugins must be a single self-contained
 * `index.html`: the host serves it via `srcdoc` and does not serve sibling
 * assets. `viteSingleFile` inlines the bundled JS and CSS.
 *
 * `pnpm dev` serves the same UI in a browser for fast iteration; without the
 * host, `PluginAPI` is missing and the app shows a "no host" notice.
 */
export default defineConfig({
  plugins: [solid(), viteSingleFile()],
  resolve: {
    alias: {
      '@sp/plugin-kit': fileURLToPath(
        new URL('../../packages/plugin-kit/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    // Everything gets inlined by vite-plugin-singlefile anyway.
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    minify: true,
    sourcemap: false,
  },
});
