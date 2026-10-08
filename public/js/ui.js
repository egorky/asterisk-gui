// Utilidades de interfaz: creación de DOM segura (sin innerHTML), iconos, formato, toasts y modales.

export function h(tag, props, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)/i.exec(tag);
  const el = document.createElement(m[1] || 'div');
  for (const t of m[2].match(/[.#][\w-]+/g) || []) t[0] === '.' ? el.classList.add(t.slice(1)) : (el.id = t.slice(1));
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (k) => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) return k.forEach(add);
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/><path d="M14.05 2a9 9 0 0 1 8 7.94M14.05 6A5 5 0 0 1 18 10"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  sliders: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-15.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  play: '<path d="M6 3l14 9-14 9V3z"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  in: '<path d="M17 7 7 17M17 17H7V7"/>',
  out: '<path d="M7 7h10v10M7 17 17 7"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M8 13h8M8 17h8"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
};

export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.classList.add('icon');
  s.innerHTML = ICONS[name] || ''; // contenido estático propio, nunca datos externos
  return s;
}

// ---- Formato -------------------------------------------------------------
export const fmtInt = (n) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('es'));
export function fmtDur(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
export function fmtUptime(s) {
  if (s == null) return '—';
  const d = Math.floor(s / 86400), hh = Math.floor(s / 3600) % 24, mm = Math.floor(s / 60) % 60;
  return d ? `${d} d ${hh} h ${mm} min` : hh ? `${hh} h ${mm} min` : `${mm} min`;
}
export function fmtSize(b) {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}
export const pad = (n) => String(n).padStart(2, '0');
export function fmtDate(v) {
  if (!v) return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v).replace(' ', 'T'));
  if (isNaN(d)) return String(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return fmtDate(iso);
}
export const toSqlDate = (v) => (v ? `${v.replace('T', ' ')}${v.length === 16 ? ':00' : ''}` : '');
export const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const DISP = {
  ANSWERED: ['Contestada', 'ok'], 'NO ANSWER': ['Sin respuesta', 'warn'], BUSY: ['Ocupado', 'warn'],
  FAILED: ['Fallida', 'bad'], CONGESTION: ['Congestión', 'bad'], UNKNOWN: ['Desconocido', 'muted'],
};
export const dispBadge = (d) => { const [t, c] = DISP[String(d || '').toUpperCase()] || [d || '—', 'muted']; return h(`span.badge.${c}`, t); };
export const badge = (text, tone = 'muted') => h(`span.badge.${tone}`, text);

// ---- Notificaciones y modales --------------------------------------------
export function toast(msg, tone = 'info') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div#toasts'); document.body.append(box); }
  const t = h(`div.toast.${tone}`, msg);
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, tone === 'bad' ? 6000 : 3200);
}

export function modal(title, body, { wide = false, actions = [] } = {}) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const ov = h('div.overlay', { onmousedown: (e) => { if (e.target === ov) close(); } },
    h(`div.modal${wide ? '.wide' : ''}`,
      h('div.modal-head', h('h3', title), h('button.icon-btn', { onclick: close, 'aria-label': 'Cerrar' }, icon('x'))),
      h('div.modal-body', body),
      actions.length ? h('div.modal-foot', actions) : null));
  document.addEventListener('keydown', esc);
  document.body.append(ov);
  return { close, el: ov };
}

export function confirmBox(title, text, okLabel = 'Aceptar', danger = false) {
  return new Promise((resolve) => {
    const m = modal(title, h('p', text), {
      actions: [
        h('button.btn', { onclick: () => { m.close(); resolve(false); } }, 'Cancelar'),
        h(`button.btn.${danger ? 'danger' : 'primary'}`, { onclick: () => { m.close(); resolve(true); } }, okLabel),
      ],
    });
  });
}

export function drawer(title, body) {
  const close = () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 180); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const ov = h('div.overlay.right', { onmousedown: (e) => { if (e.target === ov) close(); } },
    h('aside.drawer',
      h('div.modal-head', h('h3', title), h('button.icon-btn', { onclick: close, 'aria-label': 'Cerrar' }, icon('x'))),
      h('div.drawer-body', body)));
  document.addEventListener('keydown', esc);
  document.body.append(ov);
  return { close, el: ov };
}

export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const empty = (title, sub, ic = 'search') => h('div.empty', icon(ic, 28), h('strong', title), sub ? h('span', sub) : null);
export const spinner = () => h('div.loading', h('span.spin'), 'Cargando…');
export function setClipboard(t) { navigator.clipboard?.writeText(t).then(() => toast('Copiado', 'ok')).catch(() => {}); }
