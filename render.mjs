/* Headless frame renderer.
   Steps the composition one frame at a time via MockupStudio.seek(), screenshots
   the stage, and pipes PNGs straight into ffmpeg. Because the animation is a pure
   function of t and the screens are drawn to a canvas, output matches the preview
   exactly and never drops a video frame the way a screen recording would.

   Usage:
     node render.mjs                        # uses state.json + config.json
     node render.mjs --scale 2              # 2x supersample, downscaled (crisper)
     node render.mjs --out hero.mp4 --fps 30 --duration 18
*/

import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(HERE, 'config.json');
if (!fs.existsSync(CONFIG)) fs.copyFileSync(path.join(HERE, 'config.example.json'), CONFIG);
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

/* Locate a Chromium for Playwright to drive. Preference order:
   CHROME_PATH env -> playwright's own resolution -> a scan of the browser cache.
   Keeping this dynamic means the repo isn't pinned to one machine. */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* playwright-core can't resolve without a registry; fall through */ }

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
  ].filter(Boolean);

  const candidates = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux/chrome',
    'chrome-win/chrome.exe',
  ];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const builds = fs.readdirSync(root)
      .filter((d) => d.startsWith('chromium-'))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));   // newest first
    for (const b of builds) {
      for (const rel of candidates) {
        const full = path.join(root, b, rel);
        if (fs.existsSync(full)) return full;
      }
    }
  }
  return null;
}

const CHROME = findChrome();
if (!CHROME) {
  console.error('\n  No Chromium found for rendering.');
  console.error('  Install one with:  npx playwright install chromium');
  console.error('  Or point at an existing binary:  CHROME_PATH=/path/to/chrome node render.mjs\n');
  process.exit(1);
}

/* ------------------------------ args ------------------------------ */
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
/* Default output is timestamped so each export is kept rather than clobbering
   the last one. Pass --out to override with a fixed name. */
const stamp = (() => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
         `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();
const OUT    = path.resolve(arg('out', path.join(HERE, 'out', `mockup-${stamp}.mp4`)));
const JSONL  = argv.includes('--json');   // newline-delimited JSON progress, for the web UI
const emit   = (o) => { if (JSONL) process.stdout.write(JSON.stringify(o) + '\n'); };
const PRESET = arg('preset', 'medium');
const SCALE = Number(arg('scale', 1));
const PORT  = Number(process.env.PORT) || cfg.port || 5178;
const BASE  = `http://localhost:${PORT}`;

if (!fs.existsSync(path.join(HERE, 'state.json'))) {
  if (!JSONL) console.log('\n  !  No state.json — rendering built-in DEFAULTS, not your panel settings.');
  if (!JSONL) console.log('     Tune at http://localhost:' + (Number(process.env.PORT) || cfg.port || 5178) +
              ' and press "Save" first.\n');
}

/* --------------------------- server boot --------------------------- */
const ping = (url) => new Promise((res) => {
  const req = http.get(url, (r) => { r.resume(); res(r.statusCode < 500); });
  req.on('error', () => res(false));
  req.setTimeout(700, () => { req.destroy(); res(false); });
});

let child = null;
if (!(await ping(BASE))) {
  if (!JSONL) console.log('  starting server...');
  child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 40 && !(await ping(BASE)); i++) await new Promise((r) => setTimeout(r, 150));
}

/* ----------------------------- render ----------------------------- */
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--force-color-profile=srgb'],
});

const page = await browser.newPage({ deviceScaleFactor: SCALE });
await page.goto(`${BASE}/?headless=1`, { waitUntil: 'load' });
await page.waitForFunction('window.MockupStudio && window.MockupStudio.ready');
await page.evaluate(() => window.MockupStudio.ready);

const meta = await page.evaluate(() => {
  const s = window.MockupStudio.getState();
  return { w: s.output.w, h: s.output.h, fps: s.output.fps, duration: s.output.duration };
});

const AT  = argv.includes('--at') ? Number(arg('at', 0)) : null;
const FPS = Number(arg('fps', meta.fps));
const DUR = Number(arg('duration', meta.duration));
const N   = Math.round(FPS * DUR);

await page.setViewportSize({ width: meta.w, height: meta.h });
// let layout settle and the first video frames decode
await page.evaluate(() => window.MockupStudio.seek(0));
await page.waitForTimeout(400);

fs.mkdirSync(path.dirname(OUT), { recursive: true });

/* --at <seconds>: render one still instead of a movie */
/* ------------------- encode outside the sync root -------------------
   This project lives under ~/Documents, which macOS syncs to iCloud Drive when
   "Desktop & Documents Folders" is enabled. ffmpeg's incremental writes (and the
   +faststart rewrite pass) go through iCloud's file provider, which intermittently
   fails with "Operation timed out" and aborts the encode. Encode to real local
   disk, then copy the finished file into place as a single operation. */
const inSyncedDir = (p) => {
  if (!p.startsWith(os.homedir())) return false;
  const rel = path.relative(os.homedir(), p);
  if (/^(Documents|Desktop)[/\\]/.test(rel)) {
    try {
      return execFileSync('defaults', ['read', 'com.apple.finder', 'FXICloudDriveDesktop'],
                          { encoding: 'utf8' }).trim() === '1';
    } catch { return false; }
  }
  return /^Library[/\\]Mobile Documents[/\\]/.test(rel);
};

const SYNCED = process.platform === 'darwin' && inSyncedDir(OUT);
const tmpDir = SYNCED ? fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-studio-')) : null;
const ENCODE_TO = tmpDir ? path.join(tmpDir, path.basename(OUT)) : OUT;
if (SYNCED && !JSONL) console.log(`  (encoding on local disk first — ${path.dirname(OUT)} is iCloud-synced)`);

const finish = () => {
  if (!tmpDir) return;
  try {
    fs.copyFileSync(ENCODE_TO, OUT);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {
    console.error(`\n  Encode succeeded but copying into place failed: ${e.message}`);
    console.error(`  Your render is here:  ${ENCODE_TO}\n`);
    process.exit(1);
  }
};

if (AT !== null) {
  const still = OUT.replace(/\.\w+$/, '') + `-t${AT}.png`;
  const stillTmp = SYNCED ? path.join(tmpDir, path.basename(still)) : still;
  await page.evaluate((tt) => window.MockupStudio.seek(tt), AT);
  await page.waitForTimeout(150);
  await page.locator('#stage').screenshot({ path: stillTmp, type: 'png', animations: 'disabled' });
  if (SYNCED) { fs.copyFileSync(stillTmp, still); fs.rmSync(tmpDir, { recursive: true, force: true }); }
  await browser.close();
  if (child) child.kill();
  emit({ type: 'done', out: still, name: path.basename(still) });
  if (!JSONL) console.log(`  still at t=${AT}s  ->  ${still}`);
  process.exit(0);
}

/* ---------------------- single-render guard ----------------------- */
/* Two concurrent renders write the same output file and fight over it, which
   is confusing to debug. Refuse rather than let them collide. */
const LOCK = path.join(HERE, '.render.lock');
if (fs.existsSync(LOCK)) {
  const owner = Number(fs.readFileSync(LOCK, 'utf8').trim());
  let alive = false;
  try { process.kill(owner, 0); alive = true; } catch {}
  if (alive) {
    console.error(`\n  A render is already running (pid ${owner}).`);
    console.error(`  Wait for it, or stop it with:  kill ${owner}\n`);
    await browser.close(); if (child) child.kill(); process.exit(1);
  }
  fs.unlinkSync(LOCK);   // stale lock from a killed run
}
fs.writeFileSync(LOCK, String(process.pid));
const dropLock = () => { try { fs.unlinkSync(LOCK); } catch {} };
process.on('exit', dropLock);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { dropLock(); process.exit(130); });

/* ------------------------------ ffmpeg ---------------------------- */
const vf = SCALE > 1 ? ['-vf', `scale=${meta.w}:${meta.h}:flags=lanczos`] : [];
const ff = spawn('ffmpeg', [
  '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  ...vf,
  '-c:v', 'libx264', '-preset', PRESET, '-crf', '17',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  ENCODE_TO,
], { stdio: ['pipe', 'ignore', 'pipe'] });

let ffErr = '', ffExit = null;

ff.stderr.on('data', (d) => {
  const s = d.toString();
  ffErr += s;
  // surface real problems the moment ffmpeg reports them, instead of only at the end
  for (const line of s.split('\n')) {
    if (/error|invalid|unable|no such|denied|failed|not found/i.test(line)) {
      console.error('\n  ffmpeg: ' + line.trim());
    }
  }
});

ff.on('error', (e) => { ffExit = `ffmpeg could not start: ${e.message}`; });
ff.on('close', (code, signal) => {
  if (code !== 0) ffExit = `ffmpeg exited (code ${code}${signal ? ', signal ' + signal : ''})`;
});
ff.stdin.on('error', () => {});   // EPIPE is expected once ffmpeg is gone; handled below

const bail = async (msg, frame) => {
  emit({ type: 'error', message: msg, frame: frame || null, stderr: ffErr.trim().slice(-2000) });
  console.error(`\n\n  ${msg}${frame ? ` at frame ${frame}` : ''}.`);
  const tail = ffErr.trim().slice(-4000);
  console.error(tail ? `\n--- ffmpeg stderr ---\n${tail}\n` : '\n  (ffmpeg produced no stderr)\n');
  dropLock();
  await browser.close().catch(() => {});
  if (child) child.kill();
  process.exit(1);
};

/* Write one frame, but never wait on 'drain' forever: if ffmpeg dies while the
   pipe is full, 'drain' will never fire. Race it against the process closing. */
function writeFrame(buf) {
  if (ff.stdin.write(buf)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (err) => {
      ff.stdin.off('drain', onDrain);
      ff.off('close', onClose);
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    const onDrain = () => done();
    const onClose = () => done(new Error('ffmpeg exited while a frame was being written'));
    const timer = setTimeout(
      () => done(new Error('timed out waiting for ffmpeg to accept a frame (60s)')), 60000);
    ff.stdin.once('drain', onDrain);
    ff.once('close', onClose);
  });
}

emit({ type: 'start', total: N, w: meta.w, h: meta.h, fps: FPS, scale: SCALE });
if (!JSONL) console.log(`  rendering ${N} frames  ${meta.w}x${meta.h} @${FPS}fps` +
            `${SCALE > 1 ? `  (${SCALE}x supersample)` : ''}  ->  ${path.relative(HERE, OUT)}`);

const stage = page.locator('#stage');
const t0 = Date.now();

for (let i = 0; i < N; i++) {
  const t = i / FPS;
  await page.evaluate((tt) => window.MockupStudio.seek(tt), t);
  const buf = await stage.screenshot({ type: 'png', animations: 'disabled' });

  if (ffExit) await bail(ffExit, i + 1);

  if (i === 0) {
    // catch a size mismatch early rather than letting x264 fail deep into the run
    const png = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    const want = { w: meta.w * SCALE, h: meta.h * SCALE };
    if (png.w !== want.w || png.h !== want.h) {
      console.log(`  note: frame is ${png.w}x${png.h}, expected ${want.w}x${want.h}`);
    }
  }

  try {
    await writeFrame(buf);
  } catch (e) {
    await bail(ffExit || e.message, i + 1);
  }

  if (JSONL && i % 3 === 0) {
    emit({ type: 'progress', frame: i + 1, total: N,
           etaSec: Number(((Date.now() - t0) / (i + 1) * (N - i - 1) / 1000).toFixed(0)) });
  }

  if (i % 15 === 0 || i === N - 1) {
    const pct = ((i + 1) / N * 100).toFixed(0);
    const eta = ((Date.now() - t0) / (i + 1) * (N - i - 1) / 1000).toFixed(0);
    if (!JSONL) process.stdout.write(`\r  ${pct}%  frame ${i + 1}/${N}   eta ${eta}s     `);
  }
}

ff.stdin.end();
await new Promise((res) => ff.on('close', res));
if (ffExit) await bail(ffExit);
finish();
await browser.close();
if (child) child.kill();

const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
emit({ type: 'done', out: OUT, name: path.basename(OUT), mb: Number(mb),
       seconds: Number(((Date.now() - t0) / 1000).toFixed(0)) });
if (!JSONL) console.log(`\n  done in ${((Date.now() - t0) / 1000).toFixed(0)}s  ->  ${OUT}  (${mb} MB)\n`);
process.exit(0);
