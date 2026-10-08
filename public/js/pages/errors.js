import { h, icon, badge, empty, spinner, fmtDate, timeAgo, debounce, dispBadge, fmtDur, localInput, toSqlDate } from '../ui.js';
import { api, qs } from '../api.js';

const KINDS = { hangup: 'Colgado anómalo', dial: 'Marcación', security: 'Seguridad', peer: 'Extensión/Peer', registry: 'Registro troncal', system: 'Sistema' };
const SEV = { error: ['Error', 'bad'], warning: ['Aviso', 'warn'], info: ['Info', 'muted'] };

export default async function page(ctx) {
  let tab = 'events';
  const f = { severity: '', kind: '', search: '' };
  const body = h('div');
  const tabs = h('div.tabs');
  const setTab = (t) => { tab = t; drawTabs(); load(); };
  const drawTabs = () => tabs.replaceChildren(
    h(`button${tab === 'events' ? '.on' : ''}`, { onclick: () => setTab('events') }, 'Eventos en vivo (AMI)'),
    h(`button${tab === 'cdr' ? '.on' : ''}`, { onclick: () => setTab('cdr') }, 'Llamadas fallidas (histórico)'));

  const eventRow = (e, isNew) => {
    const [sl, st] = SEV[e.severity] || SEV.info;
    const d = e.detail || {};
    const meta = [d.callerNum && `${d.callerNum} → ${d.connNum || d.exten || '—'}`, d.channel, d.remote, d.account && `cuenta ${d.account}`, d.uniqueid && `id ${d.uniqueid}`].filter(Boolean).join('  ·  ');
    return h(`div.ev.${e.severity}${isNew ? '.new' : ''}`, h('div.bar'),
      h('div', { style: { minWidth: 0 } }, h('div.t', e.title, ' ', badge(KINDS[e.kind] || e.kind)), h('div.m', meta),
        d.uniqueid ? h('a.btn.sm.ghost', { href: '#/history', onclick: () => sessionStorage.setItem('hist-uid', d.linkedid || d.uniqueid) }, 'Ver en histórico') : null),
      h('span.when', { title: fmtDate(e.ts) }, timeAgo(e.ts)));
  };

  async function load() {
    if (tab !== 'events' || !evCard.isConnected) body.replaceChildren(spinner());
    try {
      if (tab === 'events') {
        const { events } = await api(`/events?${qs({ ...f, limit: 200 })}`);
        feed.replaceChildren(...(events.length ? events.map((e) => eventRow(e)) : [empty('Sin eventos con estos filtros', 'Los hangups anómalos, fallos de registro e intentos de acceso se guardan automáticamente', 'check')]));
        if (!evCard.isConnected) body.replaceChildren(evCard);
      } else {
        const r = await api('/cdr/failed?hours=72&limit=200');
        body.replaceChildren(h('div.card', h('div.card-h', h('h3', 'Llamadas no completadas — últimas 72 h'), h('span.sub', `${r.total ?? r.rows.length} registros`)),
          r.rows.length ? h('div.table-wrap', h('table', h('thead', h('tr', ['Fecha', 'Origen', 'Destino', 'Canal', 'Estado', 'Dur.', 'Uniqueid'].map((x) => h('th', x)))),
            h('tbody', r.rows.map((c) => h('tr.click', { onclick: () => { sessionStorage.setItem('hist-uid', c.uniqueid); location.hash = '#/history'; } },
              h('td.nowrap.num', fmtDate(c.date)), h('td', c.src), h('td', c.dst), h('td.mono', c.channel), h('td', dispBadge(c.disposition)), h('td.num', fmtDur(c.duration)), h('td.mono.dim', c.uniqueid)))))) : empty('Sin llamadas fallidas', null, 'check')));
      }
    } catch (e) {
      body.replaceChildren(h('div.banner.bad', icon('alert'), h('div.grow', e.message), h('a.btn.sm', { href: '#/settings/db' }, 'Configurar')));
    }
  }

  const feed = h('div.feed');
  let evCard;
  const sel = (key, opts, ph) => h('select', { onchange: (e) => { f[key] = e.target.value; load(); } }, h('option', { value: '' }, ph), Object.entries(opts).map(([v, l]) => h('option', { value: v }, Array.isArray(l) ? l[0] : l)));
  const filters = h('div.filters', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' } },
    h('div.field', h('label', 'Severidad'), sel('severity', SEV, 'Todas')),
    h('div.field', h('label', 'Tipo'), sel('kind', KINDS, 'Todos')),
    h('div.field.wide', h('label', 'Buscar'), h('input', { type: 'search', placeholder: 'Número, canal, IP, uniqueid…', oninput: debounce((e) => { f.search = e.target.value; load(); }) })));

  evCard = h('div.card', filters, feed);

  ctx.on('event', (e) => {
    if (tab !== 'events' || !feed.isConnected) return;
    if ((f.severity && f.severity !== e.severity) || (f.kind && f.kind !== e.kind)) return;
    feed.prepend(eventRow(e, true));
  });
  drawTabs();
  await load();
  ctx.setSub('Hangups anómalos, marcaciones fallidas, seguridad y registros');
  return h('div', tabs, body);
}
