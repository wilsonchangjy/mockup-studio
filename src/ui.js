/* =====================================================================
   UI — panels, inspector, stage overlays, dialogs, drag & drop

   Left:  Scene (select devices) · Assets (uploaded media) · Export
   Right: Inspector — the selected device, or scene settings
   Stage: output size and Reframe above, transport below, and labels drawn
          over the render: the selection, each device's number, drop boxes

   The selection shows in three places at once, keyed by the device's
   number (its place in the list): the list row, the stage, and the
   inspector's breadcrumb. With nothing selected, all three show SCENE. The
   accent colour marks the selection and nothing else.

   Number fields scrub like 3D software: drag the axis letter or the unit.
   ===================================================================== */

import { state, commit, subscribe, device as deviceById, asset as assetById, OUTPUTS, output, defaultScene } from './state.js';
import { MODELS, FAMILIES, MODEL_CREDITS, LICENCES, modelsInFamily, finishesFor, defaultColorFor, hingeOf, foldOf, foldable, hasCover, screenAspectOf, formOf } from './devices.js';
import { MOODS, resolveMood } from './lighting.js';
import { TEMPLATES } from './compose.js';
import { exportImage, exportVideo, canExportVideo, download, bitrateForQuality, DEFAULT_QUALITY, estimateImageSize } from './exporter.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const FAMILY_ONE = { phone: 'Phone', tablet: 'Tablet', watch: 'Watch', laptop: 'Laptop', desktop: 'Display' };
/** A device's number: its place in the list, zero-padded. */
const num2 = (i) => String(i + 1).padStart(2, '0');

const fmtClock = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
/** An angle as shown: whole degrees, with a true minus. */
const fmtDeg = (v) => `${Math.round(v)}°`.replace('-', '−');
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.max(1, Math.round(s))}s`);

/** A range input's filled part, for WebKit (Firefox draws it itself). */
const fill = (r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);

let toastTimer = null;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ` ${kind}` : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 6000 : 3200);
}

/* ============================ field kit ============================ */

const SIZES_TO_CONTENT = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/** Numeric field: an underlined value. The axis letter (X/Y/Z) or the unit
    is a scrub handle. `scale` converts stored units to shown units, e.g.
    metres → cm. */
function numField({ axis = '', get, set, step = 1, min = -1e9, max = 1e9, scale = 1, digits = 1, unit = '', fixed = false }) {
  const box = h('div', 'num');
  const inp = h('input');
  inp.type = 'text'; inp.inputMode = 'decimal'; inp.spellcheck = false;
  const ax = axis ? h('span', 'ax', axis) : null;
  const u = unit ? h('span', unit === '°' ? 'u tight' : 'u', unit) : null;
  if (ax) box.append(ax);
  box.append(inp);
  if (u) box.append(u);

  // the input is as wide as its value, so the unit sits right after it
  const fit = SIZES_TO_CONTENT ? () => {} : () => { inp.style.width = `${inp.value.length + 0.3}ch`; };
  // `fixed` keeps every decimal place: 8.0 s, 1.00 ×
  const shown = (v) => { const r = Math.round(v * scale * 10 ** digits) / 10 ** digits; return fixed ? r.toFixed(digits) : String(r); };
  const show = () => { inp.value = shown(get()); fit(); };
  const refresh = () => { if (document.activeElement !== inp) show(); };
  const put = (display) => set(clamp(display / scale, min, max));

  const commitText = () => {
    const n = parseFloat(inp.value.replace(/[^0-9eE.+-]/g, ''));
    if (Number.isFinite(n)) put(n);
    show();
  };
  inp.addEventListener('input', fit);
  inp.addEventListener('focus', () => requestAnimationFrame(() => inp.select()));
  inp.addEventListener('blur', commitText);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitText(); inp.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); show(); inp.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      put((parseFloat(inp.value) || 0) + d);
      show();
    }
  });
  // a click on the underline's empty space edits the value
  box.addEventListener('click', (e) => { if (e.target === box) inp.focus(); });

  // drag a handle to scrub, like Blender / Figma
  for (const handle of [ax, u].filter(Boolean)) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('scrubbing');
      const x0 = e.clientX, v0 = get() * scale;
      const move = (ev) => {
        const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        put(v0 + (ev.clientX - x0) * step * 0.5 * mult);
        show();
      };
      const up = () => {
        document.body.classList.remove('scrubbing');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  show();
  return { el: box, refresh };
}

function sliderField({ get, set, min, max, step, format = (v) => v.toFixed(2) }) {
  const wrap = h('div', 'slider');
  const r = h('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step;
  const out = h('output');
  wrap.append(r, out);
  const paint = () => { fill(r); out.textContent = format(get()); };
  const refresh = () => { r.value = get(); paint(); };
  r.addEventListener('input', () => { set(parseFloat(r.value)); paint(); });
  refresh();
  return { el: wrap, refresh };
}

/** Options: equal-width text buttons, one chosen. */
function segField(options, get, set) {
  const s = h('div', 'opts');
  s.setAttribute('role', 'radiogroup');
  for (const [v, label, tip] of options) {
    const b = h('button', null, label);
    b.type = 'button'; b.dataset.v = v; b.title = tip || label.replace(/\u00AD/g, ''); b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { set(v); refresh(); });
    s.append(b);
  }
  const refresh = () => $$('button', s).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(get()))));
  refresh();
  return { el: s, refresh };
}

function selectField(options, get, set) {
  const wrap = h('span', 'sel-wrap');
  const s = h('select', 'sel');
  for (const [v, label, tip] of options) { const o = h('option', null, label); o.value = v; if (tip) o.title = tip; s.append(o); }
  s.addEventListener('change', () => set(s.value));
  wrap.append(s);
  const refresh = () => { if (document.activeElement !== s) s.value = get(); };
  refresh();
  return { el: wrap, refresh };
}

/** A colour as an underlined value: its dot and hex. Clicking opens the picker. */
function colorInput(get, set) {
  const f = h('label', 'color-field');
  const dot = h('i'), hex = h('span');
  const c = h('input');
  c.type = 'color';
  f.append(dot, hex, c);
  const paint = () => { const v = get(); dot.style.background = v; hex.textContent = v.toUpperCase(); };
  c.addEventListener('input', () => { set(c.value); paint(); });
  const refresh = () => { c.value = get(); paint(); };
  refresh();
  return { el: f, refresh };
}

let uid = 0;
/** A labelled field; `tip` is the label's tooltip, for what the panel doesn't spell out. */
function row(label, control, tip) {
  const f = h('div', 'field');
  const l = h('label', null, label);
  if (tip) l.title = tip;
  const target = control.matches('input, select') ? control : control.querySelector('input, select');
  if (target) {
    target.id ||= `f${++uid}`;
    l.htmlFor = target.id;
  } else {
    control.setAttribute('aria-label', label);
  }
  f.append(l, control);
  return f;
}

/** A titled inspector section. The header's right side holds its actions:
    `actions` as [label, handler, tooltip], then Reset if `onReset` is
    given; or `extra`, an element of its own. */
function section(title, { onReset, resetLabel = 'Reset', actions = [], extra } = {}) {
  const s = h('section', 'section');
  const t = h('h3', 'sh');
  t.append(h('span', null, title));
  const all = [...actions];
  if (onReset) all.push([resetLabel, onReset, resetLabel === 'Reset' ? `Reset ${title.toLowerCase()} to defaults` : null]);
  if (all.length || extra) {
    const acts = h('span', 'acts');
    for (const [label, fn, tip] of all) {
      const b = h('button', null, label);
      b.type = 'button';
      if (tip) b.title = tip;
      b.addEventListener('click', fn);
      acts.append(b);
    }
    if (extra) acts.append(extra);
    t.append(acts);
  }
  s.append(t);
  return s;
}

function bindStaticSeg(el, get, set) {
  const refresh = () => $$('button', el).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(get()))));
  $$('button', el).forEach((b) => {
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { if (!b.disabled) { set(b.dataset.v); refresh(); } });
  });
  refresh();
  return refresh;
}

/* ============================== UI ================================ */

export function createUI(app) {
  const inspector = $('#inspector');
  const host = $('#viewport-host');
  let fields = [];
  let inspecting = undefined;     // which thing the inspector was last built for

  /* ------------------------------ tabs ----------------------------- */
  function setTab(tab) {
    state.prefs.tab = tab;
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('.tab-body').forEach((s) => { s.hidden = s.dataset.body !== tab; });
    if (tab === 'export') renderExportSummary();
    commit('prefs');
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  /* --------------------------- scene list -------------------------- */
  const headAction = $('#head-action');
  const mainAction = $('#main-action');

  function renderList() {
    const list = $('#device-list');
    list.innerHTML = '';
    $('#scene-row').setAttribute('aria-current', String(!state.selection));
    const n = state.devices.length;
    $('#device-empty').hidden = n > 0;
    $('#device-count').textContent = n;

    state.devices.forEach((d, i) => {
      const a = d.media ? assetById(d.media) : null;
      const sel = state.selection === d.id;
      const li = h('li');
      li.setAttribute('aria-current', String(sel));
      const b = h('button', 'pick');
      b.type = 'button';
      const txt = h('span', 'txt');
      txt.append(h('b', null, d.name), h('small', null, a ? a.name : 'No media'));
      b.append(h('span', 'badge' + (sel ? ' sel' : ''), num2(i)), txt);
      b.addEventListener('click', () => app.select(d.id));
      b.addEventListener('dblclick', () => app.frame([d.id]));

      const del = h('button', 'del', '×');
      del.type = 'button';
      del.title = `Remove ${d.name}`;
      del.setAttribute('aria-label', `Remove ${d.name}`);
      del.addEventListener('click', (e) => { e.stopPropagation(); app.remove(d.id); });
      li.append(b, del);
      list.append(li);
    });
  }
  $('#scene-row').addEventListener('click', () => app.select(null));

  /* add-device menu: device families, each opening a column of its models
     beside it. Opens to the right of the Add device button, focus on the
     first family. Keyboard: ↑/↓ within a column, → or Enter opens a
     family's models, ← goes back, Esc closes, Tab closes and moves on. */
  const menu = h('div', 'add-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Add device');
  menu.id = 'add-menu';
  menu.hidden = true;
  const famCol = h('div', 'col');
  const famHead = h('div', 'sh');
  famHead.setAttribute('aria-hidden', 'true');
  famHead.append(h('span', null, 'Add device'));
  famCol.append(famHead);
  const modCol = h('div', 'col');
  modCol.setAttribute('role', 'menu');
  modCol.id = 'add-menu-models';
  modCol.hidden = true;
  menu.append(famCol, modCol);
  document.body.append(menu);
  mainAction.setAttribute('aria-controls', menu.id);

  const fams = () => $$('.fam', famCol);
  const mods = () => $$('.mod', modCol);
  const closeMenus = () => {
    menu.hidden = true;
    mainAction.setAttribute('aria-expanded', 'false');
    for (const r of fams()) r.setAttribute('aria-expanded', 'false');
  };
  for (const fam of Object.keys(FAMILIES)) {
    const b = h('button', 'fam');
    b.type = 'button';
    b.tabIndex = -1;
    b.dataset.fam = fam;
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', modCol.id);
    b.append(h('span', 'name', FAMILIES[fam].label), h('span', 'n', String(modelsInFamily(fam).length)), h('span', 'arr', '→'));
    $('.n', b).setAttribute('aria-label', `${modelsInFamily(fam).length} models`);
    $('.arr', b).setAttribute('aria-hidden', 'true');
    const open = () => openSub(fam, b);
    b.addEventListener('mouseenter', open);
    b.addEventListener('focus', open);
    b.addEventListener('click', (e) => { e.stopPropagation(); open(); mods()[0]?.focus(); });
    famCol.append(b);
  }
  function openSub(fam, rowBtn) {
    if (rowBtn.classList.contains('on') && !modCol.hidden) return;
    for (const r of fams()) {
      r.classList.toggle('on', r === rowBtn);
      r.setAttribute('aria-expanded', String(r === rowBtn));
    }
    modCol.innerHTML = '';
    const head = h('div', 'sh');
    head.setAttribute('aria-hidden', 'true');
    head.append(h('span', null, FAMILIES[fam].label));
    modCol.append(head);
    modCol.setAttribute('aria-label', FAMILIES[fam].label);
    for (const m of modelsInFamily(fam)) {
      const b = h('button', 'mod');
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('role', 'menuitem');
      const name = h('span', null, m.label);
      if (m.licence) {
        const tag = h('i', 'tag', 'NC');
        tag.title = `${m.licence}: not for commercial use`;
        tag.setAttribute('aria-label', 'non-commercial');
        name.append(tag);
      }
      b.append(name, h('span', 'res', `${m.res[0]}×${m.res[1]}`));
      b.addEventListener('click', () => { closeMenus(); app.addDevice(m.id); });
      modCol.append(b);
    }
    modCol.hidden = false;
    // keep it on screen now that it's taller
    const top = parseFloat(menu.style.top);
    const over = top + menu.offsetHeight - (innerHeight - 8);
    if (over > 0) menu.style.top = `${Math.max(8, top - over)}px`;
  }
  function openAddMenu() {
    modCol.hidden = true;
    for (const r of fams()) { r.classList.remove('on'); r.setAttribute('aria-expanded', 'false'); }
    menu.hidden = false;
    mainAction.setAttribute('aria-expanded', 'true');
    // beside the button, centred on it
    const r = mainAction.getBoundingClientRect();
    const fh = famCol.offsetHeight;
    menu.style.left = `${clamp(r.right + 8, 8, innerWidth - 528)}px`;
    menu.style.top = `${clamp(r.top + r.height / 2 - fh / 2, 8, innerHeight - fh - 8)}px`;
    fams()[0].focus();
  }
  headAction.addEventListener('click', (e) => { e.stopPropagation(); openStart(false); });
  mainAction.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.hidden) openAddMenu(); else closeMenus();
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) closeMenus(); });
  // registered before the app's shortcuts, so Esc here doesn't also deselect
  document.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeMenus();
      mainAction.focus();
      return;
    }
    if (e.key === 'Tab') { closeMenus(); mainAction.focus(); return; }   // the Tab itself then moves on from the button
    const item = document.activeElement;
    const inFams = famCol.contains(item), inMods = modCol.contains(item);
    if (!inFams && !inMods) return;
    const list = inFams ? fams() : mods();
    const i = list.indexOf(item);
    const move = (to) => { e.preventDefault(); e.stopImmediatePropagation(); list[(to + list.length) % list.length].focus(); };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (inFams && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openSub(item.dataset.fam, item);
      mods()[0]?.focus();
    } else if (inMods && (e.key === ' ' || e.key === 'Enter')) {
      e.stopImmediatePropagation();   // the button's own; not play/pause
    } else if (inMods && e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopImmediatePropagation();
      $('.fam.on', famCol)?.focus();
    }
  });

  /* ----------------------------- assets ---------------------------- */
  let dragAsset = null;   // the library item being dragged, for the drop box's label

  function renderAssets() {
    const list = $('#asset-list');
    list.innerHTML = '';
    const n = state.assets.length;
    const count = $('#asset-count');
    count.hidden = !n;
    count.textContent = n;
    $('#library-count').textContent = n;
    $('#asset-empty').hidden = n > 0;

    for (const a of state.assets) {
      /* The row drags; the button inside places it on the selected device
         (Enter, Space, or a click anywhere on the row). The button takes no
         pointer events itself: Firefox won't start a drag on a button. */
      const li = h('li');
      li.draggable = true;
      li.title = state.selection ? 'Click to place on the selected device, or drag onto any screen' : 'Drag onto a device screen';
      const pick = h('button', 'pick');
      pick.type = 'button';
      pick.setAttribute('aria-label', `Place ${a.name}`);
      const pic = h('span', 'pic');
      pic.style.backgroundImage = `url("${a.thumb}")`;
      const meta = h('small', null, `${a.width}×${a.height} · ${a.kind === 'video' ? fmtClock(a.duration) : 'Image'}`);
      meta.id = `asset-meta-${a.id}`;
      pick.setAttribute('aria-describedby', meta.id);
      const txt = h('span', 'txt');
      txt.append(h('b', null, a.name), meta);
      pick.append(pic, txt);
      // which devices it's on, by number
      const use = h('span', 'use');
      const on = state.devices.flatMap((d, i) => (d.media === a.id || d.second?.media === a.id ? [i] : []));
      if (on.length) for (const i of on) use.append(h('span', 'badge' + (state.devices[i].id === state.selection ? ' sel' : ''), num2(i)));
      else use.append(h('span', null, 'Unused'));
      const x = h('button', 'del', '×');
      x.type = 'button';
      x.title = 'Remove from assets';
      x.setAttribute('aria-label', `Remove ${a.name} from assets`);
      x.addEventListener('click', (e) => { e.stopPropagation(); app.removeAsset(a.id); });
      use.append(x);
      li.append(pick, use);

      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-mockup-asset', a.id);
        e.dataTransfer.setData('text/plain', a.name);
        e.dataTransfer.effectAllowed = 'copy';
        dragAsset = a;
        // after the browser has taken its drag image
        requestAnimationFrame(() => { li.classList.add('dragging'); use.replaceChildren(h('span', null, 'Dragging')); });
      });
      li.addEventListener('dragend', () => { dragAsset = null; setDropTarget(null); renderAssets(); });
      // the button's own clicks (keyboard, screen readers) bubble here too
      li.addEventListener('click', () => {
        if (state.selection) app.assign(state.selection, a.id);
        else toast('Select a device first, or drag this onto a screen.');
      });
      list.append(li);
    }
  }

  const assetDrop = $('#asset-drop');
  $('#asset-input').addEventListener('change', async (e) => {
    await app.importFiles([...e.target.files]);
    e.target.value = '';
  });
  assetDrop.addEventListener('dragover', (e) => { e.preventDefault(); assetDrop.classList.add('over'); });
  assetDrop.addEventListener('dragleave', () => assetDrop.classList.remove('over'));
  assetDrop.addEventListener('drop', async (e) => {
    e.preventDefault();
    assetDrop.classList.remove('over');
    if (e.dataTransfer.files.length) await app.importFiles([...e.dataTransfer.files]);
  });

  /* ---------------------------- inspector -------------------------- */
  function renderInspector() {
    fields = [];
    inspector.innerHTML = '';
    const d = state.selection ? deviceById(state.selection) : null;
    inspecting = d ? d.id : null;
    if (d) deviceInspector(d); else sceneInspector();
    markDropTarget();
  }

  /** Update values in place, so typing in one field isn't interrupted. */
  function refreshInspector() {
    const want = state.selection ? deviceById(state.selection)?.id ?? null : null;
    if (want !== inspecting) return renderInspector();
    for (const f of fields) f.refresh();
  }

  const add = (f) => (fields.push(f), f.el);

  /** Breadcrumb, title and a meta line. */
  function inspectorHead(crumb, title, meta) {
    const nav = h('nav', 'crumb');
    nav.setAttribute('aria-label', 'Selection');
    nav.append(...crumb);
    inspector.append(nav, title, meta);
  }

  /** Media for one of a device's screens: 'main', or 'second' (an open
      foldable's cover screen), whose media and timing live in d.second.
      Empty, it's a slot to drop footage into. `hint` is its title's tooltip. */
  function screenSection(d, slot, title, hint) {
    const touch = () => commit(`device:${d.id}`);
    const t = slot === 'second' ? (d.second ||= { media: null, trim: 0, rate: 1 }) : d;
    const a = t.media ? assetById(t.media) : null;
    const s = section(title, a?.kind === 'video' ? { onReset: () => { t.trim = 0; t.rate = 1; touch(); } } : {});
    s.dataset.slot = slot;
    if (a) {
      s.append(row('Media', add(selectField(
        [['', '— None —'], ...state.assets.map((x) => [x.id, x.name])],
        () => t.media || '',
        (v) => app.assign(d.id, v || null, slot)))));
      if (a.kind === 'video') {
        s.append(row('Start at', add(numField({ get: () => t.trim, set: (v) => { t.trim = v; touch(); }, step: 0.1, min: 0, max: Math.max(0, a.duration - 0.1), digits: 2, unit: 's', fixed: true }))));
        s.append(row('Speed', add(numField({ get: () => t.rate, set: (v) => { t.rate = v; touch(); }, step: 0.05, min: 0.25, max: 3, digits: 2, unit: '×', fixed: true }))));
      }
    } else {
      const box = h('div', 'slot');
      const msg = h('span', null, 'Drop footage here');
      const links = h('span', 'links');
      const up = h('button', 'text-btn', 'Upload a file');
      up.type = 'button';
      up.addEventListener('click', () => app.pickReplacement(d.id, slot));
      links.append(up);
      if (state.assets.length) {
        const lib = h('button', 'text-btn', 'choose from library');
        lib.type = 'button';
        lib.addEventListener('click', () => setTab('assets'));
        links.append(document.createTextNode('or'), lib);
      }
      box.append(h('small', null, 'No media'), msg, links);
      // the slot takes drops too
      box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('over'); msg.textContent = 'Release to place here'; });
      box.addEventListener('dragleave', (e) => {
        if (box.contains(e.relatedTarget)) return;
        box.classList.remove('over');
        msg.textContent = 'Drop footage here';
      });
      box.addEventListener('drop', async (e) => {
        e.preventDefault();
        box.classList.remove('over');
        const id = e.dataTransfer.getData('application/x-mockup-asset');
        if (id) { app.assign(d.id, id, slot); return; }
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        const { added } = await app.importFiles(files);
        if (added[0]) app.assign(d.id, added[0].id, slot);
      });
      s.append(box);
    }
    if (hint) s.querySelector('h3 > span').title = hint;
    return s;
  }

  function deviceInspector(d) {
    const m = MODELS[d.model];
    const fam = m.family;
    const touch = () => commit(`device:${d.id}`);
    const handheld = fam === 'phone' || fam === 'tablet';      // can turn landscape

    // header: Scene / 02 Device, the editable name, brand · type · resolution
    const back = h('button', 'text-btn', 'Scene');
    back.type = 'button';
    back.addEventListener('click', () => app.select(null));
    const name = h('input', 'insp-title');
    name.value = d.name;
    name.setAttribute('aria-label', 'Device name');
    name.addEventListener('change', () => { d.name = name.value.trim() || m.label; commit('devices'); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    const res = formOf(d.model, d.folded).res;
    inspectorHead(
      [back, h('span', 'dim', '/'), h('span', 'badge sel', num2(state.devices.indexOf(d))), h('span', null, 'Device')],
      name,
      h('div', 'insp-meta', `${m.brand} · ${FAMILY_ONE[fam]} · ${res[0]}×${res[1]}`));

    // device
    const hg = hingeOf(d.model);
    const fd = foldOf(d.model);
    const s1 = section('Device', hg ? { onReset: () => { d.hinge = hg.rest; touch(); renderInspector(); }, resetLabel: `Reset ${hg.label.toLowerCase()}` }
      : fd && !d.folded ? { onReset: () => { d.foldAngle = fd.rest; touch(); renderInspector(); }, resetLabel: 'Reset angle' } : {});
    s1.append(row('Model', add(selectField(
      modelsInFamily(fam).map((x) => [x.id, x.label]),
      () => d.model,
      (v) => app.reshape(d.id, () => {
        if (d.name === MODELS[d.model].label) d.name = MODELS[v].label;
        // keep the finish if the new model offers it, otherwise take its default
        if (!finishesFor(v).some(([, hex]) => hex === d.color.toLowerCase())) d.color = defaultColorFor(v);
        // keep the angle if it fits the new model's hinge, otherwise start at its rest angle
        const hg = hingeOf(v);
        if (!hg || hg.kind !== hingeOf(d.model)?.kind || d.hinge == null || d.hinge < hg.min || d.hinge > hg.max) d.hinge = hg?.rest ?? null;
        if (!foldable(v)) d.folded = false;
        d.model = v;
      }, 'devices')))));
    if (hg) {
      s1.append(row(hg.label, add(sliderField({
        get: () => d.hinge ?? hg.rest, set: (v) => { d.hinge = v; touch(); },
        min: hg.min, max: hg.max, step: 1, format: fmtDeg,
      }))));
    }
    if (foldable(d.model)) {
      s1.append(row('Fold', add(segField(
        [['open', 'Open'], ['closed', 'Closed']],
        () => (d.folded ? 'closed' : 'open'),
        (v) => { app.setFolded(d.id, v === 'closed'); renderInspector(); }))));   // its screens change
      if (fd && !d.folded) {
        // open, it can part-fold: 180° is flat, like a laptop's lid
        s1.append(row(fd.label, add(sliderField({
          get: () => d.foldAngle ?? fd.rest, set: (v) => { d.foldAngle = v; touch(); },
          min: fd.min, max: fd.max, step: 1, format: fmtDeg,
        }))));
      }
    }
    if (handheld) {
      // `landscape` turns the device from its screen's own shape, which for an open Fold8 is already wide
      const wide = () => screenAspectOf(d.model, d.folded) > 1;
      s1.append(row('Orientation', add(segField(
        [['portrait', 'Portrait'], ['landscape', 'Landscape']],
        () => (d.landscape !== wide() ? 'landscape' : 'portrait'),
        (v) => app.reshape(d.id, () => { d.landscape = (v === 'landscape') !== wide(); })))));
    }
    if (m.licence) {
      const lic = h('p', 'note licence');
      lic.append(h('i', 'tag', 'NC'), `This model is licensed ${m.licence}: images and videos made with it can't be used commercially.`);
      s1.append(lic);
    }
    inspector.append(s1);

    // transform
    const s2 = section('Transform', {
      actions: [
        ['Sit on ground', () => app.sitOnGround(d.id), 'Put its lowest point on the floor'],
        ['Reset rotation', () => { d.rotation = [0, 0, 0]; touch(); }],
      ],
    });
    const trio = (label, key, opts, tip) => {
      const t = h('div', 'trio');
      ['X', 'Y', 'Z'].forEach((axis, i) => t.append(add(numField({
        axis, get: () => d[key][i], set: (v) => { d[key][i] = v; touch(); }, ...opts,
      }))));
      s2.append(row(label, t, tip));
    };
    trio('Position', 'position', { scale: 100, digits: 1, step: 0.5, fixed: true }, 'Position in cm. Drag X/Y/Z to scrub; Shift coarse, Alt fine');
    trio('Rotation', 'rotation', { scale: 1, digits: 1, step: 1, unit: '°' }, 'Rotation in degrees. Drag X/Y/Z to scrub; Shift coarse, Alt fine');
    inspector.append(s2);

    // finish: swatches, then the colour's name
    const finishes = finishesFor(d.model);
    const s3 = section('Finish', { onReset: () => { d.color = defaultColorFor(d.model); touch(); paint(); } });
    const finish = h('div', 'finish');
    const colors = h('div', 'swatches');
    colors.setAttribute('role', 'radiogroup');
    colors.setAttribute('aria-label', 'Finish');
    const label = h('span', 'color-name');
    /* The custom swatch is a rainbow until a custom colour is chosen, so it
       reads as "any colour" rather than as one more preset. */
    const custom = h('label', 'swatch custom');
    custom.title = 'Custom colour';
    const picker = h('input');
    picker.type = 'color';
    picker.setAttribute('aria-label', 'Custom colour');
    picker.addEventListener('input', () => { d.color = picker.value; touch(); paint(); });
    custom.append(picker);
    const paint = () => {
      const hex = d.color.toLowerCase();
      const hit = finishes.find(([, f]) => f === hex);
      $$('button.swatch', colors).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.hex === hex)));
      custom.setAttribute('aria-checked', String(!hit));
      custom.style.setProperty('--custom', hit ? 'transparent' : hex);
      picker.value = hex;
      label.textContent = hit ? hit[0] : `Custom · ${hex.toUpperCase()}`;
    };
    for (const [n, hex] of finishes) {
      const b = h('button', 'swatch');
      b.type = 'button'; b.title = n; b.dataset.hex = hex; b.style.background = hex;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', n);
      b.addEventListener('click', () => { d.color = hex; touch(); paint(); });
      colors.append(b);
    }
    colors.append(custom);
    fields.push({ refresh: paint });
    paint();
    finish.append(colors, label);
    s3.append(finish);
    inspector.append(s3);

    // screens: one, or an open foldable's inner and cover screens
    const open = hasCover(d.model, d.folded);
    inspector.append(screenSection(d, 'main', !foldable(d.model) ? 'Screen' : open ? 'Inner screen' : 'Cover screen'));
    if (open) inspector.append(screenSection(d, 'second', 'Cover screen', 'On the back. Closing the phone brings it to the front.'));

    // motion: Float is the header's switch
    const chk = h('label', 'check');
    chk.title = fam === 'laptop' || fam === 'desktop'
      ? 'A gentle bob and tilt. Desk devices usually sit on the ground'
      : 'A gentle bob and tilt';
    const cb = h('input'); cb.type = 'checkbox';
    cb.checked = !!d.float?.enabled;
    cb.addEventListener('change', () => { d.float.enabled = cb.checked; touch(); renderInspector(); });
    chk.append(cb, document.createTextNode('Float'));
    const s5 = section('Motion', { extra: chk });
    if (d.float?.enabled) {
      s5.append(row('Amount', add(sliderField({ get: () => d.float.amount, set: (v) => { d.float.amount = v; touch(); }, min: 0, max: 1.5, step: 0.01 }))));
      s5.append(row('Phase', add(numField({ get: () => d.float.seed, set: (v) => { d.float.seed = v; touch(); }, step: 0.1, min: 0, max: 100, digits: 1, fixed: true })),
        'Give each floating device a different phase, or they move in lockstep'));
    }
    inspector.append(s5);

    const actions = h('div', 'actions');
    const dup = h('button', 'line-btn', 'Duplicate'); dup.type = 'button';
    dup.addEventListener('click', () => app.duplicate(d.id));
    const del = h('button', 'line-btn danger', 'Delete'); del.type = 'button';
    del.addEventListener('click', () => app.remove(d.id));
    actions.append(dup, del);
    inspector.append(actions);
  }

  function sceneInspector() {
    const sc = state.scene;
    const touch = () => commit('scene');
    const defaults = defaultScene();
    // restore one sub-object (or a few keys) of the scene to its defaults
    const resetTo = (keys) => () => {
      for (const k of keys) sc[k] = structuredClone(defaults[k]);
      touch();
      renderInspector();
    };

    const meta = h('div', 'insp-meta');
    const paintMeta = () => {
      const n = state.devices.length;
      meta.textContent = `${n ? `${n} device${n === 1 ? '' : 's'}` : 'No devices'} · ${sc.duration.toFixed(1)}s`;
    };
    paintMeta();
    fields.push({ refresh: paintMeta });
    inspectorHead(
      state.exporting
        ? [h('span', 'badge', 'SCENE'), h('span', 'dim', 'Locked while exporting')]
        : [h('span', 'badge sel', 'SCENE'), h('span', 'dim', 'Nothing selected')],
      h('h2', 'insp-title', 'Scene'),
      meta);

    const s1 = section('Frame', { onReset: resetTo(['output', 'fps', 'duration']) });
    s1.append(row('Output', add(selectField(Object.entries(OUTPUTS).map(([k, v]) => [k, v.label]), () => sc.output, (v) => { sc.output = v; touch(); }))));
    s1.append(row('Frame rate', add(segField([[24, '24'], [30, '30'], [60, '60']], () => sc.fps, (v) => { sc.fps = Number(v); touch(); }))));
    s1.append(row('Duration', add(numField({ get: () => sc.duration, set: (v) => { sc.duration = v; touch(); }, step: 0.5, min: 1, max: 60, digits: 1, unit: 's', fixed: true }))));
    inspector.append(s1);

    const s2 = section('Camera', { onReset: resetTo(['motion']) });
    s2.querySelector('h3 > span').title = 'Drag the stage to orbit, right-drag to pan, scroll to move closer. With motion on, you set the starting shot. The lens is a fixed 50mm';
    s2.append(row('Motion', add(selectField(
      [['static', 'Static', 'The camera holds still'],
        ['dolly', 'Push / pull', 'The camera moves toward the devices, or pulls back from a close start'],
        ['turntable', 'Turntable', 'The devices turn in place while camera and lights stay still. A full 360° loops seamlessly'],
        ['slide', 'Slide', 'The camera tracks sideways; nearer devices pass faster than far ones'],
        ['crane', 'Crane up', 'The camera rises straight up'],
        ['drift', 'Handheld drift', 'A handheld float: subtle at low amounts, plainly handheld at 1']],
      () => sc.motion.preset, (v) => { sc.motion.preset = v; sc.motion.reverse = false; touch(); renderInspector(); }))));
    const preset = sc.motion.preset;
    // the two ways each move can go: [forward, reversed]
    const ways = { dolly: ['Push in', 'Pull back'], turntable: ['Clockwise', 'Anti\u00ADclockwise'], slide: ['Right', 'Left'] }[preset];
    if (ways) {
      s2.append(row('Direction', add(segField(
        [['fwd', ways[0]], ['rev', ways[1]]],
        () => (sc.motion.reverse ? 'rev' : 'fwd'),
        (v) => { sc.motion.reverse = v === 'rev'; touch(); renderInspector(); }))));
    }
    if (preset !== 'static') {
      const turn = preset === 'turntable';
      s2.append(row(turn ? 'Turn' : 'Amount', add(sliderField({
        get: () => sc.motion.amount, set: (v) => { sc.motion.amount = v; touch(); }, min: 0, max: 1, step: 0.01,
        ...(turn ? { format: (v) => `${Math.round(v * 360)}°` } : {}),
      }))));
    }
    inspector.append(s2);

    const s3 = section('Background', { onReset: resetTo(['background']) });
    s3.append(row('Style', add(segField([['gradient', 'Gradient'], ['solid', 'Solid']], () => sc.background.mode, (v) => { sc.background.mode = v; touch(); renderInspector(); }))));
    if (sc.background.mode === 'gradient') {
      s3.append(row('Top', add(colorInput(() => sc.background.top, (v) => { sc.background.top = v; touch(); }))));
      s3.append(row('Bottom', add(colorInput(() => sc.background.bottom, (v) => { sc.background.bottom = v; touch(); }))));
    } else {
      s3.append(row('Colour', add(colorInput(() => sc.background.color, (v) => { sc.background.color = v; touch(); }))));
    }
    inspector.append(s3);

    const s4 = section('Ground', { onReset: resetTo(['ground']) });
    s4.append(row('Type', add(segField([
      ['shadow', 'Shadow', 'An invisible floor that only catches shadows; works with transparent PNG export'],
      ['solid', 'Floor', 'A visible floor surface'],
      ['none', 'None', 'No floor and no ground shadows']], () => sc.ground.mode, (v) => { sc.ground.mode = v; touch(); renderInspector(); }))));
    if (sc.ground.mode === 'solid') s4.append(row('Colour', add(colorInput(() => sc.ground.color, (v) => { sc.ground.color = v; touch(); }))));
    if (sc.ground.mode !== 'none') {
      s4.append(row('Shadow', add(sliderField({ get: () => sc.ground.shadow, set: (v) => { sc.ground.shadow = v; touch(); }, min: 0, max: 0.9, step: 0.01 }))));
      s4.append(row('Softness', add(sliderField({
        get: () => sc.ground.softness, set: (v) => { sc.ground.softness = v; touch(); },
        min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`,
      }))));
    }
    inspector.append(s4);

    const s5 = section('Lighting', { onReset: resetTo(['light']) });
    // a mood sets the light, background and floor shadow together; the rest adjusts from there
    s5.append(row('Mood', add(selectField(
      [...Object.entries(MOODS).map(([id, m]) => [id, m.label]), ...(resolveMood(sc.light.mood) ? [] : [['custom', 'Custom']])],
      () => resolveMood(sc.light.mood) || 'custom',
      (v) => {
        const m = MOODS[v];
        if (!m) return;
        sc.light = { ...sc.light, ...structuredClone(m.light), mood: v };
        sc.background = { ...sc.background, ...structuredClone(m.background) };
        sc.ground = { ...sc.ground, ...structuredClone(m.ground) };
        touch();
        renderInspector();
      }))));
    s5.append(row('Key light', add(sliderField({ get: () => sc.light.key, set: (v) => { sc.light.key = v; touch(); }, min: 0, max: 4, step: 0.05 }))));
    s5.append(row('Ambient', add(sliderField({ get: () => sc.light.env, set: (v) => { sc.light.env = v; touch(); }, min: 0, max: 2.5, step: 0.05 }))));
    s5.append(row('Direction', add(sliderField({ get: () => sc.light.angle, set: (v) => { sc.light.angle = v; touch(); }, min: -180, max: 180, step: 1, format: fmtDeg }))));
    s5.append(row('Height', add(sliderField({ get: () => sc.light.elevation, set: (v) => { sc.light.elevation = v; touch(); }, min: 15, max: 85, step: 1, format: fmtDeg }))));
    s5.append(row('Glare', add(segField(
      [['none', 'None', 'Screens show footage exactly as recorded'],
        ['matte', 'Matte', 'A soft sheen from the light, like an anti-glare coating'],
        ['glossy', 'Glossy', 'Screens reflect the scene like polished glass; reflections lift dark areas']],
      () => sc.light.screen || 'none',
      (v) => { sc.light.screen = v; touch(); renderInspector(); }))));
    inspector.append(s5);
  }

  /* ----------------------------- export ---------------------------- */
  const exp = { format: 'mp4', size: '1', background: true, quality: DEFAULT_QUALITY };
  const refreshFmt = bindStaticSeg($('#fmt-seg'), () => exp.format, (v) => { exp.format = v; syncExportUI(); });
  bindStaticSeg($('#size-seg'), () => exp.size, (v) => { exp.size = v; renderExportSummary(); });
  $('#exp-background').addEventListener('change', (e) => { exp.background = e.target.checked; renderExportSummary(); });

  /* Quality 1–100, where 80 is the recommended bitrate for the output size and
     frame rate. The browser's H.264 encoder treats the bitrate as a ceiling —
     footage with little motion or flat colour comes in under it (measured:
     16 Mbps asked, ~9 delivered) — so the size shown is an upper bound. */
  const rate = $('#bitrate');
  const rateOut = $('#bitrate-out');
  const currentMbps = () => bitrateForQuality(exp.quality, output().w, output().h, state.scene.fps);
  rate.addEventListener('input', () => { exp.quality = Number(rate.value); renderExportSummary(); });
  function renderBitrate() {
    rate.value = exp.quality;
    fill(rate);
    rateOut.textContent = exp.quality;
  }
  /* upper bound: simple scenes come in under the bitrate ceiling */
  function estimatedSize() {
    const mb = (currentMbps() * state.scene.duration) / 8;
    return `Up to ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }

  if (!canExportVideo()) {
    const vbtn = $('#fmt-seg [data-v="mp4"]');
    vbtn.disabled = true;
    vbtn.title = 'This browser lacks WebCodecs, which video export needs. Try a current Chrome, Edge, Safari or Firefox.';
    exp.format = 'png';
    refreshFmt();
  }

  const exportLabel = () => (exp.format === 'mp4' ? 'Export video' : `Export ${exp.format.toUpperCase()}`);
  function syncExportUI() {
    const img = exp.format !== 'mp4';
    $$('.only-image').forEach((e) => { e.hidden = !img; });
    $$('.only-png').forEach((e) => { e.hidden = exp.format !== 'png'; });
    $$('.only-video').forEach((e) => { e.hidden = img; });
    if (!state.exporting) $('#export-go').textContent = exportLabel();
    renderExportSummary();
  }

  const imageEstimate = { text: 'Calculating…', timer: 0, run: 0 };
  function renderExportSummary() {
    const o = output();
    const dl = $('#export-summary');
    const img = exp.format !== 'mp4';
    const k = img ? Number(exp.size) : 1;
    if (img) imageEstimate.text = state.playing ? 'Pause to estimate' : 'Calculating…';
    const rows = img
      ? [['Resolution', `${o.w * k}×${o.h * k}`], ['Frame at', `${state.time.toFixed(2)}s`],
         ['Est. size', imageEstimate.text]]
      : [['Resolution', `${o.w}×${o.h}`], ['Length', `${state.scene.duration}s · ${state.scene.fps} fps`],
         ['Frames', String(Math.round(state.scene.duration * state.scene.fps))],
         ['Est. size', estimatedSize()]];
    dl.innerHTML = '';
    for (const [k2, v] of rows) dl.append(h('dt', null, k2), h('dd', null, v));
    // non-commercial models in the scene
    const nc = [...new Set(state.devices.map((d) => MODELS[d.model]).filter((m) => m.licence).map((m) => m.label))];
    const lic = $('#export-licence');
    lic.hidden = !nc.length;
    lic.textContent = nc.length
      ? `Non-commercial use only: the ${nc.join(', ')} model${nc.length > 1 ? 's are' : ' is'} licensed CC BY-NC-SA 4.0.`
      : '';
    if (img) scheduleImageEstimate();
    else { clearTimeout(imageEstimate.timer); imageEstimate.run++; renderBitrate(); }   // drop any image estimate in flight
  }

  /* Image sizes depend on the picture, so they're measured by encoding the
     current frame, a moment after the last change. Paused only: during
     playback the frame changes too fast for the figure to mean anything. */
  function scheduleImageEstimate() {
    clearTimeout(imageEstimate.timer);
    imageEstimate.run++;   // any estimate in flight is now stale
    if (state.playing || state.exporting || state.prefs.tab !== 'export') return;
    imageEstimate.timer = setTimeout(async () => {
      const run = ++imageEstimate.run;
      const bytes = await estimateImageSize(app.vp, {
        format: exp.format, transparent: exp.format === 'png' && !exp.background, scale: Number(exp.size),
      }).catch(() => 0);
      if (run !== imageEstimate.run || !bytes) return;
      const mb = bytes / 1e6;
      imageEstimate.text = mb < 1 ? `About ${Math.max(1, Math.round(bytes / 1e3))} KB` : `About ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
      const dd = [...$('#export-summary').querySelectorAll('dt')].find((d) => d.textContent === 'Est. size')?.nextElementSibling;
      if (dd) dd.textContent = imageEstimate.text;
    }, 350);
  }

  function setProgress(pct) {
    for (const f of [$('#export-fill'), $('#veil-fill')]) f.style.width = `${pct}%`;
    $('#export-pct').textContent = `${pct}%`;
    $('.bar[role="progressbar"]').setAttribute('aria-valuenow', pct);
  }

  /** The finished export: a card to download it again, or what went wrong. */
  function showResult({ out, error }) {
    const r = $('#export-result');
    r.innerHTML = '';
    r.className = 'card-box' + (error ? ' err' : '');
    const head = h('div', 'head');
    if (out) {
      const mb = (out.blob.size / 1048576).toFixed(1);
      head.append(h('b', null, 'Ready'));
      if (out.seconds) head.append(h('span', 'dim', `took ${fmtDur(out.seconds)}`));   // videos; images are instant
      // it downloaded already; this saves it again, should the first one have been missed or blocked
      const again = h('button', 'text-btn', 'Download again');
      again.type = 'button';
      again.addEventListener('click', () => download(out.blob, out.name));
      const line = h('div', 'file-row');
      const file = h('span', 'file', `${out.name} · ${mb} MB`);
      file.title = out.name;
      line.append(file, again);
      r.append(head, h('div', 'rule'), line);
      if (out.exact === false) r.append(h('p', 'note', 'One clip used the seek fallback (not MP4/MOV, or an unsupported codec) — check for any repeated frames.'));
    } else {
      const cancelled = error.name === 'AbortError';
      head.append(h('b', null, cancelled ? 'Cancelled' : 'Export failed'));
      r.append(head);
      if (!cancelled) r.append(h('p', 'note', error.message));
    }
    r.hidden = false;
  }

  /** Export needs something to render. */
  function renderExportBtn() {
    const go = $('#export-go'), none = !state.devices.length;
    go.disabled = none || state.exporting;
    go.title = none ? 'Add a device to export' : '';
  }

  /** While exporting, only the export panel works. */
  /** While exporting, only the export panel works — by mouse or keyboard. */
  const veil = $('#export-veil');
  function placeVeil() {
    // over the render only: it shares the render's grid cell, so the two stay
    // centred together however the window resizes; the render keeps its size
    // while exporting
    const c = app.vp.canvasRect();
    Object.assign(veil.style, { width: `${c.w}px`, height: `${c.h}px` });
  }
  function lock(on) {
    document.body.classList.toggle('exporting', on);
    for (const el of [$('#right'), $('.tab-body[data-body="scene"]'), $('.tab-body[data-body="assets"]'), $('#overlay')]) el.inert = on;
    if (on) closeMenus();
    $$('.tabs button').forEach((b) => { b.disabled = on && b.dataset.tab !== 'export'; });
    $$('#fmt-seg button, #size-seg button, #exp-background, #bitrate').forEach((e) => {
      e.disabled = on || (e.dataset.v === 'mp4' && !canExportVideo());
    });
    $('.bar-acts').hidden = on;
    $('#render-status').hidden = !on;
    veil.hidden = !on;
    if (on) placeVeil();
  }


  let abort = null;
  $('#export-go').addEventListener('click', async () => {
    if (state.exporting || !state.devices.length) return;
    app.pause();
    const video = exp.format === 'mp4';
    const prog = $('#export-progress'), msg = $('#export-msg');
    $('#export-result').hidden = true;

    commit('exporting', (s) => { s.exporting = true; });
    lock(true);
    $('#export-go').hidden = true;
    prog.hidden = false;
    $('#export-title').textContent = video ? 'Exporting' : 'Rendering';
    $('#veil-title').textContent = video ? 'Exporting video' : 'Rendering image';
    $('#render-time').textContent = `${state.time.toFixed(2)}s`;
    setProgress(0);
    msg.textContent = 'Preparing…';
    abort = new AbortController();
    $('#export-cancel').hidden = !video;

    try {
      let out;
      if (video) {
        out = await exportVideo(app.vp, {
          bitrate: currentMbps() * 1e6,
          signal: abort.signal,
          onProgress: (i, n, eta) => {
            setProgress(Math.round((i / n) * 100));
            msg.textContent = `Frame ${i} of ${n}${eta > 1 ? ` · ~${fmtDur(eta)} left` : ''}`;
            $('#render-time').textContent = `${((i / n) * state.scene.duration).toFixed(2)}s`;
          },
        });
      } else {
        out = await exportImage(app.vp, {
          format: exp.format,
          transparent: exp.format === 'png' && !exp.background,
          scale: Number(exp.size),
        });
        setProgress(100);
      }
      download(out.blob, out.name);
      showResult({ out });
    } catch (e) {
      showResult({ error: e });
      if (e.name !== 'AbortError') console.error(e);
    } finally {
      abort = null;
      prog.hidden = true;
      $('#export-go').hidden = false;
      lock(false);
      commit('exporting', (s) => { s.exporting = false; });
      syncExportUI();
      renderExportBtn();
    }
  });
  $('#export-cancel').addEventListener('click', () => { abort?.abort(); $('#export-msg').textContent = 'Cancelling…'; });

  /* ------------------------------ stage ---------------------------- */
  $('#frame-btn').addEventListener('click', () => app.frame(state.selection ? [state.selection] : null));

  /* Show/Hide UI: the numbers and labels drawn over the render. Hidden,
     the shot shows clean; the selection keeps its outline. The button
     says what pressing it will do. */
  const uiBtn = $('#ui-btn');
  const uiOn = () => state.prefs.ui !== false;
  function toggleUI() {
    if (!state.devices.length) return;
    state.prefs.ui = !uiOn();
    commit('prefs');
    renderUIBtn();
    renderOverlay();
  }
  const renderUIBtn = () => {
    $('span', uiBtn).textContent = uiOn() ? 'Hide UI' : 'Show UI';
    uiBtn.disabled = !state.devices.length;
  };
  uiBtn.addEventListener('click', toggleUI);

  function renderStageBar() {
    const o = output();
    const ratio = OUTPUTS[state.scene.output]?.label.split(' · ')[0];
    $('#out-label').textContent = `${ratio ? `${ratio} · ` : ''}${o.w}×${o.h} · ${state.scene.fps} fps`;
    $('#frame-btn').disabled = !state.devices.length;
    renderUIBtn();
  }

  /* Labels over the render, redrawn with every frame: the selected device's
     outline, number and name, with Replace media beneath; an outlined number
     on every other device, so they read as clickable; with nothing selected,
     the frame itself outlined as SCENE. While something is dragged over a
     screen, a drop box marks where it'll land. */
  const overlay = $('#overlay');
  const selMedia = $('#sel-media');
  const ov = {
    box: h('div', 'sel-box'),
    label: h('div', 'sel-label'),
    scene: h('span', 'badge sel scene-badge', 'SCENE'),
    drop: h('div', 'drop-box'),
    dropBadge: h('span'),
    badges: new Map(),   // device id → its outlined number
  };
  ov.label.append(h('span', 'n'), h('span', 'name'));
  ov.drop.append(h('b', null, 'Drop to place'), h('span'));
  let dropTarget = null;   // { id, slot } while something is dragged over a device
  let dropWhat = '';       // what's being dragged, for the drop box

  const px = (el, x, y) => { el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y)}px`; };
  /** A rectangle trimmed to the render, or null if none of it is in view. */
  function inView(r, c) {
    if (!r) return null;
    const x0 = Math.max(r.x, c.x), y0 = Math.max(r.y, c.y);
    const x1 = Math.min(r.x + r.w, c.x + c.w), y1 = Math.min(r.y + r.h, c.y + c.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  function renderOverlay() {
    const vp = app.vp;
    const empty = !state.devices.length;
    host.classList.toggle('empty', empty);
    $('#empty-drop').hidden = !empty;
    const live = !state.exporting && !empty;
    const sel = live && !dropTarget ? state.selection : null;
    const labels = uiOn();
    host.classList.toggle('scene-sel', live && !state.selection);
    $('#stage-hint').hidden = !live || !labels || !!state.selection || !!dropTarget;

    const c = vp.canvasRect();
    const W = host.clientWidth, H = host.clientHeight;
    const shown = new Set();

    if (live && labels && !state.selection) { px(ov.scene, c.x - 6, c.y - 32); shown.add(ov.scene); }

    let selRect = null;
    state.devices.forEach((d, i) => {
      if (!live) return;
      const r = inView(vp.deviceRect(d.id), c);
      if (!r) return;
      if (d.id === sel) { selRect = r; return; }
      if (dropTarget?.id === d.id || !labels) return;   // the drop box carries its number
      let b = ov.badges.get(d.id);
      if (!b) ov.badges.set(d.id, (b = h('span', 'on-render')));
      b.textContent = num2(i);
      px(b, r.x, r.y);
      shown.add(b);
    });
    for (const id of ov.badges.keys()) if (!deviceById(id)) ov.badges.delete(id);

    if (selRect) {
      Object.assign(ov.box.style, { width: `${Math.round(selRect.w)}px`, height: `${Math.round(selRect.h)}px` });
      px(ov.box, selRect.x, selRect.y);
      shown.add(ov.box);
    }
    if (selRect && labels) {
      const d = deviceById(sel);
      ov.label.firstChild.textContent = num2(state.devices.indexOf(d));
      ov.label.lastChild.textContent = d.name;
      shown.add(ov.label);
      overlay.append(ov.label);   // measured below
      const lw = ov.label.offsetWidth;
      // above the outline, or just inside it when there's no room
      px(ov.label, clamp(selRect.x, 4, W - lw - 4), selRect.y - 24 >= 2 ? selRect.y - 24 : selRect.y + 4);
      selMedia.textContent = `${d.media ? 'Replace' : 'Add'} media`;
      selMedia.hidden = false;
      const mw = selMedia.offsetWidth, mh = selMedia.offsetHeight;
      const below = selRect.y + selRect.h + 8;
      px(selMedia, clamp(selRect.x, 4, W - mw - 4), below + mh <= H - 4 ? below : selRect.y + selRect.h - mh - 6);
    } else {
      selMedia.hidden = true;
    }

    if (dropTarget && live) {
      const d = deviceById(dropTarget.id);
      const r = inView(vp.screenRect(dropTarget.id, dropTarget.slot), c) || inView(vp.deviceRect(dropTarget.id), c);
      if (d && r) {
        Object.assign(ov.drop.style, { width: `${Math.round(r.w)}px`, height: `${Math.round(r.h)}px` });
        px(ov.drop, r.x, r.y);
        ov.drop.classList.toggle('compact', r.w < 170 || r.h < 64);
        ov.drop.lastChild.textContent = `${dropWhat} → ${d.name}${dropTarget.slot === 'second' ? ' (cover)' : ''}`;
        // its number above, filled if it's the selected device
        ov.dropBadge.className = d.id === state.selection ? 'badge sel' : 'on-render';
        ov.dropBadge.textContent = num2(state.devices.indexOf(d));
        px(ov.dropBadge, r.x, Math.max(2, r.y - 22));
        shown.add(ov.drop);
        if (labels) shown.add(ov.dropBadge);
      }
    }

    // add what's shown, drop the rest
    for (const el of [...overlay.children]) if (!shown.has(el)) el.remove();
    for (const el of shown) if (el.parentNode !== overlay) overlay.append(el);
  }

  /** Something is dragged over a device (or off it, with null). */
  function setDropTarget(t) {
    const same = t && dropTarget && t.id === dropTarget.id && t.slot === dropTarget.slot;
    if (same || (!t && !dropTarget)) return;
    dropTarget = t;
    markDropTarget();
    renderOverlay();
  }
  /** The inspector mirrors the drop target when it's showing that device. */
  function markDropTarget() {
    for (const s of $$('.section[data-slot]', inspector)) {
      const on = !!dropTarget && dropTarget.id === inspecting && s.dataset.slot === dropTarget.slot;
      s.classList.toggle('drop-target', on);
      const msg = $('.slot > span', s);
      if (msg) msg.textContent = on ? 'Release to place here' : 'Drop footage here';
    }
  }

  // hover chip: replace or add media on any screen but the selected one's,
  // which has its own button beneath its outline
  const chip = $('#screen-chip');
  let chipFor = null, chipSlot = 'main';
  function showChip(id, anchor, mode = 'hover', slot = 'main') {
    if (!id || !anchor || state.exporting || mode !== 'hover' || (id === state.selection && (slot || 'main') === 'main')) {
      chip.hidden = true; chipFor = null; return;
    }
    const d = deviceById(id);
    if (!d) { chip.hidden = true; return; }
    chipFor = id; chipSlot = slot || 'main';
    const second = chipSlot === 'second';
    const has = second ? d.second?.media : d.media;
    chip.textContent = `${has ? 'Replace' : 'Add'} ${second ? 'cover screen media' : 'media'}`;
    chip.style.left = `${anchor.x}px`;
    chip.style.top = `${anchor.y}px`;
    chip.hidden = false;
  }
  chip.addEventListener('click', () => { if (chipFor) app.pickReplacement(chipFor, chipSlot); });
  chip.addEventListener('pointerleave', (e) => {
    if (!e.relatedTarget?.closest?.('canvas.gl')) showChip(null);
  });
  selMedia.addEventListener('click', () => { if (state.selection) app.pickReplacement(state.selection, 'main'); });

  // dropping assets or files straight onto the stage
  const emptyDrop = $('#empty-drop');
  $('#empty-input').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await app.quickstartFromFiles(files);
  });
  host.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!state.devices.length) { emptyDrop.classList.add('over'); return; }
    const n = e.dataTransfer.items?.length || 1;
    dropWhat = dragAsset ? dragAsset.name : `${n} file${n > 1 ? 's' : ''}`;
    const hit = app.vp.pick(e.clientX, e.clientY);
    setDropTarget(hit ? { id: hit.id, slot: hit.slot || 'main' } : null);
  });
  host.addEventListener('dragleave', (e) => {
    if (host.contains(e.relatedTarget)) return;
    emptyDrop.classList.remove('over');
    setDropTarget(null);
  });
  host.addEventListener('drop', async (e) => {
    e.preventDefault();
    emptyDrop.classList.remove('over');
    setDropTarget(null);
    const hit = app.vp.pick(e.clientX, e.clientY);
    const assetId = e.dataTransfer.getData('application/x-mockup-asset');
    if (assetId) {
      if (hit) app.assign(hit.id, assetId, hit.slot || 'main');
      else toast('Drop it onto a device’s screen.');
      return;
    }
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (!state.devices.length) { await app.quickstartFromFiles(files); return; }
    const { added, reused } = await app.importFiles(files);
    const fresh = added.length - reused.length;
    if (added.length && hit) app.assign(hit.id, added[0].id, hit.slot || 'main');
    else if (fresh) toast(`Added ${fresh} file${fresh > 1 ? 's' : ''} to Assets.`);
  });

  /* ---------------------------- transport -------------------------- */
  const scrub = $('#scrub');
  function renderTransport() {
    const idle = state.exporting || !state.devices.length;
    $('#play').classList.toggle('on', state.playing);
    $('#play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    $('#play').disabled = idle;
    scrub.disabled = idle;
    $('#time-label').textContent = state.time.toFixed(2);
    $('#time-label').classList.toggle('dim', !state.devices.length);
    $('#dur-label').textContent = `${state.scene.duration.toFixed(2)}s`;
    scrub.max = state.scene.duration;
    if (document.activeElement !== scrub) scrub.value = state.time;
    fill(scrub);
  }
  $('#play').addEventListener('click', () => app.togglePlay());
  scrub.addEventListener('input', () => { app.pause(); app.seek(parseFloat(scrub.value)); fill(scrub); });

  /* ------------------------------ theme ---------------------------- */
  bindStaticSeg($('#theme-seg'), () => state.prefs.theme, (v) => {
    state.prefs.theme = v;
    if (v === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
    commit('prefs');
  });

  /* ----------------------------- dialogs --------------------------- */
  const start = $('#start-dialog');
  const tg = $('#template-grid');
  $('#template-count').textContent = TEMPLATES.length;
  for (const tpl of TEMPLATES) {
    const b = h('button', 'tpl');
    b.type = 'button';
    // a render of the template's scene (public/templates/), or an empty frame for the blank one
    b.innerHTML = tpl.id === 'blank'
      ? '<span class="art blank dots" aria-hidden="true"><span>+</span></span>'
      : `<img class="art" src="templates/${tpl.id}.webp" alt="" loading="lazy">`;
    b.append(h('span', 't', tpl.name), h('span', 'd', tpl.blurb));
    b.addEventListener('click', () => { app.useTemplate(tpl.id); start.close(); });
    tg.append(b);
  }

  const startDrop = $('#start-drop');
  const startStatus = $('#start-status');
  async function startWithFiles(files) {
    if (!files.length) return;
    startStatus.textContent = `Reading ${files.length} file${files.length > 1 ? 's' : ''}…`;
    const ok = await app.quickstartFromFiles(files);
    startStatus.textContent = '';
    if (ok) start.close();
  }
  $('#start-input').addEventListener('change', (e) => { startWithFiles([...e.target.files]); e.target.value = ''; });
  startDrop.addEventListener('dragover', (e) => { e.preventDefault(); startDrop.classList.add('over'); });
  startDrop.addEventListener('dragleave', () => startDrop.classList.remove('over'));
  startDrop.addEventListener('drop', (e) => { e.preventDefault(); startDrop.classList.remove('over'); startWithFiles([...e.dataTransfer.files]); });

  function openStart(offerContinue) {
    $('#start-foot').hidden = !offerContinue;
    start.showModal();
  }
  $('#continue-last').addEventListener('click', () => { app.restoreLast(); start.close(); });

  /* About sits exactly over the stage frame — same box, same corner marks —
     rather than a near-miss size beside it. */
  const about = $('#about-dialog');
  function fitAbout() {
    const r = $('#stage').getBoundingClientRect();
    Object.assign(about.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  $('#open-about').addEventListener('click', () => {
    $('#about-body').innerHTML = aboutHTML();
    fitAbout();
    about.showModal();
  });
  addEventListener('resize', () => { if (about.open) fitAbout(); });

  /* ---------------------------- shortcuts -------------------------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, [contenteditable]') || $('dialog[open]')) return;
    if (state.exporting) return;
    const k = e.key.toLowerCase();
    // Space presses a button reached by keyboard; after a click it's play/pause
    if (k === ' ' && e.target.matches?.('button:focus-visible')) return;
    if (k === ' ') { e.preventDefault(); app.togglePlay(); }
    else if (k === 'f') app.frame(state.selection ? [state.selection] : null);
    else if (k === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey) toggleUI();
    else if (k === 'escape') app.select(null);
    else if ((k === 'delete' || k === 'backspace') && state.selection) { e.preventDefault(); app.remove(state.selection); }
    else if (k === 'd' && (e.metaKey || e.ctrlKey) && state.selection) { e.preventDefault(); app.duplicate(state.selection); }
  });

  /* ---------------------------- subscribe -------------------------- */
  subscribe((tag) => {
    if (tag === 'devices' || tag === 'selection') {
      renderList(); renderInspector(); renderAssets(); renderTransport(); renderStageBar(); renderOverlay(); renderExportBtn();
    } else if (tag === 'assets') { renderAssets(); renderList(); renderInspector(); }
    else if (tag.startsWith('device:')) { refreshInspector(); if (state.selection === tag.slice(7)) renderOverlay(); }
    else if (tag === 'scene') { refreshInspector(); renderTransport(); renderStageBar(); }
    else if (tag === 'time' || tag === 'playing') renderTransport();
    else if (tag === 'exporting') { renderInspector(); renderTransport(); renderOverlay(); }

    if (state.prefs.tab === 'export' && (tag === 'devices' || tag === 'assets' || tag === 'scene' || tag === 'time' || tag === 'playing' || tag.startsWith('device:'))) {
      renderExportSummary();
    }
  });

  // first paint
  setTab(state.prefs.tab || 'scene');
  renderList(); renderAssets(); renderInspector(); renderTransport(); renderStageBar(); renderUIBtn(); syncExportUI(); renderExportBtn(); renderOverlay();

  return { openStart, showChip, toast, renderInspector, renderOverlay };
}

/* =========================== static content =========================== */

function aboutHTML() {
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
