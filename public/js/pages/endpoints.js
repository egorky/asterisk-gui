import { h, icon, badge, empty, debounce, fmtDate } from '../ui.js';
import { api } from '../api.js';

export default async function page(ctx) {
  const d = await api('/endpoints');
  let filter = '', only = '';
  const list = h('div'), kpis = h('div.kpis');
  const draw = () => {
    const rows = d.list.filter((e) => (!filter || `${e.name} ${e.contacts} ${e.state}`.toLowerCase().includes(filter)) && (only === '' || (only === 'on') === e.online));
    const on = d.list.filter((e) => e.online).length;
    kpis.replaceChildren(
      h('div.kpi', h('div.k-l', icon('users', 15), 'Total'), h('div.k-v', d.list.length), h('div.k-s', d.tech ? `Tecnología ${d.tech}` : 'Sin datos')),
      h('div.kpi.ok', h('div.k-l', icon('check', 15), 'En línea'), h('div.k-v', on), h('div.k-s', 'registradas / disponibles')),
      h('div.kpi', h('div.k-l', icon('x', 15), 'Fuera de línea'), h('div.k-v', d.list.length - on), h('div.k-s', 'no disponibles')),
      h('div.kpi', h('div.k-l', icon('link', 15), 'Registros salientes'), h('div.k-v', d.registrations.length), h('div.k-s', `${d.registrations.filter((r) => /^registered$/i.test(r.status)).length} registrados`)));
    list.replaceChildren(rows.length ? h('div.table-wrap', h('table', h('thead', h('tr', ['Nombre', 'Estado', 'Detalle', 'Contactos / IP', 'Transporte', 'Canales'].map((x) => h('th', x)))),
      h('tbody', rows.map((e) => h('tr', h('td', h('b', e.name)), h('td', badge(e.state || '—', e.online ? 'ok' : 'bad')), h('td.dim', e.tech), h('td.mono', (e.contacts || '').split(',').join(', ') || '—'), h('td', e.transport || '—'), h('td.num', e.activeChannels || 0)))))) : empty('Sin resultados', d.list.length ? null : 'No se obtuvieron extensiones. Verifique la conexión AMI y los permisos del usuario.'));
  };
  const regTable = d.registrations.length ? h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', 'Registros salientes (troncales)')),
    h('div.table-wrap', h('table', h('thead', h('tr', ['Nombre', 'Servidor', 'Cliente', 'Estado'].map((x) => h('th', x)))),
      h('tbody', d.registrations.map((r) => h('tr', h('td', h('b', r.name)), h('td.mono', r.server), h('td.mono', r.client), h('td', badge(r.status, /^registered$/i.test(r.status) ? 'ok' : 'bad')))))))) : null;
  const queues = d.queues?.length ? h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', 'Colas')),
    h('div.table-wrap', h('table', h('thead', h('tr', ['Cola', 'Agentes conectados', 'Disponibles', 'En espera', 'Espera prom.', 'Conversación prom.'].map((x) => h('th', x)))),
      h('tbody', d.queues.map((q) => h('tr', h('td', h('b', q.name)), h('td.num', q.loggedIn), h('td.num', q.available), h('td.num', q.callers ? badge(q.callers, 'warn') : 0), h('td.num', `${q.holdTime}s`), h('td.num', `${q.talkTime}s`))))))) : null;
  draw();
  const search = h('input', { type: 'search', placeholder: 'Filtrar por nombre, IP o estado…', style: { maxWidth: '320px' }, oninput: debounce((e) => { filter = e.target.value.toLowerCase(); draw(); }, 150) });
  const seg = h('div.seg', [['', 'Todas'], ['on', 'En línea'], ['off', 'Fuera de línea']].map(([v, t]) => h('button', { class: v === '' ? 'on' : '', onclick: (e) => { only = v; seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); draw(); } }, t)));
  ctx.every(async () => { try { Object.assign(d, await api('/endpoints')); draw(); } catch { /* ignore */ } }, 20000);
  ctx.setSub(d.at ? `Actualizado ${fmtDate(d.at)}` : '');
  return h('div', kpis, h('div.card', h('div.toolbar', search, seg), list), regTable, queues);
}
