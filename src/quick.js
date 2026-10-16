/* =====================================================================
   Quick mode — Mockup Studio on a phone

   A template, your recordings on its screens, a look and a shape, then
   export: the editor cut down to what a phone can do well (docs/
   MOBILE-PRD.md, docs/MOBILE-HANDOFF.md, design boards M00–M13). It drives
   the same state, viewport and exporter as the full editor, so a scene
   made here opens normally on a computer.

   - Start: continue the last scene or pick a template. No blank scene and
     no upload-first start: a phone has no way to fix a layout, so every
     scene keeps a template's (no auto-turning devices to match footage
     either — footage is cropped to each screen instead).
   - Look is a lighting mood (which brings its own background) and a camera
     motion; appearance follows the phone's light/dark setting.
   - The stage fills the screen; the export frame is drawn on it as "+"
     corner marks with the rest veiled. One bar — Template · Look · Format ·
     Export — opens one short sheet at a time.
   - Tap an empty screen to add a recording; tap a filled one for its sheet.
     Tap empty stage to close the sheet, or to hide and show the controls.
   - Exports are capped for phone memory: 1080p, no supersampling, 1K
     panoramas, at most 20 s. A wake lock keeps the screen on, and saving
     goes through the share sheet (straight to Photos on iOS).
   ===================================================================== */

import './quick.css';
import { state, commit, subscribe, device as deviceById, asset as assetById, OUTPUTS, output, savedScene, defaultScene } from './state.js';
import { MODELS, finishesFor, screenAspectOf } from './devices.js';
import { MOODS, resolveMood } from './lighting.js';
import { TEMPLATES } from './compose.js';
import { exportImage, exportVideo, canExportVideo, download, bitrateForQuality, DEFAULT_QUALITY } from './exporter.js';
import { decodesExactly } from './decoder.js';
import { setToast, aboutHTML } from './ui.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, onClick, label) {
  const b = h('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const ICON = {
  hide: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1.5 9s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z"/><circle cx="9" cy="9" r="2.3"/><path d="M2.5 15.5l13-13"/></svg>',
  reframe: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11"/><circle cx="8" cy="8" r="2"/></svg>',
  play: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>',
  pause: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="2.6" height="10" fill="currentColor"/><rect x="7.4" y="1" width="2.6" height="10" fill="currentColor"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12"/></svg>',
  warn: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M9 2l7.5 13h-15z"/><path d="M9 7.5v3.5M9 12.6v.4"/></svg>',
  arrow: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 9h12M10 4l5 5-5 5"/></svg>',
  chevron: '<svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1.5 1.5L6 6l-4.5 4.5"/></svg>',
  share: '<svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 11V1.5M4.5 5L8 1.5 11.5 5"/><path d="M5 7.5H2v9h12v-9h-3"/></svg>',
};

/* ------------------------------ options ------------------------------ */

const SHAPES = [   // output key, label, glyph [w, h] in px
  ['1080x1920', '9:16', [9, 16]],
  ['1080x1080', '1:1', [14, 14]],
  ['1080x1350', '4:5', [12, 15]],
  ['1920x1080', '16:9', [18, 10]],
];
const FILES = [['mp4', 'MP4', 'MP4 video'], ['png', 'PNG', 'PNG image'], ['jpg', 'JPG', 'JPG image']];
const MOTIONS = [['static', 'Static'], ['dolly', 'Push / pull'], ['turntable', 'Turntable'], ['slide', 'Slide'], ['crane', 'Crane up'], ['drift', 'Handheld drift']];
const MAX_LENGTH = 20;   // seconds: phone memory holds the whole video until it's saved

const num2 = (i) => String(i + 1).padStart(2, '0');
const clock = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const swatchBg = (b) => (b.mode === 'solid' ? b.color : `linear-gradient(${b.top}, ${b.bottom})`);

/** "2 SCREENS · LANDSCAPE + PORTRAIT", from a template's devices. */
function describe(tpl, short = false) {
  const devices = tpl.build().devices;
  const wide = devices.map((d) => (screenAspectOf(d.model, d.folded) > 1) !== !!d.landscape);
  const L = wide.filter(Boolean).length, P = wide.length - L;
  const shape = !L ? 'PORTRAIT' : !P ? 'LANDSCAPE' : L === P ? 'LANDSCAPE + PORTRAIT' : L > P ? 'MOSTLY LANDSCAPE' : 'MOSTLY PORTRAIT';
  const n = devices.length;
  return short ? `${n} · ${shape}` : `${n} SCREEN${n > 1 ? 'S' : ''} · ${shape}`;
}

/* ============================== Quick mode ============================== */

export function createQuick(app) {
  const vp = app.vp;
  const root = document.documentElement;
  root.classList.add('quick');
  // appearance follows the phone's setting; the saved choice stays for the full editor
  delete root.dataset.theme;
  const TPLS = TEMPLATES.filter((t) => t.id !== 'blank');
  const DESC = new Map(TPLS.map((t) => [t.id, describe(t)]));
  const DESC_SHORT = new Map(TPLS.map((t) => [t.id, describe(t, true)]));

  state.prefs.quickShape ||= '1080x1920';
  state.prefs.quickFile ||= 'mp4';
  if (state.prefs.quickFile === 'mp4' && !canExportVideo()) state.prefs.quickFile = 'png';

  /* Every scene handed to the app — a template, or the last scene — is
     brought within what a phone exports: its shape, 1080p, 24 or 30 fps. */
  app.adapt = (comp) => {
    const sc = comp.scene;
    if ('cameraDir' in comp) {                     // a template
      sc.output = state.prefs.quickShape;
      sc.fill = comp.fill ?? 0.9;
    } else if (!SHAPES.some(([k]) => k === sc.output)) {
      sc.output = '1920x1080';                     // 4K comes back as 1080p
    }
    if (sc.fps !== 24 && sc.fps !== 30) sc.fps = 30;
  };

  /* ------------------------------ layout ------------------------------ */
  const ui = h('div', 'q');
  ui.id = 'quick';
  ui.innerHTML = `
    <header class="q-head">
      <div class="q-word" aria-label="Mockup Studio">Mockup<span>Stu<span class="di">di</span>o</span></div>
      <span class="q-readout mono" id="q-readout"></span>
      <button type="button" class="q-hide" id="q-hide">${ICON.hide}<span>Hide UI</span></button>
    </header>
    <div class="q-stagebox" id="q-stagebox">
      <div class="q-tapnote" id="q-tapnote" hidden>Tap anywhere to show controls</div>
      <div class="q-chips">
        <span class="q-play q-chip" id="q-play" hidden>
          <button type="button" id="q-play-btn" aria-label="Play">${ICON.play}</button>
          <span class="mono" id="q-time"></span>
        </span>
        <span class="q-chip q-hint" id="q-hint" hidden>Tap a screen to add a recording</span>
        <button type="button" class="q-chip q-reframe" id="q-reframe">${ICON.reframe}Reframe</button>
      </div>
      <div class="q-toast" id="q-toast" role="status" aria-live="polite" hidden><span></span></div>
    </div>
    <section class="q-sheet" id="q-sheet" role="dialog" aria-labelledby="q-sheet-title" hidden></section>
    <nav class="q-bar" id="q-bar" aria-label="Quick mode">
      <button type="button" class="q-rail-hide" id="q-rail-hide" aria-label="Hide UI">${ICON.hide}</button>
      <button type="button" data-sheet="template" aria-expanded="false"><span class="mono">01</span>Template</button>
      <button type="button" data-sheet="look" aria-expanded="false"><span class="mono">02</span>Look</button>
      <button type="button" data-sheet="format" aria-expanded="false"><span class="mono">03</span>Format</button>
      <button type="button" data-sheet="export" class="go" aria-expanded="false"><span class="mono">04</span>Export</button>
    </nav>
    <section class="q-start" id="q-start" aria-labelledby="q-start-title" hidden></section>`;
  document.body.append(ui);

  // the render fills the screen behind everything; overlays on it live in the host
  const host = $('#viewport-host');
  ui.prepend(host);
  const frameEl = h('div', 'q-frame');
  frameEl.setAttribute('aria-hidden', 'true');
  frameEl.innerHTML = '<span class="tl">+</span><span class="tr">+</span><span class="bl">+</span><span class="br">+</span>';
  const selEl = h('div', 'q-sel');
  selEl.setAttribute('aria-hidden', 'true');
  const selBadge = h('span', 'badge sel q-sel-badge');
  selBadge.setAttribute('aria-hidden', 'true');
  const screenList = h('div', 'q-sr');   // the screens as buttons, for screen readers and keyboards
  host.append(frameEl, selEl, selBadge, screenList);

  const sheetEl = $('#q-sheet', ui);
  const startEl = $('#q-start', ui);
  let sheet = null;          // { kind, ...args } of the open sheet
  let uiHidden = false;
  let selected = null;       // { id, slot }: the screen whose sheet is open
  const landscapeMQ = matchMedia('(orientation: landscape) and (max-height: 540px)');

  /** Where the stage is: the screen less the header, bar and sheet. The
      export frame sits inside it, clear of the chips. */
  function layout() {
    const land = landscapeMQ.matches;
    ui.classList.toggle('land', land);
    ui.classList.toggle('ui-hidden', uiHidden);
    ui.classList.toggle('sheet-open', !!sheet);
    const head = uiHidden || land ? 0 : $('.q-head', ui).offsetHeight;
    const bar = uiHidden ? 0 : land ? 0 : $('#q-bar', ui).offsetHeight;
    const rail = uiHidden || !land ? 0 : $('#q-bar', ui).offsetWidth;
    const sheetH = sheet && !land ? sheetEl.offsetHeight : 0;
    const sheetW = sheet && land ? sheetEl.offsetWidth : 0;
    const box = { top: head, right: rail + sheetW, bottom: bar + sheetH, left: 0 };
    const sb = $('#q-stagebox', ui);
    Object.assign(sb.style, { top: `${box.top}px`, right: `${box.right}px`, bottom: `${box.bottom}px`, left: '0px' });
    root.style.setProperty('--q-bar-h', `${bar}px`);
    // room for the chips under the frame: both of them, Reframe alone, or the hint above when hidden
    const chips = sheet ? 60 : uiHidden ? 88 : 72;
    vp.setFrameInsets({ top: box.top + (uiHidden ? 16 : land ? 16 : 16), right: box.right + 16, bottom: box.bottom + chips, left: 16 });
  }
  landscapeMQ.addEventListener('change', () => { layout(); renderSheet(); });
  addEventListener('resize', layout);

  /* The export frame: "+" at its corners and everything outside veiled. */
  function onFrame(r) {
    Object.assign(frameEl.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  /** Redrawn with every frame: the selected screen's outline and number. */
  function onRender() {
    const r = selected && !state.exporting ? vp.screenRect(selected.id, selected.slot) : null;
    selEl.hidden = selBadge.hidden = !r;
    if (!r) return;
    const pad = 4;
    Object.assign(selEl.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.w + pad * 2}px`, height: `${r.h + pad * 2}px` });
    selBadge.textContent = num2(state.devices.findIndex((d) => d.id === selected.id));
    Object.assign(selBadge.style, { left: `${r.x - pad}px`, top: `${r.y - pad - 24}px` });
  }

  /* ------------------------------ header ------------------------------ */
  function renderHead() {
    const shape = SHAPES.find(([k]) => k === state.scene.output)?.[1] || OUTPUTS[state.scene.output]?.label.split(' · ')[0];
    $('#q-readout', ui).textContent = `${shape} · 1080p · ${state.scene.fps}`;
  }

  function setHidden(on) {
    if (state.exporting) return;
    uiHidden = on;
    if (on) closeSheet(false);
    layout();
    renderStage();
    // the first time in a session, say how to get the controls back
    if (on) {
      let told = false;
      try { told = sessionStorage.getItem('mockup-studio.tapnote') === '1'; sessionStorage.setItem('mockup-studio.tapnote', '1'); } catch {}
      if (!told) {
        const note = $('#q-tapnote', ui);
        note.hidden = false;
        note.classList.remove('gone');
        setTimeout(() => note.classList.add('gone'), 2000);
        setTimeout(() => { note.hidden = true; }, 2600);
      }
    } else {
      $('#q-tapnote', ui).hidden = true;
    }
  }
  $('#q-hide', ui).addEventListener('click', () => setHidden(true));
  $('#q-rail-hide', ui).addEventListener('click', () => setHidden(true));

  /* ------------------------------ stage ------------------------------- */
  const hasMedia = () => state.devices.some((d) => d.media || d.second?.media);

  function renderStage() {
    const playing = state.playing;
    const showPlay = !uiHidden && !sheet && hasMedia();
    $('#q-play', ui).hidden = !showPlay;
    $('#q-hint', ui).hidden = uiHidden || !!sheet || hasMedia() || !state.devices.length;
    const pb = $('#q-play-btn', ui);
    pb.innerHTML = playing ? ICON.pause : ICON.play;
    pb.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('#q-time', ui).innerHTML = `${state.time.toFixed(1)} <span class="dim">/ ${state.scene.duration.toFixed(1)}s</span>`;
    $('#q-reframe', ui).disabled = state.exporting || !state.devices.length;
    $('#q-hide', ui).disabled = state.exporting;
    $('#q-rail-hide', ui).disabled = state.exporting;
    for (const b of $$('#q-bar [data-sheet]', ui)) {
      b.disabled = state.exporting;
      const open = !!sheet && (sheet.kind === b.dataset.sheet || (b.dataset.sheet === 'export' && ['exporting', 'ready', 'failed', 'stopped'].includes(sheet.kind)));
      b.classList.toggle('on', open);
      b.setAttribute('aria-expanded', String(open));
    }
    // the screens, for screen readers and keyboards
    screenList.replaceChildren(...state.devices.map((d, i) => {
      const a = d.media ? assetById(d.media) : null;
      return btn('', '', () => (a ? openSheet('screen', { id: d.id, slot: 'main' }) : app.pickReplacement(d.id, 'main')),
        a ? `Screen ${num2(i)}: ${a.name}` : `Add a recording to screen ${num2(i)}`);
    }));
  }
  function renderTime() {
    $('#q-time', ui).innerHTML = `${state.time.toFixed(1)} <span class="dim">/ ${state.scene.duration.toFixed(1)}s</span>`;
    const pb = $('#q-play-btn', ui);
    pb.innerHTML = state.playing ? ICON.pause : ICON.play;
    pb.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  }
  $('#q-play-btn', ui).addEventListener('click', () => app.togglePlay());
  const reframe = () => vp.frame(null, { fill: state.scene.fill ?? 0.9 });
  $('#q-reframe', ui).addEventListener('click', reframe);

  /** A tap on the stage: a screen, or empty space. */
  function onTap(hit) {
    if (state.exporting || !startEl.hidden) return;
    if (hit?.screen) {
      const slot = hit.slot || 'main';
      const d = deviceById(hit.id);
      const has = slot === 'second' ? d?.second?.media : d?.media;
      if (!has) app.pickReplacement(hit.id, slot);   // straight to the system picker
      else openSheet('screen', { id: hit.id, slot });
      return;
    }
    if (sheet) closeSheet();
    else setHidden(!uiHidden);
  }

  /* ------------------------------ toast ------------------------------- */
  let toastTimer = 0;
  function showToast(msg, { kind = '', action, onAction } = {}) {
    const t = $('#q-toast', ui);
    t.className = 'q-toast' + (kind ? ` ${kind}` : '');
    t.replaceChildren(h('span', null, msg));
    if (action) t.append(btn('q-tbtn', action, () => { t.hidden = true; onAction(); }));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 6000 : action ? 5000 : 3200);
  }
  setToast((msg, kind) => showToast(msg, { kind }));

  /* ------------------------------ sheets ------------------------------ */
  function openSheet(kind, args = {}) {
    if (state.exporting && !['exporting'].includes(kind)) return;
    sheet = { kind, ...args };
    selected = kind === 'screen' ? { id: args.id, slot: args.slot || 'main' } : null;
    if (uiHidden) uiHidden = false;
    renderSheet();
    sheetEl.hidden = false;
    layout();
    renderStage();
    vp.requestRender();
  }
  function closeSheet(relayout = true) {
    if (state.exporting) return;
    sheet = null;
    selected = null;
    sheetEl.hidden = true;
    sheetEl.style.transform = '';
    if (relayout) { layout(); renderStage(); }
    vp.requestRender();
  }
  for (const b of $$('#q-bar [data-sheet]', ui)) {
    b.addEventListener('click', () => {
      const kind = b.dataset.sheet;
      const open = sheet && (sheet.kind === kind || (kind === 'export' && ['ready', 'failed', 'stopped'].includes(sheet.kind)));
      if (open) closeSheet(); else openSheet(kind);
    });
  }

  /* Swipe a sheet down to close it (not while exporting). Chip rows still
     scroll sideways: the sheet only takes vertical drags. */
  let swipe = null;
  sheetEl.addEventListener('pointerdown', (e) => {
    if (state.exporting || e.target.closest('input')) return;
    swipe = { y: e.clientY, x: e.clientX, id: e.pointerId, dy: 0, on: false };
  });
  sheetEl.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dy = e.clientY - swipe.y, dx = e.clientX - swipe.x;
    if (!swipe.on && dy > 8 && dy > Math.abs(dx)) { swipe.on = true; sheetEl.setPointerCapture(e.pointerId); }
    if (!swipe.on) return;
    swipe.dy = Math.max(0, dy);
    sheetEl.style.transform = landscapeMQ.matches ? '' : `translateY(${swipe.dy}px)`;
  });
  const endSwipe = () => {
    if (!swipe) return;
    const { on, dy } = swipe;
    swipe = null;
    if (!on) return;
    if (dy > 70) closeSheet();
    else sheetEl.style.transform = '';
  };
  sheetEl.addEventListener('pointerup', endSwipe);
  sheetEl.addEventListener('pointercancel', endSwipe);

  function sheetHead(title, extra = [], closable = true) {
    const wrap = h('div', 'q-shd');
    const t = h('h2', null, title);
    t.id = 'q-sheet-title';
    wrap.append(t, ...extra);
    if (closable) {
      const x = btn('q-x', '', () => closeSheet(), 'Close');
      x.innerHTML = ICON.close;
      wrap.append(x);
    }
    const frag = document.createDocumentFragment();
    if (closable) { const g = h('div', 'q-grab'); g.setAttribute('aria-hidden', 'true'); frag.append(g); }
    frag.append(wrap);
    return frag;
  }
  function chipRow(label, options, current, onPick, { dots } = {}) {
    const row = h('div', 'q-rowx');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', label);
    for (const [v, text, extra] of options) {
      const c = btn('q-chip-opt' + (v === current ? ' on' : ''), null, () => onPick(v));
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', String(v === current));
      if (dots) { const i = h('i'); i.style.background = extra; c.append(i); }
      c.append(text);
      row.append(c);
    }
    return row;
  }
  function group(label, content, aside) {
    const g = h('div', 'q-grp');
    const sh = h('span', 'q-sh', label);
    if (aside) sh.append(' ', h('span', 'dim', aside));
    g.append(sh, content);
    return g;
  }
  function note(content, kind = 'note') {
    const n = h('div', `q-note ${kind}`);
    n.setAttribute('role', kind === 'note' ? 'note' : 'alert');
    if (kind === 'note') { const ic = h('span'); ic.innerHTML = ICON.warn; n.append(ic.firstChild); }
    const body = h('span');
    body.append(...[].concat(content));
    n.append(body);
    return n;
  }

  function renderSheet() {
    if (!sheet) return;
    sheetEl.className = `q-sheet q-sheet-${sheet.kind}`;
    sheetEl.setAttribute('aria-busy', String(sheet.kind === 'exporting'));
    sheetEl.replaceChildren();
    ({ template: templateSheet, look: lookSheet, format: formatSheet, export: exportSheet, exporting: exportingSheet,
      ready: readySheet, failed: failedSheet, stopped: stoppedSheet, screen: screenSheet })[sheet.kind]?.();
  }

  /* -- Template (M07) -- */
  function templateSheet() {
    sheetEl.append(sheetHead('Template'));
    const row = h('div', 'q-rowx q-cards');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'Template');
    for (const t of TPLS) {
      const on = state.scene.template === t.id;
      const c = btn('q-card' + (on ? ' on' : ''), null, () => switchTemplate(t.id));
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', String(on));
      const img = h('img'); img.src = `templates/${t.id}.webp`; img.alt = ''; img.loading = 'lazy';
      c.append(img, h('span', 't', t.name), h('span', 'd', DESC_SHORT.get(t.id)));
      row.append(c);
    }
    const foot = h('div', 'q-foot');
    foot.append(h('span', 'dim', 'Recordings move across in order'), btn('q-tbtn', 'Start over', () => { closeSheet(); showStart(); }));
    sheetEl.append(row, foot);
    // the current template in view
    requestAnimationFrame(() => $('.q-card.on', row)?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
  function switchTemplate(id) {
    if (state.scene.template === id) { closeSheet(); return; }
    const before = { devices: structuredClone(state.devices), scene: structuredClone(state.scene) };
    const tpl = app.useTemplate(id, { quiet: true });
    syncLength();
    closeSheet();
    showToast(`Switched to ${tpl.name}`, { action: 'Undo', onAction: () => restore(before) });
  }
  function restore({ devices, scene }) {
    app.pause();
    state.devices = devices;
    state.scene = scene;
    state.selection = null;
    state.time = 0;
    vp.syncAll();
    vp.applySceneSettings();
    commit('devices'); commit('scene'); commit('time');
  }

  /* -- Look (M05) -- */
  function lookSheet() {
    const sc = state.scene;
    sheetEl.append(sheetHead('Look'));
    const mood = resolveMood(sc.light.mood);
    sheetEl.append(group('Lighting', chipRow('Lighting',
      Object.entries(MOODS).map(([id, m]) => [id, m.label, swatchBg(m.background)]), mood, (v) => {
        const m = MOODS[v];
        // a mood sets the light, background and floor shadow together, as on desktop
        sc.light = { ...sc.light, ...structuredClone(m.light), mood: v };
        sc.background = { ...sc.background, ...structuredClone(m.background) };
        sc.ground = { ...sc.ground, ...structuredClone(m.ground) };
        commit('scene');
      }, { dots: true })));
    sheetEl.append(group('Motion', chipRow('Motion', MOTIONS, sc.motion.preset, (v) => {
      sc.motion.preset = v;   // amount and direction keep the template's
      commit('scene');
    })));
    requestAnimationFrame(() => { for (const r of $$('.q-rowx', sheetEl)) $('.on', r)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); });
  }

  /* -- Format (M06) -- */
  function formatSheet() {
    const sc = state.scene;
    const file = state.prefs.quickFile;
    sheetEl.append(sheetHead('Format'));
    const shapes = h('div', 'q-grid4');
    shapes.setAttribute('role', 'radiogroup');
    shapes.setAttribute('aria-label', 'Shape');
    for (const [k, label, [w, hgt]] of SHAPES) {
      const on = sc.output === k;
      const c = btn('q-chip-opt' + (on ? ' on' : ''), null, () => setShape(k));
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', String(on));
      const r = h('span', 'r'); r.setAttribute('aria-hidden', 'true');
      Object.assign(r.style, { width: `${w}px`, height: `${hgt}px` });
      c.append(r, label);
      shapes.append(c);
    }
    sheetEl.append(group('Shape', shapes));
    const two = h('div', 'q-two');
    const fps = h('div', 'q-grid2');
    fps.setAttribute('role', 'radiogroup');
    fps.setAttribute('aria-label', 'Frame rate');
    for (const f of [24, 30]) {
      const on = sc.fps === f;
      const c = btn('q-chip-opt' + (on && file === 'mp4' ? ' on' : ''), String(f), () => { sc.fps = f; commit('scene'); });
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', String(on));
      c.disabled = file !== 'mp4';   // a still has no frame rate
      fps.append(c);
    }
    const files = h('div', 'q-grid3');
    files.setAttribute('role', 'radiogroup');
    files.setAttribute('aria-label', 'File');
    for (const [k, label] of FILES) {
      const on = file === k;
      const c = btn('q-chip-opt' + (on ? ' on' : ''), label, () => { state.prefs.quickFile = k; commit('prefs'); renderSheet(); });
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', String(on));
      if (k === 'mp4' && !canExportVideo()) c.disabled = true;
      files.append(c);
    }
    two.append(group('Frame rate', fps), group('File', files));
    const o = output();
    const foot = h('div', 'q-foot q-foot-rule');
    foot.append(h('span', 'mono', `${o.w} × ${o.h}`), h('span', 'dim', '4K and 60 fps are on desktop'));
    sheetEl.append(two, foot);
  }
  function setShape(k) {
    state.scene.output = k;
    state.prefs.quickShape = k;
    commit('prefs');
    commit('scene');
    reframe();   // a new shape needs the shot refitted
  }

  /* -- Export (M08, M12-A, M12-B) -- */
  function lengths() {
    const vids = state.devices.flatMap((d) => [d.media, d.second?.media]).filter(Boolean).map(assetById).filter((a) => a?.kind === 'video');
    const longest = vids.length ? Math.max(...vids.map((a) => a.duration)) : 0;
    return { vids, longest, capped: longest > MAX_LENGTH };
  }
  /** The scene runs as long as its longest recording, up to 20 s; stills keep the template's 8 s. */
  function syncLength() {
    const { vids, longest } = lengths();
    const want = vids.length ? Math.round(Math.min(MAX_LENGTH, longest) * 100) / 100 : defaultScene().duration;
    if (Math.abs(state.scene.duration - want) > 0.005) {
      state.scene.duration = want;
      if (state.time > want) state.time = 0;
      commit('scene');
    }
  }
  function exportSheet() {
    const sc = state.scene, o = output();
    const file = FILES.find(([k]) => k === state.prefs.quickFile);
    const video = file[0] === 'mp4';
    const media = hasMedia();
    const { longest, capped } = lengths();
    sheetEl.append(sheetHead('Export'));
    const rows = h('div', 'q-sums');
    const sum = (label, value, open = true) => {
      const r = open ? btn('q-sum', null, () => openSheet('format')) : h('div', 'q-sum');
      r.append(h('span', null, label));
      const v = h('span');
      v.append(...[].concat(value));
      r.append(v);
      if (open) { const c = h('span'); c.innerHTML = ICON.chevron; r.append(c); } else r.append(h('span'));
      return r;
    };
    const shape = SHAPES.find(([k]) => k === sc.output)?.[1];
    rows.append(sum('Shape', `${shape} · ${o.w}×${o.h}`));
    // with the 20 s note to fit, only shape and length (M12-B)
    if (!(capped && video)) {
      if (video) rows.append(sum('Frame rate', `${sc.fps} fps`));
      rows.append(sum('File', file[2]));
    }
    const len = !media ? h('span', 'dim', '—')
      : !video ? `Still at ${state.time.toFixed(1)} s`
      : capped ? [`${MAX_LENGTH.toFixed(1)} s `, h('span', 'dim', `of ${longest.toFixed(1)} s`)]
      : `${sc.duration.toFixed(1)} s`;
    rows.append(sum('Length', len, false));
    sheetEl.append(rows);
    if (media && video && capped) sheetEl.append(note('Exports on a phone stop at 20 s. Use the full editor on a computer for the whole recording.'));
    const go = btn('q-btn', video ? (capped ? `Export ${MAX_LENGTH} s` : 'Export video') : `Export ${file[1]}`, runExport);
    go.disabled = !media;
    go.classList.add('push');
    sheetEl.append(go);
    if (!media) sheetEl.append(h('span', 'q-under dim', 'Add a recording to a screen first'));
  }

  /* -- Exporting (M09) -- */
  const job = { abort: null, wake: null, hidden: false, frame: 0, total: 0, pct: 0, eta: 0, started: 0, result: null, error: null, thumb: '' };
  function exportingSheet() {
    const head = h('div', 'q-xhead');
    const t = h('h2', null, state.prefs.quickFile === 'mp4' ? 'Exporting' : 'Rendering');
    t.id = 'q-sheet-title';
    head.append(t, h('span', 'q-pct', `${job.pct}%`));
    const bar = h('div', 'q-bar2');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-label', 'Export progress');
    const counts = h('div', 'q-counts mono');
    counts.append(h('span', 'q-frames'), h('span', 'dim q-eta'));
    const msg = h('p', 'q-keep', 'Keep this tab open. The export stops if the screen locks or you switch apps.');
    const cancel = btn('q-lbtn push', 'Cancel', () => job.abort?.abort());
    sheetEl.append(head, bar, counts, msg, cancel);
    paintProgress();
  }
  function paintProgress() {
    if (sheet?.kind !== 'exporting') return;
    $('.q-pct', sheetEl).textContent = `${job.pct}%`;
    const bar = $('.q-bar2', sheetEl);
    bar.style.setProperty('--p', `${job.pct}%`);
    bar.setAttribute('aria-valuenow', job.pct);
    $('.q-frames', sheetEl).textContent = job.total ? `Frame ${job.frame} / ${job.total}` : 'Preparing…';
    $('.q-eta', sheetEl).textContent = job.eta > 1 ? `about ${Math.ceil(job.eta)} s left` : '';
  }

  /* -- Ready (M10) -- */
  function readySheet() {
    const out = job.result;
    const video = out.name.endsWith('.mp4');
    const took = h('span', 'dim q-took', `took ${Math.max(1, Math.round(job.took))} s`);
    sheetEl.append(sheetHead('Ready', [took]));
    const card = h('div', 'q-file');
    const th = h('span', 'q-thumb');
    th.setAttribute('aria-hidden', 'true');
    if (job.thumb) th.style.backgroundImage = `url("${job.thumb}")`;
    const mb = (out.blob.size / 1048576).toFixed(1);
    const meta = video ? `${mb} MB · ${job.length.toFixed(1)} s · ${job.size}` : `${mb} MB · ${job.size}`;
    const txt = h('span', 'q-file-txt');
    txt.append(h('span', null, out.name), h('span', 'dim', meta));
    card.append(th, txt);
    sheetEl.append(card);
    if (out.exact === false) sheetEl.append(note('This browser can’t step through this video smoothly, so some frames may repeat in the export.'));
    const file = new File([out.blob], out.name, { type: out.blob.type });
    const canShare = !!navigator.canShare?.({ files: [file] });
    if (canShare) {
      const save = btn('q-btn push', null, async () => {
        try { await navigator.share({ files: [file] }); }
        catch (e) { if (e.name !== 'AbortError') download(out.blob, out.name); }   // dismissing the share sheet isn't an error
      });
      save.innerHTML = `${ICON.share}<span>${video ? 'Save video' : 'Save image'}</span>`;
      sheetEl.append(save, btn('q-tbtn q-center', 'Download instead', () => download(out.blob, out.name)));
    } else {
      sheetEl.append(btn('q-btn push', video ? 'Download video' : 'Download image', () => download(out.blob, out.name)));
    }
  }

  /* -- Failed (M12-C) and stopped (M12-D) -- */
  function failedSheet() {
    const e = job.error;
    sheetEl.append(sheetHead('Export failed'));
    const memory = e && (e.name === 'RangeError' || /memory|allocat|context lost|quota/i.test(`${e.name} ${e.message}`));
    const box = h('div', 'q-err');
    box.setAttribute('role', 'alert');
    box.append(
      h('b', null, memory && job.total ? `This phone ran out of memory at frame ${job.frame} of ${job.total}.` : (e?.message || 'Something went wrong.')),
      h('span', 'dim', 'Closing other tabs and apps often helps.'));
    sheetEl.append(box, btn('q-btn push', 'Try again', runExport));
    if (memory && state.prefs.quickFile === 'mp4' && state.scene.fps === 30) {
      sheetEl.append(btn('q-tbtn q-center', 'Try again at 24 fps', () => { state.scene.fps = 24; commit('scene'); runExport(); }));
    }
  }
  function stoppedSheet() {
    sheetEl.append(sheetHead('Export stopped'));
    const box = h('div', 'q-err q-err-ink');
    box.setAttribute('role', 'alert');
    box.append(h('b', null, `The tab was in the background, so the export stopped at ${job.pct}%.`), h('span', 'dim', 'Keep Mockup Studio on screen until it finishes.'));
    sheetEl.append(box, btn('q-btn push', 'Start again', runExport));
  }

  /* -- Screen (M03, M12-F) -- */
  const exactCache = new Map();   // asset id → whether it decodes frame by frame
  function screenSheet() {
    const d = deviceById(sheet.id);
    if (!d) { closeSheet(); return; }
    const slot = sheet.slot;
    const i = state.devices.indexOf(d);
    const t = slot === 'second' ? d.second : d;
    const a = t?.media ? assetById(t.media) : null;
    sheetEl.append(sheetHead(`Screen ${num2(i)}`, [h('span', 'mono dim q-model', MODELS[d.model].label.toUpperCase())]));
    if (a) {
      const row = h('div', 'q-media');
      const th = h('span', 'q-mthumb');
      th.setAttribute('aria-hidden', 'true');
      th.style.backgroundImage = `url("${a.thumb}")`;
      const wideFile = a.width > a.height;
      const txt = h('span', 'q-file-txt');
      txt.append(h('span', null, a.name), h('span', 'dim', `${a.kind === 'video' ? clock(a.duration) : 'Image'} · ${wideFile ? 'landscape' : 'portrait'}`));
      row.append(th, txt, btn('q-lbtn', 'Replace', () => app.pickReplacement(d.id, slot)));
      sheetEl.append(row);
      // footage cropped to the screen's shape gets said, not done silently
      const wideScreen = (screenAspectOf(d.model, d.folded) > 1) !== !!d.landscape;
      if (wideFile !== wideScreen && Math.abs(a.width / a.height - 1) > 0.1) {
        const suggest = suggestFor(wideFile);
        const parts = [wideScreen
          ? 'This screen is landscape, so the top and bottom of your portrait recording are cropped.'
          : 'This screen is portrait, so the sides of your landscape recording are cropped.'];
        if (suggest) parts.push(' ', btn('q-tbtn q-inline', `Try ${suggest.name}`, () => switchTemplate(suggest.id)));
        sheetEl.append(note(parts));
      }
      // frames that might repeat: checked once per recording
      if (a.kind === 'video') {
        const known = exactCache.get(a.id);
        if (known === false) sheetEl.append(note('This browser can’t step through this video smoothly, so some frames may repeat in the export.'));
        else if (known === undefined) {
          exactCache.set(a.id, null);
          decodesExactly(a).then((ok) => { exactCache.set(a.id, ok); if (!ok && sheet?.kind === 'screen' && sheet.id === d.id) renderSheet(); });
        }
      }
    }
    // finish
    const finishes = finishesFor(d.model);
    const hit = finishes.find(([, hex]) => hex === d.color.toLowerCase());
    const sw = h('div', 'q-swrow');
    sw.setAttribute('role', 'radiogroup');
    sw.setAttribute('aria-label', 'Finish');
    for (const [name, hex] of finishes) {
      const on = hit?.[1] === hex;
      const s = btn('q-sw' + (on ? ' on' : ''), null, () => { d.color = hex; commit(`device:${d.id}`); renderSheet(); }, name);
      s.setAttribute('role', 'radio');
      s.setAttribute('aria-checked', String(on));
      const c = h('i'); c.style.background = hex;
      s.append(c);
      sw.append(s);
    }
    sw.append(h('span', 'dim q-swname', hit ? hit[0] : 'Custom'));
    sheetEl.append(group('Finish', sw));
  }
  /** A template with a screen the footage's shape fits, other than this one. */
  function suggestFor(wideFile) {
    const fits = (t) => t.build().devices.some((d) => ((screenAspectOf(d.model, d.folded) > 1) !== !!d.landscape) === wideFile);
    if (fits(TPLS.find((t) => t.id === state.scene.template) || { build: () => ({ devices: [] }) })) return null;
    return TPLS.find((t) => t.id === (wideFile ? 'macbook-iphone' : 'phone-pair'));
  }

  /* ------------------------------ export ------------------------------ */
  async function runExport() {
    if (state.exporting || !hasMedia()) return;
    app.pause();
    const video = state.prefs.quickFile === 'mp4';
    Object.assign(job, { abort: new AbortController(), hidden: false, frame: 0, total: 0, pct: 0, eta: 0, result: null, error: null, thumb: '' });
    commit('exporting', (s) => { s.exporting = true; });
    openSheet('exporting');
    renderStage();
    // keep the screen on: a locked screen stops the export
    try { job.wake = await navigator.wakeLock?.request('screen'); } catch { job.wake = null; }
    const shape = SHAPES.find(([k]) => k === state.scene.output)?.[1].replace(':', 'x') || 'mockup';
    const name = `${state.scene.template || 'mockup'}-${shape}`;
    // what's being made, as it was when it started
    job.length = state.scene.duration;
    job.size = `${output().w}×${output().h}`;
    const started = performance.now();
    try {
      if (video) {
        job.result = await exportVideo(vp, {
          bitrate: bitrateForQuality(DEFAULT_QUALITY, output().w, output().h, state.scene.fps) * 1e6,
          signal: job.abort.signal,
          supersample: 1,
          name,
          onProgress: (i, n, eta) => { Object.assign(job, { frame: i, total: n, pct: Math.round((i / n) * 100), eta }); paintProgress(); },
        });
      } else {
        job.result = await exportImage(vp, { format: state.prefs.quickFile, supersample: 1, name });
        job.pct = 100;
      }
      job.took = (performance.now() - started) / 1000;
      job.thumb = thumbnail();
      finish('ready');
    } catch (e) {
      if (e.name === 'AbortError') finish(job.hidden ? 'stopped' : 'export');
      else { job.error = e; console.error(e); finish('failed'); }
    }
  }
  function finish(kind) {
    try { job.wake?.release(); } catch {}
    job.wake = null;
    job.abort = null;
    commit('exporting', (s) => { s.exporting = false; });
    openSheet(kind);
    renderStage();
  }
  // a hidden tab stops rendering: stop the export and say why
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.exporting && job.abort) { job.hidden = true; job.abort.abort(); }
  });
  /** The finished shot, small, for the Ready card. */
  function thumbnail() {
    const r = vp.frameRect;
    if (!r) return '';
    vp.renderNow();
    const src = vp.renderer.domElement, k = src.width / src.clientWidth;
    const c = document.createElement('canvas');
    c.height = 142; c.width = Math.round((142 * r.w) / r.h);
    c.getContext('2d').drawImage(src, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, c.width, c.height);
    try { return c.toDataURL('image/jpeg', 0.8); } catch { return ''; }
  }

  /* ------------------------------ start ------------------------------- */
  function showStart() {
    app.pause();
    closeSheet(false);
    const saved = savedScene();
    startEl.replaceChildren();
    const word = h('div', 'q-start-word');
    word.innerHTML = 'Mockup <span class="dotted">Stu<span class="di">di</span>o</span>';
    const title = h('h1', null);
    title.id = 'q-start-title';
    title.innerHTML = 'Start a <span class="dotted">mockup</span>';
    startEl.append(word, title);
    if (saved) {
      const t = TPLS.find((x) => x.id === saved.scene?.template);
      const n = saved.devices.length;
      const cont = btn('q-continue', null, () => { app.restoreLast({ quiet: true }); syncLength(); hideStart(); });
      const txt = h('span');
      txt.append(h('span', 'q-cont-t', 'Continue last scene'), h('span', 'mono dim q-cont-d', `${t ? `${t.name.toUpperCase()} · ` : ''}${n} SCREEN${n > 1 ? 'S' : ''}`));
      const arr = h('span');
      arr.innerHTML = ICON.arrow;
      cont.append(txt, arr.firstChild);
      startEl.append(cont);
    }
    const sec = h('section', 'q-tpls');
    sec.setAttribute('aria-labelledby', 'q-tpl-h');
    const sh = h('div', 'q-sh');
    const l = h('span', null, 'Templates ');
    l.id = 'q-tpl-h';
    l.append(h('span', 'dim', String(TPLS.length)));
    sh.append(l, h('span', 'dim q-best', 'Best for'));
    const list = h('div', 'q-tpl-list');
    for (const t of TPLS) {
      const b = btn('q-tpl', null, () => { app.useTemplate(t.id, { quiet: true }); syncLength(); hideStart(); });
      const img = h('img'); img.src = `templates/${t.id}.webp`; img.alt = '';
      const txt = h('span');
      txt.append(h('span', 't', t.name), h('span', 'd', DESC.get(t.id)));
      b.append(img, txt);
      list.append(b);
    }
    sec.append(sh, list);
    const foot = h('div', 'q-start-foot');
    if (app.tablet) {
      foot.append(btn('q-tbtn q-full', 'Full editor', () => {
        state.prefs.editor = 'full';
        commit('prefs');
        setTimeout(() => location.reload(), 350);
      }));
    }
    foot.append(btn('q-tbtn q-about', 'About', () => {
      $('#about-body').innerHTML = aboutHTML();
      $('#about-dialog').showModal();
    }));
    startEl.append(sec, foot);
    startEl.hidden = false;
    ui.classList.add('starting');
  }
  function hideStart() {
    startEl.hidden = true;
    ui.classList.remove('starting');
    layout();
    renderAll();
  }

  /* --------------------------- reactions ------------------------------ */
  function renderAll() { renderHead(); renderStage(); renderSheet(); }
  subscribe((tag) => {
    if (tag === 'devices' || tag === 'assets') {
      syncLength();
      renderStage();
      if (sheet && sheet.kind !== 'exporting') renderSheet();
    } else if (tag.startsWith('device:')) {
      if (sheet?.kind === 'screen') renderSheet();
    } else if (tag === 'scene') {
      renderHead();
      renderStage();
      if (sheet && ['look', 'format', 'export'].includes(sheet.kind)) renderSheet();
    } else if (tag === 'time' || tag === 'playing') {
      renderTime();
      if (tag === 'playing') renderStage();
    }
  });

  // first paint
  layout();
  renderAll();
  showStart();

  return { onTap, onRender, onFrame };
}
