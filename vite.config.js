import { defineConfig } from 'vite';

// The app is fully static: rendering, decoding and encoding all happen
// client-side, so `vite build` output can be hosted anywhere.
export default defineConfig({
  // Relative asset URLs, so the built site works from any folder — Live Server
  // serving dist/ as a subpath, GitHub Pages, or a plain file host.
  base: './',
  server: { port: 5180, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
