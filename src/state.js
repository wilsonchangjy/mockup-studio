/* =====================================================================
   Store

   One mutable state object plus tagged change notifications. Views
   subscribe and re-render only what a tag concerns — e.g. a gizmo drag
   emits 'device:<id>' many times a second, which must not rebuild the
   whole inspector and steal focus from a field being typed into.

   Scene + devices persist to localStorage. Assets (the media files) live
   only in memory: localStorage holds ~5MB of strings, nowhere near video.
   ===================================================================== */

import { MOODS } from './lighting.js';

const KEY = 'mockup-studio.v2.scene';
const PREFS = 'mockup-studio.v2.prefs';

export const OUTPUTS = {
  '1920x1080': { w: 1920, h: 1080, label: '16:9 · 1920×1080' },
  '3840x2160': { w: 3840, h: 2160, label: '16:9 · 4K' },
  '1080x1080': { w: 1080, h: 1080, label: '1:1 · 1080×1080' },
  '1080x1350': { w: 1080, h: 1350, label: '4:5 · 1080×1350' },
  '1080x1920': { w: 1080, h: 1920, label: '9:16 · 1080×1920' },
};

export function defaultScene() {
  return {
    output: '1920x1080',
    fps: 30,
    duration: 8,
    // the default mood's setup: see lighting.js
    background: { color: '#d9dce0', ...MOODS.studio.background },
    ground: { mode: 'shadow', color: '#d9dce1', ...MOODS.studio.ground },
    light: { mood: 'studio', ...MOODS.studio.light, screen: 'none' },
    camera: { position: [0, 0.12, 0.62], target: [0, 0.02, 0], lens: 50 },
    motion: { preset: 'static', amount: 0.5, reverse: false },
  };
}

export const state = {
  scene: defaultScene(),
  devices: [],          // { id, model, name, position[m], rotation[deg], color, media, trim, rate, float }
  assets: [],           // { id, name, kind, width, height, duration, file, url, thumb } — memory only
  selection: null,      // device id, or null = scene settings
  time: 0,
  playing: false,
  exporting: false,
  prefs: { theme: 'system', tab: 'scene', ui: true },
};

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

let saveTimer = null;
export function commit(tag, mutate) {
  if (mutate) mutate(state);
  for (const fn of listeners) fn(tag);
  if (tag !== 'time' && tag !== 'playing') {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  }
}

let nextId = 1;
export const uid = (p) => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export const device = (id) => state.devices.find((d) => d.id === id) || null;
export const asset  = (id) => state.assets.find((a) => a.id === id) || null;
export const output = () => OUTPUTS[state.scene.output] || OUTPUTS['1920x1080'];

/* --------------------------- persistence --------------------------- */

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      scene: state.scene,
      // media can't survive a reload (memory only), so don't persist a dangling id
      devices: state.devices.map((d) => ({ ...d, media: null, second: d.second && { ...d.second, media: null } })),
      savedAt: Date.now(),
    }));
    localStorage.setItem(PREFS, JSON.stringify(state.prefs));
  } catch { /* private mode / quota — the app still works, it just won't remember */ }
}

export function savedScene() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return raw && raw.devices?.length ? raw : null;
  } catch { return null; }
}

export function loadPrefs() {
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem(PREFS) || '{}')); } catch {}
  // "Badges" became Show/Hide UI: keep an earlier choice
  if ('badges' in state.prefs) {
    if (state.prefs.badges === false) state.prefs.ui = false;
    delete state.prefs.badges;
  }
}

/** Deep-merge saved data onto defaults so older saves gain new fields. */
export function mergeScene(saved) {
  const base = defaultScene();
  const merge = (a, b) => {
    for (const k in b) {
      a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(a[k] ?? {}, b[k]) : b[k];
    }
    return a;
  };
  return migrateMotion(merge(base, saved || {}));
}

/* Camera motions since folded into others: push and pull are one dolly;
   orbit is a small turntable (devices turn, not the camera); the hero sweep
   was mostly a crane. */
function migrateMotion(scene) {
  const m = scene.motion;
  if (m.preset === 'push') Object.assign(m, { preset: 'dolly', reverse: false });
  else if (m.preset === 'pull') Object.assign(m, { preset: 'dolly', reverse: true });
  else if (m.preset === 'orbit') Object.assign(m, { preset: 'turntable', amount: m.amount * 0.1, reverse: true });
  else if (m.preset === 'hero') Object.assign(m, { preset: 'crane' });
  return scene;
}
