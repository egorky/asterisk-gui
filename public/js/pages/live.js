import { h, icon, fmtDur, badge, empty, fmtDate, timeAgo } from '../ui.js';
import { state } from '../api.js';

const STATE_TONE = { Up: 'ok', Ringing: 'warn', Ring: 'warn', Down: 'muted' };

export default async function page(ctx) {
  const open = new Set();
  const kpis = h('div.kpis');
  const body = h('div');
  const feed = h('div.feed');
  const render = () => {
    const { calls, channels, at } = state.live;
    const off = Date.now() - (at || Date.now());
    const bridged = calls.filter((c) => c.bridged).length;
    kpis.replaceChildren(
      h('div.kpi.accent', h('div.k-l', icon('phone', 15), 'Llamadas activas'), h('div.k-v', calls.length), h('div.k-s', `${bridged} conectadas`)),
      h('div.kpi', h('div.k-l', icon('activity', 15), 'Sonando / marcando'), h('div.k-v', calls.length - bridged), h('div.k-s', 'sin contestar aún')),
      h('div.kpi', h('div.k-l', icon('server', 15), 'Canales'), h('div.k-v', channels.length), h('div.k-s', 'legs activos')),
      h('div.kpi', h('div.k-l', icon('history', 15), 'Duración máxima'), h('div.k-v', calls.length ? fmtDur(calls[0].duration + off / 1000) : '—'), h('div.k-s', calls[0] ? `${calls[0].from} → ${calls[0].to}` : ' ')));
    if (state.status.state !== 'connected') {
      body.replaceChildren(h('div.banner.warn', icon('alert'), h('div.grow', h('b', 'AMI no conectado'), h('div.muted', state.status.error || 'No hay conexión con Asterisk, por lo que no se pueden mostrar llamadas en vivo.')), h('a.btn.sm', { href: '#/settings/asterisk' }, 'Configurar')));
      return;
    }
    if (!calls.length) { body.replaceChildren(h('div.card', empty('No hay llamadas activas', 'Las llamadas aparecerán aquí en tiempo real', 'phone'))); return; }
    const rows = [];
    for (const c of calls) {
      const isOpen = open.has(c.linkedid);
      rows.push(h('tr.click', { onclick: () => { isOpen ? open.delete(c.linkedid) : open.add(c.linkedid); render(); } },
        h('td', { style: { width: '28px' } }, icon(isOpen ? 'down' : 'right', 15)),
        h('td', h('b', c.from || '—'), c.fromName ? h('div.dim', c.fromName) : null),
        h('td', h('b', c.to || '—'), c.toName ? h('div.dim', c.toName) : null),
        h('td', badge(c.state === 'Up' ? 'Conectada' : c.state === 'Ringing' ? 'Sonando' : c.state, STATE_TONE[c.state] || 'accent')),
        h('td.num', fmtDur(c.duration + off / 1000)),
        h('td', c.legs.map((l) => h('span.chip.mono', l.channel.replace(/-[0-9a-f]{6,}$/i, '')))),
        h('td.dim', c.legs.find((l) => l.app)?.app || '—')));
      if (isOpen) rows.push(h('tr', h('td', { colspan: 7, style: { background: 'var(--surface-2)' } },
        h('table', h('thead', h('tr', ['Canal', 'Estado', 'Caller ID', 'Conectado a', 'Contexto / Ext.', 'Aplicación', 'Uniqueid'].map((x) => h('th', x)))),
          h('tbody', c.legs.map((l) => h('tr', h('td.mono', l.channel), h('td', l.state), h('td', `${l.callerNum || ''} ${l.callerName ? `(${l.callerName})` : ''}`), h('td', l.connNum || '—'), h('td.mono', `${l.context}/${l.exten}`), h('td', `${l.app || ''} ${l.appData || ''}`), h('td.mono', l.uniqueid))))))));
    }
    body.replaceChildren(h('div.card', h('div.table-wrap', h('table',
      h('thead', h('tr', h('th'), h('th', 'Origen'), h('th', 'Destino'), h('th', 'Estado'), h('th', 'Duración'), h('th', 'Canales'), h('th', 'App'))), h('tbody', rows)))));
  };
  const drawFeed = () => {
    const evs = state.events.filter((e) => e.severity !== 'info').slice(0, 12);
    feed.replaceChildren(...(evs.length ? evs.map((e) => h(`div.ev.${e.severity}`, h('div.bar'), h('div', h('div.t', e.title), h('div.m', e.detail?.callerNum ? `${e.detail.callerNum} → ${e.detail.connNum || e.detail.exten || '—'}` : e.detail?.channel || e.detail?.remote || '')), h('span.when', timeAgo(e.ts)))) : [empty('Sin errores recientes', null, 'check')]));
  };
  ctx.on('live', render);
  ctx.on('status', render);
  ctx.on('event', drawFeed);
  ctx.every(render, 1000); // el contador de duración avanza cada segundo
  render(); drawFeed();
  ctx.setSub('Se actualiza en tiempo real');
  return h('div', kpis, h('div.grid.g-main', body, h('div.card', h('div.card-h', h('h3', 'Errores en vivo'), h('div.grow'), h('a.btn.sm.ghost', { href: '#/errors' }, 'Ver todos', icon('right', 14))), feed)));
}
