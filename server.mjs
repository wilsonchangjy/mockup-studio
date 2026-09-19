/* Zero-dependency static server.
   Serves the tool from this directory and maps /media/a.mp4 + /media/b.mp4
   to the absolute paths in config.json, so the source recordings stay
   where they are instead of being copied into the repo.
   Range requests are supported — Chromium needs them to seek video. */

import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* config.json holds machine-specific absolute paths and isn't committed.
   Bootstrap it from the example on first run so a fresh clone just works. */
const CONFIG = path.join(HERE, 'config.json');
if (!fs.existsSync(CONFIG)) {
  fs.copyFileSync(path.join(HERE, 'config.example.json'), CONFIG);
  console.log('  created config.json from config.example.json');
}
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const PORT = Number(process.env.PORT) || cfg.port || 5178;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.png':  'image/png',
};

function serveFile(file, req, res) {
  let stat;
  try { stat = fs.statSync(file); }
  catch { res.writeHead(404); return res.end('not found'); }

  const type  = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end   = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    if (start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': end - start + 1,
      'Content-Type':   type,
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }

  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type':   type,
    'Accept-Ranges':  'bytes',
    'Cache-Control':  'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

/* ------------------------------- media --------------------------------
   The browser can't hand us a real filesystem path (by design), so an upload
   has to send bytes. We stream them into media/ and repoint config.json, which
   keeps the preview and the renderer reading the exact same file. */
const MEDIA_DIR = path.join(HERE, 'media');
const ALLOWED = new Set(['.mp4', '.mov', '.m4v', '.webm', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_UPLOAD = 512 * 1024 * 1024;

const resolveMedia = (p) => (p && !path.isAbsolute(p) ? path.join(HERE, p) : p);

function saveConfig(next) {
  Object.assign(cfg, next);
  fs.writeFileSync(path.join(HERE, 'config.json'), JSON.stringify(cfg, null, 2));
}

function receiveMedia(key, req, res, json) {
  const raw = String(req.headers['x-filename'] || 'upload');
  const ext = path.extname(raw).toLowerCase();
  if (!ALLOWED.has(ext)) {
    return json(415, { error: `Unsupported file type "${ext || '?'}". Use mp4, mov, m4v, webm, or an image.` });
  }

  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  // one slot per phone; replacing clears whatever extension was there before
  for (const old of fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : []) {
    if (old.startsWith(key + '.')) { try { fs.unlinkSync(path.join(MEDIA_DIR, old)); } catch {} }
  }

  const dest = path.join(MEDIA_DIR, key + ext);
  const tmp = dest + '.part';
  const ws = fs.createWriteStream(tmp);
  let bytes = 0, aborted = false;

  req.on('data', (c) => {
    bytes += c.length;
    if (bytes > MAX_UPLOAD && !aborted) {
      aborted = true;
      ws.destroy(); req.destroy();
      try { fs.unlinkSync(tmp); } catch {}
      json(413, { error: 'File too large (512 MB max)' });
    }
  });

  req.pipe(ws);

  ws.on('error', (e) => { if (!aborted) { aborted = true; json(500, { error: e.message }); } });
  ws.on('finish', () => {
    if (aborted) return;
    try {
      fs.renameSync(tmp, dest);
      saveConfig(key === 'a' ? { videoA: dest } : { videoB: dest });
      json(200, { ok: true, name: path.basename(raw), stored: path.basename(dest),
                  isImage: IMAGE_EXT.has(ext), bytes });
    } catch (e) { json(500, { error: e.message }); }
  });
}

const mediaInfo = () => ['a', 'b'].reduce((acc, k) => {
  const p = resolveMedia(k === 'a' ? cfg.videoA : cfg.videoB);
  const ext = path.extname(p || '').toLowerCase();
  let size = null;
  try { size = fs.statSync(p).size; } catch {}
  acc[k] = { path: p, name: path.basename(p || ''), exists: size != null, size,
             isImage: IMAGE_EXT.has(ext) };
  return acc;
}, {});

/* ----------------------------- export job -----------------------------
   The panel POSTs its state here; we persist it to state.json (so the CLI
   path stays usable) and run render.mjs in --json mode, parsing its progress
   events. One job at a time — the renderer's own lock enforces that too. */
let job = null;

const readBody = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => {
    b += c;
    if (b.length > 4e6) { reject(new Error('body too large')); req.destroy(); }
  });
  req.on('end', () => resolve(b));
});

function startExport({ state, scale, preset }) {
  if (state) fs.writeFileSync(path.join(HERE, 'state.json'), JSON.stringify(state, null, 2));

  const args = [path.join(HERE, 'render.mjs'), '--json', '--scale', String(scale || 1)];
  if (preset) args.push('--preset', preset);

  const proc = spawn(process.execPath, args, { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'] });

  job = {
    running: true, frame: 0, total: 0, etaSec: null,
    out: null, name: null, mb: null, seconds: null,
    error: null, stderr: '', startedAt: Date.now(),
    cancelled: false, proc,
  };

  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();                       // keep the partial line
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'start')    { job.total = ev.total; Object.assign(job, { w: ev.w, h: ev.h, fps: ev.fps }); }
      if (ev.type === 'progress') { job.frame = ev.frame; job.total = ev.total; job.etaSec = ev.etaSec; }
      if (ev.type === 'done')     Object.assign(job, { out: ev.out, name: ev.name, mb: ev.mb, seconds: ev.seconds });
      if (ev.type === 'error')    job.error = ev.message;
    }
  });

  proc.stderr.on('data', (d) => { job.stderr = (job.stderr + d.toString()).slice(-4000); });

  proc.on('close', (code) => {
    job.running = false;
    job.exitCode = code;
    if (code !== 0 && !job.error) {
      job.error = job.cancelled ? 'Export cancelled'
                                : `Renderer exited with code ${code}`;
    }
    job.proc = null;
  });

  return job;
}

const publicJob = () => job && (({ proc, ...rest }) => rest)(job);

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'POST' && url === '/export') {
    if (job && job.running) return json(409, { error: 'An export is already running' });
    readBody(req).then((b) => {
      let opts; try { opts = JSON.parse(b || '{}'); } catch { return json(400, { error: 'bad json' }); }
      try { startExport(opts); json(200, { started: true }); }
      catch (e) { json(500, { error: e.message }); }
    }).catch((e) => json(400, { error: e.message }));
    return;
  }

  if (url === '/export/status') return json(200, publicJob() || { running: false, idle: true });

  if (req.method === 'POST' && (url === '/media/a' || url === '/media/b')) {
    if (job && job.running) return json(409, { error: 'Cannot swap footage while exporting' });
    return receiveMedia(url.endsWith('/a') ? 'a' : 'b', req, res, json);
  }

  if (url === '/media/info') return json(200, mediaInfo());

  if (req.method === 'POST' && url === '/export/cancel') {
    if (job && job.running && job.proc) { job.cancelled = true; job.proc.kill('SIGTERM'); return json(200, { cancelled: true }); }
    return json(200, { cancelled: false });
  }

  // kept so the CLI workflow still works for anyone who prefers it
  if (req.method === 'POST' && url === '/state') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        JSON.parse(body);                                   // validate before writing
        fs.writeFileSync(path.join(HERE, 'state.json'), body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400); res.end('bad json');
      }
    });
    return;
  }

  if (url === '/media/a' || url.startsWith('/media/a.')) return serveFile(resolveMedia(cfg.videoA), req, res);
  if (url === '/media/b' || url.startsWith('/media/b.')) return serveFile(resolveMedia(cfg.videoB), req, res);

  // confine everything else to the tool directory
  const rel  = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.join(HERE, rel);
  if (!file.startsWith(HERE)) { res.writeHead(403); return res.end('forbidden'); }
  serveFile(file, req, res);
});

for (const [label, p] of [['videoA', cfg.videoA], ['videoB', cfg.videoB]]) {
  if (!fs.existsSync(p)) console.warn(`  !  ${label} not found: ${p}`);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n  Port ${PORT} is already in use — an instance is probably already running.`);
    console.log(`  Open  http://localhost:${PORT}\n`);
    console.log(`  To restart it instead:  pkill -f "node server.mjs" && node server.mjs`);
    console.log(`  Or run on another port:  PORT=5179 node server.mjs\n`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  Mockup Studio  ->  http://localhost:${PORT}\n`);
});
