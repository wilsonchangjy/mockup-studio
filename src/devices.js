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

export const FAMILIES = {
  phone:   { label: 'Phones' },
  tablet:  { label: 'Tablets' },
  watch:   { label: 'Watches' },
  laptop:  { label: 'Laptops' },
  desktop: { label: 'Displays' },
};

/* Finishes per line: [name, colour] or, for two-tone devices, [name, colour,
   second tone] — an iMac's pale front, a Pixel's camera-bar band. */
const F = {
  iphonePro: [
    ['Natural Titanium', '#bdb6ac'], ['Blue Titanium', '#3e4855'],
    ['White Titanium', '#e6e4df'], ['Black Titanium', '#3a3a3c'],
  ],
  ipadPro: [['Space Black', '#2e2f33'], ['Silver', '#d9dadc']],
  ipadPro4: [['Space Grey', '#68696d'], ['Silver', '#d9dadc']],
  watch: [['Midnight', '#2b2f36'], ['Starlight', '#e3dccf'], ['Silver', '#e2e3e4'], ['Pink', '#efd3cc']],
  watchUltra: [['Natural Titanium', '#c7c1b6'], ['Black Titanium', '#38383a']],
  ipadMini: [['Space Grey', '#7d7e80'], ['Starlight', '#e6dccd'], ['Blue', '#8ea6c1'], ['Purple', '#b8aed6']],
  macbookAir: [['Midnight', '#2e3642'], ['Starlight', '#e6dccd'], ['Silver', '#d6d7d9'], ['Sky Blue', '#bfcfdf']],
  // the 2021 design the models are of came in Space Grey and Silver; the same
  // body has come in Space Black since the 2023 M3 Pro and M3 Max
  macbookPro: [['Space Grey', '#7d7e80'], ['Silver', '#e3e4e5'], ['Space Black', '#2e2e30']],
  imac: [
    ['Blue', '#3378a4', '#aee1ff'], ['Green', '#3f8b6e', '#c4e3d1'], ['Pink', '#d8606e', '#f6cfd0'],
    ['Silver', '#c8cacd', '#e6e7e9'], ['Yellow', '#e5b53a', '#f6e3a7'], ['Orange', '#e0663c', '#f7caa9'],
    ['Purple', '#7468b0', '#d7d0ed'],
  ],
  display: [['Silver', '#d3d5d8']],
  pixel6Pro: [['Stormy Black', '#1c1c1c', '#474747'], ['Cloudy White', '#efeeea', '#d5d6d4'], ['Sorta Sunny', '#f2e4bd', '#e3cf98']],
  iphoneDuo: [['Night Sky', '#272738'], ['Star White', '#e9e7e2']],
  // the last two are sold only on samsung.com
  galaxyS26: [
    ['Cobalt Violet', '#4f4a78'], ['Sky Blue', '#bcd5e6'], ['Black', '#2a2b2e'], ['White', '#ecebe7'],
    ['Silver Shadow', '#b7babf'], ['Pink Gold', '#e8cabe'],
  ],
  galaxyZFlip7: [['Blue Shadow', '#3e4b63'], ['Jetblack', '#1d1d1f'], ['Coralred', '#e0604f'], ['Mint', '#bfe2d2']],
  galaxyZFold8: [['Lavender', '#c8c2e3'], ['Cream', '#ebe3d2'], ['Graphite', '#3b3c40'], ['Pistachio', '#cddbbd']],
};

/* Licences other than CC BY 4.0. NonCommercial: images made with the model
   can't be used commercially. */
const NC = 'CC BY-NC-SA 4.0';

/* Parts that move: a laptop's lid (degrees open) or a display's tilt
   (degrees back from upright), and the angle a new device starts at. */
const LID = { kind: 'lid', label: 'Lid', min: 0, max: 135, rest: 110 };
/* An open foldable's angle: 180° flat, 0° folded shut (closed, with the cover
   screen in front, is a model of its own). */
const FOLD = { label: 'Angle', min: 0, max: 180, rest: 180 };

/* brand groups models in the menus. body / base / panelW + height: outer
   dimensions in mm (handhelds portrait), for laying devices out before their
   model has loaded. res: native pixels (handhelds portrait), for matching
   footage to devices.
   closed: a foldable's closed form — its body, cover screen, and model file.
   glb: a detailed model in public/models/. Its colour parts are recoloured
   either from `native` (and `native2`), the finish it was modelled in, by
   scaling — keeps each part's own shading, for models in a light or mid
   colour — or, with recolour: 'assign', set to the finish outright, for
   models in black, which scaling can't lift evenly. recolour: 'tone' sets
   each part to the finish at the part's own brightness relative to
   `native`: for untextured models whose parts differ in shade, not hue.
   licence: when not CC BY 4.0. */
export const MODELS = {
  /* ------------------------------ phones ------------------------------ */
  'iphone-15-pro': {
    family: 'phone', brand: 'Apple', label: 'iPhone 15 Pro', finishes: F.iphonePro,
    body: { w: 70.6, h: 146.6, d: 8.25 }, res: [1179, 2556],
    glb: { file: 'iphone-15-pro', native: '#bdb6ac' },
  },
  'iphone-15-pro-max': {
    family: 'phone', brand: 'Apple', label: 'iPhone 15 Pro Max', finishes: F.iphonePro,
    body: { w: 76.7, h: 159.9, d: 8.25 }, res: [1290, 2796],
    glb: { file: 'iphone-15-pro-max', native: '#bdb6ac' },
  },
  // opens like a book, to a screen wider than tall
  'iphone-duo': {
    family: 'phone', brand: 'Apple', label: 'iPhone Duo', finishes: F.iphoneDuo,
    body: { w: 164.6, h: 117.8, d: 5.2 }, res: [2670, 1878],
    closed: { body: { w: 84.1, h: 117.8, d: 11.3 }, res: [1398, 2034], file: 'iphone-duo-closed' },
    fold: FOLD,
    glb: { file: 'iphone-duo', native: '#272738', recolour: 'tone' },
    licence: NC,
  },
  'pixel-6-pro': {
    family: 'phone', brand: 'Google', label: 'Pixel 6 Pro', finishes: F.pixel6Pro,
    body: { w: 75.9, h: 163.9, d: 8.9 }, res: [1440, 3120],
    glb: { file: 'pixel-6-pro', recolour: 'assign' },
  },
  'galaxy-s26': {
    family: 'phone', brand: 'Samsung', label: 'Galaxy S26', finishes: F.galaxyS26,
    body: { w: 71.7, h: 149.6, d: 7.2 }, res: [1080, 2340],
    glb: { file: 'galaxy-s26', native: '#655976', recolour: 'tone' },
    licence: NC,
  },
  'galaxy-s26-ultra': {
    family: 'phone', brand: 'Samsung', label: 'Galaxy S26 Ultra', finishes: F.galaxyS26,
    body: { w: 78.1, h: 163.6, d: 7.9 }, res: [1440, 3120],
    glb: { file: 'galaxy-s26-ultra', native: '#c5e2ed', recolour: 'tone' },
    licence: NC,
  },
  'galaxy-z-flip-7': {
    family: 'phone', brand: 'Samsung', label: 'Galaxy Z Flip7', finishes: F.galaxyZFlip7,
    body: { w: 75.2, h: 166.7, d: 6.5 }, res: [1080, 2520],
    closed: { body: { w: 75.2, h: 85.5, d: 13.7 }, res: [948, 1048], file: 'galaxy-z-flip-7-closed' },
    fold: FOLD,
    glb: { file: 'galaxy-z-flip-7', native: '#ff4519', recolour: 'tone' },
    licence: NC,
  },
  // opens like a book, to a screen wider than tall
  'galaxy-z-fold-8': {
    family: 'phone', brand: 'Samsung', label: 'Galaxy Z Fold8', finishes: F.galaxyZFold8,
    body: { w: 161.4, h: 123.9, d: 4.5 }, res: [2448, 1848],
    closed: { body: { w: 81.9, h: 123.9, d: 9.7 }, res: [1248, 1972], file: 'galaxy-z-fold-8-closed' },
    fold: FOLD,
    glb: { file: 'galaxy-z-fold-8', native: '#d3d3ff', recolour: 'tone' },
    licence: NC,
  },

  /* ------------------------------ tablets ----------------------------- */
  // the 2022 (4th generation) design, which the detailed model is of
  'ipad-pro-11': {
    family: 'tablet', brand: 'Apple', label: 'iPad Pro 11"', finishes: F.ipadPro4,
    body: { w: 178.5, h: 247.6, d: 5.9 }, res: [1668, 2388],
    glb: { file: 'ipad-pro-11', native: '#d9dadc' },
  },
  'ipad-pro-13': {
    family: 'tablet', brand: 'Apple', label: 'iPad Pro 13"', finishes: F.ipadPro,
    body: { w: 215.5, h: 281.6, d: 5.1 }, res: [2064, 2752],
    glb: { file: 'ipad-pro-13', native: '#d9dadc' },
  },
  'ipad-mini': {
    family: 'tablet', brand: 'Apple', label: 'iPad mini', finishes: F.ipadMini,
    body: { w: 134.8, h: 195.4, d: 6.3 }, res: [1488, 2266],
    glb: { file: 'ipad-mini', native: '#b8b6cc' },   // the model's own purple, a touch greyer than the swatch
  },

  /* ------------------------------ watches ----------------------------- */
  // extent: the size with the band, for laying devices out
  'watch-series-9': {
    family: 'watch', brand: 'Apple', label: 'Apple Watch Series 9', finishes: F.watch,
    body: { w: 38, h: 45, d: 10.7 }, extent: { w: 40, h: 72 }, res: [396, 484],
    glb: { file: 'watch-series-9', native: '#efd3cc' },
  },
  'watch-ultra-2': {
    family: 'watch', brand: 'Apple', label: 'Apple Watch Ultra 2', finishes: F.watchUltra,
    body: { w: 44, h: 49, d: 14.4 }, extent: { w: 45, h: 77 }, res: [410, 502],
    glb: { file: 'watch-ultra-2', native: '#c7c1b6' },
  },

  /* ------------------------------ laptops ----------------------------- */
  'macbook-air-13': {
    family: 'laptop', brand: 'Apple', label: 'MacBook Air 13"', finishes: F.macbookAir,
    base: { w: 304.1, d: 215, t: 6.8 }, res: [2560, 1664],
    hinge: LID,
    glb: { file: 'macbook-air-13', native: '#7d7e80' },   // modelled in Space Grey, which the Air no longer comes in
  },
  'macbook-air-15': {
    family: 'laptop', brand: 'Apple', label: 'MacBook Air 15"', finishes: F.macbookAir,
    base: { w: 340.4, d: 237.6, t: 7.0 }, res: [2880, 1864],
    hinge: LID,
    glb: { file: 'macbook-air-15', native: '#7d7e80' },
  },
  'macbook-pro-14': {
    family: 'laptop', brand: 'Apple', label: 'MacBook Pro 14"', finishes: F.macbookPro,
    base: { w: 312.6, d: 221.2, t: 10 }, res: [3024, 1964],
    hinge: LID,
    glb: { file: 'macbook-pro-14', native: '#e3e4e5' },
  },
  'macbook-pro-16': {
    family: 'laptop', brand: 'Apple', label: 'MacBook Pro 16"', finishes: F.macbookPro,
    base: { w: 355.7, d: 248.1, t: 11 }, res: [3456, 2234],
    hinge: LID,
    glb: { file: 'macbook-pro-16', native: '#e3e4e5' },
  },

  /* ------------------------------ desktops ---------------------------- */
  'imac-24': {
    family: 'desktop', brand: 'Apple', label: 'iMac 24"', finishes: F.imac,
    panelW: 547, height: 461, res: [4480, 2520],
    hinge: { kind: 'tilt', label: 'Tilt', min: -5, max: 15, rest: 5 },
    glb: { file: 'imac-24', native: '#3378a4', native2: '#aee1ff' },
  },
  'studio-display': {
    family: 'desktop', brand: 'Apple', label: 'Studio Display', finishes: F.display,
    panelW: 623, height: 478, res: [5120, 2880],
    hinge: { kind: 'tilt', label: 'Tilt', min: -5, max: 25, rest: 5 },
    glb: { file: 'studio-display', native: '#d3d5d8' },
  },
  'pro-display-xdr': {
    family: 'desktop', brand: 'Apple', label: 'Pro Display XDR', finishes: F.display,
    panelW: 717.7, height: 560, res: [6016, 3384],
    glb: { file: 'pro-display-xdr', native: '#d3d5d8' },
  },
};

export const finishesFor = (modelId) => MODELS[modelId].finishes;
export const foldable = (modelId) => !!MODELS[modelId]?.closed;
/** Does the device, in this form, have a second display — an open foldable's cover screen? */
export const hasCover = (modelId, folded) => foldable(modelId) && !folded;

/** The model in one of its forms: closed swaps in a foldable's closed body,
    screen size and file. */
export function formOf(modelId, folded) {
  const m = MODELS[modelId];
  return folded && m.closed ? { ...m, ...m.closed, glb: { ...m.glb, file: m.closed.file } } : m;
}
export const defaultColorFor = (modelId) => MODELS[modelId].finishes[0][1];
export const hingeOf = (modelId) => MODELS[modelId]?.hinge || null;
export const foldOf = (modelId) => MODELS[modelId]?.fold || null;

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

export const modelsInFamily = (family) =>
  Object.entries(MODELS).filter(([, m]) => m.family === family).map(([id, m]) => ({ id, ...m }));

/** Native screen aspect (w/h) in the device's default orientation. */
export const screenAspectOf = (modelId, folded) => {
  const { res } = formOf(modelId, folded);
  return res[0] / res[1];
};


/* Models that used to exist; scenes saved with them come back as these. */
const RETIRED = {
  'iphone-13-mini': 'iphone-15-pro', 'ipad-air-11': 'ipad-pro-11', 'ipad-air-13': 'ipad-pro-13',
  'galaxy-s21-ultra': 'galaxy-s26-ultra', 'galaxy-z-flip-3': 'galaxy-z-flip-7',
};
export const resolveModel = (id) => (MODELS[id] ? id : RETIRED[id] && MODELS[RETIRED[id]] ? RETIRED[id] : null);

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

/* Attribution for the detailed models (their licences require it). Each was
   modified: trimmed to the device, logos removed, recolourable, given a
   working hinge where it has one, compressed. */
const AUTHORS = {
  polyman: ['polyman Studio', 'https://sketchfab.com/Polyman_3D'],
  akshat: ['akshatmittal', 'https://sketchfab.com/akshatmittal'],
  datsketch: ['DatSketch', 'https://sketchfab.com/DatSketch'],
  zhekan: ['zhe_kan', 'https://sketchfab.com/zhe_kan'],
};
export const LICENCES = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  [NC]: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
};
export const MODEL_CREDITS = [
  ['Apple iPhone 15 Pro Natural', 'apple-iphone-15-pro-natural-c1749472db7b4ec8904e8c500764b61d', 'polyman'],
  ['Apple iPhone 15 Pro Max Natural', 'apple-iphone-15-pro-max-natural-92d5a553bcc94f239c828580417efc94', 'polyman'],
  ['Ipad Pro 11in Silver 4gen', 'ipad-pro-11in-silver-4gen-a84f3c39d2fc4b9eb7c852db116da8b7', 'polyman'],
  ['Ipad pro 13in silver m4', 'ipad-pro-13in-silver-m4-8a113340443e49d3b905ab9f0b45efd6', 'polyman'],
  ['IPad Mini 6 2021', 'ipad-mini-6-2021-f363c2b1c74a462588db184bd4fb024e', 'datsketch'],
  ['Apple Watch Series 9', 'apple-watch-series-9-b6d698e718bb425a97057767f0cede47', 'polyman'],
  ['Apple Watch Ultra 2', 'apple-watch-ultra-2-f33263c457664b43909200c5ed5e6fa2', 'polyman'],
  ['2021 Macbook Pro 14" (M1 Pro / M1 Max)', '2021-macbook-pro-14-m1-pro-m1-max-f6b0b940fb6a4286b18a674ef32af2d3', 'akshat'],
  ['2021 Macbook Pro 16" (M1 Pro / M1 Max)', '2021-macbook-pro-16-m1-pro-m1-max-3abf6b6886eb4da885637964c8893703', 'akshat'],
  ['Apple Macbook Air 13 (Space Gray) 2023', 'apple-macbook-air-13-space-gray-2023-907bf1c943f248399e93a613eedf4897', 'akshat'],
  ['Apple Macbook Air 15 (Space Gray) 2023', 'apple-macbook-air-15-space-gray-2023-e8d82e341c794141a2561c2c9d01d79e', 'akshat'],
  ['iMac 2021', 'imac-2021-304cb06ffb554883a7a642b2b56754c1', 'datsketch'],
  ['Apple Mac Studio System 2023 (the Studio Display)', 'apple-mac-studio-system-2023-de6b6ff028474d158252fb22ece33c2a', 'akshat'],
  ['Apple Pro Display XDR', 'apple-pro-display-xdr-7e92cfb7c84d41f886c7748be6c567da', 'polyman'],
  ['Google Pixel 6 Pro', 'google-pixel-6-pro-b9b58ca40c254f8dafd8370869af74fb', 'datsketch'],
  ['Apple iPhone Duo', 'apple-iphone-duo-f6100910553946159e07518240fca910', 'zhekan', NC],
  ['SAMSUNG Galaxy S26', 'samsung-galaxy-s26-00f47b21ca6143fba6942fcf44e77f18', 'zhekan', NC],
  ['SAMSUNG Galaxy S26 Ultra', 'samsung-galaxy-s26-ultra-ee14d453cc8d4c12bf9e0b3279f2f7fb', 'zhekan', NC],
  ['SAMSUNG Galaxy Z Flip 7', 'samsung-galaxy-z-flip-7-9253a979bd8c473498013c00b3f28fca', 'zhekan', NC],
  ['SAMSUNG Galaxy Z Fold8', 'samsung-galaxy-z-fold8-dfbcbd3143e644608c758edaa0289db3', 'zhekan', NC],
].map(([title, slug, by, licence = 'CC BY 4.0']) => ({
  title, url: `https://sketchfab.com/3d-models/${slug}`,
  author: AUTHORS[by][0], authorUrl: AUTHORS[by][1], licence, licenceUrl: LICENCES[licence],
}));

/* -------------------------------- models -------------------------------- */

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
