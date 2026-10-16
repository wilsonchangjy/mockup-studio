/* =====================================================================
   Mockup Studio — app wiring

   main.js owns the actions (what can happen); ui.js owns the panels
   (how it's presented); viewport.js owns the 3D scene. They communicate
   through the store's tagged commits, so each only reacts to what it
   cares about.
   ===================================================================== */

import './styles.css';
import * as THREE from 'three';
import { createViewport } from './viewport.js';
import { resolveMood } from './lighting.js';
import { createUI, toast } from './ui.js';
import { state, commit, subscribe, device as deviceById, asset as assetById, loadPrefs, savedScene, mergeScene } from './state.js';
import { MODELS, resolveModel, finishesFor, defaultColorFor, formOf, foldable, screenAspectOf } from './devices.js';
import { importFiles as importMedia, removeAsset as dropAsset, setPlaceholderStyle } from './media.js';
import { TEMPLATES, quickstart, newDevice } from './compose.js';
import { createQuick } from './quick.js';

loadPrefs();

/* Quick mode, the phone layout (src/quick.js): touch-only devices with a
   short side under 768px. Touch tablets get it too, unless the full editor
   was chosen from its Start screen. `?quick=1` / `?quick=0` force either. */
function wantsQuick() {
  const forced = new URLSearchParams(location.search).get('quick');
  if (forced === '1') return true;
  if (forced === '0') return false;
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (!touchOnly) return false;
  return Math.min(screen.width, screen.height) < 768 || state.prefs.editor !== 'full';
}
const QUICK = wantsQuick();
const TABLET = QUICK && Math.min(screen.width, screen.height) >= 768;

let ui = null, quick = null;
const host = document.getElementById('viewport-host');
const vp = createViewport(host, QUICK ? {
  onTap: (hit) => quick?.onTap(hit),
  onRender: () => quick?.onRender(),
  onFrame: (rect) => quick?.onFrame(rect),
  onSeek: (t) => app.seek(t),
  onPause: () => app.pause(),
  onModelError: (label) => toast(`Couldn't load the ${label} model. Check your connection and try again.`, 'err'),
} : {
  onSelect: (id) => app.select(id),
  onHover: (id, anchor, slot) => ui?.showChip(id, anchor, 'hover', slot),
  onRender: () => ui?.renderOverlay(),
  onSeek: (t) => app.seek(t),
  onPause: () => app.pause(),
  onModelError: (label) => toast(`Couldn't load the ${label} model. Check your connection and add it again.`, 'err'),
}, { quick: QUICK });

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function halfWidth(d) {
  const m = formOf(d.model, d.folded);
  if (m.family === 'laptop') return m.base.w / 2000;
  if (m.family === 'desktop') return m.panelW / 2000;
  const e = m.extent || m.body;   // a watch's band reaches past its case
  return (d.landscape ? e.h : e.w) / 2000;
}
function restingY(d) {
  const m = formOf(d.model, d.folded);
  if (m.family === 'laptop' || m.family === 'desktop') return 0;
  const e = m.extent || m.body;
  return (d.landscape ? e.w : e.h) / 2000;
}

/** Stand handhelds exactly on the floor once their models are in: sizes
    from the specs place them close, the model's own bounds exactly. Only
    upright devices that aren't floating — a phone laid flat is posed. */
function settle(ids) {
  vp.modelsReady().then(() => {
    for (const id of ids) {
      const d = deviceById(id), r = vp.runtime.get(id);
      const fam = d && MODELS[d.model].family;
      if (!r || d.float?.enabled || fam === 'laptop' || fam === 'desktop' || d.rotation[0] || d.rotation[2]) continue;
      vp.applyTime(0);
      const box = new THREE.Box3().expandByObject(r.root);
      d.position[1] = Math.round((d.position[1] - box.min.y) * 1e5) / 1e5;
      commit(`device:${id}`);
    }
    vp.applyTime(state.time);
  });
}

const app = {
  vp,
  quick: QUICK,
  tablet: TABLET,
  /** Quick mode adjusts every scene it's handed (output caps, its shape). */
  adapt: null,

  /* ------------------------------ selection ----------------------------- */
  select(id) {
    if (state.selection === id) return;
    commit('selection', (s) => { s.selection = id; });
  },

  frame(ids) { vp.frame(ids || null); },

  /* ------------------------------- playback ----------------------------- */
  seek(t) {
    state.time = clamp(t, 0, state.scene.duration);
    vp.seek(state.time);
    commit('time');
  },
  play() {
    if (state.exporting || !state.devices.length) return;
    commit('playing', (s) => { s.playing = true; });
  },
  pause() {
    if (!state.playing) return;
    state.playing = false;
    vp.setPlaying(false);
    commit('playing');
  },
  togglePlay() { state.playing ? app.pause() : app.play(); },

  /* ------------------------------ composition --------------------------- */
  applyComposition(comp) {
    app.adapt?.(comp);
    const { devices, scene, cameraDir, fill } = comp;
    app.pause();
    state.devices = devices;
    state.scene = scene;
    state.time = 0;
    state.selection = null;
    // aim the camera from the template's chosen direction, then frame to fit
    const dir = new THREE.Vector3(...(cameraDir || [0, 0.2, 1])).normalize();
    state.scene.camera.target = [0, 0.05, 0];
    state.scene.camera.position = dir.add(new THREE.Vector3(0, 0.05, 0)).toArray();
    vp.syncAll();
    vp.applySceneSettings();
    settle(devices.map((d) => d.id));
    if (devices.length) vp.frame(null, { fill });
    commit('devices');
    commit('scene');
    commit('selection');
    commit('time');
  },

  useTemplate(id, { quiet = false } = {}) {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return null;
    const comp = tpl.build();
    comp.scene.template = tpl.id;
    /* Hand media to the template's screens, in order: on desktop everything
       uploaded; in Quick mode what's on the screens now, since there's no
       library to fall back on. */
    const vids = QUICK
      ? state.devices.map((d) => d.media && assetById(d.media)).filter(Boolean)
      : state.assets.slice();
    comp.devices.forEach((d, i) => { if (vids[i]) app.autoOrient(d, vids[i]); if (vids[i]) d.media = vids[i].id; });
    app.applyComposition(comp);
    if (!quiet) toast(comp.devices.length ? `${tpl.name} — drop footage onto any screen to fill it.` : 'Blank scene — add a device from the Scene panel.');
    return tpl;
  },

  async quickstartFromFiles(files) {
    const { added, errors } = await app.importFiles(files);
    if (!added.length) return false;
    const comp = quickstart(added);
    app.applyComposition(comp);
    const lines = comp.notes.map((n) => `${n.asset} → ${n.model}`).join(' · ');
    toast(`Set up ${comp.devices.length} device${comp.devices.length > 1 ? 's' : ''}: ${lines}` +
      (comp.skipped ? ` (${comp.skipped} more in Assets)` : '') +
      (errors.length ? ` — skipped ${errors.length} unreadable file${errors.length > 1 ? 's' : ''}` : ''));
    return true;
  },

  restoreLast({ quiet = false } = {}) {
    const saved = savedScene();
    if (!saved) return;
    app.pause();
    state.scene = mergeScene(saved.scene);
    state.scene.light.mood = resolveMood(state.scene.light.mood) || state.scene.light.mood;
    // models since retired come back as their nearest replacement
    state.devices = saved.devices
      .map((d) => {
        const model = resolveModel(d.model);
        if (!model) return null;
        const d2 = { ...newDevice(model), ...d, model, media: null, second: { ...newDevice(model).second, ...d.second, media: null } };
        if (!foldable(model)) d2.folded = false;
        if (model !== d.model && !finishesFor(model).some(([, hex]) => hex === d.color)) d2.color = defaultColorFor(model);
        return d2;
      })
      .filter(Boolean);
    app.adapt?.({ scene: state.scene, devices: state.devices });
    state.selection = null;
    state.time = 0;
    vp.syncAll();
    vp.applySceneSettings();
    commit('devices'); commit('scene'); commit('selection');
    if (!quiet) toast('Scene restored. Media isn’t kept between visits — drop your footage back in.');
  },

  /* -------------------------------- devices ----------------------------- */
  addDevice(model) {
    const d = newDevice(model);
    let x = 0, z = 0;
    if (state.devices.length) {
      // beside the rightmost device, measured from the specs (models may still be loading)
      const right = Math.max(...state.devices.map((o) => o.position[0] + halfWidth(o)));
      x = right + 0.05 + halfWidth(d);
      z = state.devices.reduce((sum, o) => sum + o.position[2], 0) / state.devices.length;
    }
    d.position = [x, restingY(d), z];
    const first = !state.devices.length;
    state.devices.push(d);
    state.selection = d.id;
    commit('devices');
    commit('selection');
    settle([d.id]);
    if (first) vp.frame(); else toast(`${d.name} added — press F to frame everything.`);
  },

  duplicate(id) {
    const src = deviceById(id);
    if (!src) return;
    const copy = structuredClone(src);
    copy.id = newDevice(src.model).id;
    copy.position = [src.position[0] + halfWidth(src) * 2 + 0.03, src.position[1], src.position[2]];
    copy.float = { ...src.float, seed: (src.float?.seed || 0) + 1.37 };   // never in lockstep
    state.devices.push(copy);
    state.selection = copy.id;
    commit('devices');
    commit('selection');
  },

  remove(id) {
    const d = deviceById(id);
    if (!d) return;
    state.devices = state.devices.filter((x) => x.id !== id);
    if (state.selection === id) state.selection = null;
    commit('devices');
    commit('selection');
    toast(`Removed ${d.name}.`);
  },

  /** Put a device's lowest point on the floor. Measured at t=0, where float
      offsets are zero, so the result is the true resting pose. */
  sitOnGround(id) {
    const d = deviceById(id);
    const r = vp.runtime.get(id);
    if (!d || !r) return;
    vp.applyTime(0);
    const box = new THREE.Box3().expandByObject(r.root);
    vp.applyTime(state.time);
    d.position[1] = Math.round((d.position[1] - box.min.y) * 1e5) / 1e5;
    const wasFloating = d.float?.enabled;
    if (d.float) d.float.enabled = false;
    commit(`device:${id}`);
    if (wasFloating) { ui?.renderInspector(); toast('Float turned off so it stays on the ground.'); }
  },

  /* --------------------------------- media ------------------------------ */
  async importFiles(files) {
    const res = await importMedia(files);
    for (const e of res.errors) toast(e, 'err');
    if (res.reused.length) {
      const names = res.reused.map((a) => `“${a.name}”`).join(', ');
      const many = res.reused.length > 1;
      toast(QUICK   // no Assets panel on phones
        ? `${names} ${many ? 'were' : 'was'} added before — using ${many ? 'those' : 'that'} again.`
        : `${names} ${many ? 'are' : 'is'} already in Assets — using ${many ? 'those' : 'that'} instead of adding ${many ? 'copies' : 'a copy'}.`);
    }
    return res;
  },

  removeAsset(id) { dropAsset(id); },

  /** A handheld turns sideways when its footage's shape differs from its
      screen's (most screens are taller than wide; an open Fold8's isn't). */
  autoOrient(d, a) {
    if (QUICK) return;   // Quick mode keeps every template's layout: footage is cropped to fit instead
    const fam = MODELS[d.model].family;
    if ((fam === 'phone' || fam === 'tablet') && a) d.landscape = (a.width > a.height) !== (screenAspectOf(d.model, d.folded) > 1);
  },

  /** Change a device's shape — its model, form or orientation — keeping it
      on the floor if it stood there. */
  reshape(id, change, tag = `device:${id}`) {
    const d = deviceById(id), r = vp.runtime.get(id);
    if (!d) return;
    let onFloor = false;
    if (r && !d.float?.enabled) {
      vp.applyTime(0);
      onFloor = Math.abs(new THREE.Box3().expandByObject(r.root).min.y) < 0.003;
      vp.applyTime(state.time);
    }
    change(d);
    commit(tag);
    if (onFloor) settle([id]);
  },

  /** Open or close a foldable. Its two screens trade places: open, the
      inner screen faces front and the cover screen is on the back; closed,
      the cover screen faces front and the inner one is folded away. So
      their media swap — unless only the front has any, which stays in view.
      The front screen changes shape, so footage re-fits. */
  setFolded(id, folded) {
    const d = deviceById(id);
    if (!d || !foldable(d.model) || !!d.folded === folded) return;
    app.reshape(id, () => {
      d.folded = folded;
      const front = { media: d.media, trim: d.trim, rate: d.rate };
      if (d.second?.media) {
        Object.assign(d, { media: d.second.media, trim: d.second.trim, rate: d.second.rate });
        d.second = front;
      }
      const a = d.media ? assetById(d.media) : null;
      if (a) app.autoOrient(d, a);
    });
  },

  /** Put media on a device's screen: 'main', or 'second' — an open
      foldable's cover screen, on the back. */
  assign(deviceId, assetId, slot = 'main') {
    const d = deviceById(deviceId);
    if (!d) return;
    const a = assetId ? assetById(assetId) : null;
    if (slot === 'second') {
      const s = d.second || { trim: 0, rate: 1 };
      d.second = { ...s, media: a ? a.id : null, trim: a?.kind === 'video' && s.trim >= a.duration ? 0 : s.trim };
      commit('devices');
      return;
    }
    const wasLandscape = !!d.landscape;
    app.reshape(d.id, () => {
      d.media = a ? a.id : null;
      if (a) {
        app.autoOrient(d, a);
        if (a.kind === 'video' && d.trim >= a.duration) d.trim = 0;
      }
    }, 'devices');
    if (a && d.landscape !== wasLandscape) {
      toast(`Turned ${d.name} ${a.width > a.height ? 'landscape' : 'portrait'} to match the footage.`);
    }
  },

  pickReplacement(id, slot = 'main') {
    const input = document.getElementById('replace-input');
    input.onchange = async () => {
      const files = [...input.files];
      input.value = '';
      if (!files.length) return;
      const { added } = await app.importFiles(files);
      if (added[0]) app.assign(id, added[0].id, slot);
    };
    input.click();
  },
};

/* ------------------------------ reactions ------------------------------ */

subscribe((tag) => {
  if (tag === 'devices') vp.syncAll();
  else if (tag === 'selection') vp.setSelection(state.selection);
  else if (tag.startsWith('device:')) vp.syncDevice(tag.slice(7));
  else if (tag === 'scene') {
    if (state.time > state.scene.duration) state.time = 0;
    vp.applySceneSettings();
  }
});

/* --------------------------------- boot -------------------------------- */

vp.applySceneSettings();

if (QUICK) {
  setPlaceholderStyle('add');
  quick = createQuick(app);
} else {
  ui = createUI(app);
  bootDesktop();
}

/* Small windows get a notice first: the full editor needs a large screen, a
   precise pointer, and the memory to render and encode video. It's a notice,
   not a block — "Continue anyway" proceeds. (Phones get Quick mode instead;
   a touch tablet that chose the full editor has seen what it's choosing.) */
function bootDesktop() {
  const smallOrTouchOnly = state.prefs.editor !== 'full' && (
    matchMedia('(max-width: 899px)').matches ||
    (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches));
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('mockup-studio.desktop-ok') === '1'; } catch {}
  if (smallOrTouchOnly && !dismissed) {
    const notice = document.getElementById('desktop-only');
    notice.hidden = false;
    document.getElementById('desktop-continue').addEventListener('click', () => {
      try { sessionStorage.setItem('mockup-studio.desktop-ok', '1'); } catch {}
      notice.hidden = true;
      ui.openStart(!!savedScene());
    });
  } else {
    ui.openStart(!!savedScene());
  }
  // a touch tablet that chose the full editor can go back
  if (state.prefs.editor === 'full' && matchMedia('(pointer: coarse)').matches) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'text-btn';
    back.textContent = 'Quick mode';
    back.addEventListener('click', () => { state.prefs.editor = 'quick'; commit('prefs'); setTimeout(() => location.reload(), 350); });
    const about = document.getElementById('open-about');
    about.style.marginLeft = '16px';
    back.style.marginLeft = 'auto';
    about.before(back);
  }
}

// handy for debugging and for automated checks
window.MockupStudio = { state, app, vp };
