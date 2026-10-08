const express = require('express');
const store = require('../lib/store');
const settings = require('../lib/settings');
const auth = require('../lib/auth');
const asterisk = require('../lib/asterisk');
const cdr = require('../lib/cdr');
const rec = require('../lib/recordings');
const { testConnection } = require('../lib/ami');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const secure = () => process.env.COOKIE_SECURE === 'true';

// ---- Autenticación ----------------------------------------------------
router.post('/auth/login', wrap(async (req, res) => {
  const user = await auth.login(req.body.username, req.body.password, req.ip);
  auth.issue(res, user, secure());
  res.json({ user });
}));
router.post('/auth/logout', (req, res) => { auth.clear(res); res.json({ ok: true }); });

router.use(auth.middleware);

router.get('/auth/me', (req, res) => res.json({ user: req.user }));
router.post('/auth/password', wrap(async (req, res) => {
  const u = store.users.byId(req.user.id);
  if (!(await auth.verifyPw(String(req.body.current || ''), u.password_hash))) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  auth.validatePassword(req.body.password);
  store.users.update(u.id, { password_hash: await auth.hash(req.body.password) });
  store.users.bumpToken(u.id);
  auth.issue(res, u, secure());
  res.json({ ok: true });
}));

// ---- Usuarios (admin) -------------------------------------------------
router.get('/users', auth.requireAdmin, (req, res) => res.json({ users: store.users.list() }));
router.post('/users', auth.requireAdmin, wrap(async (req, res) => {
  const { username, password, role } = req.body;
  if (!/^[\w.@-]{3,40}$/.test(username || '')) return res.status(400).json({ error: 'Usuario inválido (3-40 caracteres: letras, números, . _ - @)' });
  auth.validatePassword(password);
  if (store.users.byName(username)) return res.status(409).json({ error: 'El usuario ya existe' });
  const id = store.users.create(username, await auth.hash(password), role === 'admin' ? 'admin' : 'viewer');
  res.json({ id });
}));
router.put('/users/:id', auth.requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const u = store.users.byId(id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  const f = {};
  if (req.body.role) f.role = req.body.role === 'admin' ? 'admin' : 'viewer';
  if (req.body.disabled !== undefined) f.disabled = req.body.disabled ? 1 : 0;
  if ((f.role === 'viewer' || f.disabled === 1) && u.role === 'admin' && !u.disabled && store.users.admins() <= 1) {
    return res.status(400).json({ error: 'Debe quedar al menos un administrador activo' });
  }
  if (req.body.password) { auth.validatePassword(req.body.password); f.password_hash = await auth.hash(req.body.password); }
  store.users.update(id, f);
  if (f.password_hash || f.disabled || f.role) store.users.bumpToken(id);
  res.json({ ok: true });
}));
router.delete('/users/:id', auth.requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const u = store.users.byId(id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (id === req.user.id) return res.status(400).json({ error: 'No puede eliminar su propio usuario' });
  if (u.role === 'admin' && !u.disabled && store.users.admins() <= 1) return res.status(400).json({ error: 'Debe quedar al menos un administrador activo' });
  store.users.remove(id);
  res.json({ ok: true });
});

// ---- Ajustes ----------------------------------------------------------
router.get('/settings', (req, res) => {
  const s = settings.publicAll();
  if (req.user.role !== 'admin') { delete s.asterisk.username; delete s.db.user; delete s.db.host; delete s.db.file; }
  res.json(s);
});
router.put('/settings/:section', auth.requireAdmin, (req, res) => {
  settings.save(req.params.section, req.body);
  res.json(settings.publicView(req.params.section));
});
router.post('/settings/test/ami', auth.requireAdmin, wrap(async (req, res) => {
  const cur = settings.get('asterisk');
  const b = req.body || {};
  const cfg = { host: b.host || cur.host, port: Number(b.port) || cur.port, username: b.username ?? cur.username, secret: b.secret || cur.secret, tls: !!b.tls, enabled: true };
  res.json(await testConnection(cfg));
}));
router.post('/settings/test/db', auth.requireAdmin, wrap(async (req, res) => {
  const cur = settings.get('db');
  const b = req.body || {};
  res.json(await cdr.test({ ...b, password: b.password || cur.password, port: Number(b.port) || cur.port }));
}));
router.post('/settings/test/recordings', auth.requireAdmin, wrap(async (req, res) => {
  const cur = settings.get('recordings');
  const dirs = (req.body.dirs || cur.dirs).map((d) => ({ label: d.label || d.path, path: String(d.path || '') }));
  res.json({ dirs: await rec.testDirs(dirs, req.body.extensions || cur.extensions, req.body.recursive !== false) });
}));
router.get('/fs/browse', auth.requireAdmin, wrap(async (req, res) => {
  try { res.json(await rec.browse(req.query.path)); } catch (e) { res.status(400).json({ error: e.code === 'EACCES' ? 'Sin permisos' : e.message }); }
}));

// ---- Estado / en vivo -------------------------------------------------
const dbOk = () => settings.get('db').enabled;
router.get('/status', (req, res) => res.json({
  ami: asterisk.status(), core: asterisk.core, db: { configured: dbOk() },
  recordings: { dirs: settings.get('recordings').dirs.length }, now: Date.now(),
}));
router.get('/live', (req, res) => res.json({ ...asterisk.live, ami: asterisk.status() }));
router.get('/endpoints', wrap(async (req, res) => {
  if (!asterisk.endpoints.at) await asterisk.pollEndpoints();
  res.json({ ...asterisk.endpoints, queues: asterisk.queues });
}));
router.get('/events', (req, res) => {
  const { severity, kind, search, since, before } = req.query;
  res.json({ events: store.events.list({ severity, kind, search, since, before: before && Number(before), limit: Math.min(Number(req.query.limit) || 100, 500) }) });
});
router.get('/dashboard', wrap(async (req, res) => {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const ep = asterisk.endpoints;
  const out = {
    ami: asterisk.status(), core: asterisk.core,
    live: { calls: asterisk.live.calls.length, channels: asterisk.live.channels.length, bridged: asterisk.live.calls.filter((c) => c.bridged).length },
    endpoints: { total: ep.list.length, online: ep.list.filter((e) => e.online).length, tech: ep.tech },
    registrations: ep.registrations, queues: asterisk.queues,
    events24h: Object.fromEntries(store.events.counts(since).map((r) => [r.severity, r.n])),
    recentEvents: store.events.list({ limit: 6 }),
    cdr: null, cdrError: null,
  };
  if (dbOk()) { try { out.cdr = await cdr.stats(); } catch (e) { out.cdrError = e.message; } }
  res.json(out);
}));

// ---- Asterisk: configuración y consola de solo lectura ---------------
const SAFE_CMD = /^(core show|pjsip show|sip show|iax2 show|module show|dialplan show|queue show|bridge show|confbridge list|voicemail show|database show|manager show|http show|rtp show|cdr show|cel show|odbc show|moh show|features show|stasis show|agi show|cli show|channel|group show|logger show|core list|dundi show|xmpp show|calendar show|sorcery show|ari show)\b/i;
const needAmi = (req, res, next) => (asterisk.connected ? next() : res.status(503).json({ error: 'AMI no conectado. Revise Configuración → Asterisk.' }));
const SENSITIVE = /^(secret|password|md5_cred|auth_password|username_password|authsecret|mailbox_pass|pin|token|apikey|key)$/i;

router.get('/asterisk/info', needAmi, wrap(async (req, res) => {
  const cmds = ['core show version', 'core show uptime', 'core show settings', 'core show channels count', 'module show like res_', 'pjsip show transports'];
  const out = {};
  await Promise.all(cmds.map(async (c) => { try { out[c] = await asterisk.ami.command(c); } catch (e) { out[c] = `Error: ${e.message}`; } }));
  res.json({ core: asterisk.core, commands: out });
}));
router.get('/asterisk/config', (req, res) => res.json({ files: settings.get('asterisk').configFiles }));
router.get('/asterisk/config/:file', needAmi, wrap(async (req, res) => {
  const files = settings.get('asterisk').configFiles;
  if (!files.includes(req.params.file)) return res.status(404).json({ error: 'Archivo no listado' });
  let r;
  try { r = await asterisk.ami.action({ Action: 'GetConfig', Filename: req.params.file }, { timeout: 20000 }); } catch (e) { return res.status(400).json({ error: e.message }); }
  const m = r.response;
  const cats = new Map();
  for (const [k, v] of Object.entries(m)) {
    let x;
    if ((x = /^Category-(\d+)$/.exec(k))) cats.set(Number(x[1]), { name: v, vars: [] });
  }
  for (const [k, v] of Object.entries(m)) {
    const x = /^Line-(\d+)-(\d+)$/.exec(k);
    if (!x) continue;
    const c = cats.get(Number(x[1]));
    const i = v.indexOf('=');
    const key = i > 0 ? v.slice(0, i).trim() : v;
    const val = i > 0 ? v.slice(i + 1).trim() : '';
    if (c) c.vars.push({ n: Number(x[2]), key, value: SENSITIVE.test(key) && val ? '••••••••' : val });
  }
  const categories = [...cats.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => ({ name: c.name, vars: c.vars.sort((a, b) => a.n - b.n).map(({ key, value }) => ({ key, value })) }));
  res.json({ file: req.params.file, categories });
}));
router.post('/asterisk/cli', needAmi, wrap(async (req, res) => {
  const cmd = String(req.body.command || '').trim();
  if (!cmd || /[\r\n;|&`$]/.test(cmd) || !SAFE_CMD.test(cmd)) return res.status(400).json({ error: 'Comando no permitido. Solo consultas ("core show …", "pjsip show …", "queue show", etc.).' });
  res.json({ command: cmd, output: await asterisk.ami.command(cmd) });
}));

// ---- Histórico (CDR) --------------------------------------------------
const cdrFilters = (q) => Object.fromEntries(['from', 'to', 'number', 'src', 'dst', 'uniqueid', 'disposition', 'direction', 'channel', 'account', 'minDur', 'maxDur', 'q']
  .filter((k) => q[k] !== undefined && q[k] !== '').map((k) => [k, String(q[k])]));
const paging = (q) => ({ limit: Math.min(Number(q.limit) || 50, 1000), offset: Number(q.offset) || 0, sort: q.sort, dir: q.order });

router.get('/cdr', wrap(async (req, res) => {
  const r = await cdr.list(cdrFilters(req.query), paging(req.query));
  await rec.ensure().catch(() => {});
  r.rows.forEach((row) => { row.recordings = rec.forCall(row).map(({ id, name, ts, size, dir, ext }) => ({ id, name, ts, size, dir, ext })); });
  res.json(r);
}));
router.get('/cdr/stats', wrap(async (req, res) => res.json(await cdr.stats())));
router.get('/cdr/failed', wrap(async (req, res) => {
  const from = new Date(Date.now() - (Number(req.query.hours) || 24) * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  const fmt = `${from.getFullYear()}-${p(from.getMonth() + 1)}-${p(from.getDate())} ${p(from.getHours())}:${p(from.getMinutes())}:${p(from.getSeconds())}`;
  res.json(await cdr.failed({ limit: Math.min(Number(req.query.limit) || 100, 500), offset: Number(req.query.offset) || 0, from: fmt }));
}));
router.get('/cdr/export.csv', wrap(async (req, res) => {
  const r = await cdr.list(cdrFilters(req.query), { limit: 50000, offset: 0, sort: req.query.sort, dir: req.query.order });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="historico-llamadas.csv"');
  res.send('﻿' + cdr.toCsv(r.rows, r.columns));
}));
router.get('/cdr/:id', wrap(async (req, res) => {
  const d = await cdr.detail(req.params.id);
  await rec.ensure().catch(() => {});
  const seen = new Map();
  for (const l of d.legs) for (const f of rec.forCall(l)) seen.set(f.id, f);
  for (const f of rec.forCall({ uniqueid: req.params.id, linkedid: req.params.id })) seen.set(f.id, f);
  res.json({ ...d, recordings: [...seen.values()] });
}));

// ---- Grabaciones ------------------------------------------------------
router.get('/recordings', wrap(async (req, res) => {
  await rec.ensure(req.query.refresh === '1');
  const q = req.query;
  res.json(rec.list(
    Object.fromEntries(['q', 'number', 'uniqueid', 'ext', 'dir', 'direction', 'from', 'to', 'minSize'].filter((k) => q[k]).map((k) => [k, String(q[k])])),
    { limit: Math.min(Number(q.limit) || 50, 500), offset: Number(q.offset) || 0, sort: q.sort, dir: q.order },
  ));
}));
router.get('/recordings/:id/stream', wrap((req, res) => rec.send(req, res, req.params.id, false)));
router.get('/recordings/:id/download', wrap((req, res) => rec.send(req, res, req.params.id, true)));

module.exports = router;
