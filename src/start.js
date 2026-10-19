/* =====================================================================
   Start screens — the editor's Start dialog and Quick mode's start page

   Both are in index.html, so they show on first paint; index.html's inline
   scripts decide which one this visit gets (window.__mockupBoot) and show
   it. This makes them work as soon as the small first bundle has run,
   before the 3D engine has loaded: a choice made before then is held, with
   its card marked as loading, and carried out once the interface hands
   over what choices do (onStart).

   No three.js here, nor anything that loads it.
   ===================================================================== */

import { state, commit, savedScene, savedThumb } from './state.js';
import { MODELS } from './catalog.js';
import { TEMPLATES } from './compose.js';
import { aboutHTML } from './common.js';

/** { quick, tablet, notice, saved }, from index.html. */
export const BOOT = window.__mockupBoot || { quick: false, tablet: false, notice: false, saved: false };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ------------------------- choices, held or not ------------------------- */

let handler = null;   // { template(id), restore(), files(files) }, from ui.js or quick.js
let held = null;      // the choice made before there was one: { run, el }

/** What the start screen's choices do; carries out one made while the app loaded. */
export function onStart(h) {
  handler = h;
  const was = held;
  held = null;
  if (was) { was.el?.removeAttribute('aria-busy'); was.run(handler); }
}

function choose(el, run) {
  if (handler) { run(handler); return; }
  held?.el?.removeAttribute('aria-busy');   // the latest choice wins
  held = { run, el };
  el?.setAttribute('aria-busy', 'true');
}

/* ------------------------------ editor ------------------------------- */

const dialog = $('#start-dialog');

/* The last scene, as a card above the templates: its picture (or its
   template's, if it was saved before pictures were), the day it was saved,
   and its devices. Offered when the app opens, not mid-session, when the
   last scene is the one on stage. */
function savedCard() {
  const saved = savedScene();
  if (!saved) return null;
  const b = h('button', 'tpl');
  b.type = 'button';
  const pic = savedThumb() || (TEMPLATES.some((t) => t.id === saved.scene?.template && t.id !== 'blank') ? `templates/${saved.scene.template}.webp` : '');
  if (pic) {
    const img = h('img', 'art');
    img.src = pic; img.alt = '';
    b.append(img);
  } else {
    b.insertAdjacentHTML('beforeend', '<span class="art blank dots" aria-hidden="true"></span>');
  }
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(saved.savedAt || Date.now()));
  const part = (k) => day.find((p) => p.type === k)?.value;
  // each model once, with a count when there's more than one
  const counts = new Map();
  for (const d of saved.devices) { const l = MODELS[d.model]?.label; if (l) counts.set(l, (counts.get(l) || 0) + 1); }
  const names = [...counts].map(([l, n]) => (n > 1 ? `${l} ×${n}` : l)).join(', ');
  b.append(h('span', 't', `${part('weekday')}, ${part('day')} ${part('month')}`), h('span', 'd', names));
  b.setAttribute('aria-label', `Continue the scene saved ${part('weekday')}, ${part('day')} ${part('month')}: ${names}`);
  b.addEventListener('click', () => choose(b, (x) => x.restore()));
  return b;
}

// the upload column fills what's visible of the dialog's body (styles.css, .upload-card)
const startGrid = $('.start-grid');
const fitUpload = () => startGrid.style.setProperty('--start-h', `${startGrid.clientHeight}px`);

/** Open the Start dialog; `offerContinue` adds the last scene's card. */
export function openStart(offerContinue) {
  const card = offerContinue ? savedCard() : null;
  $('#saved-grid').replaceChildren(...(card ? [card] : []));
  $('#saved-scenes').hidden = !card;
  if (!dialog.open) dialog.showModal();
  fitUpload();   // straight away, not a frame later
}
export function closeStart() { dialog.close(); }

function initEditor() {
  new ResizeObserver(fitUpload).observe(startGrid);
  // index.html opened it, with a placeholder where the last scene's card goes
  if (dialog.open) openStart(BOOT.saved);

  for (const b of $$('[data-template]', dialog)) {
    b.addEventListener('click', () => choose(b, (x) => x.template(b.dataset.template)));
  }

  const drop = $('#start-drop');
  const status = $('#start-status');
  function startWithFiles(files) {
    if (!files.length) return;
    status.textContent = `Reading ${files.length} file${files.length > 1 ? 's' : ''}…`;
    choose(drop, async (x) => {
      try { await x.files(files); } finally { status.textContent = ''; }
    });
  }
  $('#start-input').addEventListener('change', (e) => { startWithFiles([...e.target.files]); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); startWithFiles([...e.dataTransfer.files]); });

  /* Small windows see a notice first (index.html shows it): the full editor
     needs a large screen, a precise pointer, and the memory to render and
     encode video. It's a notice, not a block. */
  $('#desktop-continue').addEventListener('click', () => {
    try { sessionStorage.setItem('mockup-studio.desktop-ok', '1'); } catch {}
    $('#desktop-only').hidden = true;
    openStart(!!savedScene());
  });
}

/* ------------------------------ Quick mode ----------------------------- */

const quickStart = $('#q-start');

/** Show Quick mode's start page again ("Start over"), its last scene as it is now. */
export function showQuickStart() {
  const saved = savedScene();
  const cont = $('#q-continue');
  cont.hidden = !saved;
  if (saved) {
    const t = TEMPLATES.find((x) => x.id === saved.scene?.template && x.id !== 'blank');
    const n = saved.devices.length;
    $('#q-continue-d').textContent = `${t ? `${t.name.toUpperCase()} · ` : ''}${n} SCREEN${n > 1 ? 'S' : ''}`;
  }
  quickStart.hidden = false;
}

function initQuick() {
  showQuickStart();
  $('#q-continue').addEventListener('click', (e) => choose(e.currentTarget, (x) => x.restore()));
  for (const b of $$('[data-template]', quickStart)) {
    b.addEventListener('click', () => choose(b, (x) => x.template(b.dataset.template)));
  }
  $('#q-full').addEventListener('click', () => {
    state.prefs.editor = 'full';
    commit('prefs');
    setTimeout(() => location.reload(), 350);   // once the choice is saved
  });
  $('#q-about').addEventListener('click', () => {
    $('#about-body').innerHTML = aboutHTML();
    $('#about-dialog').showModal();
  });
}

export function initStart() {
  if (BOOT.quick) initQuick(); else initEditor();
}
