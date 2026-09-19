/* =================================================================
   Mockup Studio — deterministic 3D device motion
   Every visual property is a pure function of time `t`, which is what
   lets the headless renderer (render.mjs) step frame-by-frame and get
   byte-identical output to the preview.
   ================================================================= */

/* ------------------------------- math ------------------------------- */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp  = (a, b, u) => a + (b - a) * u;

function smoothstep(e0, e1, x) {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const u = clamp((x - e0) / (e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
}

/* Layered sines: smooth, deterministic, non-repeating over a short take.
   Three octaves at irrational-ish ratios so the phone never visibly
   returns to the same pose. Output settles in roughly [-1, 1]. */
function noise(t, seed) {
  return Math.sin(t * 1.000 + seed * 1.70) * 0.62
       + Math.sin(t * 1.734 + seed * 3.11) * 0.28
       + Math.sin(t * 2.613 + seed * 5.37) * 0.10;
}

/* --------------------------- device colour --------------------------
   The rail reads as anodised metal because of its highlight/shadow banding,
   not its hue. So rather than flat-filling the body, mix the chosen colour
   toward white and black at fixed stops — that keeps the material convincing
   for anything from Midnight to Starlight. */
function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(f, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const mix = ({ r, g, b }, target, amt) => {
  const t = target === 'white' ? 255 : 0;
  const m = (c) => Math.round(c + (t - c) * amt);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
};

// offset %, direction, amount — tuned against the original aluminium gradient
const RAIL_STOPS = [
  [0,   'black', 0.35], [6,  'white', 0.55], [10, 'white', 0.75],
  [20,  'white', 0.15], [46, 'black', 0.18], [62, 'black', 0.08],
  [88,  'white', 0.62], [95, 'black', 0.12], [100,'black', 0.42],
];

function railGradient(hex) {
  const rgb = hexToRgb(hex);
  const stops = RAIL_STOPS.map(([at, dir, amt]) => `${mix(rgb, dir, amt)} ${at}%`);
  return `linear-gradient(103deg, ${stops.join(', ')})`;
}

/* ------------------------------- state ------------------------------ */

const DEFAULTS = {
  output: { w: 1920, h: 1080, fps: 30, duration: 18 },

  scene: {
    perspective: 2400,
    rotX: 0, rotY: 0,
    zoom: 1,
    basePw: 360,
    bgTop: '#1b2130', bgBottom: '#05070c',
    vignette: 0.55,
    glare: 0.12,
    shadowOpacity: 0.5, shadowBlur: 46, floorY: 430,
  },

  choreo: {
    enabled: true,
    swapTime: 8.6, swapDur: 2.4,
    frontZ: 170, backZ: -430,
    backBlur: 4.5, tuck: 120,
  },

  master: { speed: 1 },

  a: {
    baseX: -370, baseY: 0, rotX: 0, rotY: 14, rotZ: -3, scale: 1,
    bodyColor: '#8a909a',
    bobAmp: 16, bobSpeed: 0.55,
    swayAmp: 9,  swaySpeed: 0.38,
    zAmp: 26,    zSpeed: 0.31,
    tiltXAmp: 3.0, tiltXSpeed: 0.42,
    tiltYAmp: 4.0, tiltYSpeed: 0.29,
    rollAmp: 1.6,  rollSpeed: 0.35,
    seed: 0, trimIn: 0, rate: 0.9,
  },

  b: {
    baseX: 370, baseY: 0, rotX: 0, rotY: -14, rotZ: 3, scale: 1,
    bodyColor: '#8a909a',
    bobAmp: 16, bobSpeed: 0.55,
    swayAmp: 9,  swaySpeed: 0.38,
    zAmp: 26,    zSpeed: 0.31,
    tiltXAmp: 3.0, tiltXSpeed: 0.42,
    tiltYAmp: 4.0, tiltYSpeed: 0.29,
    rollAmp: 1.6,  rollSpeed: 0.35,
    seed: 5.5, trimIn: 0, rate: 0.9,
  },

  link: true,
};

let STATE = structuredClone(DEFAULTS);

/* path helpers so controls can bind to 'scene.rotX' etc. */
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  ks.reduce((x, k) => x[k], o)[last] = v;
}

/* motion params mirrored between phones when "link" is on.
   Deliberately excludes seed / baseX / trimIn / rate — those are what
   make the two phones read as separate objects. */
const LINKED = [
  'bobAmp','bobSpeed','swayAmp','swaySpeed','zAmp','zSpeed',
  'tiltXAmp','tiltXSpeed','tiltYAmp','tiltYSpeed','rollAmp','rollSpeed','scale',
];

/* ------------------------------- dom -------------------------------- */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const stage    = $('#stage');
const world    = $('#world');
const fitEl    = $('#fit');
const vignette = $('#vignette');
const scrub    = $('#scrub');
const timeLbl  = $('#time-label');
const fitLbl   = $('#fit-label');
const playBtn  = $('#btn-play');

const els = {
  a: { phone: $('[data-phone="a"]'), body: null, video: $('[data-video="a"]'), glare: null, shadow: $('[data-shadow="a"]') },
  b: { phone: $('[data-phone="b"]'), body: null, video: $('[data-video="b"]'), glare: null, shadow: $('[data-shadow="b"]') },
};
for (const k of ['a','b']) {
  els[k].body   = $('.phone-body', els[k].phone);
  els[k].glare  = $('.glare', els[k].phone);
  els[k].canvas = $(`[data-canvas="${k}"]`, els[k].phone);
  els[k].ctx    = els[k].canvas.getContext('2d', { alpha: false });
}

/* ------------------------- screen rasterisation ---------------------
   Paint the current video frame into the phone's canvas. Called from the
   playback loop, and from every 'seeked' event so scrubbing and headless
   stepping both land on the correct frame. Uses cover-fit so a dropped
   recording of any aspect still fills the display. */
/* A phone screen can be fed by a <video> or, for stills, an <img>. Both are
   valid drawImage sources, so everything downstream stays the same. */
function srcOf(key) {
  const e = els[key];
  return e.isImage ? e.img : e.video;
}
function srcSize(key) {
  const e = els[key];
  return e.isImage
    ? { w: e.img.naturalWidth, h: e.img.naturalHeight, ready: e.img.complete && e.img.naturalWidth > 0 }
    : { w: e.video.videoWidth, h: e.video.videoHeight, ready: e.video.readyState >= 2 };
}

function sizeCanvas(key) {
  const { w, h } = srcSize(key);
  if (!w) return;
  els[key].canvas.width = w;
  els[key].canvas.height = h;
}

function drawScreen(key) {
  const { canvas: c, ctx } = els[key];
  const { w, h, ready } = srcSize(key);
  if (!w || !ready) return;
  if (c.width !== w) sizeCanvas(key);

  const cw = c.width, ch = c.height;
  const scale = Math.max(cw / w, ch / h);
  const dw = w * scale, dh = h * scale;
  ctx.drawImage(srcOf(key), (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

for (const k of ['a','b']) {
  els[k].img = new Image();
  els[k].isImage = false;
  els[k].video.addEventListener('seeked',     () => drawScreen(k));
  els[k].video.addEventListener('loadeddata', () => { sizeCanvas(k); drawScreen(k); });
  els[k].img.addEventListener('load',         () => { sizeCanvas(k); drawScreen(k); });
}

/* ---------------------------- animation ----------------------------- */

/* Resolve the full pose of one phone at time t. Pure — no DOM, no side
   effects — so it can be unit-tested or reused by an exporter. */
function poseAt(t, key) {
  const p = STATE[key];
  const c = STATE.choreo;
  const s = p.seed;

  let x = p.baseX + p.swayAmp * noise(t * p.swaySpeed, s + 11);
  let y = p.baseY + p.bobAmp  * noise(t * p.bobSpeed,  s +  3);
  let z =           p.zAmp    * noise(t * p.zSpeed,    s + 19);

  let blur = 0;

  if (c.enabled) {
    // focus: 0 = A in front, 1 = B in front
    const f = smoothstep(c.swapTime, c.swapTime + c.swapDur, t);
    const fwd = key === 'a' ? f : 1 - f;          // 0 = this phone is front
    z    += lerp(c.frontZ, c.backZ, fwd);
    blur  = lerp(0, c.backBlur, fwd);
    // push the receding phone outward so it tucks behind the hero
    x    += fwd * c.tuck * Math.sign(p.baseX || 1);
  }

  const rotX = p.rotX + p.tiltXAmp * noise(t * p.tiltXSpeed, s + 31);
  const rotY = p.rotY + p.tiltYAmp * noise(t * p.tiltYSpeed, s + 43);
  const rotZ = p.rotZ + p.rollAmp  * noise(t * p.rollSpeed,  s + 57);

  return { x, y, z, rotX, rotY, rotZ, blur, scale: p.scale };
}

function applyPhone(t, key) {
  const e = els[key];
  const sc = STATE.scene;
  const pose = poseAt(t, key);

  const pw = sc.basePw * sc.zoom * pose.scale;
  e.phone.style.setProperty('--pw', pw + 'px');
  e.phone.style.transform =
    `translate3d(${pose.x.toFixed(3)}px, ${pose.y.toFixed(3)}px, ${pose.z.toFixed(3)}px) ` +
    `rotateX(${pose.rotX.toFixed(3)}deg) rotateY(${pose.rotY.toFixed(3)}deg) rotateZ(${pose.rotZ.toFixed(3)}deg)`;

  e.body.style.filter = pose.blur > 0.01 ? `blur(${pose.blur.toFixed(2)}px)` : 'none';

  const col = STATE[key].bodyColor;
  if (e._col !== col) {
    e.body.style.background = railGradient(col);
    e._col = col;
  }

  // specular sweep tracks the tilt, so the glass reads as a real surface
  e.glare.style.setProperty('--glare-angle', (115 - pose.rotY * 1.8).toFixed(2) + 'deg');
  e.glare.style.setProperty('--glare-a', clamp(sc.glare * (1 + pose.rotY / 42), 0, 1).toFixed(4));

  // shadow: driven by how far the phone floats above the notional floor
  const h = Math.max(0, sc.floorY - pose.y);
  const sh = e.shadow;
  sh.style.setProperty('--pw', pw + 'px');
  sh.style.transform =
    `translate3d(${pose.x.toFixed(2)}px, ${sc.floorY.toFixed(2)}px, ${pose.z.toFixed(2)}px) ` +
    `scale(${(1 + h / 1100).toFixed(4)}, ${(1 - h / 4200).toFixed(4)})`;
  sh.style.opacity = (sc.shadowOpacity / (1 + h / 340)).toFixed(4);
  sh.style.filter  = `blur(${(sc.shadowBlur * (0.45 + h / 700)).toFixed(2)}px)`;
}

function applyScene() {
  const sc = STATE.scene, o = STATE.output;

  stage.style.width  = o.w + 'px';
  stage.style.height = o.h + 'px';
  stage.style.perspective = sc.perspective + 'px';
  stage.style.background = `linear-gradient(170deg, ${sc.bgTop} 0%, ${sc.bgBottom} 100%)`;

  world.style.transform = `rotateX(${sc.rotX}deg) rotateY(${sc.rotY}deg)`;

  vignette.style.background =
    `radial-gradient(ellipse 72% 68% at 50% 46%, rgba(0,0,0,0) 40%, rgba(0,0,0,${sc.vignette}) 100%)`;

  scrub.max = o.duration;
  fitToViewport();
}

/* video time is derived from t, looping inside the trimmed range so a
   13.6s recording can still fill an 18s composition */
function videoTimeFor(key, t) {
  if (els[key].isImage) return null;
  const p = STATE[key], v = els[key].video;
  const dur = v.duration;
  if (!dur || !isFinite(dur)) return null;
  const span = Math.max(0.1, dur - p.trimIn);
  return p.trimIn + ((t * p.rate) % span);
}

function applyFrame(t, { seek = false } = {}) {
  applyPhone(t, 'a');
  applyPhone(t, 'b');

  for (const key of ['a','b']) {
    const v = els[key].video;
    const want = videoTimeFor(key, t);
    if (want == null) continue;
    if (seek) {
      v.currentTime = want;
    } else if (Math.abs(v.currentTime - want) > 0.35) {
      v.currentTime = want;   // re-sync only on real drift, to avoid stutter
    }
  }

  drawScreen('a');
  drawScreen('b');

  timeLbl.textContent = `${t.toFixed(2)} / ${STATE.output.duration.toFixed(2)}s`;
  if (document.activeElement !== scrub) scrub.value = t;
}

/* --------------------------- playback loop -------------------------- */

let playing = false, tNow = 0, rafId = null, lastWall = 0;

function tick(now) {
  if (!playing) return;
  const dt = (now - lastWall) / 1000;
  lastWall = now;
  tNow = (tNow + dt * STATE.master.speed) % STATE.output.duration;
  applyFrame(tNow);
  rafId = requestAnimationFrame(tick);
}

function play() {
  if (playing) return;
  playing = true;
  playBtn.textContent = 'Pause';
  for (const k of ['a','b']) {
    if (els[k].isImage) continue;
    const v = els[k].video;
    v.playbackRate = clamp(STATE[k].rate * STATE.master.speed, 0.0625, 16);
    v.play().catch(() => {});
  }
  lastWall = performance.now();
  rafId = requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  playBtn.textContent = 'Play';
  cancelAnimationFrame(rafId);
  for (const k of ['a','b']) if (!els[k].isImage) els[k].video.pause();
}

playBtn.onclick = () => (playing ? pause() : play());

scrub.addEventListener('input', () => {
  pause();
  tNow = parseFloat(scrub.value);
  applyFrame(tNow, { seek: true });
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,select,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
});

/* ------------------------------- fit -------------------------------- */

function fitToViewport() {
  if (document.body.classList.contains('headless')) return;
  const box = fitEl.getBoundingClientRect();
  const availW = Math.max(40, box.width  - 8);
  const availH = Math.max(40, box.height - 8);
  const s = Math.min(availW / STATE.output.w, availH / STATE.output.h, 1);
  stage.style.transform = `scale(${s})`;
  fitLbl.textContent = `${STATE.output.w}x${STATE.output.h} · ${STATE.output.fps}fps · ${Math.round(s * 100)}%`;
}
window.addEventListener('resize', fitToViewport);
new ResizeObserver(() => fitToViewport()).observe(fitEl);

/* ---------------------------- control schema ------------------------ */

const R = (k, label, min, max, step, unit) => ({ k, label, min, max, step, unit, type: 'range' });

const placement = (p) => [
  R(`${p}.baseX`, 'Position X', -900, 900, 1, 'px'),
  R(`${p}.baseY`, 'Position Y', -600, 600, 1, 'px'),
  R(`${p}.rotY`,  'Yaw',        -45,  45,  0.5, '°'),
  R(`${p}.rotX`,  'Pitch',      -35,  35,  0.5, '°'),
  R(`${p}.rotZ`,  'Roll',       -25,  25,  0.5, '°'),
  R(`${p}.scale`, 'Scale',      0.4,  2,   0.01, 'x'),
];

const motion = (p) => [
  R(`${p}.bobAmp`,    'Bob amount',   0, 80, 1,    'px'),
  R(`${p}.bobSpeed`,  'Bob speed',    0, 3,  0.01, ''),
  R(`${p}.swayAmp`,   'Sway amount',  0, 80, 1,    'px'),
  R(`${p}.swaySpeed`, 'Sway speed',   0, 3,  0.01, ''),
  R(`${p}.zAmp`,      'Depth drift',  0, 150,1,    'px'),
  R(`${p}.zSpeed`,    'Depth speed',  0, 3,  0.01, ''),
  R(`${p}.tiltYAmp`,  'Tilt Y amount',0, 20, 0.1,  '°'),
  R(`${p}.tiltYSpeed`,'Tilt Y speed', 0, 3,  0.01, ''),
  R(`${p}.tiltXAmp`,  'Tilt X amount',0, 20, 0.1,  '°'),
  R(`${p}.tiltXSpeed`,'Tilt X speed', 0, 3,  0.01, ''),
  R(`${p}.rollAmp`,   'Roll amount',  0, 12, 0.1,  '°'),
  R(`${p}.rollSpeed`, 'Roll speed',   0, 3,  0.01, ''),
  R(`${p}.seed`,      'Phase offset', 0, 20, 0.1,  ''),
];

const footage = (p) => [
  { k: `__file_${p}`, label: 'Source file', type: 'file', phone: p },
  R(`${p}.trimIn`, 'Trim in',       0, 15, 0.1,  's'),
  R(`${p}.rate`,   'Playback rate', 0.25, 2, 0.01,'x'),
];

const SCHEMA = [
  { title: 'Output', open: true, items: [
    { k: '__size', label: 'Size', type: 'select', options: [
      ['1920x1080','1920 x 1080'], ['2560x1440','2560 x 1440'],
      ['1080x1080','1080 x 1080'], ['1080x1920','1080 x 1920'],
      ['1440x1080','1440 x 1080'],
    ]},
    { k: 'output.fps', label: 'Frame rate', type: 'select',
      options: [[24,'24'],[30,'30'],[60,'60']], cast: Number },
    R('output.duration', 'Duration', 5, 30, 0.5, 's'),
    R('master.speed',    'Master speed', 0.25, 2, 0.01, 'x'),
  ]},

  { title: 'Scene', open: true, items: [
    R('scene.basePw',     'Phone size',  120, 520, 1, 'px'),
    R('scene.perspective','Perspective', 800, 6000, 10, 'px'),
    R('scene.rotY',       'Camera yaw',  -30, 30, 0.5, '°'),
    R('scene.rotX',       'Camera pitch',-30, 30, 0.5, '°'),
    R('scene.zoom',       'Zoom',        0.4, 2, 0.01, 'x'),
    R('scene.glare',      'Screen glare',0, 0.6, 0.005, ''),
    R('scene.vignette',   'Vignette',    0, 1, 0.01, ''),
    { k: 'scene.bgTop',    label: 'BG top',    type: 'color' },
    { k: 'scene.bgBottom', label: 'BG bottom', type: 'color' },
    { k: 'a.bodyColor',    label: 'Phone A body', type: 'color' },
    { k: 'b.bodyColor',    label: 'Phone B body', type: 'color' },
  ]},

  { title: 'Shadow', items: [
    R('scene.shadowOpacity','Opacity', 0, 1, 0.01, ''),
    R('scene.shadowBlur',   'Blur',    0, 140, 1, 'px'),
    R('scene.floorY',       'Floor height', 0, 900, 1, 'px'),
  ]},

  { title: 'Choreography', open: true, items: [
    { k: 'choreo.enabled', label: 'Enable depth swap', type: 'check' },
    R('choreo.swapTime', 'Swap at',       0, 30, 0.1, 's'),
    R('choreo.swapDur',  'Swap duration', 0.2, 8, 0.1, 's'),
    R('choreo.frontZ',   'Front depth',  -200, 600, 5, 'px'),
    R('choreo.backZ',    'Back depth',   -1200, 200, 5, 'px'),
    R('choreo.backBlur', 'Back blur',     0, 16, 0.1, 'px'),
    R('choreo.tuck',     'Back tuck',    -400, 400, 5, 'px'),
  ]},

  { title: 'Phone A — placement', open: true, items: [
    { k: 'link', label: 'Link A ↔ B motion', type: 'check' },
    ...placement('a'),
  ]},
  { title: 'Phone A — motion',  items: motion('a') },
  { title: 'Phone A — footage', items: footage('a') },

  { title: 'Phone B — placement', items: placement('b') },
  { title: 'Phone B — motion',    items: motion('b') },
  { title: 'Phone B — footage',   items: footage('b') },
];

/* --------------------------- control render ------------------------- */

const bindings = new Map();   // path -> fn(value) to refresh the widget

function commit(path, value) {
  if (path === '__size') {
    const [w, h] = value.split('x').map(Number);
    STATE.output.w = w; STATE.output.h = h;
  } else {
    setPath(STATE, path, value);
  }

  // mirror motion params across phones when linked
  const m = path.match(/^([ab])\.(.+)$/);
  if (m && STATE.link && LINKED.includes(m[2])) {
    const other = m[1] === 'a' ? 'b' : 'a';
    const op = `${other}.${m[2]}`;
    setPath(STATE, op, value);
    bindings.get(op)?.(value);
  }

  applyScene();
  applyFrame(tNow, { seek: !playing });
  savePrefs();
}

function makeControl(it) {
  const row = document.createElement('div');
  row.className = 'row' + (it.type === 'range' ? '' : ' inline');

  const lab = document.createElement('label');
  lab.textContent = it.label;
  lab.title = it.label;
  row.appendChild(lab);

  if (it.type === 'range') {
    const val = document.createElement('input');
    val.className = 'val';
    val.type = 'text';
    val.inputMode = 'decimal';
    val.spellcheck = false;
    val.title = `${it.label} (${it.min} to ${it.max})`;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = it.min; input.max = it.max; input.step = it.step;

    // 2dp max, trailing zeros trimmed — so 0.55 reads as "0.55" and 16 as "16"
    const fmt = (v) => String(Math.round(+v * 100) / 100);
    const show = (v) => {
      input.value = v;
      if (document.activeElement !== val) val.value = fmt(v) + (it.unit || '');
      val.classList.remove('invalid');
    };

    /* Typing commits an exact float, which may sit between slider steps. State
       keeps the precise value; the slider thumb just snaps to the nearest step. */
    const commitText = () => {
      const raw = val.value.replace(/[^0-9eE.+-]/g, '').trim();
      const n = parseFloat(raw);
      if (!isFinite(n)) {
        const cur = getPath(STATE, it.k);
        show(cur);
        val.value = fmt(cur) + (it.unit || '');
        return;
      }
      const clamped = clamp(n, it.min, it.max);
      commit(it.k, clamped);
      show(clamped);
      // show() leaves the field alone while it has focus, which is wrong here:
      // a clamped or reformatted value must be reflected even mid-blur.
      val.value = fmt(clamped) + (it.unit || '');
    };

    val.addEventListener('focus', () => {
      val.value = fmt(getPath(STATE, it.k));
      requestAnimationFrame(() => val.select());
    });
    val.addEventListener('blur', commitText);
    val.addEventListener('input', () => {
      const n = parseFloat(val.value.replace(/[^0-9eE.+-]/g, ''));
      val.classList.toggle('invalid', val.value.trim() !== '' && !isFinite(n));
    });
    val.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); commitText(); val.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); show(getPath(STATE, it.k)); val.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const mult = e.shiftKey ? 10 : 1;
        const base = parseFloat(val.value.replace(/[^0-9eE.+-]/g, '')) || 0;
        const next = clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * it.step * mult, it.min, it.max);
        val.value = fmt(next);
        commit(it.k, next);
        input.value = next;
      }
    });

    show(getPath(STATE, it.k));
    input.addEventListener('input', () => { show(parseFloat(input.value)); commit(it.k, parseFloat(input.value)); });
    bindings.set(it.k, show);

    row.append(val, input);
    return row;
  }

  if (it.type === 'file') {
    row.className = 'row file';
    const btn = document.createElement('button');
    btn.className = 'choose';
    btn.type = 'button';
    btn.textContent = 'Choose…';
    btn.addEventListener('click', () => pickFile(it.phone));

    const name = document.createElement('div');
    name.className = 'filename';
    name.dataset.filename = it.phone;
    name.textContent = '—';
    name.title = 'Video or image. You can also drop a file onto the phone, or click the + on its screen.';

    row.append(btn, name);
    return row;
  }

  if (it.type === 'check') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!getPath(STATE, it.k);
    input.addEventListener('change', () => commit(it.k, input.checked));
    bindings.set(it.k, (v) => { input.checked = !!v; });
    row.appendChild(input);
    return row;
  }

  if (it.type === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = getPath(STATE, it.k);
    input.addEventListener('input', () => commit(it.k, input.value));
    bindings.set(it.k, (v) => { input.value = v; });
    row.appendChild(input);
    return row;
  }

  // select
  const sel = document.createElement('select');
  for (const [v, t] of it.options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = it.k === '__size' ? `${STATE.output.w}x${STATE.output.h}` : getPath(STATE, it.k);
  sel.addEventListener('change', () => commit(it.k, it.cast ? it.cast(sel.value) : sel.value));
  bindings.set(it.k, (v) => { sel.value = v; });
  row.appendChild(sel);
  return row;
}

function renderControls() {
  const root = $('#controls');
  root.innerHTML = '';
  bindings.clear();
  for (const g of SCHEMA) {
    const d = document.createElement('details');
    d.className = 'group';
    if (g.open) d.open = true;
    const sum = document.createElement('summary');
    const label = document.createElement('span');
    label.className = 'summary-label';
    label.textContent = g.title;
    sum.appendChild(label);

    // reset just this section; keys come from the group's own schema
    const keys = g.items.map((it) => it.k).filter((k) => !k.startsWith('__'));
    if (keys.length) {
      const rb = document.createElement('button');
      rb.className = 'reset-group';
      rb.type = 'button';
      rb.textContent = 'reset';
      rb.title = `Reset ${g.title} to defaults`;
      rb.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();          // don't toggle the <details>
        resetKeys(keys);
      });
      sum.appendChild(rb);
    }
    d.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'group-body';
    for (const it of g.items) body.appendChild(makeControl(it));
    d.appendChild(body);
    root.appendChild(d);
  }
}

/* ---------------------------- persistence --------------------------- */

const LS_KEY = 'mockup-studio.state.v1';

function deepMerge(base, over) {
  const out = structuredClone(base);
  for (const k in over) {
    const v = over[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v))
      ? deepMerge(base[k] ?? {}, v)
      : v;
  }
  return out;
}

let saveTimer = null;
function savePrefs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(STATE)); } catch {}
  }, 250);
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) STATE = deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {}
}

function resetKeys(keys) {
  for (const k of keys) {
    const dflt = getPath(DEFAULTS, k);
    if (dflt === undefined) continue;
    setPath(STATE, k, dflt);
    bindings.get(k)?.(dflt);
  }
  applyScene();
  applyFrame(tNow, { seek: !playing });
  savePrefs();
}

$('#btn-reset').onclick = () => {
  STATE = structuredClone(DEFAULTS);
  renderControls(); applyScene(); applyFrame(tNow, { seek: true }); savePrefs();
};

/* ------------------------------ media ------------------------------- */

function loadMedia(key, src, isImage) {
  const e = els[key];
  e.isImage = !!isImage;
  return new Promise((resolve) => {
    if (isImage) {
      e.video.removeAttribute('src');
      e.video.load();
      e.img.onload  = () => resolve(e.img);
      e.img.onerror = () => resolve(null);
      e.img.src = src;
      return;
    }
    const v = e.video;
    v.addEventListener('loadedmetadata', () => resolve(v), { once: true });
    v.addEventListener('error', () => resolve(null), { once: true });
    v.src = src;
    v.load();
  });
}

/* Uploads the chosen file so the renderer reads the same bytes the preview
   does — the browser never exposes a real path, so this has to copy. */
async function uploadMedia(key, file) {
  const label = $(`[data-filename="${key}"]`);
  const prev = label ? label.textContent : '';
  if (label) label.textContent = 'Uploading…';
  try {
    const r = await fetch('/media/' + key, {
      method: 'POST',
      headers: { 'X-Filename': file.name, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    await loadMedia(key, `/media/${key}?t=${Date.now()}`, j.isImage);
    applyFrame(tNow, { seek: true });
    if (label) label.textContent = j.name;
    return true;
  } catch (e) {
    if (label) label.textContent = prev || 'failed';
    alert(`Could not load that file: ${e.message}`);
    return false;
  }
}

function pickFile(key) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'video/*,image/*';
  inp.addEventListener('change', () => { if (inp.files[0]) uploadMedia(key, inp.files[0]); });
  inp.click();
}

for (const key of ['a','b']) {
  const host = els[key].phone;
  host.addEventListener('dragover', (e) => { e.preventDefault(); host.classList.add('dropping'); });
  host.addEventListener('dragleave', () => host.classList.remove('dropping'));
  host.addEventListener('drop', async (e) => {
    e.preventDefault();
    host.classList.remove('dropping');
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (!/^(video|image)\//.test(f.type)) { alert('Drop a video or image file.'); return; }
    await uploadMedia(key, f);
  });

  // click the + overlay on the screen to open the native picker
  $('.screen-drop', els[key].phone).addEventListener('click', (e) => {
    e.preventDefault();
    if ($('#controls').classList.contains('busy')) return;
    pickFile(key);
  });
}

/* ---------------------------- headless API -------------------------- */

function waitSeek(v) {
  if (!v.seeking) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { clearTimeout(to); res(); };
    const to = setTimeout(done, 2000);
    v.addEventListener('seeked', done, { once: true });
  });
}

const nextPaint = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

let readyResolve;
const ready = new Promise((r) => (readyResolve = r));

window.MockupStudio = {
  ready,
  getState: () => structuredClone(STATE),
  setState(s) {
    STATE = deepMerge(DEFAULTS, s);
    renderControls(); applyScene(); applyFrame(tNow, { seek: true });
  },
  async seek(t) {
    pause();
    applyFrame(t, { seek: true });
    await Promise.all(['a','b'].map((k) => els[k].isImage ? Promise.resolve() : waitSeek(els[k].video)));
    drawScreen('a');
    drawScreen('b');
    await nextPaint();
  },
  duration: () => STATE.output.duration,
  fps: () => STATE.output.fps,
};

/* ------------------------------ splitter ---------------------------- */

const PANEL_KEY = 'mockup-studio.panelWidth';
const panel = $('#panel');
const splitter = $('#splitter');

function setPanelWidth(px) {
  const w = clamp(px, 260, Math.min(640, window.innerWidth - 320));
  panel.style.setProperty('--panel-w', w + 'px');
  try { localStorage.setItem(PANEL_KEY, String(w)); } catch {}
  fitToViewport();
}

splitter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  splitter.setPointerCapture(e.pointerId);
  splitter.classList.add('dragging');
  document.body.classList.add('resizing');

  const move = (ev) => setPanelWidth(ev.clientX);
  const up = () => {
    splitter.classList.remove('dragging');
    document.body.classList.remove('resizing');
    splitter.removeEventListener('pointermove', move);
    splitter.removeEventListener('pointerup', up);
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up);
});

// double-click the divider to snap back to the default width
splitter.addEventListener('dblclick', () => setPanelWidth(330));

/* ------------------------------- export ----------------------------- */

const expScale  = $('#exp-scale');
const expPreset = $('#exp-preset');
const btnExport = $('#btn-export');
const btnCancel = $('#btn-cancel');
const liveBox   = $('#export-live');
const barFill   = $('#bar-fill');
const expMsg    = $('#export-msg');
const expResult = $('#export-result');

let pollTimer = null;

function setBusy(on) {
  $('#controls').classList.toggle('busy', on);
  $('.export-opts').classList.toggle('busy', on);
  btnExport.disabled = on;
  btnExport.textContent = on ? 'Exporting…' : 'Export video';
  liveBox.hidden = !on;
  playBtn.disabled = on;
  scrub.disabled = on;
  if (on) pause();
}

const mmss = (s) => {
  if (s == null || !isFinite(s)) return '';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
};

async function startExport() {
  expResult.hidden = true;
  expResult.className = '';
  setBusy(true);
  barFill.style.width = '0%';
  barFill.classList.add('indeterminate');
  expMsg.textContent = 'Starting renderer…';

  try {
    const r = await fetch('/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: STATE,
        scale: Number(expScale.value),
        preset: expPreset.value,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  } catch (e) {
    finishExport({ error: `Could not start export: ${e.message}` });
    return;
  }

  clearInterval(pollTimer);
  pollTimer = setInterval(pollExport, 500);
}

async function pollExport() {
  let j;
  try {
    j = await (await fetch('/export/status', { cache: 'no-store' })).json();
  } catch {
    return;   // transient; keep polling
  }

  if (j.total > 0) {
    barFill.classList.remove('indeterminate');
    const pct = Math.round((j.frame / j.total) * 100);
    barFill.style.width = pct + '%';
    expMsg.textContent = `${pct}%  ·  frame ${j.frame}/${j.total}` +
                         (j.etaSec != null ? `  ·  ${mmss(j.etaSec)} left` : '');
  }

  if (!j.running && !j.idle) {
    clearInterval(pollTimer);
    finishExport(j);
  }
}

function finishExport(j) {
  clearInterval(pollTimer);
  setBusy(false);
  barFill.classList.remove('indeterminate');
  expResult.hidden = false;

  if (j.error) {
    expResult.className = 'err';
    expResult.textContent = j.error;
    return;
  }

  barFill.style.width = '100%';     // last progress sample lands a frame or two short
  expResult.className = 'ok';
  expResult.innerHTML =
    `Exported in ${mmss(j.seconds)}${j.mb ? ` · ${j.mb} MB` : ''}` +
    `<a class="file" href="/out/${encodeURIComponent(j.name)}" target="_blank" rel="noopener">${j.name}</a>`;
}

btnExport.addEventListener('click', startExport);
btnCancel.addEventListener('click', async () => {
  expMsg.textContent = 'Cancelling…';
  try { await fetch('/export/cancel', { method: 'POST' }); } catch {}
});

/* ------------------------------- boot ------------------------------- */

(async function boot() {
  const params = new URLSearchParams(location.search);
  const headless = params.get('headless') === '1';

  if (headless) {
    // localStorage doesn't cross into the render browser, so the headless pass
    // reads the state the panel last wrote with "Save".
    document.body.classList.add('headless');
    try {
      const r = await fetch('/state.json', { cache: 'no-store' });
      if (r.ok) STATE = deepMerge(DEFAULTS, await r.json());
    } catch {}
  } else {
    loadPrefs();
  }
  renderControls();
  applyScene();

  let info = {};
  try { info = await (await fetch('/media/info', { cache: 'no-store' })).json(); } catch {}
  await Promise.all([
    loadMedia('a', '/media/a?t=' + Date.now(), info.a?.isImage),
    loadMedia('b', '/media/b?t=' + Date.now(), info.b?.isImage),
  ]);
  for (const k of ['a','b']) {
    const lab = $(`[data-filename="${k}"]`);
    if (lab) lab.textContent = info[k]?.name || '—';
  }

  try {
    const w = Number(localStorage.getItem(PANEL_KEY));
    if (w) setPanelWidth(w);
  } catch {}

  applyFrame(0, { seek: true });
  fitToViewport();

  // if a render is already running (page reloaded mid-export), reattach to it
  if (!headless) {
    try {
      const j = await (await fetch('/export/status', { cache: 'no-store' })).json();
      if (j.running) { setBusy(true); pollTimer = setInterval(pollExport, 500); }
    } catch {}
  }

  readyResolve(true);
})();
