/* =====================================================================
   Device library

   Every device is a 3D model of the real hardware made by the community
   (credited in MODEL_CREDITS), prepared by scripts/prepare-models.mjs into
   public/models/: trimmed to the device, logos removed, screen and colour-
   carrying parts tagged, hinges given a pivot. Models are in metres at true
   size, so devices sit at true relative scale and can't be resized. They
   load on first use.

   A foldable has two forms, open and closed, each its own model: its maker
   modelled both, which looks better than bending one. The closed form's
   display is the cover screen; open, the cover screen is on the back, a
   second display (`cover`) that can show footage of its own.

   Open, a foldable can also part-fold: its turning half sits on a node
   "fold" on the hinge line (see setFold).

   The rest of the app relies on { root, screen, screenAspect, cover,
   coverAspect, screenParts, coverParts, setColor, setHinge, setFold,
   grounded }.
   ===================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { MODELS, formOf, defaultColorFor } from './catalog.js';

// the catalogue is part of the device library's interface
export * from './catalog.js';

/** A finish's two tones as linear colours: a custom colour, or a finish
    without a second tone, gets a paler version of itself. */
function finishTones(model, hex, native = false) {
  const entry = native ? null : model.finishes.find((f) => f[1].toLowerCase() === String(hex).toLowerCase());
  const c1 = new THREE.Color(hex);
  const second = native ? model.glb?.native2 : entry?.[2];
  const c2 = second ? new THREE.Color(second) : c1.clone().lerp(new THREE.Color(1, 1, 1), 0.45);
  return [c1, c2];
}

/* Hinge angle → rotation about x of the part that moves. A lid at 90° is
   upright; a display at 0° is upright and tilts back for positive angles. */
const hingeRotation = (spec, deg) =>
  THREE.MathUtils.degToRad(spec.kind === 'lid' ? 90 - deg : -deg);

/* ------------------------------- screens ------------------------------- */

/* A screen is a black surface whose footage is its emissive map, excluded
   from tone mapping so recordings keep their exact colours. Glare is a
   separate layer just over it — reflection only, added on top — which IS
   tone mapped, so a bright softbox reflected in it rolls off softly instead
   of clipping to a hard white shape. The glare setting picks the layer:
   none (footage only), matte (a soft sheen that falls off across the panel,
   like an anti-glare coating) or glossy (clear reflections). */
export const SCREEN_GLARE = {
  // reflectance is lifted above bare glass (ior 1.5 ≈ 4%) so the effect
  // reads in a mockup: about 7% for matte, 11% for glossy. opacity caps the
  // brightest reflection — a softbox seen head-on — at a sheen, not a white
  // screen: photographers keep lights out of a screen's reflection, and a
  // mockup can't. Glossy keeps a little blur: a true mirror would show the
  // environment's own pixels (a 1K panorama is 256 px per cube face).
  matte:  { roughness: 0.42, ior: 1.7, opacity: 0.35 },
  glossy: { roughness: 0.1, ior: 2.0, opacity: 0.45 },
};

export function screenMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x000000, metalness: 0, roughness: 1, specularIntensity: 0, emissive: 0x020202, toneMapped: false,
  });
}

/** The glare layer over a screen mesh: black, so only its reflection shows,
    added onto the footage. */
function addGlareLayer(screen) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x000000, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,   // drawn over the screen it lies on
  });
  material.userData.owned = true;
  const layer = new THREE.Mesh(screen.geometry, material);
  layer.raycast = () => {};   // picking sees the screen beneath
  layer.visible = false;
  screen.add(layer);
  screen.userData.glare = layer;
}

/** Set a screen's glare: 'none', 'matte' or 'glossy'. */
export function setScreenGlare(screen, glare) {
  const layer = screen.userData.glare, spec = SCREEN_GLARE[glare];
  if (!layer) return;
  layer.visible = !!spec;
  if (spec) Object.assign(layer.material, spec);
}

/** Show a texture on a screen, or switch it off (null). */
export function setScreenImage(mat, tex) {
  mat.emissiveMap = tex || null;
  mat.emissive.set(tex ? 0xffffff : 0x020202);
  mat.needsUpdate = true;
}
export const screenImage = (mat) => mat.emissiveMap;

/* -------------------------------- models -------------------------------- */

/* Meshopt decompression runs in workers, off the main thread: a page that
   froze while a model unpacked would hold up taps. */
MeshoptDecoder.useWorkers(Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) >> 1)));
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const detailed = new Map();   // file → { promise, scene, screenAspect }, once requested

const fileOf = (modelId, folded) => formOf(modelId, folded).glb.file;
export const modelReady = (modelId, folded) => !!detailed.get(fileOf(modelId, folded))?.scene;

/** Fetch a model (in one form) once. Resolves true when it's ready, false if it failed. */
export function loadModel(modelId, folded) {
  if (!MODELS[modelId]) return Promise.resolve(false);
  const spec = formOf(modelId, folded).glb;
  let entry = detailed.get(spec.file);
  if (!entry) {
    entry = { scene: null, screenAspect: 0 };
    const url = new URL(`models/${spec.file}.glb`, document.baseURI).href;
    entry.promise = gltfLoader.loadAsync(url).then((gltf) => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      /* a display can be in parts — a foldable's halves either side of the
         crease — measured together, as modelled: flat open */
      const parts = { main: [], cover: [] };
      scene.traverse((o) => {
        if (!o.isMesh) return;
        const which = o.material.userData.screen;
        if (which === 'cover' || o.name === 'cover') parts.cover.push(o);
        else if (which || o.name === 'screen') parts.main.push(o);
      });
      if (!parts.main.length) throw new Error(`${spec.file}.glb has no screen`);
      const aspect = (list) => {
        const box = new THREE.Box3();
        for (const o of list) box.expandByObject(o);
        const s = box.getSize(new THREE.Vector3());
        return s.x / s.y;
      };
      if (spec.webcam) fixWebcam(scene, spec.webcam);
      entry.screenAspect = aspect(parts.main);
      entry.coverAspect = parts.cover.length ? aspect(parts.cover) : 0;
      entry.scene = scene;
      return true;
    }).catch((err) => {
      console.warn(`Couldn't load the ${MODELS[modelId].label} model.`, err);
      detailed.delete(spec.file);   // let a later attempt try again
      return false;
    });
    detailed.set(spec.file, entry);
  }
  return entry.promise;
}

/* A webcam: a matte black barrel behind glass. The barrel is matte because
   it sits a little behind the bezel: anything shiny there mirrors the
   studio at an angle, as a bright disc beside the hole. The shine belongs
   to the glass, flush with the bezel, so it stays over the hole: black and
   added on, like a screen's glare layer, so only its reflection shows. */
let webcamBarrel = null, webcamCover = null;
function fixWebcam(scene, { barrel = [], glass = [] }) {
  webcamBarrel ||= new THREE.MeshStandardMaterial({
    name: 'webcam', color: 0x050608, roughness: 0.7, metalness: 0, envMapIntensity: 0.15,
  });
  webcamCover ||= new THREE.MeshPhysicalMaterial({
    name: 'webcam-glass', color: 0x000000, metalness: 0, roughness: 0.08, ior: 1.5,
    // a sheen, not a white dot: at a glancing angle the studio's softboxes fill it
    transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  const box = new THREE.Box3(), size = new THREE.Vector3();
  const small = (o) => box.setFromObject(o).getSize(size).length() < 0.006;   // not a bigger part sharing the material
  const found = [];
  scene.traverse((o) => { if (o.isMesh && (barrel.includes(o.material.name) || glass.includes(o.material.name)) && small(o)) found.push(o); });
  for (const o of found) {
    const isBarrel = barrel.includes(o.material.name), isGlass = glass.includes(o.material.name);
    if (isBarrel) o.material = webcamBarrel;
    if (isGlass && !isBarrel) { o.material = webcamCover; o.castShadow = false; }
    if (isGlass && isBarrel) {   // one part for the whole camera: the glass goes over it
      const cover = new THREE.Mesh(o.geometry, webcamCover);
      cover.raycast = () => {};
      o.add(cover);
    }
  }
}

/* An instance shares geometry and textures with the loaded model. Materials
   that carry the product colour are cloned per device, so each can have its
   own finish; the screen gets the app's own material (see screenMaterial). */
function buildDetailed(model, entry, hex) {
  const inst = entry.scene.clone(true);
  const tinted = new Map();
  // each display's parts (a foldable's halves) share one material, so one feed drives them
  const screenParts = [], coverParts = [];
  let screenMat = null, coverMat = null;
  inst.traverse((o) => {
    if (!o.isMesh) return;
    // see-through overlays (a speaker grille's holes) would cast a solid shadow: the shadow map ignores alpha
    o.castShadow = !o.material.transparent;
    o.receiveShadow = true;
    const which = o.material.userData.screen;
    if (which === 'cover' || o.name === 'cover') {
      o.material = coverMat ||= screenMaterial();
      o.userData.screen = 'cover';
      coverParts.push(o);
    } else if (o.name === 'screen' || which) {
      o.material = screenMat ||= screenMaterial();
      o.userData.screen = 'main';
      screenParts.push(o);
    } else if (o.material.userData.finish) {
      let m = tinted.get(o.material);
      if (!m) {
        const src = o.material;
        m = src.clone();
        m.userData = {
          owned: true, tone: src.userData.finish === 2 ? 2 : 1, texMean: src.userData.texMean,
          color: src.color.clone(), emissive: src.emissive.clone(),
        };
        tinted.set(src, m);
      }
      o.material = m;
    }
  });

  for (const o of [...screenParts, ...coverParts]) addGlareLayer(o);   // after the walk: it adds meshes
  const screen = screenParts.find((o) => o.name === 'screen') || screenParts[0];
  const cover = coverParts[0] || null;

  /* 'assign': each part becomes the finish's colour, divided by its
     texture's average so the texture keeps its grain but not its tint.
     Otherwise scale per channel, in linear space, by the ratio of the new
     finish to the one modelled: the native finish reproduces the model
     exactly and every part keeps its brightness relative to the others. */
  const assign = model.glb.recolour === 'assign', tone = model.glb.recolour === 'tone';
  const natives = assign ? null : finishTones(model, model.glb.native, true);
  const k = new THREE.Color();
  const luma = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const setColor = (c) => {
    const tones = finishTones(model, c);
    for (const m of tinted.values()) {
      const target = tones[m.userData.tone - 1];
      if (assign) {
        const t = m.map && m.userData.texMean;
        m.color.copy(target);
        if (t) m.color.multiply(k.setRGB(1 / Math.max(0.02, t[0]), 1 / Math.max(0.02, t[1]), 1 / Math.max(0.02, t[2])));
      } else if (tone) {
        const n = natives[m.userData.tone - 1];
        m.color.copy(target).multiplyScalar(luma(m.userData.color) / Math.max(1e-4, luma(n)));
      } else {
        const n = natives[m.userData.tone - 1];
        k.setRGB(target.r / n.r, target.g / n.g, target.b / n.b);
        m.color.copy(m.userData.color).multiply(k);
        m.emissive.copy(m.userData.emissive).multiply(k);
      }
    }
  };
  setColor(hex);

  // laptops' lids and displays' panels sit in a node on their hinge line
  const hingeNode = model.hinge ? inst.getObjectByName('hinge') : null;
  const setHinge = hingeNode ? (deg) => { hingeNode.rotation.x = hingeRotation(model.hinge, deg); } : null;
  // an open foldable's turning half: 180° is flat open, smaller closes it toward the viewer
  const foldNode = model.fold ? inst.getObjectByName('fold') : null;
  const setFold = foldNode ? (deg) => {
    const { axis, sign } = foldNode.userData;
    const turn = THREE.MathUtils.degToRad(180 - deg);
    foldNode.rotation.set(0, 0, 0);
    foldNode.rotation[axis] = sign * turn;
  } : null;

  return {
    root: inst, screen, screenAspect: entry.screenAspect, cover, coverAspect: entry.coverAspect,
    screenParts, coverParts, setColor, setHinge, setFold,
    grounded: model.family === 'laptop' || model.family === 'desktop',
  };
}

/** Build a device, in one of its forms, from its loaded model (see loadModel). */
export function buildDevice(modelId, hex, folded) {
  const model = MODELS[modelId];
  const entry = model && detailed.get(fileOf(modelId, folded));
  if (!entry?.scene) throw new Error(`The ${model?.label || modelId} model isn't loaded`);
  return buildDetailed(model, entry, hex || defaultColorFor(modelId));
}

export function disposeDevice(built) {
  // geometry and textures belong to the shared model; only per-device materials go
  built.root.traverse((o) => { if (o.isMesh && (o.material.userData.owned || o.userData.screen)) o.material.dispose(); });
}
