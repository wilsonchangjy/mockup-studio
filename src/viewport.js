/* =====================================================================
   Viewport — the three.js scene

   The camera is a fixed 50mm lens on a full-frame (36mm) sensor, applied
   to the long edge of the frame, so framing is consistent and free of
   wide-angle warping. Devices are real-size and never scaled; the camera's
   distance is the only "zoom".

   Rendering is on-demand: frames are drawn only while playing, while the
   orbit controls are settling, or after a change. An idle editor costs
   almost nothing, which matters on low-end machines.
   ===================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createEnvironments, MOODS, resolveMood } from './lighting.js';
import { buildDevice, disposeDevice, MODELS, loadModel, modelReady, setScreenGlare } from './devices.js';
import { ScreenFeed, setMaxAnisotropy } from './media.js';
import { ContactShadow, SHADOW_LAYER } from './contactShadow.js';
import { state, commit, device as deviceById, asset as assetById, output } from './state.js';

const deg = THREE.MathUtils.degToRad;
const rad2deg = THREE.MathUtils.radToDeg;

/* Layered sines: smooth, deterministic, never visibly repeating. Offset by
   noise(0) so every motion is exactly zero at t=0 — the pose you edit is the
   pose the timeline starts from. */
const noise = (t, s) =>
  Math.sin(t + s * 1.7) * 0.62 + Math.sin(t * 1.734 + s * 3.11) * 0.28 + Math.sin(t * 2.613 + s * 5.37) * 0.1;
const wobble = (t, s) => noise(t, s) - noise(0, s);
const smooth = (u) => u * u * (3 - 2 * u);

const SHADOW_MAP = 2048;

/** `quick`: Quick mode, the touch layout. The render fills the stage and the
    export frame is a rectangle inside it (see resize), taps replace clicks,
    and nothing hovers. */
export function createViewport(host, hooks = {}, { quick = false } = {}) {
  /* ---------------------------- renderer ---------------------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;   // keeps device finishes true to colour
  /* The key light's shadow map only lets devices shade each other. Shadows on
     the floor are contact shadows (contactShadow.js), which soften cleanly. */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'gl';
  host.appendChild(renderer.domElement);
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  setMaxAnisotropy(maxAnisotropy);

  const scene = new THREE.Scene();
  // see lighting.js; a panorama that arrives later relights the scene
  const environments = createEnvironments(renderer, () => applyLight());

  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 60);
  camera.filmGauge = 36;

  /* ------------------------------ lights ----------------------------- */
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  key.shadow.bias = -0.0005;
  key.shadow.radius = 2;
  scene.add(key, key.target);
  // a light from behind, opposite the key, for moods that outline edges
  const rim = new THREE.DirectionalLight(0xffffff, 0);
  scene.add(rim, rim.target);

  /* ------------------------------ ground ----------------------------- */
  const groundGeo = new THREE.PlaneGeometry(40, 40);
  groundGeo.rotateX(-Math.PI / 2);
  const solidFloor = new THREE.MeshStandardMaterial({ color: 0xd9dce1, roughness: 0.9, metalness: 0 });
  const ground = new THREE.Mesh(groundGeo, solidFloor);   // the visible floor, when there is one
  scene.add(ground);

  const contact = new ContactShadow(renderer);
  scene.add(contact.plane);

  /* ----------------------------- controls ---------------------------- */
  const canvas = renderer.domElement;
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.minDistance = 0.08;
  orbit.maxDistance = 12;
  orbit.maxPolarAngle = Math.PI * 0.499;     // never dip below the floor
  orbit.screenSpacePanning = true;

  /* Move and rotate handles shown together, as in Maya or Spline. three.js's
     TransformControls does one mode at a time, so two run on the same device:
     arrows (world space) inside, rotation rings (local space) outside. The
     rotate gizmo's free-rotate sphere and screen ring are removed — they sit
     over the arrows — and where the two still overlap the arrows win. */
  const move = new TransformControls(camera, canvas);
  move.setMode('translate');
  move.setSpace('world');
  move.setSize(0.8);
  const turn = new TransformControls(camera, canvas);
  turn.setMode('rotate');
  turn.setSpace('local');
  turn.setSize(1.3);
  for (const group of [turn._gizmo.picker.rotate, turn._gizmo.gizmo.rotate]) {
    for (const handle of [...group.children]) {
      if (handle.name === 'E' || handle.name === 'XYZE') group.remove(handle);
    }
  }
  const gizmos = [move, turn];
  const helpers = gizmos.map((g) => g.getHelper());
  scene.add(...helpers);
  const onHandle = () => gizmos.some((g) => g.axis !== null);
  const dragging = () => gizmos.some((g) => g.dragging);

  /* ------------------------------ state ------------------------------ */
  const runtime = new Map();   // device id -> { root, orient, built, feed, feed2, model, folded }
  let dirty = true;
  let exporting = false;
  let hovered = null, hoveredSlot = null;
  const requestRender = () => { dirty = true; };

  // glossy screens mirror the environment closely, so they get the 2K panorama; phones keep to 1K
  const envSize = () => (!quick && state.scene.light.screen === 'glossy' ? '2k' : '1k');

  /* ---------------------------- background --------------------------- */
  let bgTex = null;
  function applyBackground() {
    const bg = state.scene.background;
    bgTex?.dispose(); bgTex = null;
    if (bg.mode === 'gradient') {
      const c = document.createElement('canvas');
      c.width = 4; c.height = 256;
      const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, bg.top); gr.addColorStop(1, bg.bottom);
      g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
      bgTex = new THREE.CanvasTexture(c);
      bgTex.colorSpace = THREE.SRGBColorSpace;
      scene.background = bgTex;
    } else {
      scene.background = new THREE.Color(bg.color);
    }
    requestRender();
  }

  function applyGround() {
    const g = state.scene.ground;
    ground.visible = g.mode === 'solid';   // the contact shadow decides its own, each frame (updateContact)
    solidFloor.color.set(g.color);
    requestRender();
  }

  function applyLight() {
    const l = state.scene.light;
    const id = resolveMood(l.mood) || 'studio';
    const mood = MOODS[id];
    // glossy screens mirror the environment closely: they get the 2K panorama
    const env = environments.get(id, envSize());
    scene.environment = env.texture;
    // the environment's main light follows the Direction slider, where the key light is
    scene.environmentRotation.y = deg(l.angle - env.azimuth);
    scene.environmentIntensity = l.env * env.exposure;
    key.intensity = l.key;
    key.color.set(l.color || mood.light.color);
    rim.intensity = mood.rim * (l.key / mood.light.key);
    for (const r of runtime.values()) for (const m of screensOf(r)) setScreenGlare(m, l.screen);
    fitShadow();
    requestRender();
  }

  /* Fit the shadow camera to whatever is in the scene, so shadow texels stay
     dense whether it's one phone or an iMac setup. */
  function fitShadow() {
    const box = new THREE.Box3();
    for (const r of runtime.values()) box.expandByObject(r.root);
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(0.3, 0.3, 0.3));
    const c = box.getCenter(new THREE.Vector3());
    // generous margin: a blurred shadow spreads beyond its caster
    const radius = Math.max(0.15, box.getSize(new THREE.Vector3()).length() * 0.85);
    const l = state.scene.light;
    const a = deg(l.angle), el = deg(l.elevation ?? 56);
    const reach = radius * 3.6;
    key.position.set(c.x + Math.sin(a) * Math.cos(el) * reach, c.y + Math.sin(el) * reach, c.z + Math.cos(a) * Math.cos(el) * reach);
    key.target.position.copy(c);
    const ra = a + Math.PI, rel = deg(20);
    rim.position.set(c.x + Math.sin(ra) * Math.cos(rel) * reach, c.y + Math.sin(rel) * reach, c.z + Math.cos(ra) * Math.cos(rel) * reach);
    rim.target.position.copy(c);
    // the light sits 3.6r from the centre; keep the depth range snug around the scene
    const cam = key.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = radius * 1.8; cam.far = radius * 5.4;
    cam.updateProjectionMatrix();
  }

  /* Contact shadow covering every device. Softness is in world units (3mm to
     12cm of blur), so a setting looks the same for a lone phone and a desk. */
  const _box = new THREE.Box3(), _size = new THREE.Vector3(), _ctr = new THREE.Vector3();
  function updateContact() {
    /* Decided afresh every frame: shown when the ground has shadows and
       there's something to cast them. (Hiding it for an empty frame and
       leaving it to applyGround to bring back lost the shadows whenever a
       frame was drawn before the first model arrived.) */
    contact.plane.visible = false;
    if (state.scene.ground.mode === 'none') return;
    scene.updateMatrixWorld(true);
    _box.makeEmpty();
    for (const r of runtime.values()) _box.expandByObject(r.root);
    if (_box.isEmpty()) return;
    contact.plane.visible = true;
    _box.getSize(_size);
    _box.getCenter(_ctr);
    const g = state.scene.ground;
    const s = g.softness ?? 0.4;
    const blur = 0.003 + s * s * 0.12;
    // shadows fall away from the key light, a little shorter than strictly physical
    const dir = key.position.clone().sub(key.target.position).normalize();
    const lean = 0.6;
    let shear = [(dir.x / dir.y) * lean, (dir.z / dir.y) * lean];
    // a low sun would stretch shadows off across the floor: keep them in reach
    const len = Math.hypot(...shear);
    if (len > 1.2) shear = shear.map((v) => (v / len) * 1.2);
    const height = _box.max.y * 1.02 + 0.01;
    const reach = height * Math.hypot(shear[0], shear[1]);
    const half = Math.max(_size.x, _size.z) / 2 + reach + blur * 1.5 + 0.05;
    contact.update(scene, { center: _ctr, half, height, shear, blur, opacity: g.shadow });
  }

  /** Render one frame: refresh the contact shadow, then the scene. */
  function renderScene() {
    updateContact();
    renderer.render(scene, camera);
  }

  /* ------------------------------ devices ---------------------------- */
  // a note in the corner while models download
  const loadingNote = document.createElement('div');
  loadingNote.className = 'stage-note';
  loadingNote.hidden = true;
  host.appendChild(loadingNote);
  const loading = new Map();   // model and form → label
  function showLoading() {
    loadingNote.hidden = !loading.size;
    loadingNote.textContent = loading.size === 1 ? `Loading ${[...loading.values()][0]}…` : `Loading ${loading.size} models…`;
  }

  /** Start fetching a model in one of its forms; devices using it appear when it arrives. */
  function requestModel(modelId, folded = false) {
    const key = `${modelId}:${folded}`;
    if (modelReady(modelId, folded) || loading.has(key)) return;
    loading.set(key, MODELS[modelId].label);
    showLoading();
    loadModel(modelId, folded).then((ok) => {
      loading.delete(key);
      showLoading();
      if (!ok) { hooks.onModelError?.(MODELS[modelId].label); return; }
      for (const d of state.devices) if (d.model === modelId) syncDevice(d.id);
      setSelection(state.selection);
      fitShadow();
      requestRender();
    });
  }

  /* A device's screens and their feeds: 'main', and an open foldable's
     cover screen, the 'second'. */
  const screensOf = (r) => [...r.built.screenParts, ...r.built.coverParts];
  const feedsOf = (r) => (r.feed2 ? [r.feed, r.feed2] : [r.feed]);

  function build(d) {
    const built = buildDevice(d.model, d.color, !!d.folded);
    built.root.traverse((o) => {
      if (!o.isMesh) return;
      o.layers.enable(SHADOW_LAYER);
      // fine patterns (speaker holes, brushed metal) stay sharp at grazing angles
      for (const t of [o.material.map, o.material.normalMap]) {
        if (t && t.anisotropy !== maxAnisotropy) { t.anisotropy = maxAnisotropy; t.needsUpdate = true; }
      }
    });
    const root = new THREE.Group();
    root.userData.deviceId = d.id;
    root.rotation.order = 'YXZ';
    const orient = new THREE.Group();
    orient.add(built.root);
    root.add(orient);
    scene.add(root);
    const feed = new ScreenFeed(built.screen, built.screenAspect, requestRender);
    // an open foldable's cover screen shows the device's second media
    const feed2 = built.cover ? new ScreenFeed(built.cover, built.coverAspect, requestRender, { back: true }) : null;
    const r = { root, orient, built, feed, feed2, model: d.model, folded: !!d.folded };
    runtime.set(d.id, r);
    return r;
  }

  /** Resolves once every device in the scene is built, and the mood's
      environment has loaded. Exports and framing wait for this. */
  async function modelsReady() {
    const mood = resolveMood(state.scene.light.mood) || 'studio';
    const size = envSize();
    const env = environments.ready(mood, size).then(() => applyLight());
    const forms = [...new Map(state.devices.map((d) => [`${d.model}:${!!d.folded}`, [d.model, !!d.folded]])).values()];
    forms.forEach(([m, f]) => requestModel(m, f));
    await Promise.all([...forms.map(([m, f]) => loadModel(m, f)), env]);
    for (const d of state.devices) if (!current(d)) syncDevice(d.id);
  }
  /** Is the device on stage the one its state describes? */
  function current(d) {
    const r = runtime.get(d.id);
    return !!r && r.model === d.model && r.folded === !!d.folded;
  }

  function destroy(id) {
    const r = runtime.get(id);
    if (!r) return;
    for (const g of gizmos) if (g.object === r.root) g.detach();
    for (const f of feedsOf(r)) f.dispose();
    disposeDevice(r.built);
    scene.remove(r.root);
    runtime.delete(id);
  }

  /** Push one device's state into its 3D object (rebuilding on a change of
      model, or of a foldable's form). */
  function syncDevice(id) {
    const d = deviceById(id);
    if (!d) { destroy(id); return; }
    let r = runtime.get(id);
    const folded = !!d.folded;
    if (r && (r.model !== d.model || r.folded !== folded)) {
      // the old model (or form) stays on stage until its replacement has loaded
      if (!modelReady(d.model, folded)) { requestModel(d.model, folded); return; }
      destroy(id); r = null;
    }
    if (!r) {
      if (!modelReady(d.model, folded)) { requestModel(d.model, folded); return; }
      r = build(d);
    }

    r.built.setColor(d.color);
    for (const m of screensOf(r)) setScreenGlare(m, state.scene.light.screen);
    const hinge = MODELS[d.model].hinge;
    if (hinge) r.built.setHinge?.(d.hinge ?? hinge.rest);
    const fold = MODELS[d.model].fold;
    if (fold) r.built.setFold?.(d.foldAngle ?? fold.rest);   // open only: the closed model has no fold
    const family = MODELS[d.model].family;
    const landscape = !!d.landscape && (family === 'phone' || family === 'tablet');
    r.orient.rotation.z = landscape ? Math.PI / 2 : 0;
    r.feed.setOrientation(landscape);
    r.feed.trim = d.trim || 0;
    r.feed.rate = d.rate || 1;
    r.feed.setAsset(d.media ? assetById(d.media) : null);
    if (r.feed2) {
      r.feed2.setOrientation(landscape);
      r.feed2.trim = d.second?.trim || 0;
      r.feed2.rate = d.second?.rate || 1;
      r.feed2.setAsset(d.second?.media ? assetById(d.second.media) : null);
    }
    poseDevice(d, r, state.time);
    if (state.selection === id && move.object !== r.root) attach(r.root);
    requestRender();
  }

  function syncAll() {
    const ids = new Set(state.devices.map((d) => d.id));
    for (const id of [...runtime.keys()]) if (!ids.has(id)) destroy(id);
    for (const d of state.devices) syncDevice(d.id);
    setSelection(state.selection);
    fitShadow();
    requestRender();
  }

  /* ---------------------------- time / motion ------------------------ */
  function floatOffset(d, t) {
    if (!d.float?.enabled) return null;
    const a = d.float.amount ?? 0.5, s = d.float.seed ?? 0, k = t * 0.55;
    return {
      y: a * 0.009 * wobble(k, s + 3),
      x: a * 0.004 * wobble(k * 0.7, s + 11),
      rx: a * 3.5 * wobble(k * 0.8, s + 31),
      ry: a * 4.5 * wobble(k * 0.6, s + 43),
      rz: a * 1.8 * wobble(k * 0.7, s + 57),
    };
  }

  /* Turntable: the whole arrangement turns about the camera's target, at a
     constant speed (a full turn at amount 1 loops seamlessly), while camera
     and lights stay put — as on a real motorised turntable. Clockwise seen
     from above, or anticlockwise reversed. */
  const spinAt = (t) => {
    const m = state.scene.motion;
    if (m.preset !== 'turntable') return 0;
    const turn = m.amount * 360 * Math.min(1, Math.max(0, t / Math.max(0.01, state.scene.duration)));
    return deg(m.reverse ? turn : -turn);
  };
  const _pivot = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function spinAbout(v, angle) {
    _pivot.fromArray(state.scene.camera.target).setY(0);
    return v.sub(_pivot).applyAxisAngle(_up, angle).add(_pivot);
  }

  function poseDevice(d, r, t) {
    const o = floatOffset(d, t);
    const spin = spinAt(t);
    r.root.position.set(d.position[0] + (o?.x || 0), d.position[1] + (o?.y || 0), d.position[2]);
    if (spin) spinAbout(r.root.position, spin);
    r.root.rotation.set(
      deg(d.rotation[0] + (o?.rx || 0)), deg(d.rotation[1] + (o?.ry || 0)) + spin, deg(d.rotation[2] + (o?.rz || 0)), 'YXZ');
  }

  const basePos = new THREE.Vector3(), baseTgt = new THREE.Vector3();
  function cameraAt(t) {
    const c = state.scene.camera, m = state.scene.motion;
    basePos.fromArray(c.position);
    baseTgt.fromArray(c.target);
    const u = Math.min(1, Math.max(0, t / Math.max(0.01, state.scene.duration)));
    const e = smooth(u), a = m.amount;
    const off = basePos.clone().sub(baseTgt);
    const dist = off.length();
    const pos = basePos.clone();
    const tgt = baseTgt.clone();
    // every move starts from the pose you framed (t = 0); reverse flips its direction
    const dir = m.reverse ? -1 : 1;
    if (m.preset === 'dolly') {                // push in, or pull back from a close start
      pos.copy(baseTgt).add(off.multiplyScalar(m.reverse ? 1 + a * 0.6 * e : 1 - a * 0.32 * e));
    } else if (m.preset === 'slide') {         // slider: sideways, parallel to the frame, for parallax
      const right = new THREE.Vector3().crossVectors(_up, off).normalize();
      const shift = right.multiplyScalar(dir * dist * 0.3 * a * e);
      pos.add(shift); tgt.add(shift);
    } else if (m.preset === 'crane') {         // pedestal up
      pos.y += dist * 0.3 * a * e;
    } else if (m.preset === 'drift') {         // handheld: grows faster than linear, so 1 is plainly handheld
      const k = dist * a * (0.6 + 1.4 * a);
      pos.x += k * 0.05 * wobble(t * 0.35, 2);
      pos.y += k * 0.03 * wobble(t * 0.3, 7);
      pos.z += k * 0.02 * wobble(t * 0.25, 13);
      tgt.x += k * 0.012 * wobble(t * 0.4, 19);   // the aim wanders a little too
      tgt.y += k * 0.008 * wobble(t * 0.45, 23);
    }
    return { pos, tgt };
  }

  /** Place everything for composition time t. Pure function of t and state. */
  function applyTime(t) {
    for (const d of state.devices) {
      const r = runtime.get(d.id);
      if (r) poseDevice(d, r, t);
    }
    const { pos, tgt } = cameraAt(t);
    camera.position.copy(pos);
    orbit.target.copy(tgt);
    camera.lookAt(tgt);
    requestRender();
  }

  /* --------------------------- camera framing ------------------------ */
  function setLens() {
    camera.setFocalLength(state.scene.camera.lens || 50);
  }

  const cameraMoves = () => state.scene.motion.preset !== 'static';

  orbit.addEventListener('start', () => {
    if (onHandle()) return;                      // a press on a gizmo handle isn't a camera move
    setCursor('grabbing');
    // a moving camera is edited at its starting pose, not mid-move
    if (cameraMoves() && state.time !== 0) hooks.onSeek?.(0);
    if (state.playing) hooks.onPause?.();
  });
  orbit.addEventListener('end', () => setCursor('grab'));
  orbit.addEventListener('change', () => {
    if (!cameraMoves() || state.time === 0) {
      state.scene.camera.position = camera.position.toArray();
      state.scene.camera.target = orbit.target.toArray();
      commit('camera');
    }
    requestRender();
  });

  /** Frame the given devices (default: all) at the fixed lens. */
  /** Frame devices (default: all). `fill`: how much of the frame they may
      take, 0.9 leaving ~10% breathing room; templates can ask for more room. */
  function frame(ids, { fill = 0.9, waited = false } = {}) {
    // devices still loading would be left out of the fit: wait for them (once — a model can fail)
    const wanted = ids?.length ? ids : state.devices.map((d) => d.id);
    if (!waited && wanted.some((id) => deviceById(id) && !current(deviceById(id)))) { modelsReady().then(() => frame(ids, { fill, waited: true })); return; }
    const list = ids?.length ? ids : [...runtime.keys()];
    /* Box3.expandByObject refreshes an object's own matrix but not its parents',
       so measuring a device's inner group straight after moving it (no render
       in between) would read its old position. Refresh the whole tree first. */
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const id of list) { const r = runtime.get(id); if (r) box.expandByObject(r.built.root); }
    if (box.isEmpty()) return;

    /* Exact fit: for each corner of the bounding box, find the camera distance
       at which it just touches the frame edge, against both the horizontal and
       vertical field of view. A bounding sphere is far too loose for a wide,
       low arrangement like a desk setup. */
    const center = box.getCenter(new THREE.Vector3());
    const back = camera.position.clone().sub(orbit.target);
    if (back.lengthSq() < 1e-8) back.set(0, 0.25, 1);
    back.normalize();                                         // target → camera
    const worldUp = Math.abs(back.y) > 0.98 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right).normalize();

    const margin = fill;
    const tv = Math.tan(deg(camera.fov) / 2) * margin;
    const th = tv * camera.aspect;
    let dist = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      const toward = p.dot(back);                             // how far this corner sits toward the camera
      dist = Math.max(dist, toward + Math.abs(p.dot(right)) / th, toward + Math.abs(p.dot(up)) / tv);
    }
    dist = Math.max(dist, 0.12);
    state.scene.camera.target = center.toArray();
    state.scene.camera.position = center.clone().add(back.multiplyScalar(dist)).toArray();
    commit('camera');
    applyTime(state.time);
  }

  /* --------------------------- selection / gizmo --------------------- */
  function attach(obj) { for (const g of gizmos) g.attach(obj); }

  function setSelection(id) {
    const r = id ? runtime.get(id) : null;
    if (r) attach(r.root); else for (const g of gizmos) g.detach();
    requestRender();
  }

  for (const g of gizmos) {
    g.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !dragging();
      if (e.value && state.playing) hooks.onPause?.();
      if (!e.value) { fitShadow(); requestRender(); }
    });

    // write the dragged pose back to state, net of any float offset at this t
    g.addEventListener('objectChange', () => {
      const obj = g.object;
      const d = obj && deviceById(obj.userData.deviceId);
      if (!d) return;
      const o = floatOffset(d, state.time);
      // net of the turntable's turn at this t, too
      const spin = spinAt(state.time);
      const p = spinAbout(obj.position.clone(), -spin);
      d.position = [p.x - (o?.x || 0), p.y - (o?.y || 0), p.z];
      const e = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YXZ');
      d.rotation = [rad2deg(e.x) - (o?.rx || 0), rad2deg(e.y - spin) - (o?.ry || 0), rad2deg(e.z) - (o?.rz || 0)];
      commit(`device:${d.id}`);
      requestRender();
    });
    g.addEventListener('change', requestRender);
  }

  /* ------------------------------ picking ---------------------------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...runtime.values()].map((r) => r.root), true);
    const owner = (o) => { while (o && !o.userData.deviceId) o = o.parent; return o?.userData.deviceId; };
    const first = hits.find((h) => owner(h.object));
    if (!first) return null;
    const id = owner(first.object);
    // detailed models lay thin cover glass over the display: a screen hit
    // within a few millimetres of the first surface still counts
    const hit = hits.find((h) => h.object.userData.screen && h.distance - first.distance < 0.004 && owner(h.object) === id);
    // slot: which screen — 'main', or 'second' (an open foldable's cover screen); null off-screen
    return { id, screen: !!hit, slot: hit ? (hit.object.userData.screen === 'cover' ? 'second' : 'main') : null };
  }

  /** CSS-pixel position (relative to the host) of a device's screen centre. */
  function screenAnchor(id, slot = 'main') {
    const r = runtime.get(id);
    if (!r) return null;
    // the middle of the display (all its parts), wherever its meshes' own origins are
    const parts = slot === 'second' && r.built.coverParts.length ? r.built.coverParts : r.built.screenParts;
    const box = new THREE.Box3();
    for (const m of parts) box.expandByObject(m);
    const p = box.getCenter(new THREE.Vector3());
    p.project(camera);
    if (p.z > 1) return null;
    const rect = canvas.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      x: rect.left - hostRect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top - hostRect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  /* ----------------------------- overlays ---------------------------- */
  /* Where things are on screen, for the labels drawn over the render: the
     selection outline, number badges, the drop box. Rectangles are in CSS
     pixels relative to the host, from the last frame drawn. */
  const _corner = new THREE.Vector3();
  function projectRect(meshes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of meshes) {
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const { min, max } = g.boundingBox;
      for (let i = 0; i < 8; i++) {
        _corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z)
          .applyMatrix4(m.matrixWorld).project(camera);
        if (_corner.z > 1) continue;   // behind the camera
        x0 = Math.min(x0, _corner.x); x1 = Math.max(x1, _corner.x);
        y0 = Math.min(y0, _corner.y); y1 = Math.max(y1, _corner.y);
      }
    }
    if (x0 > x1) return null;
    const c = canvasRect();
    const left = c.x + ((x0 + 1) / 2) * c.w, right = c.x + ((x1 + 1) / 2) * c.w;
    const top = c.y + ((1 - y1) / 2) * c.h, bottom = c.y + ((1 - y0) / 2) * c.h;
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  /** The render's own rectangle within the host. */
  function canvasRect() {
    const rect = canvas.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
    return { x: rect.left - hostRect.left, y: rect.top - hostRect.top, w: rect.width, h: rect.height };
  }
  /** A device's on-screen rectangle, or null until its model is in. */
  function deviceRect(id) {
    const r = runtime.get(id);
    if (!r) return null;
    if (!r.meshes) { r.meshes = []; r.built.root.traverse((o) => { if (o.isMesh) r.meshes.push(o); }); }
    return projectRect(r.meshes);
  }
  /** One of a device's screens: 'main', or an open foldable's cover, 'second'. */
  function screenRect(id, slot = 'main') {
    const r = runtime.get(id);
    if (!r) return null;
    return projectRect(slot === 'second' && r.built.coverParts.length ? r.built.coverParts : r.built.screenParts);
  }

  /* Cursors: grab over empty space (dragging there orbits the view),
     pointer over a device, move over a gizmo handle. */
  function setCursor(c) { if (canvas.style.cursor !== c) canvas.style.cursor = c; }
  setCursor('grab');

  /* Decide which gizmo owns a press at the moment it happens. Arbitrating on
     hover alone isn't enough: a press can arrive with no pointer move before
     it (a tap, or the cursor jumping straight onto a handle), and then both
     gizmos grab the same drag. A capture-phase listener on the canvas runs
     before the gizmos' own handlers. */
  canvas.addEventListener('pointerdown', (e) => {
    if (dragging()) return;
    move.pointerHover(move._getPointer(e));
    turn.enabled = move.axis === null;
    if (move.axis !== null) turn.axis = null;
  }, { capture: true });
  canvas.addEventListener('pointerup', () => { if (!dragging()) turn.enabled = true; });

  let down = null;
  // Quick mode: a tap is one finger, moving under 8px, lifted within 300ms
  const touching = new Set();
  let multi = false;
  canvas.addEventListener('pointerdown', (e) => {
    touching.add(e.pointerId);
    if (touching.size > 1) multi = true;
    down = onHandle() ? null : { x: e.clientX, y: e.clientY, t: performance.now() };   // a press on a handle isn't a click
  });
  canvas.addEventListener('pointercancel', (e) => { touching.delete(e.pointerId); down = null; });
  canvas.addEventListener('pointerup', (e) => {
    touching.delete(e.pointerId);
    const wasMulti = multi;
    if (!touching.size) multi = false;
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const held = performance.now() - down.t;
    down = null;
    if (quick) {
      if (!wasMulti && moved < 8 && held < 300) hooks.onTap?.(pick(e.clientX, e.clientY));
      return;
    }
    if (moved > 4 || dragging()) return;
    const hit = pick(e.clientX, e.clientY);
    hooks.onSelect?.(hit ? hit.id : null);
    setCursor(hit ? 'pointer' : 'grab');
  });
  // registered after both gizmos, so it runs after they've updated their hover state
  canvas.addEventListener('pointermove', (e) => {
    if (quick) return;   // nothing hovers on touch
    if (!dragging()) {
      // where arrows and rings overlap, the arrows win
      turn.enabled = move.axis === null;
      if (move.axis !== null) turn.axis = null;
    }
    if (dragging() || e.buttons) { setHover(null); return; }
    const handle = onHandle();
    const hit = handle ? null : pick(e.clientX, e.clientY);
    setCursor(handle ? 'move' : hit ? 'pointer' : 'grab');
    setHover(hit && hit.screen ? hit.id : null, hit?.slot);
  });
  canvas.addEventListener('pointerleave', (e) => {
    // leaving onto the hover chip itself shouldn't dismiss it
    if (!e.relatedTarget?.closest?.('.screen-chip')) setHover(null);
  });

  function setHover(id, slot = 'main') {
    if (hovered === id && hoveredSlot === slot) return;
    hovered = id; hoveredSlot = slot;
    hooks.onHover?.(id, id ? screenAnchor(id, slot) : null, slot);
  }

  /* ------------------------------ sizing ----------------------------- */
  /* Quick mode: the render fills the stage, and the export frame — the
     largest output-shaped rectangle inside the stage less `frameInsets` — is
     a window onto it. The camera's view offset makes the frame exactly what
     exports, and the rest of the stage the view around it. */
  let frameInsets = { top: 16, right: 16, bottom: 72, left: 16 };
  let frameRect = null;
  function setFrameInsets(ins) {
    frameInsets = { ...frameInsets, ...ins };
    resize();
  }
  function resizeQuick(aspect) {
    const W = Math.max(50, host.clientWidth), H = Math.max(50, host.clientHeight);
    const { top, right, bottom, left } = frameInsets;
    const aw = Math.max(20, W - left - right), ah = Math.max(20, H - top - bottom);
    let fw = aw, fh = aw / aspect;
    if (fh > ah) { fh = ah; fw = ah * aspect; }
    frameRect = { x: left + (aw - fw) / 2, y: top + (ah - fh) / 2, w: fw, h: fh };
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    Object.assign(canvas.style, { left: '0px', top: '0px' });
    camera.aspect = aspect;
    setLens();
    camera.setViewOffset(fw, fh, -frameRect.x, -frameRect.y, W, H);
    camera.updateProjectionMatrix();
    hooks.onFrame?.(frameRect);
    requestRender();
  }
  function resize() {
    if (exporting) return;
    const o = output();
    const aspect = o.w / o.h;
    if (quick) return resizeQuick(aspect);
    // room above the frame for the labels drawn over it
    const padX = 28, padY = 40;
    const W = Math.max(50, host.clientWidth - padX * 2);
    const H = Math.max(50, host.clientHeight - padY * 2);
    let w = W, h = W / aspect;
    if (h > H) { h = H; w = H * aspect; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(Math.round(w), Math.round(h));
    camera.aspect = aspect;
    setLens();
    camera.updateProjectionMatrix();
    hooks.onResize?.({ w: Math.round(w), h: Math.round(h), scale: w / o.w });
    requestRender();
  }
  new ResizeObserver(resize).observe(host);

  /* ------------------------------- loop ------------------------------ */
  let last = performance.now();
  function frameTick(now) {
    requestAnimationFrame(frameTick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (exporting) return;

    if (state.playing) {
      state.time = (state.time + dt) % Math.max(0.1, state.scene.duration);
      applyTime(state.time);
      for (const r of runtime.values()) for (const f of feedsOf(r)) f.sync(state.time, true);
      commit('time');
    }
    if (orbit.update()) dirty = true;
    if (dirty) renderNow();
  }

  function renderNow() {
    renderScene();
    dirty = false;
    if (hovered) hooks.onHover?.(hovered, screenAnchor(hovered, hoveredSlot), hoveredSlot);
    hooks.onRender?.();
  }
  requestAnimationFrame(frameTick);

  /** Scrub to t: pose everything and seek every feed to its exact frame. */
  function seek(t) {
    applyTime(t);
    for (const r of runtime.values()) for (const f of feedsOf(r)) f.sync(t, false);
  }

  function setPlaying(on) {
    if (!on) for (const r of runtime.values()) for (const f of feedsOf(r)) f.sync(state.time, false);
  }

  /* ------------------------------ export ----------------------------- */
  let saved = null;
  /** Switch into a fixed-size, chrome-free render for export. `supersample`
      renders at a multiple of the output size; the exporter scales it down. */
  function beginExport({ width, height, transparent, supersample = 1 }) {
    exporting = true;
    if (quick) {
      // render exactly the frame, and show it where the frame is while it does
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      if (frameRect) Object.assign(canvas.style, { left: `${frameRect.x}px`, top: `${frameRect.y}px`, width: `${frameRect.w}px`, height: `${frameRect.h}px` });
    }
    saved = {
      pr: renderer.getPixelRatio(),
      size: renderer.getSize(new THREE.Vector2()),
      bg: scene.background,
      groundVis: ground.visible,
      helpersVis: helpers.map((h) => h.visible),   // hidden already when nothing is selected
    };
    for (const h of helpers) h.visible = false;
    setHover(null);
    renderer.setPixelRatio(supersample);
    renderer.setSize(width, height, false);   // keep the on-screen CSS size
    if (transparent) {
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
      ground.visible = false;          // shadows remain, as soft partial alpha
    }
  }

  function endExport() {
    if (!saved) return;
    scene.background = saved.bg;
    ground.visible = saved.groundVis;
    renderer.setPixelRatio(saved.pr);
    renderer.setSize(saved.size.x, saved.size.y);
    helpers.forEach((h, i) => { h.visible = saved.helpersVis[i]; });
    saved = null;
    exporting = false;
    resize();
    seek(state.time);
  }

  /** Largest drawing-buffer edge this GPU will render. */
  function maxRenderSize() {
    const gl = renderer.getContext();
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    return Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), vp[0], vp[1]);
  }

  /* ----------------------------- public ------------------------------ */
  function applySceneSettings() {
    applyBackground();
    applyGround();
    applyLight();
    resize();
    applyTime(state.time);
  }

  return {
    renderer, scene, camera, runtime,
    syncDevice, syncAll, setSelection, applySceneSettings,
    applyBackground, applyGround, applyLight, resize,
    applyTime, seek, setPlaying, frame, pick, screenAnchor, deviceRect, screenRect, canvasRect, fitShadow,
    setFrameInsets, get frameRect() { return frameRect; },
    beginExport, endExport, maxRenderSize, requestRender, renderNow, renderScene, modelsReady,
    get gizmoDragging() { return dragging(); },
  };
}
