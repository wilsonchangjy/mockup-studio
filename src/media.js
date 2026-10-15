/* =====================================================================
   Media

   Assets are the user's uploaded files, held as Blobs in memory — they
   never leave the browser. Each device screen gets its own ScreenFeed: its
   own <video> element (so two devices can show the same clip with
   different trims) and its own texture (so each can be cover-fitted to
   its own screen shape).
   ===================================================================== */

import * as THREE from 'three';
import { state, commit, uid } from './state.js';
import { setScreenImage } from './devices.js';

const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;

export const kindOf = (file) =>
  file.type.startsWith('video/') || VIDEO_EXT.test(file.name) ? 'video'
  : file.type.startsWith('image/') || IMAGE_EXT.test(file.name) ? 'image'
  : null;

function loadVideoMeta(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('This video format can’t be decoded by your browser.'));
    v.src = url;
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image couldn’t be read.'));
    img.src = url;
  });
}

async function thumbnail(source, w, h) {
  const tw = 180, th = Math.round(tw * (h / w));
  const c = document.createElement('canvas');
  c.width = tw; c.height = Math.min(th, 400);
  const ctx = c.getContext('2d');
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

async function analyse(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`“${file.name}” isn’t a video or image.`);
  const url = URL.createObjectURL(file);
  try {
    if (kind === 'video') {
      const v = await loadVideoMeta(url);
      const duration = v.duration;
      // grab a representative frame rather than a black first frame
      await new Promise((r) => { v.onseeked = r; v.currentTime = Math.min(1, duration / 3); });
      const thumb = await thumbnail(v, v.videoWidth, v.videoHeight);
      return { kind, url, width: v.videoWidth, height: v.videoHeight, duration, thumb };
    }
    const img = await loadImage(url);
    const thumb = await thumbnail(img, img.naturalWidth, img.naturalHeight);
    return { kind, url, width: img.naturalWidth, height: img.naturalHeight, duration: 0, thumb };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/* A file's identity, whatever it's called: its size and a hash of its first
   and last 256 KB. Quick even for long recordings, and two different
   recordings of the same length don't share their opening and closing
   bytes. */
async function fingerprint(file) {
  const K = 256 * 1024;
  const head = await file.slice(0, K).arrayBuffer();
  const tail = file.size > K ? await file.slice(Math.max(K, file.size - K)).arrayBuffer() : new ArrayBuffer(0);
  const both = new Uint8Array(head.byteLength + tail.byteLength);
  both.set(new Uint8Array(head), 0);
  both.set(new Uint8Array(tail), head.byteLength);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', both));
  return `${file.size}:${[...hash].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Import files into the asset library. A file that's already there (even
    renamed) isn't added twice: its existing asset is returned instead.
    Resolves to { added, reused, errors } — `added` lists the asset for every
    file, new or existing, in order; `reused` the ones already there. */
export async function importFiles(files) {
  const added = [], reused = [], fresh = [], errors = [];
  for (const file of files) {
    try {
      const fp = await fingerprint(file);
      const known = state.assets.find((a) => a.fingerprint === fp) || fresh.find((a) => a.fingerprint === fp);
      if (known) {
        if (!added.includes(known)) { added.push(known); reused.push(known); }
        continue;
      }
      const meta = await analyse(file);
      const asset = { id: uid('a'), name: file.name, file, fingerprint: fp, ...meta };
      fresh.push(asset);
      added.push(asset);
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (fresh.length) commit('assets', (s) => s.assets.push(...fresh));
  return { added, reused, errors };
}

export function removeAsset(id) {
  const a = state.assets.find((x) => x.id === id);
  if (!a) return;
  commit('assets', (s) => {
    s.assets = s.assets.filter((x) => x.id !== id);
    for (const d of s.devices) {
      if (d.media === id) d.media = null;
      if (d.second?.media === id) d.second.media = null;
    }
  });
  commit('devices');
  URL.revokeObjectURL(a.url);
}

/* ------------------------------ textures ------------------------------ */

/* Screens are often drawn much smaller than their footage (a 1179px-wide
   recording on a phone 150px wide in the frame) and at an angle. Without
   mipmaps that minification skips texels — jagged, shimmering UI text; without
   anisotropic filtering, angled screens go soft along one axis. Every screen
   texture gets both. The renderer reports its anisotropy limit at startup. */
let maxAnisotropy = 1;
export function setMaxAnisotropy(n) { maxAnisotropy = Math.max(1, n || 1); }
export function sharpen(tex) {
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function placeholderTexture(aspect, landscape, back) {
  const W = 512, H = Math.round(W / (landscape ? 1 / aspect : aspect));
  const c = document.createElement('canvas');
  c.width = W; c.height = Math.max(64, Math.min(H, 1400));
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#1c2029'); grad.addColorStop(1, '#0c0e12');
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  const cx = c.width / 2, cy = c.height / 2, r = Math.min(c.width, c.height) * 0.09;
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(2, r * 0.08);
  g.beginPath(); g.arc(cx, cy - r * 0.6, r, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  g.moveTo(cx - r * 0.45, cy - r * 0.6); g.lineTo(cx + r * 0.45, cy - r * 0.6);
  g.moveTo(cx, cy - r * 1.05); g.lineTo(cx, cy - r * 0.15); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.6)';
  g.font = `500 ${Math.round(r * 0.55)}px -apple-system, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText('Drop media here', cx, cy + r * 1.1);
  const t = sharpen(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  if (landscape) { t.center.set(0.5, 0.5); t.rotation = turn(back); }
  return t;
}

/* A device turned on its side turns its footage back the other way, so it
   stays upright. Seen from behind, the device turns the opposite way, so a
   screen on the back (an open foldable's cover screen) does too. */
const turn = (back) => (back ? Math.PI / 2 : -Math.PI / 2);

/** Cover-fit a texture onto a screen of `screenAspect` (w/h, in the device's
    native orientation). Landscape handhelds rotate the texture 90° so footage
    stays upright when the device itself is turned on its side. */
export function coverFit(tex, mediaAspect, screenAspect, landscape, back = false) {
  const esa = landscape ? 1 / screenAspect : screenAspect;
  tex.center.set(0.5, 0.5);
  tex.rotation = landscape ? turn(back) : 0;
  if (mediaAspect > esa) tex.repeat.set(esa / mediaAspect, 1);
  else tex.repeat.set(1, mediaAspect / esa);
  tex.offset.set(0, 0);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
}

/* ----------------------------- ScreenFeed ----------------------------- */

export class ScreenFeed {
  /** back: the screen faces the device's back (an open foldable's cover screen). */
  constructor(screenMesh, screenAspect, requestRender, { back = false } = {}) {
    this.mesh = screenMesh;
    this.screenAspect = screenAspect;
    this.back = back;
    this.requestRender = requestRender;
    this.asset = null;
    this.video = null;
    this.tex = null;
    this.landscape = false;
    this.trim = 0;
    this.rate = 1;
    this.showPlaceholder();
  }

  setOrientation(landscape) {
    if (this.landscape === landscape) return;
    this.landscape = landscape;
    if (this.asset) this.fit(); else this.showPlaceholder();
  }

  showPlaceholder() {
    this.disposeTexture();
    this.tex = placeholderTexture(this.screenAspect, this.landscape, this.back);
    setScreenImage(this.mesh.material, this.tex);
    this.requestRender();
  }

  fit() {
    if (!this.tex || !this.asset) return;
    coverFit(this.tex, this.asset.width / this.asset.height, this.screenAspect, this.landscape, this.back);
    this.requestRender();
  }

  setAsset(asset) {
    if (this.asset?.id === asset?.id) return;
    this.teardownVideo();
    this.asset = asset || null;
    if (!asset) return this.showPlaceholder();

    this.disposeTexture();
    if (asset.kind === 'video') {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = false;
      v.src = asset.url;
      v.addEventListener('seeked', () => { this.markFrame(); });
      v.addEventListener('loadeddata', () => { this.markFrame(); });
      this.video = v;
      /* Must be a VideoTexture, not a plain Texture: three.js sizes a plain
         texture from image.width/height, which for a <video> is the element's
         layout width (0 when detached) — giving a 0×0, permanently black upload.
         VideoTexture takes a separate path that reads the frame directly. */
      this.tex = new THREE.VideoTexture(v);
    } else {
      const img = new Image();
      img.onload = () => { this.tex.needsUpdate = true; this.requestRender(); };
      img.src = asset.url;
      this.tex = new THREE.Texture(img);
    }
    this.tex.colorSpace = THREE.SRGBColorSpace;
    sharpen(this.tex);          // VideoTexture defaults to no mipmaps; that's the blur/aliasing
    this.fit();
    setScreenImage(this.mesh.material, this.tex);
  }

  markFrame() {
    if (this.video && this.video.readyState >= 2 && this.tex) {
      this.tex.needsUpdate = true;
      this.requestRender();
    }
  }

  /** Video-time for composition-time t: trimmed, rate-scaled, looping. */
  videoTime(t) {
    const d = this.asset?.duration || 0;
    if (!d) return 0;
    const span = Math.max(0.05, d - this.trim);
    return this.trim + ((t * this.rate) % span);
  }

  sync(t, playing) {
    const v = this.video;
    if (!v) return;
    const want = this.videoTime(t);
    if (playing) {
      v.playbackRate = Math.max(0.0625, Math.min(16, this.rate));
      if (v.paused) { v.currentTime = want; v.play().catch(() => {}); }
      else if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;   // only fix real drift
      this.markFrame();
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 1 / 240) v.currentTime = want;    // 'seeked' repaints
    }
  }

  teardownVideo() {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
  }

  disposeTexture() {
    if (this.tex) { this.tex.dispose(); this.tex = null; }
  }

  dispose() {
    this.teardownVideo();
    this.disposeTexture();
  }
}
