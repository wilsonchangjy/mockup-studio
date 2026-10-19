/* =====================================================================
   Lighting moods

   Each mood recreates a standard product-photography setup, lit by a
   photographed studio — an HDRI from Poly Haven (CC0), in public/
   environments/ — so metal and glass reflect real softboxes, stands and
   walls:

   - Softbox studio: two softboxes either side of a grey studio. The
     e-commerce and catalogue default.
   - High key: a white studio under a ceiling of light. Bright, few shadows.
   - Low key: two gridded octaboxes, the room held dark.
   - Window light: a sunlit room with one big window. Soft, directional,
     lifestyle.
   - Golden hour: open sky at dusk, the sun just down. Low, warm, long
     shadows.

   A mood is everything that sets the light: the environment (what metal and
   glass reflect, and the soft ambient light), the key light (colour,
   height, direction, strength — it casts the shadows), an optional rim
   light from behind, and the background and floor shadow that suit it.
   Choosing a mood writes its values into the scene; the sliders adjust from
   there. The environment turns with the Direction slider, so its main light
   — measured from the panorama, `hdri.azimuth` — stays where the key light
   is, and reflections agree with shadows.

   A panorama downloads (about 1.5 MB) the first time its mood is used, and
   its 2K version (about 6 MB) when screens are set to Glossy: a near-mirror
   shows the environment's own pixels, and 1K is 256 px per cube face. Until
   a panorama arrives, the smaller one, or a small generated studio, stands
   in.
   ===================================================================== */

import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

import { MOODS } from './moods.js';

export { MOODS, resolveMood } from './moods.js';

/* ------------------------------ stand-in ------------------------------ */

/* A softbox studio drawn from primitives: a grey room as a three-stop
   gradient (ceiling, walls, floor) and softboxes as panels with feathered
   edges and a brighter centre. Its key softbox is at STAND_IN.azimuth. */
const STAND_IN = {
  azimuth: -45,
  exposure: 1,
  room: [[0.22, 0.22, 0.23], [0.1, 0.1, 0.105], [0.3, 0.3, 0.31]],
  // [azimuth°, elevation°, [w, h] in m, strength], 5 m from the subject
  sources: [[-45, 30, [3, 3.6], 4.5], [55, 20, [2.4, 3], 1.8], [0, 85, [4, 4], 2.2]],
};

function softboxMask() {
  const N = 64, data = new Uint8Array(N * N * 4);
  const s = (x) => { const t = Math.min(1, Math.max(0, x / 0.16)); return t * t * (3 - 2 * t); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N, v = (j + 0.5) / N;
    const a = s(Math.min(u, 1 - u)) * s(Math.min(v, 1 - v)) * (0.82 + 0.18 * (1 - ((u - 0.5) ** 2 + (v - 0.5) ** 2) * 2));
    const k = (j * N + i) * 4;
    data[k] = data[k + 1] = data[k + 2] = Math.round(a * 255); data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function standInScene() {
  const scene = new THREE.Scene();
  const dome = new THREE.SphereGeometry(20, 64, 32);
  const [top, mid, bottom] = STAND_IN.room.map((c) => new THREE.Color(...c));
  const colors = [], p = dome.attributes.position, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / 20;
    if (t >= 0) c.copy(mid).lerp(top, Math.pow(t, 0.7));
    else c.copy(mid).lerp(bottom, Math.min(1, -t * 4));
    colors.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const mask = softboxMask();
  for (const [az, el, [w, h], strength] of STAND_IN.sources) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 1, 1).multiplyScalar(strength), map: mask,
      side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
    m.position.set(Math.sin(a) * Math.cos(e) * 5, Math.sin(e) * 5, Math.cos(a) * Math.cos(e) * 5);
    m.lookAt(0, 0, 0);
    scene.add(m);
  }
  return { scene, mask };
}

/* ------------------------------ decoding ------------------------------ */

/* Panoramas decode in a worker (hdrWorker.js); where one can't start, on
   the main thread as before. */
let worker = null, workerFailed = false, nextJob = 0;
const jobs = new Map();
function decodeHDR(url) {
  if (!workerFailed && !worker) {
    try {
      worker = new Worker(new URL('./hdrWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const job = jobs.get(data.id);
        jobs.delete(data.id);
        if (data.error) job?.reject(new Error(data.error)); else job?.resolve(data);
      };
      worker.onerror = () => {   // the worker itself failed to load: fall back, for these and later ones
        workerFailed = true; worker = null;
        for (const [, job] of jobs) job.fallback();
        jobs.clear();
      };
    } catch { workerFailed = true; worker = null; }
  }
  const onMain = () => new HDRLoader().loadAsync(url);
  if (!worker) return onMain();
  return new Promise((resolve, reject) => {
    const id = ++nextJob;
    jobs.set(id, {
      resolve: ({ width, height, data, type }) => {
        const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, type);
        // as HDRLoader sets them
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.flipY = true;
        tex.needsUpdate = true;
        resolve(tex);
      },
      reject,
      fallback: () => onMain().then(resolve, reject),
    });
    worker.postMessage({ id, url });
  });
}

/** When the page has a moment: GPU work that isn't urgent waits for a gap
    between frames and input instead of landing on a tap. */
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 400 }) : setTimeout(r, 50)));

/* ---------------------------- environments ---------------------------- */

/** Environment maps per mood and size ('1k', or '2k' for glossy screens),
    made once each. `get(mood, size)` returns what to light with now —
    { texture, azimuth, exposure } — the panorama at that size once it has
    loaded, else the 1K one, else the stand-in; `onReady` runs when a
    panorama arrives. `ready(mood, size)` resolves once it has (or failed:
    the fallback stays). */
export function createEnvironments(renderer, onReady) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const made = new Map();     // 'mood:size' → { texture, azimuth, exposure }, once loaded
  const loading = new Map();  // 'mood:size' → promise
  let standIn = null, standInQueued = false;
  // until the stand-in is made: no environment (nothing's on stage that early)
  const none = { texture: null, azimuth: 0, exposure: 1 };

  /* The stand-in is made once, when the page is idle, not while the start
     screen is taking its first taps. */
  function useStandIn() {
    if (standIn) return standIn;
    if (!standInQueued) {
      standInQueued = true;
      idle().then(() => {
        const { scene, mask } = standInScene();
        standIn = { texture: pmrem.fromScene(scene, 0.04).texture, azimuth: STAND_IN.azimuth, exposure: STAND_IN.exposure };
        scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
        mask.dispose();
        onReady?.();
      });
    }
    return none;
  }

  function load(mood, size = '1k') {
    const spec = MOODS[mood]?.hdri, key = `${mood}:${size}`;
    if (!spec || made.has(key)) return Promise.resolve();
    if (!loading.has(key)) {
      const url = new URL(`environments/${spec.file}_${size}.hdr`, document.baseURI).href;
      loading.set(key, decodeHDR(url).then(async (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        await idle();   // preparing it for reflections is GPU work: between interactions
        made.set(key, { texture: pmrem.fromEquirectangular(tex).texture, azimuth: spec.azimuth, exposure: spec.exposure });
        tex.dispose();
        onReady?.(mood);
      }).catch((err) => {
        console.warn(`Couldn't load the ${MOODS[mood].label} environment (${size}).`, err);
      }));   // kept, failed or not: no retry storm
    }
    return loading.get(key);
  }

  return {
    get(mood, size = '1k') {
      load(mood, '1k');
      if (size !== '1k') load(mood, size);
      return made.get(`${mood}:${size}`) || made.get(`${mood}:1k`) || useStandIn();
    },
    ready: load,
  };
}
