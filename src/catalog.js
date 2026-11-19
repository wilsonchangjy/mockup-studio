/* =====================================================================
   Device catalogue

   What every device is — family, finishes, size, native resolution, model
   file, licence — and the credits its model needs, as plain data. Kept apart
   from devices.js, which builds the 3D models, so the start screen and the
   store can use it without loading three.js.
   ===================================================================== */

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
   webcam: the front camera's parts, by material. barrel: what sits behind
   the lens, modelled plain white (or, on the iMac, the whole camera), which
   read as a bright dot in the bezel: made matte black. glass: the cover over
   the hole, modelled all but invisible: given a glass's reflection. Only
   parts under 6 mm; bigger parts sharing a material keep it (devices.js).
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
    glb: { file: 'macbook-air-13', native: '#7d7e80', webcam: { barrel: ['cxUkZOXjaaYkodT'], glass: ['bcpnEXkmszsmZdS'] } },   // modelled in Space Grey, which the Air no longer comes in
  },
  'macbook-air-15': {
    family: 'laptop', brand: 'Apple', label: 'MacBook Air 15"', finishes: F.macbookAir,
    base: { w: 340.4, d: 237.6, t: 7.0 }, res: [2880, 1864],
    hinge: LID,
    glb: { file: 'macbook-air-15', native: '#7d7e80', webcam: { barrel: ['rvYnnyqXrbFJXxh'], glass: ['SsSIPrCyVNTOxvd'] } },
  },
  'macbook-pro-14': {
    family: 'laptop', brand: 'Apple', label: 'MacBook Pro 14"', finishes: F.macbookPro,
    base: { w: 312.6, d: 221.2, t: 10 }, res: [3024, 1964],
    hinge: LID,
    glb: { file: 'macbook-pro-14', native: '#e3e4e5', webcam: { barrel: ['jRMWtdSAaujlvUA'], glass: ['BczvixNfkWQzRzZ'] } },
  },
  'macbook-pro-16': {
    family: 'laptop', brand: 'Apple', label: 'MacBook Pro 16"', finishes: F.macbookPro,
    base: { w: 355.7, d: 248.1, t: 11 }, res: [3456, 2234],
    hinge: LID,
    glb: { file: 'macbook-pro-16', native: '#e3e4e5', webcam: { barrel: ['CnxtCtLZokWEuBx'], glass: ['HdizSXcPCyRZnnP'] } },
  },

  /* ------------------------------ desktops ---------------------------- */
  'imac-24': {
    family: 'desktop', brand: 'Apple', label: 'iMac 24"', finishes: F.imac,
    panelW: 547, height: 461, res: [4480, 2520],
    hinge: { kind: 'tilt', label: 'Tilt', min: -5, max: 15, rest: 5 },
    glb: { file: 'imac-24', native: '#3378a4', native2: '#aee1ff', webcam: { barrel: ['Lens'], glass: ['Lens'] } },
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
