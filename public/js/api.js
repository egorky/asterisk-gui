export class Emitter {
  constructor() { this.m = new Map(); }
  on(ev, fn) { if (!this.m.has(ev)) this.m.set(ev, new Set()); this.m.get(ev).add(fn); return () => this.m.get(ev).delete(fn); }
  emit(ev, ...a) { (this.m.get(ev) || []).forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } }); }
}

export const bus = new Emitter();

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/auth/login')) bus.emit('unauthorized');
  if (!r.ok) throw Object.assign(new Error(data.error || `Error ${r.status}`), { status: r.status });
  return data;
}

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  return p.toString();
};

// Estado compartido alimentado por WebSocket
export const state = {
  user: null, settings: null,
  status: { state: 'disabled' }, live: { calls: [], channels: [], at: 0 }, core: {}, events: [],
  errorsUnseen: 0, wsUp: false,
};

let ws, retry = 0;
export function connectWs() {
  clearTimeout(connectWs.t);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { retry = 0; state.wsUp = true; bus.emit('ws'); };
  ws.onclose = () => { state.wsUp = false; bus.emit('ws'); if (state.user) connectWs.t = setTimeout(connectWs, Math.min(15000, 1000 * 2 ** retry++)); };
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.type === 'hello') { state.status = d.status; state.live = d.live; state.events = d.events; bus.emit('status'); bus.emit('live'); }
    else if (d.type === 'live') { state.live = d.live; bus.emit('live'); }
    else if (d.type === 'status') { state.status = d.status; bus.emit('status'); }
    else if (d.type === 'core') { state.core = d.core; bus.emit('core'); }
    else if (d.type === 'event') {
      state.events.unshift(d.event); state.events.length = Math.min(state.events.length, 100);
      if (d.event.severity !== 'info') { state.errorsUnseen++; bus.emit('unseen'); }
      bus.emit('event', d.event);
    }
  };
}
export function closeWs() { clearTimeout(connectWs.t); if (ws) { ws.onclose = null; ws.close(); } }
