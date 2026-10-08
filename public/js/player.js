import { h, icon, fmtDur, fmtDate, fmtSize } from './ui.js';
import { Emitter } from './api.js';

export const playerBus = new Emitter();
let audio, bar, current = null;

export function mountPlayer(host) {
  audio = new Audio();
  audio.preload = 'metadata';
  const title = h('b', 'Sin selección'), sub = h('span');
  const btn = h('button.play-btn', { onclick: () => (audio.paused ? audio.play() : audio.pause()), 'aria-label': 'Reproducir/Pausar' }, icon('play'));
  const cur = h('span.num', '0:00'), dur = h('span.num', '0:00');
  const range = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Posición' });
  const speed = h('select', { style: { width: '78px' }, onchange: () => { audio.playbackRate = Number(speed.value); } },
    [0.75, 1, 1.25, 1.5, 2].map((s) => h('option', { value: s, selected: s === 1 }, `${s}×`)));
  const dl = h('a.btn.sm', { href: '#', download: '' }, icon('download', 15), 'Descargar');
  const close = h('button.icon-btn', { onclick: () => { audio.pause(); current = null; bar.style.display = 'none'; playerBus.emit('change', null); }, 'aria-label': 'Cerrar reproductor' }, icon('x'));
  bar = h('div.player', { style: { display: 'none' } }, btn, h('div.meta', title, sub), h('div.seek', cur, range, dur), speed, dl, close);
  let dragging = false;
  range.addEventListener('input', () => { dragging = true; if (audio.duration) cur.textContent = fmtDur(audio.duration * range.value / 1000); });
  range.addEventListener('change', () => { if (audio.duration) audio.currentTime = audio.duration * range.value / 1000; dragging = false; });
  audio.addEventListener('timeupdate', () => { if (!dragging && audio.duration) { range.value = (audio.currentTime / audio.duration) * 1000; cur.textContent = fmtDur(audio.currentTime); } });
  audio.addEventListener('loadedmetadata', () => { dur.textContent = fmtDur(audio.duration); });
  const setBtn = () => { btn.replaceChildren(icon(audio.paused ? 'play' : 'pause')); btn.classList.toggle('playing', !audio.paused); playerBus.emit('change', audio.paused ? null : current?.id); };
  audio.addEventListener('play', setBtn); audio.addEventListener('pause', setBtn);
  audio.addEventListener('ended', () => { range.value = 0; setBtn(); });
  audio.addEventListener('error', () => { sub.textContent = 'No se pudo reproducir este archivo (formato no compatible con el navegador)'; });
  host.append(bar);
  playRecording.set = (r) => {
    current = r;
    title.textContent = r.name;
    sub.textContent = `${fmtDate(r.ts)} · ${fmtSize(r.size)} · ${r.dir || ''}`;
    dl.href = `/api/recordings/${r.id}/download`;
    bar.style.display = 'flex';
    audio.src = `/api/recordings/${r.id}/stream`;
    audio.playbackRate = Number(speed.value);
    audio.play().catch(() => {});
  };
}

export function playRecording(r) {
  if (current && current.id === r.id) { audio.paused ? audio.play() : audio.pause(); return; }
  playRecording.set(r);
}

/** Botón redondo play/pausa que refleja el estado global. */
export function playButton(r, small = true) {
  const b = h(`button.play-btn${small ? '.sm' : ''}`, { title: 'Reproducir', onclick: (e) => { e.stopPropagation(); playRecording(r); } }, icon('play'));
  const off = playerBus.on('change', (id) => {
    if (!b.isConnected) return off();
    const on = id === r.id;
    b.classList.toggle('playing', on);
    b.replaceChildren(icon(on ? 'pause' : 'play'));
  });
  return b;
}
