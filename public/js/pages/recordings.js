import { h, icon, badge, empty, spinner, fmtDate, fmtSize, fmtInt, debounce, localInput, toSqlDate, setClipboard } from '../ui.js';
import { api, qs, state } from '../api.js';
import { playButton } from '../player.js';

const DIR = { in: ['Entrante', 'ok'], out: ['Saliente', 'accent'], queue: ['Cola', 'warn'], internal: ['Interna', 'muted'], group: ['Grupo', 'muted'] };

export default async function page(ctx) {
  const f = {};
  const pg = { limit: state.settings?.ui.rowsPerPage || 50, offset: 0, sort: 'date', dir: 'desc' };
  const body = h('div'), pager = h('div.pager'), summary = h('span.sub'), notes = h('div');
  const cfg = state.settings?.recordings;

  if (!cfg?.dirs.length) {
    return h('div.card', empty('No hay directorios de grabaciones configurados', 'Agregue las carpetas donde Asterisk guarda las grabaciones (MixMonitor, FreePBX, etc.).', 'folder'),
      h('div', { style: { textAlign: 'center', paddingBottom: '30px' } }, h('a.btn.primary', { href: '#/settings/recordings' }, icon('folder', 16), 'Configurar directorios')));
  }

  const inp = (key, label, attrs = {}, cls = '') => {
    const el = attrs.options ? h('select', {}, attrs.options.map(([v, t]) => h('option', { value: v }, t))) : h('input', { type: attrs.type || 'text', placeholder: attrs.ph || '' });
    el.addEventListener(attrs.options || attrs.type === 'datetime-local' ? 'change' : 'input', () => { f[key] = el.value; run(); });
    return h(`div.field${cls}`, h('label', label), el);
  };
  const run = debounce(() => { pg.offset = 0; load(); }, 350);
  const filters = h('div.filters',
    inp('q', 'Nombre o ruta', { ph: 'Buscar en nombre de archivo…' }, '.wide'),
    inp('number', 'Número', { ph: 'Ej. 573001234567' }), inp('uniqueid', 'Uniqueid', { ph: '1735726210.55' }),
    inp('from', 'Desde', { type: 'datetime-local' }), inp('to', 'Hasta', { type: 'datetime-local' }),
    inp('dir', 'Directorio', { options: [['', 'Todos'], ...cfg.dirs.map((d) => [d.id, d.label])] }),
    inp('ext', 'Formato', { options: [['', 'Todos'], ...cfg.extensions.map((e) => [e, e.toUpperCase()])] }),
    inp('direction', 'Tipo', { options: [['', 'Todos'], ['in', 'Entrante'], ['out', 'Saliente'], ['queue', 'Cola'], ['internal', 'Interna']] }),
    inp('minSize', 'Tamaño mín. (KB)', { type: 'number' }));

  const th = (label, key, cls = '') => h(`th.sort${cls}`, { onclick: () => { if (pg.sort === key) pg.dir = pg.dir === 'desc' ? 'asc' : 'desc'; else { pg.sort = key; pg.dir = 'desc'; } pg.offset = 0; load(); } }, label, pg.sort === key ? icon(pg.dir === 'desc' ? 'down' : 'up', 13) : null);

  let seq = 0;
  async function load(refresh) {
    const my = ++seq;
    body.replaceChildren(spinner());
    try {
      const q = {};
      for (const [k, v] of Object.entries(f)) if (v) q[k] = ['from', 'to'].includes(k) ? toSqlDate(v) : v;
      const r = await api(`/recordings?${qs({ ...q, limit: pg.limit, offset: pg.offset, sort: pg.sort, order: pg.dir, refresh: refresh ? 1 : '' })}`);
      if (my !== seq) return;
      summary.textContent = `${fmtInt(r.total)} grabaciones · ${fmtSize(r.bytes)}`;
      notes.replaceChildren(...r.errors.slice(0, 3).map((e) => h('div.banner.warn', { style: { margin: '12px 18px 0' } }, icon('alert'), e)));
      body.replaceChildren(r.rows.length ? h('div.table-wrap', { style: { maxHeight: '64vh' } }, h('table',
        h('thead', h('tr', h('th'), th('Fecha', 'date'), th('Archivo', 'name'), h('th', 'Tipo'), h('th', 'Números'), h('th', 'Directorio'), th('Tamaño', 'size', '.r'), h('th', 'Formato'), h('th'))),
        h('tbody', r.rows.map((x) => h('tr', h('td', { style: { width: '44px' } }, playButton(x)),
          h('td.nowrap.num', fmtDate(x.ts), x.tsParsed ? null : h('span.dim', { title: 'Fecha de modificación del archivo' }, ' ·m')),
          h('td', h('div', { style: { maxWidth: '420px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: x.rel }, x.name), x.uniqueid ? h('div.dim.mono', x.uniqueid) : null),
          h('td', x.direction ? badge(DIR[x.direction][0], DIR[x.direction][1]) : h('span.dim', '—')),
          h('td', x.numbers.map((n) => h('span.chip', n))),
          h('td.dim', x.dir), h('td.r.num', fmtSize(x.size)), h('td', badge(x.ext)),
          h('td.r.nowrap', x.uniqueid ? h('a.btn.sm.ghost', { href: '#/history', title: 'Ver llamada en histórico', onclick: () => sessionStorage.setItem('hist-uid', x.uniqueid) }, icon('history', 14)) : null,
            h('a.btn.sm.ghost', { href: `/api/recordings/${x.id}/download`, title: 'Descargar' }, icon('download', 14)))))))) : empty('No hay grabaciones que coincidan', r.totalIndexed ? 'Pruebe con otros filtros' : 'No se encontraron archivos en los directorios configurados'));
      const from = r.rows.length ? pg.offset + 1 : 0, to = pg.offset + r.rows.length;
      pager.replaceChildren(h('span', `${fmtInt(from)}–${fmtInt(to)} de ${fmtInt(r.total)}`), h('span.dim', `· índice actualizado ${fmtDate(r.scannedAt)}`), h('div.grow'),
        h('select', { style: { width: '100px' }, onchange: (e) => { pg.limit = Number(e.target.value); pg.offset = 0; load(); } }, [25, 50, 100, 200].map((n) => h('option', { value: n, selected: n === pg.limit }, `${n} / pág.`))),
        h('button.btn.sm', { disabled: pg.offset === 0, onclick: () => { pg.offset = Math.max(0, pg.offset - pg.limit); load(); } }, 'Anterior'),
        h('button.btn.sm', { disabled: to >= r.total, onclick: () => { pg.offset += pg.limit; load(); } }, 'Siguiente'));
    } catch (e) { body.replaceChildren(h('div.banner.bad', { style: { margin: '16px' } }, icon('alert'), e.message)); }
  }

  await load();
  return h('div.card', filters,
    h('div.toolbar', h('span.dim', cfg.dirs.map((d) => d.label).join(' · ')), h('div.grow'), summary,
      h('button.btn.sm', { onclick: () => load(true) }, icon('refresh', 14), 'Reescanear')), notes, body, pager);
}
