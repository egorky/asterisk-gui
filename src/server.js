const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const express = require('express');
const { WebSocketServer } = require('ws');

const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

// Secreto de la app: .env o archivo generado automáticamente.
let secret = process.env.APP_SECRET;
if (!secret) {
  const f = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('base64url'), { mode: 0o600 });
  secret = fs.readFileSync(f, 'utf8').trim();
}
require('./lib/crypto').init(secret);

const store = require('./lib/store');
store.open(dataDir);
const settings = require('./lib/settings');
settings.load();
const auth = require('./lib/auth');
const asterisk = require('./lib/asterisk');

async function main() {
  const first = await auth.bootstrap(process.env);
  if (first) {
    console.log('\n  ┌─ Usuario inicial creado ───────────────────────────');
    console.log(`  │ Usuario:    ${first.username}`);
    if (first.password) console.log(`  │ Contraseña: ${first.password}   (cámbiela al ingresar)`);
    else console.log('  │ Contraseña: la definida en ADMIN_PASSWORD');
    console.log('  └────────────────────────────────────────────────────\n');
  }

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'");
    next();
  });
  app.use('/api', express.json({ limit: '256kb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Defensa CSRF adicional: las mutaciones deben venir del mismo origen
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const o = req.headers.origin;
      if (o && new URL(o).host !== req.headers.host) return res.status(403).json({ error: 'Origen no permitido' });
    }
    next();
  });
  app.use('/api', require('./routes/api'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
  app.use(express.static(path.join(root, 'public'), { maxAge: 0, etag: true }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (res.headersSent) return res.destroy();
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('[error]', req.method, req.url, err.message);
    res.status(status).json({ error: err.message || 'Error interno' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    const ok = req.url.startsWith('/ws') && auth.userFromCookie(req.headers.cookie) && (!origin || new URL(origin).host === req.headers.host);
    if (!ok) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === 1) c.send(data);
  };
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.send(JSON.stringify({ type: 'hello', status: asterisk.status(), live: asterisk.live, events: asterisk.ring.slice(0, 50) }));
  });
  setInterval(() => {
    for (const c of wss.clients) { if (!c.isAlive) { c.terminate(); continue; } c.isAlive = false; c.ping(); }
  }, 30000).unref();

  asterisk.on('live', (live) => { if (wss.clients.size) broadcast({ type: 'live', live }); });
  asterisk.on('status', (status) => broadcast({ type: 'status', status }));
  asterisk.on('event', (event) => broadcast({ type: 'event', event }));
  asterisk.on('core', (core) => broadcast({ type: 'core', core }));

  asterisk.configure(settings.get('asterisk'));
  settings.bus.on('change', (s, v) => { if (s === 'asterisk') { asterisk.core.version = null; asterisk.configure(v); } });

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => console.log(`Asterisk GUI escuchando en http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));

  const stop = () => { asterisk.ami.stop(); server.close(); setTimeout(() => process.exit(0), 300).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
