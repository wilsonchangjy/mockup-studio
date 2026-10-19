import { defineConfig } from 'vite';
import { TEMPLATES, templateShape } from './src/compose.js';

/* The start screens' template cards, written into index.html (at its
   <!-- templates:… --> markers) from the same list the app uses, so they
   show on first paint instead of waiting for the app's JavaScript. The
   first row loads at high priority: one of them is usually the page's
   largest paint. */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function startCards() {
  const editor = TEMPLATES.map((t, i) => `
        <button class="tpl" type="button" data-template="${t.id}">${t.id === 'blank'
          ? '<span class="art blank dots" aria-hidden="true"><span>+</span></span>'
          : `<img class="art" src="templates/${t.id}.webp" alt=""${i < 3 ? ' fetchpriority="high"' : ''}>`}<span class="t">${esc(t.name)}</span><span class="d">${esc(t.blurb)}</span></button>`).join('');
  const quick = TEMPLATES.filter((t) => t.id !== 'blank').map((t, i) => `
          <button class="q-tpl" type="button" data-template="${t.id}"><img src="templates/${t.id}.webp" alt=""${i < 3 ? ' fetchpriority="high"' : ''}><span><span class="t">${esc(t.name)}</span><span class="d">${templateShape(t)}</span></span></button>`).join('');
  return {
    name: 'start-cards',
    transformIndexHtml: (html) => html
      .replace('<!-- templates:editor -->', editor)
      .replace('<!-- templates:quick -->', quick)
      .replace(/<!-- templates:count -->/g, String(TEMPLATES.length))
      .replace('<!-- templates:quick-count -->', String(TEMPLATES.length - 1)),
  };
}

// The app is fully static: rendering, decoding and encoding all happen
// client-side, so `vite build` output can be hosted anywhere.
export default defineConfig({
  // Relative asset URLs, so the built site works from any folder — Live Server
  // serving dist/ as a subpath, GitHub Pages, or a plain file host.
  base: './',
  plugins: [startCards()],
  server: { port: 5180, strictPort: true },
  // the 3D engine's chunk is mostly three.js, and loads after the start screen
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
});
