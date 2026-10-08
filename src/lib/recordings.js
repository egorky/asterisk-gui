// Indexa y sirve grabaciones desde los directorios configurados en la GUI.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const settings = require('./settings');

const MIME = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
  gsm: 'audio/x-gsm', sln: 'audio/basic', ulaw: 'audio/basic', alaw: 'audio/basic', wma: 'audio/x-ms-wma', aac: 'audio/aac',
};
const MAX_FILES = 500000;

let index = { at: 0, files: [], byUid: new Map(), byName: new Map(), errors: [] };
let scanning = null;

settings.bus.on('change', (s) => { if (s === 'recordings') index.at = 0; });

const UID_RE = /(\d{9,11}\.\d{1,7})/;
const DATE_RE = /(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_ T]?(\d{2})[-_:]?(\d{2})[-_:]?(\d{2})/;

function parseName(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const uid = UID_RE.exec(base);
  let rest = uid ? base.replace(uid[1], ' ') : base;
  let ts = null;
  const d = DATE_RE.exec(rest);
  if (d) {
    const [, y, mo, da, h, mi, s] = d.map(Number);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && h < 24 && mi < 60 && s < 60) {
      ts = new Date(y, mo - 1, da, h, mi, s).getTime();
      rest = rest.replace(d[0], ' ');
    }
  }
  const dm = /^(in|out|q|exten|rg|g|external|internal|inbound|outbound|queue)[-_]/i.exec(base);
  const dirMap = { in: 'in', external: 'in', inbound: 'in', out: 'out', outbound: 'out', q: 'queue', queue: 'queue', exten: 'internal', internal: 'internal', rg: 'group', g: 'group' };
  const numbers = [...new Set(rest.match(/\+?\d{3,15}/g) || [])].slice(0, 4);
  return { uniqueid: uid ? uid[1] : '', ts, direction: dm ? dirMap[dm[1].toLowerCase()] : '', numbers };
}

async function walk(root, recursive, exts, out, errors, label, dirId) {
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch (e) { errors.push(`${label}: ${e.message}`); continue; }
    const hits = [];
    for (const e of entries) {
      if (e.isDirectory()) { if (recursive) stack.push(path.join(rel, e.name)); continue; }
      if (!e.isFile() && !e.isSymbolicLink()) continue;
      const ext = path.extname(e.name).slice(1);
      if (exts.has(ext.toLowerCase())) hits.push({ e, ext });
    }
    for (let i = 0; i < hits.length; i += 64) {
      await Promise.all(hits.slice(i, i + 64).map(async ({ e, ext }) => {
        try {
          const st = await fsp.stat(path.join(root, rel, e.name));
          if (!st.isFile()) return;
          const r = path.join(rel, e.name);
          const meta = parseName(e.name);
          out.push({
            id: Buffer.from(`${dirId}|${r}`).toString('base64url'), dirId, dir: label, rel: r, name: e.name, ext,
            size: st.size, mtime: st.mtimeMs, ts: meta.ts || st.mtimeMs, tsParsed: !!meta.ts,
            uniqueid: meta.uniqueid, direction: meta.direction, numbers: meta.numbers,
          });
        } catch { /* archivo desaparecido */ }
      }));
    }
  }
}

async function scan() {
  const cfg = settings.get('recordings');
  const exts = new Set(cfg.extensions.map((e) => e.toLowerCase()));
  const files = [], errors = [];
  for (const d of cfg.dirs) {
    try { await fsp.access(d.path, fs.constants.R_OK); } catch (e) { errors.push(`${d.label}: ${e.code === 'ENOENT' ? 'no existe' : 'sin permisos'} (${d.path})`); continue; }
    await walk(d.path, cfg.recursive, exts, files, errors, d.label, d.id);
  }
  const byUid = new Map(), byName = new Map();
  for (const f of files) {
    if (f.uniqueid) { if (!byUid.has(f.uniqueid)) byUid.set(f.uniqueid, []); byUid.get(f.uniqueid).push(f); }
    byName.set(f.name.toLowerCase(), f);
    byName.set(f.name.replace(/\.[^.]+$/, '').toLowerCase(), f);
  }
  index = { at: Date.now(), files, byUid, byName, errors };
  return index;
}

/** Devuelve el índice; si está vencido lo refresca en segundo plano (o espera si no hay ninguno). */
async function ensure(force = false) {
  const ttl = settings.get('recordings').cacheSeconds * 1000;
  const stale = !index.at || Date.now() - index.at > ttl;
  if (!force && !stale) return index;
  if (!scanning) scanning = scan().finally(() => { scanning = null; });
  if (force || !index.at) await scanning;
  return index;
}

function list(f = {}, { limit = 50, offset = 0, sort = 'date', dir = 'desc' } = {}) {
  const lc = (s) => String(s || '').toLowerCase();
  const q = lc(f.q), num = lc(f.number), uid = lc(f.uniqueid), ext = lc(f.ext);
  const from = f.from ? new Date(f.from.replace(' ', 'T')).getTime() : null;
  const to = f.to ? new Date(f.to.replace(' ', 'T')).getTime() : null;
  const minSize = f.minSize ? Number(f.minSize) * 1024 : 0;
  let rows = index.files.filter((r) => {
    if (f.dir && r.dirId !== f.dir) return false;
    if (ext && lc(r.ext) !== ext) return false;
    if (q && !lc(r.rel).includes(q)) return false;
    if (num && !lc(r.name).includes(num)) return false;
    if (uid && !lc(r.name).includes(uid)) return false;
    if (f.direction && r.direction !== f.direction) return false;
    if (from && r.ts < from) return false;
    if (to && r.ts > to) return false;
    if (minSize && r.size < minSize) return false;
    return true;
  });
  const sgn = dir === 'asc' ? 1 : -1;
  const key = { date: (r) => r.ts, name: (r) => r.name.toLowerCase(), size: (r) => r.size }[sort] || ((r) => r.ts);
  rows.sort((a, b) => (key(a) > key(b) ? sgn : key(a) < key(b) ? -sgn : 0));
  const total = rows.length;
  const bytes = rows.reduce((s, r) => s + r.size, 0);
  rows = rows.slice(offset, offset + limit);
  return { rows, total, bytes, scannedAt: index.at, errors: index.errors, totalIndexed: index.files.length };
}

/** Busca las grabaciones asociadas a una llamada del CDR. */
function forCall({ uniqueid, linkedid, recordingfile }) {
  const hit = new Map();
  for (const id of [uniqueid, linkedid]) for (const f of index.byUid.get(id) || []) hit.set(f.id, f);
  if (recordingfile) {
    const b = path.basename(recordingfile).toLowerCase();
    const f = index.byName.get(b) || index.byName.get(b.replace(/\.[^.]+$/, ''));
    if (f) hit.set(f.id, f);
  }
  return [...hit.values()];
}

async function resolve(id) {
  let dirId, rel;
  try { [dirId, rel] = Buffer.from(id, 'base64url').toString().split('|'); } catch { /* inválido */ }
  const cfg = settings.get('recordings');
  const dir = cfg.dirs.find((d) => d.id === dirId);
  if (!dir || !rel) throw Object.assign(new Error('Grabación no encontrada'), { status: 404 });
  const root = path.resolve(dir.path);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw Object.assign(new Error('Ruta no permitida'), { status: 403 });
  const ext = path.extname(abs).slice(1).toLowerCase();
  if (!cfg.extensions.includes(ext)) throw Object.assign(new Error('Tipo de archivo no permitido'), { status: 403 });
  let real;
  try { real = await fsp.realpath(abs); } catch { throw Object.assign(new Error('El archivo ya no existe'), { status: 404 }); }
  const realRoot = await fsp.realpath(root);
  if (!real.startsWith(realRoot + path.sep)) throw Object.assign(new Error('Ruta no permitida'), { status: 403 });
  const st = await fsp.stat(real);
  if (!st.isFile()) throw Object.assign(new Error('Grabación no encontrada'), { status: 404 });
  return { file: real, size: st.size, mtime: st.mtime, ext, name: path.basename(abs), mime: MIME[ext] || 'application/octet-stream' };
}

async function send(req, res, id, download) {
  const r = await resolve(id);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', r.mime);
  res.setHeader('Last-Modified', r.mtime.toUTCString());
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(r.name)}`);
  let start = 0, end = r.size - 1;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); } else { start = Math.max(0, r.size - Number(m[2])); }
    if (start > end || start >= r.size) { res.status(416).setHeader('Content-Range', `bytes */${r.size}`); return res.end(); }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${r.size}`);
  }
  res.setHeader('Content-Length', r.size ? end - start + 1 : 0);
  if (req.method === 'HEAD' || !r.size) return res.end();
  fs.createReadStream(r.file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

/** Explorador de carpetas para elegir directorios desde la GUI. */
async function browse(p) {
  const target = path.resolve(p || '/');
  const entries = await fsp.readdir(target, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() || (e.isSymbolicLink())).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  return { path: target, parent: path.dirname(target) === target ? null : path.dirname(target), dirs };
}

/** Comprueba directorios (sin guardar) y cuenta archivos por extensión. */
async function testDirs(dirs, extensions, recursive = true) {
  const exts = new Set(extensions.map((e) => e.toLowerCase()));
  const out = [];
  for (const d of dirs) {
    const r = { label: d.label, path: d.path, ok: false };
    try {
      await fsp.access(d.path, fs.constants.R_OK);
      const files = [], errors = [];
      await walk(d.path, recursive, exts, files, errors, d.label, 'x');
      const byExt = {};
      for (const f of files) byExt[f.ext] = (byExt[f.ext] || 0) + 1;
      Object.assign(r, { ok: true, files: files.length, byExt, bytes: files.reduce((s, f) => s + f.size, 0), warnings: errors.slice(0, 3) });
    } catch (e) { r.error = e.code === 'ENOENT' ? 'El directorio no existe' : e.code === 'EACCES' ? 'Sin permisos de lectura' : e.message; }
    out.push(r);
  }
  return out;
}

module.exports = { ensure, list, forCall, send, browse, testDirs };
