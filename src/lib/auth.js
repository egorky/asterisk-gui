const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const store = require('./store');
const cx = require('./crypto');

const COOKIE = 'agui_sid';
const TTL = 12 * 3600 * 1000;
const fails = new Map(); // ip|user -> { n, until }

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function userFromCookie(header) {
  const t = cx.verify(parseCookies(header)[COOKIE]);
  if (!t || t.exp < Date.now()) return null;
  const u = store.users.byId(t.uid);
  if (!u || u.disabled || u.token_version !== t.tv) return null;
  return { id: u.id, username: u.username, role: u.role };
}

function issue(res, user, secure) {
  const u = store.users.byId(user.id);
  const token = cx.sign({ uid: u.id, tv: u.token_version, exp: Date.now() + TTL });
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}${secure ? '; Secure' : ''}`);
}

function clear(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

async function login(username, password, ip) {
  const key = `${ip}|${String(username).toLowerCase()}`;
  const f = fails.get(key);
  if (f && f.until > Date.now()) {
    throw Object.assign(new Error(`Demasiados intentos. Reintente en ${Math.ceil((f.until - Date.now()) / 1000)} s`), { status: 429 });
  }
  const u = store.users.byName(String(username || ''));
  // compara siempre un hash para no revelar si el usuario existe por tiempos de respuesta
  const ok = await bcrypt.compare(String(password || ''), u ? u.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
  if (!u || !ok || u.disabled) {
    const n = (f ? f.n : 0) + 1;
    fails.set(key, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
    throw Object.assign(new Error('Usuario o contraseña incorrectos'), { status: 401 });
  }
  fails.delete(key);
  store.users.touchLogin(u.id);
  return { id: u.id, username: u.username, role: u.role };
}

const hash = (pw) => bcrypt.hash(pw, 11);
const verifyPw = (pw, h) => bcrypt.compare(pw, h);

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw Object.assign(new Error('La contraseña debe tener al menos 8 caracteres'), { status: 400 });
}

/** Crea el usuario inicial la primera vez. */
async function bootstrap(env) {
  if (store.users.count() > 0) return null;
  const username = env.ADMIN_USER || 'admin';
  let password = env.ADMIN_PASSWORD, generated = false;
  if (!password) { password = crypto.randomBytes(9).toString('base64url'); generated = true; }
  store.users.create(username, await hash(password), 'admin');
  return { username, password: generated ? password : null };
}

function middleware(req, res, next) {
  const u = userFromCookie(req.headers.cookie);
  if (!u) return res.status(401).json({ error: 'No autenticado' });
  req.user = u;
  next();
}

const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Requiere rol de administrador' });

module.exports = { userFromCookie, issue, clear, login, hash, verifyPw, validatePassword, bootstrap, middleware, requireAdmin };
