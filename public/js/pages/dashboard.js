import { h, icon, fmtInt, fmtDur, fmtUptime, badge, timeAgo, empty, dispBadge } from '../ui.js';
import { api, state } from '../api.js';
import { stackedBars, donut, hbars } from '../charts.js';

const COLORS = { ANSWERED: 'var(--ok)', 'NO ANSWER': 'var(--warn)', BUSY: '#7e8bd1', FAILED: 'var(--bad)', CONGESTION: '#b5568f', UNKNOWN: 'var(--text-3)' };
const LABELS = { ANSWERED: 'Contestadas', 'NO ANSWER': 'Sin respuesta', BUSY: 'Ocupado', FAILED: 'Fallidas', CONGESTION: 'Congestión', UNKNOWN: 'Otras' };
const SERIES = Object.keys(COLORS).map((k) => ({ key: k, label: LABELS[k], color: COLORS[k] }));

function kpi(label, value, sub, cls = '', ic) {
  return h(`div.kpi.${cls}`, h('div.k-l', ic ? icon(ic, 15) : null, label), h('div.k-v', value), h('div.k-s', sub || ' '));
}

function hourly(rows) {
  const now = new Date();
  const slots = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600e3);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00:00`;
    slots.push({ key, label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`, short: `${String(d.getHours()).padStart(2, '0')}h`, values: {} });
  }
  const idx = new Map(slots.map((s) => [s.key, s]));
  for (const r of rows) { const s = idx.get(r.b); if (s) s.values[r.d] = (s.values[r.d] || 0) + r.n; }
  return slots;
}
function daily(rows) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400e3);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ key, label: key, short: d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' }), values: {} });
  }
  const idx = new Map(out.map((s) => [s.key, s]));
  for (const r of rows) { const s = idx.get(String(r.b).slice(0, 10)); if (s) s.values[r.d] = (s.values[r.d] || 0) + r.n; }
  return out;
}

export default async function page(ctx) {
  const root = h('div');
  let d;
  const cfgBtn = (txt, to) => h('a.btn.sm', { href: to }, txt);

  async function load() {
    d = await api('/dashboard');
    draw();
  }

  function draw() {
    const s = state.settings;
    const live = state.live;
    const parts = [];
    if (d.ami.state !== 'connected') {
      parts.push(h('div.banner.warn', icon('alert'), h('div.grow', h('b', d.ami.state === 'disabled' ? 'Conexión AMI no configurada' : 'Sin conexión con Asterisk'),
        h('div.muted', d.ami.state === 'disabled' ? 'Configure la dirección, el puerto y las credenciales del Manager Interface para ver llamadas en vivo.' : (d.ami.error || 'Reintentando…'))), cfgBtn('Configurar', '#/settings/asterisk')));
    }
    if (!s?.db.enabled) parts.push(h('div.banner', icon('database'), h('div.grow', h('b', 'Histórico sin configurar'), h('div.muted', 'Indique la base de datos donde Asterisk guarda los CDR para habilitar histórico y estadísticas.')), cfgBtn('Configurar', '#/settings/db')));
    else if (d.cdrError) parts.push(h('div.banner.bad', icon('alert'), h('div.grow', h('b', 'No se pudo leer el histórico'), h('div.muted', d.cdrError)), cfgBtn('Revisar', '#/settings/db')));

    const t = d.cdr?.today;
    const callsNow = live.calls.length;
    const kpis = h('div.kpis',
      kpi('Llamadas en curso', fmtInt(callsNow), `${fmtInt(live.channels.length)} canales activos`, callsNow ? 'accent' : '', 'phone'),
      kpi('Llamadas hoy', t ? fmtInt(t.total) : '—', t ? `${fmtInt(t.answered)} contestadas` : 'Sin histórico', '', 'history'),
      kpi('Tasa de respuesta', t && t.total ? `${Math.round(t.asr * 100)}%` : '—', 'ASR de hoy', t && t.total ? (t.asr > .6 ? 'ok' : t.asr < .4 ? 'bad' : '') : '', 'activity'),
      kpi('Duración media', t && t.answered ? fmtDur(t.acd) : '—', t ? `${fmtDur(t.talkSeconds)} hablados` : '', '', 'mic'),
      kpi('Extensiones en línea', d.endpoints.total ? `${d.endpoints.online}/${d.endpoints.total}` : '—', d.endpoints.tech ? `Tecnología ${d.endpoints.tech}` : 'Sin datos', '', 'users'),
      kpi('Alertas 24 h', fmtInt((d.events24h.error || 0) + (d.events24h.warning || 0)), `${d.events24h.error || 0} errores · ${d.events24h.warning || 0} avisos`, (d.events24h.error || 0) ? 'bad' : '', 'alert'));
    parts.push(kpis);

    // Gráficos
    const legend = h('div.legend', SERIES.map((k) => h('span', h('i', { style: { background: k.color } }), k.label)));
    const chartCard = h('div.card', h('div.card-h', h('h3', 'Llamadas — últimas 24 horas'), h('div.grow'), legend),
      h('div.card-b', d.cdr ? stackedBars(hourly(d.cdr.hourly), SERIES) : empty('Sin datos de histórico', 'Configure la base de datos CDR', 'database')));
    const disp = d.cdr ? Object.entries(t.byDisp).map(([k, v]) => ({ label: LABELS[k] || k, value: v, color: COLORS[k] || 'var(--text-3)' })) : [];
    const donutCard = h('div.card', h('div.card-h', h('h3', 'Resultado de hoy')),
      h('div.card-b', disp.length ? h('div.donut-wrap', donut(disp, { center: [fmtInt(t.total), 'llamadas'] }), h('ul', disp.map((i) => h('li', h('i', { style: { background: i.color } }), i.label, h('b.num', i.value))))) : empty('Sin llamadas hoy', null, 'phone')));
    parts.push(h('div.grid.g-main', { style: { marginBottom: '16px' } }, chartCard, donutCard));

    // En curso + eventos
    const liveRows = live.calls.slice(0, 6).map((c) => h('tr', h('td', h('b', c.from || '—'), c.fromName ? h('span.dim', ` ${c.fromName}`) : null), h('td', c.to || '—'), h('td', badge(c.state, c.bridged ? 'ok' : 'warn')), h('td.r.num', fmtDur(c.duration))));
    const liveCard = h('div.card', h('div.card-h', h('h3', 'En curso'), h('div.grow'), h('a.btn.sm.ghost', { href: '#/live' }, 'Ver todas', icon('right', 14))),
      liveRows.length ? h('div.table-wrap', h('table', h('thead', h('tr', h('th', 'Origen'), h('th', 'Destino'), h('th', 'Estado'), h('th.r', 'Duración'))), h('tbody', liveRows))) : empty('No hay llamadas activas', d.ami.state === 'connected' ? null : 'AMI desconectado', 'phone'));
    const evCard = h('div.card', h('div.card-h', h('h3', 'Últimos eventos'), h('div.grow'), h('a.btn.sm.ghost', { href: '#/errors' }, 'Ver todos', icon('right', 14))),
      d.recentEvents.length ? h('div.feed', d.recentEvents.map((e) => h(`div.ev.${e.severity}`, h('div.bar'), h('div', h('div.t', e.title), h('div.m', e.detail?.callerNum ? `${e.detail.callerNum} → ${e.detail.connNum || e.detail.exten || ''}` : e.detail?.channel || e.detail?.remote || '')), h('span.when', timeAgo(e.ts))))) : empty('Sin eventos recientes', null, 'check'));
    parts.push(h('div.grid.g2', { style: { marginBottom: '16px' } }, liveCard, evCard));

    // Servidor / troncales / top
    const c = d.core, cs = c.settings || {};
    const info = h('div.card', h('div.card-h', h('h3', 'Servidor Asterisk')), h('div.card-b', c.version || c.versionLine ? h('dl.kv',
      h('dt', 'Versión'), h('dd', c.version || c.versionLine), h('dt', 'Tiempo activo'), h('dd', fmtUptime(c.uptime)), h('dt', 'Última recarga'), h('dd', c.lastReloadSecs != null ? `hace ${fmtUptime(c.lastReloadSecs)}` : c.reload || '—'),
      h('dt', 'Sistema'), h('dd', cs.system || '—'), h('dt', 'Llamadas actuales'), h('dd', c.currentCalls ?? '—'), h('dt', 'CDR habilitado'), h('dd', cs.cdr || '—'), h('dt', 'Destino AMI'), h('dd.mono', `${d.ami.host}:${d.ami.port}`)) : empty('Sin datos del servidor', 'Esperando conexión AMI', 'server')));
    const regs = d.registrations;
    const trunks = h('div.card', h('div.card-h', h('h3', 'Troncales y registros'), h('div.grow'), h('a.btn.sm.ghost', { href: '#/endpoints' }, 'Detalle', icon('right', 14))),
      regs.length ? h('div.table-wrap', h('table', h('tbody', regs.map((r) => h('tr', h('td', h('b', r.name)), h('td.dim', r.server), h('td.r', badge(r.status, /regist/i.test(r.status) && !/unreg/i.test(r.status) ? 'ok' : 'bad'))))))) : empty('Sin registros salientes', null, 'link'));
    const top = h('div.card', h('div.card-h', h('h3', 'Más activos (7 días)')), h('div.card-b', d.cdr?.top.length ? hbars(d.cdr.top.map((x) => ({ label: x.src, value: x.n }))) : empty('Sin datos', null, 'users')));
    parts.push(h('div.grid.g3', info, trunks, top));

    if (d.cdr) {
      const weekly = h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', 'Llamadas por día — últimos 7 días')), h('div.card-b', stackedBars(daily(d.cdr.daily), SERIES, { height: 200 })));
      parts.push(weekly);
    }
    root.replaceChildren(...parts);
  }

  await load();
  ctx.every(() => load().catch(() => {}), (state.settings?.ui.refreshSeconds || 5) * 6000);
  ctx.on('live', () => { if (root.isConnected) draw(); });
  ctx.on('status', () => { d.ami = state.status; if (root.isConnected) draw(); });
  ctx.on('core', () => { d.core = state.core; });
  return root;
}
