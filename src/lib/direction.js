// Clasifica llamadas en entrante / saliente / interna según reglas configurables en la GUI.
// Orden: campo userfield -> canal troncal -> contexto de entrada -> ambos internos -> contexto de salida -> origen interno -> destino interno.
const settings = require('./settings');

const escLike = (s) => String(s).replace(/[!%_]/g, (m) => `!${m}`).replace(/'/g, "''");
const globToLike = (p, prefix) => escLike(p).replace(/\*/g, '%') + (prefix && !p.includes('*') ? '%' : '');
const globToRe = (p, prefix) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\\/]/g, '\\$&').replace(/\*/g, '.*')}${prefix && !p.includes('*') ? '.*' : ''}$`, 'i');

function rules() {
  const c = settings.get('calls');
  return {
    max: c.internalMaxDigits,
    ufIn: c.userfieldIn, ufOut: c.userfieldOut,
    inCtx: c.inboundContexts, outCtx: c.outboundContexts, trunks: c.trunkChannels,
  };
}

function classify({ src = '', dst = '', channel = '', dstchannel = '', context = '', userfield = '' }) {
  const r = rules();
  const uf = String(userfield || '').trim().toLowerCase();
  if (uf && r.ufIn.includes(uf)) return 'in';
  if (uf && r.ufOut.includes(uf)) return 'out';
  const isInt = (n) => !!n && String(n).length <= r.max;
  const m = (list, v, prefix) => list.some((p) => globToRe(p, prefix).test(v || ''));
  if (m(r.trunks, channel, true)) return 'in';
  if (m(r.trunks, dstchannel, true)) return 'out';
  if (m(r.inCtx, context)) return 'in';
  const si = isInt(src), di = isInt(dst);
  if (si && di) return 'internal';
  if (m(r.outCtx, context)) return 'out';
  if (si) return 'out';
  if (di) return 'in';
  return 'other';
}

/** Expresión SQL CASE equivalente a classify(); `a` es el adaptador de BD y `cols` las columnas existentes. */
function sqlCase(a, cols) {
  const r = rules();
  const col = (c) => (cols.includes(c) ? `COALESCE(${a.q(c)}, '')` : "''");
  const op = a.dialect === 'postgres' ? 'ILIKE' : 'LIKE';
  const anyLike = (expr, list, prefix) => list.map((p) => `${expr} ${op} '${globToLike(p, prefix)}' ESCAPE '!'`).join(' OR ');
  const isInt = (c) => `(LENGTH(${col(c)}) > 0 AND LENGTH(${col(c)}) <= ${r.max})`;
  const w = [];
  if (cols.includes('userfield')) {
    const uf = `LOWER(TRIM(${col('userfield')}))`;
    const lit = (l) => l.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(', ');
    if (r.ufIn.length) w.push(`WHEN ${uf} IN (${lit(r.ufIn)}) THEN 'in'`);
    if (r.ufOut.length) w.push(`WHEN ${uf} IN (${lit(r.ufOut)}) THEN 'out'`);
  }
  if (r.trunks.length) {
    w.push(`WHEN (${anyLike(col('channel'), r.trunks, true)}) THEN 'in'`);
    w.push(`WHEN (${anyLike(col('dstchannel'), r.trunks, true)}) THEN 'out'`);
  }
  if (r.inCtx.length) w.push(`WHEN (${anyLike(col('dcontext'), r.inCtx)}) THEN 'in'`);
  w.push(`WHEN ${isInt('src')} AND ${isInt('dst')} THEN 'internal'`);
  if (r.outCtx.length) w.push(`WHEN (${anyLike(col('dcontext'), r.outCtx)}) THEN 'out'`);
  w.push(`WHEN ${isInt('src')} THEN 'out'`, `WHEN ${isInt('dst')} THEN 'in'`);
  return `CASE ${w.join(' ')} ELSE 'other' END`;
}

module.exports = { classify, sqlCase };
