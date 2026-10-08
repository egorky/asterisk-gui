// Ajustes editables desde la GUI. Los secretos se guardan cifrados y nunca se devuelven al navegador.
const store = require('./store');
const cx = require('./crypto');
const EventEmitter = require('events');

const DEFAULTS = {
  asterisk: {
    enabled: true,
    host: '127.0.0.1',
    port: 5038,
    username: '',
    secret: '',
    tls: false,
    pollMs: 2000,
    configFiles: ['asterisk.conf', 'pjsip.conf', 'sip.conf', 'extensions.conf', 'queues.conf', 'modules.conf',
      'manager.conf', 'http.conf', 'rtp.conf', 'cdr.conf', 'cel.conf', 'features.conf', 'musiconhold.conf'],
  },
  db: {
    enabled: false,
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    user: '',
    password: '',
    database: 'asteriskcdrdb',
    file: '/var/log/asterisk/master.db',
    ssl: false,
    cdrTable: 'cdr',
    celTable: 'cel',
    dateColumn: 'calldate',
    recordingColumn: 'recordingfile',
  },
  recordings: {
    dirs: [], // [{ id, label, path }]
    extensions: ['mp3', 'wav'],
    recursive: true,
    cacheSeconds: 60,
  },
  calls: {
    internalMaxDigits: 5, // números de hasta N dígitos se consideran extensiones internas
    inboundContexts: ['from-trunk', 'from-pstn', 'from-external'],
    outboundContexts: [],
    trunkChannels: [], // p. ej. SIP/xtrim-*, PJSIP/trunk-*
  },
  ui: {
    refreshSeconds: 5,
    theme: 'dark',
    rowsPerPage: 50,
  },
};

const SECRETS = { asterisk: ['secret'], db: ['password'] };
const bus = new EventEmitter();
let cache = {};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') out[k] = merge(base[k], v);
    else out[k] = v;
  }
  return out;
}

function load() {
  cache = {};
  for (const section of Object.keys(DEFAULTS)) {
    const saved = store.getSetting(section) || {};
    const merged = merge(DEFAULTS[section], saved);
    for (const f of SECRETS[section] || []) merged[f] = cx.decrypt(merged[f]);
    cache[section] = merged;
  }
}

const num = (v, d, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const str = (v, d = '') => (v == null ? d : String(v).trim());
const ident = (v, d) => (/^[A-Za-z0-9_.]{1,64}$/.test(str(v)) ? str(v) : d);

// Normaliza y valida lo que llega desde la GUI para cada sección.
const SANITIZE = {
  asterisk(i, cur) {
    return {
      enabled: i.enabled !== false,
      host: str(i.host, cur.host) || '127.0.0.1',
      port: num(i.port, 5038, 1, 65535),
      username: str(i.username),
      secret: i.secret ? String(i.secret) : cur.secret,
      tls: !!i.tls,
      pollMs: num(i.pollMs, 2000, 500, 60000),
      configFiles: (Array.isArray(i.configFiles) ? i.configFiles : cur.configFiles)
        .map((f) => str(f)).filter((f) => /^[\w.-]+$/.test(f)).slice(0, 100),
    };
  },
  db(i, cur) {
    const type = ['mysql', 'postgres', 'sqlite'].includes(i.type) ? i.type : 'mysql';
    return {
      enabled: i.enabled !== false,
      type,
      host: str(i.host, '127.0.0.1') || '127.0.0.1',
      port: num(i.port, type === 'postgres' ? 5432 : 3306, 1, 65535),
      user: str(i.user),
      password: i.password ? String(i.password) : cur.password,
      database: str(i.database),
      file: str(i.file),
      ssl: !!i.ssl,
      cdrTable: ident(i.cdrTable, 'cdr'),
      celTable: ident(i.celTable, 'cel'),
      dateColumn: ident(i.dateColumn, 'calldate'),
      recordingColumn: ident(i.recordingColumn, 'recordingfile'),
    };
  },
  recordings(i, cur) {
    const dirs = (Array.isArray(i.dirs) ? i.dirs : cur.dirs)
      .map((d, n) => ({
        id: /^[a-z0-9]{4,16}$/.test(d.id || '') ? d.id : Math.random().toString(36).slice(2, 10),
        label: str(d.label) || `Directorio ${n + 1}`,
        path: str(d.path),
      }))
      .filter((d) => d.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(d.path))
      .slice(0, 50);
    const exts = (Array.isArray(i.extensions) ? i.extensions : cur.extensions)
      .map((e) => str(e).replace(/^\./, '').toLowerCase()).filter((e) => /^[a-z0-9]{1,6}$/.test(e));
    return {
      dirs,
      extensions: [...new Set(exts)].length ? [...new Set(exts)] : ['mp3', 'wav'],
      recursive: i.recursive !== false,
      cacheSeconds: num(i.cacheSeconds, 60, 5, 3600),
    };
  },
  calls(i, cur) {
    const list = (v, d) => (Array.isArray(v) ? v : d).map((x) => str(x)).filter((x) => /^[\w.*+\/@-]{1,64}$/.test(x)).slice(0, 50);
    return {
      internalMaxDigits: num(i.internalMaxDigits, 5, 1, 15),
      inboundContexts: list(i.inboundContexts, cur.inboundContexts),
      outboundContexts: list(i.outboundContexts, cur.outboundContexts),
      trunkChannels: list(i.trunkChannels, cur.trunkChannels),
    };
  },
  ui(i, cur) {
    return {
      refreshSeconds: num(i.refreshSeconds, 5, 2, 120),
      theme: ['dark', 'light'].includes(i.theme) ? i.theme : cur.theme,
      rowsPerPage: [25, 50, 100, 200].includes(Number(i.rowsPerPage)) ? Number(i.rowsPerPage) : 50,
    };
  },
};

function get(section) { return section ? cache[section] : cache; }

function save(section, input) {
  if (!SANITIZE[section]) throw Object.assign(new Error('Sección inválida'), { status: 400 });
  const next = SANITIZE[section](input || {}, cache[section]);
  const toStore = { ...next };
  for (const f of SECRETS[section] || []) toStore[f] = cx.encrypt(next[f]);
  store.setSetting(section, toStore);
  cache[section] = next;
  bus.emit('change', section, next);
  return next;
}

// Versión segura para el navegador: sin secretos, con indicador de si existen.
function publicView(section) {
  const copy = { ...cache[section] };
  for (const f of SECRETS[section] || []) { copy[`has${f[0].toUpperCase()}${f.slice(1)}`] = !!copy[f]; delete copy[f]; }
  return copy;
}

function publicAll() {
  return Object.fromEntries(Object.keys(DEFAULTS).map((s) => [s, publicView(s)]));
}

module.exports = { load, get, save, publicView, publicAll, bus, DEFAULTS };
