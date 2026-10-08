// Servicio que mantiene el estado en vivo de Asterisk (vía AMI) y detecta errores.
const EventEmitter = require('events');
const { AmiClient } = require('./ami');
const store = require('./store');

const CAUSES = {
  1: 'Número no asignado', 2: 'Sin ruta a la red', 3: 'Sin ruta al destino', 16: 'Finalización normal', 17: 'Usuario ocupado',
  18: 'Usuario no responde', 19: 'Sin respuesta (timeout)', 20: 'Suscriptor ausente', 21: 'Llamada rechazada',
  22: 'Número cambiado', 27: 'Destino fuera de servicio', 28: 'Formato de número inválido', 29: 'Facilidad rechazada',
  31: 'Normal, sin especificar', 34: 'Sin circuito disponible', 38: 'Red fuera de servicio', 41: 'Falla temporal',
  42: 'Congestión del equipo', 43: 'Información de acceso descartada', 44: 'Circuito solicitado no disponible',
  47: 'Recurso no disponible', 50: 'Facilidad no suscrita', 58: 'Capacidad de portadora no disponible',
  63: 'Servicio no disponible', 65: 'Capacidad no implementada', 79: 'Servicio no implementado',
  88: 'Destino incompatible', 102: 'Timeout de recuperación', 127: 'Interworking',
};
const HARD = new Set([1, 2, 3, 27, 34, 38, 41, 42, 44, 47, 58, 63, 102, 127, 28]);
const SECURITY = new Set(['FailedACL', 'InvalidAccountID', 'InvalidPassword', 'ChallengeResponseFailed', 'InvalidTransport',
  'AuthMethodNotAllowed', 'UnexpectedAddress', 'RequestBadFormat', 'RequestNotAllowed', 'RequestNotSupported',
  'SessionLimit', 'MemoryLimit', 'LoadAverageLimit']);

const clean = (v) => (v && !/^<?unknown>?$/i.test(String(v).trim()) ? v : '');
const toSecs = (d) => {
  if (!d) return 0;
  const p = String(d).split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : Number(d) || 0;
};

class AsteriskService extends EventEmitter {
  constructor() {
    super();
    this.ami = new AmiClient();
    this.live = { channels: [], calls: [], at: 0 };
    this.liveHash = '';
    this.core = { version: null, uptime: null, reload: null, currentCalls: null, settings: {} };
    this.endpoints = { list: [], registrations: [], tech: null, at: 0 };
    this.queues = [];
    this.unsupported = new Set();
    this.ring = [];
    this.timers = [];
    this.cfg = null;
    this.ami.on('state', (s) => { this.emit('status', this.status()); if (s !== 'connected') this._resetLive(); });
    this.ami.on('connected', () => { this.unsupported.clear(); this._refreshAll(); });
    this.ami.on('event', (e) => this._onEvent(e));
  }

  configure(cfg) {
    this.cfg = cfg;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.ami.configure(cfg);
    this.timers.push(setInterval(() => this.pollLive(), cfg.pollMs));
    this.timers.push(setInterval(() => this.pollCore(), 10000));
    this.timers.push(setInterval(() => this.pollEndpoints(), 20000));
    this.timers.push(setInterval(() => store.events.prune(), 3600 * 1000));
  }

  get connected() { return this.ami.state === 'connected'; }

  status() {
    return {
      state: this.ami.state,
      error: this.ami.lastError,
      host: this.cfg && this.cfg.host,
      port: this.cfg && this.cfg.port,
      banner: this.ami.banner,
    };
  }

  _resetLive() {
    this.live = { channels: [], calls: [], at: Date.now() };
    this.liveHash = '';
    this.emit('live', this.live);
  }

  async _refreshAll() {
    await Promise.allSettled([this.pollCore(), this.pollLive(), this.pollEndpoints()]);
    this.emit('status', this.status());
  }

  // ---- Llamadas en vivo -------------------------------------------------
  async pollLive() {
    if (!this.connected) return;
    try {
      const { events } = await this.ami.action({ Action: 'CoreShowChannels' }, { list: true });
      const channels = events.filter((e) => e.Event === 'CoreShowChannel').map((e) => ({
        channel: e.Channel, uniqueid: e.Uniqueid, linkedid: e.Linkedid || e.Uniqueid,
        callerNum: clean(e.CallerIDNum), callerName: clean(e.CallerIDName), connNum: clean(e.ConnectedLineNum), connName: clean(e.ConnectedLineName),
        context: e.Context, exten: e.Exten, priority: e.Priority, state: e.ChannelStateDesc, stateCode: e.ChannelState,
        app: e.Application, appData: e.ApplicationData, duration: toSecs(e.Duration), bridgeId: e.BridgeId || '',
        account: e.AccountCode || '',
      }));
      const groups = new Map();
      for (const c of channels) {
        if (!groups.has(c.linkedid)) groups.set(c.linkedid, []);
        groups.get(c.linkedid).push(c);
      }
      const calls = [...groups.entries()].map(([linkedid, legs]) => {
        legs.sort((a, b) => b.duration - a.duration);
        const first = legs[0];
        const up = legs.some((l) => l.state === 'Up' && l.bridgeId);
        const ringing = legs.some((l) => /Ring/i.test(l.state));
        const peer = legs.find((l) => l !== first);
        const from = first.callerNum || first.connNum || '';
        // Destino: línea conectada; si no, el caller id del otro tramo (número marcado); si no, la extensión
        const peerNum = peer && peer.callerNum && peer.callerNum !== from ? peer.callerNum : '';
        return {
          linkedid, legs, duration: first.duration,
          from, fromName: first.callerName || '',
          to: first.connNum || peerNum || first.exten || '', toName: first.connName || (peer && peer.callerName) || '',
          state: up ? 'Up' : ringing ? 'Ringing' : first.state, bridged: up,
        };
      }).sort((a, b) => b.duration - a.duration);
      const hash = JSON.stringify(calls.map((c) => [c.linkedid, c.state, c.legs.map((l) => [l.channel, l.state, l.app])]));
      this.live = { channels, calls, at: Date.now() };
      if (hash !== this.liveHash) this.liveHash = hash;
      this.emit('live', this.live); // siempre: la duración cambia cada ciclo
    } catch (e) { /* el siguiente ciclo reintenta */ }
  }

  async pollCore() {
    if (!this.connected) return;
    const [st, se, ver] = await Promise.allSettled([
      this.ami.action({ Action: 'CoreStatus' }),
      this.ami.action({ Action: 'CoreSettings' }),
      this.core.version ? null : this.ami.command('core show version'),
    ]);
    if (st.value) {
      const r = st.value.response;
      this.core.startup = r.CoreStartupDate ? `${r.CoreStartupDate} ${r.CoreStartupTime || ''}`.trim() : null;
      this.core.reload = r.CoreReloadDate ? `${r.CoreReloadDate} ${r.CoreReloadTime || ''}`.trim() : null;
      this.core.currentCalls = Number(r.CoreCurrentCalls);
    }
    if (se.value) {
      const r = se.value.response;
      this.core.settings = {
        ami: r.AMIversion, asterisk: r.AsteriskVersion, system: r.SystemName, maxCalls: r.CoreMaxCalls,
        maxLoad: r.CoreMaxLoadAvg, maxFiles: r.CoreMaxFilehandles, realtime: r.CoreRealTimeEnabled, cdr: r.CoreCDRenabled,
        http: r.CoreHTTPenabled,
      };
      this.core.version = r.AsteriskVersion || this.core.version;
    }
    if (ver.value) this.core.versionLine = ver.value.split('\n')[0];
    try {
      const up = await this.ami.command('core show uptime seconds');
      const m = /System uptime:\s*(\d+)/i.exec(up); const l = /Last reload:\s*(\d+)/i.exec(up);
      if (m) this.core.uptime = Number(m[1]);
      if (l) this.core.lastReloadSecs = Number(l[1]);
    } catch { /* ignora */ }
    this.emit('core', this.core);
  }

  /** Ejecuta una acción AMI y recuerda las que Asterisk no soporta para no repetirlas (evita ruido de seguridad). */
  async _try(fields, opts) {
    if (this.unsupported.has(fields.Action)) throw new Error('no soportada');
    try { return await this.ami.action(fields, opts); } catch (e) {
      if (/invalid\/unknown command/i.test(e.message)) this.unsupported.add(fields.Action);
      throw e;
    }
  }

  async pollEndpoints() {
    if (!this.connected) return;
    const out = { list: [], registrations: [], tech: null, at: Date.now() };
    try {
      const { events } = await this._try({ Action: 'PJSIPShowEndpoints' }, { list: true, timeout: 20000 });
      out.tech = 'PJSIP';
      out.list = events.filter((e) => e.Event === 'EndpointList').map((e) => ({
        name: e.ObjectName, tech: 'PJSIP', state: e.DeviceState, contacts: e.Contacts, transport: e.Transport,
        aor: e.Aor, activeChannels: Number(e.ActiveChannels || 0),
        online: /not in use|in use|ringing|busy|on hold/i.test(e.DeviceState || '') && !/unavailable/i.test(e.DeviceState || ''),
      }));
      try {
        const r = await this._try({ Action: 'PJSIPShowRegistrationsOutbound' }, { list: true });
        out.registrations = r.events.filter((e) => e.Event === 'OutboundRegistrationDetail').map((e) => ({
          name: e.ObjectName, server: e.ServerUri, client: e.ClientUri, status: e.Status, tech: 'PJSIP',
        }));
      } catch { /* sin registros salientes */ }
    } catch { /* PJSIP no cargado: probar chan_sip */ }
    if (!out.list.length) {
      try {
        const { events } = await this._try({ Action: 'SIPpeers' }, { list: true, timeout: 20000 });
        out.tech = 'SIP';
        out.list = events.filter((e) => e.Event === 'PeerEntry').map((e) => ({
          name: e.ObjectName, tech: 'SIP', state: e.Status, contacts: e['IPaddress'] ? `${e.IPaddress}:${e.IPport}` : '',
          transport: e.Dynamic === 'yes' ? 'dinámico' : 'estático', activeChannels: 0,
          online: /^OK/i.test(e.Status || ''),
        }));
        const r = await this._try({ Action: 'SIPshowregistry' }, { list: true });
        out.registrations = r.events.filter((e) => e.Event === 'RegistryEntry').map((e) => ({
          name: e.Username, server: `${e.Host}:${e.Port}`, client: e.Username, status: e.State, tech: 'SIP',
        }));
      } catch { /* sin chan_sip */ }
    }
    try {
      const { events } = await this._try({ Action: 'QueueSummary' }, { list: true });
      this.queues = events.filter((e) => e.Event === 'QueueSummary').map((e) => ({
        name: e.Queue, loggedIn: +e.LoggedIn, available: +e.Available, callers: +e.Callers, holdTime: +e.HoldTime, talkTime: +e.TalkTime,
      }));
    } catch { this.queues = []; }
    this.endpoints = out;
    this.emit('endpoints', out);
  }

  // ---- Eventos y errores -----------------------------------------------
  _record(kind, severity, title, detail) {
    const e = { ts: new Date().toISOString(), kind, severity, title, detail };
    try { e.id = store.events.add(e); } catch { /* ignora */ }
    this.ring.unshift(e);
    if (this.ring.length > 200) this.ring.pop();
    this.emit('event', e);
  }

  _onEvent(e) {
    switch (e.Event) {
      case 'Hangup': {
        const cause = Number(e.Cause);
        if (!cause || cause === 16) return;
        const sev = HARD.has(cause) ? 'error' : 'warning';
        const desc = CAUSES[cause] || e['Cause-txt'] || `Causa ${cause}`;
        this._record('hangup', sev, `Colgado con causa ${cause}: ${desc}`, {
          channel: e.Channel, uniqueid: e.Uniqueid, linkedid: e.Linkedid, callerNum: e.CallerIDNum,
          connNum: e.ConnectedLineNum, exten: e.Exten, context: e.Context, cause, causeTxt: desc,
        });
        break;
      }
      case 'DialEnd': {
        const s = e.DialStatus;
        if (s === 'CONGESTION' || s === 'CHANUNAVAIL') {
          this._record('dial', 'error', `Marcación fallida: ${s}`, {
            channel: e.Channel, dest: e.DestChannel, uniqueid: e.Uniqueid, linkedid: e.Linkedid,
            callerNum: e.CallerIDNum, exten: e.DestExten || e.Exten, status: s,
          });
        }
        break;
      }
      case 'PeerStatus':
        if (/Unreachable|Rejected|Lagged/i.test(e.PeerStatus || '')) {
          this._record('peer', 'warning', `Peer ${e.Peer}: ${e.PeerStatus}`, { peer: e.Peer, status: e.PeerStatus, address: e.Address, cause: e.Cause });
        }
        break;
      case 'ContactStatus':
        if (/Unreachable|Removed|Unavailable/i.test(e.ContactStatus || '')) {
          this._record('peer', 'warning', `Contacto ${e.EndpointName || e.AOR}: ${e.ContactStatus}`, { endpoint: e.EndpointName, uri: e.URI, status: e.ContactStatus, rtt: e.RoundtripUsec });
        }
        break;
      case 'Registry':
        if (/Rejected|Unregistered|Failed|Timeout/i.test(e.Status || '')) {
          this._record('registry', 'error', `Registro ${e.Username || e.Domain}: ${e.Status}`, { domain: e.Domain, user: e.Username, status: e.Status });
        }
        break;
      case 'ChannelReload': case 'Reload':
        this._record('system', 'info', `Recarga: ${e.Module || e.ChannelType || 'módulo'}`, { status: e.ReloadStatus });
        break;
      case 'Shutdown':
        this._record('system', 'error', 'Asterisk se está apagando', { shutdown: e.Shutdown, restart: e.Restart });
        break;
      default:
        if (SECURITY.has(e.Event) && e.AccountID !== (this.cfg && this.cfg.username)) {
          this._record('security', 'warning', `Seguridad: ${e.Event}`, {
            account: e.AccountID, remote: e.RemoteAddress, service: e.Service, module: e.Module, local: e.LocalAddress, session: e.SessionID,
          });
        }
    }
  }
}

module.exports = new AsteriskService();
module.exports.CAUSES = CAUSES;
