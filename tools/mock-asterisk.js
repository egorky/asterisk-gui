#!/usr/bin/env node
// Simulador de Asterisk para probar la GUI sin un servidor real.
//   AMI en 127.0.0.1:5039 (usuario "gui", clave "gui-secret")
//   CDR/CEL SQLite en demo/master.db y grabaciones de ejemplo en demo/recordings
const net = require('net');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEMO = path.join(__dirname, '..', 'demo');
const PORT = Number(process.env.MOCK_PORT) || 5039;
fs.mkdirSync(path.join(DEMO, 'recordings'), { recursive: true });

const p2 = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (a) => a[rnd(0, a.length - 1)];

function wav(file, secs) {
  const rate = 8000, n = rate * secs, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  const f = rnd(300, 700);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * i / rate) * 3000 * (Math.floor(i / 4000) % 2 ? 0.2 : 1)), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

function seed() {
  const dbf = path.join(DEMO, 'master.db');
  if (fs.existsSync(dbf)) return;
  console.log('Generando datos de ejemplo…');
  const db = new DatabaseSync(dbf);
  db.exec(`CREATE TABLE cdr (calldate TEXT, clid TEXT, src TEXT, dst TEXT, dcontext TEXT, channel TEXT, dstchannel TEXT, lastapp TEXT,
    lastdata TEXT, duration INT, billsec INT, disposition TEXT, amaflags INT, accountcode TEXT, uniqueid TEXT, userfield TEXT, linkedid TEXT, sequence INT, peeraccount TEXT, recordingfile TEXT);
    CREATE TABLE cel (id INTEGER PRIMARY KEY, eventtype TEXT, eventtime TEXT, cid_name TEXT, cid_num TEXT, exten TEXT, context TEXT, channame TEXT, appname TEXT, appdata TEXT, uniqueid TEXT, linkedid TEXT, peer TEXT, extra TEXT);
    CREATE INDEX i1 ON cdr(calldate); CREATE INDEX i2 ON cdr(uniqueid);`);
  const ins = db.prepare('INSERT INTO cdr VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const cel = db.prepare('INSERT INTO cel(eventtype,eventtime,cid_name,cid_num,exten,context,channame,appname,appdata,uniqueid,linkedid,peer,extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const exts = ['1001', '1002', '1003', '1004', '1005'];
  const ext = ['573001234567', '573109876543', '5712345678', '34911222333', '18005551234', '525512345678'];
  const names = ['Ana Pérez', 'Luis Gómez', 'María Ríos', 'Carlos Díaz', 'Sofía Luna'];
  const now = Date.now();
  db.exec('BEGIN');
  let recCount = 0;
  for (let i = 0; i < 2500; i++) {
    const t = new Date(now - Math.pow(Math.random(), 1.6) * 10 * 86400e3);
    const h = t.getHours(); if (h < 7 || h > 20) t.setHours(rnd(8, 19));
    const inbound = Math.random() < 0.55;
    const e = pick(exts), x = pick(ext);
    const r = Math.random();
    const disp = r < 0.68 ? 'ANSWERED' : r < 0.82 ? 'NO ANSWER' : r < 0.93 ? 'BUSY' : 'FAILED';
    const dur = disp === 'ANSWERED' ? rnd(8, 600) : rnd(2, 45);
    const bill = disp === 'ANSWERED' ? Math.max(1, dur - rnd(2, 8)) : 0;
    const epoch = Math.floor(t.getTime() / 1000);
    const uid = `${epoch}.${rnd(10, 9999)}`;
    const src = inbound ? x : e, dst = inbound ? e : x;
    const chan = inbound ? `PJSIP/trunk-main-${rnd(1000, 9999).toString(16)}` : `PJSIP/${e}-${rnd(1000, 9999).toString(16)}`;
    const dch = inbound ? `PJSIP/${e}-${rnd(1000, 9999).toString(16)}` : `PJSIP/trunk-main/sip:${x}@carrier.example`;
    let recfile = '';
    if (disp === 'ANSWERED' && recCount < 60 && Math.random() < 0.4) {
      const dir = path.join(DEMO, 'recordings', String(t.getFullYear()), p2(t.getMonth() + 1), p2(t.getDate()));
      fs.mkdirSync(dir, { recursive: true });
      const stamp = `${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`;
      const ex = recCount % 5 === 0 ? 'WAV' : 'wav';
      recfile = `${inbound ? 'in' : 'out'}-${x}-${e}-${stamp}-${uid}.${ex}`;
      wav(path.join(dir, recfile), rnd(2, 5));
      recCount++;
    }
    ins.run(fmt(t), `"${inbound ? 'Cliente' : names[exts.indexOf(e)]}" <${src}>`, src, dst, inbound ? 'from-trunk' : 'from-internal', chan, disp === 'ANSWERED' ? dch : '',
      disp === 'ANSWERED' ? 'Dial' : 'Hangup', disp === 'ANSWERED' ? `PJSIP/${dst}` : '', dur, bill, disp, 3, '', uid, '', uid, 0, '', recfile);
    if (i % 5 === 0) {
      for (const [ty, app] of [['CHAN_START', ''], ['APP_START', 'Dial'], ['ANSWER', 'Dial'], ['BRIDGE_ENTER', ''], ['HANGUP', ''], ['CHAN_END', '']]) {
        cel.run(ty, fmt(t), '', src, dst, 'from-internal', chan, app, '', uid, uid, '', '{}');
      }
    }
  }
  db.exec('COMMIT'); db.close();
  // Una grabación en .mp3 (cabecera mínima: solo para listar; el audio WAV de ejemplo es reproducible)
  fs.writeFileSync(path.join(DEMO, 'recordings', 'exten-1001-1002-20250101-101010-1735726210.55.mp3'), Buffer.from('//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'base64'));
  console.log(`Listo: ${path.relative(process.cwd(), DEMO)}/master.db y ${recCount} grabaciones.`);
}
seed();

// ---- AMI simulado ------------------------------------------------------
const calls = new Map();
function newCall() {
  const id = `${Math.floor(Date.now() / 1000)}.${rnd(100, 9999)}`;
  const ex = pick(['1001', '1002', '1003', '1004']), num = pick(['573001234567', '573109876543', '34911222333']);
  const inbound = Math.random() < 0.5;
  calls.set(id, { id, start: Date.now(), ex, num, inbound, answered: false, ringFor: rnd(2, 8) * 1000, ttl: rnd(15, 120) * 1000 });
}
setInterval(() => { if (calls.size < 6 && Math.random() < 0.5) newCall(); }, 3000);
newCall(); newCall();
const dur = (ms) => { const s = Math.floor(ms / 1000); return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`; };

const servers = new Set();
const send = (s, o) => s.write(Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');

function channels() {
  const out = [];
  for (const c of calls.values()) {
    const age = Date.now() - c.start, up = age > c.ringFor;
    c.answered = up;
    const a = c.inbound ? `PJSIP/trunk-main-${c.id.slice(-4)}` : `PJSIP/${c.ex}-0000${c.id.slice(-3)}`;
    const b = c.inbound ? `PJSIP/${c.ex}-0000${c.id.slice(-3)}` : `PJSIP/trunk-main-${c.id.slice(-4)}`;
    const mk = (ch, num, conn, uid) => ({ Event: 'CoreShowChannel', Channel: ch, Uniqueid: uid, Linkedid: c.id, CallerIDNum: num, CallerIDName: '', ConnectedLineNum: conn, ConnectedLineName: '',
      Context: 'from-internal', Exten: c.inbound ? c.ex : c.num, Priority: 1, ChannelState: up ? 6 : 5, ChannelStateDesc: up ? 'Up' : 'Ringing', Application: up ? 'Dial' : 'Dial', ApplicationData: 'PJSIP/x,30',
      Duration: dur(age), BridgeId: up ? `br-${c.id}` : '', AccountCode: '' });
    out.push(mk(a, c.inbound ? c.num : c.ex, c.inbound ? c.ex : c.num, c.id), mk(b, c.inbound ? c.ex : c.num, c.inbound ? c.num : c.ex, `${c.id}1`));
  }
  return out;
}
setInterval(() => {
  for (const c of [...calls.values()]) {
    if (Date.now() - c.start > c.ttl) {
      calls.delete(c.id);
      const cause = Math.random() < 0.7 ? 16 : pick([17, 19, 21, 34, 38, 41, 42]);
      for (const s of servers) send(s, { Event: 'Hangup', Channel: `PJSIP/${c.ex}-0000${c.id.slice(-3)}`, Uniqueid: c.id, Linkedid: c.id, CallerIDNum: c.num, ConnectedLineNum: c.ex, Exten: c.ex, Context: 'from-internal', Cause: cause, 'Cause-txt': 'x' });
    }
  }
  if (Math.random() < 0.12) for (const s of servers) send(s, { Event: pick(['InvalidPassword', 'ChallengeResponseFailed', 'FailedACL']), AccountID: pick(['100', '2000', 'admin', 'test']), RemoteAddress: `IPV4/UDP/${pick(['185.234.1.9', '45.9.148.22', '91.240.118.4'])}/5060`, Service: 'PJSIP' });
}, 4000);

const CONF = {
  'pjsip.conf': { 'transport-udp': { type: 'transport', protocol: 'udp', bind: '0.0.0.0:5060' }, '1001': { type: 'endpoint', context: 'from-internal', auth: 'auth1001', secret: 'abc' }, 'auth1001': { type: 'auth', auth_type: 'userpass', username: '1001', password: 'topsecret' } },
  'extensions.conf': { 'from-internal': { exten: '_X.,1,Dial(PJSIP/${EXTEN})' } },
};
function onAction(s, a) {
  const id = a.ActionID, ok = (extra = {}) => send(s, { Response: 'Success', ActionID: id, ...extra });
  const list = (evt, items, name) => {
    send(s, { Response: 'Success', ActionID: id, EventList: 'start', Message: 'A listing follows' });
    items.forEach((it) => send(s, { ...it, ActionID: id }));
    send(s, { Event: `${name}Complete`, EventList: 'Complete', ListItems: items.length, ActionID: id });
  };
  switch (a.Action) {
    case 'Login': return a.Username === 'gui' && a.Secret === 'gui-secret' ? ok({ Message: 'Authentication accepted' }) : send(s, { Response: 'Error', ActionID: id, Message: 'Authentication failed' });
    case 'Ping': return ok({ Ping: 'Pong' });
    case 'CoreStatus': return ok({ CoreStartupDate: '2025-09-01', CoreStartupTime: '08:00:00', CoreReloadDate: '2025-10-01', CoreReloadTime: '09:00:00', CoreCurrentCalls: calls.size });
    case 'CoreSettings': return ok({ AMIversion: '9.0.0', AsteriskVersion: '20.9.3', SystemName: 'mock-pbx', CoreMaxCalls: 0, CoreMaxLoadAvg: '0.0', CoreMaxFilehandles: 0, CoreRealTimeEnabled: 'Yes', CoreCDRenabled: 'Yes', CoreHTTPenabled: 'Yes' });
    case 'CoreShowChannels': return list('CoreShowChannel', channels(), 'CoreShowChannels');
    case 'PJSIPShowEndpoints': return list('EndpointList', ['1001', '1002', '1003', '1004', '1005', 'trunk-main'].map((n, i) => ({ Event: 'EndpointList', ObjectName: n, Transport: 'transport-udp', Aor: n, Contacts: `${n}/sip:${n}@10.0.0.${10 + i}:5060`, DeviceState: i === 4 ? 'Unavailable' : [...calls.values()].some((c) => c.ex === n) ? 'In use' : 'Not in use', ActiveChannels: 0 })), 'EndpointList');
    case 'PJSIPShowRegistrationsOutbound': return list('', [{ Event: 'OutboundRegistrationDetail', ObjectName: 'reg-carrier', ServerUri: 'sip:carrier.example', ClientUri: 'sip:pbx@carrier.example', Status: 'Registered' }], 'OutboundRegistrationDetail');
    case 'QueueSummary': return list('', [{ Event: 'QueueSummary', Queue: 'ventas', LoggedIn: 3, Available: 2, Callers: 0, HoldTime: 12, TalkTime: 140 }, { Event: 'QueueSummary', Queue: 'soporte', LoggedIn: 2, Available: 1, Callers: 1, HoldTime: 35, TalkTime: 210 }], 'QueueSummary');
    case 'GetConfig': {
      const f = CONF[a.Filename];
      if (!f) return send(s, { Response: 'Error', ActionID: id, Message: 'Config file not found' });
      const o = { Response: 'Success', ActionID: id }; let ci = 0;
      for (const [cat, vars] of Object.entries(f)) { o[`Category-${String(ci).padStart(6, '0')}`] = cat; let li = 0; for (const [k, v] of Object.entries(vars)) o[`Line-${String(ci).padStart(6, '0')}-${String(li++).padStart(6, '0')}`] = `${k}=${v}`; ci++; }
      return send(s, o);
    }
    case 'Command': {
      const c = a.Command;
      const t = c.startsWith('core show version') ? 'Asterisk 20.9.3 (mock) built by mock @ demo'
        : c.startsWith('core show uptime') ? 'System uptime: 3888000\nLast reload: 600000' : c.startsWith('core show channels count') ? `${calls.size * 2} active channels\n${calls.size} active calls\n1234 calls processed`
        : `Salida simulada de: ${c}`;
      return send(s, { Response: 'Success', ActionID: id, Message: 'Command output follows', Output: t.split('\n').join('\r\nOutput: ') });
    }
    default: return send(s, { Response: 'Error', ActionID: id, Message: `Invalid/unknown command: ${a.Action}` });
  }
}

net.createServer((s) => {
  s.write('Asterisk Call Manager/9.0.0\r\n');
  servers.add(s);
  let buf = '';
  s.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\r\n\r\n')) >= 0) {
      const a = {};
      for (const l of buf.slice(0, i).split('\r\n')) { const j = l.indexOf(': '); if (j > 0) a[l.slice(0, j)] = l.slice(j + 2); }
      buf = buf.slice(i + 4);
      onAction(s, a);
    }
  });
  s.on('close', () => servers.delete(s));
  s.on('error', () => servers.delete(s));
}).listen(PORT, '127.0.0.1', () => console.log(`Asterisk simulado (AMI) en 127.0.0.1:${PORT}  usuario=gui  clave=gui-secret`));
