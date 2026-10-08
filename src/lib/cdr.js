// Acceso de solo lectura al histórico (CDR/CEL) que Asterisk ya guarda en su base de datos.
const settings = require('./settings');
const direction = require('./direction');

const STD_COLS = ['start', 'answer', 'end', 'calldate', 'clid', 'src', 'dst', 'dcontext', 'channel', 'dstchannel', 'lastapp', 'lastdata',
  'duration', 'billsec', 'disposition', 'amaflags', 'accountcode', 'uniqueid', 'linkedid', 'userfield', 'sequence', 'peeraccount'];

let adapter = null;
let adapterKey = '';
const colCache = new Map();

async function makeAdapter(cfg) {
  if (cfg.type === 'mysql') {
    const mysql = require('mysql2/promise');
    const pool = mysql.createPool({
      host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
      connectionLimit: 4, dateStrings: true, connectTimeout: 8000, ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    });
    return {
      dialect: 'mysql',
      q: (c) => `\`${c}\``,
      ph: () => '?',
      query: async (sql, params = []) => (await pool.query(sql, params))[0],
      close: () => pool.end(),
    };
  }
  if (cfg.type === 'postgres') {
    const pg = require('pg');
    pg.types.setTypeParser(1114, (v) => v);
    pg.types.setTypeParser(1184, (v) => v);
    pg.types.setTypeParser(20, (v) => Number(v));
    const pool = new pg.Pool({
      host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, max: 4,
      connectionTimeoutMillis: 8000, ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', () => {});
    return {
      dialect: 'postgres',
      q: (c) => `"${c}"`,
      ph: (i) => `$${i}`,
      query: async (sql, params = []) => (await pool.query(sql, params)).rows,
      close: () => pool.end(),
    };
  }
  if (!cfg.file) throw new Error('Falta la ruta del archivo SQLite');
  const db = require('./sqlite').open(cfg.file, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 3000');
  return {
    dialect: 'sqlite',
    q: (c) => `"${c}"`,
    ph: () => '?',
    query: async (sql, params = []) => db.prepare(sql).all(...params),
    close: () => db.close(),
  };
}

async function getAdapter() {
  const cfg = settings.get('db');
  if (!cfg.enabled) throw Object.assign(new Error('La base de datos del histórico no está configurada'), { status: 503 });
  const key = JSON.stringify(cfg);
  if (adapter && key === adapterKey) return adapter;
  await reset();
  adapter = await makeAdapter(cfg);
  adapterKey = key;
  return adapter;
}

async function reset() {
  const a = adapter;
  adapter = null; adapterKey = ''; colCache.clear();
  if (a) { try { await a.close(); } catch { /* ignora */ } }
}
settings.bus.on('change', (s) => { if (s === 'db') reset(); });

async function columnsOf(a, table) {
  if (colCache.has(table)) return colCache.get(table);
  let rows;
  if (a.dialect === 'mysql') rows = await a.query('SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]);
  else if (a.dialect === 'postgres') rows = await a.query('SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table]);
  else rows = (await a.query(`PRAGMA table_info(${a.q(table)})`)).map((r) => ({ c: r.name }));
  const cols = rows.map((r) => r.c || r.COLUMN_NAME || r.column_name);
  colCache.set(table, cols);
  return cols;
}

async function schema() {
  const a = await getAdapter();
  const cfg = settings.get('db');
  const cols = await columnsOf(a, cfg.cdrTable);
  if (!cols.length) throw Object.assign(new Error(`La tabla "${cfg.cdrTable}" no existe o no tiene columnas`), { status: 400 });
  const dateCol = [cfg.dateColumn, 'calldate', 'start'].find((c) => cols.includes(c));
  if (!dateCol) throw Object.assign(new Error(`No se encontró columna de fecha (${cfg.dateColumn})`), { status: 400 });
  const sel = STD_COLS.filter((c) => cols.includes(c));
  const rec = cols.includes(cfg.recordingColumn) ? cfg.recordingColumn : null;
  if (rec && !sel.includes(rec)) sel.push(rec);
  return { a, cfg, cols, dateCol, sel, rec, dirExpr: direction.sqlCase(a, cols) };
}

const esc = (s) => String(s).replace(/[!%_]/g, (m) => `!${m}`);

function buildWhere(S, f) {
  const { a, cols, dateCol } = S;
  const w = [], p = [];
  const add = (sql, ...vals) => {
    let s = sql;
    for (const v of vals) { p.push(v); s = s.replace('#', a.ph(p.length)); }
    w.push(s);
  };
  const like = (cols2, val) => {
    const parts = cols2.filter((c) => cols.includes(c)).map((c) => {
      p.push(`%${esc(val)}%`);
      return `${a.dialect === 'postgres' ? `CAST(${a.q(c)} AS TEXT)` : a.q(c)} ${a.dialect === 'postgres' ? 'ILIKE' : 'LIKE'} ${a.ph(p.length)} ESCAPE '!'`;
    });
    if (parts.length) w.push(`(${parts.join(' OR ')})`);
  };
  const D = a.q(dateCol);
  if (f.from) add(`${D} >= #`, f.from);
  if (f.to) add(`${D} <= #`, f.to);
  if (f.number) like(['src', 'dst', 'clid'], f.number);
  if (f.src) like(['src'], f.src);
  if (f.dst) like(['dst'], f.dst);
  if (f.channel) like(['channel', 'dstchannel'], f.channel);
  if (f.account) like(['accountcode'], f.account);
  if (f.q) like(['clid', 'src', 'dst', 'channel', 'dstchannel', 'lastapp', 'lastdata', 'userfield', 'uniqueid', 'linkedid'], f.q);
  if (f.uniqueid && cols.includes('uniqueid')) {
    if (cols.includes('linkedid')) {
      p.push(`%${esc(f.uniqueid)}%`, `%${esc(f.uniqueid)}%`);
      const op = a.dialect === 'postgres' ? 'ILIKE' : 'LIKE';
      w.push(`(${a.q('uniqueid')} ${op} ${a.ph(p.length - 1)} ESCAPE '!' OR ${a.q('linkedid')} ${op} ${a.ph(p.length)} ESCAPE '!')`);
    } else like(['uniqueid'], f.uniqueid);
  }
  if (['in', 'out', 'internal', 'other'].includes(f.direction)) w.push(`(${S.dirExpr}) = '${f.direction}'`);
  if (f.disposition && cols.includes('disposition')) {
    const list = String(f.disposition).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 8);
    if (list.length) {
      const ph = list.map((v) => { p.push(v); return a.ph(p.length); });
      w.push(`UPPER(${a.q('disposition')}) IN (${ph.join(',')})`);
    }
  }
  if (f.minDur !== undefined && f.minDur !== '' && cols.includes('billsec') && !isNaN(f.minDur)) add(`${a.q('billsec')} >= #`, Number(f.minDur));
  if (f.maxDur !== undefined && f.maxDur !== '' && cols.includes('billsec') && !isNaN(f.maxDur)) add(`${a.q('billsec')} <= #`, Number(f.maxDur));
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params: p };
}

const SORTS = { date: null, duration: 'duration', billsec: 'billsec', src: 'src', dst: 'dst' };

function norm(r, S) {
  const o = { ...r };
  o.date = r[S.dateCol];
  for (const k of ['duration', 'billsec', 'sequence']) if (o[k] != null) o[k] = Number(o[k]);
  if (S.rec) o.recordingfile = r[S.rec] || '';
  return o;
}

async function list(f = {}, { limit = 50, offset = 0, sort = 'date', dir = 'desc' } = {}) {
  const S = await schema();
  const { a } = S;
  const { where, params } = buildWhere(S, f);
  const sortCol = sort === 'date' || !SORTS[sort] || !S.cols.includes(SORTS[sort]) ? S.dateCol : SORTS[sort];
  const order = `${a.q(sortCol)} ${dir === 'asc' ? 'ASC' : 'DESC'}`;
  const table = a.q(S.cfg.cdrTable);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 50000);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = await a.query(`SELECT ${S.sel.map((c) => a.q(c)).join(', ')}, ${S.dirExpr} AS ${a.q('direction')} FROM ${table} ${where} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, params);
  let total = null;
  if (limit <= 1000) {
    const t = await a.query(`SELECT COUNT(*) AS n FROM ${table} ${where}`, params);
    total = Number(t[0].n ?? Object.values(t[0])[0]);
  }
  return { rows: rows.map((r) => norm(r, S)), total, columns: [...S.sel, 'direction'] };
}

async function detail(id) {
  const S = await schema();
  const { a } = S;
  const idCols = ['uniqueid', 'linkedid'].filter((c) => S.cols.includes(c));
  const where = idCols.map((c, i) => `${a.q(c)} = ${a.ph(i + 1)}`).join(' OR ');
  const legs = await a.query(`SELECT ${S.sel.map((c) => a.q(c)).join(', ')} FROM ${a.q(S.cfg.cdrTable)} WHERE ${where} ORDER BY ${a.q(S.dateCol)} ASC LIMIT 200`, idCols.map(() => id));
  let cel = [];
  try {
    const cc = await columnsOf(a, S.cfg.celTable);
    if (cc.length) {
      const k = ['uniqueid', 'linkedid'].filter((c) => cc.includes(c));
      const ord = cc.includes('eventtime') ? 'eventtime' : cc.includes('id') ? 'id' : k[0];
      const ids = [...new Set(legs.flatMap((l) => [l.uniqueid, l.linkedid]).filter(Boolean).concat(id))].slice(0, 20);
      const params = [];
      const parts = k.map((c) => `${a.q(c)} IN (${ids.map((v) => { params.push(v); return a.ph(params.length); }).join(',')})`);
      cel = await a.query(`SELECT * FROM ${a.q(S.cfg.celTable)} WHERE ${parts.join(' OR ')} ORDER BY ${a.q(ord)} ASC LIMIT 600`, params);
    }
  } catch { cel = []; }
  return { legs: legs.map((r) => norm(r, S)), cel };
}

const bucket = (a, col, unit) => {
  const c = a.q(col);
  if (a.dialect === 'mysql') return unit === 'hour' ? `DATE_FORMAT(${c}, '%Y-%m-%d %H:00:00')` : `DATE_FORMAT(${c}, '%Y-%m-%d')`;
  if (a.dialect === 'postgres') return unit === 'hour' ? `to_char(${c}, 'YYYY-MM-DD HH24:00:00')` : `to_char(${c}, 'YYYY-MM-DD')`;
  return unit === 'hour' ? `strftime('%Y-%m-%d %H:00:00', ${c})` : `strftime('%Y-%m-%d', ${c})`;
};

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

async function stats() {
  const S = await schema();
  const { a } = S;
  const T = a.q(S.cfg.cdrTable), D = a.q(S.dateCol);
  const hasDisp = S.cols.includes('disposition'), hasBill = S.cols.includes('billsec');
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const h24 = new Date(now.getTime() - 24 * 3600e3);
  const d7 = new Date(startToday.getTime() - 6 * 86400e3);
  const disp = hasDisp ? `UPPER(${a.q('disposition')})` : "'UNKNOWN'";
  // sólo registros "raíz" no es fiable entre versiones: se cuentan todos los CDR
  const [today, hourly, daily, top, byDirRows] = await Promise.all([
    a.query(`SELECT ${disp} AS d, COUNT(*) AS n, ${hasBill ? `SUM(${a.q('billsec')})` : '0'} AS talk FROM ${T} WHERE ${D} >= ${a.ph(1)} GROUP BY ${disp}`, [fmt(startToday)]),
    a.query(`SELECT ${bucket(a, S.dateCol, 'hour')} AS b, ${disp} AS d, COUNT(*) AS n FROM ${T} WHERE ${D} >= ${a.ph(1)} GROUP BY b, d ORDER BY b`, [fmt(h24)]),
    a.query(`SELECT ${bucket(a, S.dateCol, 'day')} AS b, ${disp} AS d, COUNT(*) AS n FROM ${T} WHERE ${D} >= ${a.ph(1)} GROUP BY b, d ORDER BY b`, [fmt(d7)]),
    S.cols.includes('src') ? a.query(`SELECT ${a.q('src')} AS s, COUNT(*) AS n FROM ${T} WHERE ${D} >= ${a.ph(1)} AND ${a.q('src')} <> '' GROUP BY ${a.q('src')} ORDER BY n DESC LIMIT 8`, [fmt(d7)]) : [],
    a.query(`SELECT ${S.dirExpr} AS d, COUNT(*) AS n FROM ${T} WHERE ${D} >= ${a.ph(1)} GROUP BY ${S.dirExpr}`, [fmt(startToday)]),
  ]);
  const byDisp = {};
  let total = 0, talk = 0;
  for (const r of today) { byDisp[r.d || 'UNKNOWN'] = Number(r.n); total += Number(r.n); talk += Number(r.talk || 0); }
  const answered = byDisp.ANSWERED || 0;
  return {
    today: { total, answered, byDisp, byDir: Object.fromEntries(byDirRows.map((r) => [r.d, Number(r.n)])), talkSeconds: talk, asr: total ? answered / total : 0, acd: answered ? talk / answered : 0 },
    hourly: hourly.map((r) => ({ b: r.b, d: r.d, n: Number(r.n) })),
    daily: daily.map((r) => ({ b: r.b, d: r.d, n: Number(r.n) })),
    top: top.map((r) => ({ src: r.s, n: Number(r.n) })),
  };
}

async function failed({ limit = 100, offset = 0, from } = {}) {
  const S = await schema();
  if (!S.cols.includes('disposition')) return { rows: [], total: 0 };
  return list({ disposition: 'FAILED,BUSY,NO ANSWER,CONGESTION', from }, { limit, offset });
}

async function test(cfgInput) {
  const start = Date.now();
  const cfg = { ...settings.get('db'), ...cfgInput, enabled: true };
  let a;
  try {
    a = await makeAdapter(cfg);
    await a.query('SELECT 1 AS ok');
    const cols = await columnsOf(a, cfg.cdrTable);
    colCache.delete(cfg.cdrTable);
    if (!cols.length) return { ok: false, error: `Conexión correcta, pero la tabla "${cfg.cdrTable}" no existe` };
    const dateCol = [cfg.dateColumn, 'calldate', 'start'].find((c) => cols.includes(c));
    const n = await a.query(`SELECT COUNT(*) AS n FROM ${a.q(cfg.cdrTable)}`);
    let cel = false;
    try { cel = (await columnsOf(a, cfg.celTable)).length > 0; } catch { /* sin CEL */ }
    colCache.delete(cfg.celTable);
    return { ok: true, ms: Date.now() - start, rows: Number(Object.values(n[0])[0]), columns: cols, dateColumn: dateCol || null, cel };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    if (a) { try { await a.close(); } catch { /* ignora */ } }
  }
}

function toCsv(rows, columns) {
  const cols = ['date', ...columns.filter((c) => !['calldate', 'start'].includes(c) || false)];
  const e = (v) => { const s = v == null ? '' : String(v); return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => e(r[c])).join(','))].join('\r\n');
}

module.exports = { list, detail, stats, failed, test, toCsv, reset };
