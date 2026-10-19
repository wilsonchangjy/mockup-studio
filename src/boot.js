/* =====================================================================
   Mockup Studio — first load

   The page's only script at first: the styles, the store and the start
   screens (start.js), none of which need three.js. The 3D engine and the
   interface this visit uses — the editor (ui.js) or Quick mode (quick.js)
   — load once the start screen is on screen, in parallel; main.js wires
   them up. The exporter's encoder and decoder load later still, on first
   use (exporter.js).
   ===================================================================== */

import './styles.css';
import './quick.css';   // Quick mode's start page is in index.html too
import { loadPrefs } from './state.js';
import { initStart, BOOT } from './start.js';

loadPrefs();
initStart();

let loading = false;
function loadApp() {
  if (loading) return;
  loading = true;
  import(BOOT.quick ? './quick.js' : './ui.js').catch(() => {});   // fetched alongside main.js, which uses it
  import('./main.js').then(() => { try { sessionStorage.removeItem('mockup-studio.reloaded'); } catch {} }, reloadOnce);
}
/* If the app's files can't load — a release landed between this page and
   them — a reload gets the new page. Once: offline, it would only repeat. */
function reloadOnce(err) {
  console.error(err);
  let tried = false;
  try { tried = sessionStorage.getItem('mockup-studio.reloaded') === '1'; sessionStorage.setItem('mockup-studio.reloaded', '1'); } catch {}
  if (!tried) location.reload();
}
// after the first paint; in a background tab, rAF waits, so a timer backs it up
requestAnimationFrame(() => setTimeout(loadApp, 0));
setTimeout(loadApp, 1000);
