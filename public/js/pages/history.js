import { h, icon, badge, empty, spinner, fmtDate, fmtDur, fmtInt, fmtSize, debounce, dispBadge, drawer, localInput, toSqlDate, toast, setClipboard } from '../ui.js';
import { api, qs, state } from '../api.js';
import { playButton } from '../player.js';

const KEY = 'hist-filters';
const FIELDS = ['from', 'to', 'number', 'src', 'dst', 'uniqueid', 'disposition', 'minDur', 'maxDur', 'channel', 'q'];

function loadFilters() {
  let f = {};
  try { f = JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { /* ignore */ }
  const uid = sessionStorage.getItem('hist-uid');
  if (uid) { f = { uniqueid: uid }; sessionStorage.removeItem('hist-uid'); }
  if (!Object.keys(f).length) { const d = new Date(); d.setHours(0, 0, 0, 0); f.from = localInput(d); }
  return f;
}

export default async function page(ctx) {
  const f = loadFilters();
  const pg = { limit: state.settings?.ui.rowsPerPage || 50, offset: 0, sort: 'date', dir: 'desc' };
  const inputs = {};
  const tbl = h('div');
  const pager = h('div.pager');
  const summary = h('span.sub');

  const field = (key, label, attrs = {}, cls = '') => {
    const el = attrs.options
      ? h('select', {}, attrs.options.map(([v, t]) => h('option', { value: v }, t)))
      : h('input', { type: attrs.type || 'text', placeholder: attrs.ph || '' });
    el.value = f[key] || '';
    el.addEventListener(attrs.options || attrs.type === 'datetime-local' ? 'change' : 'input', () => { f[key] = el.value; if (key !== 'from' && key !== 'to') run(); else run(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { pg.offset = 0; load(); } });
    inputs[key] = el;
    return h(`div.field${cls}`, h('label', label), el);
  };
  const run = debounce(() => { pg.offset = 0; sessionStorage.setItem(KEY, JSON.stringify(f)); load(); }, 400);

  const preset = (label, fn) => h('button.btn.sm', { onclick: () => { fn(); inputs.from.value = f.from || ''; inputs.to.value = f.to || ''; pg.offset = 0; sessionStorage.setItem(KEY, JSON.stringify(f)); load(); } }, label);
  const dayStart = (off = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - off); return d; };

  const filters = h('div.filters',
    field('from', 'Desde', { type: 'datetime-local' }), field('to', 'Hasta', { type: 'datetime-local' }),
    field('number', 'Número (origen/destino)', { ph: 'Ej. 573001234567' }), field('src', 'Origen', { ph: 'Extensión o número' }), field('dst', 'Destino', { ph: 'Extensión o número' }),
    field('uniqueid', 'Uniqueid / Linkedid', { ph: '1735726210.55' }),
    field('disposition', 'Estado', { options: [['', 'Todos'], ['ANSWERED', 'Contestada'], ['NO ANSWER', 'Sin respuesta'], ['BUSY', 'Ocupado'], ['FAILED', 'Fallida'], ['FAILED,BUSY,NO ANSWER,CONGESTION', 'No completadas']] }),
    field('channel', 'Canal / troncal', { ph: 'PJSIP/trunk…' }),
    field('minDur', 'Facturable mín. (s)', { type: 'number', ph: '0' }), field('maxDur', 'Facturable máx. (s)', { type: 'number' }),
    field('q', 'Búsqueda libre', { ph: 'Caller ID, app, datos…' }, '.wide'));

  const toolbar = h('div.toolbar',
    h('span.lbl', 'Rango:'),
    preset('Hoy', () => { f.from = localInput(dayStart()); f.to = ''; }),
    preset('Ayer', () => { f.from = localInput(dayStart(1)); f.to = localInput(dayStart()); }),
    preset('7 días', () => { f.from = localInput(dayStart(6)); f.to = ''; }),
    preset('30 días', () => { f.from = localInput(dayStart(29)); f.to = ''; }),
    preset('Todo', () => { f.from = ''; f.to = ''; }),
    h('div.grow'), summary,
    h('button.btn.sm', { onclick: () => { for (const k of FIELDS) { f[k] = ''; inputs[k].value = ''; } sessionStorage.setItem(KEY, '{}'); pg.offset = 0; load(); } }, icon('x', 14), 'Limpiar'),
    h('a.btn.sm', { id: 'csv', href: '#', onclick: (e) => { e.currentTarget.href = `/api/cdr/export.csv?${query(true)}`; } }, icon('download', 14), 'Exportar CSV'),
    h('button.btn.sm.primary', { onclick: () => { pg.offset = 0; load(); } }, icon('search', 14), 'Buscar'));

  function query(noPage) {
    const q = {};
    for (const k of FIELDS) if (f[k]) q[k] = ['from', 'to'].includes(k) ? toSqlDate(f[k]) : f[k];
    return qs({ ...q, sort: pg.sort, order: pg.dir, ...(noPage ? {} : { limit: pg.limit, offset: pg.offset }) });
  }

  const th = (label, key, cls = '') => h(`th.sort${cls}`, { onclick: () => { if (pg.sort === key) pg.dir = pg.dir === 'desc' ? 'asc' : 'desc'; else { pg.sort = key; pg.dir = 'desc'; } pg.offset = 0; load(); } },
    label, pg.sort === key ? icon(pg.dir === 'desc' ? 'down' : 'up', 13) : null);

  let seq = 0;
  async function load() {
    const my = ++seq;
    tbl.replaceChildren(spinner());
    try {
      const r = await api(`/cdr?${query()}`);
      if (my !== seq) return;
      summary.textContent = r.total != null ? `${fmtInt(r.total)} llamadas` : '';
      if (!r.rows.length) tbl.replaceChildren(empty('No se encontraron llamadas', 'Pruebe ampliando el rango de fechas o quitando filtros')); else
        tbl.replaceChildren(h('div.table-wrap', { style: { maxHeight: '64vh' } }, h('table',
          h('thead', h('tr', h('th'), th('Fecha', 'date'), th('Origen', 'src'), th('Destino', 'dst'), h('th', 'Canal'), h('th', 'Estado'), th('Duración', 'duration', '.r'), th('Facturable', 'billsec', '.r'), h('th', 'Uniqueid'))),
          h('tbody', r.rows.map((c) => h('tr.click', { onclick: () => showDetail(c) },
            h('td', { style: { width: '44px' } }, c.recordings?.length ? playButton({ ...c.recordings[0], dir: c.recordings[0].dir }) : null),
            h('td.nowrap.num', fmtDate(c.date)),
            h('td', h('b', c.src || '—'), c.clid && c.clid.replace(/<.*>/, '').replace(/"/g, '').trim() ? h('div.dim', c.clid.replace(/<.*>/, '').replace(/"/g, '').trim()) : null),
            h('td', c.dst || '—', c.dcontext ? h('div.dim', c.dcontext) : null),
            h('td.mono.dim', (c.channel || '').replace(/-[0-9a-f]{6,}$/i, '')),
            h('td', dispBadge(c.disposition)), h('td.r.num', fmtDur(c.duration)), h('td.r.num', fmtDur(c.billsec)),
            h('td.mono.dim', c.uniqueid)))))));
      const from = r.rows.length ? pg.offset + 1 : 0, to = pg.offset + r.rows.length;
      const pages = r.total != null ? Math.ceil(r.total / pg.limit) : null;
      pager.replaceChildren(
        h('span', r.total != null ? `${fmtInt(from)}–${fmtInt(to)} de ${fmtInt(r.total)}` : `${from}–${to}`), h('div.grow'),
        h('select', { style: { width: '100px' }, onchange: (e) => { pg.limit = Number(e.target.value); pg.offset = 0; load(); } }, [25, 50, 100, 200].map((n) => h('option', { value: n, selected: n === pg.limit }, `${n} / pág.`))),
        h('button.btn.sm', { disabled: pg.offset === 0, onclick: () => { pg.offset = Math.max(0, pg.offset - pg.limit); load(); } }, 'Anterior'),
        pages ? h('span.dim', `Pág. ${Math.floor(pg.offset / pg.limit) + 1} / ${pages}`) : null,
        h('button.btn.sm', { disabled: r.total != null ? to >= r.total : r.rows.length < pg.limit, onclick: () => { pg.offset += pg.limit; load(); } }, 'Siguiente'));
    } catch (e) {
      if (my !== seq) return;
      summary.textContent = '';
      pager.replaceChildren();
      tbl.replaceChildren(h('div.banner.bad', { style: { margin: '16px' } }, icon('alert'), h('div.grow', h('b', 'No se pudo consultar el histórico'), h('div.muted', e.message)), h('a.btn.sm', { href: '#/settings/db' }, 'Configurar BD')));
    }
  }

  async function showDetail(c) {
    const body = h('div', spinner());
    drawer(`Llamada ${c.uniqueid || ''}`, body);
    try {
      const d = await api(`/cdr/${encodeURIComponent(c.uniqueid || c.linkedid)}`);
      const l = d.legs.find((x) => x.uniqueid === c.uniqueid) || c;
      const kv = (pairs) => h('dl.kv', pairs.filter(([, v]) => v !== '' && v != null).flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
      const parts = [
        h('div', h('div.section-t', 'Resumen'), kv([
          ['Fecha', fmtDate(l.date)], ['Estado', dispBadge(l.disposition)], ['Origen', l.src], ['Destino', l.dst], ['Caller ID', l.clid], ['Contexto', l.dcontext],
          ['Canal', h('span.mono', l.channel)], ['Canal destino', l.dstchannel && h('span.mono', l.dstchannel)], ['Aplicación', `${l.lastapp || ''} ${l.lastdata || ''}`.trim()],
          ['Duración total', fmtDur(l.duration)], ['Tiempo hablado', fmtDur(l.billsec)], ['Cuenta', l.accountcode], ['Userfield', l.userfield],
          ['Uniqueid', h('span.mono', l.uniqueid, ' ', h('button.btn.sm.ghost', { onclick: () => setClipboard(l.uniqueid) }, 'copiar'))], ['Linkedid', l.linkedid && l.linkedid !== l.uniqueid && h('span.mono', l.linkedid)]])),
      ];
      parts.push(h('div', h('div.section-t', `Grabaciones (${d.recordings.length})`), d.recordings.length ? h('div', { style: { display: 'grid', gap: '8px' } }, d.recordings.map((r) =>
        h('div.inline-player', playButton(r, false), h('div', { style: { flex: 1, minWidth: 0 } }, h('b', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.name), h('span.dim', `${fmtSize(r.size)} · ${r.dir}`)),
          h('a.btn.sm', { href: `/api/recordings/${r.id}/download` }, icon('download', 14), 'Descargar')))) : h('div.muted', 'No se encontró una grabación asociada a esta llamada en los directorios configurados.')));
      if (d.legs.length > 1) parts.push(h('div', h('div.section-t', `Tramos de la llamada (${d.legs.length})`), h('div.table-wrap', h('table', h('thead', h('tr', ['Fecha', 'Origen', 'Destino', 'Canal', 'Estado', 'Hablado'].map((x) => h('th', x)))),
        h('tbody', d.legs.map((x) => h('tr', h('td.nowrap', fmtDate(x.date)), h('td', x.src), h('td', x.dst), h('td.mono', x.channel), h('td', dispBadge(x.disposition)), h('td.num', fmtDur(x.billsec)))))))));
      if (d.cel.length) parts.push(h('div', h('div.section-t', 'Eventos de la llamada (CEL)'), h('div.timeline', d.cel.map((e) => h('div.tl', h('b', e.eventtype), ' ', h('span.dim.num', String(e.eventtime || '').slice(11, 19)), h('div.dim.mono', [e.channame, e.appname && `${e.appname}(${e.appdata || ''})`, e.exten && `ext ${e.exten}`].filter(Boolean).join(' · ')))))));
      body.replaceChildren(...parts);
    } catch (e) { body.replaceChildren(h('div.banner.bad', e.message)); }
  }

  await load();
  return h('div', h('div.card', filters, toolbar, tbl, pager));
}
