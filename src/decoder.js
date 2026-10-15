/* =====================================================================
   Frame-exact sources for export

   Seeking an HTMLVideoElement is asynchronous, imprecise, and can land
   on a neighbouring frame — fine for a preview, wrong for an export that
   must match frame-for-frame. So for MP4/MOV we demux the file ourselves
   (mp4box) and decode with WebCodecs, walking forward through the samples.

   Exports step strictly forward in time, which suits a decoder: we only
   ever feed it more data. A backwards jump (the clip looping) resets to
   the nearest keyframe. At most a handful of decoded frames are alive at
   once, so memory stays flat however long the clip.

   Anything WebCodecs can't handle (WebM, an unsupported codec, a browser
   without the API) falls back to SeekSource — slower, but still exact
   enough because it waits for each seek to land before drawing.
   ===================================================================== */

import { createFile, DataStream, MP4BoxBuffer } from 'mp4box';

function codecDescription(trak) {
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);   // drop the 8-byte box header
    }
  }
  return undefined;
}

async function demux(file) {
  const buf = MP4BoxBuffer.fromArrayBuffer(await file.arrayBuffer(), 0);
  const mp4 = createFile();
  const samples = [];
  let track = null, error = null;

  mp4.onError = (_mod, msg) => { error = new Error(msg); };
  mp4.onReady = (info) => {
    track = info.videoTracks[0];
    if (!track) return;
    mp4.setExtractionOptions(track.id, null, { nbSamples: 1e9 });
    mp4.start();
  };
  mp4.onSamples = (_id, _user, s) => { for (const x of s) samples.push(x); };

  mp4.appendBuffer(buf, true);
  mp4.flush();
  // sample extraction is synchronous once the whole file is appended,
  // but give any deferred callbacks a tick to land
  await new Promise((r) => setTimeout(r, 0));

  if (error) throw error;
  if (!track) throw new Error('No video track found');
  if (!samples.length) throw new Error('No video samples found');
  const trak = mp4.getTrackById(track.id);
  return { track, trak, samples, startOffset: presentationStart(trak, samples) };
}

/* Where presentation time zero sits in the media timeline, in media ticks.

   Encoders that use B-frames store composition times shifted by the reorder
   delay (e.g. 2 frames), plus an edit list that shifts them back for playback.
   A <video> element applies the edit list — so if we didn't, every exported
   frame would lag the preview by that delay. Honour the edit list's media_time
   when present; otherwise fall back to the earliest composition time. */
function presentationStart(trak, samples) {
  const entries = trak?.edts?.elst?.entries || trak?.edts?.elsts?.[0]?.entries || [];
  const edit = entries.find((e) => Number(e.media_time) >= 0);   // -1 marks an empty edit
  if (edit) return Number(edit.media_time);
  return Math.min(...samples.map((s) => s.cts));
}

export class Mp4Source {
  static async create(file) {
    if (!('VideoDecoder' in window)) throw new Error('WebCodecs unavailable');
    const { track, trak, samples, startOffset } = await demux(file);
    const config = {
      codec: track.codec.startsWith('vp08') ? 'vp8' : track.codec,
      codedWidth: track.video.width,
      codedHeight: track.video.height,
      description: codecDescription(trak),
    };
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error(`Codec ${config.codec} not supported for decoding`);
    return new Mp4Source(config, samples, startOffset);
  }

  constructor(config, samples, startOffset = 0) {
    this.config = config;
    this.samples = samples.map((s) => ({
      ts: Math.round(((s.cts - startOffset) * 1e6) / s.timescale),
      dur: Math.round((s.duration * 1e6) / s.timescale),
      key: s.is_sync,
      data: s.data,
    }));
    this.lastTs = Math.max(...this.samples.map((s) => s.ts));
    this.frames = [];          // decoded, ascending timestamp
    this.next = 0;             // next sample (decode order) to feed
    this.flushed = false;
    this.waiters = [];
    this.err = null;
    this.makeDecoder();
  }

  makeDecoder() {
    this.decoder = new VideoDecoder({
      output: (f) => {
        this.frames.push(f);
        this.frames.sort((a, b) => a.timestamp - b.timestamp);
        this.wake();
      },
      error: (e) => { this.err = e; this.wake(); },
    });
    this.decoder.configure(this.config);
  }

  wake() { const w = this.waiters; this.waiters = []; w.forEach((fn) => fn()); }
  waitOutput() {
    return new Promise((r) => {
      this.waiters.push(r);
      setTimeout(r, 40);   // decoders may hold frames for reordering; keep feeding
    });
  }

  /** Restart decoding at the last keyframe at or before `ts`. */
  resetTo(ts) {
    let k = 0;
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].key && this.samples[i].ts <= ts) k = i;
    }
    for (const f of this.frames) f.close();
    this.frames = [];
    if (this.decoder.state !== 'closed') this.decoder.reset();
    this.decoder.configure(this.config);
    this.next = k;
    this.flushed = false;
  }

  /** The decoded frame on screen at video-time `t` (seconds). Owned by the
      source — draw it, don't close it. */
  async frameAt(t) {
    if (this.err) throw this.err;
    const ts = Math.min(Math.round(t * 1e6), this.lastTs);
    const head = this.frames[0];

    // moving backwards (a loop), or far ahead of what's decoded: re-seek
    const newest = this.frames[this.frames.length - 1];
    if ((head && ts < head.timestamp) || (!head && this.next > 0 && ts < this.samples[Math.max(0, this.next - 1)].ts)) {
      this.resetTo(ts);
    } else if (newest ? ts - newest.timestamp > 2e6 : (this.next === 0 && ts > 2e6)) {
      this.resetTo(ts);   // jump straight to a trim point instead of decoding up to it
    }

    // feed until we've decoded past ts (so the frame covering ts is known)
    let guard = 0;
    while (!this.frames.some((f) => f.timestamp > ts)) {
      if (this.err) throw this.err;
      if (this.next < this.samples.length) {
        const batchEnd = Math.min(this.samples.length, this.next + 6);
        for (; this.next < batchEnd; this.next++) {
          const s = this.samples[this.next];
          this.decoder.decode(new EncodedVideoChunk({
            type: s.key ? 'key' : 'delta', timestamp: s.ts, duration: s.dur, data: s.data,
          }));
        }
        if (this.decoder.decodeQueueSize > 3) await this.waitOutput();
      } else if (!this.flushed) {
        await this.decoder.flush();
        this.flushed = true;
      } else {
        break;   // end of stream: hold the last frame
      }
      if (++guard > 20000) throw new Error('Decoder made no progress');
      if (!this.frames.length) await this.waitOutput();
    }

    // keep the frame covering ts, drop everything older
    let pick = -1;
    for (let i = 0; i < this.frames.length; i++) if (this.frames[i].timestamp <= ts) pick = i;
    if (pick < 0) pick = 0;
    for (let i = 0; i < pick; i++) this.frames[i].close();
    this.frames = this.frames.slice(pick);
    return this.frames[0] || null;
  }

  close() {
    for (const f of this.frames) f.close();
    this.frames = [];
    if (this.decoder.state !== 'closed') this.decoder.close();
  }
}

/** Fallback: drive a dedicated <video> element and wait for each seek. */
export class SeekSource {
  static async create(url) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('Video failed to load')); });
    return new SeekSource(v);
  }
  constructor(video) { this.video = video; }
  async frameAt(t) {
    const v = this.video;
    const target = Math.min(t, Math.max(0, v.duration - 0.001));
    if (Math.abs(v.currentTime - target) > 1e-4) {
      await new Promise((res) => {
        const done = () => { clearTimeout(to); res(); };
        const to = setTimeout(done, 3000);
        v.addEventListener('seeked', done, { once: true });
        v.currentTime = target;
      });
    }
    return v;
  }
  close() { this.video.removeAttribute('src'); this.video.load(); }
}

/** Best available exact source for an asset. */
export async function openSource(asset) {
  const isMp4 = /\.(mp4|m4v|mov)$/i.test(asset.name) || /mp4|quicktime/.test(asset.file?.type || '');
  if (isMp4) {
    try { return { source: await Mp4Source.create(asset.file), exact: true }; }
    catch (e) { console.warn(`[export] WebCodecs path unavailable for ${asset.name}: ${e.message}. Using seek fallback.`); }
  }
  return { source: await SeekSource.create(asset.url), exact: false };
}
