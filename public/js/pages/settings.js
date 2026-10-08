import { h, icon, badge, toast, modal, confirmBox, empty, spinner, fmtDate, fmtSize, fmtInt } from '../ui.js';
import { api, state } from '../api.js';

const field = (label, input, hint, cls = '') => h(`div.field${cls}`, h('label', label), input, hint ? h('span.hint', hint) : null);
const txt = (v, attrs = {}) => h('input', { type: 'text', value: v ?? '', autocomplete: 'off', spellcheck: false, ...attrs });
const check = (label, v) => { const i = h('input', { type: 'checkbox', checked: !!v }); return Object.assign(h('label.check', i, label), { input: i }); };
const result = () => h('div');
const showResult = (box, ok, ...kids) => box.replaceChildren(h(`div.test-res.${ok ? 'ok' : 'bad'}`, ...kids));

async function save(section, body, btn) {
  btn.disabled = true;
  try {
    state.settings[section] = await api(`/settings/${section}`, { method: 'PUT', body });
    toast('Configuración guardada', 'ok');
    return state.settings[section];
  } catch (e) { toast(e.message, 'bad'); } finally { btn.disabled = false; }
}

// ---- Asterisk (AMI) ------------------------------------------------------------
function asteriskForm() {
  const s = state.settings.asterisk;
  const en = check('Habilitar conexión con Asterisk', s.enabled);
  const host = txt(s.host), port = txt(s.port, { type: 'number' }), user = txt(s.username);
  const pass = txt('', { type: 'password', placeholder: s.hasSecret ? '•••••••• (guardada, deje vacío para conservar)' : '', autocomplete: 'new-password' });
  const tls = check('Usar TLS (AMI sobre SSL)', s.tls);
  const poll = txt(s.pollMs, { type: 'number' });
  const files = h('textarea', { rows: 6, spellcheck: false }); files.value = s.configFiles.join('\n');
  const res = result();
  const vals = () => ({ enabled: en.input.checked, host: host.value, port: port.value, username: user.value, secret: pass.value, tls: tls.input.checked, pollMs: poll.value, configFiles: files.value.split('\n').map((x) => x.trim()).filter(Boolean) });
  const test = h('button.btn', { onclick: async (e) => {
    e.target.disabled = true; res.replaceChildren(h('div.loading', h('span.spin'), 'Probando…'));
    try { const r = await api('/settings/test/ami', { method: 'POST', body: vals() }); r.ok ? showResult(res, true, h('b', 'Conexión correcta. '), r.version || r.banner) : showResult(res, false, h('b', 'No se pudo conectar: '), r.error); }
    catch (x) { showResult(res, false, x.message); } e.target.disabled = false;
  } }, icon('activity', 15), 'Probar conexión');
  const sv = h('button.btn.primary', { onclick: async (e) => { pass.value = (await save('asterisk', vals(), e.currentTarget)) ? '' : pass.value; } }, 'Guardar');
  return h('div.card', h('div.card-h', h('h3', 'Conexión con Asterisk (AMI)'), h('span.sub', 'Manager Interface')),
    h('div.card-b', h('div.form-grid',
      h('div.full', en),
      field('Dirección IP / host', host, 'Use 127.0.0.1 si Asterisk está en este mismo servidor'), field('Puerto', port, 'Por defecto 5038'),
      field('Usuario AMI', user), field('Contraseña (secret)', pass, 'Se guarda cifrada'),
      h('div.full', tls), field('Intervalo de actualización en vivo (ms)', poll, 'Entre 500 y 60000'),
      field('Archivos de configuración visibles', files, 'Un nombre por línea. Se leen vía AMI (GetConfig).', '.full')),
    h('details', { style: { marginTop: '18px' } }, h('summary.muted', { style: { cursor: 'pointer' } }, 'Ejemplo de usuario en manager.conf'),
      h('pre.out', { style: { marginTop: '8px' } }, `[general]\nenabled = yes\nport = 5038\nbindaddr = 127.0.0.1\n\n[gui]\nsecret = SuClaveSegura\ndeny = 0.0.0.0/0.0.0.0\npermit = 127.0.0.1/255.255.255.255\nread = system,call,log,agent,user,config,command,reporting,cdr,dialplan,security\nwrite = command,reporting,config\n\n; luego: asterisk -rx "manager reload"`)),
    res, h('div', { style: { display: 'flex', gap: '10px', marginTop: '18px' } }, test, sv)));
}

// ---- Base de datos ---------------------------------------------------------------
function dbForm() {
  const s = state.settings.db;
  const en = check('Habilitar histórico (CDR) desde la base de datos', s.enabled);
  const type = h('select', {}, [['mysql', 'MySQL / MariaDB'], ['postgres', 'PostgreSQL'], ['sqlite', 'SQLite (archivo)']].map(([v, t]) => h('option', { value: v, selected: v === s.type }, t)));
  const host = txt(s.host), port = txt(s.port, { type: 'number' }), user = txt(s.user), dbn = txt(s.database);
  const pass = txt('', { type: 'password', placeholder: s.hasPassword ? '•••••••• (guardada, deje vacío para conservar)' : '', autocomplete: 'new-password' });
  const file = txt(s.file, { placeholder: '/var/log/asterisk/master.db' });
  const ssl = check('Conexión SSL/TLS', s.ssl);
  const cdr = txt(s.cdrTable), cel = txt(s.celTable), dcol = txt(s.dateColumn), rcol = txt(s.recordingColumn);
  const net = h('div.form-grid.full', field('Host', host), field('Puerto', port), field('Usuario', user), field('Contraseña', pass, 'Se guarda cifrada'), field('Base de datos', dbn, 'Típico: asteriskcdrdb (FreePBX) o asterisk'), h('div', { style: { alignSelf: 'end' } }, ssl));
  const fil = h('div.full', field('Archivo SQLite', file, 'Ej. cdr_sqlite3_custom: /var/log/asterisk/master.db (se abre en solo lectura)'));
  const sync = () => { const sq = type.value === 'sqlite'; net.style.display = sq ? 'none' : ''; fil.style.display = sq ? '' : 'none'; if (!s.port || [3306, 5432].includes(Number(port.value))) port.value = type.value === 'postgres' ? 5432 : 3306; };
  type.onchange = sync; sync();
  const res = result();
  const vals = () => ({ enabled: en.input.checked, type: type.value, host: host.value, port: port.value, user: user.value, password: pass.value, database: dbn.value, file: file.value, ssl: ssl.input.checked, cdrTable: cdr.value, celTable: cel.value, dateColumn: dcol.value, recordingColumn: rcol.value });
  const test = h('button.btn', { onclick: async (e) => {
    e.target.disabled = true; res.replaceChildren(h('div.loading', h('span.spin'), 'Probando…'));
    try {
      const r = await api('/settings/test/db', { method: 'POST', body: vals() });
      r.ok ? showResult(res, true, h('b', `Conexión correcta (${r.ms} ms). `), `${fmtInt(r.rows)} registros en la tabla ${cdr.value}. Fecha: "${r.dateColumn}". CEL: ${r.cel ? 'disponible' : 'no encontrado'}.`,
        h('ul', h('li', `Columnas: ${r.columns.join(', ')}`))) : showResult(res, false, h('b', 'Error: '), r.error);
    } catch (x) { showResult(res, false, x.message); } e.target.disabled = false;
  } }, icon('database', 15), 'Probar conexión');
  const sv = h('button.btn.primary', { onclick: async (e) => { const r = await save('db', vals(), e.currentTarget); if (r) pass.value = ''; } }, 'Guardar');
  return h('div.card', h('div.card-h', h('h3', 'Base de datos del histórico'), h('span.sub', 'CDR / CEL de Asterisk')),
    h('div.card-b', h('div.form-grid', h('div.full', en), field('Tipo de base de datos', type, null, '.full'), net, fil,
      field('Tabla CDR', cdr), field('Tabla CEL (detalle de eventos)', cel, 'Opcional'),
      field('Columna de fecha', dcol, 'calldate (cdr_mysql) o start (cdr_adaptive_odbc). Se detecta automáticamente si no existe.'),
      field('Columna de grabación', rcol, 'Opcional: nombre del archivo en el CDR. Si no existe, se asocia por uniqueid en el nombre del archivo.')),
    h('div.muted', { style: { marginTop: '14px', fontSize: '12.5px' } }, 'La GUI solo ejecuta consultas SELECT. Se recomienda un usuario de base de datos con permiso de solo lectura.'),
    res, h('div', { style: { display: 'flex', gap: '10px', marginTop: '18px' } }, test, sv)));
}

// ---- Grabaciones --------------------------------------------------------------------
function browseDialog(start, onPick) {
  const list = h('div.dir-list'), cur = h('input', { type: 'text', style: { fontFamily: 'ui-monospace, monospace' } });
  let path = start || '/';
  const go = async (p) => {
    list.replaceChildren(spinner());
    try {
      const r = await api(`/fs/browse?path=${encodeURIComponent(p)}`);
      path = r.path; cur.value = path;
      list.replaceChildren(...(r.parent ? [h('button', { onclick: () => go(r.parent) }, icon('up', 16), '..')] : []), ...r.dirs.map((d) => h('button', { onclick: () => go(`${path === '/' ? '' : path}/${d}`) }, icon('folder', 16), d)));
      if (!r.dirs.length && !r.parent) list.append(empty('Carpeta vacía'));
    } catch (e) { list.replaceChildren(h('div.err', { style: { margin: '10px' } }, e.message)); }
  };
  cur.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(cur.value); });
  const m = modal('Seleccionar carpeta', h('div', { style: { display: 'grid', gap: '10px' } }, cur, list), { actions: [
    h('button.btn', { onclick: () => m.close() }, 'Cancelar'), h('button.btn.primary', { onclick: () => { onPick(path); m.close(); } }, 'Usar esta carpeta')] });
  go(path);
}

function recordingsForm() {
  const s = state.settings.recordings;
  const dirs = s.dirs.map((d) => ({ ...d }));
  const rows = h('div');
  const exts = txt(s.extensions.join(', ')), rec = check('Buscar en subcarpetas', s.recursive), cache = txt(s.cacheSeconds, { type: 'number' });
  const res = result();
  const draw = () => {
    rows.replaceChildren(...(dirs.length ? dirs.map((d, i) => {
      const lab = txt(d.label, { placeholder: 'Etiqueta', oninput: (e) => { d.label = e.target.value; } });
      const p = txt(d.path, { placeholder: '/var/spool/asterisk/monitor', oninput: (e) => { d.path = e.target.value; }, style: { fontFamily: 'ui-monospace, monospace' } });
      return h('div.dir-row', lab, p, h('button.btn', { onclick: () => browseDialog(d.path || '/', (np) => { d.path = np; if (!d.label || /^Directorio/.test(d.label)) d.label = np.split('/').filter(Boolean).pop() || 'Raíz'; draw(); }) }, icon('folder', 15), 'Explorar'),
        h('button.icon-btn', { title: 'Quitar', onclick: () => { dirs.splice(i, 1); draw(); } }, icon('trash', 16)));
    }) : [h('div.muted', { style: { padding: '8px 0' } }, 'Aún no hay directorios. Agregue al menos uno.')]));
  };
  draw();
  const vals = () => ({ dirs, extensions: exts.value.split(/[,\s]+/).filter(Boolean), recursive: rec.input.checked, cacheSeconds: cache.value });
  const test = h('button.btn', { onclick: async (e) => {
    e.target.disabled = true; res.replaceChildren(h('div.loading', h('span.spin'), 'Escaneando…'));
    try {
      const r = await api('/settings/test/recordings', { method: 'POST', body: vals() });
      res.replaceChildren(...r.dirs.map((d) => h(`div.test-res.${d.ok ? 'ok' : 'bad'}`, { style: { marginTop: '8px' } }, h('b', `${d.label}: `),
        d.ok ? `${fmtInt(d.files)} archivos · ${fmtSize(d.bytes)} (${Object.entries(d.byExt).map(([k, v]) => `${v} .${k}`).join(', ') || 'ninguno con las extensiones indicadas'})` : d.error)));
    } catch (x) { showResult(res, false, x.message); } e.target.disabled = false;
  } }, icon('search', 15), 'Probar directorios');
  return h('div.card', h('div.card-h', h('h3', 'Directorios de grabaciones'), h('span.sub', 'MP3, WAV y más')),
    h('div.card-b', rows, h('button.btn.sm', { onclick: () => { dirs.push({ id: '', label: `Directorio ${dirs.length + 1}`, path: '' }); draw(); } }, icon('plus', 14), 'Agregar directorio'),
      h('div.form-grid', { style: { marginTop: '20px' } }, field('Extensiones a incluir', exts, 'Separadas por coma. Se ignoran mayúsculas: "wav" incluye también .WAV y .Wav', '.full'), h('div', rec), field('Vigencia del índice (segundos)', cache, 'Cada cuánto se vuelve a escanear el disco')),
      h('div.muted', { style: { marginTop: '14px', fontSize: '12.5px' } }, 'El usuario que ejecuta esta GUI debe poder leer los directorios (p. ej. grupo "asterisk"). La fecha, el número y el uniqueid se deducen del nombre del archivo (formatos MixMonitor/FreePBX).'),
      res, h('div', { style: { display: 'flex', gap: '10px', marginTop: '18px' } }, test, h('button.btn.primary', { onclick: async (e) => { const r = await save('recordings', vals(), e.currentTarget); if (r) { dirs.splice(0, dirs.length, ...r.dirs); draw(); } } }, 'Guardar'))));
}

// ---- Interfaz ----------------------------------------------------------------------------
function uiForm() {
  const s = state.settings.ui;
  const ref = txt(s.refreshSeconds, { type: 'number' });
  const rows = h('select', {}, [25, 50, 100, 200].map((n) => h('option', { value: n, selected: n === s.rowsPerPage }, n)));
  const theme = h('select', {}, [['dark', 'Oscuro'], ['light', 'Claro']].map(([v, t]) => h('option', { value: v, selected: document.documentElement.dataset.theme === v }, t)));
  theme.onchange = () => { document.documentElement.dataset.theme = theme.value; try { localStorage.setItem('theme', theme.value); } catch { /* ignore */ } };
  const admin = state.user.role === 'admin';
  return h('div.card', h('div.card-h', h('h3', 'Interfaz')), h('div.card-b', h('div.form-grid',
    field('Tema', theme, 'Se guarda en este navegador'), field('Filas por página (histórico y grabaciones)', rows), field('Refresco del panel (segundos)', ref)),
  admin ? h('div', { style: { marginTop: '18px' } }, h('button.btn.primary', { onclick: (e) => save('ui', { refreshSeconds: ref.value, rowsPerPage: rows.value, theme: theme.value }, e.currentTarget) }, 'Guardar')) : null));
}

// ---- Usuarios ---------------------------------------------------------------------------------
function usersForm() {
  const box = h('div');
  const load = async () => {
    box.replaceChildren(spinner());
    const { users } = await api('/users');
    const name = txt('', { placeholder: 'usuario' }), pw = txt('', { type: 'password', placeholder: 'Contraseña (mín. 8)', autocomplete: 'new-password' });
    const role = h('select', {}, [['viewer', 'Solo lectura'], ['admin', 'Administrador']].map(([v, t]) => h('option', { value: v }, t)));
    box.replaceChildren(
      h('div.card', h('div.card-h', h('h3', 'Usuarios con acceso')), h('div.table-wrap', h('table', h('thead', h('tr', ['Usuario', 'Rol', 'Estado', 'Último acceso', ''].map((x) => h('th', x)))),
        h('tbody', users.map((u) => h('tr', h('td', h('b', u.username), u.id === state.user.id ? h('span.dim', ' (usted)') : null),
          h('td', h('select', { style: { width: '150px' }, onchange: async (e) => { try { await api(`/users/${u.id}`, { method: 'PUT', body: { role: e.target.value } }); toast('Rol actualizado', 'ok'); } catch (x) { toast(x.message, 'bad'); load(); } } },
            [['viewer', 'Solo lectura'], ['admin', 'Administrador']].map(([v, t]) => h('option', { value: v, selected: u.role === v }, t)))),
          h('td', u.disabled ? badge('Deshabilitado', 'bad') : badge('Activo', 'ok')), h('td.dim', u.last_login ? fmtDate(`${u.last_login}Z`) : 'Nunca'),
          h('td.r.nowrap',
            h('button.btn.sm', { onclick: async () => { const p = prompt(`Nueva contraseña para ${u.username} (mín. 8 caracteres)`); if (!p) return; try { await api(`/users/${u.id}`, { method: 'PUT', body: { password: p } }); toast('Contraseña actualizada', 'ok'); } catch (x) { toast(x.message, 'bad'); } } }, 'Cambiar clave'), ' ',
            u.id !== state.user.id ? h('button.btn.sm', { onclick: async () => { try { await api(`/users/${u.id}`, { method: 'PUT', body: { disabled: !u.disabled } }); load(); } catch (x) { toast(x.message, 'bad'); } } }, u.disabled ? 'Habilitar' : 'Deshabilitar') : null, ' ',
            u.id !== state.user.id ? h('button.btn.sm.danger', { onclick: async () => { if (await confirmBox('Eliminar usuario', `¿Eliminar a "${u.username}"?`, 'Eliminar', true)) { try { await api(`/users/${u.id}`, { method: 'DELETE' }); load(); } catch (x) { toast(x.message, 'bad'); } } } }, icon('trash', 14)) : null))))))),
      h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', 'Nuevo usuario')), h('div.card-b', h('div.form-grid', field('Usuario', name), field('Rol', role), field('Contraseña', pw, null, '.full')),
        h('div', { style: { marginTop: '16px' } }, h('button.btn.primary', { onclick: async () => { try { await api('/users', { method: 'POST', body: { username: name.value, password: pw.value, role: role.value } }); toast('Usuario creado', 'ok'); load(); } catch (x) { toast(x.message, 'bad'); } } }, icon('plus', 15), 'Crear usuario')))));
  };
  load();
  return box;
}

function accountForm() {
  const cur = txt('', { type: 'password', autocomplete: 'current-password' }), n1 = txt('', { type: 'password', autocomplete: 'new-password' }), n2 = txt('', { type: 'password', autocomplete: 'new-password' });
  return h('div.card', h('div.card-h', h('h3', 'Mi cuenta'), h('span.sub', state.user.username)), h('div.card-b', h('div.form-grid',
    field('Contraseña actual', cur, null, '.full'), field('Nueva contraseña', n1, 'Mínimo 8 caracteres'), field('Repetir nueva contraseña', n2)),
  h('div', { style: { marginTop: '18px' } }, h('button.btn.primary', { onclick: async () => {
    if (n1.value !== n2.value) return toast('Las contraseñas nuevas no coinciden', 'bad');
    try { await api('/auth/password', { method: 'POST', body: { current: cur.value, password: n1.value } }); toast('Contraseña actualizada', 'ok'); cur.value = n1.value = n2.value = ''; } catch (e) { toast(e.message, 'bad'); }
  } }, 'Cambiar contraseña'))));
}

export default async function page(ctx) {
  const admin = state.user.role === 'admin';
  const S = [
    ...(admin ? [['asterisk', 'Asterisk (AMI)', 'server', asteriskForm], ['db', 'Base de datos', 'database', dbForm], ['recordings', 'Grabaciones', 'mic', recordingsForm]] : []),
    ['ui', 'Interfaz', 'sliders', uiForm], ...(admin ? [['users', 'Usuarios', 'users', usersForm]] : []), ['account', 'Mi cuenta', 'user', accountForm],
  ];
  state.settings = await api('/settings');
  let cur = S.find((s) => s[0] === ctx.args[0]) || S[0];
  const body = h('div'), nav = h('div.settings-nav');
  const draw = () => {
    nav.replaceChildren(...S.map((s) => h(`button${s === cur ? '.on' : ''}`, { onclick: () => { cur = s; history.replaceState(null, '', `#/settings/${s[0]}`); draw(); } }, icon(s[2], 17), s[1])));
    body.replaceChildren(cur[3]());
  };
  draw();
  ctx.setSub(admin ? 'Toda la configuración se guarda desde aquí' : '');
  return h('div.settings-layout', nav, body);
}
