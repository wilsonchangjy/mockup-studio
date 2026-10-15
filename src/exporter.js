/* =====================================================================
   Export — entirely in the browser

   The composition is a pure function of time, so export steps through it
   one frame at a time: pose the scene, draw each screen's exact frame,
   render, hand the canvas to a WebCodecs VideoEncoder, mux to MP4. No
   server, no upload, and a slow machine just exports slower rather than
   dropping frames.

   Screens switch from their live <video> preview textures to canvases fed
   by frame-exact sources (decoder.js) for the duration of the export.
   ===================================================================== */

import * as THREE from 'three';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { state, output, device as deviceById, asset as assetById } from './state.js';
import { openSource } from './decoder.js';
import { coverFit, sharpen } from './media.js';
import { MODELS, setScreenImage, screenImage } from './devices.js';

export const canExportVideo = () => 'VideoEncoder' in window && 'VideoFrame' in window;

/* Recommended H.264 bitrate in Mbps. 16 Mbps at 1080p30 keeps UI text crisp
   in motion (YouTube's own guidance is 8; screen content needs more). Scales
   with pixel count^0.75 and frame rate^0.6, which lands close to the usual
   figures elsewhere: ~45 Mbps for 4K30, ~24 for 1080p60, ~68 for 4K60. */
export function recommendedBitrate(w, h, fps) {
  const px = (w * h) / (1920 * 1080);
  const mbps = 16 * Math.pow(px, 0.75) * Math.pow(fps / 30, 0.6);
  return Math.round(Math.min(80, Math.max(4, mbps)));
}

/* Quality slider (1–100) → Mbps. 80 is the recommended rate above; every 20
   steps halves or doubles it, so 100 is 2× and 60 is ½. At 1080p30 that's
   ~0.8 Mbps at 1, 8 at 60, 16 at 80 and 32 at 100. */
export const DEFAULT_QUALITY = 80;
export function bitrateForQuality(q, w, h, fps) {
  const mbps = recommendedBitrate(w, h, fps) * Math.pow(2, (q - DEFAULT_QUALITY) / 20);
  return Math.min(120, Math.max(0.5, mbps));
}

/* Supersampling: render at up to 2× the output and scale down, which smooths
   edges well beyond what MSAA alone manages. Capped at a 4K-sized render
   (~8.3 MP) so memory stays sane — a 4K export therefore isn't supersampled. */
function supersampleFor(vp, w, h) {
  const byPixels = Math.sqrt(8.4e6 / (w * h));
  const byGpu = vp.maxRenderSize() / Math.max(w, h);
  const ss = Math.min(2, byPixels, byGpu);
  return ss >= 1.25 ? ss : 1;
}

/** Copy the (possibly supersampled) WebGL canvas into an output-sized canvas. */
function downsampler(src, w, h) {
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return {
    canvas: out,
    capture() {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(src, 0, 0, w, h);   // same task as the render, so the GL buffer is still intact
      return out;
    },
  };
}

export function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/* --------------------------- exact screens --------------------------- */

/** Every screen on stage — a device's main one, and an open foldable's
    cover screen — with its feed, shape and media. */
function stageScreens(vp) {
  const out = [];
  for (const [id, r] of vp.runtime) {
    const d = deviceById(id);
    out.push({ d, r, mesh: r.built.screen, feed: r.feed, aspect: r.built.screenAspect, media: d?.media });
    if (r.built.cover) out.push({ d, r, mesh: r.built.cover, feed: r.feed2, aspect: r.built.coverAspect, media: d?.second?.media });
  }
  return out;
}

async function openScreens(vp) {
  const screens = [];
  for (const { d, mesh, feed, aspect, media } of stageScreens(vp)) {
    const mat = mesh.material;
    const entry = { feed, mat, prev: screenImage(mat), source: null };
    const a = media ? assetById(media) : null;

    if (!a) {
      // an empty screen exports as a switched-off display, not a "drop here" prompt
      setScreenImage(mat, null);
    } else if (a.kind === 'video') {
      const { source, exact } = await openSource(a);
      const canvas = document.createElement('canvas');
      const longEdge = Math.max(a.width, a.height), cap = 3072;
      const k = longEdge > cap ? cap / longEdge : 1;
      canvas.width = Math.round(a.width * k);
      canvas.height = Math.round(a.height * k);
      const tex = sharpen(new THREE.CanvasTexture(canvas));
      tex.colorSpace = THREE.SRGBColorSpace;
      const fam = MODELS[d.model].family;
      coverFit(tex, a.width / a.height, aspect, !!d.landscape && (fam === 'phone' || fam === 'tablet'), feed.back);
      Object.assign(entry, { source, exact, canvas, ctx: canvas.getContext('2d'), tex });
      setScreenImage(mat, tex);
    }
    screens.push(entry);
  }
  return screens;
}

async function drawScreens(screens, t) {
  for (const s of screens) {
    if (!s.source) continue;
    const frame = await s.source.frameAt(s.feed.videoTime(t));
    if (frame) {
      s.ctx.drawImage(frame, 0, 0, s.canvas.width, s.canvas.height);
      s.tex.needsUpdate = true;
    }
  }
}

function closeScreens(screens) {
  for (const s of screens) {
    s.source?.close();
    s.tex?.dispose();
    setScreenImage(s.mat, s.prev);
  }
}

/* ------------------------------- image ------------------------------- */

export async function exportImage(vp, { format = 'png', transparent = false, scale = 1 } = {}) {
  const o = output();
  const cap = 8192;
  const k = Math.min(scale, cap / Math.max(o.w, o.h));
  const width = Math.round(o.w * k), height = Math.round(o.h * k);
  const ss = supersampleFor(vp, width, height);
  await vp.modelsReady();
  const screens = await openScreens(vp);
  vp.beginExport({ width, height, transparent: transparent && format === 'png', supersample: ss });
  try {
    vp.applyTime(state.time);
    await drawScreens(screens, state.time);
    vp.renderScene();   // includes the contact shadow
    const target = ss > 1 ? downsampler(vp.renderer.domElement, width, height).capture() : vp.renderer.domElement;
    // toBlob snapshots the canvas synchronously, before anything else draws
    const blob = await new Promise((res) =>
      target.toBlob(res, format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95));
    if (!blob) throw new Error('The browser could not encode the image.');
    return { blob, name: `mockup-${stamp()}.${format}`, width, height, supersample: ss };
  } finally {
    closeScreens(screens);
    vp.endExport();
  }
}

/** Bytes the image export would produce with the current settings. PNG and
    JPG sizes depend on the picture, so this encodes the real thing: the same
    render as exportImage, but using the preview's own screen textures instead
    of decoding footage. Rendering and capture happen in one task, so the
    viewport never shows the resized canvas. */
export async function estimateImageSize(vp, { format = 'png', transparent = false, scale = 1 } = {}) {
  const o = output();
  const k = Math.min(scale, 8192 / Math.max(o.w, o.h));
  const width = Math.round(o.w * k), height = Math.round(o.h * k);
  const ss = supersampleFor(vp, width, height);
  // empty screens export as switched-off displays, not "drop here" prompts
  const blanked = [];
  for (const { mesh, media } of stageScreens(vp)) {
    if (media && assetById(media)) continue;
    const mat = mesh.material;
    blanked.push({ mat, prev: screenImage(mat) });
    setScreenImage(mat, null);
  }
  let canvas;
  vp.beginExport({ width, height, transparent: transparent && format === 'png', supersample: ss });
  try {
    vp.applyTime(state.time);
    vp.renderScene();
    canvas = downsampler(vp.renderer.domElement, width, height).capture();
  } finally {
    for (const b of blanked) setScreenImage(b.mat, b.prev);
    vp.endExport();
  }
  const blob = await new Promise((res) =>
    canvas.toBlob(res, format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95));
  return blob?.size ?? 0;
}

/* ------------------------------- video ------------------------------- */

/* The bitrate acts as a ceiling with the browser's encoder: simple footage
   comes in under it. ('constant' mode is accepted but ignored on macOS.) */
async function pickConfig(width, height, fps, bitrate) {
  const big = width * height > 2.3e6;
  const codecs = big
    ? ['avc1.640033', 'avc1.640034', 'avc1.4d0033']
    : ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640033'];
  for (const codec of codecs) {
    const cfg = { codec, width, height, bitrate, bitrateMode: 'variable', framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch {}
  }
  throw new Error(`This browser can’t encode H.264 at ${width}×${height}.`);
}

/**
 * onProgress(frame, total, etaSeconds). Pass an AbortSignal to cancel.
 * Resolves to { blob, name, exact } — `exact` is false if any clip had to use
 * the seek fallback instead of frame-exact decoding.
 */
export async function exportVideo(vp, { bitrate, onProgress, signal } = {}) {
  if (!canExportVideo()) throw new Error('Video export needs WebCodecs, which this browser doesn’t support.');
  const o = output();
  const width = o.w & ~1, height = o.h & ~1;      // H.264 needs even dimensions
  const fps = state.scene.fps;
  const total = Math.max(1, Math.round(state.scene.duration * fps));
  const bps = Math.round(bitrate || recommendedBitrate(width, height, fps) * 1e6);
  const cfg = await pickConfig(width, height, fps, bps);
  const ss = supersampleFor(vp, width, height);
  await vp.modelsReady();

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' });
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  encoder.configure(cfg);

  const screens = await openScreens(vp);
  vp.beginExport({ width, height, transparent: false, supersample: ss });
  const down = ss > 1 ? downsampler(vp.renderer.domElement, width, height) : null;
  const started = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (encodeError) throw encodeError;

      const t = i / fps;
      vp.applyTime(t);
      await drawScreens(screens, t);
      vp.renderScene();   // includes the contact shadow

      const frame = new VideoFrame(down ? down.capture() : vp.renderer.domElement, {
        timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps),
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      if (i % 2 === 0) await new Promise((r) => setTimeout(r, 0));   // keep the UI responsive

      const per = (performance.now() - started) / (i + 1);
      onProgress?.(i + 1, total, ((total - i - 1) * per) / 1000);
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      name: `mockup-${stamp()}.mp4`,
      exact: screens.every((s) => !s.source || s.exact),
      seconds: (performance.now() - started) / 1000,
      supersample: ss,
      bitrate: bps,
    };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    closeScreens(screens);
    vp.endExport();
  }
}
