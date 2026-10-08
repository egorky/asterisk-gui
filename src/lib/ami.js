// Cliente mínimo del Asterisk Manager Interface (AMI) sin dependencias externas.
const net = require('net');
const tls = require('tls');
const EventEmitter = require('events');

class AmiClient extends EventEmitter {
  constructor() {
    super();
    this.cfg = null;
    this.sock = null;
    this.state = 'disabled'; // disabled | connecting | connected | error
    this.lastError = null;
    this.pending = new Map();
    this.seq = 0;
    this.buf = '';
    this.banner = null;
    this.retry = 0;
    this.timer = null;
    this.pingTimer = null;
    this.stopped = true;
  }

  configure(cfg) {
    this.stop();
    this.cfg = cfg;
    if (cfg && cfg.enabled !== false && cfg.host && cfg.username) this.start();
    else this._setState('disabled');
  }

  start() {
    this.stopped = false;
    this.retry = 0;
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.pingTimer);
    if (this.sock) { this.sock.removeAllListeners(); this.sock.on('error', () => {}); this.sock.destroy(); this.sock = null; }
    this._rejectAll(new Error('Conexión AMI cerrada'));
    this._setState('disabled');
  }

  _setState(s, err) {
    if (err !== undefined) this.lastError = err;
    if (this.state !== s) { this.state = s; this.emit('state', s); }
  }

  _connect() {
    if (this.stopped) return;
    this._setState('connecting');
    this.buf = '';
    this.banner = null;
    const { host, port, tls: useTls } = this.cfg;
    const sock = useTls
      ? tls.connect({ host, port, rejectUnauthorized: false })
      : net.connect({ host, port });
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.setKeepAlive(true, 15000);
    sock.setTimeout(10000, () => { if (this.state === 'connecting') sock.destroy(new Error('Tiempo de espera agotado conectando')); });
    sock.on('data', (d) => this._feed(d));
    sock.on('error', (e) => { this.lastError = e.code ? `${e.code}: ${e.message}` : e.message; });
    sock.on('close', () => this._closed(sock));
  }

  _closed(sock) {
    if (sock !== this.sock) return;
    clearInterval(this.pingTimer);
    this.sock = null;
    this._rejectAll(new Error('Conexión AMI perdida'));
    if (this.stopped) return;
    this._setState('error');
    const wait = Math.min(30000, 1000 * 2 ** Math.min(this.retry++, 5));
    this.timer = setTimeout(() => this._connect(), wait);
  }

  _rejectAll(err) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  _feed(data) {
    this.buf += data;
    if (this.banner === null) {
      const i = this.buf.indexOf('\n');
      if (i < 0) return;
      this.banner = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      this._login();
    }
    for (;;) {
      let end = this.buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      let chunk = this.buf.slice(0, end);
      let consumed = end + 4;
      if (/^Response: Follows/i.test(chunk) && !chunk.includes('--END COMMAND--')) {
        const m = this.buf.indexOf('--END COMMAND--');
        if (m < 0) return;
        const after = this.buf.indexOf('\r\n\r\n', m);
        if (after < 0) return;
        chunk = this.buf.slice(0, m);
        consumed = after + 4;
      }
      this.buf = this.buf.slice(consumed);
      this._dispatch(this._parse(chunk));
    }
  }

  _parse(chunk) {
    const msg = {};
    const extra = [];
    for (const line of chunk.split(/\r?\n/)) {
      const i = line.indexOf(': ');
      if (i > 0 && /^[\w-]+$/.test(line.slice(0, i))) {
        const k = line.slice(0, i), v = line.slice(i + 2);
        msg[k] = k === 'Output' && msg[k] !== undefined ? `${msg[k]}\n${v}` : v;
      } else if (line.trim() !== '--END COMMAND--') extra.push(line);
    }
    if (extra.length && /^Follows$/i.test(msg.Response || '')) msg.Output = extra.join('\n');
    return msg;
  }

  async _login() {
    try {
      const r = await this.action({ Action: 'Login', Username: this.cfg.username, Secret: this.cfg.secret, Events: 'on' }, { noQueue: true });
      this.retry = 0;
      this.sock && this.sock.setTimeout(0);
      this._setState('connected', null);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        this.action({ Action: 'Ping' }, { timeout: 8000 }).catch(() => this.sock && this.sock.destroy());
      }, 30000);
      this.emit('connected', r);
    } catch (e) {
      this.lastError = e.message;
      this.stopped = true; // credenciales incorrectas: no reintentar en bucle
      this._setState('error');
      if (this.sock) this.sock.destroy();
    }
  }

  _dispatch(msg) {
    if (msg.Response !== undefined) {
      const p = this.pending.get(msg.ActionID);
      if (!p) return;
      if (/^error$/i.test(msg.Response)) {
        clearTimeout(p.timer); this.pending.delete(msg.ActionID);
        return p.reject(new Error(msg.Message || 'Error AMI'));
      }
      if (p.list && /^start$/i.test(msg.EventList || '')) { p.head = msg; return; }
      clearTimeout(p.timer); this.pending.delete(msg.ActionID);
      return p.resolve({ response: msg, events: [], output: msg.Output || '' });
    }
    if (msg.Event) {
      const p = msg.ActionID && this.pending.get(msg.ActionID);
      if (p && p.list) {
        if (/^complete$/i.test(msg.EventList || '')) {
          clearTimeout(p.timer); this.pending.delete(msg.ActionID);
          return p.resolve({ response: p.head, events: p.events, output: '' });
        }
        return void p.events.push(msg);
      }
      this.emit('event', msg);
    }
  }

  /** Envía una acción. Con { list: true } acumula los eventos hasta EventList: Complete. */
  action(fields, { list = false, timeout = 12000, noQueue = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.sock || (!noQueue && this.state !== 'connected')) return reject(new Error('AMI no conectado'));
      const id = `g${++this.seq}`;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Tiempo agotado en ${fields.Action}`)); }, timeout);
      this.pending.set(id, { resolve, reject, list, events: [], timer });
      let out = '';
      for (const [k, v] of Object.entries({ ...fields, ActionID: id })) {
        if (v === undefined || v === null) continue;
        out += `${k}: ${String(v).replace(/[\r\n]+/g, ' ')}\r\n`;
      }
      this.sock.write(out + '\r\n');
    });
  }

  async command(cmd) {
    const r = await this.action({ Action: 'Command', Command: cmd }, { timeout: 20000 });
    return r.output;
  }
}

/** Prueba puntual de credenciales sin tocar la conexión principal. */
function testConnection(cfg) {
  return new Promise((resolve) => {
    const c = new AmiClient();
    const done = (r) => { c.removeAllListeners(); c.stopped = true; clearTimeout(c.timer); if (c.sock) c.sock.destroy(); clearInterval(c.pingTimer); resolve(r); };
    const t = setTimeout(() => done({ ok: false, error: c.lastError || 'Tiempo de espera agotado' }), 8000);
    c.on('connected', async () => {
      let version = c.banner;
      try { const r = await c.command('core show version'); version = (r || '').split('\n')[0] || version; } catch { /* opcional */ }
      clearTimeout(t); done({ ok: true, banner: c.banner, version });
    });
    c.on('state', (s) => { if (s === 'error') { clearTimeout(t); setTimeout(() => done({ ok: false, error: c.lastError || 'No se pudo conectar' }), 50); } });
    c.cfg = cfg; c.start();
  });
}

module.exports = { AmiClient, testConnection };
