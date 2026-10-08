import { h, icon, badge, empty, spinner, fmtUptime, debounce } from '../ui.js';
import { api, state } from '../api.js';

export default async function page(ctx) {
  let tab = ctx.args[0] || 'info';
  const body = h('div'), tabs = h('div.tabs');
  const T = [['info', 'Información'], ['config', 'Archivos de configuración'], ['cli', 'Consola (solo consultas)']];
  const drawTabs = () => tabs.replaceChildren(...T.map(([k, l]) => h(`button${k === tab ? '.on' : ''}`, { onclick: () => { tab = k; drawTabs(); show(); } }, l)));

  async function info() {
    body.replaceChildren(spinner());
    const d = await api('/asterisk/info');
    const c = d.core, s = c.settings || {};
    body.replaceChildren(
      h('div.grid.g2', { style: { marginBottom: '16px' } },
        h('div.card', h('div.card-h', h('h3', 'Servidor')), h('div.card-b', h('dl.kv', h('dt', 'Versión'), h('dd', c.version || '—'), h('dt', 'Tiempo activo'), h('dd', fmtUptime(c.uptime)), h('dt', 'Inicio'), h('dd', c.startup || '—'),
          h('dt', 'Última recarga'), h('dd', c.reload || '—'), h('dt', 'Llamadas actuales'), h('dd', c.currentCalls ?? '—'), h('dt', 'Nombre del sistema'), h('dd', s.system || '—')))),
        h('div.card', h('div.card-h', h('h3', 'Parámetros del núcleo')), h('div.card-b', h('dl.kv', h('dt', 'Versión AMI'), h('dd', s.ami || '—'), h('dt', 'Máx. llamadas'), h('dd', s.maxCalls ?? '—'), h('dt', 'Máx. carga'), h('dd', s.maxLoad ?? '—'),
          h('dt', 'Máx. file handles'), h('dd', s.maxFiles ?? '—'), h('dt', 'Realtime'), h('dd', s.realtime || '—'), h('dt', 'CDR'), h('dd', s.cdr || '—'), h('dt', 'HTTP'), h('dd', s.http || '—'))))),
      ...Object.entries(d.commands).map(([cmd, out]) => h('div.card', { style: { marginBottom: '16px' } }, h('div.card-h', h('h3.mono', cmd)), h('div.card-b', h('pre.out', out || '(sin salida)')))));
  }

  async function config() {
    const { files } = await api('/asterisk/config');
    const out = h('div'), sel = h('select', { style: { maxWidth: '260px' } }, files.map((f) => h('option', f)));
    let data = null, q = '';
    const draw = () => {
      if (!data) return;
      const cats = data.categories.map((c) => ({ ...c, vars: c.vars.filter((v) => !q || `${c.name} ${v.key} ${v.value}`.toLowerCase().includes(q)) })).filter((c) => c.vars.length || (!q || c.name.toLowerCase().includes(q)));
      out.replaceChildren(cats.length ? cats.map((c) => {
        const open = !!q || data.categories.length < 6;
        const tbl = h('table', { style: { display: open ? '' : 'none' } }, h('tbody', c.vars.map((v) => h('tr', h('td', v.key), h('td', v.value)))));
        return h('div.cfg-cat', h('header', { onclick: () => { tbl.style.display = tbl.style.display === 'none' ? '' : 'none'; } }, icon('right', 14), `[${c.name}]`, h('span.n', `${c.vars.length} parámetros`)), tbl);
      }) : empty('Sin resultados', 'Sin categorías o parámetros para mostrar'));
    };
    const loadFile = async () => {
      out.replaceChildren(spinner());
      try { data = await api(`/asterisk/config/${encodeURIComponent(sel.value)}`); draw(); } catch (e) { data = null; out.replaceChildren(h('div.banner.warn', icon('alert'), h('div.grow', e.message, h('div.muted', 'El usuario AMI necesita permiso "config" (read) y el archivo debe existir.')))); }
    };
    sel.onchange = loadFile;
    body.replaceChildren(h('div.toolbar', { style: { padding: '0 0 14px' } }, sel, h('input', { type: 'search', placeholder: 'Buscar parámetro o valor…', style: { maxWidth: '320px' }, oninput: debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 150) }), h('div.grow'),
      state.user.role === 'admin' ? h('a.btn.sm', { href: '#/settings/asterisk' }, 'Gestionar lista de archivos') : null,
      h('span.dim', 'Los secretos y contraseñas se ocultan')), out);
    if (files.length) loadFile(); else out.replaceChildren(empty('Sin archivos configurados', 'Agregue nombres de archivos en Configuración → Asterisk', 'file'));
  }

  function cli() {
    const out = h('pre.out', { style: { minHeight: '260px' } }, 'Ejecute una consulta. Solo se permiten comandos de lectura ("core show…", "pjsip show…", "queue show", etc.).');
    const inp = h('input', { type: 'text', placeholder: 'core show channels', spellcheck: false });
    const hist = []; let hi = 0;
    const run = async (cmd) => {
      cmd = (cmd ?? inp.value).trim(); if (!cmd) return;
      inp.value = cmd; hist.push(cmd); hi = hist.length;
      out.textContent = `> ${cmd}\n\n…`;
      try { const r = await api('/asterisk/cli', { method: 'POST', body: { command: cmd } }); out.textContent = `> ${cmd}\n\n${r.output}`; } catch (e) { out.textContent = `> ${cmd}\n\n${e.message}`; }
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') run();
      if (e.key === 'ArrowUp' && hi > 0) inp.value = hist[--hi];
      if (e.key === 'ArrowDown' && hi < hist.length - 1) inp.value = hist[++hi];
    });
    const quick = ['core show channels', 'core show calls', 'pjsip show endpoints', 'pjsip show registrations', 'pjsip show contacts', 'sip show peers', 'queue show', 'module show like cdr', 'cdr show status', 'core show hints', 'dialplan show', 'core show settings'];
    body.replaceChildren(h('div.card', h('div.card-b', h('div.cli-in', inp, h('button.btn.primary', { onclick: () => run() }, icon('terminal', 16), 'Ejecutar')), h('div.quick', quick.map((c) => h('button.btn.sm', { onclick: () => run(c) }, c))), h('div', { style: { height: '12px' } }), out)));
    inp.focus();
  }

  async function show() {
    try { await ({ info, config, cli }[tab])(); } catch (e) {
      body.replaceChildren(h('div.banner.warn', icon('alert'), h('div.grow', h('b', e.message), h('div.muted', 'Verifique la conexión AMI en Configuración → Asterisk.')), h('a.btn.sm', { href: '#/settings/asterisk' }, 'Configurar')));
    }
  }
  drawTabs(); show();
  return h('div', tabs, body);
}
