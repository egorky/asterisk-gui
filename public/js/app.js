import { h, icon, toast, fmtInt } from './ui.js';
import { api, bus, state, connectWs, closeWs } from './api.js';
import { mountPlayer } from './player.js';

const ROUTES = [
  { id: 'dashboard', title: 'Panel de control', icon: 'dashboard', load: () => import('./pages/dashboard.js'), group: 'Monitoreo' },
  { id: 'live', title: 'Llamadas en vivo', icon: 'phone', load: () => import('./pages/live.js'), badge: 'live' },
  { id: 'errors', title: 'Errores y alertas', icon: 'alert', load: () => import('./pages/errors.js'), badge: 'errors' },
  { id: 'history', title: 'Histórico', icon: 'history', load: () => import('./pages/history.js'), group: 'Registros' },
  { id: 'recordings', title: 'Grabaciones', icon: 'mic', load: () => import('./pages/recordings.js') },
  { id: 'endpoints', title: 'Extensiones y troncales', icon: 'users', load: () => import('./pages/endpoints.js'), group: 'Servidor' },
  { id: 'asterisk', title: 'Asterisk', icon: 'server', load: () => import('./pages/asterisk.js') },
  { id: 'settings', title: 'Configuración', icon: 'sliders', load: () => import('./pages/settings.js'), admin: false },
];

const root = document.getElementById('app');
let cleanups = [];

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch { /* ignore */ }
}

// ---- Login -------------------------------------------------------------------
function showLogin(msg) {
  closeWs();
  state.user = null;
  const err = h('div.err', { style: { display: msg ? 'block' : 'none' } }, msg || '');
  const u = h('input', { type: 'text', autocomplete: 'username', required: true, autofocus: true });
  const p = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button.btn.primary', { type: 'submit', style: { width: '100%', padding: '10px' } }, 'Iniciar sesión');
  const form = h('form.login-card', {
    onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true; err.style.display = 'none';
      try { const r = await api('/auth/login', { method: 'POST', body: { username: u.value, password: p.value } }); state.user = r.user; start(); }
      catch (x) { err.textContent = x.message; err.style.display = 'block'; btn.disabled = false; p.select(); }
    },
  },
  h('div.brand', h('div.brand-logo', icon('phone', 24)), h('div', 'Asterisk Console', h('small', 'Monitoreo y registros de telefonía'))),
  err,
  h('div.field', h('label', 'Usuario'), u), h('div.field', h('label', 'Contraseña'), p), btn);
  root.replaceChildren(h('div.login', form));
}

// ---- Shell -------------------------------------------------------------------
function amiPill() {
  const el = h('span.pill'); const dot = h('span.dot'); const t = h('span.t');
  el.append(dot, h('span', 'AMI'), t);
  const upd = () => {
    const s = state.status;
    const map = { connected: ['ok', 'Conectado'], connecting: ['warn pulse', 'Conectando…'], error: ['bad', 'Sin conexión'], disabled: ['', 'Deshabilitado'] };
    const [c, txt] = map[s.state] || ['', s.state];
    dot.className = `dot ${c}`; t.textContent = txt;
    el.title = s.state === 'error' && s.error ? s.error : `${s.host || ''}:${s.port || ''}`;
  };
  upd(); bus.on('status', () => el.isConnected && upd());
  return el;
}

function buildShell() {
  const sidebar = h('aside.sidebar');
  const nav = h('nav.nav');
  let lastGroup;
  const badges = {};
  for (const r of ROUTES) {
    if (r.group && r.group !== lastGroup) { nav.append(h('div.nav-label', r.group)); lastGroup = r.group; }
    const a = h('a', { href: `#/${r.id}`, 'data-route': r.id, onclick: () => sidebar.classList.remove('open') }, icon(r.icon), r.title);
    if (r.badge) { badges[r.badge] = h('span.count', { style: { display: 'none' } }); a.append(badges[r.badge]); }
    nav.append(a);
  }
  const updBadges = () => {
    const n = state.live.calls.length;
    if (badges.live) { badges.live.textContent = n; badges.live.style.display = n ? '' : 'none'; badges.live.className = 'count live'; }
    if (badges.errors) { badges.errors.textContent = state.errorsUnseen > 99 ? '99+' : state.errorsUnseen; badges.errors.style.display = state.errorsUnseen ? '' : 'none'; badges.errors.className = 'count hot'; }
  };
  bus.on('live', updBadges); bus.on('unseen', updBadges); bus.on('seen', updBadges);

  const themeBtn = h('button.icon-btn', { title: 'Cambiar tema', onclick: () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(t); themeBtn.replaceChildren(icon(t === 'dark' ? 'sun' : 'moon')); } },
    icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
  sidebar.append(
    h('div.brand', h('div.brand-logo', icon('phone', 16)), h('div', 'Asterisk Console', h('small', location.hostname))),
    nav,
    h('div.side-foot', h('div.avatar', state.user.username.slice(0, 2)), h('div.who', h('b', state.user.username), h('span', state.user.role === 'admin' ? 'Administrador' : 'Solo lectura')),
      themeBtn, h('button.icon-btn', { title: 'Cerrar sesión', onclick: async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); showLogin(); } }, icon('logout'))));

  const title = h('h1'), sub = h('span.sub');
  const wsDot = h('span.pill', { style: { display: 'none' } }, h('span.dot.bad'), h('span.t', 'Reconectando…'));
  bus.on('ws', () => { wsDot.style.display = state.wsUp ? 'none' : ''; });
  const top = h('header.topbar',
    h('button.icon-btn.menu-btn', { onclick: () => sidebar.classList.toggle('open') }, icon('menu')),
    h('div', title, sub), h('div.grow'),
    h('div.pills', wsDot, amiPill()));
  const content = h('main.content');
  const playerHost = h('div');
  root.replaceChildren(h('div.shell', sidebar, h('div.main', top, content)), playerHost);
  mountPlayer(playerHost);
  updBadges();
  return { content, title, sub, nav };
}

let shell;
async function route() {
  if (!state.user) return;
  const [, id = 'dashboard', ...rest] = location.hash.split('?')[0].split('/');
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  cleanups = [];
  shell.nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.route === r.id));
  shell.title.textContent = r.title; shell.sub.textContent = '';
  document.title = `${r.title} · Asterisk Console`;
  if (r.id === 'errors') { state.errorsUnseen = 0; bus.emit('seen'); }
  shell.content.replaceChildren(h('div.loading', h('span.spin'), 'Cargando…'));
  const myCleanups = cleanups;
  const ctx = {
    state, args: rest, setSub: (t) => { shell.sub.textContent = t; },
    on: (ev, fn) => myCleanups.push(bus.on(ev, fn)),
    every: (fn, ms) => { const t = setInterval(fn, ms); myCleanups.push(() => clearInterval(t)); },
    alive: () => cleanups === myCleanups,
  };
  try {
    const mod = await r.load();
    const el = await mod.default(ctx);
    if (!ctx.alive()) return;
    shell.content.replaceChildren(el);
    window.scrollTo(0, 0);
  } catch (e) {
    if (!ctx.alive()) return;
    shell.content.replaceChildren(h('div.banner.bad', icon('alert'), h('div.grow', h('b', 'No se pudo cargar la página'), h('div.muted', e.message))));
    console.error(e);
  }
}

async function start() {
  try { state.settings = await api('/settings'); } catch { /* se reintenta por página */ }
  if (state.settings) applyTheme(state.settings.ui.theme === 'light' && !localStorage.getItem('theme') ? 'light' : document.documentElement.dataset.theme);
  shell = buildShell();
  connectWs();
  if (!location.hash) location.hash = '#/dashboard';
  route();
}

window.addEventListener('hashchange', route);
bus.on('unauthorized', () => { if (state.user) showLogin('Su sesión expiró. Ingrese nuevamente.'); });
window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.message && !e.reason.status) toast(e.reason.message, 'bad'); });

(async () => {
  try { const r = await api('/auth/me'); state.user = r.user; start(); } catch { showLogin(); }
})();
