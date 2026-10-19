/* =====================================================================
   Shared by both interfaces (ui.js, quick.js) and the start screens
   (start.js): toasts and the About page. No three.js, so the start screens
   can use them before the 3D engine has loaded.
   ===================================================================== */

import { MODEL_CREDITS } from './catalog.js';

const $ = (s, r = document) => r.querySelector(s);

let toastTimer = null;
let toastImpl = null;
/** Quick mode shows its own toasts; the app's actions call toast() either way. */
export function setToast(fn) { toastImpl = fn; }
export function toast(msg, kind = '') {
  if (toastImpl) return toastImpl(msg, kind);
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ` ${kind}` : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 6000 : 3200);
}

/* =========================== static content =========================== */

export function aboutHTML() {
  const libs = [
    ['three.js', 'https://threejs.org', 'MIT'],
    ['mp4box.js', 'https://github.com/gpac/mp4box.js', 'BSD-3-Clause'],
    ['mp4-muxer', 'https://github.com/Vanilagy/mp4-muxer', 'MIT'],
    ['Vite (build)', 'https://vitejs.dev', 'MIT'],
    ['Instrument Sans, IBM Plex Mono, Doto (fonts)', 'https://openfontlicense.org', 'OFL-1.1'],
  ];
  const link = (url, text) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
  // model credits, one group per author and licence: CC BY first, then by how many models each made
  const inGroup = (g) => MODEL_CREDITS.filter((c) => c.author === g.author && c.licence === g.licence);
  const groups = [...new Map(MODEL_CREDITS.map((c) => [`${c.author}|${c.licence}`, c])).values()]
    .sort((a, b) => a.licence.includes('NC') - b.licence.includes('NC') || inGroup(b).length - inGroup(a).length);
  const credits = groups.map((g) => `
    <div>
      <p>${link(g.authorUrl, g.author)} <span class="dim">· ${link(g.licenceUrl, g.licence)}</span></p>
      <ul>${inGroup(g)
        .map((c) => `<li>${link(c.url, c.title)}${c.licence.includes('NC') ? ' <i class="tag">NC</i>' : ''}</li>`).join('')}</ul>
    </div>`).join('');
  return `
  <header class="sheet-head">
    <div>
      <h2 id="about-title">Mockup <span class="dotted">Stu<span class="di">di</span>o</span></h2>
      <p class="intro">Compose 3D device mockups from your screen recordings and export them as video or images, entirely in your browser. Your media never leaves this device: rendering, decoding and encoding all happen locally, and nothing is uploaded or stored on a server.</p>
      <p>© 2026 ${link('https://wilsonchangjy.com', 'Wilson Chang')}. Source on ${link('https://github.com/wilsonchangjy/mockup-studio', 'GitHub')}. Released under the MIT licence.</p>
    </div>
    <form method="dialog"><button class="close" aria-label="Close">✕</button></form>
  </header>
  <div class="about-body">
    <section class="about-sec">
      <h3>3D models</h3>
      <div>
        <p class="dim">Community models of the real hardware, trimmed to the device, logos removed, made recolourable, given working hinges and compressed. Models marked <i class="tag" style="margin-left: 0">NC</i> are for non-commercial use only.</p>
        <div class="credits">${credits}</div>
      </div>
    </section>
    <section class="about-sec">
      <h3>Lighting</h3>
      <div><p>Studio HDRIs from ${link('https://polyhaven.com', 'Poly Haven')}, ${link('https://creativecommons.org/publicdomain/zero/1.0/', 'CC0')}: ${[
        ['studio_kontrast_04', 'Studio Kontrast 04'], ['story_studio_05', 'Story Studio 05'], ['studio_small_09', 'Studio Small 09'],
        ['brown_photostudio_04', 'Brown Photostudio 04'], ['qwantani_dusk_2_puresky', 'Qwantani Dusk 2'],
      ].map(([id, name]) => link(`https://polyhaven.com/a/${id}`, name)).join(', ')}.</p></div>
    </section>
    <section class="about-sec">
      <h3>Open source</h3>
      <div><table>${libs.map(([n, u, l]) => `<tr><td>${link(u, n)}</td><td>${l}</td></tr>`).join('')}</table></div>
    </section>
  </div>
  <footer class="about-foot">iPhone, iPad, Apple Watch, MacBook, iMac, Studio Display and Pro Display XDR are trademarks of Apple Inc. Pixel is a trademark of Google LLC. Galaxy is a trademark of Samsung Electronics Co., Ltd. Mockup Studio is an independent project and is not affiliated with, sponsored by, or endorsed by any of them.</footer>`;
}
