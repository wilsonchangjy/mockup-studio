/* =====================================================================
   Composition: device detection, quickstart layout, templates

   Uploads are matched to a device by resolution first (exact native or
   scaled widths identify specific iPhones) and by aspect ratio second.
   Matching is a suggestion, not a lock — every device's model can be
   changed in the inspector afterwards.
   ===================================================================== */

import { MODELS, defaultColorFor, hingeOf, screenAspectOf, formOf } from './devices.js';
import { uid, defaultScene, mergeScene } from './state.js';

/* Short-edge pixel widths seen in iPhone screen recordings and exports,
   at native, @2x and @1x scale. */
const PHONE_WIDTHS = [
  ['iphone-15-pro-max', [1290, 1320, 860, 880, 430, 440, 1284, 856, 428]],
  ['iphone-15-pro',     [1179, 1206, 786, 804, 393, 402, 1170, 780, 390]],
];

/* Exact screen sizes for tablets, laptops and displays: native resolution and
   the common "looks like" scaled size that screen recordings and screenshots
   come out at. Listed landscape-first for Macs, portrait-first for iPads;
   either orientation matches. */
const EXACT = [
  ['ipad-pro-13',      [[2064, 2752], [1032, 1376]]],
  ['ipad-pro-11',      [[1668, 2388], [834, 1194], [1668, 2420], [834, 1210]]],   // 2022 and M4 sizes
  ['ipad-pro-13',      [[2048, 2732], [1024, 1366]]],                 // iPad Air 13" sizes
  ['ipad-pro-11',      [[1640, 2360], [820, 1180]]],                  // iPad Air 11" sizes
  ['ipad-mini',        [[1488, 2266], [744, 1133]]],
  ['macbook-air-13',   [[2560, 1664], [1470, 956], [1280, 832]]],
  ['macbook-air-15',   [[2880, 1864], [1710, 1112], [1440, 932]]],
  ['macbook-pro-14',   [[3024, 1964], [1512, 982]]],
  ['macbook-pro-16',   [[3456, 2234], [1728, 1117]]],
  ['imac-24',          [[4480, 2520], [2240, 1260]]],
  ['studio-display',   [[5120, 2880], [2560, 1440]]],
  ['pro-display-xdr',  [[6016, 3384], [3008, 1692]]],
  ['watch-ultra-2',    [[410, 502], [422, 514]]],                  // Ultra 2, Ultra 3
  ['watch-series-9',   [[396, 484], [352, 430], [416, 496], [374, 446]]],   // 45/41 mm, and 46/42 mm Series 10
  ['iphone-duo',       [[1878, 2670]]],                             // inner screen
  ['iphone-duo',       [[1398, 2034]], { folded: true }],           // cover screen
];

/* Android phones are only ever matched exactly, and only after every Apple
   size has been tried: an unrecognised size goes to an iPhone. A size two
   phones share goes to the newer (1440×3120: the S26 Ultra, not the Pixel 6
   Pro; 1080×2340, Samsung's and Pixels' default, the S26). A foldable's
   cover-screen size picks it closed. */
const ANDROID = [
  ['galaxy-s26-ultra', [[1440, 3120]]],
  ['galaxy-s26',       [[1080, 2340]]],
  ['galaxy-z-flip-7',  [[1080, 2520]]],
  ['galaxy-z-flip-7',  [[948, 1048]], { folded: true }],
  ['galaxy-z-fold-8',  [[1848, 2448]]],
  ['galaxy-z-fold-8',  [[1248, 1972]], { folded: true }],
];

const near = (a, b) => Math.abs(a - b) <= 3;

/** An exact Android size, either way round: the phone, and its form. */
function android(a) {
  const hit = ANDROID.find(([, sizes]) => sizes.some(([w, h]) =>
    (near(a.width, w) && near(a.height, h)) || (near(a.width, h) && near(a.height, w))));
  if (!hit) return null;
  const [model, , { folded = false } = {}] = hit;
  // turned when the footage's shape differs from the screen's own
  const landscape = (a.width > a.height) !== (screenAspectOf(model, folded) > 1);
  return { model, folded, landscape, reason: `${a.width}×${a.height} matches ${MODELS[model].label}${folded ? ' (closed)' : ''}` };
}

/** Suggest a device for a piece of media. */
export function classify(a) {
  const ar = a.width / a.height;
  const short = Math.min(a.width, a.height);
  const res = `${a.width}×${a.height}`;

  if (ar < 0.56 || ar > 1.9) {
    // an iPhone whose width and shape both fit; then an exact Android size; then
    // any iPhone of that width — so Apple wins every case that's ambiguous
    const widthHits = PHONE_WIDTHS.filter(([, ws]) => ws.some((w) => near(w, short)));
    const shape = Math.min(ar, 1 / ar);
    const exact = widthHits.find(([m]) => Math.abs(screenAspectOf(m) - shape) / shape < 0.015);
    const other = !exact && android(a);
    if (other) return other;
    const hit = exact || widthHits[0];
    const model = hit ? hit[0] : 'iphone-15-pro';
    return {
      model, landscape: ar > 1,
      reason: hit ? `${res} matches ${MODELS[model].label}` : `${res} is phone-shaped`,
    };
  }

  for (const [model, sizes, { folded = false } = {}] of EXACT) {
    for (const [w, h] of sizes) {
      const upright = near(a.width, w) && near(a.height, h);
      const turned = near(a.width, h) && near(a.height, w);
      if (upright || turned) {
        const fam = MODELS[model].family;
        // iPads are listed portrait, so a match on the turned size means landscape;
        // a phone turns when the footage's shape differs from its screen's
        const landscape = fam === 'tablet' ? turned && !upright
          : fam === 'phone' ? (a.width > a.height) !== (screenAspectOf(model, folded) > 1) : false;
        return { model, folded, landscape, reason: `${res} matches ${MODELS[model].label}${folded ? ' (closed)' : ''}` };
      }
    }
  }

  // a foldable's screens are tablet-shaped
  const other = android(a);
  if (other) return other;

  if (ar < 1)    return { model: 'ipad-pro-11', landscape: false, reason: `${res} is tablet-shaped (portrait)` };
  if (ar >= 1.68) return { model: 'imac-24', landscape: false, reason: `${res} is 16:9, like a desktop display` };
  if (ar >= 1.45) return { model: 'macbook-air-13', landscape: false, reason: `${res} is 16:10, like a laptop display` };
  return { model: 'ipad-pro-11', landscape: true, reason: `${res} is tablet-shaped (landscape)` };
}

export function newDevice(model, over = {}) {
  return {
    id: uid('d'),
    model,
    name: MODELS[model].label,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    color: defaultColorFor(model),
    media: null,
    trim: 0,
    rate: 1,
    // a foldable's other screen: the cover screen, on the back, while it's
    // open; the inner screen, folded away, while it's closed
    second: { media: null, trim: 0, rate: 1 },
    landscape: false,                          // turned 90° from the screen's own shape
    folded: false,                             // a foldable, closed
    foldAngle: 180,                            // a foldable, open: 180° flat
    hinge: hingeOf(model)?.rest ?? null,      // lid angle or tilt, for models that have one
    float: { enabled: false, amount: 0.5, seed: Math.round(Math.random() * 1000) / 100 },
    ...over,
  };
}

/** Footprint (width, height) in metres, as it stands. */
function footprint(d) {
  const m = formOf(d.model, d.folded);
  if (m.family === 'laptop') return { w: m.base.w / 1000, h: 0.21, grounded: true };
  if (m.family === 'desktop') return { w: m.panelW / 1000, h: m.height / 1000, grounded: true };
  const e = m.extent || m.body;
  const w = e.w / 1000, h = e.h / 1000;
  return d.landscape ? { w: h, h: w, grounded: false } : { w, h, grounded: false };
}

const ORDER = { desktop: 0, laptop: 1, tablet: 2, phone: 3, watch: 4 };
const DEPTH = { desktop: -0.12, laptop: -0.02, tablet: 0.06, phone: 0.1, watch: 0.13 };

/** Lay devices out in a row — big, grounded devices behind, handhelds in front
    standing on the floor — angled gently toward the centre. Mutates and returns them. */
export function layoutRow(devices) {
  devices.sort((a, b) => ORDER[MODELS[a.model].family] - ORDER[MODELS[b.model].family]);
  const mixed = new Set(devices.map((d) => footprint(d).grounded)).size > 1;
  const gap = mixed ? 0.05 : 0.045;
  const fps = devices.map(footprint);
  const total = fps.reduce((s, f) => s + f.w, 0) + gap * Math.max(0, devices.length - 1);

  let x = -total / 2;
  devices.forEach((d, i) => {
    const f = fps[i];
    const cx = x + f.w / 2;
    x += f.w + gap;
    const fam = MODELS[d.model].family;
    const y = f.grounded ? 0 : f.h / 2;   // settled exactly once the model is in
    const z = mixed ? DEPTH[fam] : (i % 2 ? -0.02 : 0.02) * (devices.length > 2 ? 1 : 0);
    const yaw = devices.length > 1 ? -Math.max(-18, Math.min(18, (cx / Math.max(0.2, total / 2)) * 16)) : -10;
    d.position = [cx, y, z];
    d.rotation = [0, yaw, 0];
  });
  return devices;
}

/** Turn uploaded assets into a starting scene. */
export function quickstart(assets) {
  const chosen = assets.slice(0, 6);
  const notes = [];
  const devices = chosen.map((a) => {
    const c = classify(a);
    notes.push({ asset: a.name, model: MODELS[c.model].label, reason: c.reason });
    return newDevice(c.model, { media: a.id, landscape: c.landscape, folded: !!c.folded });
  });
  layoutRow(devices);
  const grounded = devices.some((d) => footprint(d).grounded);
  const scene = defaultScene();
  scene.motion = grounded ? { preset: 'turntable', amount: 0.05 } : { preset: 'dolly', amount: 0.4 };
  return { devices, scene, cameraDir: grounded ? [0.12, 0.34, 1] : [0, 0.12, 1], notes, skipped: assets.length - chosen.length };
}

/* ------------------------------ templates ------------------------------ */

/* The arrangements mockup libraries and case studies lean on most: an
   isometric angle; two phones for a before-and-after or a flow; a top-down
   flat lay; laptop + phone for cross-device work; and the full ecosystem. All in the
   default mood, so a template looks as its thumbnail does (the thumbnails in
   public/templates/ are renders of these scenes). Phones stand on the floor;
   heights are close and settle exactly once the models load. */

const studio = (over = {}) => mergeScene(over);   // deep-merge onto the defaults
const PHONE_Y = 0.0733;                            // an upright iPhone 15 Pro's centre

export const TEMPLATES = [
  {
    id: 'isometric',
    name: 'Isometric',
    blurb: 'An iPhone lying flat, seen from a high three-quarter angle',
    build: () => ({
      devices: [newDevice('iphone-15-pro', { position: [0, 0.0042, 0], rotation: [-90, 0, 0] })],
      scene: studio({ motion: { preset: 'turntable', amount: 0.08 } }),
      cameraDir: [0.7, 0.85, 0.7],
    }),
  },
  {
    // staggered in depth and turned opposite ways, seen from low and to one
    // side, with room above and below
    id: 'phone-pair',
    name: 'Phone pair',
    blurb: 'Two iPhones, staggered, for a before-and-after or a flow',
    build: () => ({
      devices: [
        newDevice('iphone-15-pro', { position: [-0.062, PHONE_Y, -0.05], rotation: [0, 24, 0] }),
        newDevice('iphone-15-pro', { position: [0.05, PHONE_Y, 0.045], rotation: [0, -26, 0] }),
      ],
      scene: studio({ motion: { preset: 'turntable', amount: 0.06, reverse: true } }),
      cameraDir: [0.22, 0.07, 1],
      fill: 0.76,
    }),
  },
  {
    id: 'trio-topdown',
    name: 'Flat lay',
    blurb: 'Three iPhones on the floor, from directly above',
    build: () => ({
      devices: [-1, 0, 1].map((k) => newDevice('iphone-15-pro', {
        position: [k * 0.09, 0.0042, 0],
        rotation: [-90, 0, 0],
      })),
      scene: studio({ motion: { preset: 'dolly', amount: 0.3 } }),
      cameraDir: [0, 1, 0.0015],
      fill: 0.8,
    }),
  },
  {
    id: 'macbook-iphone',
    name: 'Laptop + phone',
    blurb: 'A MacBook Pro with an iPhone beside it',
    build: () => ({
      devices: [
        newDevice('macbook-pro-14', { position: [-0.05, 0, 0], rotation: [0, 10, 0] }),
        newDevice('iphone-15-pro', { position: [0.2, PHONE_Y, 0.08], rotation: [0, -16, 0] }),
      ],
      scene: studio({ motion: { preset: 'turntable', amount: 0.05 } }),
      cameraDir: [0.1, 0.32, 1],
    }),
  },
  {
    id: 'desk-setup',
    name: 'Ecosystem',
    blurb: 'Studio Display, MacBook Pro, iPad and iPhone',
    build: () => ({
      devices: [
        newDevice('studio-display', { position: [0, 0, -0.15] }),
        newDevice('macbook-pro-14', { position: [-0.44, 0, 0.06], rotation: [0, 22, 0] }),
        newDevice('ipad-pro-11', { position: [0.43, 0.09, 0.02], rotation: [0, -20, 0], landscape: true }),
        newDevice('iphone-15-pro', { position: [0.2, PHONE_Y, 0.16], rotation: [0, -12, 0] }),
      ],
      scene: studio({ motion: { preset: 'crane', amount: 0.3 } }),
      cameraDir: [0, 0.3, 1],
    }),
  },
  {
    id: 'blank',
    name: 'Blank scene',
    blurb: 'Start empty and add devices yourself',
    build: () => ({ devices: [], scene: studio(), cameraDir: [0, 0.2, 1] }),
  },
];
